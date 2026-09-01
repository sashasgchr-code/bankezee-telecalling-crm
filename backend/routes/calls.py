"""
Call session and call log routes
"""
from fastapi import APIRouter, Depends, HTTPException
from datetime import datetime, timedelta, timezone
from typing import Optional
from bson import ObjectId

from models.schemas import CallLogCreate, CallSessionStart, CallSessionEnd, CallLogSyncRequest, MobileCallLogCreate
from utils.database import db
from utils.auth import get_current_user, require_admin
from utils.helpers import serialize_doc, serialize_docs, format_duration, convert_to_ist, normalize_phone

router = APIRouter(prefix="/api", tags=["Calls"])

# ===================== CALL SESSIONS =====================

@router.post("/call-sessions/start")
async def start_call_session(data: CallSessionStart, current_user: dict = Depends(get_current_user)):
    now = datetime.now(timezone.utc)
    
    existing = await db.call_sessions.find_one({
        "user_id": current_user["id"],
        "end_time": None
    })
    
    if existing:
        start_time = existing["start_time"]
        if start_time.tzinfo is None:
            start_time = start_time.replace(tzinfo=timezone.utc)
        session_age = (now - start_time).total_seconds()
        if session_age > 7200:
            await db.call_sessions.update_one(
                {"_id": existing["_id"]},
                {
                    "$set": {
                        "end_time": now,
                        "duration_seconds": int(session_age),
                        "outcome": "abandoned",
                        "notes": "Auto-closed stale session"
                    }
                }
            )
        else:
            raise HTTPException(status_code=400, detail="Already in an active call session")
    
    lead = await db.leads.find_one({"_id": ObjectId(data.lead_id)})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    
    session_doc = {
        "user_id": current_user["id"],
        "user_name": current_user["name"],
        "lead_id": data.lead_id,
        "lead_name": lead.get("name", "Unknown"),
        "lead_phone": lead.get("phone", ""),
        "start_time": now,
        "end_time": None,
        "duration_seconds": None,
        "outcome": None,
        "notes": None,
        "source": data.source or "web"  # Track source (web/mobile)
    }
    
    result = await db.call_sessions.insert_one(session_doc)
    session_doc["_id"] = result.inserted_id
    
    return serialize_doc(session_doc)

@router.post("/call-sessions/cancel")
async def cancel_call_session(current_user: dict = Depends(get_current_user)):
    now = datetime.now(timezone.utc)
    
    session = await db.call_sessions.find_one({
        "user_id": current_user["id"],
        "end_time": None
    })
    
    if not session:
        return {"message": "No active call session to cancel"}
    
    await db.call_sessions.update_one(
        {"_id": session["_id"]},
        {
            "$set": {
                "end_time": now,
                "duration_seconds": 0,
                "outcome": "cancelled",
                "notes": "Call cancelled by user"
            }
        }
    )
    
    return {"message": "Call session cancelled"}

@router.post("/call-sessions/end")
async def end_call_session(data: CallSessionEnd, current_user: dict = Depends(get_current_user)):
    now = datetime.now(timezone.utc)
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    
    session = await db.call_sessions.find_one({"_id": ObjectId(data.session_id)})
    if not session:
        raise HTTPException(status_code=404, detail="Call session not found")
    
    if session["user_id"] != current_user["id"]:
        raise HTTPException(status_code=403, detail="Access denied")
    
    if session["end_time"]:
        raise HTTPException(status_code=400, detail="Call session already ended")
    
    start_time = session["start_time"]
    if start_time.tzinfo is None:
        start_time = start_time.replace(tzinfo=timezone.utc)
    
    duration = int((now - start_time).total_seconds())
    form_filling_seconds = data.form_filling_seconds or 0
    
    await db.call_sessions.update_one(
        {"_id": ObjectId(data.session_id)},
        {
            "$set": {
                "end_time": now,
                "duration_seconds": duration,
                "outcome": data.outcome,
                "notes": data.notes,
                "form_filling_seconds": form_filling_seconds
            }
        }
    )
    
    # Update or create daily session with call stats
    await db.daily_sessions.update_one(
        {"user_id": current_user["id"], "date": today},
        {
            "$inc": {
                "total_call_seconds": duration,
                "total_form_filling_seconds": form_filling_seconds,
                "calls_made": 1
            },
            "$setOnInsert": {
                "user_name": current_user["name"],
                "login_time": now,
                "logout_time": None,
                "total_login_seconds": 0,
                "total_idle_seconds": 0,
                "leads_updated": 0,
                "last_activity": now,
                "is_idle": False
            }
        },
        upsert=True
    )
    
    call_log = {
        "lead_id": session["lead_id"],
        "user_id": current_user["id"],
        "user_name": current_user["name"],
        "duration": duration,
        "form_filling_seconds": form_filling_seconds,
        "outcome": data.outcome,
        "notes": data.notes,
        "created_at": now,
        "session_id": data.session_id,
        "source": session.get("source", "web"),  # Track source from session
        "call_type": "outgoing",  # Default to outgoing for sessions
        "direction": "outgoing"
    }
    await db.call_logs.insert_one(call_log)
    
    session = await db.call_sessions.find_one({"_id": ObjectId(data.session_id)})
    return serialize_doc(session)

