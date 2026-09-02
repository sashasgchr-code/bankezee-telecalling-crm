"""
Leave and WFH Management Routes - P.A.L.M.E Policy Implementation
BankEzee Rule: 2 ALLOWED LEAVE DAYS PER MONTH with monthly carry-forward within year

P.A.L.M.E = Present, Absent, Leave, Medical, Emergency

Leave Policy:
- 2 approved leaves per month (must apply 3+ days in advance)
- Sick leave >3 consecutive days requires medical certificate
- Uninformed leave = ₹100 penalty
- Emergency leave: inform before office hours on same day

Rewards:
- Weekly (On Time All Week): ₹200
- Monthly (Perfect Punctuality): ₹500
- Special (3 Consecutive Months Outstanding): ₹2,000 + Certificate
"""
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form
from datetime import datetime, timezone, timedelta
from typing import Optional, List
from bson import ObjectId
from zoneinfo import ZoneInfo
from calendar import monthrange
import base64

from utils.database import db
from utils.auth import get_current_user, require_admin, require_hr_or_admin
from utils.helpers import serialize_doc, serialize_docs
from utils.email_service import send_leave_request_notification, send_leave_approval_notification
from models.schemas import LeaveRequest, LeaveRequestApproval, WFHRequestCreate, WFHRequestApproval

router = APIRouter(prefix="/api/leave", tags=["Leave Management"])

IST = ZoneInfo("Asia/Kolkata")

# BankEzee Leave Policy: 2 days per month
MONTHLY_LEAVE_ALLOWANCE = 2

# P.A.L.M.E Leave Types
LEAVE_TYPES = [
    "ALLOWED",      # Standard planned leave (3+ days advance)
    "SICK",         # Sick leave (>3 days needs medical cert)
    "MEDICAL",      # Medical leave with certificate
    "EMERGENCY",    # Emergency (same day, before office hours)
    "UNINFORMED",   # Leave without prior approval (penalty applies)
    "UNPAID"        # Unpaid leave
]

REQUEST_STATUSES = ["PENDING", "APPROVED", "REJECTED", "CANCELLED"]

# Rewards & Penalties (in INR)
REWARDS = {
    "weekly_on_time": 200,      # On time all week
    "monthly_perfect": 500,     # Perfect punctuality entire month
    "quarterly_outstanding": 2000  # 3 consecutive months outstanding + Certificate
}
PENALTIES = {
    "uninformed_leave": 100     # Per uninformed leave
}

# For 2026, accrual starts from September
SPECIAL_YEAR_ACCRUAL_START = {
    2026: 9  # September
}


def calculate_leave_days(start_date: datetime, end_date: datetime, half_day: bool = False) -> float:
    """Calculate number of leave days between dates"""
    if half_day:
        return 0.5
    
    days = 0
    current = start_date
    while current <= end_date:
        # Exclude weekends (optional - based on company policy)
        if current.weekday() < 5:  # Monday = 0, Friday = 4
            days += 1
        current += timedelta(days=1)
    return float(days)


def calculate_accrued_leave(year: int, current_month: int = None) -> float:
    """
    Calculate accrued leave entitlement for a year up to the specified month.
    BankEzee Rule: 2 days per month, accrues monthly.
    
    Special Rule: For 2026, accrual starts from September only.
    
    Args:
        year: The year to calculate for
        current_month: The month to calculate up to (1-12). If None, uses current month.
    
    Returns:
        Total accrued leave days for the year up to the specified month
    """
    now = datetime.now(IST)
    
    if current_month is None:
        if year == now.year:
            current_month = now.month
        elif year < now.year:
            current_month = 12  # Full year
        else:
            current_month = 0  # Future year
    
    # Check if this year has a special accrual start month
    accrual_start_month = SPECIAL_YEAR_ACCRUAL_START.get(year, 1)  # Default: January
    
    if current_month < accrual_start_month:
        # No accrual yet for this year
        return 0.0
    
    # Count months from accrual start to current month
    accrual_months = current_month - accrual_start_month + 1
    
    # Accrued = 2 days × accrual months
    return float(accrual_months * MONTHLY_LEAVE_ALLOWANCE)


