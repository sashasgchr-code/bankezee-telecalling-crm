"""
Files CRM Routes - Integrated from BankEzee CRM
Handles file details, eligibilities, document management for leads with status='file'
"""
from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from pydantic import BaseModel
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorGridFSBucket
from dotenv import load_dotenv
from pathlib import Path
import os
import uuid
from datetime import datetime, timezone
from typing import Optional, List
import logging

ROOT_DIR = Path(__file__).parent.parent
load_dotenv(ROOT_DIR / '.env')

logger = logging.getLogger(__name__)

mongo_url = os.environ.get('MONGO_URL')
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ.get('DB_NAME', 'bankezee_connect')]

router = APIRouter(prefix="/api/files", tags=["Files CRM"])

# File storage - using MongoDB GridFS for persistence across deployments

ALLOWED_EXTENSIONS = {'.pdf', '.jpg', '.jpeg', '.png', '.gif', '.doc', '.docx', '.xls', '.xlsx'}
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB

# GridFS bucket for file storage
async def get_gridfs_bucket():
    return AsyncIOMotorGridFSBucket(db, bucket_name="file_documents")

# Helper to get current user from JWT
async def get_current_user_from_token(token: str):
    from routes.auth import get_current_user
    return await get_current_user(token)


class FileDetailsUpdate(BaseModel):
    full_name: Optional[str] = None
    mobile: Optional[str] = None
    email: Optional[str] = None
    city: Optional[str] = None
    employment_type: Optional[str] = None
    requirement: Optional[str] = None
    additional_data: Optional[dict] = None


class FileStatusUpdate(BaseModel):
    file_status: str


class NoteAdd(BaseModel):
    note: str


class EligibilityEntry(BaseModel):
    bank_name: str
    is_eligible: bool
    eligible_amount: Optional[float] = None
    eligible_tenure: Optional[int] = None
    not_eligible_reason: Optional[str] = None
    login_done: Optional[bool] = None
    login_bank: Optional[str] = None
    login_rejection_reason: Optional[str] = None
    approval_status: Optional[str] = None
    approved_bank: Optional[str] = None
    approved_amount: Optional[float] = None
    approved_tenure: Optional[int] = None
    approved_roi: Optional[float] = None
    declined_bank: Optional[str] = None
    declined_reason: Optional[str] = None
    disbursed: Optional[bool] = None
    disbursed_bank: Optional[str] = None
    disbursed_amount: Optional[float] = None
    disbursed_tenure: Optional[int] = None
    disbursed_roi: Optional[float] = None
    disbursement_rejection_reason: Optional[str] = None
    commission_percentage: Optional[float] = None
    commission_amount: Optional[float] = None


class EligibilityUpdate(BaseModel):
    eligibilities: List[EligibilityEntry]


class FileAssignment(BaseModel):
    assigned_to: str


class BulkFileAssignment(BaseModel):
    file_ids: List[str]
    assigned_to: str


# File statuses for CRM processing
FILE_STATUSES = [
    "new", "contacted", "documents_collected", "not_eligible", 
    "sent_to_bank", "login", "not_login", "approved", "declined",
    "disbursed", "not_disbursed", "rejected"
]


@router.get("/statuses")
async def get_file_statuses():
    """Get list of available file statuses for CRM processing"""
    return [
        {"id": "new", "label": "New"},
        {"id": "contacted", "label": "Contacted"},
        {"id": "documents_collected", "label": "Documents Collected"},
        {"id": "not_eligible", "label": "Not Eligible"},
        {"id": "sent_to_bank", "label": "Sent to Bank"},
        {"id": "login", "label": "Login"},
        {"id": "not_login", "label": "Not Login"},
        {"id": "approved", "label": "Approved"},
        {"id": "declined", "label": "Declined"},
        {"id": "disbursed", "label": "Disbursed"},
        {"id": "not_disbursed", "label": "Not Disbursed"},
        {"id": "rejected", "label": "Rejected"}
    ]


@router.get("/operations-team")
async def get_operations_team():
    """Get list of operations team members for assignment"""
    # In Connect, we'll use telecallers or a specific role
    ops_team = await db.users.find(
        {"role": {"$in": ["telecaller", "admin"]}},
        {"_id": 0, "id": 1, "full_name": 1, "name": 1, "email": 1}
    ).to_list(100)
    # Normalize name field
    for member in ops_team:
        if not member.get('full_name') and member.get('name'):
            member['full_name'] = member['name']
        elif not member.get('full_name'):
            member['full_name'] = member.get('email', '').split('@')[0]
    return ops_team


@router.get("")
@router.get("/")
async def get_all_files(
    file_status: Optional[str] = None,
    assigned_to: Optional[str] = None,
    page: int = 1,
    limit: int = 50
):
    """Get all leads with status='file' (Files Dashboard)"""
    query = {"status": "file"}
    
    if file_status:
        query["file_status"] = file_status
    if assigned_to:
        query["file_assigned_to"] = assigned_to
    
    skip = (page - 1) * limit
    
    files = await db.leads.find(query, {"_id": 0}).sort("updated_at", -1).skip(skip).limit(limit).to_list(limit)
    total = await db.leads.count_documents(query)
    
    return {
        "files": files,
        "pagination": {
            "page": page,
            "limit": limit,
            "total": total,
            "pages": (total + limit - 1) // limit
        }
    }


# ============ FILES REPORTS ============
# Must be before /{file_id} to avoid route shadowing

