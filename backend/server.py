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

# Helper to serialize ObjectId
def serialize_doc(doc):
    if doc is None:
        return None
    doc["id"] = str(doc.pop("_id"))
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
    
    if session:
        login_time = session.get("login_time", now)
        # Ensure login_time is timezone-aware
        if login_time.tzinfo is None:
            login_time = login_time.replace(tzinfo=timezone.utc)
        current_login_seconds = (now - login_time).total_seconds()
        
        return {
            "date": today.isoformat(),
            "login_time": session.get("login_time"),
            "total_login_seconds": current_login_seconds,
            "total_call_seconds": session.get("total_call_seconds", 0),
            "total_idle_seconds": session.get("total_idle_seconds", 0),
            "calls_made": session.get("calls_made", 0),
            "leads_updated": session.get("leads_updated", 0),
            "is_idle": session.get("is_idle", False),
            "active_call": serialize_doc(active_call) if active_call else None
        }
    
    return {
        "date": today.isoformat(),
        "login_time": None,
        "total_login_seconds": 0,
        "total_call_seconds": 0,
        "total_idle_seconds": 0,
        "calls_made": 0,
        "leads_updated": 0,
        "is_idle": False,
        "active_call": None
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
    
    await db.call_sessions.update_one(
        {"_id": ObjectId(data.session_id)},
        {
            "$set": {
                "end_time": now,
                "duration_seconds": duration,
                "outcome": data.outcome,
                "notes": data.notes
            }
        }
    )
    
    await db.daily_sessions.update_one(
        {"user_id": current_user["id"], "date": today},
        {
            "$inc": {
                "total_call_seconds": duration,
                "calls_made": 1
            }
        }
    )
    
    call_log = {
        "lead_id": session["lead_id"],
        "user_id": current_user["id"],
        "user_name": current_user["name"],
        "duration": duration,
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
    return [
        {"id": "new", "name": "New", "color": "#4CAF50"},
        {"id": "contacted", "name": "Contacted", "color": "#2196F3"},
        {"id": "interested", "name": "Interested", "color": "#FF9800"},
        {"id": "not_interested", "name": "Not Interested", "color": "#9E9E9E"},
        {"id": "follow_up", "name": "Follow Up", "color": "#9C27B0"},
        {"id": "converted", "name": "Converted", "color": "#4CAF50"},
        {"id": "lost", "name": "Lost", "color": "#F44336"},
        {"id": "leads", "name": "Leads", "color": "#4CAF50"}
    ]

# ===================== DASHBOARD & REPORTING =====================

@router.get("/dashboard/stats")
async def get_dashboard_stats(
    period: str = "today",
    telecaller_id: str = None,
    current_user: dict = Depends(get_current_user)
):
    now = datetime.now(timezone.utc)
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    
    if period == "today":
        start_date = today
    elif period == "this_week":
        start_date = today - timedelta(days=today.weekday())
    elif period == "this_month":
        start_date = today.replace(day=1)
    elif period == "last_month":
        first_of_this_month = today.replace(day=1)
        last_month = first_of_this_month - timedelta(days=1)
        start_date = last_month.replace(day=1)
        end_date = first_of_this_month
    elif period == "all_time":
        start_date = None
    else:
        start_date = today
    
    if current_user["role"] == "admin":
        leads_filter = {}
        calls_filter = {}
        
        if telecaller_id and telecaller_id != "all":
            leads_filter["assigned_to"] = telecaller_id
            calls_filter["user_id"] = telecaller_id
        
        if period == "all_time":
            leads_time_filter = {}
            calls_time_query = {}
        elif period == "last_month":
            leads_time_filter = {"updated_at": {"$gte": start_date, "$lt": end_date}}
            leads_created_filter = {"created_at": {"$gte": start_date, "$lt": end_date}}
            calls_time_query = {"created_at": {"$gte": start_date, "$lt": end_date}}
        else:
            leads_time_filter = {"updated_at": {"$gte": start_date}}
            leads_created_filter = {"created_at": {"$gte": start_date}}
            calls_time_query = {"created_at": {"$gte": start_date}}
        
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
            total_interested = await db.leads.count_documents({**leads_filter, "status": "interested"})
        else:
            total_interested = await db.leads.count_documents({
                **leads_filter, 
                **leads_time_filter,
                "status": "interested"
            })
        
        pipeline = [
            {"$match": leads_filter} if leads_filter else {"$match": {}},
            {"$group": {"_id": "$status", "count": {"$sum": 1}}}
        ]
        if not leads_filter:
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
        
        active_telecallers = await db.users.count_documents({"role": "telecaller", "is_active": True})
        
        return {
            "total_data": total_data,
            "connected": connected,
            "total_leads_generated": total_leads_generated,
            "total_interested": total_interested,
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
        elif period == "last_month":
            leads_time_filter = {"updated_at": {"$gte": start_date, "$lt": end_date}}
            leads_created_filter = {"created_at": {"$gte": start_date, "$lt": end_date}}
            calls_time_filter = {"created_at": {"$gte": start_date, "$lt": end_date}}
        else:
            leads_time_filter = {"updated_at": {"$gte": start_date}}
            leads_created_filter = {"created_at": {"$gte": start_date}}
            calls_time_filter = {"created_at": {"$gte": start_date}}
        
        if period == "all_time":
            my_data = await db.leads.count_documents({"assigned_to": user_id})
        else:
            my_data = await db.leads.count_documents({"assigned_to": user_id, **leads_created_filter})
        
        my_connected = await db.call_logs.count_documents({"user_id": user_id, **calls_time_filter})
        
        if period == "all_time":
            my_interested = await db.leads.count_documents({"assigned_to": user_id, "status": "interested"})
        else:
            my_interested = await db.leads.count_documents({
                "assigned_to": user_id, 
                "status": "interested",
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
        
        pipeline = [
            {"$match": {"assigned_to": user_id}},
            {"$group": {"_id": "$status", "count": {"$sum": 1}}}
        ]
        status_counts = await db.leads.aggregate(pipeline).to_list(20)
        
        session = await db.daily_sessions.find_one({
            "user_id": user_id,
            "date": today
        })
        
        return {
            "my_data": my_data,
            "my_connected": my_connected,
            "my_interested": my_interested,
            "my_leads_generated": my_leads_generated,
            "leads_by_status": {s["_id"]: s["count"] for s in status_counts},
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
    current_user: dict = Depends(require_admin)
):
    now = datetime.now(timezone.utc)
    if period == "today":
        start_date = now.replace(hour=0, minute=0, second=0, microsecond=0)
    elif period == "week":
        start_date = now - timedelta(days=now.weekday())
        start_date = start_date.replace(hour=0, minute=0, second=0, microsecond=0)
    elif period == "month":
        start_date = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    elif period == "three_months":
        start_date = now - timedelta(days=90)
        start_date = start_date.replace(hour=0, minute=0, second=0, microsecond=0)
    elif period == "lifetime":
        start_date = None
    else:
        start_date = None
    
    telecallers = await db.users.find({"role": "telecaller"}).to_list(100)
    
    telecaller_reports = []
    total_calls = 0
    total_leads_generated = 0
    total_interested = 0
    total_call_seconds = 0
    total_idle_seconds = 0
    
    for telecaller in telecallers:
        user_id = str(telecaller["_id"])
        
        total_leads = await db.leads.count_documents({"assigned_to": user_id})
        
        user_leads_generated = await db.leads.count_documents({
            "assigned_to": user_id,
            "status": {"$in": ["leads", "converted"]}
        })
        
        user_interested = await db.leads.count_documents({
            "assigned_to": user_id,
            "status": "interested"
        })
        
        call_query = {"user_id": user_id}
        if start_date:
            call_query["created_at"] = {"$gte": start_date}
        
        user_total_calls = await db.call_logs.count_documents(call_query)
        
        connected_query = {**call_query, "outcome": "connected"}
        calls_connected = await db.call_logs.count_documents(connected_query)
        
        follow_ups_pending = await db.follow_ups.count_documents({
            "user_id": user_id,
            "is_completed": False
        })
        
        follow_ups_completed = await db.follow_ups.count_documents({
            "user_id": user_id,
            "is_completed": True
        })
        
        session_query = {"user_id": user_id}
        if start_date:
            session_query["date"] = {"$gte": start_date}
        
        sessions = await db.daily_sessions.find(session_query).to_list(100)
        user_call_seconds = sum(s.get("total_call_seconds", 0) for s in sessions)
        user_idle_seconds = sum(s.get("total_idle_seconds", 0) for s in sessions)
        user_login_seconds = sum(s.get("total_login_seconds", 0) for s in sessions)
        
        calls_to_lead_rate = (user_leads_generated / user_total_calls * 100) if user_total_calls > 0 else 0
        
        telecaller_reports.append({
            "user_id": user_id,
            "user_name": telecaller.get("name", "Unknown"),
            "user_email": telecaller.get("email", ""),
            "is_active": telecaller.get("is_active", True),
            "last_activity": telecaller.get("last_activity"),
            "total_leads": total_leads,
            "leads_generated": user_leads_generated,
            "interested": user_interested,
            "total_calls": user_total_calls,
            "calls_connected": calls_connected,
            "follow_ups_pending": follow_ups_pending,
            "follow_ups_completed": follow_ups_completed,
            "calls_to_lead_rate": calls_to_lead_rate,
            "total_call_seconds": user_call_seconds,
            "total_idle_seconds": user_idle_seconds,
            "total_login_seconds": user_login_seconds
        })
        
        total_calls += user_total_calls
        total_leads_generated += user_leads_generated
        total_interested += user_interested
        total_call_seconds += user_call_seconds
        total_idle_seconds += user_idle_seconds
    
    telecaller_reports.sort(key=lambda x: x["total_calls"], reverse=True)
    
    overall_calls_to_lead_rate = (total_leads_generated / total_calls * 100) if total_calls > 0 else 0
    
    overall_stats = {
        "total_leads": await db.leads.count_documents({}),
        "total_calls": total_calls,
        "total_leads_generated": total_leads_generated,
        "total_interested": total_interested,
        "active_telecallers": len([t for t in telecallers if t.get("is_active", True)]),
        "avg_calls_per_user": total_calls / len(telecallers) if telecallers else 0,
        "calls_to_lead_rate": overall_calls_to_lead_rate,
        "total_call_seconds": total_call_seconds,
        "total_idle_seconds": total_idle_seconds
    }
    
    return {
        "telecallers": telecaller_reports,
        "overall": overall_stats,
        "period": period
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
