"""
Pydantic models for Attendance Management
"""
from pydantic import BaseModel
from typing import Optional

# ===================== ATTENDANCE MODELS =====================

class AttendanceCheckIn(BaseModel):
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    accuracy: Optional[float] = None
    platform: Optional[str] = None  # "web", "android", "ios"
    device_info: Optional[str] = None

class AttendanceCheckOut(BaseModel):
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    accuracy: Optional[float] = None
    platform: Optional[str] = None

class WFHRequest(BaseModel):
    date: str  # ISO date string
    reason: Optional[str] = None

class AttendanceCorrection(BaseModel):
    check_in_time: Optional[str] = None
    check_out_time: Optional[str] = None
    work_mode: Optional[str] = None
    attendance_status: Optional[str] = None
    reason: str  # Required for audit

# ===================== OFFICE MODELS =====================

class OfficeCreate(BaseModel):
    office_name: str
    latitude: float
    longitude: float
    allowed_radius_meters: Optional[int] = 150
    is_active: Optional[bool] = True

class OfficeUpdate(BaseModel):
    office_name: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    allowed_radius_meters: Optional[int] = None
    is_active: Optional[bool] = None

# ===================== APPROVAL MODELS =====================

class WFHApproval(BaseModel):
    user_id: Optional[str] = None
    date: Optional[str] = None
    status: Optional[str] = None  # "APPROVED", "REJECTED"
    admin_notes: Optional[str] = None

class LeaveApproval(BaseModel):
    user_id: str
    start_date: str
    end_date: str
    leave_type: Optional[str] = None  # "GENERAL", "SICK", "CASUAL", "PAID"
    reason: Optional[str] = None

# ===================== SETTINGS MODELS =====================

class AttendanceSettingsUpdate(BaseModel):
    office_start_time: Optional[str] = None  # "09:30"
    late_after_time: Optional[str] = None  # "09:45"
    full_day_minutes: Optional[int] = None  # 480
    half_day_minutes: Optional[int] = None  # 240
    allowed_office_radius_meters: Optional[int] = None  # 150
    location_accuracy_threshold_meters: Optional[int] = None  # 150
    require_registered_device: Optional[bool] = None