@router.get("/reports")
async def get_files_reports(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    assigned_to: Optional[str] = None
):
    """Get files reports with disbursement analytics"""
    query = {"status": "file"}
    
    if start_date:
        query["created_at"] = {"$gte": start_date}
    if end_date:
        if "created_at" in query:
            query["created_at"]["$lte"] = end_date
        else:
            query["created_at"] = {"$lte": end_date}
    if assigned_to:
        query["file_assigned_to"] = assigned_to
    
    # Status breakdown
    status_pipeline = [
        {"$match": query},
        {"$group": {"_id": "$file_status", "count": {"$sum": 1}}}
    ]
    status_counts = await db.leads.aggregate(status_pipeline).to_list(100)
    
    # Disbursement stats
    disbursement_pipeline = [
        {"$match": {**query, "eligibilities": {"$exists": True, "$ne": []}}},
        {"$unwind": "$eligibilities"},
        {"$match": {"eligibilities.disbursed": True}},
        {"$group": {
            "_id": None,
            "total_disbursed_count": {"$sum": 1},
            "total_disbursed_amount": {"$sum": {"$toDouble": {"$ifNull": ["$eligibilities.disbursed_amount", 0]}}},
            "total_commission": {"$sum": {"$toDouble": {"$ifNull": ["$eligibilities.commission_amount", 0]}}}
        }}
    ]
    disbursement_stats = await db.leads.aggregate(disbursement_pipeline).to_list(1)
    
    # Bank-wise breakdown
    bank_pipeline = [
        {"$match": {**query, "eligibilities": {"$exists": True, "$ne": []}}},
        {"$unwind": "$eligibilities"},
        {"$match": {"eligibilities.bank_name": {"$exists": True, "$ne": ""}}},
        {"$group": {
            "_id": "$eligibilities.bank_name",
            "total": {"$sum": 1},
            "eligible": {"$sum": {"$cond": [{"$eq": ["$eligibilities.is_eligible", True]}, 1, 0]}},
            "login": {"$sum": {"$cond": [{"$eq": ["$eligibilities.login_done", True]}, 1, 0]}},
            "approved": {"$sum": {"$cond": [{"$eq": ["$eligibilities.approval_status", "approved"]}, 1, 0]}},
            "disbursed": {"$sum": {"$cond": [{"$eq": ["$eligibilities.disbursed", True]}, 1, 0]}},
            "disbursed_amount": {"$sum": {"$cond": [
                {"$eq": ["$eligibilities.disbursed", True]},
                {"$toDouble": {"$ifNull": ["$eligibilities.disbursed_amount", 0]}},
                0
            ]}},
            "commission_amount": {"$sum": {"$toDouble": {"$ifNull": ["$eligibilities.commission_amount", 0]}}}
        }},
        {"$sort": {"disbursed_amount": -1}}
    ]
    bank_stats = await db.leads.aggregate(bank_pipeline).to_list(50)
    
    # Team member performance
    team_pipeline = [
        {"$match": query},
        {"$group": {
            "_id": "$file_assigned_to",
            "total_files": {"$sum": 1},
            "disbursed": {"$sum": {"$cond": [{"$eq": ["$file_status", "disbursed"]}, 1, 0]}},
            "approved": {"$sum": {"$cond": [{"$eq": ["$file_status", "approved"]}, 1, 0]}},
            "rejected": {"$sum": {"$cond": [{"$in": ["$file_status", ["rejected", "declined", "not_eligible"]]}, 1, 0]}}
        }}
    ]
    team_stats_raw = await db.leads.aggregate(team_pipeline).to_list(100)
    
    # Enrich team stats with names
    team_stats = []
    for ts in team_stats_raw:
        if ts["_id"]:
            user = await db.users.find_one({"id": ts["_id"]}, {"_id": 0, "full_name": 1, "name": 1})
            ts["name"] = user.get("full_name") or user.get("name") if user else "Unknown"
        else:
            ts["name"] = "Unassigned"
        team_stats.append(ts)
    
    # Conversion funnel
    total_files = await db.leads.count_documents(query)
    docs_collected = await db.leads.count_documents({**query, "file_status": "documents_collected"})
    sent_to_bank = await db.leads.count_documents({**query, "file_status": {"$in": ["sent_to_bank", "login", "approved", "disbursed"]}})
    login_done = await db.leads.count_documents({**query, "file_status": {"$in": ["login", "approved", "disbursed"]}})
    approved = await db.leads.count_documents({**query, "file_status": {"$in": ["approved", "disbursed"]}})
    disbursed = await db.leads.count_documents({**query, "file_status": "disbursed"})
    
    disb = disbursement_stats[0] if disbursement_stats else {}
    
    return {
        "summary": {
            "total_files": total_files,
            "by_status": {s["_id"]: s["count"] for s in status_counts if s["_id"]},
            "total_disbursed_count": disb.get("total_disbursed_count", 0),
            "total_disbursed_amount": disb.get("total_disbursed_amount", 0),
            "total_commission": disb.get("total_commission", 0)
        },
        "funnel": {
            "total_files": total_files,
            "docs_collected": docs_collected,
            "sent_to_bank": sent_to_bank,
            "login_done": login_done,
            "approved": approved,
            "disbursed": disbursed
        },
        "bank_stats": bank_stats,
        "team_stats": team_stats
    }


# ============ DATA MIGRATION ============

class MigrationData(BaseModel):
    leads: Optional[List[dict]] = None
    files: Optional[List[dict]] = None  # Support both 'leads' and 'files' keys
    source: str = "crm_import"


def transform_old_crm_record(record: dict) -> dict:
    """
    Transform old CRM record to Connect format.
    Maps fields from old schema to new schema.
    """
    # Handle different field names from old CRM
    transformed = {
        "name": record.get("name") or record.get("fullName") or record.get("full_name") or "",
        "phone": str(record.get("phone") or record.get("mobile") or record.get("mobileNumber") or "").replace(" ", "").replace("-", ""),
        "email": record.get("email") or record.get("emailId") or "",
        "city": record.get("city") or record.get("location") or "",
        "requirement": record.get("requirement") or record.get("loanType") or record.get("type_of_loan") or "",
        "source": record.get("source") or record.get("leadSource") or "crm_import",
        "employment_type": record.get("employment_type") or record.get("employmentType") or "",
    }
    
    # Map file status - handle various old CRM status names
    old_status = str(record.get("status") or record.get("fileStatus") or record.get("file_status") or "new").lower()
    status_mapping = {
        "new": "new",
        "contacted": "contacted",
        "in progress": "contacted",
        "inprogress": "contacted",
        "query": "query",
        "hold": "hold",
        "on hold": "hold",
        "documents collected": "documents_collected",
        "docs collected": "documents_collected",
        "documents_collected": "documents_collected",
        "not eligible": "not_eligible",
        "noteligible": "not_eligible",
        "not_eligible": "not_eligible",
        "sent to bank": "sent_to_bank",
        "sent_to_bank": "sent_to_bank",
        "senttobank": "sent_to_bank",
        "login": "login",
        "logged in": "login",
        "not login": "not_login",
        "not_login": "not_login",
        "notlogin": "not_login",
        "approved": "approved",
        "sanctioned": "approved",
        "declined": "declined",
        "rejected": "rejected",
        "disbursed": "disbursed",
        "disbursement": "disbursed",
        "not disbursed": "not_disbursed",
        "not_disbursed": "not_disbursed",
        "fi negative": "fi_negative",
        "fi_negative": "fi_negative",
        "not interested": "not_interested",
        "not_interested": "not_interested",
        "supporting": "supporting",
    }
    transformed["file_status"] = status_mapping.get(old_status, "new")
    
    # Build file_details from various possible fields
    file_details = record.get("file_details") or record.get("fileDetails") or {}
    if not file_details:
        file_details = {
            "mother_name": record.get("motherName") or record.get("mother_name") or "",
            "current_address": record.get("currentAddress") or record.get("current_address") or record.get("address") or "",
            "company_name": record.get("companyName") or record.get("company_name") or record.get("company") or "",
            "net_salary": record.get("netSalary") or record.get("net_salary") or record.get("salary") or "",
            "office_address": record.get("officeAddress") or record.get("office_address") or "",
            "obligations_emi": record.get("obligationsEmi") or record.get("obligations_emi") or record.get("emi") or "",
            "existing_loan_1": record.get("existingLoan1") or record.get("existing_loan_1") or "",
            "existing_loan_2": record.get("existingLoan2") or record.get("existing_loan_2") or "",
            "existing_loan_3": record.get("existingLoan3") or record.get("existing_loan_3") or "",
            "type_of_loan": record.get("typeOfLoan") or record.get("type_of_loan") or record.get("loanType") or transformed["requirement"],
            "cibil_score": record.get("cibilScore") or record.get("cibil_score") or record.get("cibil") or "",
            "loan_amount_required": record.get("loanAmountRequired") or record.get("loan_amount_required") or record.get("loanAmount") or "",
            "tenure_required": record.get("tenureRequired") or record.get("tenure_required") or record.get("tenure") or "",
        }
    transformed["file_details"] = file_details
    
    # Copy eligibilities if present
    transformed["eligibilities"] = record.get("eligibilities") or record.get("bankEligibilities") or []
    
    # Copy activities/notes if present
    old_activities = record.get("file_activities") or record.get("activities") or record.get("notes") or []
    if isinstance(old_activities, list):
        transformed["file_activities"] = old_activities
    else:
        transformed["file_activities"] = []
    
    # Copy other metadata
    transformed["rating"] = record.get("rating") or record.get("stars") or 0
    transformed["score"] = record.get("score") or 0
    transformed["created_at"] = record.get("created_at") or record.get("createdAt") or record.get("dateCreated") or datetime.now(timezone.utc).isoformat()
    transformed["assigned_to"] = record.get("assigned_to") or record.get("assignedTo") or record.get("telecaller") or None
    transformed["file_assigned_to"] = record.get("file_assigned_to") or record.get("opsAssignedTo") or None
    
    return transformed


