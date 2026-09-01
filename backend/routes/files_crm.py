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


# Dashboard stats for Files
@router.get("/dashboard/stats")
async def get_files_dashboard_stats():
    """Get dashboard statistics for files"""
    pipeline = [
        {"$match": {"status": "file"}},
        {"$group": {
            "_id": "$file_status",
            "count": {"$sum": 1}
        }}
    ]
    
    status_counts = await db.leads.aggregate(pipeline).to_list(100)
    
    total_files = await db.leads.count_documents({"status": "file"})
    
    status_dict = {s["_id"]: s["count"] for s in status_counts if s["_id"]}
    
    return {
        "total_files": total_files,
        "by_status": status_dict,
        "new": status_dict.get("new", 0),
        "contacted": status_dict.get("contacted", 0),
        "documents_collected": status_dict.get("documents_collected", 0),
        "sent_to_bank": status_dict.get("sent_to_bank", 0),
        "login": status_dict.get("login", 0),
        "approved": status_dict.get("approved", 0),
        "disbursed": status_dict.get("disbursed", 0),
        "rejected": status_dict.get("rejected", 0) + status_dict.get("declined", 0) + status_dict.get("not_eligible", 0)
    }

