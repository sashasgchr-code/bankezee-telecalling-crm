"""
Lead management routes
"""
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from datetime import datetime, timezone
from typing import Optional
from bson import ObjectId
import pandas as pd
import io

from models.schemas import LeadCreate, LeadUpdate, LeadAssign, AutoDistribute, BulkDeleteRequest
from utils.database import db
from utils.auth import get_current_user, require_admin
from utils.helpers import serialize_doc, serialize_docs

router = APIRouter(prefix="/api", tags=["Leads"])

@router.get("/leads")
async def list_leads(
    status: Optional[str] = None,
    assigned_to: Optional[str] = None,
    search: Optional[str] = None,
    last_call_outcome: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    query = {}
    
    if current_user["role"] == "telecaller":
        query["assigned_to"] = current_user["id"]
    elif assigned_to:
        if assigned_to == "unassigned":
            query["assigned_to"] = None
        else:
            query["assigned_to"] = assigned_to
    
    if status:
        query["status"] = status
    
    if last_call_outcome:
        query["last_call_outcome"] = last_call_outcome
    
    if search:
        # Normalize search term for phone numbers (remove non-digits for phone search)
        normalized_search = ''.join(filter(str.isdigit, search))
        # Take last 10 digits for phone matching
        if len(normalized_search) > 10:
            normalized_search = normalized_search[-10:]
        
        # Build search conditions - case insensitive partial match on name/email
        # For phone, also try normalized version
        search_conditions = [
            {"name": {"$regex": search, "$options": "i"}},
            {"email": {"$regex": search, "$options": "i"}}
        ]
        
        # Add phone search with original search term
        search_conditions.append({"phone": {"$regex": search, "$options": "i"}})
        
        # If normalized search has digits, also search by phone ending with those digits
        # Use end-anchor ($) to avoid false positives with phones that contain the digits elsewhere
        if normalized_search and len(normalized_search) >= 3:
            search_conditions.append({"phone": {"$regex": normalized_search + "$", "$options": "i"}})
        
        query["$or"] = search_conditions
    
    leads = await db.leads.find(query).sort("created_at", -1).to_list(1000)
    
    if current_user["role"] == "admin":
        for lead in leads:
            if lead.get("assigned_to"):
                telecaller = await db.users.find_one({"_id": ObjectId(lead["assigned_to"])})
                if telecaller:
                    lead["telecaller_name"] = telecaller.get("name", "Unknown")
                    lead["telecaller_email"] = telecaller.get("email", "")
                    lead["telecaller_phone"] = telecaller.get("phone", "")
    
    return serialize_docs(leads)

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