@router.post("/import")
async def import_crm_data(migration_data: MigrationData):
    """
    Import leads/files from external CRM system.
    Accepts both 'leads' and 'files' keys in the JSON payload.
    Automatically transforms old CRM field names to Connect format.
    """
    # Support both 'leads' and 'files' keys
    records = migration_data.files or migration_data.leads or []
    
    if not records:
        raise HTTPException(status_code=400, detail="No data to import. Provide 'leads' or 'files' array.")
    
    imported_count = 0
    updated_count = 0
    skipped_count = 0
    errors = []
    
    for record in records:
        try:
            # Transform old CRM format to Connect format
            transformed = transform_old_crm_record(record)
            
            phone = transformed["phone"]
            if not phone:
                skipped_count += 1
                continue
            
            existing = await db.leads.find_one({"phone": phone})
            if existing:
                # Update existing lead with CRM data (merge, don't overwrite)
                update_data = {
                    "status": "file",
                    "file_status": transformed["file_status"],
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                    "import_source": migration_data.source
                }
                
                # Only update fields that have values
                if transformed["name"]:
                    update_data["name"] = transformed["name"]
                if transformed["email"]:
                    update_data["email"] = transformed["email"]
                if transformed["city"]:
                    update_data["city"] = transformed["city"]
                if transformed["requirement"]:
                    update_data["requirement"] = transformed["requirement"]
                if transformed["employment_type"]:
                    update_data["employment_type"] = transformed["employment_type"]
                if transformed["file_details"]:
                    # Merge file_details instead of replacing
                    existing_details = existing.get("file_details") or {}
                    merged_details = {**existing_details, **{k: v for k, v in transformed["file_details"].items() if v}}
                    update_data["file_details"] = merged_details
                if transformed["eligibilities"]:
                    update_data["eligibilities"] = transformed["eligibilities"]
                if transformed["rating"]:
                    update_data["rating"] = transformed["rating"]
                if transformed["score"]:
                    update_data["score"] = transformed["score"]
                if transformed["file_assigned_to"]:
                    update_data["file_assigned_to"] = transformed["file_assigned_to"]
                
                await db.leads.update_one({"phone": phone}, {"$set": update_data})
                updated_count += 1
            else:
                # Create new lead/file
                new_lead = {
                    "id": str(uuid.uuid4()),
                    "name": transformed["name"],
                    "phone": phone,
                    "email": transformed["email"],
                    "city": transformed["city"],
                    "requirement": transformed["requirement"],
                    "employment_type": transformed["employment_type"],
                    "source": transformed["source"],
                    "status": "file",
                    "file_status": transformed["file_status"],
                    "file_details": transformed["file_details"],
                    "eligibilities": transformed["eligibilities"],
                    "rating": transformed["rating"],
                    "score": transformed["score"],
                    "assigned_to": transformed["assigned_to"],
                    "file_assigned_to": transformed["file_assigned_to"],
                    "file_activities": transformed["file_activities"] + [{
                        "type": "import",
                        "message": f"Imported from {migration_data.source}",
                        "timestamp": datetime.now(timezone.utc).isoformat()
                    }],
                    "created_at": transformed["created_at"],
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                    "import_source": migration_data.source
                }
                await db.leads.insert_one(new_lead)
                imported_count += 1
                
        except Exception as e:
            errors.append({"phone": record.get("phone"), "error": str(e)})
            skipped_count += 1
    
    return {
        "success": True,
        "total_processed": len(records),
        "new_records": imported_count,
        "updated_records": updated_count,
        "skipped": skipped_count,
        "errors": errors[:20]  # Return first 20 errors
    }


@router.post("/import/upload")
async def import_crm_file(file: UploadFile = File(...)):
    """
    Import from uploaded JSON file (from export script).
    Accepts the JSON file generated by export_old_crm.py
    """
    import json
    
    if not file.filename.endswith('.json'):
        raise HTTPException(status_code=400, detail="Only JSON files are supported")
    
    try:
        content = await file.read()
        data = json.loads(content.decode('utf-8'))
        
        # Handle both direct array and wrapped format
        if isinstance(data, list):
            records = data
            source = "file_upload"
        elif isinstance(data, dict):
            records = data.get("files") or data.get("leads") or data.get("data") or []
            source = data.get("export_info", {}).get("source_database", "file_upload")
        else:
            raise HTTPException(status_code=400, detail="Invalid JSON format")
        
        if not records:
            raise HTTPException(status_code=400, detail="No records found in the file")
        
        # Use the import function
        migration_data = MigrationData(files=records, source=source)
        return await import_crm_data(migration_data)
        
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=400, detail=f"Invalid JSON: {str(e)}")


@router.get("/export")
async def export_files_data(file_status: Optional[str] = None):
    """Export all files data for backup or migration"""
    query = {"status": "file"}
    if file_status:
        query["file_status"] = file_status
    
    files = await db.leads.find(query, {"_id": 0}).to_list(10000)
    
    return {
        "count": len(files),
        "files": files,
        "exported_at": datetime.now(timezone.utc).isoformat()
    }


# ============ FILE BY ID ROUTES ============
# These must be after literal routes like /reports, /import, /export

@router.get("/{file_id}")
async def get_file_details(file_id: str):
    """Get detailed file information"""
    file_doc = await db.leads.find_one({"id": file_id}, {"_id": 0})
    if not file_doc:
        raise HTTPException(status_code=404, detail="File not found")
    return file_doc


@router.put("/{file_id}/details")
async def update_file_details(file_id: str, update_data: FileDetailsUpdate):
    """Update file customer details"""
    file_doc = await db.leads.find_one({"id": file_id}, {"_id": 0})
    if not file_doc:
        raise HTTPException(status_code=404, detail="File not found")
    
    update_dict = {}
    if update_data.full_name is not None:
        update_dict["name"] = update_data.full_name
    if update_data.mobile is not None:
        update_dict["phone"] = update_data.mobile
    if update_data.email is not None:
        update_dict["email"] = update_data.email
    if update_data.city is not None:
        update_dict["city"] = update_data.city
    if update_data.employment_type is not None:
        update_dict["employment_type"] = update_data.employment_type
    if update_data.requirement is not None:
        update_dict["requirement"] = update_data.requirement
    if update_data.additional_data is not None:
        existing_additional = file_doc.get("file_details", {}) or {}
        merged_additional = {**existing_additional, **update_data.additional_data}
        update_dict["file_details"] = merged_additional
    
    if not update_dict:
        return {"message": "No changes to update"}
    
    update_dict["updated_at"] = datetime.now(timezone.utc).isoformat()
    
    await db.leads.update_one(
        {"id": file_id},
        {
            "$set": update_dict,
            "$push": {
                "file_activities": {
                    "type": "details_update",
                    "message": "File details updated",
                    "timestamp": datetime.now(timezone.utc).isoformat()
                }
            }
        }
    )
    
    return {"message": "File details updated successfully"}


