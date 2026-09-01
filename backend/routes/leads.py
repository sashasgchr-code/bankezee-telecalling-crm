"""
Lead management routes - Enhanced with pagination, filters, suppression
"""
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from datetime import datetime, timezone, timedelta
from typing import Optional, List
from bson import ObjectId
import pandas as pd
import io
import re

from models.schemas import LeadCreate, LeadUpdate, LeadAssign, AutoDistribute, BulkDeleteRequest
from utils.database import db
from utils.auth import get_current_user, require_admin
from utils.helpers import serialize_doc, serialize_docs

router = APIRouter(prefix="/api", tags=["Leads"])

# Phone number normalization helper
def normalize_phone(phone: str) -> str:
    """Normalize phone number to last 10 digits for Indian numbers"""
    if not phone:
        return ""
    digits = re.sub(r'\D', '', str(phone))
    if len(digits) > 10:
        return digits[-10:]
    return digits

@router.get("/leads")
async def list_leads(
    # Pagination
    page: int = Query(1, ge=1, description="Page number"),
    page_size: int = Query(50, ge=10, le=200, description="Items per page"),
    # Filters
    status: Optional[str] = None,
    statuses: Optional[str] = None,  # Comma-separated for multi-select
    assigned_to: Optional[str] = None,
    search: Optional[str] = None,
    last_call_outcome: Optional[str] = None,
    outcomes: Optional[str] = None,  # Comma-separated for multi-select
    source: Optional[str] = None,
    # Date filters
    created_from: Optional[str] = None,
    created_to: Optional[str] = None,
    last_called_from: Optional[str] = None,
    last_called_to: Optional[str] = None,
    # Special filters
    never_called: Optional[bool] = None,
    archived: Optional[bool] = None,
    is_invalid: Optional[bool] = None,
    import_batch_id: Optional[str] = None,
    # Sorting
    sort_by: str = Query("created_at", description="Field to sort by"),
    sort_order: str = Query("desc", description="asc or desc"),
    current_user: dict = Depends(get_current_user)
):
    """
    List leads with server-side pagination and enhanced filtering.
    Returns paginated results with total count for "X matching leads" display.
    """
    query = {}
    
    # Role-based access control
    if current_user["role"] == "telecaller":
        query["assigned_to"] = current_user["id"]
    elif assigned_to:
        if assigned_to == "unassigned":
            query["assigned_to"] = None
        elif assigned_to == "all":
            pass  # No filter
        else:
            query["assigned_to"] = assigned_to
    
    # Status filter (single or multi-select)
    if statuses:
        status_list = [s.strip() for s in statuses.split(",") if s.strip()]
        if status_list:
            query["status"] = {"$in": status_list}
    elif status:
        query["status"] = status
    
    # Outcome filter (single or multi-select)
    if outcomes:
        outcome_list = [o.strip() for o in outcomes.split(",") if o.strip()]
        if outcome_list:
            query["last_call_outcome"] = {"$in": outcome_list}
    elif last_call_outcome:
        query["last_call_outcome"] = last_call_outcome
    
    # Source filter
    if source:
        query["source"] = {"$regex": source, "$options": "i"}
    
    # Date range filters
    if created_from or created_to:
        date_query = {}
        if created_from:
            try:
                from_date = datetime.fromisoformat(created_from.replace('Z', '+00:00'))
                date_query["$gte"] = from_date
            except ValueError:
                pass
        if created_to:
            try:
                to_date = datetime.fromisoformat(created_to.replace('Z', '+00:00'))
                date_query["$lte"] = to_date + timedelta(days=1)
            except ValueError:
                pass
        if date_query:
            query["created_at"] = date_query
    
    if last_called_from or last_called_to:
        call_date_query = {}
        if last_called_from:
            try:
                from_date = datetime.fromisoformat(last_called_from.replace('Z', '+00:00'))
                call_date_query["$gte"] = from_date
            except ValueError:
                pass
        if last_called_to:
            try:
                to_date = datetime.fromisoformat(last_called_to.replace('Z', '+00:00'))
                call_date_query["$lte"] = to_date + timedelta(days=1)
            except ValueError:
                pass
        if call_date_query:
            query["last_call_at"] = call_date_query
    
    # Never called filter
    if never_called is True:
        query["last_call_at"] = {"$exists": False}
    elif never_called is False:
        query["last_call_at"] = {"$exists": True}
    
    # Archived filter (default to non-archived)
    if archived is True:
        query["archived"] = True
    elif archived is False or archived is None:
        query["$or"] = [{"archived": {"$exists": False}}, {"archived": False}]
    
    # Invalid/suppressed filter
    if is_invalid is True:
        query["is_invalid"] = True
    elif is_invalid is False or is_invalid is None:
        # Default: exclude invalid leads from normal views
        query["$and"] = query.get("$and", [])
        query.setdefault("$and", []).append({"$or": [{"is_invalid": {"$exists": False}}, {"is_invalid": False}]})
    
    # Import batch filter
    if import_batch_id:
        query["import_batch_id"] = import_batch_id
    
    # Search (name, email, phone)
    if search:
        normalized_search = normalize_phone(search)
        search_conditions = [
            {"name": {"$regex": search, "$options": "i"}},
            {"email": {"$regex": search, "$options": "i"}},
            {"phone": {"$regex": search, "$options": "i"}}
        ]
        if normalized_search and len(normalized_search) >= 3:
            search_conditions.append({"normalized_phone": {"$regex": normalized_search + "$", "$options": "i"}})
            search_conditions.append({"phone": {"$regex": normalized_search + "$", "$options": "i"}})
        
        # Merge with existing $or if present
        if "$or" in query:
            existing_or = query.pop("$or")
            query["$and"] = query.get("$and", [])
            query["$and"].append({"$or": existing_or})
            query["$and"].append({"$or": search_conditions})
        else:
            query["$or"] = search_conditions
    
    # Clean up empty $and
    if "$and" in query and not query["$and"]:
        del query["$and"]
    
    # Get total count for pagination info
    total_count = await db.leads.count_documents(query)
    
    # Calculate pagination
    skip = (page - 1) * page_size
    total_pages = (total_count + page_size - 1) // page_size
    
    # Sorting
    sort_direction = -1 if sort_order == "desc" else 1
    sort_field = sort_by if sort_by in ["created_at", "updated_at", "name", "last_call_at", "status"] else "created_at"
    
    # Fetch paginated results
    leads = await db.leads.find(query).sort(sort_field, sort_direction).skip(skip).limit(page_size).to_list(page_size)
    
    # Enrich with telecaller info for admin
    if current_user["role"] == "admin":
        for lead in leads:
            if lead.get("assigned_to"):
                telecaller = await db.users.find_one({"_id": ObjectId(lead["assigned_to"])})
                if telecaller:
                    lead["telecaller_name"] = telecaller.get("name", "Unknown")
                    lead["telecaller_email"] = telecaller.get("email", "")
    
    return {
        "leads": serialize_docs(leads),
        "pagination": {
            "page": page,
            "page_size": page_size,
            "total_count": total_count,
            "total_pages": total_pages,
            "has_next": page < total_pages,
            "has_prev": page > 1
        }
    }

