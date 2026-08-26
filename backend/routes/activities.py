"""
Activity tracking routes
"""
from fastapi import APIRouter, Depends, HTTPException
from datetime import datetime, timedelta, timezone
from bson import ObjectId

from models.schemas import BreakAction
from utils.database import db
from utils.auth import get_current_user, require_admin
from utils.helpers import serialize_doc, serialize_docs

router = APIRouter(prefix="/api", tags=["Activities"])

@router.post("/activity/break")
async def record_break(data: BreakAction, current_user: dict = Depends(get_current_user)):
    """Record break start or end"""
    now = datetime.now(timezone.utc)
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    
    session = await db.daily_sessions.find_one({
        "user_id": current_user["id"],
        "date": today
    })
    
    if data.action == "start":
        await db.activity_logs.insert_one({
            "user_id": current_user["id"],
            "user_name": current_user.get("name", ""),
            "action": "break_start",
            "reason": data.reason,
            "timestamp": now,
            "date": today
        })
        
        if session:
            await db.daily_sessions.update_one(
                {"_id": session["_id"]},
                {"$set": {
                    "on_break": True,
                    "break_start_time": now
                }}
            )
        
        return {"message": "Break started", "break_start_time": now.isoformat()}
    
    elif data.action == "end":
        await db.activity_logs.insert_one({
            "user_id": current_user["id"],
            "user_name": current_user.get("name", ""),
            "action": "break_end",
            "timestamp": now,
            "date": today
        })
        
        break_duration = 0
        if session:
            break_start = session.get("break_start_time")
            
            if break_start:
                if break_start.tzinfo is None:
                    break_start = break_start.replace(tzinfo=timezone.utc)
                break_duration = (now - break_start).total_seconds()
            
            total_break_seconds = session.get("total_break_seconds", 0) + break_duration
            
            await db.daily_sessions.update_one(
                {"_id": session["_id"]},
                {"$set": {
                    "on_break": False,
                    "break_start_time": None,
                    "total_break_seconds": total_break_seconds
                }}
            )
        
        return {"message": "Break ended", "break_duration_seconds": break_duration}
    
    raise HTTPException(status_code=400, detail="Invalid action. Use 'start' or 'end'")

@router.get("/activity/my-session")
async def get_my_session(current_user: dict = Depends(get_current_user)):
    """Get current user's session info for today"""
    now = datetime.now(timezone.utc)
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    
    session = await db.daily_sessions.find_one({
        "user_id": current_user["id"],
        "date": today
    })
    
    if not session:
        return {
            "login_time": None,
            "on_break": False,
            "total_break_seconds": 0,
            "total_call_seconds": 0
        }
    
    return {
        "login_time": session.get("login_time").isoformat() if session.get("login_time") else None,
        "logout_time": session.get("logout_time").isoformat() if session.get("logout_time") else None,
        "on_break": session.get("on_break", False),
        "break_start_time": session.get("break_start_time").isoformat() if session.get("break_start_time") else None,
        "total_break_seconds": session.get("total_break_seconds", 0),
        "total_call_seconds": session.get("total_call_seconds", 0),
        "total_idle_seconds": session.get("total_idle_seconds", 0),
        "calls_made": session.get("calls_made", 0)
    }