@router.put("/{file_id}/file-status")
async def update_file_status(file_id: str, status_update: FileStatusUpdate):
    """Update file CRM status"""
    if status_update.file_status not in FILE_STATUSES:
        raise HTTPException(status_code=400, detail=f"Invalid status. Valid: {', '.join(FILE_STATUSES)}")
    
    file_doc = await db.leads.find_one({"id": file_id}, {"_id": 0})
    if not file_doc:
        raise HTTPException(status_code=404, detail="File not found")
    
    await db.leads.update_one(
        {"id": file_id},
        {
            "$set": {
                "file_status": status_update.file_status,
                "updated_at": datetime.now(timezone.utc).isoformat()
            },
            "$push": {
                "file_activities": {
                    "type": "status_change",
                    "message": f"Status changed to {status_update.file_status}",
                    "timestamp": datetime.now(timezone.utc).isoformat()
                }
            }
        }
    )
    
    return {"message": "File status updated successfully"}


@router.post("/{file_id}/notes")
async def add_file_note(file_id: str, note_data: NoteAdd):
    """Add a note to a file"""
    result = await db.leads.update_one(
        {"id": file_id},
        {
            "$push": {
                "file_activities": {
                    "type": "note",
                    "message": note_data.note,
                    "timestamp": datetime.now(timezone.utc).isoformat()
                }
            },
            "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}
        }
    )
    
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail="File not found")
    
    return {"message": "Note added successfully"}


@router.put("/{file_id}/assign")
async def assign_file(file_id: str, assignment: FileAssignment):
    """Assign a file to an operations team member"""
    assignee = await db.users.find_one({"id": assignment.assigned_to}, {"_id": 0})
    if not assignee:
        raise HTTPException(status_code=404, detail="Assignee not found")
    
    file_doc = await db.leads.find_one({"id": file_id}, {"_id": 0})
    if not file_doc:
        raise HTTPException(status_code=404, detail="File not found")
    
    await db.leads.update_one(
        {"id": file_id},
        {
            "$set": {
                "file_assigned_to": assignment.assigned_to,
                "updated_at": datetime.now(timezone.utc).isoformat()
            },
            "$push": {
                "file_activities": {
                    "type": "assignment",
                    "message": f"File assigned to {assignee.get('full_name', 'Team Member')}",
                    "timestamp": datetime.now(timezone.utc).isoformat()
                }
            }
        }
    )
    
    return {"message": f"File assigned to {assignee.get('full_name')}", "assigned_to": assignment.assigned_to}


@router.put("/bulk-assign")
async def bulk_assign_files(assignment: BulkFileAssignment):
    """Bulk assign multiple files to an operations team member"""
    if not assignment.file_ids:
        raise HTTPException(status_code=400, detail="No files selected")
    
    assignee = await db.users.find_one({"id": assignment.assigned_to}, {"_id": 0})
    if not assignee:
        raise HTTPException(status_code=404, detail="Assignee not found")
    
    assigned_count = 0
    for file_id in assignment.file_ids:
        result = await db.leads.update_one(
            {"id": file_id},
            {
                "$set": {
                    "file_assigned_to": assignment.assigned_to,
                    "updated_at": datetime.now(timezone.utc).isoformat()
                },
                "$push": {
                    "file_activities": {
                        "type": "assignment",
                        "message": f"File assigned to {assignee.get('full_name')} (bulk)",
                        "timestamp": datetime.now(timezone.utc).isoformat()
                    }
                }
            }
        )
        if result.modified_count > 0:
            assigned_count += 1
    
    return {
        "message": f"{assigned_count} files assigned to {assignee.get('full_name')}",
        "assigned_count": assigned_count,
        "assigned_to": assignment.assigned_to
    }


@router.put("/{file_id}/eligibilities")
async def update_eligibilities(file_id: str, eligibility_update: EligibilityUpdate):
    """Update file bank eligibilities (up to 7 banks)"""
    if len(eligibility_update.eligibilities) > 7:
        raise HTTPException(status_code=400, detail="Maximum 7 eligibilities allowed")
    
    file_doc = await db.leads.find_one({"id": file_id}, {"_id": 0})
    if not file_doc:
        raise HTTPException(status_code=404, detail="File not found")
    
    eligibilities_data = []
    for e in eligibility_update.eligibilities:
        elig_dict = e.dict()
        if elig_dict.get('disbursed') and elig_dict.get('disbursed_amount') and elig_dict.get('commission_percentage'):
            calculated_commission = round(
                (elig_dict['disbursed_amount'] * elig_dict['commission_percentage']) / 100, 2
            )
            elig_dict['commission_amount'] = calculated_commission
        eligibilities_data.append(elig_dict)
    
    await db.leads.update_one(
        {"id": file_id},
        {
            "$set": {
                "eligibilities": eligibilities_data,
                "updated_at": datetime.now(timezone.utc).isoformat()
            },
            "$push": {
                "file_activities": {
                    "type": "eligibility_update",
                    "message": f"Eligibilities updated ({len(eligibilities_data)} bank(s))",
                    "timestamp": datetime.now(timezone.utc).isoformat()
                }
            }
        }
    )
    
    return {"message": "Eligibilities updated successfully", "count": len(eligibilities_data)}


@router.get("/{file_id}/eligibilities")
async def get_eligibilities(file_id: str):
    """Get file eligibilities"""
    # First check if file exists (without projection that may return empty dict)
    file_exists = await db.leads.count_documents({"id": file_id})
    if not file_exists:
        raise HTTPException(status_code=404, detail="File not found")
    
    file_doc = await db.leads.find_one({"id": file_id}, {"_id": 0, "eligibilities": 1})
    return file_doc.get("eligibilities", []) if file_doc else []


@router.get("/{file_id}/activities")
async def get_file_activities(file_id: str):
    """Get file activity log"""
    # First check if file exists (without projection that may return empty dict)
    file_exists = await db.leads.count_documents({"id": file_id})
    if not file_exists:
        raise HTTPException(status_code=404, detail="File not found")
    
    file_doc = await db.leads.find_one({"id": file_id}, {"_id": 0, "file_activities": 1})
    return file_doc.get("file_activities", []) if file_doc else []


# File Storage Routes - Using GridFS for persistent storage
@router.post("/{file_id}/upload")
async def upload_document(
    file_id: str,
    file: UploadFile = File(...),
    document_type: str = "general"
):
    """Upload a document for a file - stored in MongoDB GridFS"""
    file_ext = Path(file.filename).suffix.lower()
    if file_ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"File type '{file_ext}' not allowed. Allowed: PDF, Images, DOC, XLS"
        )
    
    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="File too large. Maximum 10MB")
    
    try:
        doc_id = str(uuid.uuid4())
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        safe_name = f"{document_type}_{timestamp}_{doc_id}{file_ext}"
        
        # Store in GridFS
        fs_bucket = await get_gridfs_bucket()
        grid_id = await fs_bucket.upload_from_stream(
            safe_name,
            content,
            metadata={
                "file_id": file_id,
                "doc_id": doc_id,
                "original_name": file.filename,
                "document_type": document_type,
                "mime_type": file.content_type
            }
        )
        
        doc_data = {
            "file_id": doc_id,
            "grid_id": str(grid_id),
            "file_name": safe_name,
            "original_name": file.filename,
            "size": len(content),
            "mime_type": file.content_type,
            "document_type": document_type,
            "uploaded_at": datetime.now(timezone.utc).isoformat()
        }
        
        await db.leads.update_one(
            {"id": file_id},
            {
                "$push": {"file_documents": doc_data},
                "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}
            }
        )
        
        return {"success": True, **doc_data}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to upload: {str(e)}")