@router.get("/leads/count")
async def get_leads_count(
    # Same filters as list_leads
    status: Optional[str] = None,
    statuses: Optional[str] = None,
    assigned_to: Optional[str] = None,
    search: Optional[str] = None,
    last_call_outcome: Optional[str] = None,
    outcomes: Optional[str] = None,
    source: Optional[str] = None,
    created_from: Optional[str] = None,
    created_to: Optional[str] = None,
    never_called: Optional[bool] = None,
    archived: Optional[bool] = None,
    is_invalid: Optional[bool] = None,
    current_user: dict = Depends(get_current_user)
):
    """Get count of leads matching filters - for 'X matching leads' display"""
    query = {}
    
    if current_user["role"] == "telecaller":
        query["assigned_to"] = current_user["id"]
    elif assigned_to:
        if assigned_to == "unassigned":
            query["assigned_to"] = None
        elif assigned_to != "all":
            query["assigned_to"] = assigned_to
    
    if statuses:
        query["status"] = {"$in": [s.strip() for s in statuses.split(",") if s.strip()]}
    elif status:
        query["status"] = status
    
    if outcomes:
        query["last_call_outcome"] = {"$in": [o.strip() for o in outcomes.split(",") if o.strip()]}
    elif last_call_outcome:
        query["last_call_outcome"] = last_call_outcome
    
    if source:
        query["source"] = {"$regex": source, "$options": "i"}
    
    if never_called is True:
        query["last_call_at"] = {"$exists": False}
    
    if archived is None or archived is False:
        query["$or"] = [{"archived": {"$exists": False}}, {"archived": False}]
    elif archived is True:
        query["archived"] = True
    
    if is_invalid is None or is_invalid is False:
        pass  # Normal view excludes invalid
    
    if search:
        normalized_search = normalize_phone(search)
        search_conditions = [
            {"name": {"$regex": search, "$options": "i"}},
            {"email": {"$regex": search, "$options": "i"}},
            {"phone": {"$regex": search, "$options": "i"}}
        ]
        if normalized_search and len(normalized_search) >= 3:
            search_conditions.append({"phone": {"$regex": normalized_search + "$", "$options": "i"}})
        query["$or"] = search_conditions
    
    count = await db.leads.count_documents(query)
    return {"count": count}