async def get_leave_balance(user_id: str, year: int) -> dict:
    """
    Calculate leave balance for a user in a specific year.
    Includes P.A.L.M.E metrics: rewards, penalties, medical certificates.
    
    Returns comprehensive leave and accountability data.
    """
    now = datetime.now(IST)
    
    # Calculate accrued based on current month and special year rules
    accrued = calculate_accrued_leave(year)
    
    # Get accrual start month for display
    accrual_start_month = SPECIAL_YEAR_ACCRUAL_START.get(year, 1)
    
    # Get start and end of year (or accrual period)
    year_start = datetime(year, accrual_start_month, 1, 0, 0, 0, tzinfo=IST)
    year_end = datetime(year, 12, 31, 23, 59, 59, tzinfo=IST)
    
    # Calculate used leave (approved requests in this year)
    used_pipeline = [
        {
            "$match": {
                "user_id": user_id,
                "status": "APPROVED",
                "leave_type": {"$in": ["ALLOWED", "SICK", "MEDICAL", "EMERGENCY", "CASUAL", "EARNED", "GENERAL"]},
                "start_date": {"$gte": year_start, "$lte": year_end}
            }
        },
        {
            "$group": {
                "_id": None,
                "total_days": {"$sum": "$leave_days"}
            }
        }
    ]
    
    used_result = await db.leave_requests.aggregate(used_pipeline).to_list(1)
    used = used_result[0]["total_days"] if used_result else 0.0
    
    # Calculate pending leave
    pending_pipeline = [
        {
            "$match": {
                "user_id": user_id,
                "status": "PENDING",
                "leave_type": {"$in": ["ALLOWED", "SICK", "MEDICAL", "EMERGENCY", "CASUAL", "EARNED", "GENERAL"]},
                "start_date": {"$gte": year_start, "$lte": year_end}
            }
        },
        {
            "$group": {
                "_id": None,
                "total_days": {"$sum": "$leave_days"}
            }
        }
    ]
    
    pending_result = await db.leave_requests.aggregate(pending_pipeline).to_list(1)
    pending = pending_result[0]["total_days"] if pending_result else 0.0
    
    # Count uninformed leaves for penalties
    uninformed_count = await db.leave_requests.count_documents({
        "user_id": user_id,
        "status": "APPROVED",
        "leave_type": "UNINFORMED",
        "start_date": {"$gte": year_start, "$lte": year_end}
    })
    
    # Calculate yearly allowance based on remaining months
    if year == now.year:
        remaining_months = 12 - accrual_start_month + 1
    else:
        remaining_months = 12 - accrual_start_month + 1
    yearly_allowance = remaining_months * MONTHLY_LEAVE_ALLOWANCE
    
    available = max(0, accrued - used)
    remaining_potential = max(0, yearly_allowance - used)
    
    # Calculate penalties
    total_penalties = uninformed_count * PENALTIES["uninformed_leave"]
    
    # Get rewards earned this year
    rewards_data = await db.palme_rewards.find({
        "user_id": user_id,
        "year": year
    }).to_list(100)
    
    total_rewards = sum(r.get("amount", 0) for r in rewards_data)
    
    # Get pending medical certificate requirements
    pending_medical = await db.leave_requests.count_documents({
        "user_id": user_id,
        "status": "APPROVED",
        "leave_type": "SICK",
        "leave_days": {"$gt": 3},
        "medical_certificate_submitted": {"$ne": True},
        "start_date": {"$gte": year_start, "$lte": year_end}
    })
    
    return {
        "year": year,
        "accrual_start_month": accrual_start_month,
        "accrual_start_month_name": datetime(year, accrual_start_month, 1).strftime("%B"),
        "accrued": accrued,
        "used": used,
        "available": available,
        "pending": pending,
        "yearly_allowance": yearly_allowance,
        "remaining_potential": remaining_potential,
        "monthly_allowance": MONTHLY_LEAVE_ALLOWANCE,
        # P.A.L.M.E Accountability
        "uninformed_leaves": uninformed_count,
        "total_penalties": total_penalties,
        "total_rewards": total_rewards,
        "pending_medical_certificates": pending_medical,
        "net_amount": total_rewards - total_penalties  # Net reward/penalty
    }


# ===================== LEAVE BALANCE ENDPOINTS =====================

@router.get("/balance")
async def get_my_leave_balance(
    year: Optional[int] = None,
    current_user: dict = Depends(get_current_user)
):
    """
    Get current user's leave balance for a year.
    Defaults to current year.
    """
    if year is None:
        year = datetime.now(IST).year
    
    balance = await get_leave_balance(current_user["id"], year)
    return balance


@router.get("/balance/{user_id}")
async def get_user_leave_balance(
    user_id: str,
    year: Optional[int] = None,
    current_user: dict = Depends(require_hr_or_admin)
):
    """Admin/HR: Get a specific user's leave balance"""
    if year is None:
        year = datetime.now(IST).year
    
    balance = await get_leave_balance(user_id, year)
    
    # Get user info - handle both ObjectId and UUID
    user = None
    try:
        if len(user_id) == 24:  # Valid ObjectId format
            user = await db.users.find_one({"_id": ObjectId(user_id)})
    except Exception:
        pass
    
    if not user:
        # Try by id field (UUID)
        user = await db.users.find_one({"id": user_id})
    
    if user:
        balance["user_name"] = user.get("name", "Unknown")
        balance["user_email"] = user.get("email", "")
    
    return balance


# ===================== EMPLOYEE ENDPOINTS =====================

@router.post("/requests")
async def submit_leave_request(data: LeaveRequest, current_user: dict = Depends(get_current_user)):
    """Submit a leave request"""
    now = datetime.now(timezone.utc)
    
    try:
        start_date = datetime.fromisoformat(data.start_date.replace('Z', '+00:00'))
        end_date = datetime.fromisoformat(data.end_date.replace('Z', '+00:00'))
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format")
    
    # Validate dates
    if end_date < start_date:
        raise HTTPException(status_code=400, detail="End date cannot be before start date")
    
    # Check if leave type is valid
    if data.leave_type not in LEAVE_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid leave type. Must be one of: {LEAVE_TYPES}")
    
    # Check for overlapping leave requests
    existing = await db.leave_requests.find_one({
        "user_id": current_user["id"],
        "status": {"$in": ["PENDING", "APPROVED"]},
        "$or": [
            {"start_date": {"$lte": end_date}, "end_date": {"$gte": start_date}}
        ]
    })
    
    if existing:
        raise HTTPException(status_code=400, detail="You already have a leave request for overlapping dates")
    
    # Calculate leave days
    leave_days = calculate_leave_days(start_date, end_date, data.half_day)
    
    request_doc = {
        "user_id": current_user["id"],
        "user_name": current_user["name"],
        "user_email": current_user.get("email", ""),
        "start_date": start_date.replace(hour=0, minute=0, second=0, microsecond=0),
        "end_date": end_date.replace(hour=23, minute=59, second=59, microsecond=0),
        "leave_type": data.leave_type,
        "reason": data.reason,
        "half_day": data.half_day,
        "half_day_type": data.half_day_type,
        "leave_days": leave_days,
        "status": "PENDING",
        "created_at": now,
        "updated_at": now
    }
    
    result = await db.leave_requests.insert_one(request_doc)
    request_doc["_id"] = result.inserted_id
    
    # Send notification to HR/Admin
    await send_leave_request_notification(
        employee_name=current_user["name"],
        leave_type=data.leave_type,
        start_date=start_date,
        end_date=end_date,
        reason=data.reason,
        request_id=str(result.inserted_id)
    )
    
    return {
        "success": True,
        "message": "Leave request submitted successfully",
        "request": serialize_doc(request_doc)
    }