@router.get("/{file_id}/documents")
async def list_file_documents(file_id: str):
    """List all documents for a file"""
    # First check if file exists (without projection that may return empty dict)
    file_exists = await db.leads.count_documents({"id": file_id})
    if not file_exists:
        raise HTTPException(status_code=404, detail="File not found")
    
    file_doc = await db.leads.find_one({"id": file_id}, {"_id": 0, "file_documents": 1})
    return file_doc.get("file_documents", []) if file_doc else []


@router.get("/download/{doc_id}")
async def download_document(doc_id: str):
    """Download a document from GridFS"""
    from fastapi.responses import StreamingResponse
    from bson import ObjectId
    import io
    
    # Find document metadata
    file_doc = await db.leads.find_one(
        {"file_documents.file_id": doc_id},
        {"_id": 0, "file_documents.$": 1}
    )
    
    if not file_doc or not file_doc.get("file_documents"):
        raise HTTPException(status_code=404, detail="Document not found")
    
    doc = file_doc["file_documents"][0]
    grid_id = doc.get("grid_id")
    
    if not grid_id:
        raise HTTPException(status_code=404, detail="Document file not found")
    
    try:
        fs_bucket = await get_gridfs_bucket()
        grid_out = await fs_bucket.open_download_stream(ObjectId(grid_id))
        content = await grid_out.read()
        
        return StreamingResponse(
            io.BytesIO(content),
            media_type=doc.get("mime_type", "application/octet-stream"),
            headers={"Content-Disposition": f"attachment; filename={doc.get('original_name', 'document')}"}
        )
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"Document not found: {str(e)}")


@router.delete("/{file_id}/documents/{doc_id}")
async def delete_document(file_id: str, doc_id: str):
    """Delete a document"""
    from bson import ObjectId
    
    file_doc = await db.leads.find_one({"id": file_id}, {"_id": 0, "file_documents": 1})
    if not file_doc:
        raise HTTPException(status_code=404, detail="File not found")
    
    documents = file_doc.get("file_documents", [])
    doc = next((d for d in documents if d.get("file_id") == doc_id), None)
    
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    
    # Delete from GridFS
    grid_id = doc.get("grid_id")
    if grid_id:
        try:
            fs_bucket = await get_gridfs_bucket()
            await fs_bucket.delete(ObjectId(grid_id))
        except Exception:
            pass  # File might already be deleted
    
    # Remove from database
    await db.leads.update_one(
        {"id": file_id},
        {
            "$pull": {"file_documents": {"file_id": doc_id}},
            "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}
        }
    )
    
    return {"success": True, "message": "Document deleted"}