@router.get("/leads/stats")
async def get_leads_stats(current_user: dict = Depends(get_current_user)):
    """Get lead statistics for dashboard"""
    base_query = {}
    if current_user["role"] == "telecaller":
        base_query["assigned_to"] = current_user["id"]
    
    # Exclude archived and invalid
    base_query["$or"] = [{"archived": {"$exists": False}}, {"archived": False}]
    
    pipeline = [
        {"$match": base_query},
        {"$facet": {
            "by_status": [
                {"$group": {"_id": "$status", "count": {"$sum": 1}}}
            ],
            "by_outcome": [
                {"$match": {"last_call_outcome": {"$exists": True}}},
                {"$group": {"_id": "$last_call_outcome", "count": {"$sum": 1}}}
            ],
            "totals": [
                {"$group": {
                    "_id": None,
                    "total": {"$sum": 1},
                    "assigned": {"$sum": {"$cond": [{"$ne": ["$assigned_to", None]}, 1, 0]}},
                    "unassigned": {"$sum": {"$cond": [{"$eq": ["$assigned_to", None]}, 1, 0]}},
                    "never_called": {"$sum": {"$cond": [{"$not": ["$last_call_at"]}, 1, 0]}},
                    "called": {"$sum": {"$cond": [{"$ifNull": ["$last_call_at", False]}, 1, 0]}}
                }}
            ]
        }}
    ]
    
    result = await db.leads.aggregate(pipeline).to_list(1)
    
    if not result:
        return {"by_status": {}, "by_outcome": {}, "totals": {}}
    
    data = result[0]
    return {
        "by_status": {item["_id"]: item["count"] for item in data.get("by_status", []) if item["_id"]},
        "by_outcome": {item["_id"]: item["count"] for item in data.get("by_outcome", []) if item["_id"]},
        "totals": data.get("totals", [{}])[0] if data.get("totals") else {}
    }

@router.get("/leads/unassigned")
async def list_unassigned_leads(current_user: dict = Depends(require_admin)):
    leads = await db.leads.find({"assigned_to": None}).sort("created_at", -1).to_list(1000)
    return serialize_docs(leads)

