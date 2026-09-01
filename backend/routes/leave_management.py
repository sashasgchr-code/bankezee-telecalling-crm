"""
Leave and WFH Management Routes
Handles employee-initiated leave/WFH requests with approval workflows
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from datetime import datetime, timezone, timedelta
from typing import Optional, List
from bson import ObjectId
from zoneinfo import ZoneInfo

from utils.database import db
from utils.auth import get_current_user, require_admin, require_hr_or_admin
from utils.helpers import serialize_doc, serialize_docs
from utils.email_service import send_leave_request_notification, send_leave_approval_notification
from models.schemas import LeaveRequest, LeaveRequestApproval, WFHRequestCreate, WFHRequestApproval

router = APIRouter(prefix="/api/leave", tags=["Leave Management"])

IST = ZoneInfo("Asia/Kolkata")

LEAVE_TYPES = ["CASUAL", "SICK", "EARNED", "UNPAID", "EMERGENCY", "GENERAL"]
REQUEST_STATUSES = ["PENDING", "APPROVED", "REJECTED", "CANCELLED"]


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


@router.get("/balance")
async def get_leave_balance(current_user: dict = Depends(get_current_user)):
    """Get leave balance for current user"""
    user_id = current_user["id"]
    
    # Get user's leave balance (or create default if not exists)
    balance = await db.leave_balances.find_one({"user_id": user_id})
    
    if not balance:
        # Create default balance for new user
        default_balance = {
            "user_id": user_id,
            "casual": 12.0,
            "sick": 6.0,
            "earned": 15.0,
            "unpaid": 0.0,  # Unlimited but tracked
            "year": datetime.now(timezone.utc).year,
            "created_at": datetime.now(timezone.utc)
        }
        await db.leave_balances.insert_one(default_balance)
        balance = default_balance
    
    # Calculate used leave days
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
    
    return {
        "casual": {"total": balance.get("casual", 12), "used": used_map.get("CASUAL", 0)},
        "sick": {"total": balance.get("sick", 6), "used": used_map.get("SICK", 0)},
        "earned": {"total": balance.get("earned", 15), "used": used_map.get("EARNED", 0)},
        "unpaid": {"total": "Unlimited", "used": used_map.get("UNPAID", 0)},
        "year": balance.get("year", datetime.now().year)
    }


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