# Dashboard stats for Files - Following BankEzee CRM Statistics Rules
@router.get("/dashboard/stats")
async def get_files_dashboard_stats(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None
):
    """
    Get dashboard statistics for files following the BankEzee CRM rules:
    
    KEY RULES:
    - Total Files: COUNT leads WHERE created_at IN date_range
    - In Progress: COUNT leads WHERE created_at IN date_range AND status IN IN_PROGRESS (NO spillover)
    - Login: COUNT leads WHERE status IN LOGIN_AND_BEYOND AND has activity in date_range (with C/S split)
    - Approved: COUNT leads WHERE ANY eligibility has approved_at IN date_range (with C/S split)
    - Disbursed: COUNT leads WHERE ANY eligibility has disbursed_at IN date_range (with C/S split)
    - Amt in Pipeline: NO date filter - always current snapshot
    
    C = Current (created in range), S = Spillover (created before, activity in range)
    All Time = No date filter, no C/S split
    """
    from datetime import datetime, timezone
    
    # Status category definitions
    IN_PROGRESS_STATUSES = [
        'contacted', 'documents_collected', 'documents_pending', 'sent_for_eligibility',
        'sent_for_login', 'login', 'sent_for_approval', 'underwriting', 'fi', 
        'fi_reinitiated', 'query_hold', 'sent_to_bank', 'query'
    ]
    LOGIN_AND_BEYOND = [
        'login', 'sent_for_approval', 'underwriting', 'fi', 'fi_negative', 'fi_reinitiated',
        'query_hold', 'approved', 'disbursed', 'declined', 'not_disbursed'
    ]
    INTERIM_REJECTS = ['fi_negative', 'declined', 'customer_not_interested', 'customer_not_supporting']
    FINAL_REJECTIONS = ['rejected', 'not_eligible', 'not_login', 'not_disbursed']
    PIPELINE_EXCLUDED = ['rejected', 'not_eligible', 'not_login', 'not_disbursed', 'declined', 'disbursed']
    
    # Parse date range
    is_all_time = not start_date and not end_date
    date_start = None
    date_end = None
    
    if start_date:
        try:
            date_start = datetime.fromisoformat(start_date.replace('Z', '+00:00'))
            if date_start.tzinfo is None:
                date_start = date_start.replace(tzinfo=timezone.utc)
        except (ValueError, TypeError):
            date_start = datetime.strptime(start_date, '%Y-%m-%d').replace(tzinfo=timezone.utc)
    
    if end_date:
        try:
            date_end = datetime.fromisoformat(end_date.replace('Z', '+00:00'))
            if date_end.tzinfo is None:
                date_end = date_end.replace(hour=23, minute=59, second=59, tzinfo=timezone.utc)
        except (ValueError, TypeError):
            date_end = datetime.strptime(end_date, '%Y-%m-%d').replace(hour=23, minute=59, second=59, tzinfo=timezone.utc)
    
    def parse_timestamp(ts):
        """Parse ISO timestamp string to datetime - always returns timezone-aware datetime"""
        if not ts:
            return None
        if isinstance(ts, datetime):
            # Ensure timezone-aware
            if ts.tzinfo is None:
                return ts.replace(tzinfo=timezone.utc)
            return ts
        try:
            dt = datetime.fromisoformat(ts.replace('Z', '+00:00'))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt
        except (ValueError, TypeError, AttributeError):
            # Try parsing as date string
            try:
                dt = datetime.strptime(ts[:10], '%Y-%m-%d')
                return dt.replace(tzinfo=timezone.utc)
            except (ValueError, TypeError, AttributeError):
                return None
    
    def is_in_date_range(ts):
        """Check if timestamp falls within date range"""
        if is_all_time:
            return True  # For All Time, always return True (no filter)
        dt = parse_timestamp(ts)
        if not dt:
            return False  # If no timestamp and date filter is applied, exclude
        if date_start and dt < date_start:
            return False
        if date_end and dt > date_end:
            return False
        return True
    
    def is_in_date_range_or_all_time(ts):
        """Check if timestamp falls within date range, or if All Time, just check if data exists"""
        if is_all_time:
            return True  # For All Time, we include all records regardless of timestamp
        return is_in_date_range(ts)
    
    def is_created_in_range(lead):
        """Check if lead was created within date range"""
        return is_in_date_range(lead.get('created_at'))
    
    def has_activity_in_range(lead):
        """Check if lead has any activity within date range"""
        if is_all_time:
            return True
        activities = lead.get('file_activities', []) or lead.get('activities', [])
        for act in activities:
            if is_in_date_range(act.get('timestamp')):
                return True
        # Also check eligibility timestamps
        for elig in (lead.get('eligibilities') or []):
            if is_in_date_range(elig.get('login_done_at')):
                return True
            if is_in_date_range(elig.get('approved_at')):
                return True
            if is_in_date_range(elig.get('disbursed_at')):
                return True
        return False
    
    def was_previously_logged(lead):
        """Check if lead was previously in LOGIN_AND_BEYOND status"""
        activities = lead.get('file_activities', []) or lead.get('activities', [])
        for act in activities:
            to_status = act.get('to_status') or act.get('new_status')
            if to_status and to_status in LOGIN_AND_BEYOND:
                return True
        return False
    
    def is_login_done(elig):
        """Check if eligibility has login_done"""
        login_done = elig.get('login_done')
        return login_done == True or (isinstance(login_done, str) and login_done.lower() in ['yes', 'true'])
    
    def is_disbursed(elig):
        """Check if eligibility is disbursed"""
        disbursed = elig.get('disbursed')
        return disbursed == True or (isinstance(disbursed, str) and disbursed.lower() in ['yes', 'true'])
    
    # Get all files
    all_files = await db.leads.find({"status": "file"}).to_list(10000)
    
    # Initialize counters
    total_files_current = 0
    new_current = 0
    in_progress_current = 0  # No spillover for in_progress
    
    login_current = 0
    login_spillover = 0
    approved_current = 0
    approved_spillover = 0
    disbursed_current = 0
    disbursed_spillover = 0
    interim_rejects_current = 0
    interim_rejects_spillover = 0
    final_rejections_current = 0
    final_rejections_spillover = 0
    
    total_approved_amount = 0.0
    total_disbursed_amount = 0.0
    pipeline_amount = 0.0
    
    # Status counts for breakdown
    status_counts = {}
    
    for f in all_files:
        file_status = f.get('file_status') or 'new'
        status_counts[file_status] = status_counts.get(file_status, 0) + 1
        
        created_in_range = is_created_in_range(f)
        has_activity = has_activity_in_range(f)
        
        # Total Files: leads created in date range
        if created_in_range:
            total_files_current += 1
        
        # New: created in range AND status = new
        if created_in_range and file_status == 'new':
            new_current += 1
        
        # In Progress: created in range AND status in IN_PROGRESS (NO spillover)
        if created_in_range and file_status in IN_PROGRESS_STATUSES:
            in_progress_current += 1
        
        # Login: status in LOGIN_AND_BEYOND OR (rejected AND was_previously_logged) AND has activity in range
        is_login_candidate = (
            file_status in LOGIN_AND_BEYOND or 
            (file_status == 'rejected' and was_previously_logged(f))
        )
        if is_login_candidate and has_activity:
            if created_in_range:
                login_current += 1
            elif not is_all_time:
                login_spillover += 1
        
        # Interim Rejects: status in INTERIM_REJECTS AND has activity in range
        if file_status in INTERIM_REJECTS and has_activity:
            if created_in_range:
                interim_rejects_current += 1
            elif not is_all_time:
                interim_rejects_spillover += 1
        
        # Final Rejections: status in FINAL_REJECTIONS AND has activity in range
        if file_status in FINAL_REJECTIONS and has_activity:
            if created_in_range:
                final_rejections_current += 1
            elif not is_all_time:
                final_rejections_spillover += 1
        
        # Process eligibilities for approved, disbursed, amounts, pipeline
        eligibilities = f.get('eligibilities', []) or []
        file_has_approved_in_range = False
        file_has_disbursed_in_range = False
        file_approved_amt = 0.0
        file_disbursed_amt = 0.0
        file_pipeline_amt = 0.0
        
        for elig in eligibilities:
            # Approved: approval_status = "approved" AND (All Time OR approved_at in range)
            approved_at = elig.get('approved_at')
            if elig.get('approval_status') == 'approved':
                # For All Time: count all approvals
                # For date range: only count if approved_at is in range
                if is_all_time or is_in_date_range(approved_at):
                    file_has_approved_in_range = True
                    try:
                        file_approved_amt += float(elig.get('approved_amount') or 0)
                    except (ValueError, TypeError):
                        pass
            
            # Disbursed: disbursed = "yes" AND (All Time OR disbursed_at in range)
            disbursed_at = elig.get('disbursed_at')
            if is_disbursed(elig):
                # For All Time: count all disbursals
                # For date range: only count if disbursed_at is in range
                if is_all_time or is_in_date_range(disbursed_at):
                    file_has_disbursed_in_range = True
                    try:
                        file_disbursed_amt += float(elig.get('disbursed_amount') or 0)
                    except (ValueError, TypeError):
                        pass
            
            # Pipeline: login_done=yes AND application_id not blank AND disbursed!=yes 
            # AND approval_status!=declined AND lead status NOT IN PIPELINE_EXCLUDED
            # NO date filter - always current snapshot
            app_id = elig.get('application_id')
            if (is_login_done(elig) and 
                app_id and str(app_id).strip() and
                not is_disbursed(elig) and 
                elig.get('approval_status') != 'declined' and
                file_status not in PIPELINE_EXCLUDED):
                try:
                    file_pipeline_amt += float(elig.get('eligible_amount') or 0)
                except (ValueError, TypeError):
                    pass
        
        # Count approved/disbursed per lead (not per eligibility)
        if file_has_approved_in_range:
            if created_in_range:
                approved_current += 1
            elif not is_all_time:
                approved_spillover += 1
            total_approved_amount += file_approved_amt
        
        if file_has_disbursed_in_range:
            if created_in_range:
                disbursed_current += 1
            elif not is_all_time:
                disbursed_spillover += 1
            total_disbursed_amount += file_disbursed_amt
        
        # Pipeline amount (no date filter)
        pipeline_amount += file_pipeline_amt
    
    # For All Time, spillover = 0 and total = current
    if is_all_time:
        login_spillover = 0
        approved_spillover = 0
        disbursed_spillover = 0
        interim_rejects_spillover = 0
        final_rejections_spillover = 0
    
    return {
        "total_files": total_files_current if not is_all_time else len(all_files),
        "by_status": status_counts,
        # Row 1 stats
        "new": new_current,
        "in_progress": in_progress_current,
        "login": login_current + login_spillover,
        "login_current": login_current,
        "login_spillover": login_spillover,
        "approved": approved_current + approved_spillover,
        "approved_current": approved_current,
        "approved_spillover": approved_spillover,
        "total_approved_amount": total_approved_amount,
        # Row 2 stats
        "disbursed": disbursed_current + disbursed_spillover,
        "disbursed_current": disbursed_current,
        "disbursed_spillover": disbursed_spillover,
        "total_disbursed_amount": total_disbursed_amount,
        "interim_rejects": interim_rejects_current + interim_rejects_spillover,
        "interim_rejects_current": interim_rejects_current,
        "interim_rejects_spillover": interim_rejects_spillover,
        "final_rejections": final_rejections_current + final_rejections_spillover,
        "final_rejections_current": final_rejections_current,
        "final_rejections_spillover": final_rejections_spillover,
        "amt_in_pipeline": pipeline_amount,
        # Legacy fields for backwards compatibility
        "contacted": status_counts.get("contacted", 0),
        "documents_collected": status_counts.get("documents_collected", 0),
        "sent_to_bank": status_counts.get("sent_to_bank", 0),
        "rejected": status_counts.get("rejected", 0)
    }