@router.get("/leads/{lead_id}")
async def get_lead(lead_id: str, current_user: dict = Depends(get_current_user)):
    lead = await db.leads.find_one({"_id": ObjectId(lead_id)})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    
    if current_user["role"] == "telecaller" and lead.get("assigned_to") != current_user["id"]:
        raise HTTPException(status_code=403, detail="Access denied")
    
    lead_data = serialize_doc(lead)
    
    if lead_data.get("assigned_to"):
        telecaller = await db.users.find_one({"_id": ObjectId(lead_data["assigned_to"])})
        if telecaller:
            lead_data["telecaller_name"] = telecaller.get("name", "Unknown")
            lead_data["telecaller_email"] = telecaller.get("email", "")
            lead_data["telecaller_phone"] = telecaller.get("phone", "")
    
    return lead_data

@router.post("/leads")
async def create_lead(lead: LeadCreate, current_user: dict = Depends(require_admin)):
    lead_doc = {
        **lead.dict(),
        "assigned_to": None,
        "telecaller_name": None,
        "created_at": datetime.now(timezone.utc),
        "updated_at": datetime.now(timezone.utc),
        "created_by": current_user["id"]
    }
    
    result = await db.leads.insert_one(lead_doc)
    lead_doc["_id"] = result.inserted_id
    
    return serialize_doc(lead_doc)

@router.put("/leads/{lead_id}")
async def update_lead(lead_id: str, update: LeadUpdate, current_user: dict = Depends(get_current_user)):
    lead = await db.leads.find_one({"_id": ObjectId(lead_id)})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    
    if current_user["role"] == "telecaller" and lead.get("assigned_to") != current_user["id"]:
        raise HTTPException(status_code=403, detail="Access denied")
    
    update_data = {k: v for k, v in update.dict().items() if v is not None}
    update_data["updated_at"] = datetime.now(timezone.utc)
    
    if current_user["role"] == "telecaller":
        today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
        await db.daily_sessions.update_one(
            {"user_id": current_user["id"], "date": today},
            {"$inc": {"leads_updated": 1}}
        )
    
    await db.leads.update_one(
        {"_id": ObjectId(lead_id)},
        {"$set": update_data}
    )
    
    lead = await db.leads.find_one({"_id": ObjectId(lead_id)})
    return serialize_doc(lead)

@router.delete("/leads/{lead_id}")
async def delete_lead(lead_id: str, current_user: dict = Depends(require_admin)):
    result = await db.leads.delete_one({"_id": ObjectId(lead_id)})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Lead not found")
    return {"message": "Lead deleted"}

@router.post("/leads/bulk-delete")
async def bulk_delete_leads(data: BulkDeleteRequest, current_user: dict = Depends(require_admin)):
    if not data.lead_ids:
        raise HTTPException(status_code=400, detail="No leads specified")
    
    object_ids = [ObjectId(lid) for lid in data.lead_ids]
    result = await db.leads.delete_many({"_id": {"$in": object_ids}})
    
    return {"message": f"Deleted {result.deleted_count} leads", "deleted_count": result.deleted_count}

