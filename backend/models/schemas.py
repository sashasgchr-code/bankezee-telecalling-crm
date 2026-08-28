"""
Pydantic models for the BANKEZEE Connect API
"""
from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime

# ===================== AUTH MODELS =====================

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

class ChangePassword(BaseModel):
    current_password: str
    new_password: str

# ===================== LEAD MODELS =====================

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

class BulkDeleteRequest(BaseModel):
    lead_ids: List[str]

# ===================== CALL MODELS =====================

class CallLogCreate(BaseModel):
    lead_id: str
    duration: Optional[int] = None
    outcome: str
    notes: Optional[str] = None
    call_type: Optional[str] = "outgoing"  # outgoing, incoming

class CallSessionStart(BaseModel):
    lead_id: str

class CallSessionEnd(BaseModel):
    session_id: str
    outcome: str
    notes: Optional[str] = None
    duration: Optional[int] = None
    form_filling_seconds: Optional[int] = None

class DeviceCallLog(BaseModel):
    phone_number: str
    type: str  # incoming, outgoing, missed, rejected
    duration_seconds: int
    timestamp: str  # ISO format timestamp
    name: Optional[str] = None
    raw_type: Optional[str] = None

class CallLogSyncRequest(BaseModel):
    call_logs: List[DeviceCallLog]

# ===================== ACTIVITY MODELS =====================

class ActivityPing(BaseModel):
    pass  # Just a heartbeat

class BreakAction(BaseModel):
    action: str  # "start" or "end"
    reason: str = None

# ===================== FOLLOW-UP MODELS =====================

class FollowUpCreate(BaseModel):
    lead_id: str
    scheduled_at: datetime
    notes: Optional[str] = None

class FollowUpUpdate(BaseModel):
    scheduled_at: Optional[datetime] = None
    notes: Optional[str] = None
    is_completed: Optional[bool] = None

# ===================== USER MODELS =====================

class BulkDeleteUsersRequest(BaseModel):
    user_ids: List[str]