# Bank Performance Report
@router.get("/reports/bank-performance")
async def get_bank_performance(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None
):
    """
    Get bank-wise performance breakdown from eligibilities.
    
    For each bank:
    - Logins: COUNT eligibilities where login_done='yes' (or has approval/disbursal)
    - Approvals: COUNT eligibilities where approval_status='approved' AND approved_at in range
    - Disbursals: COUNT eligibilities where disbursed='yes' AND disbursed_at in range
    - Disbursal Amount: SUM disbursed_amount for disbursed eligibilities
    """
    from datetime import datetime, timezone
    
    # Parse date range
    is_all_time = not start_date and not end_date
    date_start = None
    date_end = None
    
    if start_date:
        try:
            date_start = datetime.fromisoformat(start_date.replace('Z', '+00:00'))
            if date_start.tzinfo is None:
                date_start = date_start.replace(tzinfo=timezone.utc)
        except (ValueError, TypeError):
            date_start = datetime.strptime(start_date, '%Y-%m-%d').replace(tzinfo=timezone.utc)
    
    if end_date:
        try:
            date_end = datetime.fromisoformat(end_date.replace('Z', '+00:00'))
            if date_end.tzinfo is None:
                date_end = date_end.replace(hour=23, minute=59, second=59, tzinfo=timezone.utc)
        except (ValueError, TypeError):
            date_end = datetime.strptime(end_date, '%Y-%m-%d').replace(hour=23, minute=59, second=59, tzinfo=timezone.utc)
    
    def parse_timestamp(ts):
        if not ts:
            return None
        if isinstance(ts, datetime):
            if ts.tzinfo is None:
                return ts.replace(tzinfo=timezone.utc)
            return ts
        try:
            dt = datetime.fromisoformat(ts.replace('Z', '+00:00'))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt
        except (ValueError, TypeError, AttributeError):
            return None
    
    def is_in_date_range(ts):
        if is_all_time:
            return True
        dt = parse_timestamp(ts)
        if not dt:
            return False
        if date_start and dt < date_start:
            return False
        if date_end and dt > date_end:
            return False
        return True
    
    def is_login_done(elig):
        login_done = elig.get('login_done')
        return login_done == True or (isinstance(login_done, str) and login_done.lower() in ['yes', 'true'])
    
    def is_disbursed(elig):
        disbursed = elig.get('disbursed')
        return disbursed == True or (isinstance(disbursed, str) and disbursed.lower() in ['yes', 'true'])
    
    # Bank stats aggregation
    bank_stats = {}
    
    all_files = await db.leads.find({"status": "file"}).to_list(10000)
    
    for f in all_files:
        for elig in (f.get('eligibilities') or []):
            bank_name = elig.get('bank_name')
            if not bank_name:
                continue
            
            if bank_name not in bank_stats:
                bank_stats[bank_name] = {
                    'bank_name': bank_name,
                    'logins': 0,
                    'approvals': 0,
                    'disbursals': 0,
                    'approved_amount': 0.0,
                    'disbursed_amount': 0.0
                }
            
            # Logins: login_done=yes OR has approval OR has disbursal
            if is_login_done(elig) or elig.get('approval_status') in ['approved', 'declined'] or is_disbursed(elig):
                bank_stats[bank_name]['logins'] += 1
            
            # Approvals: approval_status='approved' AND (All Time OR approved_at in range)
            approved_at = elig.get('approved_at')
            if elig.get('approval_status') == 'approved':
                if is_all_time or is_in_date_range(approved_at):
                    bank_stats[bank_name]['approvals'] += 1
                    try:
                        bank_stats[bank_name]['approved_amount'] += float(elig.get('approved_amount') or 0)
                    except (ValueError, TypeError):
                        pass
            
            # Disbursals: disbursed='yes' AND (All Time OR disbursed_at in range)
            disbursed_at = elig.get('disbursed_at')
            if is_disbursed(elig):
                if is_all_time or is_in_date_range(disbursed_at):
                    bank_stats[bank_name]['disbursals'] += 1
                    try:
                        bank_stats[bank_name]['disbursed_amount'] += float(elig.get('disbursed_amount') or 0)
                    except (ValueError, TypeError):
                        pass
    
    # Sort by disbursed amount descending
    banks = sorted(bank_stats.values(), key=lambda x: -x['disbursed_amount'])
    
    return {
        "banks": banks,
        "total_banks": len(banks),
        "date_range": {
            "start_date": start_date,
            "end_date": end_date,
            "is_all_time": is_all_time
        }
    }


# TAT (Turnaround Time) Metrics
@router.get("/reports/tat-metrics")
async def get_tat_metrics(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None
):
    """
    Calculate Turnaround Time metrics:
    - Lead-to-Login: login_done_at - created_at
    - Login-to-Approval: approved_at - login_done_at
    - Approval-to-Disbursal: disbursed_at - approved_at
    - Lead-to-Disbursal: disbursed_at - created_at
    
    Returns: Average, Mode (most frequent bucket), Distribution buckets
    """
    from datetime import datetime, timezone
    from collections import Counter
    
    def parse_timestamp(ts):
        if not ts:
            return None
        if isinstance(ts, datetime):
            return ts
        try:
            return datetime.fromisoformat(ts.replace('Z', '+00:00'))
        except (ValueError, TypeError, AttributeError):
            return None
    
    def days_between(start, end):
        """Calculate days between two timestamps"""
        start_dt = parse_timestamp(start)
        end_dt = parse_timestamp(end)
        if not start_dt or not end_dt:
            return None
        diff = end_dt - start_dt
        return max(0, diff.days)
    
    def get_bucket(days):
        """Get bucket label for days"""
        if days is None:
            return None
        if days == 0:
            return "Same day"
        elif days == 1:
            return "1 day"
        elif days <= 3:
            return "2-3 days"
        elif days <= 7:
            return "4-7 days"
        elif days <= 14:
            return "1-2 weeks"
        elif days <= 30:
            return "2-4 weeks"
        else:
            return "30+ days"
    
    # Initialize TAT data
    lead_to_login = []
    login_to_approval = []
    approval_to_disbursal = []
    lead_to_disbursal = []
    
    all_files = await db.leads.find({"status": "file"}).to_list(10000)
    
    for f in all_files:
        created_at = f.get('created_at')
        
        for elig in (f.get('eligibilities') or []):
            login_done_at = elig.get('login_done_at')
            approved_at = elig.get('approved_at')
            disbursed_at = elig.get('disbursed_at')
            
            # Lead-to-Login
            if login_done_at and created_at:
                days = days_between(created_at, login_done_at)
                if days is not None:
                    lead_to_login.append(days)
            
            # Login-to-Approval
            if approved_at and login_done_at:
                days = days_between(login_done_at, approved_at)
                if days is not None:
                    login_to_approval.append(days)
            
            # Approval-to-Disbursal
            if disbursed_at and approved_at:
                days = days_between(approved_at, disbursed_at)
                if days is not None:
                    approval_to_disbursal.append(days)
            
            # Lead-to-Disbursal
            if disbursed_at and created_at:
                days = days_between(created_at, disbursed_at)
                if days is not None:
                    lead_to_disbursal.append(days)
    
    def calculate_stats(days_list):
        if not days_list:
            return {
                "count": 0,
                "average": None,
                "mode": None,
                "mode_bucket": None,
                "distribution": {}
            }
        
        avg = sum(days_list) / len(days_list)
        mode = Counter(days_list).most_common(1)[0][0] if days_list else None
        
        # Calculate bucket distribution
        buckets = Counter([get_bucket(d) for d in days_list])
        distribution = dict(buckets.most_common())
        
        return {
            "count": len(days_list),
            "average": round(avg, 1),
            "mode": mode,
            "mode_bucket": get_bucket(mode),
            "distribution": distribution
        }
    
    return {
        "lead_to_login": calculate_stats(lead_to_login),
        "login_to_approval": calculate_stats(login_to_approval),
        "approval_to_disbursal": calculate_stats(approval_to_disbursal),
        "lead_to_disbursal": calculate_stats(lead_to_disbursal)
    }


