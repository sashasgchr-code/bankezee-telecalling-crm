"""
Attendance Management Routes for BANKEZEE Connect
Handles check-in, check-out, work modes, and attendance tracking
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from datetime import datetime, timezone, timedelta, date
from bson import ObjectId
from typing import Optional, List
import math
from zoneinfo import ZoneInfo

from utils.database import db
from utils.auth import get_current_user, require_admin
from utils.helpers import serialize_doc
from models.attendance_schemas import (
    AttendanceCheckIn, AttendanceCheckOut, WFHRequest, 
    AttendanceCorrection, OfficeCreate, OfficeUpdate,
    AttendanceSettingsUpdate, WFHApproval, LeaveApproval
)

router = APIRouter(prefix="/api/attendance", tags=["Attendance"])

# ===================== CONSTANTS =====================

WORK_MODES = ["OFFICE", "WORK_FROM_HOME", "LEAVE"]
ATTENDANCE_STATUSES = ["PRESENT", "LATE", "ABSENT", "HALF_DAY", "ON_LEAVE", "MANUALLY_ADJUSTED"]

# IST Timezone
IST = ZoneInfo("Asia/Kolkata")

# Default attendance settings
DEFAULT_SETTINGS = {
    "office_start_time": "09:30",
    "late_after_time": "09:45",
    "full_day_minutes": 480,  # 8 hours
    "half_day_minutes": 240,  # 4 hours
    "allowed_office_radius_meters": 150,
    "location_accuracy_threshold_meters": 150,
    "require_registered_device": False,
    "timezone": "Asia/Kolkata"
}

def get_ist_now():
    """Get current time in IST"""
    return datetime.now(IST)

def utc_to_ist(utc_time):
    """Convert UTC time to IST"""
    if utc_time is None:
        return None
    if utc_time.tzinfo is None:
        utc_time = utc_time.replace(tzinfo=timezone.utc)
    return utc_time.astimezone(IST)

def get_ist_today_range():
    """Get today's date range in IST (returns UTC datetimes for DB queries)"""
    ist_now = get_ist_now()
    ist_today_start = ist_now.replace(hour=0, minute=0, second=0, microsecond=0)
    ist_today_end = ist_today_start + timedelta(days=1)
    # Convert back to UTC for database queries
    return ist_today_start.astimezone(timezone.utc), ist_today_end.astimezone(timezone.utc)

# ===================== HELPER FUNCTIONS =====================

def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """
    Calculate the great-circle distance between two points on Earth
    Returns distance in meters
    """
    R = 6371000  # Earth's radius in meters
    
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)
    
    a = math.sin(delta_phi / 2) ** 2 + \
        math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    
    return R * c

async def get_attendance_settings():
    """Get attendance settings or return defaults"""
    settings = await db.attendance_settings.find_one({"_id": "global"})
    if not settings:
        return DEFAULT_SETTINGS.copy()
    return {**DEFAULT_SETTINGS, **settings}

async def get_active_office():
    """Get the first active office configuration"""
    return await db.offices.find_one({"is_active": True})

async def get_today_attendance(user_id: str):
    """Get today's attendance record for a user (using IST date boundaries)"""
    today_start, today_end = get_ist_today_range()
    
    return await db.attendance.find_one({
        "user_id": user_id,
        "attendance_date": {"$gte": today_start, "$lt": today_end}
    })

async def get_user_work_mode(user_id: str, target_date: datetime = None):
    """
    Determine user's work mode for a given date (uses IST).
    Priority: LEAVE > WFH approval > OFFICE (default)
    """
    if target_date is None:
        target_date = get_ist_now()
    
    # Use IST date boundaries
    ist_date = utc_to_ist(target_date) if target_date.tzinfo == timezone.utc else target_date
    date_start = ist_date.replace(hour=0, minute=0, second=0, microsecond=0)
    date_end = date_start + timedelta(days=1)
    
    # Convert to UTC for DB queries
    date_start_utc = date_start.astimezone(timezone.utc)
    date_end_utc = date_end.astimezone(timezone.utc)
    
    # Check for approved leave
    leave = await db.leave_approvals.find_one({
        "user_id": user_id,
        "start_date": {"$lte": date_end_utc},
        "end_date": {"$gte": date_start_utc},
        "status": "APPROVED"
    })
    if leave:
        return "LEAVE"
    
    # Check for approved WFH
    wfh = await db.wfh_approvals.find_one({
        "user_id": user_id,
        "date": {"$gte": date_start_utc, "$lt": date_end_utc},
        "status": "APPROVED"
    })
    if wfh:
        return "WORK_FROM_HOME"
    
    return "OFFICE"

def calculate_attendance_status(check_in_time: datetime, working_minutes: int, settings: dict):
    """Calculate attendance status based on check-in time (in IST) and working hours"""
    # Parse late_after_time
    late_hour, late_minute = map(int, settings.get("late_after_time", "09:45").split(":"))
    
    # Convert check-in time to IST for accurate late detection
    check_in_ist = utc_to_ist(check_in_time)
    check_in_hour = check_in_ist.hour
    check_in_minute = check_in_ist.minute
    
    is_late = (check_in_hour > late_hour) or (check_in_hour == late_hour and check_in_minute > late_minute)
    
    full_day_mins = settings.get("full_day_minutes", 480)
    half_day_mins = settings.get("half_day_minutes", 240)
    
    if working_minutes >= full_day_mins:
        return "LATE" if is_late else "PRESENT"
    elif working_minutes >= half_day_mins:
        return "HALF_DAY"
    else:
        return "PRESENT" if working_minutes > 0 else "ABSENT"

async def create_audit_log(attendance_id: str, changed_by: str, field: str, old_value, new_value, reason: str):
    """Create an audit log entry for attendance changes"""
    await db.attendance_audit.insert_one({
        "attendance_id": attendance_id,
        "changed_by": changed_by,
        "changed_at": datetime.now(timezone.utc),
        "field_changed": field,
        "original_value": str(old_value) if old_value else None,
        "new_value": str(new_value) if new_value else None,
        "reason": reason
    })

# ===================== AGENT ENDPOINTS =====================

