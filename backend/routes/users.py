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