@router.post("/leads/import")
async def import_leads(
    file: UploadFile = File(...),
    current_user: dict = Depends(require_admin)
):
    try:
        content = await file.read()
        
        if file.filename.endswith('.csv'):
            df = pd.read_csv(io.BytesIO(content))
        elif file.filename.endswith(('.xlsx', '.xls')):
            df = pd.read_excel(io.BytesIO(content))
        else:
            raise HTTPException(status_code=400, detail="Unsupported file format")
        
        df.columns = df.columns.str.lower().str.strip()
        
        if 'phone' not in df.columns:
            raise HTTPException(status_code=400, detail="Phone column is required")
        
        telecallers = await db.users.find({"role": "telecaller", "is_active": True}).to_list(1000)
        telecaller_map = {}
        for tc in telecallers:
            telecaller_map[tc["name"].lower().strip()] = tc
            telecaller_map[tc["email"].lower().strip()] = tc
        
        leads_to_insert = []
        assigned_count = 0
        unassigned_count = 0
        unassigned_telecallers = set()
        
        for _, row in df.iterrows():
            phone = str(row.get('phone', '')).strip()
            if not phone:
                continue
            
            name = str(row.get('name', '')).strip()
            if not name:
                continue
            
            assigned_to = None
            telecaller_name = None
            telecaller_col = row.get('telecaller', '')
            
            if pd.notna(telecaller_col) and telecaller_col:
                tc_search = str(telecaller_col).lower().strip()
                if tc_search in telecaller_map:
                    tc = telecaller_map[tc_search]
                    assigned_to = str(tc["_id"])
                    telecaller_name = tc["name"]
                    assigned_count += 1
                else:
                    unassigned_count += 1
                    unassigned_telecallers.add(str(telecaller_col))
            
            lead_doc = {
                "name": name,
                "phone": phone,
                "email": str(row.get('email', '')).strip() if pd.notna(row.get('email')) else None,
                "source": str(row.get('source', '')).strip() if pd.notna(row.get('source')) else None,
                "city": str(row.get('city', '')).strip() if pd.notna(row.get('city')) else None,
                "status": str(row.get('status', 'new')).strip().lower() or "new",
                "notes": str(row.get('notes', '')).strip() if pd.notna(row.get('notes')) else None,
                "custom_fields": {},
                "assigned_to": assigned_to,
                "telecaller_name": telecaller_name,
                "created_at": datetime.now(timezone.utc),
                "updated_at": datetime.now(timezone.utc),
                "created_by": current_user["id"]
            }
            
            standard_fields = ['name', 'phone', 'email', 'source', 'city', 'status', 'notes', 'telecaller']
            for col in df.columns:
                if col not in standard_fields and pd.notna(row.get(col)):
                    lead_doc["custom_fields"][col] = str(row.get(col))
            
            leads_to_insert.append(lead_doc)
        
        if leads_to_insert:
            result = await db.leads.insert_many(leads_to_insert)
            
            message = f"Successfully imported {len(result.inserted_ids)} leads. "
            if assigned_count > 0:
                message += f"{assigned_count} leads assigned to telecallers. "
            if unassigned_count > 0:
                message += f"{unassigned_count} leads could not be assigned"
            
            return {
                "message": message,
                "total_imported": len(result.inserted_ids),
                "assigned": assigned_count,
                "unassigned": unassigned_count,
                "unassigned_telecallers": list(unassigned_telecallers)
            }
        else:
            return {"message": "No valid leads found in file", "total_imported": 0}
    
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error processing file: {str(e)}")

@router.post("/leads/assign")
async def assign_leads(assignment: LeadAssign, current_user: dict = Depends(require_admin)):
    user = await db.users.find_one({"_id": ObjectId(assignment.user_id)})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    lead_object_ids = [ObjectId(lid) for lid in assignment.lead_ids]
    result = await db.leads.update_many(
        {"_id": {"$in": lead_object_ids}},
        {
            "$set": {
                "assigned_to": assignment.user_id,
                "telecaller_name": user["name"],
                "updated_at": datetime.now(timezone.utc)
            }
        }
    )
    
    return {"message": f"Assigned {result.modified_count} leads to {user['name']}"}

@router.post("/leads/auto-distribute")
async def auto_distribute_leads(data: AutoDistribute, current_user: dict = Depends(require_admin)):
    telecallers = await db.users.find({
        "role": "telecaller",
        "is_active": True
    }).to_list(100)
    
    if not telecallers:
        raise HTTPException(status_code=400, detail="No active telecallers found")
    
    lead_ids = data.lead_ids
    num_telecallers = len(telecallers)
    
    assigned_count = 0
    for i, lead_id in enumerate(lead_ids):
        telecaller_index = i % num_telecallers
        telecaller = telecallers[telecaller_index]
        
        await db.leads.update_one(
            {"_id": ObjectId(lead_id)},
            {
                "$set": {
                    "assigned_to": str(telecaller["_id"]),
                    "telecaller_name": telecaller["name"],
                    "updated_at": datetime.now(timezone.utc)
                }
            }
        )
        assigned_count += 1
    
    return {"message": f"Distributed {assigned_count} leads among {num_telecallers} telecallers"}