@router.get("/today")
async def get_today_attendance_status(current_user: dict = Depends(get_current_user)):
    """Get current user's attendance status for today"""
    user_id = current_user["id"]
    
    # Get today's attendance record
    attendance = await get_today_attendance(user_id)
    
    # Get user's work mode for today
    work_mode = await get_user_work_mode(user_id)
    
    # Get settings
    settings = await get_attendance_settings()
    
    # Get office info if needed
    office = None
    if work_mode == "OFFICE":
        office = await get_active_office()
    
    now = datetime.now(timezone.utc)
    ist_now = get_ist_now()
    
    response = {
        "attendance_date": ist_now.strftime("%Y-%m-%d"),  # IST date
        "work_mode": work_mode,
        "checked_in": False,
        "checked_out": False,
        "check_in_time": None,
        "check_out_time": None,
        "check_in_time_ist": None,
        "check_out_time_ist": None,
        "working_minutes": 0,
        "attendance_status": None,
        "office": serialize_doc(office) if office else None,
        "settings": {
            "office_start_time": settings.get("office_start_time"),
            "late_after_time": settings.get("late_after_time"),
            "allowed_radius_meters": settings.get("allowed_office_radius_meters"),
        },
        "server_time": now.isoformat(),
        "server_time_ist": ist_now.isoformat(),
        "timezone": "Asia/Kolkata"
    }
    
    if attendance:
        check_in_ist = utc_to_ist(attendance.get("check_in_time")) if attendance.get("check_in_time") else None
        check_out_ist = utc_to_ist(attendance.get("check_out_time")) if attendance.get("check_out_time") else None
        
        response.update({
            "id": str(attendance["_id"]),
            "checked_in": attendance.get("check_in_time") is not None,
            "checked_out": attendance.get("check_out_time") is not None,
            "check_in_time": attendance.get("check_in_time").isoformat() if attendance.get("check_in_time") else None,
            "check_out_time": attendance.get("check_out_time").isoformat() if attendance.get("check_out_time") else None,
            "check_in_time_ist": check_in_ist.strftime("%I:%M %p") if check_in_ist else None,
            "check_out_time_ist": check_out_ist.strftime("%I:%M %p") if check_out_ist else None,
            "working_minutes": attendance.get("working_minutes", 0),
            "attendance_status": attendance.get("attendance_status"),
            "check_in_distance": attendance.get("check_in_distance_from_office"),
            "work_mode": attendance.get("work_mode", work_mode),
            "late_minutes": attendance.get("late_minutes", 0),
        })
    
    return response

@router.post("/check-in")
async def check_in(data: AttendanceCheckIn, current_user: dict = Depends(get_current_user)):
    """Check in for attendance"""
    user_id = current_user["id"]
    now = datetime.now(timezone.utc)
    
    # Check if already checked in today
    existing = await get_today_attendance(user_id)
    if existing and existing.get("check_in_time"):
        raise HTTPException(status_code=400, detail="Already checked in today")
    
    # Get work mode
    work_mode = await get_user_work_mode(user_id)
    
    # Get settings
    settings = await get_attendance_settings()
    
    # Validate location accuracy
    if data.accuracy and data.accuracy > settings.get("location_accuracy_threshold_meters", 150):
        raise HTTPException(
            status_code=400, 
            detail=f"Location accuracy too low ({int(data.accuracy)}m). Please move to a better location and try again."
        )
    
    distance_from_office = None
    office_id = None
    
    # For OFFICE mode, validate geofence
    if work_mode == "OFFICE":
        office = await get_active_office()
        if not office:
            raise HTTPException(status_code=400, detail="No office location configured. Contact admin.")
        
        if not data.latitude or not data.longitude:
            raise HTTPException(status_code=400, detail="Location is required for office check-in")
        
        # Calculate distance from office
        distance_from_office = haversine_distance(
            data.latitude, data.longitude,
            office["latitude"], office["longitude"]
        )
        
        allowed_radius = settings.get("allowed_office_radius_meters", 150)
        
        if distance_from_office > allowed_radius:
            raise HTTPException(
                status_code=400,
                detail=f"You are approximately {int(distance_from_office)}m away from the office. Office check-in requires being within {allowed_radius}m."
            )
        
        office_id = str(office["_id"])
    
    # Calculate late minutes using IST
    ist_now = get_ist_now()
    late_hour, late_minute = map(int, settings.get("late_after_time", "09:45").split(":"))
    late_time = ist_now.replace(hour=late_hour, minute=late_minute, second=0, microsecond=0)
    late_minutes = max(0, int((ist_now - late_time).total_seconds() / 60)) if ist_now > late_time else 0
    
    # Use IST date for attendance_date (store as start of day in UTC)
    today_start, _ = get_ist_today_range()
    
    # Create attendance record
    attendance_doc = {
        "user_id": user_id,
        "user_name": current_user["name"],
        "attendance_date": today_start,
        "work_mode": work_mode,
        "office_id": office_id,
        "check_in_time": now,
        "check_in_time_ist": ist_now.isoformat(),  # Store IST for display
        "check_in_latitude": data.latitude,
        "check_in_longitude": data.longitude,
        "check_in_accuracy": data.accuracy,
        "check_in_distance_from_office": int(distance_from_office) if distance_from_office else None,
        "check_in_platform": data.platform,
        "check_in_device_info": data.device_info,
        "check_out_time": None,
        "check_out_latitude": None,
        "check_out_longitude": None,
        "check_out_accuracy": None,
        "check_out_distance_from_office": None,
        "check_out_platform": None,
        "working_minutes": 0,
        "attendance_status": "LATE" if late_minutes > 0 else "PRESENT",
        "late_minutes": late_minutes,
        "created_at": now,
        "updated_at": now
    }
    
    if existing:
        # Update existing record
        await db.attendance.update_one(
            {"_id": existing["_id"]},
            {"$set": attendance_doc}
        )
        attendance_doc["_id"] = existing["_id"]
    else:
        # Create new record
        result = await db.attendance.insert_one(attendance_doc)
        attendance_doc["_id"] = result.inserted_id
    
    return {
        "success": True,
        "message": "Checked in successfully",
        "check_in_time": now.isoformat(),
        "check_in_time_ist": ist_now.strftime("%I:%M %p"),  # Formatted IST time
        "work_mode": work_mode,
        "distance_from_office": int(distance_from_office) if distance_from_office else None,
        "attendance_status": attendance_doc["attendance_status"],
        "late_minutes": late_minutes,
        "server_time": now.isoformat(),
        "server_time_ist": ist_now.isoformat()
    }