@router.get("/requests/my")
async def get_my_leave_requests(
    status: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """Get current user's leave requests"""
    query = {"user_id": current_user["id"]}
    if status:
        query["status"] = status
    
    requests = await db.leave_requests.find(query).sort("created_at", -1).to_list(100)
    return serialize_docs(requests)


@router.delete("/requests/{request_id}")
async def cancel_leave_request(request_id: str, current_user: dict = Depends(get_current_user)):
    """Cancel a pending leave request"""
    request = await db.leave_requests.find_one({"_id": ObjectId(request_id)})
    
    if not request:
        raise HTTPException(status_code=404, detail="Leave request not found")
    
    if request["user_id"] != current_user["id"]:
        raise HTTPException(status_code=403, detail="Access denied")
    
    if request["status"] != "PENDING":
        raise HTTPException(status_code=400, detail="Only pending requests can be cancelled")
    
    await db.leave_requests.update_one(
        {"_id": ObjectId(request_id)},
        {"$set": {
            "status": "CANCELLED",
            "updated_at": datetime.now(timezone.utc)
        }}
    )
    
    return {"success": True, "message": "Leave request cancelled"}


# ===================== WFH REQUESTS =====================

@router.post("/wfh/requests")
async def submit_wfh_request(data: WFHRequestCreate, current_user: dict = Depends(get_current_user)):
    """Submit a WFH request"""
    now = datetime.now(timezone.utc)
    
    try:
        request_date = datetime.fromisoformat(data.date.replace('Z', '+00:00'))
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format")
    
    # Check for existing request
    existing = await db.wfh_requests.find_one({
        "user_id": current_user["id"],
        "date": {"$gte": request_date.replace(hour=0), "$lt": request_date.replace(hour=0) + timedelta(days=1)},
        "status": {"$in": ["PENDING", "APPROVED"]}
    })
    
    if existing:
        raise HTTPException(status_code=400, detail="WFH request already exists for this date")
    
    request_doc = {
        "user_id": current_user["id"],
        "user_name": current_user["name"],
        "user_email": current_user.get("email", ""),
        "date": request_date.replace(hour=0, minute=0, second=0, microsecond=0),
        "reason": data.reason,
        "status": "PENDING",
        "created_at": now,
        "updated_at": now
    }
    
    result = await db.wfh_requests.insert_one(request_doc)
    request_doc["_id"] = result.inserted_id
    
    # Send notification to HR/Admin
    await send_leave_request_notification(
        employee_name=current_user["name"],
        leave_type="WFH",
        start_date=request_date,
        end_date=request_date,
        reason=data.reason,
        request_id=str(result.inserted_id)
    )
    
    return {
        "success": True,
        "message": "WFH request submitted successfully",
        "request": serialize_doc(request_doc)
    }


@router.get("/wfh/requests/my")
async def get_my_wfh_requests(current_user: dict = Depends(get_current_user)):
    """Get current user's WFH requests"""
    requests = await db.wfh_requests.find({"user_id": current_user["id"]}).sort("date", -1).to_list(30)
    return serialize_docs(requests)


# ===================== HR/ADMIN ENDPOINTS =====================

@router.get("/requests/pending")
async def get_pending_leave_requests(current_user: dict = Depends(require_hr_or_admin)):
    """Get all pending leave requests (HR/Admin only)"""
    requests = await db.leave_requests.find({"status": "PENDING"}).sort("created_at", -1).to_list(100)
    return serialize_docs(requests)


@router.get("/requests/all")
async def get_all_leave_requests(
    status: Optional[str] = None,
    user_id: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    current_user: dict = Depends(require_hr_or_admin)
):
    """Get all leave requests with filters (HR/Admin only)"""
    query = {}
    
    if status:
        query["status"] = status
    if user_id:
        query["user_id"] = user_id
    
    if start_date or end_date:
        date_query = {}
        if start_date:
            date_query["$gte"] = datetime.fromisoformat(start_date.replace('Z', '+00:00'))
        if end_date:
            date_query["$lte"] = datetime.fromisoformat(end_date.replace('Z', '+00:00'))
        if date_query:
            query["start_date"] = date_query
    
    requests = await db.leave_requests.find(query).sort("created_at", -1).to_list(500)
    return serialize_docs(requests)


@router.patch("/requests/{request_id}")
async def handle_leave_request(
    request_id: str,
    data: LeaveRequestApproval,
    current_user: dict = Depends(require_hr_or_admin)
):
    """Approve or reject a leave request (HR/Admin only)"""
    request = await db.leave_requests.find_one({"_id": ObjectId(request_id)})
    
    if not request:
        raise HTTPException(status_code=404, detail="Leave request not found")
    
    if request["status"] != "PENDING":
        raise HTTPException(status_code=400, detail="Only pending requests can be processed")
    
    if data.status not in ["APPROVED", "REJECTED"]:
        raise HTTPException(status_code=400, detail="Status must be APPROVED or REJECTED")
    
    now = datetime.now(timezone.utc)
    
    await db.leave_requests.update_one(
        {"_id": ObjectId(request_id)},
        {"$set": {
            "status": data.status,
            "admin_notes": data.admin_notes,
            "handled_by": current_user["id"],
            "handled_by_name": current_user["name"],
            "handled_at": now,
            "updated_at": now
        }}
    )
    
    # If approved, create leave approval record and attendance records
    if data.status == "APPROVED":
        # Create leave approval record
        await db.leave_approvals.insert_one({
            "user_id": request["user_id"],
            "user_name": request["user_name"],
            "start_date": request["start_date"],
            "end_date": request["end_date"],
            "leave_type": request["leave_type"],
            "leave_days": request["leave_days"],
            "reason": request["reason"],
            "status": "APPROVED",
            "approved_by": current_user["id"],
            "created_at": now
        })
        
        # Create attendance records for leave days
        current_date = request["start_date"]
        while current_date <= request["end_date"]:
            # Skip weekends
            if current_date.weekday() < 5:
                existing = await db.attendance.find_one({
                    "user_id": request["user_id"],
                    "attendance_date": current_date
                })
                
                if not existing:
                    await db.attendance.insert_one({
                        "user_id": request["user_id"],
                        "user_name": request["user_name"],
                        "attendance_date": current_date,
                        "work_mode": "LEAVE",
                        "attendance_status": "ON_LEAVE",
                        "leave_type": request["leave_type"],
                        "created_at": now,
                        "updated_at": now
                    })
            
            current_date += timedelta(days=1)
    
    # Send notification to employee
    await send_leave_approval_notification(
        employee_email=request.get("user_email", ""),
        employee_name=request["user_name"],
        leave_type=request["leave_type"],
        start_date=request["start_date"],
        end_date=request["end_date"],
        status=data.status,
        admin_notes=data.admin_notes
    )
    
    updated = await db.leave_requests.find_one({"_id": ObjectId(request_id)})
    return serialize_doc(updated)


@router.get("/wfh/requests/pending")
async def get_pending_wfh_requests(current_user: dict = Depends(require_hr_or_admin)):
    """Get all pending WFH requests (HR/Admin only)"""
    requests = await db.wfh_requests.find({"status": "PENDING"}).sort("created_at", -1).to_list(100)
    return serialize_docs(requests)


@router.get("/wfh/requests/all")
async def get_all_wfh_requests(
    status: Optional[str] = None,
    current_user: dict = Depends(require_hr_or_admin)
):
    """Get all WFH requests (HR/Admin only)"""
    query = {}
    if status:
        query["status"] = status
    
    requests = await db.wfh_requests.find(query).sort("created_at", -1).to_list(200)
    return serialize_docs(requests)


@router.patch("/wfh/requests/{request_id}")
async def handle_wfh_request(
    request_id: str,
    data: WFHRequestApproval,
    current_user: dict = Depends(require_hr_or_admin)
):
    """Approve or reject a WFH request (HR/Admin only)"""
    request = await db.wfh_requests.find_one({"_id": ObjectId(request_id)})
    
    if not request:
        raise HTTPException(status_code=404, detail="WFH request not found")
    
    if request["status"] != "PENDING":
        raise HTTPException(status_code=400, detail="Only pending requests can be processed")
    
    if data.status not in ["APPROVED", "REJECTED"]:
        raise HTTPException(status_code=400, detail="Status must be APPROVED or REJECTED")
    
    now = datetime.now(timezone.utc)
    
    await db.wfh_requests.update_one(
        {"_id": ObjectId(request_id)},
        {"$set": {
            "status": data.status,
            "admin_notes": data.admin_notes,
            "handled_by": current_user["id"],
            "handled_by_name": current_user["name"],
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
    
    # Send notification to employee
    await send_leave_approval_notification(
        employee_email=request.get("user_email", ""),
        employee_name=request["user_name"],
        leave_type="WFH",
        start_date=request["date"],
        end_date=request["date"],
        status=data.status,
        admin_notes=data.admin_notes
    )
    
    updated = await db.wfh_requests.find_one({"_id": ObjectId(request_id)})
    return serialize_doc(updated)


# ===================== LEAVE BALANCE MANAGEMENT =====================

@router.get("/balances/all")
async def get_all_leave_balances(current_user: dict = Depends(require_hr_or_admin)):
    """Get leave balances for all employees (HR/Admin only)"""
    # Get all active users (exclude admins)
    users = await db.users.find({"is_active": True, "role": {"$nin": ["admin"]}}).to_list(200)
    
    balances = []
    for user in users:
        user_id = str(user["_id"])
        balance = await db.leave_balances.find_one({"user_id": user_id})
        
        if not balance:
            balance = {
                "casual": 12.0,
                "sick": 6.0,
                "earned": 15.0,
                "unpaid": 0.0
            }
        
        # Get used leaves
        current_year_start = datetime(datetime.now().year, 1, 1, tzinfo=timezone.utc)
        used_leaves = await db.leave_requests.aggregate([
            {
                "$match": {
                    "user_id": user_id,
                    "status": "APPROVED",
                    "start_date": {"$gte": current_year_start}
                }
            },
            {
                "$group": {
                    "_id": "$leave_type",
                    "total_days": {"$sum": "$leave_days"}
                }
            }
        ]).to_list(10)
        
        used_map = {item["_id"]: item["total_days"] for item in used_leaves}
        
        balances.append({
            "user_id": user_id,
            "user_name": user.get("name", "Unknown"),
            "user_email": user.get("email", ""),
            "casual": {"total": balance.get("casual", 12), "used": used_map.get("CASUAL", 0)},
            "sick": {"total": balance.get("sick", 6), "used": used_map.get("SICK", 0)},
            "earned": {"total": balance.get("earned", 15), "used": used_map.get("EARNED", 0)},
            "unpaid": {"total": "Unlimited", "used": used_map.get("UNPAID", 0)}
        })
    
    return balances


@router.patch("/balances/{user_id}")
async def update_leave_balance(
    user_id: str,
    casual: Optional[float] = None,
    sick: Optional[float] = None,
    earned: Optional[float] = None,
    current_user: dict = Depends(require_hr_or_admin)
):
    """Update leave balance for a user (HR/Admin only)"""
    user = await db.users.find_one({"_id": ObjectId(user_id)})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    update_data = {"updated_at": datetime.now(timezone.utc)}
    
    if casual is not None:
        update_data["casual"] = casual
    if sick is not None:
        update_data["sick"] = sick
    if earned is not None:
        update_data["earned"] = earned
    
    await db.leave_balances.update_one(
        {"user_id": user_id},
        {"$set": update_data},
        upsert=True
    )
    
    return {"success": True, "message": "Leave balance updated"}


# ===================== P.A.L.M.E POLICY ENDPOINTS =====================

@router.get("/palme/policy")
async def get_palme_policy(current_user: dict = Depends(get_current_user)):
    """
    Get P.A.L.M.E policy details and current year rules.
    P = Present, A = Absent, L = Leave, M = Medical, E = Emergency
    """
    now = datetime.now(IST)
    year = now.year
    
    accrual_start = SPECIAL_YEAR_ACCRUAL_START.get(year, 1)
    
    return {
        "policy_name": "P.A.L.M.E Policy",
        "policy_meaning": {
            "P": "Present",
            "A": "Absent", 
            "L": "Leave",
            "M": "Medical",
            "E": "Emergency"
        },
        "leave_rules": {
            "monthly_limit": MONTHLY_LEAVE_ALLOWANCE,
            "advance_notice_days": 3,
            "emergency_notice": "Before office hours on same day",
            "sick_leave_certificate_threshold": 3,  # Days after which medical cert required
            "uninformed_leave_penalty": PENALTIES["uninformed_leave"]
        },
        "rewards": {
            "weekly_on_time": {
                "amount": REWARDS["weekly_on_time"],
                "description": "On time all 5/6 working days"
            },
            "monthly_perfect": {
                "amount": REWARDS["monthly_perfect"],
                "description": "Present on time for entire month"
            },
            "quarterly_outstanding": {
                "amount": REWARDS["quarterly_outstanding"],
                "description": "3 consecutive months of outstanding attendance + Certificate"
            }
        },
        "current_year_rules": {
            "year": year,
            "accrual_starts_from": accrual_start,
            "accrual_month_name": datetime(year, accrual_start, 1).strftime("%B"),
            "total_months": 12 - accrual_start + 1,
            "total_allowance": (12 - accrual_start + 1) * MONTHLY_LEAVE_ALLOWANCE
        }
    }


@router.get("/palme/summary/{user_id}")
async def get_user_palme_summary(
    user_id: str,
    year: Optional[int] = None,
    current_user: dict = Depends(require_hr_or_admin)
):
    """
    Get comprehensive P.A.L.M.E summary for a user (Admin/HR only).
    Includes all leave data, rewards, penalties, and medical certificate status.
    """
    now = datetime.now(IST)
    target_year = year or now.year
    
    # Get user info
    user = None
    try:
        if len(user_id) == 24:
            user = await db.users.find_one({"_id": ObjectId(user_id)})
    except Exception:
        pass
    if not user:
        user = await db.users.find_one({"id": user_id})
    
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Get leave balance (includes rewards/penalties)
    balance = await get_leave_balance(user_id, target_year)
    
    # Get accrual period
    accrual_start = SPECIAL_YEAR_ACCRUAL_START.get(target_year, 1)
    year_start = datetime(target_year, accrual_start, 1, 0, 0, 0, tzinfo=IST)
    year_end = datetime(target_year, 12, 31, 23, 59, 59, tzinfo=IST)
    
    # Get all leave requests for the year
    leave_requests = await db.leave_requests.find({
        "user_id": user_id,
        "start_date": {"$gte": year_start, "$lte": year_end}
    }).sort("start_date", -1).to_list(100)
    
    # Categorize leaves
    leave_breakdown = {
        "ALLOWED": 0,
        "SICK": 0,
        "MEDICAL": 0,
        "EMERGENCY": 0,
        "UNINFORMED": 0,
        "UNPAID": 0
    }
    
    pending_medical_certs = []
    
    for req in leave_requests:
        if req.get("status") == "APPROVED":
            leave_type = req.get("leave_type", "ALLOWED")
            days = req.get("leave_days", 1)
            if leave_type in leave_breakdown:
                leave_breakdown[leave_type] += days
            
            # Check for pending medical certificates (sick leave > 3 days)
            if leave_type == "SICK" and days > 3:
                if not req.get("medical_certificate_submitted"):
                    pending_medical_certs.append({
                        "request_id": str(req["_id"]),
                        "start_date": req["start_date"].strftime("%Y-%m-%d") if req.get("start_date") else "",
                        "end_date": req["end_date"].strftime("%Y-%m-%d") if req.get("end_date") else "",
                        "days": days
                    })
    
    # Get rewards earned
    rewards = await db.palme_rewards.find({
        "user_id": user_id,
        "year": target_year
    }).to_list(100)
    
    rewards_breakdown = {
        "weekly_rewards": [],
        "monthly_rewards": [],
        "quarterly_rewards": [],
        "total": 0
    }
    
    for r in rewards:
        reward_type = r.get("reward_type", "")
        if "weekly" in reward_type.lower():
            rewards_breakdown["weekly_rewards"].append(serialize_doc(r))
        elif "monthly" in reward_type.lower():
            rewards_breakdown["monthly_rewards"].append(serialize_doc(r))
        elif "quarterly" in reward_type.lower() or "outstanding" in reward_type.lower():
            rewards_breakdown["quarterly_rewards"].append(serialize_doc(r))
        rewards_breakdown["total"] += r.get("amount", 0)
    
    return {
        "user_id": user_id,
        "user_name": user.get("name", "Unknown"),
        "user_email": user.get("email", ""),
        "year": target_year,
        "leave_balance": balance,
        "leave_breakdown": leave_breakdown,
        "pending_medical_certificates": pending_medical_certs,
        "rewards": rewards_breakdown,
        "penalties": {
            "uninformed_leaves": balance.get("uninformed_leaves", 0),
            "total_penalty": balance.get("total_penalties", 0)
        },
        "net_amount": rewards_breakdown["total"] - balance.get("total_penalties", 0),
        "leave_requests": serialize_docs(leave_requests[:20])  # Last 20 requests
    }


@router.get("/palme/all-employees")
async def get_all_employees_palme_summary(
    year: Optional[int] = None,
    month: Optional[int] = None,
    current_user: dict = Depends(require_hr_or_admin)
):
    """
    Get P.A.L.M.E summary for all employees (Admin/HR only).
    Shows overview of leave, rewards, penalties for team management.
    """
    now = datetime.now(IST)
    target_year = year or now.year
    target_month = month or now.month
    
    # Get all active users (exclude admins)
    users = await db.users.find({
        "is_active": True, 
        "role": {"$nin": ["admin"]}
    }).to_list(200)
    
    accrual_start = SPECIAL_YEAR_ACCRUAL_START.get(target_year, 1)
    year_start = datetime(target_year, accrual_start, 1, 0, 0, 0, tzinfo=IST)
    year_end = datetime(target_year, 12, 31, 23, 59, 59, tzinfo=IST)
    
    summaries = []
    
    for user in users:
        user_id = str(user["_id"])
        
        # Get leave balance
        balance = await get_leave_balance(user_id, target_year)
        
        # Count approved leaves by type
        leave_counts = await db.leave_requests.aggregate([
            {
                "$match": {
                    "user_id": user_id,
                    "status": "APPROVED",
                    "start_date": {"$gte": year_start, "$lte": year_end}
                }
            },
            {
                "$group": {
                    "_id": "$leave_type",
                    "count": {"$sum": 1},
                    "days": {"$sum": "$leave_days"}
                }
            }
        ]).to_list(10)
        
        leave_by_type = {item["_id"]: {"count": item["count"], "days": item["days"]} for item in leave_counts}
        
        summaries.append({
            "user_id": user_id,
            "user_name": user.get("name", "Unknown"),
            "user_email": user.get("email", ""),
            "leave_accrued": balance.get("accrued", 0),
            "leave_used": balance.get("used", 0),
            "leave_available": balance.get("available", 0),
            "uninformed_leaves": leave_by_type.get("UNINFORMED", {}).get("count", 0),
            "sick_leaves": leave_by_type.get("SICK", {}).get("days", 0),
            "emergency_leaves": leave_by_type.get("EMERGENCY", {}).get("days", 0),
            "total_rewards": balance.get("total_rewards", 0),
            "total_penalties": balance.get("total_penalties", 0),
            "net_amount": balance.get("net_amount", 0),
            "pending_medical_certs": balance.get("pending_medical_certificates", 0)
        })
    
    # Sort by name
    summaries.sort(key=lambda x: x["user_name"])
    
    # Calculate team totals
    team_totals = {
        "total_employees": len(summaries),
        "total_leave_used": sum(s["leave_used"] for s in summaries),
        "total_uninformed": sum(s["uninformed_leaves"] for s in summaries),
        "total_rewards_paid": sum(s["total_rewards"] for s in summaries),
        "total_penalties_collected": sum(s["total_penalties"] for s in summaries),
        "pending_medical_certs": sum(s["pending_medical_certs"] for s in summaries)
    }
    
    return {
        "year": target_year,
        "accrual_starts_from": datetime(target_year, accrual_start, 1).strftime("%B"),
        "employees": summaries,
        "team_totals": team_totals
    }


@router.post("/palme/rewards")
async def add_reward(
    user_id: str = Form(...),
    reward_type: str = Form(...),
    amount: float = Form(...),
    description: Optional[str] = Form(None),
    month: Optional[int] = Form(None),
    week: Optional[int] = Form(None),
    current_user: dict = Depends(require_hr_or_admin)
):
    """
    Add a reward for an employee (Admin/HR only).
    Reward types: weekly_on_time, monthly_perfect, quarterly_outstanding
    """
    now = datetime.now(IST)
    
    # Validate user exists
    user = None
    try:
        if len(user_id) == 24:
            user = await db.users.find_one({"_id": ObjectId(user_id)})
    except Exception:
        pass
    if not user:
        user = await db.users.find_one({"id": user_id})
    
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    reward_doc = {
        "user_id": user_id,
        "user_name": user.get("name", "Unknown"),
        "reward_type": reward_type,
        "amount": amount,
        "description": description or f"{reward_type} reward",
        "year": now.year,
        "month": month or now.month,
        "week": week,
        "awarded_by": current_user["id"],
        "awarded_by_name": current_user["name"],
        "created_at": datetime.now(timezone.utc)
    }
    
    result = await db.palme_rewards.insert_one(reward_doc)
    reward_doc["_id"] = result.inserted_id
    
    return {
        "success": True,
        "message": f"Reward of ₹{amount} added for {user.get('name')}",
        "reward": serialize_doc(reward_doc)
    }


@router.post("/palme/penalty")
async def add_penalty(
    user_id: str = Form(...),
    penalty_type: str = Form(...),
    amount: float = Form(...),
    description: Optional[str] = Form(None),
    leave_request_id: Optional[str] = Form(None),
    current_user: dict = Depends(require_hr_or_admin)
):
    """
    Add a penalty for an employee (Admin/HR only).
    Typically for uninformed leaves.
    """
    now = datetime.now(IST)
    
    # Validate user exists
    user = None
    try:
        if len(user_id) == 24:
            user = await db.users.find_one({"_id": ObjectId(user_id)})
    except Exception:
        pass
    if not user:
        user = await db.users.find_one({"id": user_id})
    
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    penalty_doc = {
        "user_id": user_id,
        "user_name": user.get("name", "Unknown"),
        "penalty_type": penalty_type,
        "amount": amount,
        "description": description or f"{penalty_type} penalty",
        "leave_request_id": leave_request_id,
        "year": now.year,
        "month": now.month,
        "applied_by": current_user["id"],
        "applied_by_name": current_user["name"],
        "created_at": datetime.now(timezone.utc)
    }
    
    result = await db.palme_penalties.insert_one(penalty_doc)
    penalty_doc["_id"] = result.inserted_id
    
    return {
        "success": True,
        "message": f"Penalty of ₹{amount} applied to {user.get('name')}",
        "penalty": serialize_doc(penalty_doc)
    }


@router.post("/requests/{request_id}/medical-certificate")
async def upload_medical_certificate(
    request_id: str,
    certificate_data: str = Form(...),  # Base64 encoded
    certificate_filename: str = Form(...),
    current_user: dict = Depends(get_current_user)
):
    """
    Upload medical certificate for a sick leave request.
    Required when sick leave exceeds 3 consecutive days.
    """
    request = await db.leave_requests.find_one({"_id": ObjectId(request_id)})
    
    if not request:
        raise HTTPException(status_code=404, detail="Leave request not found")
    
    # Verify ownership or admin
    if request["user_id"] != current_user["id"] and current_user["role"] not in ["admin", "hr"]:
        raise HTTPException(status_code=403, detail="Access denied")
    
    now = datetime.now(timezone.utc)
    
    # Store certificate info (in production, upload to cloud storage)
    await db.leave_requests.update_one(
        {"_id": ObjectId(request_id)},
        {"$set": {
            "medical_certificate_submitted": True,
            "medical_certificate_filename": certificate_filename,
            "medical_certificate_data": certificate_data,  # Base64 encoded
            "medical_certificate_submitted_at": now,
            "medical_certificate_submitted_by": current_user["id"],
            "updated_at": now
        }}
    )
    
    return {
        "success": True,
        "message": "Medical certificate uploaded successfully"
    }


@router.get("/requests/{request_id}/medical-certificate")
async def get_medical_certificate(
    request_id: str,
    current_user: dict = Depends(require_hr_or_admin)
):
    """Get medical certificate for a leave request (Admin/HR only)."""
    request = await db.leave_requests.find_one({"_id": ObjectId(request_id)})
    
    if not request:
        raise HTTPException(status_code=404, detail="Leave request not found")
    
    if not request.get("medical_certificate_submitted"):
        raise HTTPException(status_code=404, detail="No medical certificate submitted")
    
    return {
        "filename": request.get("medical_certificate_filename"),
        "data": request.get("medical_certificate_data"),
        "submitted_at": request.get("medical_certificate_submitted_at"),
        "user_name": request.get("user_name")
    }


@router.get("/palme/monthly-summary")
async def get_monthly_leave_summary(
    month: Optional[int] = None,
    year: Optional[int] = None,
    current_user: dict = Depends(require_hr_or_admin)
):
    """
    Get monthly leave summary with P.A.L.M.E breakdown for all employees.
    Shows attendance, leave, rewards, penalties for the month.
    """
    now = datetime.now(IST)
    target_month = month or now.month
    target_year = year or now.year
    
    # Calculate month boundaries
    month_start = datetime(target_year, target_month, 1, 0, 0, 0, tzinfo=IST)
    if target_month == 12:
        month_end = datetime(target_year + 1, 1, 1, 0, 0, 0, tzinfo=IST)
    else:
        month_end = datetime(target_year, target_month + 1, 1, 0, 0, 0, tzinfo=IST)
    
    # Get all active users
    users = await db.users.find({
        "is_active": True,
        "role": {"$nin": ["admin"]}
    }).to_list(200)
    
    # Calculate working days in month
    working_days = 0
    current_day = month_start
    while current_day < month_end:
        if current_day.weekday() < 5:  # Mon-Fri
            working_days += 1
        current_day += timedelta(days=1)
    
    summaries = []
    
    for user in users:
        user_id = str(user["_id"])
        
        # Get attendance for the month
        attendance_records = await db.attendance.find({
            "user_id": user_id,
            "attendance_date": {"$gte": month_start, "$lt": month_end}
        }).to_list(31)
        
        # Count attendance metrics
        present_days = 0
        late_days = 0
        wfh_days = 0
        leave_days = 0
        absent_days = 0
        
        for rec in attendance_records:
            status = rec.get("attendance_status", "")
            work_mode = rec.get("work_mode", "")
            
            if status in ["PRESENT", "LATE"]:
                present_days += 1
                if status == "LATE":
                    late_days += 1
            elif status == "ON_LEAVE":
                leave_days += 1
            
            if work_mode == "WORK_FROM_HOME":
                wfh_days += 1
        
        # Calculate absent days
        absent_days = max(0, working_days - present_days - leave_days)
        
        # Get leave requests for the month
        leave_requests = await db.leave_requests.find({
            "user_id": user_id,
            "status": "APPROVED",
            "start_date": {"$gte": month_start, "$lt": month_end}
        }).to_list(10)
        
        # Categorize leaves
        uninformed = sum(1 for r in leave_requests if r.get("leave_type") == "UNINFORMED")
        emergency = sum(1 for r in leave_requests if r.get("leave_type") == "EMERGENCY")
        sick = sum(1 for r in leave_requests if r.get("leave_type") == "SICK")
        medical = sum(1 for r in leave_requests if r.get("leave_type") == "MEDICAL")
        
        # Get rewards for the month
        monthly_rewards = await db.palme_rewards.find({
            "user_id": user_id,
            "year": target_year,
            "month": target_month
        }).to_list(10)
        total_rewards = sum(r.get("amount", 0) for r in monthly_rewards)
        
        # Calculate penalties
        penalties = uninformed * PENALTIES["uninformed_leave"]
        
        summaries.append({
            "user_id": user_id,
            "user_name": user.get("name", "Unknown"),
            "working_days": working_days,
            "present_days": present_days,
            "late_days": late_days,
            "wfh_days": wfh_days,
            "leave_days": leave_days,
            "absent_days": absent_days,
            "attendance_percentage": round((present_days / working_days * 100), 1) if working_days > 0 else 0,
            "leave_breakdown": {
                "uninformed": uninformed,
                "emergency": emergency,
                "sick": sick,
                "medical": medical
            },
            "rewards": total_rewards,
            "penalties": penalties,
            "net_amount": total_rewards - penalties
        })
    
    # Sort by attendance percentage descending
    summaries.sort(key=lambda x: x["attendance_percentage"], reverse=True)
    
    # Calculate team totals
    team_totals = {
        "total_employees": len(summaries),
        "avg_attendance": round(sum(s["attendance_percentage"] for s in summaries) / len(summaries), 1) if summaries else 0,
        "total_rewards_paid": sum(s["rewards"] for s in summaries),
        "total_penalties": sum(s["penalties"] for s in summaries),
        "total_uninformed_leaves": sum(s["leave_breakdown"]["uninformed"] for s in summaries),
        "total_late_days": sum(s["late_days"] for s in summaries)
    }
    
    return {
        "month": target_month,
        "year": target_year,
        "month_name": month_start.strftime("%B %Y"),
        "working_days": working_days,
        "employees": summaries,
        "team_totals": team_totals
    }


@router.patch("/requests/{request_id}/mark-uninformed")
async def mark_leave_as_uninformed(
    request_id: str,
    current_user: dict = Depends(require_hr_or_admin)
):
    """
    Mark a leave request as uninformed (Admin/HR only).
    Automatically applies penalty.
    """
    request = await db.leave_requests.find_one({"_id": ObjectId(request_id)})
    
    if not request:
        raise HTTPException(status_code=404, detail="Leave request not found")
    
    now = datetime.now(timezone.utc)
    
    # Update leave type to UNINFORMED
    await db.leave_requests.update_one(
        {"_id": ObjectId(request_id)},
        {"$set": {
            "leave_type": "UNINFORMED",
            "marked_uninformed_by": current_user["id"],
            "marked_uninformed_at": now,
            "updated_at": now
        }}
    )
    
    # Auto-apply penalty
    penalty_doc = {
        "user_id": request["user_id"],
        "user_name": request.get("user_name", "Unknown"),
        "penalty_type": "uninformed_leave",
        "amount": PENALTIES["uninformed_leave"],
        "description": f"Uninformed leave penalty for {request.get('start_date', '').strftime('%Y-%m-%d') if request.get('start_date') else 'leave'}",
        "leave_request_id": request_id,
        "year": datetime.now(IST).year,
        "month": datetime.now(IST).month,
        "applied_by": current_user["id"],
        "applied_by_name": current_user["name"],
        "created_at": now
    }
    
    await db.palme_penalties.insert_one(penalty_doc)
    
    return {
        "success": True,
        "message": f"Leave marked as uninformed. ₹{PENALTIES['uninformed_leave']} penalty applied.",
        "penalty_amount": PENALTIES["uninformed_leave"]
    }


@router.get("/palme/rewards-history")
async def get_rewards_history(
    user_id: Optional[str] = None,
    year: Optional[int] = None,
    current_user: dict = Depends(require_hr_or_admin)
):
    """Get rewards history for employees (Admin/HR only)."""
    now = datetime.now(IST)
    target_year = year or now.year
    
    query = {"year": target_year}
    if user_id:
        query["user_id"] = user_id
    
    rewards = await db.palme_rewards.find(query).sort("created_at", -1).to_list(500)
    
    return {
        "year": target_year,
        "rewards": serialize_docs(rewards),
        "total": sum(r.get("amount", 0) for r in rewards)
    }


@router.get("/palme/penalties-history")
async def get_penalties_history(
    user_id: Optional[str] = None,
    year: Optional[int] = None,
    current_user: dict = Depends(require_hr_or_admin)
):
    """Get penalties history for employees (Admin/HR only)."""
    now = datetime.now(IST)
    target_year = year or now.year
    
    query = {"year": target_year}
    if user_id:
        query["user_id"] = user_id
    
    penalties = await db.palme_penalties.find(query).sort("created_at", -1).to_list(500)
    
    return {
        "year": target_year,
        "penalties": serialize_docs(penalties),
        "total": sum(p.get("amount", 0) for p in penalties)
    }

