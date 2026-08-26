"""
Follow-up management routes
"""
from fastapi import APIRouter, Depends, HTTPException
from datetime import datetime, timezone
from typing import Optional
from bson import ObjectId

from models.schemas import FollowUpCreate, FollowUpUpdate
from utils.database import db
from utils.auth import get_current_user
from utils.helpers import serialize_doc, serialize_docs

router = APIRouter(prefix="/api", tags=["Follow-ups"])

@router.post("/follow-ups")
async def create_follow_up(follow_up: FollowUpCreate, current_user: dict = Depends(get_current_user)):
    lead = await db.leads.find_one({"_id": ObjectId(follow_up.lead_id)})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    
    if current_user["role"] == "telecaller" and lead.get("assigned_to") != current_user["id"]:
        raise HTTPException(status_code=403, detail="Access denied")
    
    follow_up_doc = {
        "lead_id": follow_up.lead_id,
        "lead_name": lead.get("name", "Unknown"),
        "lead_phone": lead.get("phone", ""),
        "user_id": current_user["id"],
        "scheduled_at": follow_up.scheduled_at,
        "notes": follow_up.notes,
        "is_completed": False,
        "created_at": datetime.now(timezone.utc)
    }
    
    result = await db.follow_ups.insert_one(follow_up_doc)
    follow_up_doc["_id"] = result.inserted_id
    
    return serialize_doc(follow_up_doc)

@router.get("/follow-ups")
async def list_follow_ups(
    completed: Optional[bool] = None,
    current_user: dict = Depends(get_current_user)
):
    query = {"user_id": current_user["id"]}
    
    if completed is not None:
        query["is_completed"] = completed
    
    follow_ups = await db.follow_ups.find(query).sort("scheduled_at", 1).to_list(1000)
    return serialize_docs(follow_ups)

@router.put("/follow-ups/{follow_up_id}")
async def update_follow_up(
    follow_up_id: str,
    update: FollowUpUpdate,
    current_user: dict = Depends(get_current_user)
):
    follow_up = await db.follow_ups.find_one({"_id": ObjectId(follow_up_id)})
    if not follow_up:
        raise HTTPException(status_code=404, detail="Follow-up not found")
    
    if follow_up["user_id"] != current_user["id"] and current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Access denied")
    
    update_data = {k: v for k, v in update.dict().items() if v is not None}
    
    await db.follow_ups.update_one(
        {"_id": ObjectId(follow_up_id)},
        {"$set": update_data}
    )
    
    follow_up = await db.follow_ups.find_one({"_id": ObjectId(follow_up_id)})
    return serialize_doc(follow_up)

@router.delete("/follow-ups/{follow_up_id}")
async def delete_follow_up(follow_up_id: str, current_user: dict = Depends(get_current_user)):
    follow_up = await db.follow_ups.find_one({"_id": ObjectId(follow_up_id)})
    if not follow_up:
        raise HTTPException(status_code=404, detail="Follow-up not found")
    
    if follow_up["user_id"] != current_user["id"] and current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Access denied")
    
    await db.follow_ups.delete_one({"_id": ObjectId(follow_up_id)})
    return {"message": "Follow-up deleted"}