@router.post("/check-out")
async def check_out(data: AttendanceCheckOut, current_user: dict = Depends(get_current_user)):
    """Check out from attendance"""
    user_id = current_user["id"]
    now = datetime.now(timezone.utc)
    
    # Get today's attendance
    attendance = await get_today_attendance(user_id)
    
    if not attendance:
        raise HTTPException(status_code=400, detail="No check-in found for today")
    
    if not attendance.get("check_in_time"):
        raise HTTPException(status_code=400, detail="You must check in before checking out")
    
    if attendance.get("check_out_time"):
        raise HTTPException(status_code=400, detail="Already checked out today")
    
    # Get settings
    settings = await get_attendance_settings()
    
    distance_from_office = None
    work_mode = attendance.get("work_mode", "OFFICE")
    
    # For OFFICE mode, capture checkout location
    if work_mode == "OFFICE" and data.latitude and data.longitude:
        office = await get_active_office()
        if office:
            distance_from_office = haversine_distance(
                data.latitude, data.longitude,
                office["latitude"], office["longitude"]
            )
    
    # Calculate working minutes
    check_in_time = attendance["check_in_time"]
    # Ensure check_in_time is timezone-aware
    if check_in_time.tzinfo is None:
        check_in_time = check_in_time.replace(tzinfo=timezone.utc)
    working_seconds = (now - check_in_time).total_seconds()
    working_minutes = int(working_seconds / 60)
    
    # Determine final attendance status
    attendance_status = calculate_attendance_status(
        check_in_time, working_minutes, settings
    )
    
    # If was late, keep as LATE
    if attendance.get("late_minutes", 0) > 0:
        attendance_status = "LATE"
    
    # Update attendance record
    update_data = {
        "check_out_time": now,
        "check_out_latitude": data.latitude,
        "check_out_longitude": data.longitude,
        "check_out_accuracy": data.accuracy,
        "check_out_distance_from_office": int(distance_from_office) if distance_from_office else None,
        "check_out_platform": data.platform,
        "working_minutes": working_minutes,
        "attendance_status": attendance_status,
        "updated_at": now
    }
    
    await db.attendance.update_one(
        {"_id": attendance["_id"]},
        {"$set": update_data}
    )
    
    # Convert times to IST for display
    ist_now = get_ist_now()
    check_in_ist = utc_to_ist(check_in_time)
    
    return {
        "success": True,
        "message": "Checked out successfully",
        "check_in_time": check_in_time.isoformat(),
        "check_in_time_ist": check_in_ist.strftime("%I:%M %p") if check_in_ist else None,
        "check_out_time": now.isoformat(),
        "check_out_time_ist": ist_now.strftime("%I:%M %p"),  # Formatted IST time
        "working_minutes": working_minutes,
        "working_hours": f"{working_minutes // 60}h {working_minutes % 60}m",
        "attendance_status": attendance_status,
        "distance_from_office": int(distance_from_office) if distance_from_office else None,
        "server_time": now.isoformat(),
        "server_time_ist": ist_now.isoformat()
    }

@router.get("/history")
async def get_attendance_history(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    limit: int = Query(30, le=100),
    current_user: dict = Depends(get_current_user)
):
    """Get attendance history for current user"""
    user_id = current_user["id"]
    
    query = {"user_id": user_id}
    
    if start_date and end_date:
        try:
            start = datetime.fromisoformat(start_date.replace('Z', '+00:00'))
            end = datetime.fromisoformat(end_date.replace('Z', '+00:00')) + timedelta(days=1)
            query["attendance_date"] = {"$gte": start, "$lt": end}
        except ValueError:
            pass
    
    cursor = db.attendance.find(query).sort("attendance_date", -1).limit(limit)
    records = await cursor.to_list(length=limit)
    
    # Add IST formatted times to each record
    result = []
    for r in records:
        doc = serialize_doc(r)
        # Add IST formatted times
        if r.get("check_in_time"):
            check_in_ist = utc_to_ist(r["check_in_time"])
            doc["check_in_time_ist"] = check_in_ist.strftime("%I:%M %p") if check_in_ist else None
        if r.get("check_out_time"):
            check_out_ist = utc_to_ist(r["check_out_time"])
            doc["check_out_time_ist"] = check_out_ist.strftime("%I:%M %p") if check_out_ist else None
        result.append(doc)
    
    return result

@router.post("/wfh-request")
async def submit_wfh_request(data: WFHRequest, current_user: dict = Depends(get_current_user)):
    """Submit a Work From Home request"""
    user_id = current_user["id"]
    now = datetime.now(timezone.utc)
    
    # Parse date
    try:
        request_date = datetime.fromisoformat(data.date.replace('Z', '+00:00'))
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format")
    
    # Check for existing request
    existing = await db.wfh_requests.find_one({
        "user_id": user_id,
        "date": {"$gte": request_date.replace(hour=0), "$lt": request_date.replace(hour=0) + timedelta(days=1)}
    })
    
    if existing:
        raise HTTPException(status_code=400, detail="WFH request already exists for this date")
    
    # Create request
    request_doc = {
        "user_id": user_id,
        "user_name": current_user["name"],
        "date": request_date.replace(hour=0, minute=0, second=0, microsecond=0),
        "reason": data.reason,
        "status": "PENDING",
        "created_at": now,
        "updated_at": now
    }
    
    result = await db.wfh_requests.insert_one(request_doc)
    request_doc["_id"] = result.inserted_id
    
    return {
        "success": True,
        "message": "WFH request submitted successfully",
        "request": serialize_doc(request_doc)
    }

@router.get("/wfh-requests")
async def get_my_wfh_requests(current_user: dict = Depends(get_current_user)):
    """Get current user's WFH requests"""
    user_id = current_user["id"]
    
    cursor = db.wfh_requests.find({"user_id": user_id}).sort("date", -1).limit(30)
    requests = await cursor.to_list(length=30)
    
    return [serialize_doc(r) for r in requests]

# ===================== ADMIN ENDPOINTS =====================

