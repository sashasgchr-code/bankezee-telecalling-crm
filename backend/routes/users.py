"""
User management routes
"""
from fastapi import APIRouter, Depends, HTTPException
from datetime import datetime, timedelta, timezone
from bson import ObjectId

from models.schemas import UserRegister, UserUpdate, BulkDeleteUsersRequest
from utils.database import db
from utils.auth import get_current_user, require_admin, get_password_hash
from utils.helpers import serialize_doc, serialize_docs

router = APIRouter(prefix="/api", tags=["Users"])

@router.get("/users")
async def list_users(current_user: dict = Depends(require_admin)):
    users = await db.users.find().to_list(1000)
    return serialize_docs(users)

@router.get("/users/telecallers")
async def list_telecallers(current_user: dict = Depends(get_current_user)):
    users = await db.users.find({"role": "telecaller", "is_active": True}).to_list(1000)
    return serialize_docs(users)

@router.post("/users")
async def create_user(user: UserRegister, current_user: dict = Depends(require_admin)):
    existing = await db.users.find_one({"email": user.email.lower()})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    
    user_doc = {
        "email": user.email.lower(),
        "password": get_password_hash(user.password),
        "plain_password": user.password,
        "name": user.name,
        "role": user.role,
        "phone": None,
        "is_active": True,
        "created_at": datetime.now(timezone.utc),
        "last_login": None,
        "last_activity": None
    }
    
    result = await db.users.insert_one(user_doc)
    user_doc["_id"] = result.inserted_id
    
    return serialize_doc(user_doc)

@router.put("/users/{user_id}")
async def update_user(user_id: str, update: UserUpdate, current_user: dict = Depends(require_admin)):
    update_data = {k: v for k, v in update.dict().items() if v is not None}
    if not update_data:
        raise HTTPException(status_code=400, detail="No fields to update")
    
    result = await db.users.update_one(
        {"_id": ObjectId(user_id)},
        {"$set": update_data}
    )
    
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    
    user = await db.users.find_one({"_id": ObjectId(user_id)})
    return serialize_doc(user)

@router.get("/users/{user_id}/activity")
async def get_user_activity(user_id: str, current_user: dict = Depends(require_admin)):
    user = await db.users.find_one({"_id": ObjectId(user_id)})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    
    session = await db.daily_sessions.find_one({
        "user_id": user_id,
        "date": today
    })
    
    calls_today = await db.call_logs.count_documents({
        "user_id": user_id,
        "created_at": {"$gte": today}
    })
    
    leads_assigned = await db.leads.count_documents({"assigned_to": user_id})
    
    follow_ups_pending = await db.follow_ups.count_documents({
        "user_id": user_id,
        "is_completed": False
    })
    
    return {
        "user": serialize_doc(user),
        "calls_today": calls_today,
        "leads_assigned": leads_assigned,
        "follow_ups_pending": follow_ups_pending,
        "daily_session": serialize_doc(session) if session else None
    }

@router.get("/users/{user_id}/daily-stats")
async def get_user_daily_stats(
    user_id: str, 
    days: int = 7,
    current_user: dict = Depends(require_admin)
):
    end_date = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    start_date = end_date - timedelta(days=days)
    
    sessions = await db.daily_sessions.find({
        "user_id": user_id,
        "date": {"$gte": start_date, "$lte": end_date}
    }).sort("date", -1).to_list(100)
    
    return serialize_docs(sessions)

@router.post("/users/bulk-delete")
async def bulk_delete_users(data: BulkDeleteUsersRequest, current_user: dict = Depends(require_admin)):
    if not data.user_ids:
        raise HTTPException(status_code=400, detail="No users specified")
    
    if current_user["id"] in data.user_ids:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")
    
    object_ids = [ObjectId(uid) for uid in data.user_ids]
    
    admin_count = await db.users.count_documents({
        "_id": {"$in": object_ids},
        "role": "admin"
    })
    
    if admin_count > 0:
        raise HTTPException(status_code=400, detail="Cannot bulk delete admin users")
    
    result = await db.users.delete_many({"_id": {"$in": object_ids}})
    
    return {"message": f"Deleted {result.deleted_count} users", "deleted_count": result.deleted_count}

