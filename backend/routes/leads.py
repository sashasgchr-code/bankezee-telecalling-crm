"""
Lead management routes - Enhanced with pagination, filters, suppression, archive, export
"""
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from fastapi.responses import StreamingResponse
from datetime import datetime, timezone, timedelta
from typing import Optional, List
from bson import ObjectId
import pandas as pd
import io
import re
import uuid

from models.schemas import LeadCreate, LeadUpdate, LeadAssign, AutoDistribute, BulkDeleteRequest, BulkOperationByFilter, BulkAssignByFilter, BulkArchiveRequest, SuppressionEntry
from utils.database import db
from utils.auth import get_current_user, require_admin, require_not_hr
from utils.helpers import serialize_doc, serialize_docs

router = APIRouter(prefix="/api", tags=["Leads"])

# Call outcome normalization map - maps variants to standard values
CALL_OUTCOME_NORMALIZATION = {
    # Connected variants
    "connected": "connected",
    "connect": "connected",
    "answered": "connected",
    "call_connected": "connected",
    # No Answer variants
    "no_answer": "no_answer",
    "noanswer": "no_answer",
    "not_answering": "no_answer",
    "not answering": "no_answer",
    "no answer": "no_answer",
    "unanswered": "no_answer",
    "ring_no_answer": "no_answer",
    "rna": "no_answer",
    # Switched Off variants
    "switched_off": "switched_off",
    "switchedoff": "switched_off",
    "switched off": "switched_off",
    "switch off": "switched_off",
    "switch_off": "switched_off",
    "phone switched off": "switched_off",
    "phone off": "switched_off",
    "unreachable": "switched_off",
    "not reachable": "switched_off",
    "not_reachable": "switched_off",
    # Busy variants
    "busy": "busy",
    "line_busy": "busy",
    "user_busy": "busy",
    "engaged": "busy",
    # Not Connecting variants
    "not_connecting": "not_connecting",
    "not connecting": "not_connecting",
    "network_error": "not_connecting",
    "call_failed": "not_connecting",
    "failed": "not_connecting",
    # Wrong Number variants
    "wrong_number": "wrong_number",
    "wrong number": "wrong_number",
    "invalid_number": "wrong_number",
    "invalid": "wrong_number",
    "not_in_service": "wrong_number",
    # Voicemail variants
    "voicemail": "voicemail",
    "voice_mail": "voicemail",
    "mailbox": "voicemail",
    "vm": "voicemail",
}

def normalize_call_outcome(outcome: str) -> str:
    """Normalize call outcome to standard value"""
    if not outcome:
        return None
    normalized = outcome.lower().strip()
    return CALL_OUTCOME_NORMALIZATION.get(normalized, outcome)

# Phone number normalization helper
def normalize_phone(phone: str) -> str:
    """Normalize phone number to last 10 digits for Indian numbers"""
    if not phone:
        return ""
    digits = re.sub(r'\D', '', str(phone))
    if len(digits) > 10:
        return digits[-10:]
    return digits