@router.get("/admin/today")
async def admin_get_today_attendance(
    work_mode: Optional[str] = None,
    status: Optional[str] = None,
    target_date: Optional[str] = Query(None, alias="date"),
    current_user: dict = Depends(require_admin)
):
    """Get attendance for a specific date (defaults to today) for all users (Admin only)"""
    # Parse target date or use today in IST
    if target_date:
        try:
            parsed_date = datetime.fromisoformat(target_date.replace('Z', '+00:00'))
            if parsed_date.tzinfo is None:
                parsed_date = parsed_date.replace(tzinfo=IST)
            elif parsed_date.tzinfo == timezone.utc:
                parsed_date = parsed_date.astimezone(IST)
            today_start = parsed_date.replace(hour=0, minute=0, second=0, microsecond=0)
        except ValueError:
            today_start, _ = get_ist_today_range()
    else:
        today_start, _ = get_ist_today_range()
    
    # Calculate day boundaries in UTC for query
    today_end = today_start + timedelta(days=1)
    today_start_utc = today_start.astimezone(timezone.utc)
    today_end_utc = today_end.astimezone(timezone.utc)
    
    query = {"attendance_date": {"$gte": today_start_utc, "$lt": today_end_utc}}
    
    if work_mode:
        query["work_mode"] = work_mode
    if status:
        query["attendance_status"] = status
    
    cursor = db.attendance.find(query).sort("check_in_time", -1)
    records = await cursor.to_list(length=500)
    
    # Add IST formatted times to each record for admin display
    result = []
    for r in records:
        doc = serialize_doc(r)
        # Add IST formatted times
        if r.get("check_in_time"):
            check_in_ist = utc_to_ist(r["check_in_time"])
            doc["check_in_time_ist"] = check_in_ist.strftime("%I:%M %p") if check_in_ist else None
        if r.get("check_out_time"):
            check_out_ist = utc_to_ist(r["check_out_time"])
            doc["check_out_time_ist"] = check_out_ist.strftime("%I:%M %p") if check_out_ist else None
        result.append(doc)
    
    return result

@router.get("/admin/summary")
async def admin_get_attendance_summary(
    target_date_str: Optional[str] = Query(None, alias="date"),
    current_user: dict = Depends(require_admin)
):
    """Get attendance summary for a date (Admin only)"""
    ist_now = get_ist_now()
    
    if target_date_str:
        try:
            # Parse the date string and treat it as IST date
            target_date = datetime.fromisoformat(target_date_str.replace('Z', '+00:00'))
            # Convert to IST if it has UTC timezone
            if target_date.tzinfo == timezone.utc:
                target_date = target_date.astimezone(IST)
            elif target_date.tzinfo is None:
                target_date = target_date.replace(tzinfo=IST)
        except ValueError:
            target_date = ist_now
    else:
        target_date = ist_now
    
    # Use IST date boundaries for consistent reporting
    day_start = target_date.replace(hour=0, minute=0, second=0, microsecond=0)
    day_end = day_start + timedelta(days=1)
    # Convert to UTC for database queries
    day_start = day_start.astimezone(timezone.utc)
    day_end = day_end.astimezone(timezone.utc)
    
    # Get all active users
    active_users = await db.users.count_documents({"is_active": True, "role": {"$ne": "admin"}})
    
    # Get attendance records for the day
    pipeline = [
        {"$match": {"attendance_date": {"$gte": day_start, "$lt": day_end}}},
        {"$group": {
            "_id": None,
            "total": {"$sum": 1},
            "present": {"$sum": {"$cond": [{"$eq": ["$attendance_status", "PRESENT"]}, 1, 0]}},
            "late": {"$sum": {"$cond": [{"$eq": ["$attendance_status", "LATE"]}, 1, 0]}},
            "half_day": {"$sum": {"$cond": [{"$eq": ["$attendance_status", "HALF_DAY"]}, 1, 0]}},
            "on_leave": {"$sum": {"$cond": [{"$eq": ["$attendance_status", "ON_LEAVE"]}, 1, 0]}},
            "office": {"$sum": {"$cond": [{"$eq": ["$work_mode", "OFFICE"]}, 1, 0]}},
            "wfh": {"$sum": {"$cond": [{"$eq": ["$work_mode", "WORK_FROM_HOME"]}, 1, 0]}},
            "leave": {"$sum": {"$cond": [{"$eq": ["$work_mode", "LEAVE"]}, 1, 0]}},
            "checked_in": {"$sum": {"$cond": [{"$ne": ["$check_in_time", None]}, 1, 0]}},
            "checked_out": {"$sum": {"$cond": [{"$ne": ["$check_out_time", None]}, 1, 0]}},
        }}
    ]
    
    result = await db.attendance.aggregate(pipeline).to_list(length=1)
    
    summary = result[0] if result else {
        "total": 0, "present": 0, "late": 0, "half_day": 0, "on_leave": 0,
        "office": 0, "wfh": 0, "leave": 0, "checked_in": 0, "checked_out": 0
    }
    
    # Calculate absent (active users - those who marked attendance or on leave)
    marked = summary.get("total", 0)
    absent = max(0, active_users - marked)
    
    # Convert day_start back to IST for display
    display_date = day_start.astimezone(IST)
    
    return {
        "date": display_date.strftime("%Y-%m-%d"),
        "total_employees": active_users,
        "present": summary.get("present", 0) + summary.get("late", 0),
        "late": summary.get("late", 0),
        "absent": absent,
        "half_day": summary.get("half_day", 0),
        "on_leave": summary.get("on_leave", 0) + summary.get("leave", 0),
        "office": summary.get("office", 0),
        "wfh": summary.get("wfh", 0),
        "currently_working": summary.get("checked_in", 0) - summary.get("checked_out", 0),
        "checked_out": summary.get("checked_out", 0),
        "server_time": datetime.now(timezone.utc).isoformat(),
        "server_time_ist": ist_now.isoformat()
    }