@router.put("/users/{user_id}/file-goal")
async def set_user_file_goal(
    user_id: str,
    file_goal: int,
    current_user: dict = Depends(require_admin)
):
    """Set file goal for a telecaller"""
    result = await db.users.update_one(
        {"_id": ObjectId(user_id)},
        {"$set": {"file_goal": file_goal}}
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    return {"message": "File goal updated", "file_goal": file_goal}

@router.get("/users/pending-approval")
async def get_pending_approvals(current_user: dict = Depends(require_admin)):
    """Get all users pending approval"""
    users = await db.users.find({
        "approval_status": "pending",
        "is_approved": False
    }).sort("created_at", -1).to_list(1000)
    return serialize_docs(users)

@router.post("/users/{user_id}/approve")
async def approve_user(user_id: str, current_user: dict = Depends(require_admin)):
    """Approve a pending user registration"""
    user = await db.users.find_one({"_id": ObjectId(user_id)})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    if user.get("approval_status") != "pending":
        raise HTTPException(status_code=400, detail="User is not pending approval")
    
    result = await db.users.update_one(
        {"_id": ObjectId(user_id)},
        {"$set": {
            "is_active": True,
            "is_approved": True,
            "approval_status": "approved",
            "approved_by": current_user["id"],
            "approved_at": datetime.now(timezone.utc)
        }}
    )
    
    updated_user = await db.users.find_one({"_id": ObjectId(user_id)})
    return {
        "message": f"User {user['name']} has been approved",
        "user": serialize_doc(updated_user)
    }

@router.post("/users/{user_id}/reject")
async def reject_user(user_id: str, current_user: dict = Depends(require_admin)):
    """Reject a pending user registration"""
    user = await db.users.find_one({"_id": ObjectId(user_id)})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    if user.get("approval_status") != "pending":
        raise HTTPException(status_code=400, detail="User is not pending approval")
    
    result = await db.users.update_one(
        {"_id": ObjectId(user_id)},
        {"$set": {
            "is_active": False,
            "is_approved": False,
            "approval_status": "rejected",
            "rejected_by": current_user["id"],
            "rejected_at": datetime.now(timezone.utc)
        }}
    )
    
    return {"message": f"User {user['name']} has been rejected"}

@router.put("/users/{user_id}/map-connect")
async def map_connect_id(
    user_id: str,
    connect_id: str,
    current_user: dict = Depends(require_admin)
):
    """Map a CRM user to a Connect user ID"""
    # Check if connect_id is already mapped to another user
    existing = await db.users.find_one({
        "connect_id": connect_id,
        "_id": {"$ne": ObjectId(user_id)}
    })
    if existing:
        raise HTTPException(status_code=400, detail="Connect ID already mapped to another user")
    
    result = await db.users.update_one(
        {"_id": ObjectId(user_id)},
        {"$set": {
            "connect_id": connect_id,
            "connect_mapped_at": datetime.now(timezone.utc),
            "connect_mapped_by": current_user["id"]
        }}
    )
    
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    
    user = await db.users.find_one({"_id": ObjectId(user_id)})
    return {
        "message": "Connect ID mapped successfully",
        "user": serialize_doc(user)
    }

@router.get("/users/unmapped")
async def get_unmapped_users(current_user: dict = Depends(require_admin)):
    """Get all CRM users without a connect_id mapping"""
    users = await db.users.find({
        "$or": [
            {"connect_id": {"$exists": False}},
            {"connect_id": None},
            {"connect_id": ""}
        ]
    }).to_list(1000)
    return serialize_docs(users)