@router.get("/call-sessions/active")
async def get_active_call_session(current_user: dict = Depends(get_current_user)):
    session = await db.call_sessions.find_one({
        "user_id": current_user["id"],
        "end_time": None
    })
    
    if session:
        return serialize_doc(session)
    return None

# ===================== CALL LOGS =====================

@router.post("/call-logs")
async def create_call_log(log: CallLogCreate, current_user: dict = Depends(get_current_user)):
    lead = await db.leads.find_one({"_id": ObjectId(log.lead_id)})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    
    if current_user["role"] == "telecaller" and lead.get("assigned_to") != current_user["id"]:
        raise HTTPException(status_code=403, detail="Access denied")
    
    now = datetime.now(timezone.utc)
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    
    call_type = log.call_type or "outgoing"
    source = log.source or "web"
    direction = log.direction or call_type  # Use direction if provided, else fallback to call_type
    
    log_doc = {
        "lead_id": log.lead_id,
        "user_id": current_user["id"],
        "user_name": current_user["name"],
        "duration": log.duration,
        "outcome": log.outcome,
        "notes": log.notes,
        "call_type": call_type,
        "source": source,  # Track source (web/mobile)
        "direction": direction,  # Track direction (outgoing/incoming)
        "created_at": now
    }
    
    result = await db.call_logs.insert_one(log_doc)
    log_doc["_id"] = result.inserted_id
    
    # Update lead with last call info
    await db.leads.update_one(
        {"_id": ObjectId(log.lead_id)},
        {"$set": {
            "last_call_at": now,
            "last_call_outcome": log.outcome,
            "last_call_duration": log.duration or 0,
            "updated_at": now
        }}
    )
    
    if current_user["role"] == "telecaller":
        # Update daily session based on call type
        if call_type == "incoming":
            # Track incoming calls separately
            await db.daily_sessions.update_one(
                {"user_id": current_user["id"], "date": today},
                {
                    "$inc": {
                        "verified_incoming_calls": 1,
                        "verified_incoming_time_seconds": log.duration or 0,
                        "total_call_seconds": log.duration or 0
                    },
                    "$setOnInsert": {
                        "user_name": current_user["name"],
                        "login_time": now,
                        "calls_made": 0,
                        "total_form_filling_seconds": 0,
                        "total_idle_seconds": 0,
                        "leads_updated": 0
                    }
                },
                upsert=True
            )
        else:
            # Track outgoing calls
            await db.daily_sessions.update_one(
                {"user_id": current_user["id"], "date": today},
                {
                    "$inc": {
                        "calls_made": 1,
                        "total_call_seconds": log.duration or 0
                    }
                }
            )
    
    return serialize_doc(log_doc)