@router.get("/admin/monthly")
async def admin_get_monthly_attendance(
    user_id: Optional[str] = None,
    month: Optional[int] = None,
    year: Optional[int] = None,
    current_user: dict = Depends(require_admin)
):
    """Get monthly attendance report (Admin only)"""
    ist_now = get_ist_now()
    target_month = month or ist_now.month
    target_year = year or ist_now.year
    
    # Calculate date range for the month in IST
    month_start = datetime(target_year, target_month, 1, tzinfo=IST)
    if target_month == 12:
        month_end = datetime(target_year + 1, 1, 1, tzinfo=IST)
    else:
        month_end = datetime(target_year, target_month + 1, 1, tzinfo=IST)
    
    # Convert to UTC for database queries
    month_start_utc = month_start.astimezone(timezone.utc)
    month_end_utc = month_end.astimezone(timezone.utc)
    
    query = {"attendance_date": {"$gte": month_start_utc, "$lt": month_end_utc}}
    if user_id:
        query["user_id"] = user_id
    
    # Get all attendance records for the month
    cursor = db.attendance.find(query)
    records = await cursor.to_list(length=1000)
    
    # Group by user
    user_stats = {}
    for record in records:
        uid = record["user_id"]
        if uid not in user_stats:
            user_stats[uid] = {
                "user_id": uid,
                "user_name": record.get("user_name", "Unknown"),
                "total_days": 0,
                "present_days": 0,
                "late_days": 0,
                "half_days": 0,
                "leave_days": 0,
                "office_days": 0,
                "wfh_days": 0,
                "total_working_minutes": 0,
                "records": []
            }
        
        stats = user_stats[uid]
        stats["total_days"] += 1
        stats["total_working_minutes"] += record.get("working_minutes", 0)
        
        status = record.get("attendance_status")
        if status == "PRESENT":
            stats["present_days"] += 1
        elif status == "LATE":
            stats["late_days"] += 1
            stats["present_days"] += 1  # Late is still present
        elif status == "HALF_DAY":
            stats["half_days"] += 1
        elif status == "ON_LEAVE":
            stats["leave_days"] += 1
        
        work_mode = record.get("work_mode")
        if work_mode == "OFFICE":
            stats["office_days"] += 1
        elif work_mode == "WORK_FROM_HOME":
            stats["wfh_days"] += 1
        
        # Add IST formatted times to record
        rec_doc = serialize_doc(record)
        if record.get("check_in_time"):
            check_in_ist = utc_to_ist(record["check_in_time"])
            rec_doc["check_in_time_ist"] = check_in_ist.strftime("%I:%M %p") if check_in_ist else None
        if record.get("check_out_time"):
            check_out_ist = utc_to_ist(record["check_out_time"])
            rec_doc["check_out_time_ist"] = check_out_ist.strftime("%I:%M %p") if check_out_ist else None
        stats["records"].append(rec_doc)
    
    # Calculate averages
    for uid, stats in user_stats.items():
        if stats["total_days"] > 0:
            stats["avg_working_minutes"] = stats["total_working_minutes"] / stats["total_days"]
            stats["total_working_hours"] = f"{stats['total_working_minutes'] // 60}h {stats['total_working_minutes'] % 60}m"
        else:
            stats["avg_working_minutes"] = 0
            stats["total_working_hours"] = "0h 0m"
    
    return {
        "month": target_month,
        "year": target_year,
        "user_stats": list(user_stats.values())
    }

@router.patch("/admin/record/{attendance_id}")
async def admin_correct_attendance(
    attendance_id: str,
    data: AttendanceCorrection,
    current_user: dict = Depends(require_admin)
):
    """Manually correct an attendance record (Admin only)"""
    if not data.reason:
        raise HTTPException(status_code=400, detail="Reason is required for manual corrections")
    
    attendance = await db.attendance.find_one({"_id": ObjectId(attendance_id)})
    if not attendance:
        raise HTTPException(status_code=404, detail="Attendance record not found")
    
    now = datetime.now(timezone.utc)
    update_data = {"updated_at": now}
    
    # Track changes for audit
    if data.check_in_time:
        await create_audit_log(
            attendance_id, current_user["id"], "check_in_time",
            attendance.get("check_in_time"), data.check_in_time, data.reason
        )
        try:
            update_data["check_in_time"] = datetime.fromisoformat(data.check_in_time.replace('Z', '+00:00'))
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid check_in_time format")
    
    if data.check_out_time:
        await create_audit_log(
            attendance_id, current_user["id"], "check_out_time",
            attendance.get("check_out_time"), data.check_out_time, data.reason
        )
        try:
            update_data["check_out_time"] = datetime.fromisoformat(data.check_out_time.replace('Z', '+00:00'))
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid check_out_time format")
    
    if data.work_mode:
        if data.work_mode not in WORK_MODES:
            raise HTTPException(status_code=400, detail=f"Invalid work_mode. Must be one of: {WORK_MODES}")
        await create_audit_log(
            attendance_id, current_user["id"], "work_mode",
            attendance.get("work_mode"), data.work_mode, data.reason
        )
        update_data["work_mode"] = data.work_mode
    
    if data.attendance_status:
        if data.attendance_status not in ATTENDANCE_STATUSES:
            raise HTTPException(status_code=400, detail=f"Invalid status. Must be one of: {ATTENDANCE_STATUSES}")
        await create_audit_log(
            attendance_id, current_user["id"], "attendance_status",
            attendance.get("attendance_status"), data.attendance_status, data.reason
        )
        update_data["attendance_status"] = data.attendance_status
    
    # Recalculate working minutes if times changed
    if "check_in_time" in update_data or "check_out_time" in update_data:
        check_in = update_data.get("check_in_time", attendance.get("check_in_time"))
        check_out = update_data.get("check_out_time", attendance.get("check_out_time"))
        
        if check_in and check_out:
            working_seconds = (check_out - check_in).total_seconds()
            update_data["working_minutes"] = max(0, int(working_seconds / 60))
    
    # Mark as manually adjusted
    update_data["manually_adjusted"] = True
    update_data["adjusted_by"] = current_user["id"]
    update_data["adjusted_at"] = now
    
    await db.attendance.update_one(
        {"_id": ObjectId(attendance_id)},
        {"$set": update_data}
    )
    
    updated = await db.attendance.find_one({"_id": ObjectId(attendance_id)})
    return serialize_doc(updated)

@router.get("/admin/audit/{attendance_id}")
async def admin_get_audit_log(attendance_id: str, current_user: dict = Depends(require_admin)):
    """Get audit history for an attendance record (Admin only)"""
    cursor = db.attendance_audit.find({"attendance_id": attendance_id}).sort("changed_at", -1)
    logs = await cursor.to_list(length=100)
    
    # Enrich with user names
    for log in logs:
        changer = await db.users.find_one({"_id": ObjectId(log["changed_by"])})
        log["changed_by_name"] = changer["name"] if changer else "Unknown"
    
    return [serialize_doc(l) for l in logs]

# ===================== OFFICE MANAGEMENT =====================