def build_leads_query(
    current_user: dict,
    status: Optional[str] = None,
    statuses: Optional[str] = None,
    assigned_to: Optional[str] = None,
    search: Optional[str] = None,
    last_call_outcome: Optional[str] = None,
    outcomes: Optional[str] = None,
    source: Optional[str] = None,
    created_from: Optional[str] = None,
    created_to: Optional[str] = None,
    last_called_from: Optional[str] = None,
    last_called_to: Optional[str] = None,
    never_called: Optional[bool] = None,
    archived: Optional[bool] = None,
    is_invalid: Optional[bool] = None,
    import_batch_id: Optional[str] = None,
    team_view: Optional[bool] = None,
    team_ids: Optional[list] = None
) -> dict:
    """Build MongoDB query from filter parameters - reusable across endpoints"""
    query = {}
    
    # Role-based access control
    # If team_view is True and user is TL, show team's data instead of just own
    if team_view and team_ids:
        # Team Lead viewing their team's data
        query["assigned_to"] = {"$in": team_ids}
    elif current_user["role"] == "telecaller":
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
            # Handle special filter for leads without status
            if "unset" in status_list or "none" in status_list or "no_status" in status_list:
                # Include leads with null/empty status
                status_list = [s for s in status_list if s not in ("unset", "none", "no_status")]
                status_condition = None
                if status_list:
                    status_condition = {"$or": [
                        {"status": {"$in": status_list}},
                        {"status": {"$exists": False}},
                        {"status": None},
                        {"status": ""}
                    ]}
                else:
                    status_condition = {"$or": [
                        {"status": {"$exists": False}},
                        {"status": None},
                        {"status": ""}
                    ]}
                # Add to $and array to avoid conflicts
                if "$and" not in query:
                    query["$and"] = []
                query["$and"].append(status_condition)
            else:
                query["status"] = {"$in": status_list}
    elif status:
        if status in ("unset", "none", "no_status"):
            status_condition = {"$or": [
                {"status": {"$exists": False}},
                {"status": None},
                {"status": ""}
            ]}
            if "$and" not in query:
                query["$and"] = []
            query["$and"].append(status_condition)
        else:
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
        # Use $and to properly combine with other $or conditions
        if "$and" not in query:
            query["$and"] = []
        query["$and"].append({"$or": [{"archived": {"$exists": False}}, {"archived": False}]})
    
    # Invalid/suppressed filter
    if is_invalid is True:
        query["is_invalid"] = True
    elif is_invalid is False or is_invalid is None:
        # Default: exclude invalid leads from normal views
        if "$and" not in query:
            query["$and"] = []
        query["$and"].append({"$or": [{"is_invalid": {"$exists": False}}, {"is_invalid": False}]})
    
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
    
    return query

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
    # Team view for TLs
    team_view: Optional[str] = None,
    # Sorting
    sort_by: str = Query("created_at", description="Field to sort by"),
    sort_order: str = Query("desc", description="asc or desc"),
    current_user: dict = Depends(require_not_hr)  # HR cannot access leads
):
    """
    List leads with server-side pagination and enhanced filtering.
    Returns paginated results with total count for "X matching leads" display.
    
    If team_view=true and user is a TL (is_tl=True), returns team's leads instead of own.
    """
    # Check if team_view is requested and user is a TL
    team_ids = None
    is_team_view = team_view == 'true' and current_user.get("is_tl", False)
    
    if is_team_view:
        # Get team member IDs for this TL
        team_members = await db.users.find(
            {"tl_id": current_user["id"], "is_active": True},
            {"_id": 0, "id": 1}
        ).to_list(100)
        team_ids = [m["id"] for m in team_members if m.get("id")]
    
    query = build_leads_query(
        current_user=current_user,
        status=status,
        statuses=statuses,
        assigned_to=assigned_to,
        search=search,
        last_call_outcome=last_call_outcome,
        outcomes=outcomes,
        source=source,
        created_from=created_from,
        created_to=created_to,
        last_called_from=last_called_from,
        last_called_to=last_called_to,
        never_called=never_called,
        archived=archived,
        is_invalid=is_invalid,
        import_batch_id=import_batch_id,
        team_view=is_team_view,
        team_ids=team_ids
    )
    
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
                try:
                    # Try ObjectId first, then string match
                    telecaller = None
                    assigned_id = lead["assigned_to"]
                    if len(assigned_id) == 24:
                        telecaller = await db.users.find_one({"_id": ObjectId(assigned_id)})
                    if not telecaller:
                        # Try matching by connect_id (UUID format)
                        telecaller = await db.users.find_one({"connect_id": assigned_id})
                    if telecaller:
                        lead["telecaller_name"] = telecaller.get("name", "Unknown")
                        lead["telecaller_email"] = telecaller.get("email", "")
                except Exception:
                    pass  # Skip if user lookup fails
    
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
        status_list = [s.strip() for s in statuses.split(",") if s.strip()]
        # Handle special filter for leads without status
        if "unset" in status_list or "none" in status_list or "no_status" in status_list:
            status_list = [s for s in status_list if s not in ("unset", "none", "no_status")]
            if status_list:
                query["$or"] = [
                    {"status": {"$in": status_list}},
                    {"status": {"$exists": False}},
                    {"status": None},
                    {"status": ""}
                ]
            else:
                query["$or"] = [
                    {"status": {"$exists": False}},
                    {"status": None},
                    {"status": ""}
                ]
        else:
            query["status"] = {"$in": status_list}
    elif status:
        if status in ("unset", "none", "no_status"):
            query["$or"] = [
                {"status": {"$exists": False}},
                {"status": None},
                {"status": ""}
            ]
        else:
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
async def get_leads_stats(
    assigned_to: Optional[str] = None,
    search: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """
    Get lead statistics for dashboard.
    Uses the SAME query logic as the leads list to ensure count consistency.
    Counts shown in badges MUST match the records returned when that filter is applied.
    """
    # Build base query using the same function as list endpoint
    base_query = build_leads_query(
        current_user=current_user,
        assigned_to=assigned_to,
        search=search,
        archived=False,
        is_invalid=False
    )
    
    pipeline = [
        {"$match": base_query},
        {"$facet": {
            "by_status": [
                {"$group": {"_id": "$status", "count": {"$sum": 1}}}
            ],
            "by_outcome": [
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
    
    # Process by_status to include "no_status" for null/empty statuses
    by_status = {}
    no_status_count = 0
    for item in data.get("by_status", []):
        status_val = item["_id"]
        count = item["count"]
        if status_val is None or status_val == "" or status_val == "null":
            no_status_count += count
        else:
            by_status[status_val] = count
    
    # Add no_status count if there are any
    if no_status_count > 0:
        by_status["no_status"] = no_status_count
    
    # Process by_outcome - include null/empty as "never_called" if leads have no outcome
    by_outcome = {}
    never_called_count = 0
    for item in data.get("by_outcome", []):
        outcome_val = item["_id"]
        count = item["count"]
        if outcome_val is None or outcome_val == "" or outcome_val == "null":
            never_called_count += count
        else:
            by_outcome[outcome_val] = count
    
    # Add never_called to outcome counts
    if never_called_count > 0:
        by_outcome["never_called"] = never_called_count
    
    return {
        "by_status": by_status,
        "by_outcome": by_outcome,
        "totals": data.get("totals", [{}])[0] if data.get("totals") else {}
    }


@router.get("/leads/outcomes/distinct")
async def get_distinct_outcomes(current_user: dict = Depends(require_admin)):
    """
    Get all distinct raw call outcome values in the database.
    Useful for debugging and verifying outcome normalization.
    """
    # Get raw outcomes from leads
    lead_outcomes = await db.leads.distinct("last_call_outcome")
    
    # Get raw outcomes from call_logs
    log_outcomes = await db.call_logs.distinct("call_outcome")
    
    # Combine and count
    all_outcomes = set()
    if lead_outcomes:
        all_outcomes.update([o for o in lead_outcomes if o])
    if log_outcomes:
        all_outcomes.update([o for o in log_outcomes if o])
    
    # Build result with counts and normalized values
    result = []
    for outcome in sorted(all_outcomes):
        lead_count = await db.leads.count_documents({"last_call_outcome": outcome})
        log_count = await db.call_logs.count_documents({"call_outcome": outcome})
        normalized = normalize_call_outcome(outcome)
        result.append({
            "raw_value": outcome,
            "normalized": normalized,
            "lead_count": lead_count,
            "call_log_count": log_count,
            "is_mapped": normalized != outcome
        })
    
    # Also get count of null/empty outcomes
    null_leads = await db.leads.count_documents({
        "$or": [
            {"last_call_outcome": None},
            {"last_call_outcome": ""},
            {"last_call_outcome": {"$exists": False}}
        ]
    })
    
    return {
        "outcomes": result,
        "null_or_empty_leads": null_leads,
        "total_distinct_raw": len(result),
        "normalization_map": CALL_OUTCOME_NORMALIZATION
    }


@router.get("/leads/unassigned")
async def list_unassigned_leads(current_user: dict = Depends(require_admin)):
    leads = await db.leads.find({"assigned_to": None}).sort("created_at", -1).to_list(1000)
    return serialize_docs(leads)

@router.get("/leads/{lead_id}")
async def get_lead(lead_id: str, current_user: dict = Depends(get_current_user)):
    # Handle both ObjectId and UUID lead_ids
    lead = None
    try:
        if len(lead_id) == 24:  # Valid ObjectId format
            lead = await db.leads.find_one({"_id": ObjectId(lead_id)})
    except Exception:
        pass
    
    # Fallback to 'id' field lookup (for UUID-based lead ids)
    if not lead:
        lead = await db.leads.find_one({"id": lead_id})
    
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    
    if current_user["role"] == "telecaller" and lead.get("assigned_to") != current_user["id"]:
        raise HTTPException(status_code=403, detail="Access denied")
    
    lead_data = serialize_doc(lead)
    
    # Safely resolve telecaller/Growth Partner info - handle both ObjectId and UUID
    assigned_id = lead_data.get("assigned_to")
    if assigned_id:
        telecaller = None
        try:
            # First try by ObjectId if it's a valid 24-char hex string
            if isinstance(assigned_id, str) and len(assigned_id) == 24:
                telecaller = await db.users.find_one({"_id": ObjectId(assigned_id)})
            
            # Fallback to connect_id or id field (for UUID-based user ids)
            if not telecaller:
                telecaller = await db.users.find_one({"connect_id": assigned_id})
            if not telecaller:
                telecaller = await db.users.find_one({"id": assigned_id})
        except Exception:
            # If ObjectId parsing fails, try alternate lookups
            telecaller = await db.users.find_one({"connect_id": assigned_id})
            if not telecaller:
                telecaller = await db.users.find_one({"id": assigned_id})
        
        if telecaller:
            lead_data["telecaller_name"] = telecaller.get("name", "Unknown")
            lead_data["telecaller_email"] = telecaller.get("email", "")
            lead_data["telecaller_phone"] = telecaller.get("phone", "")
    
    return lead_data

@router.post("/leads")
async def create_lead(lead: LeadCreate, current_user: dict = Depends(require_admin)):
    import uuid
    lead_doc = {
        "id": str(uuid.uuid4()),  # Generate UUID for consistent referencing
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
    # Try to find by UUID first, then ObjectId
    lead = None
    try:
        lead = await db.leads.find_one({"id": lead_id})
    except Exception:
        pass
    
    if not lead:
        try:
            if len(lead_id) == 24:
                lead = await db.leads.find_one({"_id": ObjectId(lead_id)})
        except Exception:
            pass
    
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    
    if current_user["role"] == "telecaller" and lead.get("assigned_to") != current_user["id"]:
        raise HTTPException(status_code=403, detail="Access denied")
    
    update_data = {k: v for k, v in update.dict().items() if v is not None}
    update_data["updated_at"] = datetime.now(timezone.utc)
    
    # Check if status is being changed to "file" - trigger File creation/linking
    new_status = update_data.get("status")
    if new_status == "file" and lead.get("status") != "file":
        # ============ DATA → FILE PREFILL - OLD CRM PORT ============
        # When Connect Data becomes File, prefill ALL known information
        # This replaces the old separate Growth Partner Lead Application Form
        
        # Initialize file-specific fields
        update_data["file_status"] = "new"  # Initial file status
        update_data["file_assigned_to"] = lead.get("assigned_to") or current_user["id"]
        update_data["eligibilities"] = lead.get("eligibilities") or []
        
        # Get custom_fields for fallback lookup
        custom_fields = lead.get("custom_fields") or {}
        
        # Prefill file_details from ALL available Connect Data fields
        existing_file_details = lead.get("file_details") or lead.get("additional_data") or {}
        prefilled_details = {
            # Customer Details - from Connect Data
            "full_name": lead.get("name") or existing_file_details.get("full_name"),
            "mobile": lead.get("phone") or existing_file_details.get("mobile"),
            "email": lead.get("email") or existing_file_details.get("email"),
            "city": lead.get("city") or existing_file_details.get("city"),
            "source": lead.get("source") or existing_file_details.get("source"),
            
            # Loan Requirement - from Connect Data (with custom_fields fallback)
            "type_of_loan": lead.get("requirement") or custom_fields.get("requirement") or existing_file_details.get("type_of_loan"),
            "loan_amount_required": existing_file_details.get("loan_amount_required"),
            
            # Employment - from Connect Data (with custom_fields fallback)
            "employment_type": lead.get("employment_type") or custom_fields.get("employment_type") or existing_file_details.get("employment_type"),
            "company_name": existing_file_details.get("company_name"),
            "net_salary": existing_file_details.get("net_salary"),
            "gross_salary": existing_file_details.get("gross_salary"),
            
            # Credit Info - from Connect Data
            "cibil_score": existing_file_details.get("cibil_score"),
            
            # Preserve any other existing file_details
            **{k: v for k, v in existing_file_details.items() if v is not None}
        }
        
        # Filter out None values
        prefilled_details = {k: v for k, v in prefilled_details.items() if v is not None}
        update_data["file_details"] = prefilled_details
        
        # Track source system for historical/new file identification
        if not lead.get("source_system"):
            update_data["source_system"] = "connect"  # New files from Connect
        
        # Preserve connect_customer_id for tracking
        update_data["connect_customer_id"] = lead_id
        
        # Link to source Growth Partner
        update_data["source_id"] = lead.get("assigned_to") or lead.get("source_id") or current_user["id"]
        update_data["source_name"] = lead.get("telecaller_name") or lead.get("source_name") or current_user.get("name", "Unknown")
        
        update_data["file_activities"] = [{
            "type": "file_created",
            "message": "Lead converted to File - Application form opened for completion",
            "by": current_user["id"],
            "by_name": current_user.get("name", "Unknown"),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "prefilled_fields": list(prefilled_details.keys())
        }]
        
        # Create activity log
        activity = {
            "lead_id": lead_id,
            "type": "status_change",
            "from_status": lead.get("status"),
            "to_status": "file",
            "performed_by": current_user["id"],
            "performed_by_name": current_user.get("name", "Unknown"),
            "timestamp": datetime.now(timezone.utc),
            "notes": f"Customer converted to File. Prefilled: {', '.join(prefilled_details.keys())}"
        }
        await db.activities.insert_one(activity)
    
    if current_user["role"] == "telecaller":
        today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
        await db.daily_sessions.update_one(
            {"user_id": current_user["id"], "date": today},
            {"$inc": {"leads_updated": 1}}
        )
    
    # Use the correct filter based on what we found
    filter_query = {"_id": lead["_id"]}
    
    await db.leads.update_one(
        filter_query,
        {"$set": update_data}
    )
    
    lead = await db.leads.find_one(filter_query)
    return serialize_doc(lead)


async def ensure_file_for_lead(lead_id: str, lead: dict, current_user: dict):
    """
    Create or link a File record when a lead's status becomes 'file'.
    This is idempotent - if a File already exists for this lead, return it.
    """
    # Check if File already exists for this lead
    existing_file = await db.leads.find_one({
        "_id": ObjectId(lead_id),
        "file_id": {"$exists": True, "$ne": None}
    })
    
    if existing_file and existing_file.get("file_id"):
        # Return existing File
        file_record = await db.leads.find_one({"_id": ObjectId(existing_file["file_id"])})
        if file_record:
            return file_record
    
    # Also check if there's already a File record with this lead's phone number
    phone = normalize_phone(lead.get("phone", ""))
    if phone:
        existing_by_phone = await db.leads.find_one({
            "status": "file",
            "phone": {"$regex": phone + "$"},
            "_id": {"$ne": ObjectId(lead_id)}
        })
        if existing_by_phone:
            # Link to existing file record
            return existing_by_phone
    
    # Create activity log for file conversion
    activity = {
        "lead_id": lead_id,
        "type": "status_change",
        "from_status": lead.get("status"),
        "to_status": "file",
        "performed_by": current_user["id"],
        "performed_by_name": current_user.get("name", "Unknown"),
        "timestamp": datetime.now(timezone.utc),
        "notes": "Customer converted to File"
    }
    await db.activities.insert_one(activity)
    
    # The lead itself becomes the File record (same collection, status='file')
    # No separate file collection needed - this maintains single source of truth
    return lead


# ===================== CANONICAL DATA → FILE CONVERSION =====================

@router.post("/leads/{lead_id}/convert-to-file")
async def convert_lead_to_file(lead_id: str, current_user: dict = Depends(get_current_user)):
    """
    CANONICAL Data → File Conversion Endpoint
    
    This is the SINGLE point of truth for converting a Data lead to a File.
    Both post-call modal and manual status edit MUST use this endpoint.
    
    IDEMPOTENT: If File already exists for this lead, returns the existing File.
    
    Steps:
    1. Check if lead already has status='file' → return existing file_id
    2. If not a File yet → convert lead to File with prefilled data
    3. Preserve connect_customer_id, source_id (originating GP)
    4. Create activity history
    5. Return file_id for frontend redirect
    
    Returns:
    - file_id: ID of the File record
    - is_new: True if newly converted, False if already existed
    - redirect_url: Frontend URL to redirect to
    """
    # Find lead by UUID or ObjectId
    lead = None
    try:
        lead = await db.leads.find_one({"id": lead_id})
    except Exception:
        pass
    
    if not lead:
        try:
            if len(lead_id) == 24:
                lead = await db.leads.find_one({"_id": ObjectId(lead_id)})
        except Exception:
            pass
    
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    
    # RBAC: GP can only convert leads assigned to them
    if current_user["role"] == "telecaller" and lead.get("assigned_to") != current_user["id"]:
        raise HTTPException(status_code=403, detail="Access denied")
    
    # Get the canonical ID
    file_id = lead.get("id") or str(lead["_id"])
    
    # IDEMPOTENT CHECK: If already a File, return it immediately
    if lead.get("status") == "file":
        return {
            "file_id": file_id,
            "is_new": False,
            "redirect_url": f"/files/{file_id}",
            "message": "File already exists"
        }
    
    # ============ DATA → FILE PREFILL - OLD CRM PORT ============
    custom_fields = lead.get("custom_fields") or {}
    existing_file_details = lead.get("file_details") or lead.get("additional_data") or {}
    
    # Prefill all known information
    prefilled_details = {
        # Customer Details - from Connect Data
        "full_name": lead.get("name") or existing_file_details.get("full_name"),
        "mobile": lead.get("phone") or existing_file_details.get("mobile"),
        "email": lead.get("email") or existing_file_details.get("email"),
        "city": lead.get("city") or existing_file_details.get("city"),
        "source": lead.get("source") or existing_file_details.get("source"),
        
        # Loan Requirement
        "type_of_loan": lead.get("requirement") or custom_fields.get("requirement") or existing_file_details.get("type_of_loan"),
        "loan_amount_required": existing_file_details.get("loan_amount_required"),
        
        # Employment
        "employment_type": lead.get("employment_type") or custom_fields.get("employment_type") or existing_file_details.get("employment_type"),
        "company_name": existing_file_details.get("company_name"),
        "net_salary": existing_file_details.get("net_salary"),
        "gross_salary": existing_file_details.get("gross_salary"),
        
        # Credit Info
        "cibil_score": existing_file_details.get("cibil_score"),
        
        # Preserve any other existing file_details
        **{k: v for k, v in existing_file_details.items() if v is not None}
    }
    
    # Filter out None values
    prefilled_details = {k: v for k, v in prefilled_details.items() if v is not None}
    
    # Determine source GP (the GP who originally worked this lead)
    source_id = lead.get("assigned_to") or lead.get("source_id") or current_user["id"]
    
    # Get source GP name
    source_name = lead.get("telecaller_name") or lead.get("source_name")
    if not source_name and source_id:
        try:
            source_user = await db.users.find_one({"id": source_id}, {"_id": 0, "name": 1, "full_name": 1})
            if source_user:
                source_name = source_user.get("full_name") or source_user.get("name", "Unknown")
            else:
                source_name = current_user.get("name", "Unknown")
        except Exception:
            source_name = current_user.get("name", "Unknown")
    
    # Build update payload
    update_data = {
        "status": "file",
        "file_status": "new",
        "file_assigned_to": source_id,  # Initially assigned to the GP who converted
        "eligibilities": lead.get("eligibilities") or [],
        "file_details": prefilled_details,
        "connect_customer_id": file_id,  # Link back to this record
        "source_id": source_id,  # Originating GP
        "source_name": source_name,
        "source_system": "connect",  # New files from Connect
        "file_activities": [{
            "type": "file_created",
            "message": f"Lead converted to File by {current_user.get('name', 'Unknown')}",
            "by": current_user["id"],
            "by_name": current_user.get("name", "Unknown"),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "prefilled_fields": list(prefilled_details.keys())
        }],
        "updated_at": datetime.now(timezone.utc)
    }
    
    # Merge with existing activities if any
    existing_activities = lead.get("file_activities") or []
    if existing_activities:
        update_data["file_activities"] = existing_activities + update_data["file_activities"]
    
    # Perform the conversion
    await db.leads.update_one(
        {"_id": lead["_id"]},
        {"$set": update_data}
    )
    
    # Create activity log entry
    activity = {
        "lead_id": file_id,
        "type": "status_change",
        "from_status": lead.get("status"),
        "to_status": "file",
        "performed_by": current_user["id"],
        "performed_by_name": current_user.get("name", "Unknown"),
        "timestamp": datetime.now(timezone.utc),
        "notes": f"Customer converted to File. Prefilled: {', '.join(prefilled_details.keys())}"
    }
    await db.activities.insert_one(activity)
    
    # Track GP's conversion count
    today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    await db.daily_sessions.update_one(
        {"user_id": current_user["id"], "date": today},
        {"$inc": {"files_created": 1}},
        upsert=True
    )
    
    return {
        "file_id": file_id,
        "is_new": True,
        "redirect_url": f"/files/{file_id}",
        "message": "Lead converted to File successfully",
        "prefilled_fields": list(prefilled_details.keys())
    }


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
    """
    Import leads from CSV/Excel file.
    - Checks suppression list and skips suppressed numbers
    - Tracks import batch for history
    - Normalizes phone numbers
    """
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
        
        # Generate import batch ID
        batch_id = str(uuid.uuid4())
        
        # Get suppression list for checking
        suppressed_phones = set()
        suppression_cursor = db.suppression_list.find({}, {"normalized_phone": 1})
        async for entry in suppression_cursor:
            suppressed_phones.add(entry.get("normalized_phone", ""))
        
        telecallers = await db.users.find({"role": "telecaller", "is_active": True}).to_list(1000)
        telecaller_map = {}
        for tc in telecallers:
            telecaller_map[tc["name"].lower().strip()] = tc
            telecaller_map[tc["email"].lower().strip()] = tc
        
        leads_to_insert = []
        assigned_count = 0
        unassigned_count = 0
        suppressed_count = 0
        duplicate_count = 0
        unassigned_telecallers = set()
        suppressed_numbers = []
        
        # Get existing phone numbers for duplicate detection
        existing_phones = set()
        existing_cursor = db.leads.find(
            {"$or": [{"archived": {"$exists": False}}, {"archived": False}]},
            {"normalized_phone": 1, "phone": 1}
        )
        async for lead in existing_cursor:
            if lead.get("normalized_phone"):
                existing_phones.add(lead["normalized_phone"])
            elif lead.get("phone"):
                existing_phones.add(normalize_phone(lead["phone"]))
        
        for _, row in df.iterrows():
            phone = str(row.get('phone', '')).strip()
            if not phone:
                continue
            
            name = str(row.get('name', '')).strip()
            if not name:
                continue
            
            # Normalize phone for checking
            normalized = normalize_phone(phone)
            
            # Check suppression list
            if normalized in suppressed_phones:
                suppressed_count += 1
                suppressed_numbers.append(phone)
                continue
            
            # Check for duplicates
            if normalized in existing_phones:
                duplicate_count += 1
                continue
            
            # Add to existing phones to prevent duplicates within this import
            existing_phones.add(normalized)
            
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
                "normalized_phone": normalized,
                "email": str(row.get('email', '')).strip() if pd.notna(row.get('email')) else None,
                "source": str(row.get('source', '')).strip() if pd.notna(row.get('source')) else None,
                "city": str(row.get('city', '')).strip() if pd.notna(row.get('city')) else None,
                "status": str(row.get('status', 'new')).strip().lower() or "new",
                "notes": str(row.get('notes', '')).strip() if pd.notna(row.get('notes')) else None,
                "custom_fields": {},
                "assigned_to": assigned_to,
                "telecaller_name": telecaller_name,
                "import_batch_id": batch_id,
                "created_at": datetime.now(timezone.utc),
                "updated_at": datetime.now(timezone.utc),
                "created_by": current_user["id"]
            }
            
            standard_fields = ['name', 'phone', 'email', 'source', 'city', 'status', 'notes', 'telecaller']
            for col in df.columns:
                if col not in standard_fields and pd.notna(row.get(col)):
                    lead_doc["custom_fields"][col] = str(row.get(col))
            
            leads_to_insert.append(lead_doc)
        
        total_imported = 0
        if leads_to_insert:
            result = await db.leads.insert_many(leads_to_insert)
            total_imported = len(result.inserted_ids)
        
        # Create import batch record
        batch_doc = {
            "batch_id": batch_id,
            "filename": file.filename,
            "total_rows": len(df),
            "total_imported": total_imported,
            "assigned_count": assigned_count,
            "unassigned_count": unassigned_count,
            "suppressed_count": suppressed_count,
            "duplicate_count": duplicate_count,
            "suppressed_numbers": suppressed_numbers[:100],  # Store first 100 for reference
            "imported_by": current_user["id"],
            "imported_at": datetime.now(timezone.utc)
        }
        await db.import_batches.insert_one(batch_doc)
        
        # Build response message
        message_parts = [f"Successfully imported {total_imported} leads"]
        if assigned_count > 0:
            message_parts.append(f"{assigned_count} assigned to telecallers")
        if suppressed_count > 0:
            message_parts.append(f"{suppressed_count} skipped (suppressed)")
        if duplicate_count > 0:
            message_parts.append(f"{duplicate_count} skipped (duplicates)")
        if unassigned_count > 0:
            message_parts.append(f"{unassigned_count} could not be assigned")
        
        return {
            "message": ". ".join(message_parts),
            "batch_id": batch_id,
            "total_imported": total_imported,
            "assigned": assigned_count,
            "unassigned": unassigned_count,
            "suppressed": suppressed_count,
            "duplicates": duplicate_count,
            "unassigned_telecallers": list(unassigned_telecallers)
        }
    
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error processing file: {str(e)}")

@router.post("/leads/assign")
async def assign_leads(assignment: LeadAssign, current_user: dict = Depends(require_admin)):
    """
    Assign leads to a user with CLEAN SLATE logic:
    - CRITICAL: Files (status='file') CANNOT be reassigned - server-side enforcement
    - Pre-File leads reset to 'new' for the new assignee (clean slate)
    - Preserves old Growth Partner's call history and reports (call logs stay intact)
    - Marks call_logs as 'previous_agent' so new Growth Partner sees clean slate
    - Records assignment history for audit trail
    - Historical reports remain immutable - activity ownership is preserved
    """
    user = await db.users.find_one({"_id": ObjectId(assignment.user_id)})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    now = datetime.now(timezone.utc)
    
    # Handle both ObjectId and UUID lead_ids
    # Try to find leads by 'id' field (UUID) first, then by '_id' (ObjectId)
    leads = []
    for lid in assignment.lead_ids:
        # First try by UUID 'id' field
        lead = await db.leads.find_one({"id": lid})
        if not lead:
            # Try by ObjectId '_id' field
            try:
                lead = await db.leads.find_one({"_id": ObjectId(lid)})
            except Exception:
                pass
        if lead:
            leads.append(lead)
    
    reassignment_count = 0
    skipped_files = []  # Track Files that cannot be reassigned
    assigned_leads = []  # Track successfully assigned leads
    
    for lead in leads:
        lead_id = str(lead["_id"])
        current_status = lead.get("status", "new")
        
        # CRITICAL: FILE REASSIGNMENT BLOCK
        # Files (status='file') CANNOT be reassigned to another Growth Partner
        if current_status == "file":
            skipped_files.append({
                "id": lead_id,
                "name": lead.get("name", "Unknown"),
                "reason": "Files cannot be reassigned. File ownership is locked to the Growth Partner who converted the customer."
            })
            continue
        
        old_assignee = lead.get("assigned_to")
        previous_status = current_status
        previous_outcome = lead.get("last_call_outcome")
        
        # If lead was previously assigned to someone else, preserve history
        if old_assignee and old_assignee != assignment.user_id:
            reassignment_count += 1
            
            # Mark existing call logs as 'previous_agent_history' for this lead
            # This preserves the old Growth Partner's reports but hides from new Growth Partner
            # IMPORTANT: This does NOT delete history - it just marks it for filtering
            await db.call_logs.update_many(
                {"lead_id": lead_id, "user_id": old_assignee},
                {"$set": {"is_previous_agent_history": True}}
            )
            
            # Record reassignment in history for audit trail
            # This ensures historical reports can always be reconstructed
            await db.lead_assignment_history.insert_one({
                "lead_id": lead_id,
                "from_user_id": old_assignee,
                "to_user_id": assignment.user_id,
                "from_user_name": lead.get("telecaller_name", "Unknown"),
                "to_user_name": user["name"],
                "previous_status": previous_status,
                "previous_outcome": previous_outcome,
                "reassigned_by": current_user["id"],
                "reassigned_by_name": current_user.get("name", "Admin"),
                "reassigned_at": now,
                "reason": "Admin reassignment"
            })
        
        # CLEAN SLATE: New Growth Partner sees this as NEW data
        # Previous Growth Partner's activities/history remain intact in database
        # Only the working state is reset for the new Growth Partner
        await db.leads.update_one(
            {"_id": lead["_id"]},
            {
                "$set": {
                    "assigned_to": assignment.user_id,
                    "telecaller_name": user["name"],
                    "status": "new",  # CLEAN SLATE: Reset to new for new GP
                    "last_call_outcome": None,  # CLEAN SLATE: Clear outcome for new GP
                    "reassigned_at": now,
                    "reassigned_from_status": previous_status,  # Store actual previous status for reference
                    "reassigned_from_user": old_assignee,  # Store previous GP for audit
                    "updated_at": now
                }
            }
        )
        assigned_leads.append(lead_id)
    
    # Build response message
    message_parts = []
    if assigned_leads:
        message_parts.append(f"Assigned {len(assigned_leads)} leads to {user['name']}")
        if reassignment_count > 0:
            message_parts.append(f"({reassignment_count} reassigned with clean slate)")
    
    if skipped_files:
        message_parts.append(f"Skipped {len(skipped_files)} Files (Files cannot be reassigned)")
    
    message = " ".join(message_parts) if message_parts else "No leads were assigned"
    
    return {
        "message": message,
        "assigned_count": len(assigned_leads),
        "reassigned_count": reassignment_count,
        "skipped_files": skipped_files,
        "skipped_count": len(skipped_files)
    }

@router.post("/leads/auto-distribute")
async def auto_distribute_leads(data: AutoDistribute, current_user: dict = Depends(require_admin)):
    """
    Auto-distribute leads equally among active Growth Partners.
    CRITICAL: Files (status='file') are excluded from distribution - they cannot be reassigned.
    """
    telecallers = await db.users.find({
        "role": "telecaller",
        "is_active": True
    }).to_list(100)
    
    if not telecallers:
        raise HTTPException(status_code=400, detail="No active Growth Partners found")
    
    lead_ids = data.lead_ids
    num_telecallers = len(telecallers)
    
    # Fetch all leads to check their status - handle both UUID and ObjectId
    leads = []
    for lid in lead_ids:
        lead = await db.leads.find_one({"id": lid})
        if not lead:
            try:
                lead = await db.leads.find_one({"_id": ObjectId(lid)})
            except Exception:
                pass
        if lead:
            leads.append(lead)
    
    assigned_count = 0
    skipped_files = []
    now = datetime.now(timezone.utc)
    
    # Filter out Files and distribute only eligible leads
    eligible_leads = []
    for lead in leads:
        if lead.get("status") == "file":
            skipped_files.append({
                "id": str(lead["_id"]),
                "name": lead.get("name", "Unknown"),
                "reason": "Files cannot be reassigned"
            })
        else:
            eligible_leads.append(lead)
    
    for i, lead in enumerate(eligible_leads):
        telecaller_index = i % num_telecallers
        telecaller = telecallers[telecaller_index]
        
        old_assignee = lead.get("assigned_to")
        
        # Record assignment history if being reassigned
        if old_assignee and old_assignee != str(telecaller["_id"]):
            await db.lead_assignment_history.insert_one({
                "lead_id": str(lead["_id"]),
                "from_user_id": old_assignee,
                "to_user_id": str(telecaller["_id"]),
                "from_user_name": lead.get("telecaller_name", "Unknown"),
                "to_user_name": telecaller["name"],
                "previous_status": lead.get("status", "new"),
                "reassigned_by": current_user["id"],
                "reassigned_at": now,
                "reason": "Auto distribution"
            })
            
            # Mark previous call logs
            await db.call_logs.update_many(
                {"lead_id": str(lead["_id"]), "user_id": old_assignee},
                {"$set": {"is_previous_agent_history": True}}
            )
        
        # CLEAN SLATE for new Growth Partner
        await db.leads.update_one(
            {"_id": lead["_id"]},
            {
                "$set": {
                    "assigned_to": str(telecaller["_id"]),
                    "telecaller_name": telecaller["name"],
                    "status": "new" if old_assignee else lead.get("status", "new"),  # Reset only if reassigning
                    "last_call_outcome": None if old_assignee else lead.get("last_call_outcome"),
                    "updated_at": now
                }
            }
        )
        assigned_count += 1
    
    message = f"Distributed {assigned_count} leads among {num_telecallers} Growth Partners"
    if skipped_files:
        message += f". Skipped {len(skipped_files)} Files (cannot be reassigned)"
    
    return {
        "message": message,
        "assigned_count": assigned_count,
        "skipped_files": skipped_files,
        "skipped_count": len(skipped_files)
    }


# ===================== STAGE 2: BULK SELECT ALL =====================

@router.post("/leads/select-all-ids")
async def get_all_filtered_lead_ids(
    filters: BulkOperationByFilter,
    current_user: dict = Depends(get_current_user)
):
    """
    Get all lead IDs matching the current filters.
    Used for "Select all X matching leads" functionality.
    """
    query = build_leads_query(
        current_user=current_user,
        statuses=filters.statuses,
        assigned_to=filters.assigned_to,
        search=filters.search,
        outcomes=filters.outcomes,
        source=filters.source,
        created_from=filters.created_from,
        created_to=filters.created_to,
        last_called_from=filters.last_called_from,
        last_called_to=filters.last_called_to,
        never_called=filters.never_called,
        archived=filters.archived,
        is_invalid=filters.is_invalid,
        import_batch_id=filters.import_batch_id
    )
    
    # Get all IDs (projection to minimize data transfer)
    leads = await db.leads.find(query, {"_id": 1}).to_list(100000)
    lead_ids = [str(lead["_id"]) for lead in leads]
    
    return {
        "lead_ids": lead_ids,
        "count": len(lead_ids)
    }

@router.post("/leads/bulk-assign-filtered")
async def bulk_assign_by_filter(
    data: BulkAssignByFilter,
    current_user: dict = Depends(require_admin)
):
    """
    Assign all leads matching filter criteria to a user.
    More efficient than passing thousands of IDs.
    """
    user = await db.users.find_one({"_id": ObjectId(data.user_id)})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    query = build_leads_query(
        current_user=current_user,
        statuses=data.filters.statuses,
        assigned_to=data.filters.assigned_to,
        search=data.filters.search,
        outcomes=data.filters.outcomes,
        source=data.filters.source,
        created_from=data.filters.created_from,
        created_to=data.filters.created_to,
        last_called_from=data.filters.last_called_from,
        last_called_to=data.filters.last_called_to,
        never_called=data.filters.never_called,
        archived=data.filters.archived,
        is_invalid=data.filters.is_invalid,
        import_batch_id=data.filters.import_batch_id
    )
    
    result = await db.leads.update_many(
        query,
        {
            "$set": {
                "assigned_to": data.user_id,
                "telecaller_name": user["name"],
                "updated_at": datetime.now(timezone.utc)
            }
        }
    )
    
    return {
        "message": f"Assigned {result.modified_count} leads to {user['name']}",
        "modified_count": result.modified_count
    }


# ===================== STAGE 3: WRONG NUMBER SUPPRESSION =====================

@router.get("/suppression-list")
async def get_suppression_list(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=10, le=200),
    search: Optional[str] = None,
    current_user: dict = Depends(require_admin)
):
    """Get paginated suppression list"""
    query = {}
    if search:
        query["$or"] = [
            {"phone": {"$regex": search, "$options": "i"}},
            {"normalized_phone": {"$regex": search, "$options": "i"}},
            {"reason": {"$regex": search, "$options": "i"}}
        ]
    
    total = await db.suppression_list.count_documents(query)
    skip = (page - 1) * page_size
    
    entries = await db.suppression_list.find(query).sort("added_at", -1).skip(skip).limit(page_size).to_list(page_size)
    
    return {
        "entries": serialize_docs(entries),
        "pagination": {
            "page": page,
            "page_size": page_size,
            "total_count": total,
            "total_pages": (total + page_size - 1) // page_size
        }
    }

@router.post("/suppression-list")
async def add_to_suppression_list(
    entry: SuppressionEntry,
    current_user: dict = Depends(require_admin)
):
    """Manually add a phone to suppression list"""
    normalized = normalize_phone(entry.phone)
    
    # Check if already exists
    existing = await db.suppression_list.find_one({"normalized_phone": normalized})
    if existing:
        return {"message": "Phone already in suppression list", "already_exists": True}
    
    doc = {
        "phone": entry.phone,
        "normalized_phone": normalized,
        "reason": entry.reason,
        "notes": entry.notes,
        "added_by": current_user["id"],
        "added_at": datetime.now(timezone.utc)
    }
    
    await db.suppression_list.insert_one(doc)
    
    # Also mark any existing leads with this number as invalid
    await db.leads.update_many(
        {"$or": [
            {"phone": entry.phone},
            {"normalized_phone": normalized}
        ]},
        {
            "$set": {
                "is_invalid": True,
                "invalid_reason": entry.reason,
                "updated_at": datetime.now(timezone.utc)
            }
        }
    )
    
    return {"message": "Phone added to suppression list", "normalized_phone": normalized}

@router.delete("/suppression-list/{phone}")
async def remove_from_suppression_list(
    phone: str,
    current_user: dict = Depends(require_admin)
):
    """Remove a phone from suppression list"""
    normalized = normalize_phone(phone)
    result = await db.suppression_list.delete_one({"normalized_phone": normalized})
    
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Phone not found in suppression list")
    
    # Optionally restore leads (don't auto-restore, admin can manually unmark)
    return {"message": "Phone removed from suppression list"}

@router.post("/leads/{lead_id}/mark-wrong-number")
async def mark_lead_wrong_number(
    lead_id: str,
    notes: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """
    Mark a lead as wrong number - adds to suppression list and marks invalid.
    Called after selecting 'wrong_number' outcome.
    """
    lead = await db.leads.find_one({"_id": ObjectId(lead_id)})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    
    phone = lead.get("phone", "")
    normalized = normalize_phone(phone)
    
    # Add to suppression list if not exists
    existing = await db.suppression_list.find_one({"normalized_phone": normalized})
    if not existing:
        await db.suppression_list.insert_one({
            "phone": phone,
            "normalized_phone": normalized,
            "reason": "wrong_number",
            "notes": notes,
            "lead_id": lead_id,
            "added_by": current_user["id"],
            "added_at": datetime.now(timezone.utc)
        })
    
    # Mark lead as invalid
    await db.leads.update_one(
        {"_id": ObjectId(lead_id)},
        {
            "$set": {
                "is_invalid": True,
                "invalid_reason": "wrong_number",
                "updated_at": datetime.now(timezone.utc)
            }
        }
    )
    
    return {"message": "Lead marked as wrong number and phone added to suppression list"}


# ===================== STAGE 4: ARCHIVE & IMPORT MANAGEMENT =====================

@router.post("/leads/archive")
async def archive_leads(
    data: BulkArchiveRequest,
    current_user: dict = Depends(require_admin)
):
    """Archive or unarchive leads by IDs or filter"""
    if data.lead_ids:
        # Archive by explicit IDs
        object_ids = [ObjectId(lid) for lid in data.lead_ids]
        query = {"_id": {"$in": object_ids}}
    elif data.filters:
        # Archive by filter
        query = build_leads_query(
            current_user=current_user,
            statuses=data.filters.statuses,
            assigned_to=data.filters.assigned_to,
            search=data.filters.search,
            outcomes=data.filters.outcomes,
            source=data.filters.source,
            created_from=data.filters.created_from,
            created_to=data.filters.created_to,
            last_called_from=data.filters.last_called_from,
            last_called_to=data.filters.last_called_to,
            never_called=data.filters.never_called,
            archived=not data.archive,  # If archiving, filter non-archived; if unarchiving, filter archived
            is_invalid=data.filters.is_invalid,
            import_batch_id=data.filters.import_batch_id
        )
    else:
        raise HTTPException(status_code=400, detail="Provide lead_ids or filters")
    
    result = await db.leads.update_many(
        query,
        {
            "$set": {
                "archived": data.archive,
                "archived_at": datetime.now(timezone.utc) if data.archive else None,
                "archived_by": current_user["id"] if data.archive else None,
                "updated_at": datetime.now(timezone.utc)
            }
        }
    )
    
    action = "archived" if data.archive else "unarchived"
    return {"message": f"{result.modified_count} leads {action}", "modified_count": result.modified_count}

@router.get("/import-batches")
async def list_import_batches(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=10, le=100),
    current_user: dict = Depends(require_admin)
):
    """List all import batches with statistics"""
    total = await db.import_batches.count_documents({})
    skip = (page - 1) * page_size
    
    batches = await db.import_batches.find({}).sort("imported_at", -1).skip(skip).limit(page_size).to_list(page_size)
    
    return {
        "batches": serialize_docs(batches),
        "pagination": {
            "page": page,
            "page_size": page_size,
            "total_count": total,
            "total_pages": (total + page_size - 1) // page_size
        }
    }

@router.get("/import-batches/{batch_id}")
async def get_import_batch(
    batch_id: str,
    current_user: dict = Depends(require_admin)
):
    """Get details of a specific import batch"""
    batch = await db.import_batches.find_one({"_id": ObjectId(batch_id)})
    if not batch:
        raise HTTPException(status_code=404, detail="Import batch not found")
    
    # Get current count of leads from this batch
    lead_count = await db.leads.count_documents({"import_batch_id": batch_id})
    
    return {
        **serialize_doc(batch),
        "current_lead_count": lead_count
    }


# ===================== STAGE 5: EXCEL EXPORT =====================

@router.post("/leads/export")
async def export_leads(
    filters: BulkOperationByFilter,
    current_user: dict = Depends(get_current_user)
):
    """
    Export leads matching filters to Excel file.
    Returns a downloadable Excel file.
    """
    query = build_leads_query(
        current_user=current_user,
        statuses=filters.statuses,
        assigned_to=filters.assigned_to,
        search=filters.search,
        outcomes=filters.outcomes,
        source=filters.source,
        created_from=filters.created_from,
        created_to=filters.created_to,
        last_called_from=filters.last_called_from,
        last_called_to=filters.last_called_to,
        never_called=filters.never_called,
        archived=filters.archived,
        is_invalid=filters.is_invalid,
        import_batch_id=filters.import_batch_id
    )
    
    # Fetch all matching leads (limit to 50k for safety)
    leads = await db.leads.find(query).sort("created_at", -1).to_list(50000)
    
    if not leads:
        raise HTTPException(status_code=404, detail="No leads found matching filters")
    
    # Prepare data for export
    export_data = []
    for lead in leads:
        export_data.append({
            "Name": lead.get("name", ""),
            "Phone": lead.get("phone", ""),
            "Email": lead.get("email", ""),
            "City": lead.get("city", ""),
            "Source": lead.get("source", ""),
            "Status": lead.get("status", ""),
            "Last Call Outcome": lead.get("last_call_outcome", ""),
            "Telecaller": lead.get("telecaller_name", ""),
            "Notes": lead.get("notes", ""),
            "Created At": lead.get("created_at", "").isoformat() if lead.get("created_at") else "",
            "Last Called At": lead.get("last_call_at", "").isoformat() if lead.get("last_call_at") else "",
        })
    
    # Create DataFrame and Excel file
    df = pd.DataFrame(export_data)
    output = io.BytesIO()
    
    with pd.ExcelWriter(output, engine='openpyxl') as writer:
        df.to_excel(writer, index=False, sheet_name='Leads')
    
    output.seek(0)
    
    # Generate filename with timestamp
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    filename = f"leads_export_{timestamp}.xlsx"
    
    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


# ===================== UPDATED IMPORT WITH SUPPRESSION CHECK =====================




# ===================== FILE REASSIGNMENT CHECK =====================

@router.post("/leads/check-reassignment")
async def check_reassignment_eligibility(
    lead_ids: List[str],
    current_user: dict = Depends(require_admin)
):
    """
    Check which leads can be reassigned.
    CRITICAL BUSINESS RULE: Files (status='file') CANNOT be reassigned.
    
    Returns:
    - eligible: List of leads that can be reassigned
    - blocked: List of Files that cannot be reassigned
    """
    lead_object_ids = [ObjectId(lid) for lid in lead_ids]
    leads = await db.leads.find({"_id": {"$in": lead_object_ids}}).to_list(len(lead_ids))
    
    eligible = []
    blocked = []
    
    for lead in leads:
        lead_id = str(lead["_id"])
        lead_info = {
            "id": lead_id,
            "name": lead.get("name", "Unknown"),
            "phone": lead.get("phone", ""),
            "status": lead.get("status", "new"),
            "assigned_to": lead.get("assigned_to"),
            "telecaller_name": lead.get("telecaller_name", "")
        }
        
        if lead.get("status") == "file":
            lead_info["block_reason"] = "Files cannot be reassigned. File ownership is locked to the Growth Partner who converted the customer."
            blocked.append(lead_info)
        else:
            eligible.append(lead_info)
    
    return {
        "eligible_count": len(eligible),
        "blocked_count": len(blocked),
        "eligible": eligible,
        "blocked": blocked,
        "message": f"{len(eligible)} leads can be reassigned. {len(blocked)} Files are locked." if blocked else f"All {len(eligible)} leads can be reassigned."
    }


@router.get("/leads/{lead_id}/assignment-history")
async def get_lead_assignment_history(
    lead_id: str,
    current_user: dict = Depends(get_current_user)
):
    """
    Get the complete assignment history for a lead.
    Shows all reassignments with timestamps and previous status.
    IMPORTANT: This preserves the audit trail for historical reports.
    """
    history = await db.lead_assignment_history.find(
        {"lead_id": lead_id}
    ).sort("reassigned_at", -1).to_list(100)
    
    # Also get current assignment
    lead = await db.leads.find_one({"_id": ObjectId(lead_id)}, {"_id": 0, "assigned_to": 1, "telecaller_name": 1, "status": 1, "created_at": 1})
    
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    
    return {
        "current_assignment": {
            "assigned_to": lead.get("assigned_to"),
            "telecaller_name": lead.get("telecaller_name"),
            "status": lead.get("status"),
            "is_file": lead.get("status") == "file"
        },
        "history": [
            {
                "from_user_id": h.get("from_user_id"),
                "from_user_name": h.get("from_user_name"),
                "to_user_id": h.get("to_user_id"),
                "to_user_name": h.get("to_user_name"),
                "previous_status": h.get("previous_status"),
                "previous_outcome": h.get("previous_outcome"),
                "reassigned_at": h.get("reassigned_at").isoformat() if h.get("reassigned_at") else None,
                "reassigned_by": h.get("reassigned_by"),
                "reason": h.get("reason")
            }
            for h in history
        ],
        "total_reassignments": len(history)
    }