@router.get("/call-logs")
async def list_call_logs(
    lead_id: Optional[str] = None,
    user_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    query = {}
    
    if current_user["role"] == "telecaller":
        query["user_id"] = current_user["id"]
    elif user_id:
        query["user_id"] = user_id
    
    if lead_id:
        query["lead_id"] = lead_id
    
    logs = await db.call_logs.find(query).sort("created_at", -1).to_list(1000)
    return serialize_docs(logs)

@router.get("/leads/{lead_id}/call-logs")
async def get_lead_call_logs(lead_id: str, current_user: dict = Depends(get_current_user)):
    """
    Get call logs for a lead.
    For telecallers: Only shows their own calls (hides previous agent's history)
    For admins: Shows all calls with is_previous_agent_history flag
    """
    lead = await db.leads.find_one({"_id": ObjectId(lead_id)})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    
    if current_user["role"] == "telecaller" and lead.get("assigned_to") != current_user["id"]:
        raise HTTPException(status_code=403, detail="Access denied")
    
    query = {"lead_id": lead_id}
    
    # For telecallers: Hide previous agent's call history (CLEAN SLATE)
    if current_user["role"] == "telecaller":
        query["$or"] = [
            {"is_previous_agent_history": {"$ne": True}},
            {"user_id": current_user["id"]}  # Show their own calls
        ]
    
    logs = await db.call_logs.find(query).sort("created_at", -1).to_list(100)
    return serialize_docs(logs)

@router.get("/call-outcomes")
async def get_call_outcomes(current_user: dict = Depends(get_current_user)):
    return [
        {"id": "connected", "name": "Connected", "color": "#4CAF50"},
        {"id": "not_connecting", "name": "Not Connecting", "color": "#9E9E9E"},
        {"id": "no_answer", "name": "No Answer", "color": "#F44336"},
        {"id": "busy", "name": "Busy", "color": "#FF9800"},
        {"id": "wrong_number", "name": "Wrong Number", "color": "#E91E63"},
        {"id": "voicemail", "name": "Voicemail", "color": "#9C27B0"}
    ]

# ===================== MOBILE APP CALL LOG SYNC =====================

@router.post("/call-logs/sync")
async def sync_device_call_logs(
    data: CallLogSyncRequest, 
    current_user: dict = Depends(get_current_user)
):
    """
    Sync call logs from mobile device to backend.
    Matches calls with assigned leads and creates verified call records.
    """
    if not data.call_logs:
        return {"synced": 0, "matched": 0, "verified_calls": []}
    
    # Get all leads assigned to this user
    user_leads = await db.leads.find({
        "assigned_to": current_user["id"]
    }).to_list(1000)
    
    # Create a map of normalized phone numbers to leads
    lead_phone_map = {}
    for lead in user_leads:
        if lead.get("phone"):
            normalized = normalize_phone(lead["phone"])
            if normalized:
                lead_phone_map[normalized] = lead
    
    matched_count = 0
    synced_count = 0
    verified_calls = []
    
    for device_log in data.call_logs:
        normalized_phone = normalize_phone(device_log.phone_number)
        
        if not normalized_phone:
            continue
        
        synced_count += 1
        
        # Check if this phone matches any assigned lead
        matched_lead = lead_phone_map.get(normalized_phone)
        
        if matched_lead:
            matched_count += 1
            
            # Parse timestamp
            try:
                call_timestamp = datetime.fromisoformat(device_log.timestamp.replace('Z', '+00:00'))
                if call_timestamp.tzinfo is None:
                    call_timestamp = call_timestamp.replace(tzinfo=timezone.utc)
            except (ValueError, AttributeError):
                call_timestamp = datetime.now(timezone.utc)
            
            # Check if we already have this verified call log
            existing = await db.verified_call_logs.find_one({
                "user_id": current_user["id"],
                "phone_number": normalized_phone,
                "device_timestamp": call_timestamp.isoformat()
            })
            
            if not existing:
                # Create verified call log
                verified_log = {
                    "user_id": current_user["id"],
                    "user_name": current_user.get("name", ""),
                    "lead_id": str(matched_lead["_id"]),
                    "lead_name": matched_lead.get("name", "Unknown"),
                    "phone_number": normalized_phone,
                    "original_phone": device_log.phone_number,
                    "call_type": device_log.type,
                    "duration_seconds": device_log.duration_seconds,
                    "device_timestamp": call_timestamp.isoformat(),
                    "synced_at": datetime.now(timezone.utc),
                    "source": "device_sync",
                    "is_verified": True
                }
                
                await db.verified_call_logs.insert_one(verified_log)
                
                # Calculate actual talk time
                actual_talk_time = device_log.duration_seconds if device_log.type in ['incoming', 'outgoing'] and device_log.duration_seconds > 0 else 0
                is_incoming_from_lead = device_log.type == 'incoming' and device_log.duration_seconds > 0
                
                # Update lead with last call info
                await db.leads.update_one(
                    {"_id": matched_lead["_id"]},
                    {"$set": {
                        "last_verified_call_at": call_timestamp,
                        "last_verified_call_duration": device_log.duration_seconds,
                        "last_verified_call_type": device_log.type
                    }}
                )
                
                verified_calls.append({
                    "lead_name": matched_lead.get("name", "Unknown"),
                    "phone": device_log.phone_number,
                    "type": device_log.type,
                    "duration_seconds": device_log.duration_seconds,
                    "actual_talk_time": actual_talk_time,
                    "is_incoming": is_incoming_from_lead
                })
    
    # Update daily session with verified call stats
    now = datetime.now(timezone.utc)
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    
    today_verified_logs = await db.verified_call_logs.find({
        "user_id": current_user["id"],
        "synced_at": {"$gte": today}
    }).to_list(1000)
    
    total_verified_talk_time = sum(
        log.get("duration_seconds", 0) 
        for log in today_verified_logs 
        if log.get("call_type") in ['incoming', 'outgoing'] and log.get("duration_seconds", 0) > 0
    )
    
    total_incoming_calls = sum(
        1 for log in today_verified_logs 
        if log.get("call_type") == 'incoming' and log.get("duration_seconds", 0) > 0
    )
    
    total_incoming_time = sum(
        log.get("duration_seconds", 0)
        for log in today_verified_logs 
        if log.get("call_type") == 'incoming' and log.get("duration_seconds", 0) > 0
    )
    
    await db.daily_sessions.update_one(
        {"user_id": current_user["id"], "date": today},
        {
            "$set": {
                "verified_talk_time_seconds": total_verified_talk_time,
                "verified_incoming_calls": total_incoming_calls,
                "verified_incoming_time_seconds": total_incoming_time,
                "last_call_sync": now
            }
        },
        upsert=True
    )
    
    return {
        "synced": synced_count,
        "matched": matched_count,
        "verified_calls": verified_calls
    }

@router.get("/call-logs/last-sync")
async def get_last_sync_timestamp(current_user: dict = Depends(get_current_user)):
    """Get the timestamp of last call log sync for this user"""
    now = datetime.now(timezone.utc)
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    
    session = await db.daily_sessions.find_one({
        "user_id": current_user["id"],
        "date": today
    })
    
    if session and session.get("last_call_sync"):
        return {"last_sync": session["last_call_sync"].isoformat()}
    
    return {"last_sync": None}

@router.get("/call-logs/verified")
async def get_verified_call_logs(
    date: str = None,
    user_id: str = None,
    current_user: dict = Depends(get_current_user)
):
    """Get verified call logs from device sync"""
    now = datetime.now(timezone.utc)
    
    if date:
        target_date = datetime.fromisoformat(date).replace(tzinfo=timezone.utc)
    else:
        target_date = now
    
    start_of_day = target_date.replace(hour=0, minute=0, second=0, microsecond=0)
    end_of_day = start_of_day + timedelta(days=1)
    
    query = {"synced_at": {"$gte": start_of_day, "$lt": end_of_day}}
    
    if current_user["role"] == "admin" and user_id:
        query["user_id"] = user_id
    elif current_user["role"] != "admin":
        query["user_id"] = current_user["id"]
    
    logs = await db.verified_call_logs.find(query).sort("device_timestamp", -1).to_list(500)
    
    return [serialize_doc(log) for log in logs]



@router.post("/call-logs/mobile")
async def create_mobile_call_log(log: MobileCallLogCreate, current_user: dict = Depends(get_current_user)):
    """
    Create a call log from mobile app with native call duration.
    This endpoint is called after the post-call modal is submitted in the mobile app.
    It creates a unified call log in the main call_logs collection.
    """
    lead = await db.leads.find_one({"_id": ObjectId(log.lead_id)})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    
    if current_user["role"] == "telecaller" and lead.get("assigned_to") != current_user["id"]:
        raise HTTPException(status_code=403, detail="Access denied")
    
    now = datetime.now(timezone.utc)
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    
    call_type = log.call_type or "outgoing"
    direction = "incoming" if call_type == "incoming" else "outgoing"
    
    # Parse device timestamp if provided
    device_timestamp = None
    if log.device_timestamp:
        try:
            device_timestamp = datetime.fromisoformat(log.device_timestamp.replace('Z', '+00:00'))
            if device_timestamp.tzinfo is None:
                device_timestamp = device_timestamp.replace(tzinfo=timezone.utc)
            # Validate device_timestamp is not in the future (allow 5 min tolerance for clock skew)
            max_allowed = now + timedelta(minutes=5)
            if device_timestamp > max_allowed:
                device_timestamp = now  # Reset to server time if future date
        except (ValueError, AttributeError):
            device_timestamp = now
    
    # Create unified call log in main collection
    log_doc = {
        "lead_id": log.lead_id,
        "user_id": current_user["id"],
        "user_name": current_user["name"],
        "duration": log.duration_seconds,  # Use native duration
        "duration_seconds": log.duration_seconds,  # Also store as duration_seconds for compatibility
        "outcome": log.outcome,
        "notes": log.notes,
        "call_type": call_type,
        "direction": direction,
        "source": "mobile",  # Mark as mobile source
        "device_timestamp": device_timestamp.isoformat() if device_timestamp else None,
        "is_verified": True,  # Mobile calls are verified via native call log
        "created_at": now
    }
    
    result = await db.call_logs.insert_one(log_doc)
    log_doc["_id"] = result.inserted_id
    
    # Update lead with last call info
    await db.leads.update_one(
        {"_id": ObjectId(log.lead_id)},
        {"$set": {
            "last_call_at": now,
            "last_call_outcome": log.outcome,
            "last_call_duration": log.duration_seconds,
            "last_verified_call_at": device_timestamp or now,
            "last_verified_call_duration": log.duration_seconds,
            "last_verified_call_type": call_type,
            "updated_at": now
        }}
    )
    
    # Update daily session stats for mobile calls
    if current_user["role"] == "telecaller":
        inc_data = {
            "total_call_seconds": log.duration_seconds,
            "verified_talk_time_seconds": log.duration_seconds if log.duration_seconds > 0 else 0
        }
        
        if call_type == "incoming":
            inc_data["verified_incoming_calls"] = 1
            inc_data["verified_incoming_time_seconds"] = log.duration_seconds
        else:
            inc_data["calls_made"] = 1
        
        await db.daily_sessions.update_one(
            {"user_id": current_user["id"], "date": today},
            {
                "$inc": inc_data,
                "$setOnInsert": {
                    "user_name": current_user["name"],
                    "login_time": now,
                    "total_form_filling_seconds": 0,
                    "total_idle_seconds": 0,
                    "leads_updated": 0
                }
            },
            upsert=True
        )
    
    return {
        "success": True,
        "message": "Call logged successfully",
        "call_log": serialize_doc(log_doc)
    }

@router.get("/call-logs/unified")
async def get_unified_call_logs(
    lead_id: Optional[str] = None,
    user_id: Optional[str] = None,
    date: Optional[str] = None,
    source: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """
    Get unified call logs from both web and mobile sources.
    This provides a single view of all calls regardless of platform.
    """
    query = {}
    
    # Access control
    if current_user["role"] == "telecaller":
        query["user_id"] = current_user["id"]
    elif user_id:
        query["user_id"] = user_id
    
    if lead_id:
        query["lead_id"] = lead_id
    
    if source:
        query["source"] = source
    
    if date:
        try:
            target_date = datetime.fromisoformat(date.replace('Z', '+00:00'))
            start_of_day = target_date.replace(hour=0, minute=0, second=0, microsecond=0)
            end_of_day = start_of_day + timedelta(days=1)
            query["created_at"] = {"$gte": start_of_day, "$lt": end_of_day}
        except ValueError:
            pass
    
    logs = await db.call_logs.find(query).sort("created_at", -1).to_list(500)
    
    # Enrich with source info
    enriched_logs = []
    for log in logs:
        log_data = serialize_doc(log)
        log_data["source"] = log.get("source", "web")  # Default to web for legacy logs
        log_data["is_verified"] = log.get("is_verified", log.get("source") == "mobile")
        enriched_logs.append(log_data)
    
    return enriched_logs
