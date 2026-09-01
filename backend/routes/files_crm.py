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
        {"role": {"$in": ["telecaller", "admin"]}, "is_active": True},
        {"_id": 0, "id": 1, "full_name": 1, "email": 1}
    ).to_list(100)
    return ops_team


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
    file_doc = await db.leads.find_one({"id": file_id}, {"_id": 0, "eligibilities": 1})
    if not file_doc:
        raise HTTPException(status_code=404, detail="File not found")
    return file_doc.get("eligibilities", [])


@router.get("/{file_id}/activities")
async def get_file_activities(file_id: str):
    """Get file activity log"""
    file_doc = await db.leads.find_one({"id": file_id}, {"_id": 0, "file_activities": 1})
    if not file_doc:
        raise HTTPException(status_code=404, detail="File not found")
    return file_doc.get("file_activities", [])


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
    file_doc = await db.leads.find_one({"id": file_id}, {"_id": 0, "file_documents": 1})
    if not file_doc:
        raise HTTPException(status_code=404, detail="File not found")
    return file_doc.get("file_documents", [])


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
