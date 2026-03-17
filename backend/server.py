from fastapi import FastAPI, APIRouter, HTTPException, Depends, UploadFile, File, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime, timedelta, timezone
from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorClient
import os
import json
import pandas as pd
import io
from dotenv import load_dotenv
from passlib.context import CryptContext
from jose import JWTError, jwt
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "bankezee_connect")

# JWT settings
SECRET_KEY = os.environ.get("JWT_SECRET", "bankezee_connect_secret_key_2025")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_DAYS = 7

# Password hashing
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
security = HTTPBearer()

# MongoDB client
client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

app = FastAPI(title="BANKEZEE Connect API")

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

router = APIRouter(prefix="/api")

# IST timezone offset (UTC+5:30)
IST_OFFSET = timedelta(hours=5, minutes=30)

def convert_to_ist(dt):
    """Convert a datetime to IST"""
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    ist_time = dt + IST_OFFSET
    return ist_time.replace(tzinfo=None)  # Return naive datetime for JSON serialization

# Helper to serialize ObjectId and convert timestamps to IST
def serialize_doc(doc):
    if doc is None:
        return None
    doc["id"] = str(doc.pop("_id"))
    # Convert timestamp fields to IST
    if "timestamp" in doc and doc["timestamp"]:
        doc["timestamp"] = convert_to_ist(doc["timestamp"]).isoformat()
    if "created_at" in doc and doc["created_at"]:
        doc["created_at"] = convert_to_ist(doc["created_at"]).isoformat()
    if "updated_at" in doc and doc["updated_at"]:
        doc["updated_at"] = convert_to_ist(doc["updated_at"]).isoformat()
    if "login_time" in doc and doc["login_time"]:
        doc["login_time"] = convert_to_ist(doc["login_time"]).isoformat()
    if "logout_time" in doc and doc["logout_time"]:
        doc["logout_time"] = convert_to_ist(doc["logout_time"]).isoformat()
    return doc

def serialize_docs(docs):
    return [serialize_doc(doc) for doc in docs]

# ===================== PYDANTIC MODELS =====================

class UserRegister(BaseModel):
    email: str
    password: str
    name: str
    role: str = "telecaller"

class UserLogin(BaseModel):
    email: str
    password: str

class UserUpdate(BaseModel):
    name: Optional[str] = None
    is_active: Optional[bool] = None
    role: Optional[str] = None
    phone: Optional[str] = None

class LeadCreate(BaseModel):
    name: str
    phone: str
    email: Optional[str] = None
    source: Optional[str] = None
    city: Optional[str] = None
    status: str = "new"
    notes: Optional[str] = None
    custom_fields: Optional[dict] = None

class LeadUpdate(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    source: Optional[str] = None
    city: Optional[str] = None
    status: Optional[str] = None
    notes: Optional[str] = None
    custom_fields: Optional[dict] = None
    assigned_to: Optional[str] = None
    last_call_outcome: Optional[str] = None

class LeadAssign(BaseModel):
    lead_ids: List[str]
    user_id: str

class AutoDistribute(BaseModel):
    lead_ids: List[str]

class CallLogCreate(BaseModel):
    lead_id: str
    duration: Optional[int] = None
    outcome: str
    notes: Optional[str] = None

class CallSessionStart(BaseModel):
    lead_id: str

class CallSessionEnd(BaseModel):
    session_id: str
    outcome: str
    notes: Optional[str] = None
    duration: Optional[int] = None
    form_filling_seconds: Optional[int] = None

class ActivityPing(BaseModel):
    pass  # Just a heartbeat

class FollowUpCreate(BaseModel):
    lead_id: str
    scheduled_at: datetime
    notes: Optional[str] = None

class FollowUpUpdate(BaseModel):
    scheduled_at: Optional[datetime] = None
    notes: Optional[str] = None
    is_completed: Optional[bool] = None

# ===================== AUTH HELPERS =====================

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)

def create_access_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(days=ACCESS_TOKEN_EXPIRE_DAYS)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    try:
        token = credentials.credentials
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = payload.get("user_id")
        if user_id is None:
            raise HTTPException(status_code=401, detail="Invalid token")
        
        user = await db.users.find_one({"_id": ObjectId(user_id)})
        if user is None:
            raise HTTPException(status_code=401, detail="User not found")
        if not user.get("is_active", True):
            raise HTTPException(status_code=401, detail="User is deactivated")
        
        return serialize_doc(user)
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")

async def require_admin(current_user: dict = Depends(get_current_user)):
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return current_user

# ===================== AUTH ROUTES =====================

@router.post("/auth/register")
async def register(user: UserRegister):
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
    
    token = create_access_token({"user_id": str(result.inserted_id)})
    
    return {
        "token": token,
        "user": serialize_doc(user_doc)
    }