@router.get("/admin/offices")
async def admin_get_offices(current_user: dict = Depends(require_admin)):
    """Get all office locations (Admin only)"""
    cursor = db.offices.find().sort("created_at", -1)
    offices = await cursor.to_list(length=50)
    return [serialize_doc(o) for o in offices]

@router.post("/admin/offices")
async def admin_create_office(data: OfficeCreate, current_user: dict = Depends(require_admin)):
    """Create a new office location (Admin only)"""
    now = datetime.now(timezone.utc)
    
    office_doc = {
        "office_name": data.office_name,
        "latitude": data.latitude,
        "longitude": data.longitude,
        "allowed_radius_meters": data.allowed_radius_meters or 150,
        "is_active": data.is_active if data.is_active is not None else True,
        "created_at": now,
        "updated_at": now
    }
    
    result = await db.offices.insert_one(office_doc)
    office_doc["_id"] = result.inserted_id
    
    return serialize_doc(office_doc)

@router.patch("/admin/offices/{office_id}")
async def admin_update_office(
    office_id: str,
    data: OfficeUpdate,
    current_user: dict = Depends(require_admin)
):
    """Update an office location (Admin only)"""
    office = await db.offices.find_one({"_id": ObjectId(office_id)})
    if not office:
        raise HTTPException(status_code=404, detail="Office not found")
    
    update_data = {"updated_at": datetime.now(timezone.utc)}
    
    if data.office_name is not None:
        update_data["office_name"] = data.office_name
    if data.latitude is not None:
        update_data["latitude"] = data.latitude
    if data.longitude is not None:
        update_data["longitude"] = data.longitude
    if data.allowed_radius_meters is not None:
        update_data["allowed_radius_meters"] = data.allowed_radius_meters
    if data.is_active is not None:
        update_data["is_active"] = data.is_active
    
    await db.offices.update_one(
        {"_id": ObjectId(office_id)},
        {"$set": update_data}
    )
    
    updated = await db.offices.find_one({"_id": ObjectId(office_id)})
    return serialize_doc(updated)

# ===================== WFH/LEAVE APPROVALS =====================

@router.get("/admin/wfh-requests")
async def admin_get_wfh_requests(
    status: Optional[str] = None,
    current_user: dict = Depends(require_admin)
):
    """Get all WFH requests (Admin only)"""
    query = {}
    if status:
        query["status"] = status
    
    cursor = db.wfh_requests.find(query).sort("created_at", -1)
    requests = await cursor.to_list(length=100)
    return [serialize_doc(r) for r in requests]

@router.patch("/admin/wfh-requests/{request_id}")
async def admin_handle_wfh_request(
    request_id: str,
    data: WFHApproval,
    current_user: dict = Depends(require_admin)
):
    """Approve or reject a WFH request (Admin only)"""
    request = await db.wfh_requests.find_one({"_id": ObjectId(request_id)})
    if not request:
        raise HTTPException(status_code=404, detail="WFH request not found")
    
    now = datetime.now(timezone.utc)
    
    await db.wfh_requests.update_one(
        {"_id": ObjectId(request_id)},
        {"$set": {
            "status": data.status,
            "admin_notes": data.admin_notes,
            "handled_by": current_user["id"],
            "handled_at": now,
            "updated_at": now
        }}
    )
    
    # If approved, create WFH approval record
    if data.status == "APPROVED":
        await db.wfh_approvals.insert_one({
            "user_id": request["user_id"],
            "user_name": request["user_name"],
            "date": request["date"],
            "approved_by": current_user["id"],
            "status": "APPROVED",
            "created_at": now
        })
    
    updated = await db.wfh_requests.find_one({"_id": ObjectId(request_id)})
    return serialize_doc(updated)

@router.post("/admin/wfh-assign")
async def admin_assign_wfh(data: WFHApproval, current_user: dict = Depends(require_admin)):
    """Directly assign WFH to an employee for a date (Admin only)"""
    now = datetime.now(timezone.utc)
    
    try:
        target_date = datetime.fromisoformat(data.date.replace('Z', '+00:00'))
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format")
    
    date_start = target_date.replace(hour=0, minute=0, second=0, microsecond=0)
    
    # Check for existing approval
    existing = await db.wfh_approvals.find_one({
        "user_id": data.user_id,
        "date": date_start
    })
    
    if existing:
        raise HTTPException(status_code=400, detail="WFH already assigned for this date")
    
    # Get user info
    user = await db.users.find_one({"_id": ObjectId(data.user_id)})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    approval_doc = {
        "user_id": data.user_id,
        "user_name": user["name"],
        "date": date_start,
        "approved_by": current_user["id"],
        "admin_notes": data.admin_notes,
        "status": "APPROVED",
        "created_at": now
    }
    
    result = await db.wfh_approvals.insert_one(approval_doc)
    approval_doc["_id"] = result.inserted_id
    
    return serialize_doc(approval_doc)

@router.post("/admin/leave-assign")
async def admin_assign_leave(data: LeaveApproval, current_user: dict = Depends(require_admin)):
    """Assign leave to an employee (Admin only)"""
    now = datetime.now(timezone.utc)
    
    try:
        start_date = datetime.fromisoformat(data.start_date.replace('Z', '+00:00'))
        end_date = datetime.fromisoformat(data.end_date.replace('Z', '+00:00'))
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format")
    
    # Get user info
    user = await db.users.find_one({"_id": ObjectId(data.user_id)})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    leave_doc = {
        "user_id": data.user_id,
        "user_name": user["name"],
        "start_date": start_date.replace(hour=0, minute=0, second=0, microsecond=0),
        "end_date": end_date.replace(hour=23, minute=59, second=59, microsecond=0),
        "leave_type": data.leave_type or "GENERAL",
        "reason": data.reason,
        "status": "APPROVED",
        "approved_by": current_user["id"],
        "created_at": now
    }
    
    result = await db.leave_approvals.insert_one(leave_doc)
    leave_doc["_id"] = result.inserted_id
    
    # Create attendance records for leave days
    current_date = start_date.replace(hour=0, minute=0, second=0, microsecond=0)
    while current_date <= end_date:
        # Check if attendance already exists
        existing = await db.attendance.find_one({
            "user_id": data.user_id,
            "attendance_date": current_date
        })
        
        if not existing:
            await db.attendance.insert_one({
                "user_id": data.user_id,
                "user_name": user["name"],
                "attendance_date": current_date,
                "work_mode": "LEAVE",
                "attendance_status": "ON_LEAVE",
                "created_at": now,
                "updated_at": now
            })
        
        current_date += timedelta(days=1)
    
    return serialize_doc(leave_doc)