@router.get("/activity/logs")
async def get_activity_logs(
    date: str = None,
    user_id: str = None,
    grouped: bool = True,
    current_user: dict = Depends(require_admin)
):
    """Get activity logs (admin only), optionally grouped by telecaller"""
    now = datetime.now(timezone.utc)
    
    if date:
        target_date = datetime.fromisoformat(date).replace(tzinfo=timezone.utc)
    else:
        target_date = now
    
    start_of_day = target_date.replace(hour=0, minute=0, second=0, microsecond=0)
    end_of_day = start_of_day + timedelta(days=1)
    start_naive = start_of_day.replace(tzinfo=None)
    end_naive = end_of_day.replace(tzinfo=None)
    
    query = {"timestamp": {"$gte": start_naive, "$lt": end_naive}}
    if user_id:
        query["user_id"] = user_id
    
    logs = await db.activity_logs.find(query).sort("timestamp", 1).to_list(500)
    
    if grouped:
        grouped_logs = {}
        for log in logs:
            uid = log.get("user_id", "unknown")
            user_name = log.get("user_name", "Unknown")
            if uid not in grouped_logs:
                grouped_logs[uid] = {
                    "user_id": uid,
                    "user_name": user_name,
                    "activities": []
                }
            grouped_logs[uid]["activities"].append(serialize_doc(log))
        
        for uid, data in grouped_logs.items():
            session = await db.daily_sessions.find_one({
                "user_id": uid,
                "date": {"$gte": start_of_day, "$lt": end_of_day}
            })
            
            call_logs = await db.call_logs.find({
                "user_id": uid,
                "created_at": {"$gte": start_of_day, "$lt": end_of_day}
            }).to_list(1000)
            
            data["total_call_seconds"] = sum(log.get("duration", 0) or 0 for log in call_logs)
            data["total_form_filling_seconds"] = sum(log.get("form_filling_seconds", 0) or 0 for log in call_logs)
            
            if session:
                data["total_break_seconds"] = session.get("total_break_seconds", 0)
            else:
                data["total_break_seconds"] = 0
        
        return list(grouped_logs.values())
    
    return [serialize_doc(log) for log in logs]

@router.post("/activity/ping")
async def activity_ping(current_user: dict = Depends(get_current_user)):
    now = datetime.now(timezone.utc)
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    
    await db.users.update_one(
        {"_id": ObjectId(current_user["id"])},
        {"$set": {"last_activity": now}}
    )
    
    session = await db.daily_sessions.find_one({
        "user_id": current_user["id"],
        "date": today
    })
    
    if session:
        last_activity = session.get("last_activity", now)
        if last_activity.tzinfo is None:
            last_activity = last_activity.replace(tzinfo=timezone.utc)
        time_diff = (now - last_activity).total_seconds()
        
        if time_diff > 300:
            idle_time = time_diff - 300
            await db.daily_sessions.update_one(
                {"_id": session["_id"]},
                {
                    "$set": {"last_activity": now, "is_idle": False},
                    "$inc": {"total_idle_seconds": idle_time}
                }
            )
        else:
            await db.daily_sessions.update_one(
                {"_id": session["_id"]},
                {"$set": {"last_activity": now, "is_idle": False}}
            )
    
    return {"status": "ok", "timestamp": now.isoformat()}

@router.get("/activity/my-stats")
async def get_my_activity_stats(current_user: dict = Depends(get_current_user)):
    now = datetime.now(timezone.utc)
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    
    session = await db.daily_sessions.find_one({
        "user_id": current_user["id"],
        "date": today
    })
    
    active_call = await db.call_sessions.find_one({
        "user_id": current_user["id"],
        "end_time": None
    })
    
    call_logs_today = await db.call_logs.find({
        "user_id": current_user["id"],
        "created_at": {"$gte": today}
    }).to_list(1000)
    
    calls_made_today = len(call_logs_today)
    total_call_seconds_today = sum(log.get("duration", 0) or 0 for log in call_logs_today)
    
    if session:
        login_time = session.get("login_time", now)
        if login_time.tzinfo is None:
            login_time = login_time.replace(tzinfo=timezone.utc)
        current_login_seconds = (now - login_time).total_seconds()
        
        actual_calls = max(session.get("calls_made", 0), calls_made_today)
        actual_call_seconds = max(session.get("total_call_seconds", 0), total_call_seconds_today)
        
        return {
            "date": today.isoformat(),
            "login_time": session.get("login_time"),
            "total_login_seconds": current_login_seconds,
            "total_call_seconds": actual_call_seconds,
            "total_idle_seconds": session.get("total_idle_seconds", 0),
            "calls_made": actual_calls,
            "leads_updated": session.get("leads_updated", 0),
            "is_idle": session.get("is_idle", False),
            "active_call": serialize_doc(active_call) if active_call else None
        }
    
    return {
        "date": today.isoformat(),
        "login_time": None,
        "total_login_seconds": 0,
        "total_call_seconds": total_call_seconds_today,
        "total_idle_seconds": 0,
        "calls_made": calls_made_today,
        "leads_updated": 0,
        "is_idle": False,
        "active_call": serialize_doc(active_call) if active_call else None
    }