# Growth Partner Report
@router.get("/reports/growth-partner")
async def get_growth_partner_report(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None
):
    """
    Per-agent/partner stats filtered by source_id.
    
    For each agent:
    - Files Generated: COUNT leads WHERE source_id = agent_id AND created_at IN date_range
    - Logins: COUNT leads with login activity in range, filtered by source_id
    - Approvals: COUNT leads with approval in range, filtered by source_id
    - Disbursals: COUNT leads with disbursal in range, filtered by source_id
    - Disbursal Amount: SUM disbursed_amount
    """
    from datetime import datetime, timezone
    
    # Parse date range
    is_all_time = not start_date and not end_date
    date_start = None
    date_end = None
    
    if start_date:
        try:
            date_start = datetime.fromisoformat(start_date.replace('Z', '+00:00'))
        except (ValueError, TypeError):
            date_start = datetime.strptime(start_date, '%Y-%m-%d').replace(tzinfo=timezone.utc)
        if date_start.tzinfo is None:
            date_start = date_start.replace(tzinfo=timezone.utc)
    
    if end_date:
        try:
            date_end = datetime.fromisoformat(end_date.replace('Z', '+00:00'))
        except (ValueError, TypeError):
            date_end = datetime.strptime(end_date, '%Y-%m-%d').replace(hour=23, minute=59, second=59, tzinfo=timezone.utc)
        if date_end.tzinfo is None:
            date_end = date_end.replace(hour=23, minute=59, second=59, tzinfo=timezone.utc)
    
    def parse_timestamp(ts):
        if not ts:
            return None
        if isinstance(ts, datetime):
            if ts.tzinfo is None:
                return ts.replace(tzinfo=timezone.utc)
            return ts
        try:
            dt = datetime.fromisoformat(ts.replace('Z', '+00:00'))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt
        except (ValueError, TypeError, AttributeError):
            return None
    
    def is_in_date_range(ts):
        if is_all_time:
            return True
        dt = parse_timestamp(ts)
        if not dt:
            return False
        if date_start and dt < date_start:
            return False
        if date_end and dt > date_end:
            return False
        return True
    
    def is_disbursed(elig):
        disbursed = elig.get('disbursed')
        return disbursed == True or (isinstance(disbursed, str) and disbursed.lower() in ['yes', 'true'])
    
    # Get all users to map IDs to names
    users = await db.users.find({}, {"_id": 0, "id": 1, "full_name": 1, "name": 1, "email": 1}).to_list(1000)
    user_map = {}
    for u in users:
        uid = u.get('id')
        if uid:
            user_map[uid] = u.get('full_name') or u.get('name') or u.get('email', '').split('@')[0]
    
    # Agent stats aggregation
    agent_stats = {}
    
    LOGIN_AND_BEYOND = [
        'login', 'sent_for_approval', 'underwriting', 'fi', 'fi_negative', 'fi_reinitiated',
        'query_hold', 'approved', 'disbursed', 'declined', 'not_disbursed'
    ]
    
    all_files = await db.leads.find({"status": "file"}).to_list(10000)
    
    for f in all_files:
        source_id = f.get('source_id')
        if not source_id:
            continue
        
        if source_id not in agent_stats:
            agent_stats[source_id] = {
                'agent_id': source_id,
                'agent_name': user_map.get(source_id, source_id),
                'files_generated': 0,
                'logins': 0,
                'approvals': 0,
                'disbursals': 0,
                'approved_amount': 0.0,
                'disbursed_amount': 0.0
            }
        
        created_at = f.get('created_at')
        file_status = f.get('file_status') or 'new'
        
        # Files Generated: created_at in range
        if is_in_date_range(created_at):
            agent_stats[source_id]['files_generated'] += 1
        
        # Check eligibilities for login/approval/disbursal
        has_login_in_range = False
        has_approval_in_range = False
        has_disbursal_in_range = False
        file_approved_amt = 0.0
        file_disbursed_amt = 0.0
        
        for elig in (f.get('eligibilities') or []):
            # Login
            login_done = elig.get('login_done')
            login_done_at = elig.get('login_done_at')
            if login_done == True or (isinstance(login_done, str) and login_done.lower() in ['yes', 'true']):
                if is_all_time or is_in_date_range(login_done_at):
                    has_login_in_range = True
            
            # Approval
            approved_at = elig.get('approved_at')
            if elig.get('approval_status') == 'approved':
                if is_all_time or is_in_date_range(approved_at):
                    has_approval_in_range = True
                    try:
                        file_approved_amt += float(elig.get('approved_amount') or 0)
                    except (ValueError, TypeError):
                        pass
            
            # Disbursal
            disbursed_at = elig.get('disbursed_at')
            if is_disbursed(elig):
                if is_all_time or is_in_date_range(disbursed_at):
                    has_disbursal_in_range = True
                    try:
                        file_disbursed_amt += float(elig.get('disbursed_amount') or 0)
                    except (ValueError, TypeError):
                        pass
        
        # Also count login if status is in LOGIN_AND_BEYOND
        if file_status in LOGIN_AND_BEYOND:
            # Check for any activity in range
            activities = f.get('file_activities', []) or f.get('activities', [])
            for act in activities:
                if is_in_date_range(act.get('timestamp')):
                    has_login_in_range = True
                    break
        
        if has_login_in_range:
            agent_stats[source_id]['logins'] += 1
        if has_approval_in_range:
            agent_stats[source_id]['approvals'] += 1
            agent_stats[source_id]['approved_amount'] += file_approved_amt
        if has_disbursal_in_range:
            agent_stats[source_id]['disbursals'] += 1
            agent_stats[source_id]['disbursed_amount'] += file_disbursed_amt
    
    # Sort by disbursed amount descending
    agents = sorted(agent_stats.values(), key=lambda x: -x['disbursed_amount'])
    
    # Calculate totals
    totals = {
        'files_generated': sum(a['files_generated'] for a in agents),
        'logins': sum(a['logins'] for a in agents),
        'approvals': sum(a['approvals'] for a in agents),
        'disbursals': sum(a['disbursals'] for a in agents),
        'approved_amount': sum(a['approved_amount'] for a in agents),
        'disbursed_amount': sum(a['disbursed_amount'] for a in agents)
    }
    
    return {
        "agents": agents,
        "totals": totals,
        "total_agents": len(agents),
        "date_range": {
            "start_date": start_date,
            "end_date": end_date,
            "is_all_time": is_all_time
        }
    }