# ===================== SETTINGS =====================

@router.get("/admin/settings")
async def admin_get_settings(current_user: dict = Depends(require_admin)):
    """Get attendance settings (Admin only)"""
    return await get_attendance_settings()

@router.patch("/admin/settings")
async def admin_update_settings(
    data: AttendanceSettingsUpdate,
    current_user: dict = Depends(require_admin)
):
    """Update attendance settings (Admin only)"""
    now = datetime.now(timezone.utc)
    
    update_data = {"updated_at": now, "updated_by": current_user["id"]}
    
    if data.office_start_time is not None:
        update_data["office_start_time"] = data.office_start_time
    if data.late_after_time is not None:
        update_data["late_after_time"] = data.late_after_time
    if data.full_day_minutes is not None:
        update_data["full_day_minutes"] = data.full_day_minutes
    if data.half_day_minutes is not None:
        update_data["half_day_minutes"] = data.half_day_minutes
    if data.allowed_office_radius_meters is not None:
        update_data["allowed_office_radius_meters"] = data.allowed_office_radius_meters
    if data.location_accuracy_threshold_meters is not None:
        update_data["location_accuracy_threshold_meters"] = data.location_accuracy_threshold_meters
    if data.require_registered_device is not None:
        update_data["require_registered_device"] = data.require_registered_device
    
    await db.attendance_settings.update_one(
        {"_id": "global"},
        {"$set": update_data},
        upsert=True
    )
    
    return await get_attendance_settings()

# ===================== EXPORT =====================

@router.get("/admin/export")
async def admin_export_attendance(
    start_date: str,
    end_date: str,
    user_id: Optional[str] = None,
    current_user: dict = Depends(require_admin)
):
    """Export attendance data (Admin only)"""
    try:
        start = datetime.fromisoformat(start_date.replace('Z', '+00:00'))
        end = datetime.fromisoformat(end_date.replace('Z', '+00:00')) + timedelta(days=1)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format")
    
    query = {"attendance_date": {"$gte": start, "$lt": end}}
    if user_id:
        query["user_id"] = user_id
    
    cursor = db.attendance.find(query).sort([("user_name", 1), ("attendance_date", 1)])
    records = await cursor.to_list(length=5000)
    
    # Format for export with IST times
    export_data = []
    for r in records:
        # Convert times to IST for display
        check_in_ist = utc_to_ist(r.get("check_in_time")) if r.get("check_in_time") else None
        check_out_ist = utc_to_ist(r.get("check_out_time")) if r.get("check_out_time") else None
        attendance_date_ist = utc_to_ist(r.get("attendance_date")) if r.get("attendance_date") else None
        
        export_data.append({
            "Employee": r.get("user_name", "Unknown"),
            "Date": attendance_date_ist.strftime("%Y-%m-%d") if attendance_date_ist else "",
            "Work Mode": r.get("work_mode", ""),
            "Check In (IST)": check_in_ist.strftime("%I:%M %p") if check_in_ist else "",
            "Check Out (IST)": check_out_ist.strftime("%I:%M %p") if check_out_ist else "",
            "Working Hours": f"{r.get('working_minutes', 0) // 60}h {r.get('working_minutes', 0) % 60}m",
            "Status": r.get("attendance_status", ""),
            "Late Minutes": r.get("late_minutes", 0),
            "Office Distance (m)": r.get("check_in_distance_from_office", ""),
            "Manual Adjustment": "Yes" if r.get("manually_adjusted") else "No"
        })
    
    return export_data



@router.get("/admin/weekly-summary")
async def admin_get_weekly_attendance_summary(
    start_date: Optional[str] = None,
    current_user: dict = Depends(require_admin)
):
    """Get weekly attendance summary for all employees (Admin only)"""
    ist_now = get_ist_now()
    
    # Calculate week start (Monday) and end (Sunday)
    if start_date:
        try:
            week_start = datetime.fromisoformat(start_date.replace('Z', '+00:00'))
            if week_start.tzinfo is None:
                week_start = week_start.replace(tzinfo=IST)
        except ValueError:
            week_start = ist_now - timedelta(days=ist_now.weekday())
    else:
        # Default to current week (Monday start)
        week_start = ist_now - timedelta(days=ist_now.weekday())
    
    week_start = week_start.replace(hour=0, minute=0, second=0, microsecond=0)
    week_end = week_start + timedelta(days=7)
    
    # Convert to UTC for queries
    week_start_utc = week_start.astimezone(timezone.utc)
    week_end_utc = week_end.astimezone(timezone.utc)
    
    # Get all active users
    users = await db.users.find({"is_active": True, "role": {"$ne": "admin"}}).to_list(100)
    
    # Get attendance records for the week
    attendance_records = await db.attendance.find({
        "attendance_date": {"$gte": week_start_utc, "$lt": week_end_utc}
    }).to_list(1000)
    
    # Group by user
    user_attendance = {}
    for user in users:
        user_id = str(user["_id"])
        user_attendance[user_id] = {
            "user_id": user_id,
            "user_name": user.get("name", "Unknown"),
            "user_email": user.get("email", ""),
            "days_present": 0,
            "days_late": 0,
            "days_absent": 0,
            "days_wfh": 0,
            "days_office": 0,
            "days_leave": 0,
            "total_working_minutes": 0,
            "daily_records": []
        }
    
    for record in attendance_records:
        user_id = record.get("user_id")
        if user_id not in user_attendance:
            continue
        
        status = record.get("attendance_status", "")
        work_mode = record.get("work_mode", "")
        
        if status in ["PRESENT", "LATE"]:
            user_attendance[user_id]["days_present"] += 1
        if status == "LATE":
            user_attendance[user_id]["days_late"] += 1
        if status == "ON_LEAVE":
            user_attendance[user_id]["days_leave"] += 1
        
        if work_mode == "OFFICE":
            user_attendance[user_id]["days_office"] += 1
        elif work_mode == "WORK_FROM_HOME":
            user_attendance[user_id]["days_wfh"] += 1
        
        user_attendance[user_id]["total_working_minutes"] += record.get("working_minutes", 0)
        
        # Add daily record
        check_in_ist = utc_to_ist(record.get("check_in_time")) if record.get("check_in_time") else None
        check_out_ist = utc_to_ist(record.get("check_out_time")) if record.get("check_out_time") else None
        attendance_date_ist = utc_to_ist(record.get("attendance_date")) if record.get("attendance_date") else None
        
        user_attendance[user_id]["daily_records"].append({
            "date": attendance_date_ist.strftime("%Y-%m-%d") if attendance_date_ist else "",
            "day": attendance_date_ist.strftime("%A") if attendance_date_ist else "",
            "status": status,
            "work_mode": work_mode,
            "check_in": check_in_ist.strftime("%I:%M %p") if check_in_ist else None,
            "check_out": check_out_ist.strftime("%I:%M %p") if check_out_ist else None,
            "working_minutes": record.get("working_minutes", 0)
        })
    
    # Calculate absent days (working days without attendance)
    working_days = 5  # Mon-Fri
    for user_id, data in user_attendance.items():
        data["days_absent"] = max(0, working_days - data["days_present"] - data["days_leave"])
        data["total_working_hours"] = f"{data['total_working_minutes'] // 60}h {data['total_working_minutes'] % 60}m"
        data["daily_records"].sort(key=lambda x: x["date"])
    
    return {
        "week_start": week_start.strftime("%Y-%m-%d"),
        "week_end": (week_end - timedelta(days=1)).strftime("%Y-%m-%d"),
        "employees": list(user_attendance.values()),
        "summary": {
            "total_employees": len(users),
            "total_present_days": sum(e["days_present"] for e in user_attendance.values()),
            "total_late_days": sum(e["days_late"] for e in user_attendance.values()),
            "total_absent_days": sum(e["days_absent"] for e in user_attendance.values()),
            "total_leave_days": sum(e["days_leave"] for e in user_attendance.values())
        }
    }