@router.post("/auth/login")
async def login(credentials: UserLogin):
    user = await db.users.find_one({"email": credentials.email.lower()})
    if not user:
        raise HTTPException(status_code=401, detail="Invalid email or password")
    
    if not verify_password(credentials.password, user["password"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    
    if not user.get("is_active", True):
        raise HTTPException(status_code=401, detail="Account is deactivated")
    
    now = datetime.now(timezone.utc)
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    
    await db.users.update_one(
        {"_id": user["_id"]},
        {"$set": {"last_login": now, "last_activity": now}}
    )
    
    # Record login in activity logs
    await db.activity_logs.insert_one({
        "user_id": str(user["_id"]),
        "user_name": user.get("name", ""),
        "action": "login",
        "timestamp": now,
        "date": today
    })
    
    if user.get("role") == "telecaller":
        existing_session = await db.daily_sessions.find_one({
            "user_id": str(user["_id"]),
            "date": today
        })
        
        if not existing_session:
            await db.daily_sessions.insert_one({
                "user_id": str(user["_id"]),
                "user_name": user["name"],
                "date": today,
                "login_time": now,
                "logout_time": None,
                "total_login_seconds": 0,
                "total_call_seconds": 0,
                "total_idle_seconds": 0,
                "calls_made": 0,
                "leads_updated": 0,
                "last_activity": now,
                "is_idle": False
            })
    
    token = create_access_token({"user_id": str(user["_id"])})
    
    return {
        "token": token,
        "user": serialize_doc(user)
    }

@router.get("/auth/me")
async def get_me(current_user: dict = Depends(get_current_user)):
    return current_user

class ChangePassword(BaseModel):
    current_password: str
    new_password: str

@router.post("/auth/change-password")
async def change_password(data: ChangePassword, current_user: dict = Depends(get_current_user)):
    user = await db.users.find_one({"_id": ObjectId(current_user["id"])})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    if not verify_password(data.current_password, user["password"]):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    
    if len(data.new_password) < 6:
        raise HTTPException(status_code=400, detail="New password must be at least 6 characters")
    
    new_password_hash = get_password_hash(data.new_password)
    await db.users.update_one(
        {"_id": ObjectId(current_user["id"])},
        {"$set": {
            "password": new_password_hash,
            "plain_password": data.new_password
        }}
    )
    
    return {"message": "Password changed successfully"}

@router.post("/auth/logout")
async def logout(current_user: dict = Depends(get_current_user)):
    """Record logout time for the user"""
    now = datetime.now(timezone.utc)
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    
    # Update daily session with logout time
    session = await db.daily_sessions.find_one({
        "user_id": current_user["id"],
        "date": today
    })
    
    if session:
        login_time = session.get("login_time", now)
        if login_time.tzinfo is None:
            login_time = login_time.replace(tzinfo=timezone.utc)
        
        total_login_seconds = (now - login_time).total_seconds()
        
        await db.daily_sessions.update_one(
            {"_id": session["_id"]},
            {"$set": {
                "logout_time": now,
                "total_login_seconds": total_login_seconds
            }}
        )
    
    # Record logout in activity log
    await db.activity_logs.insert_one({
        "user_id": current_user["id"],
        "user_name": current_user.get("name", ""),
        "action": "logout",
        "timestamp": now,
        "date": today
    })
    
    return {"message": "Logged out successfully"}

class BreakAction(BaseModel):
    action: str  # "start" or "end"
    reason: str = None

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
        # Start break
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
        # End break
        await db.activity_logs.insert_one({
            "user_id": current_user["id"],
            "user_name": current_user.get("name", ""),
            "action": "break_end",
            "timestamp": now,
            "date": today
        })
        
        if session:
            break_start = session.get("break_start_time")
            break_duration = 0
            
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
        # Group logs by user_id
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
        
        # Enrich with daily session stats (call time, break time, form filling time)
        for uid, data in grouped_logs.items():
            # Get daily session for this user on this date
            session = await db.daily_sessions.find_one({
                "user_id": uid,
                "date": {"$gte": start_date, "$lt": end_date}
            })
            
            if session:
                data["total_call_seconds"] = session.get("total_call_seconds", 0)
                data["total_break_seconds"] = session.get("total_break_seconds", 0)
                data["total_form_filling_seconds"] = session.get("total_form_filling_seconds", 0)
            else:
                # Fallback: calculate from call_logs for this user on this date
                call_logs = await db.call_logs.find({
                    "user_id": uid,
                    "created_at": {"$gte": start_date, "$lt": end_date}
                }).to_list(1000)
                data["total_call_seconds"] = sum(log.get("duration", 0) or 0 for log in call_logs)
                data["total_form_filling_seconds"] = sum(log.get("form_filling_seconds", 0) or 0 for log in call_logs)
                data["total_break_seconds"] = 0
        
        return list(grouped_logs.values())
    
    return [serialize_doc(log) for log in logs]

# ===================== ACTIVITY TRACKING =====================

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
        # Ensure last_activity is timezone-aware
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
    
    # Also get call stats directly from call_logs for today
    call_logs_today = await db.call_logs.find({
        "user_id": current_user["id"],
        "created_at": {"$gte": today}
    }).to_list(1000)
    
    calls_made_today = len(call_logs_today)
    total_call_seconds_today = sum(log.get("duration", 0) or 0 for log in call_logs_today)
    
    if session:
        login_time = session.get("login_time", now)
        # Ensure login_time is timezone-aware
        if login_time.tzinfo is None:
            login_time = login_time.replace(tzinfo=timezone.utc)
        current_login_seconds = (now - login_time).total_seconds()
        
        # Use the higher value between session and actual call logs
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
    
    # No session but might have call logs
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

# ===================== CALL SESSION TRACKING =====================

@router.post("/call-sessions/start")
async def start_call_session(data: CallSessionStart, current_user: dict = Depends(get_current_user)):
    now = datetime.now(timezone.utc)
    
    existing = await db.call_sessions.find_one({
        "user_id": current_user["id"],
        "end_time": None
    })
    
    if existing:
        # Ensure start_time is timezone-aware
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
        "notes": None
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
    
    # Ensure start_time is timezone-aware
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
    
    # Update or create daily session with call stats (including form filling time)
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
        "session_id": data.session_id
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

# ===================== USER MANAGEMENT =====================

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

# ===================== LEAD MANAGEMENT =====================

@router.get("/leads")
async def list_leads(
    status: Optional[str] = None,
    assigned_to: Optional[str] = None,
    search: Optional[str] = None,
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
    
    if search:
        query["$or"] = [
            {"name": {"$regex": search, "$options": "i"}},
            {"phone": {"$regex": search, "$options": "i"}},
            {"email": {"$regex": search, "$options": "i"}}
        ]
    
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

class BulkDeleteRequest(BaseModel):
    lead_ids: List[str]

@router.post("/leads/bulk-delete")
async def bulk_delete_leads(data: BulkDeleteRequest, current_user: dict = Depends(require_admin)):
    if not data.lead_ids:
        raise HTTPException(status_code=400, detail="No leads specified")
    
    object_ids = [ObjectId(lid) for lid in data.lead_ids]
    result = await db.leads.delete_many({"_id": {"$in": object_ids}})
    
    return {"message": f"Deleted {result.deleted_count} leads", "deleted_count": result.deleted_count}

class BulkDeleteUsersRequest(BaseModel):
    user_ids: List[str]

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

# ===================== LEAD IMPORT =====================

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

# ===================== LEAD ASSIGNMENT =====================

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
    
    log_doc = {
        "lead_id": log.lead_id,
        "user_id": current_user["id"],
        "user_name": current_user["name"],
        "duration": log.duration,
        "outcome": log.outcome,
        "notes": log.notes,
        "created_at": now
    }
    
    result = await db.call_logs.insert_one(log_doc)
    log_doc["_id"] = result.inserted_id
    
    if current_user["role"] == "telecaller":
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
    lead = await db.leads.find_one({"_id": ObjectId(lead_id)})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    
    if current_user["role"] == "telecaller" and lead.get("assigned_to") != current_user["id"]:
        raise HTTPException(status_code=403, detail="Access denied")
    
    logs = await db.call_logs.find({"lead_id": lead_id}).sort("created_at", -1).to_list(100)
    return serialize_docs(logs)

@router.get("/reports/detailed-calls")
async def get_detailed_call_report(
    from_date: str = None,
    to_date: str = None,
    telecaller_id: str = None,
    current_user: dict = Depends(require_admin)
):
    """Get detailed call report with customer info, call outcome, duration, and caller name"""
    now = datetime.now(timezone.utc)
    
    # Build date filter
    query = {}
    if from_date and to_date:
        start_date = datetime.fromisoformat(from_date.replace('Z', '+00:00')).replace(tzinfo=timezone.utc)
        end_date = datetime.fromisoformat(to_date.replace('Z', '+00:00')).replace(tzinfo=timezone.utc) + timedelta(days=1)
        query["created_at"] = {"$gte": start_date, "$lt": end_date}
    elif from_date:
        start_date = datetime.fromisoformat(from_date.replace('Z', '+00:00')).replace(tzinfo=timezone.utc)
        query["created_at"] = {"$gte": start_date}
    else:
        # Default to today
        today = now.replace(hour=0, minute=0, second=0, microsecond=0)
        query["created_at"] = {"$gte": today}
    
    # Filter by telecaller if specified
    if telecaller_id and telecaller_id != "all":
        query["user_id"] = telecaller_id
    
    # Fetch call logs
    call_logs = await db.call_logs.find(query).sort("created_at", -1).to_list(10000)
    
    # Enrich with lead information
    detailed_calls = []
    for log in call_logs:
        lead_id = log.get("lead_id")
        lead = None
        if lead_id:
            try:
                lead = await db.leads.find_one({"_id": ObjectId(lead_id)})
            except:
                pass
        
        # Convert timestamp to IST for display
        call_time = log.get("created_at")
        if call_time:
            call_time_ist = to_ist(call_time) if call_time.tzinfo else to_ist(call_time.replace(tzinfo=timezone.utc))
        else:
            call_time_ist = None
        
        detailed_calls.append({
            "id": str(log.get("_id", "")),
            "call_date": call_time_ist.strftime("%Y-%m-%d") if call_time_ist else "",
            "call_time": call_time_ist.strftime("%I:%M %p") if call_time_ist else "",
            "caller_name": log.get("user_name", "Unknown"),
            "caller_id": log.get("user_id", ""),
            "customer_name": lead.get("name", "Unknown") if lead else log.get("lead_name", "Unknown"),
            "customer_phone": lead.get("phone", "") if lead else log.get("lead_phone", ""),
            "customer_email": lead.get("email", "") if lead else "",
            "customer_city": lead.get("city", "") if lead else "",
            "customer_source": lead.get("source", "") if lead else "",
            "lead_status": lead.get("status", "") if lead else "",
            "call_outcome": log.get("outcome", ""),
            "call_duration_seconds": log.get("duration", 0) or 0,
            "call_duration_formatted": format_duration(log.get("duration", 0) or 0),
            "form_filling_seconds": log.get("form_filling_seconds", 0) or 0,
            "form_filling_formatted": format_duration(log.get("form_filling_seconds", 0) or 0),
            "notes": log.get("notes", ""),
        })
    
    return {
        "calls": detailed_calls,
        "total_count": len(detailed_calls),
        "from_date": from_date,
        "to_date": to_date
    }

def format_duration(seconds):
    """Format seconds into human readable duration"""
    if not seconds:
        return "0s"
    minutes = int(seconds // 60)
    secs = int(seconds % 60)
    if minutes > 0:
        return f"{minutes}m {secs}s"
    return f"{secs}s"

# ===================== FOLLOW-UPS =====================

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

# ===================== STATUSES =====================

@router.get("/statuses")
async def get_statuses(current_user: dict = Depends(get_current_user)):
    # Update statuses - used when call is connected
    return [
        {"id": "not_interested", "name": "Not Interested", "color": "#9E9E9E"},
        {"id": "follow_up", "name": "Follow Up", "color": "#9C27B0"},
        {"id": "presentation", "name": "Presentation", "color": "#673AB7"},
        {"id": "leads", "name": "Lead", "color": "#00C853"},
        {"id": "file", "name": "File", "color": "#FF9800"}
    ]

@router.get("/call-outcomes")
async def get_call_outcomes(current_user: dict = Depends(get_current_user)):
    # Call outcomes
    return [
        {"id": "connected", "name": "Connected", "color": "#4CAF50"},
        {"id": "not_connecting", "name": "Not Connecting", "color": "#9E9E9E"},
        {"id": "no_answer", "name": "No Answer", "color": "#F44336"},
        {"id": "busy", "name": "Busy", "color": "#FF9800"},
        {"id": "wrong_number", "name": "Wrong Number", "color": "#E91E63"},
        {"id": "voicemail", "name": "Voicemail", "color": "#9C27B0"}
    ]

# ===================== DASHBOARD & REPORTING =====================

@router.get("/dashboard/stats")
async def get_dashboard_stats(
    period: str = "today",
    telecaller_id: str = None,
    from_date: str = None,
    to_date: str = None,
    current_user: dict = Depends(get_current_user)
):
    now = datetime.now(timezone.utc)
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    today_naive = today.replace(tzinfo=None)  # For MongoDB comparison with naive datetimes
    
    # If custom date range is provided, use it
    if from_date and to_date:
        start_date = datetime.fromisoformat(from_date.replace('Z', '+00:00')).replace(tzinfo=timezone.utc)
        end_date = datetime.fromisoformat(to_date.replace('Z', '+00:00')).replace(tzinfo=timezone.utc) + timedelta(days=1)
        period = "custom"
    elif period == "today":
        start_date = today
        end_date = None
    elif period == "this_week":
        start_date = today - timedelta(days=today.weekday())
        end_date = None
    elif period == "this_month":
        start_date = today.replace(day=1)
        end_date = None
    elif period == "last_month":
        first_of_this_month = today.replace(day=1)
        last_month = first_of_this_month - timedelta(days=1)
        start_date = last_month.replace(day=1)
        end_date = first_of_this_month
    elif period == "all_time":
        start_date = None
        end_date = None
    else:
        start_date = today
        end_date = None
    
    if current_user["role"] == "admin":
        leads_filter = {}
        calls_filter = {}
        
        if telecaller_id and telecaller_id != "all":
            leads_filter["assigned_to"] = telecaller_id
            calls_filter["user_id"] = telecaller_id
        
        if period == "all_time":
            leads_time_filter = {}
            calls_time_query = {}
        elif end_date:
            leads_time_filter = {"updated_at": {"$gte": start_date, "$lt": end_date}}
            leads_created_filter = {"created_at": {"$gte": start_date, "$lt": end_date}}
            calls_time_query = {"created_at": {"$gte": start_date, "$lt": end_date}}
        else:
            leads_time_filter = {"updated_at": {"$gte": start_date}}
            leads_created_filter = {"created_at": {"$gte": start_date}}
            calls_time_query = {"created_at": {"$gte": start_date}}
        
        # Unused data = data in "new" status that was created BEFORE today (not today's data)
        unused_data = await db.leads.count_documents({
            **leads_filter, 
            "status": "new",
            "created_at": {"$lt": today_naive}
        })
        
        if period == "all_time":
            total_data = await db.leads.count_documents(leads_filter)
        else:
            total_data = await db.leads.count_documents({**leads_filter, **leads_created_filter})
        
        connected = await db.call_logs.count_documents({**calls_filter, **calls_time_query})
        
        if period == "all_time":
            total_leads_generated = await db.leads.count_documents({
                **leads_filter, 
                "status": {"$in": ["leads", "converted"]}
            })
        else:
            total_leads_generated = await db.leads.count_documents({
                **leads_filter, 
                **leads_time_filter,
                "status": {"$in": ["leads", "converted"]}
            })
        
        if period == "all_time":
            total_file = await db.leads.count_documents({**leads_filter, "status": "file"})
        else:
            total_file = await db.leads.count_documents({
                **leads_filter, 
                **leads_time_filter,
                "status": "file"
            })
        
        # Status breakdown - MUST apply date filter
        if period == "all_time":
            status_match = leads_filter if leads_filter else {}
        else:
            status_match = {**leads_filter, **leads_time_filter} if leads_filter else leads_time_filter
        
        if status_match:
            pipeline = [
                {"$match": status_match},
                {"$group": {"_id": "$status", "count": {"$sum": 1}}}
            ]
        else:
            pipeline = [{"$group": {"_id": "$status", "count": {"$sum": 1}}}]
        status_counts = await db.leads.aggregate(pipeline).to_list(20)
        
        if period == "all_time":
            if telecaller_id and telecaller_id != "all":
                user_pipeline = [
                    {"$match": {"user_id": telecaller_id}},
                    {"$group": {"_id": "$user_name", "count": {"$sum": 1}}}
                ]
            else:
                user_pipeline = [
                    {"$group": {"_id": "$user_name", "count": {"$sum": 1}}}
                ]
        else:
            if telecaller_id and telecaller_id != "all":
                user_pipeline = [
                    {"$match": {**calls_time_query, "user_id": telecaller_id}},
                    {"$group": {"_id": "$user_name", "count": {"$sum": 1}}}
                ]
            else:
                user_pipeline = [
                    {"$match": calls_time_query},
                    {"$group": {"_id": "$user_name", "count": {"$sum": 1}}}
                ]
        calls_per_user = await db.call_logs.aggregate(user_pipeline).to_list(100)
        
        # Count telecallers who made at least 1 call in the selected period
        if period == "all_time":
            active_telecallers_pipeline = [
                {"$group": {"_id": "$user_id"}},
                {"$count": "count"}
            ]
        else:
            active_telecallers_pipeline = [
                {"$match": calls_time_query},
                {"$group": {"_id": "$user_id"}},
                {"$count": "count"}
            ]
        active_result = await db.call_logs.aggregate(active_telecallers_pipeline).to_list(1)
        active_telecallers = active_result[0]["count"] if active_result else 0
        
        return {
            "total_data": total_data,
            "unused_data": unused_data,
            "connected": connected,
            "total_leads_generated": total_leads_generated,
            "total_file": total_file,
            "leads_by_status": {s["_id"]: s["count"] for s in status_counts},
            "calls_per_user": {c["_id"]: c["count"] for c in calls_per_user},
            "active_telecallers": active_telecallers,
            "period": period,
            "telecaller_id": telecaller_id
        }
    else:
        user_id = current_user["id"]
        
        if period == "all_time":
            leads_time_filter = {}
            leads_created_filter = {}
            calls_time_filter = {}
        elif end_date:
            leads_time_filter = {"updated_at": {"$gte": start_date, "$lt": end_date}}
            leads_created_filter = {"created_at": {"$gte": start_date, "$lt": end_date}}
            calls_time_filter = {"created_at": {"$gte": start_date, "$lt": end_date}}
        else:
            leads_time_filter = {"updated_at": {"$gte": start_date}}
            leads_created_filter = {"created_at": {"$gte": start_date}}
            calls_time_filter = {"created_at": {"$gte": start_date}}
        
        # Unused data = data in "new" status that was created BEFORE today (not today's data)
        my_unused_data = await db.leads.count_documents({
            "assigned_to": user_id, 
            "status": "new",
            "created_at": {"$lt": today_naive}
        })
        
        if period == "all_time":
            my_data = await db.leads.count_documents({"assigned_to": user_id})
        else:
            my_data = await db.leads.count_documents({"assigned_to": user_id, **leads_created_filter})
        
        if period == "all_time":
            my_file = await db.leads.count_documents({"assigned_to": user_id, "status": "file"})
        else:
            my_file = await db.leads.count_documents({
                "assigned_to": user_id, 
                "status": "file",
                **leads_time_filter
            })
        
        if period == "all_time":
            my_leads_generated = await db.leads.count_documents({
                "assigned_to": user_id, 
                "status": {"$in": ["leads", "converted"]}
            })
        else:
            my_leads_generated = await db.leads.count_documents({
                "assigned_to": user_id, 
                "status": {"$in": ["leads", "converted"]},
                **leads_time_filter
            })
        
        # Status breakdown - MUST apply date filter
        if period == "all_time":
            status_match = {"assigned_to": user_id}
        else:
            status_match = {"assigned_to": user_id, **leads_time_filter}
        
        pipeline = [
            {"$match": status_match},
            {"$group": {"_id": "$status", "count": {"$sum": 1}}}
        ]
        status_counts = await db.leads.aggregate(pipeline).to_list(20)
        
        # Get call outcome counts for this user
        call_logs = await db.call_logs.find({"user_id": user_id, **calls_time_filter}).to_list(10000)
        my_calls_connected = sum(1 for log in call_logs if log.get("outcome") == "connected")
        my_calls_not_connecting = sum(1 for log in call_logs if log.get("outcome") == "not_connecting")
        my_calls_no_answer = sum(1 for log in call_logs if log.get("outcome") == "no_answer")
        my_calls_wrong_number = sum(1 for log in call_logs if log.get("outcome") == "wrong_number")
        my_calls_busy = sum(1 for log in call_logs if log.get("outcome") == "busy")
        my_calls_voicemail = sum(1 for log in call_logs if log.get("outcome") == "voicemail")
        
        session = await db.daily_sessions.find_one({
            "user_id": user_id,
            "date": today
        })
        
        return {
            "my_data": my_data,
            "my_unused_data": my_unused_data,
            "my_connected": len(call_logs),
            "my_file": my_file,
            "my_leads_generated": my_leads_generated,
            "leads_by_status": {s["_id"]: s["count"] for s in status_counts if s["_id"]},
            "call_outcomes": {
                "connected": my_calls_connected,
                "not_connecting": my_calls_not_connecting,
                "no_answer": my_calls_no_answer,
                "wrong_number": my_calls_wrong_number,
                "busy": my_calls_busy,
                "voicemail": my_calls_voicemail
            },
            "daily_session": serialize_doc(session) if session else None,
            "period": period
        }

@router.get("/dashboard/recent-calls")
async def get_recent_calls(limit: int = 10, current_user: dict = Depends(get_current_user)):
    query = {}
    if current_user["role"] == "telecaller":
        query["user_id"] = current_user["id"]
    
    calls = await db.call_logs.find(query).sort("created_at", -1).limit(limit).to_list(limit)
    
    enriched_calls = []
    for call in calls:
        lead = await db.leads.find_one({"_id": ObjectId(call["lead_id"])})
        call_data = serialize_doc(call)
        if lead:
            call_data["lead_name"] = lead.get("name", "Unknown")
            call_data["lead_phone"] = lead.get("phone", "")
        enriched_calls.append(call_data)
    
    return enriched_calls

# ===================== DETAILED REPORTS =====================

@router.get("/reports/telecallers")
async def get_telecaller_reports(
    period: str = "today",
    from_date: str = None,
    to_date: str = None,
    current_user: dict = Depends(require_admin)
):
    now = datetime.now(timezone.utc)
    end_date = None
    
    # If custom date range is provided, use it
    if from_date and to_date:
        start_date = datetime.fromisoformat(from_date.replace('Z', '+00:00')).replace(tzinfo=timezone.utc)
        end_date = datetime.fromisoformat(to_date.replace('Z', '+00:00')).replace(tzinfo=timezone.utc) + timedelta(days=1)
        period = "custom"
    elif period == "today":
        start_date = now.replace(hour=0, minute=0, second=0, microsecond=0)
        end_date = start_date + timedelta(days=1)
    elif period == "week":
        start_date = now - timedelta(days=now.weekday())
        start_date = start_date.replace(hour=0, minute=0, second=0, microsecond=0)
        end_date = now + timedelta(days=1)
    elif period == "month":
        start_date = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        end_date = now + timedelta(days=1)
    elif period == "three_months":
        start_date = now - timedelta(days=90)
        start_date = start_date.replace(hour=0, minute=0, second=0, microsecond=0)
        end_date = now + timedelta(days=1)
    elif period == "lifetime":
        start_date = None
        end_date = None
    else:
        start_date = None
        end_date = None
    
    telecallers = await db.users.find({"role": "telecaller"}).to_list(100)
    
    telecaller_reports = []
    total_calls = 0
    total_leads_generated = 0
    total_file = 0
    total_presentations = 0
    total_call_seconds = 0
    total_idle_seconds = 0
    total_form_filling_seconds = 0
    
    for telecaller in telecallers:
        user_id = str(telecaller["_id"])
        
        # Build lead time filter for this user
        lead_base_filter = {"assigned_to": user_id}
        if start_date and end_date:
            lead_time_filter = {"assigned_to": user_id, "updated_at": {"$gte": start_date, "$lt": end_date}}
            lead_created_filter = {"assigned_to": user_id, "created_at": {"$gte": start_date, "$lt": end_date}}
        elif start_date:
            lead_time_filter = {"assigned_to": user_id, "updated_at": {"$gte": start_date}}
            lead_created_filter = {"assigned_to": user_id, "created_at": {"$gte": start_date}}
        else:
            lead_time_filter = lead_base_filter
            lead_created_filter = lead_base_filter
        
        # Total leads assigned (created in period)
        if start_date:
            total_leads = await db.leads.count_documents(lead_created_filter)
        else:
            total_leads = await db.leads.count_documents(lead_base_filter)
        
        # Leads generated - status updated to leads/converted within the period
        user_leads_generated = await db.leads.count_documents({
            **lead_time_filter,
            "status": {"$in": ["leads", "converted"]}
        })
        
        # File leads - status updated to file within the period
        user_file = await db.leads.count_documents({
            **lead_time_filter,
            "status": "file"
        })
        
        # Presentation leads - status updated to presentation within the period
        user_presentations = await db.leads.count_documents({
            **lead_time_filter,
            "status": "presentation"
        })
        
        call_query = {"user_id": user_id}
        if start_date and end_date:
            call_query["created_at"] = {"$gte": start_date, "$lt": end_date}
        elif start_date:
            call_query["created_at"] = {"$gte": start_date}
        
        # Get call logs with duration
        user_call_logs = await db.call_logs.find(call_query).to_list(10000)
        user_total_calls = len(user_call_logs)
        
        # Calculate total call seconds and form filling seconds from call_logs directly
        user_call_seconds_from_logs = sum(log.get("duration", 0) or 0 for log in user_call_logs)
        user_form_filling_seconds = sum(log.get("form_filling_seconds", 0) or 0 for log in user_call_logs)
        
        # Count call outcomes
        calls_connected = sum(1 for log in user_call_logs if log.get("outcome") == "connected")
        calls_not_connecting = sum(1 for log in user_call_logs if log.get("outcome") == "not_connecting")
        calls_no_answer = sum(1 for log in user_call_logs if log.get("outcome") == "no_answer")
        calls_wrong_number = sum(1 for log in user_call_logs if log.get("outcome") == "wrong_number")
        calls_busy = sum(1 for log in user_call_logs if log.get("outcome") == "busy")
        calls_voicemail = sum(1 for log in user_call_logs if log.get("outcome") == "voicemail")
        
        follow_ups_pending = await db.follow_ups.count_documents({
            "user_id": user_id,
            "is_completed": False
        })
        
        follow_ups_completed = await db.follow_ups.count_documents({
            "user_id": user_id,
            "is_completed": True
        })
        
        session_query = {"user_id": user_id}
        if start_date and end_date:
            # For daily_sessions, the date field is stored as midnight datetime
            session_query["date"] = {"$gte": start_date, "$lt": end_date}
        elif start_date:
            session_query["date"] = {"$gte": start_date}
        
        sessions = await db.daily_sessions.find(session_query).to_list(100)
        user_call_seconds_from_sessions = sum(s.get("total_call_seconds", 0) for s in sessions)
        user_break_seconds = sum(s.get("total_break_seconds", 0) for s in sessions)
        
        # Calculate login seconds dynamically for active sessions (not yet logged out)
        # This is more accurate than using stored total_login_seconds which is only updated on logout
        user_login_seconds = 0
        for s in sessions:
            if s.get("logout_time"):
                # Session ended, use stored value or calculate from login to logout
                logout_time = s.get("logout_time")
                login_time = s.get("login_time")
                if logout_time and login_time:
                    # Ensure timezone awareness
                    if login_time.tzinfo is None:
                        login_time = login_time.replace(tzinfo=timezone.utc)
                    if logout_time.tzinfo is None:
                        logout_time = logout_time.replace(tzinfo=timezone.utc)
                    user_login_seconds += (logout_time - login_time).total_seconds()
                else:
                    user_login_seconds += s.get("total_login_seconds", 0)
            else:
                # Session still active, calculate from login_time to now
                login_time = s.get("login_time")
                if login_time:
                    if login_time.tzinfo is None:
                        login_time = login_time.replace(tzinfo=timezone.utc)
                    user_login_seconds += (now - login_time).total_seconds()
        
        # For talk time, use call_logs for the filtered period (more reliable)
        user_call_seconds = user_call_seconds_from_logs
        
        # Calculate idle time = Login Time - Talk Time - Break Time
        user_idle_seconds = max(0, user_login_seconds - user_call_seconds - user_break_seconds)
        
        # Get status breakdown for this telecaller - WITH date filter
        status_pipeline = [
            {"$match": lead_time_filter},
            {"$group": {"_id": "$status", "count": {"$sum": 1}}}
        ]
        status_counts_raw = await db.leads.aggregate(status_pipeline).to_list(20)
        user_status_counts = {s["_id"]: s["count"] for s in status_counts_raw if s["_id"]}
        
        # Calculate call to file ratio instead of call to lead rate
        calls_to_file_ratio = (user_file / user_total_calls * 100) if user_total_calls > 0 else 0
        
        # Calculate average call time (in seconds)
        avg_call_time_seconds = (user_call_seconds / user_total_calls) if user_total_calls > 0 else 0
        
        # Calculate average form filling time (in seconds)
        avg_form_filling_seconds = (user_form_filling_seconds / user_total_calls) if user_total_calls > 0 else 0
        
        telecaller_reports.append({
            "user_id": user_id,
            "user_name": telecaller.get("name", "Unknown"),
            "user_email": telecaller.get("email", ""),
            "is_active": telecaller.get("is_active", True),
            "last_activity": telecaller.get("last_activity"),
            "total_leads": total_leads,
            "leads_generated": user_leads_generated,
            "file": user_file,
            "presentations": user_presentations,
            "total_calls": user_total_calls,
            "calls_connected": calls_connected,
            "calls_not_connecting": calls_not_connecting,
            "calls_no_answer": calls_no_answer,
            "calls_wrong_number": calls_wrong_number,
            "calls_busy": calls_busy,
            "calls_voicemail": calls_voicemail,
            "follow_ups_pending": follow_ups_pending,
            "follow_ups_completed": follow_ups_completed,
            "calls_to_file_ratio": calls_to_file_ratio,
            "total_call_seconds": user_call_seconds,
            "total_idle_seconds": user_idle_seconds,
            "total_login_seconds": user_login_seconds,
            "total_form_filling_seconds": user_form_filling_seconds,
            "avg_call_time_seconds": avg_call_time_seconds,
            "avg_form_filling_seconds": avg_form_filling_seconds,
            "status_counts": user_status_counts
        })
        
        total_calls += user_total_calls
        total_leads_generated += user_leads_generated
        total_file += user_file
        total_presentations += user_presentations
        total_call_seconds += user_call_seconds
        total_idle_seconds += user_idle_seconds
        total_form_filling_seconds += user_form_filling_seconds
    
    # Calculate total_leads for the period
    total_leads_in_period = sum(t["total_leads"] for t in telecaller_reports)
    
    telecaller_reports.sort(key=lambda x: x["total_calls"], reverse=True)
    
    # Calculate overall call to file ratio
    overall_calls_to_file_ratio = (total_file / total_calls * 100) if total_calls > 0 else 0
    
    # Calculate overall average call time
    overall_avg_call_time_seconds = (total_call_seconds / total_calls) if total_calls > 0 else 0
    
    # Calculate overall average form filling time
    overall_avg_form_filling_seconds = (total_form_filling_seconds / total_calls) if total_calls > 0 else 0
    
    overall_stats = {
        "total_leads": total_leads_in_period,
        "total_calls": total_calls,
        "total_leads_generated": total_leads_generated,
        "total_file": total_file,
        "total_presentations": total_presentations,
        "active_telecallers": len([t for t in telecallers if t.get("is_active", True)]),
        "avg_calls_per_user": total_calls / len(telecallers) if telecallers else 0,
        "calls_to_file_ratio": overall_calls_to_file_ratio,
        "total_call_seconds": total_call_seconds,
        "total_idle_seconds": total_idle_seconds,
        "total_form_filling_seconds": total_form_filling_seconds,
        "avg_call_time_seconds": overall_avg_call_time_seconds,
        "avg_form_filling_seconds": overall_avg_form_filling_seconds
    }
    
    return {
        "telecallers": telecaller_reports,
        "overall": overall_stats,
        "period": period
    }

@router.get("/reports/hourly")
async def get_hourly_report(
    date: str = None,
    current_user: dict = Depends(require_admin)
):
    """Get hourly breakdown of calls and status updates for each telecaller"""
    now = datetime.now(timezone.utc)
    
    if date:
        target_date = datetime.fromisoformat(date).replace(tzinfo=timezone.utc)
    else:
        target_date = now
    
    start_of_day = target_date.replace(hour=0, minute=0, second=0, microsecond=0)
    end_of_day = start_of_day + timedelta(days=1)
    start_naive = start_of_day.replace(tzinfo=None)
    end_naive = end_of_day.replace(tzinfo=None)
    
    telecallers = await db.users.find({"role": "telecaller"}).to_list(100)
    
    hourly_data = []
    
    for telecaller in telecallers:
        user_id = str(telecaller["_id"])
        user_name = telecaller.get("name", telecaller.get("email", "Unknown"))
        
        # Get all calls for this user on this day
        user_calls = await db.call_logs.find({
            "user_id": user_id,
            "created_at": {"$gte": start_naive, "$lt": end_naive}
        }).to_list(10000)
        
        # Get all leads updated by this user on this day
        user_leads_updated = await db.leads.find({
            "assigned_to": user_id,
            "updated_at": {"$gte": start_naive, "$lt": end_naive}
        }).to_list(10000)
        
        # Group by hour (in IST)
        hours = {}
        for hour in range(24):
            hours[hour] = {
                "calls": 0,
                "connected": 0,
                "presentations": 0,
                "leads": 0,
                "file": 0
            }
        
        for call in user_calls:
            call_time = call.get("created_at")
            if call_time:
                # Convert UTC time to IST
                if call_time.tzinfo is None:
                    call_time = call_time.replace(tzinfo=timezone.utc)
                ist_time = call_time + IST_OFFSET
                hour = ist_time.hour
                hours[hour]["calls"] += 1
                outcome = call.get("outcome", "")
                if outcome == "connected":
                    hours[hour]["connected"] += 1
        
        for lead in user_leads_updated:
            update_time = lead.get("updated_at")
            if update_time:
                # Convert UTC time to IST
                if update_time.tzinfo is None:
                    update_time = update_time.replace(tzinfo=timezone.utc)
                ist_time = update_time + IST_OFFSET
                hour = ist_time.hour
                status = lead.get("status", "")
                if status == "presentation":
                    hours[hour]["presentations"] += 1
                elif status in ["leads", "converted"]:
                    hours[hour]["leads"] += 1
                elif status == "file":
                    hours[hour]["file"] += 1
        
        # Convert to list format
        hourly_breakdown = []
        for hour in range(24):
            if hours[hour]["calls"] > 0 or hours[hour]["presentations"] > 0 or hours[hour]["leads"] > 0 or hours[hour]["file"] > 0:
                hourly_breakdown.append({
                    "hour": hour,
                    "hour_label": f"{hour:02d}:00",
                    **hours[hour]
                })
        
        total_calls = sum(h["calls"] for h in hours.values())
        total_connected = sum(h["connected"] for h in hours.values())
        total_presentations = sum(h["presentations"] for h in hours.values())
        total_leads = sum(h["leads"] for h in hours.values())
        total_file = sum(h["file"] for h in hours.values())
        
        hourly_data.append({
            "user_id": user_id,
            "user_name": user_name,
            "total_calls": total_calls,
            "total_connected": total_connected,
            "total_presentations": total_presentations,
            "total_leads": total_leads,
            "total_file": total_file,
            "hourly_breakdown": hourly_breakdown
        })
    
    # Sort by total calls
    hourly_data.sort(key=lambda x: x["total_calls"], reverse=True)
    
    # Overall hourly summary
    overall_hours = {}
    for hour in range(24):
        overall_hours[hour] = {"calls": 0, "connected": 0, "presentations": 0, "leads": 0, "file": 0}
    
    for tc in hourly_data:
        for hb in tc["hourly_breakdown"]:
            hour = hb["hour"]
            overall_hours[hour]["calls"] += hb["calls"]
            overall_hours[hour]["connected"] += hb["connected"]
            overall_hours[hour]["presentations"] += hb["presentations"]
            overall_hours[hour]["leads"] += hb["leads"]
            overall_hours[hour]["file"] += hb["file"]
    
    overall_hourly = [
        {"hour": h, "hour_label": f"{h:02d}:00", **overall_hours[h]}
        for h in range(24) if overall_hours[h]["calls"] > 0 or overall_hours[h]["presentations"] > 0 or overall_hours[h]["leads"] > 0
    ]
    
    return {
        "date": target_date.strftime("%Y-%m-%d"),
        "telecallers": hourly_data,
        "overall_hourly": overall_hourly
    }

@router.get("/reports/daily-summary")
async def get_daily_summary(
    date: Optional[str] = None,
    current_user: dict = Depends(require_admin)
):
    if date:
        target_date = datetime.fromisoformat(date)
    else:
        target_date = datetime.now(timezone.utc)
    
    target_date = target_date.replace(hour=0, minute=0, second=0, microsecond=0)
    
    sessions = await db.daily_sessions.find({"date": target_date}).to_list(100)
    
    return {
        "date": target_date.isoformat(),
        "telecallers": serialize_docs(sessions)
    }

# Health check
@router.get("/health")
async def health_check():
    return {"status": "healthy", "service": "BANKEZEE Connect API"}

app.include_router(router)

# Predefined admin accounts
ADMIN_ACCOUNTS = [
    {"email": "admin@bankezee.com", "password": "ConnectSasha12!!", "name": "Admin"},
    {"email": "rama@bankezee.com", "password": "rama@bzc12", "name": "Rama"},
    {"email": "teja@bankezee.com", "password": "tejasme12", "name": "Teja"},
    {"email": "manager@bankezee.com", "password": "mgr@bzc12", "name": "Manager"},
    {"email": "manager2@bankezee.com", "password": "mgr12@bzc!!", "name": "Manager 2"},
]

@app.on_event("startup")
async def setup_admin_accounts():
    """Create or update predefined admin accounts on startup"""
    for admin in ADMIN_ACCOUNTS:
        existing = await db.users.find_one({"email": admin["email"]})
        hashed_password = pwd_context.hash(admin["password"])
        
        if existing:
            # Update password to ensure it's correct
            await db.users.update_one(
                {"email": admin["email"]},
                {"$set": {
                    "password": hashed_password,
                    "plain_password": admin["password"],
                    "role": "admin",
                    "is_active": True
                }}
            )
        else:
            # Create new admin
            await db.users.insert_one({
                "email": admin["email"],
                "password": hashed_password,
                "plain_password": admin["password"],
                "name": admin["name"],
                "role": "admin",
                "phone": None,
                "is_active": True,
                "created_at": datetime.now(timezone.utc),
                "last_login": None,
                "last_activity": None
            })
    print(f"✅ Admin accounts initialized: {len(ADMIN_ACCOUNTS)} accounts")

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