@router.get("/admin/monthly-summary")
async def admin_get_monthly_attendance_summary(
    month: Optional[int] = None,
    year: Optional[int] = None,
    current_user: dict = Depends(require_admin)
):
    """Get monthly attendance summary for all employees (Admin only)"""
    ist_now = get_ist_now()
    target_month = month or ist_now.month
    target_year = year or ist_now.year
    
    # Calculate month boundaries in IST
    month_start = datetime(target_year, target_month, 1, tzinfo=IST)
    if target_month == 12:
        month_end = datetime(target_year + 1, 1, 1, tzinfo=IST)
    else:
        month_end = datetime(target_year, target_month + 1, 1, tzinfo=IST)
    
    # Convert to UTC for queries
    month_start_utc = month_start.astimezone(timezone.utc)
    month_end_utc = month_end.astimezone(timezone.utc)
    
    # Calculate working days in month (excluding weekends)
    working_days = 0
    current_day = month_start
    while current_day < month_end:
        if current_day.weekday() < 5:  # Monday = 0, Friday = 4
            working_days += 1
        current_day += timedelta(days=1)
    
    # Get all active users
    users = await db.users.find({"is_active": True, "role": {"$ne": "admin"}}).to_list(100)
    
    # Get attendance records for the month
    attendance_records = await db.attendance.find({
        "attendance_date": {"$gte": month_start_utc, "$lt": month_end_utc}
    }).to_list(5000)
    
    # Group by user
    user_attendance = {}
    for user in users:
        user_id = str(user["_id"])
        user_attendance[user_id] = {
            "user_id": user_id,
            "user_name": user.get("name", "Unknown"),
            "user_email": user.get("email", ""),
            "days_present": 0,
            "days_late": 0,
            "days_half_day": 0,
            "days_absent": 0,
            "days_wfh": 0,
            "days_office": 0,
            "days_leave": 0,
            "total_working_minutes": 0,
            "total_late_minutes": 0,
            "attendance_percentage": 0
        }
    
    for record in attendance_records:
        user_id = record.get("user_id")
        if user_id not in user_attendance:
            continue
        
        status = record.get("attendance_status", "")
        work_mode = record.get("work_mode", "")
        
        if status in ["PRESENT", "LATE"]:
            user_attendance[user_id]["days_present"] += 1
        if status == "LATE":
            user_attendance[user_id]["days_late"] += 1
            user_attendance[user_id]["total_late_minutes"] += record.get("late_minutes", 0)
        if status == "HALF_DAY":
            user_attendance[user_id]["days_half_day"] += 1
            user_attendance[user_id]["days_present"] += 0.5
        if status == "ON_LEAVE":
            user_attendance[user_id]["days_leave"] += 1
        
        if work_mode == "OFFICE":
            user_attendance[user_id]["days_office"] += 1
        elif work_mode == "WORK_FROM_HOME":
            user_attendance[user_id]["days_wfh"] += 1
        
        user_attendance[user_id]["total_working_minutes"] += record.get("working_minutes", 0)
    
    # Calculate absent days and attendance percentage
    for user_id, data in user_attendance.items():
        # Use ceiling of days_present to properly account for half days
        effective_present = int(data["days_present"]) + (1 if data["days_present"] % 1 > 0 else 0)
        data["days_absent"] = max(0, working_days - effective_present - data["days_leave"])
        data["total_working_hours"] = f"{data['total_working_minutes'] // 60}h {data['total_working_minutes'] % 60}m"
        data["attendance_percentage"] = round((data["days_present"] / working_days) * 100, 1) if working_days > 0 else 0
    
    # Sort by attendance percentage descending
    employees_list = sorted(user_attendance.values(), key=lambda x: x["attendance_percentage"], reverse=True)
    
    return {
        "month": target_month,
        "year": target_year,
        "month_name": month_start.strftime("%B %Y"),
        "working_days": working_days,
        "employees": employees_list,
        "summary": {
            "total_employees": len(users),
            "avg_attendance_percentage": round(sum(e["attendance_percentage"] for e in employees_list) / len(employees_list), 1) if employees_list else 0,
            "total_present_days": sum(int(e["days_present"]) for e in employees_list),
            "total_late_days": sum(e["days_late"] for e in employees_list),
            "total_absent_days": sum(e["days_absent"] for e in employees_list),
            "total_leave_days": sum(e["days_leave"] for e in employees_list),
            "total_wfh_days": sum(e["days_wfh"] for e in employees_list),
            "total_office_days": sum(e["days_office"] for e in employees_list)
        }
    }
