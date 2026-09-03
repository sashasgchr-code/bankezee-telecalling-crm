"""
User management routes with full RBAC support
BankEzee Connect - Role-Based Access Control
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from datetime import datetime, timedelta, timezone
from typing import Optional, List
from bson import ObjectId

from models.schemas import UserRegister, UserUpdate, BulkDeleteUsersRequest, UserRoleUpdate
from utils.database import db
from utils.auth import (
    get_current_user, require_admin, require_manager_or_admin,
    get_password_hash, normalize_role, is_gp_role, get_user_team_ids,
    validate_tl_manager_match, GP_ROLES, VALID_ROLES
)
from utils.helpers import serialize_doc, serialize_docs

router = APIRouter(prefix="/api", tags=["Users"])


# ===================== HELPER FUNCTIONS =====================

async def find_user_by_id(user_id: str):
    """
    Find a user by either ObjectId (_id) or custom id field.
    Handles both new and legacy users.
    """
    user = None
    
    # First try ObjectId lookup
    try:
        if ObjectId.is_valid(user_id):
            user = await db.users.find_one({"_id": ObjectId(user_id)})
    except Exception:
        pass
    
    # If not found, try custom id field
    if user is None:
        user = await db.users.find_one({"id": user_id})
    
    return user

# ===================== LIST ENDPOINTS =====================

@router.get("/users")
async def list_users(
    role: Optional[str] = None,
    manager_id: Optional[str] = None,
    is_tl: Optional[bool] = None,
    is_active: Optional[bool] = None,
    search: Optional[str] = None,
    current_user: dict = Depends(require_admin)
):
    """
    List all users with optional filters.
    Admin only - sees all users.
    """
    query = {}
    
    if role:
        query["role"] = role
    if manager_id:
        query["manager_id"] = manager_id
    if is_tl is not None:
        query["is_tl"] = is_tl
    if is_active is not None:
        query["is_active"] = is_active
    if search:
        query["$or"] = [
            {"name": {"$regex": search, "$options": "i"}},
            {"email": {"$regex": search, "$options": "i"}},
            {"partner_code": {"$regex": search, "$options": "i"}}
        ]
    
    users = await db.users.find(query).sort("name", 1).to_list(1000)
    
    # Enrich with manager/TL names for display
    enriched_users = []
    for user in users:
        user_data = serialize_doc(user)
        
        # Get manager name
        if user.get("manager_id"):
            manager = await db.users.find_one({"id": user["manager_id"]}, {"name": 1})
            user_data["manager_name"] = manager.get("name") if manager else "Unknown"
        
        # Get TL name
        if user.get("tl_id"):
            tl = await db.users.find_one({"id": user["tl_id"]}, {"name": 1})
            user_data["tl_name"] = tl.get("name") if tl else "Unknown"
        
        enriched_users.append(user_data)
    
    return enriched_users


@router.get("/users/growth-partners")
async def list_growth_partners(
    manager_id: Optional[str] = None,
    tl_id: Optional[str] = None,
    is_active: Optional[bool] = True,
    current_user: dict = Depends(get_current_user)
):
    """
    List Growth Partners with hierarchy filters.
    - Admin/Ops: All GPs
    - Manager: GPs in their hierarchy
    - TL: GPs assigned to them
    - GP: Only themselves
    """
    role = normalize_role(current_user.get("role", ""))
    user_id = current_user.get("id")
    
    query = {"role": {"$in": GP_ROLES}}
    
    if is_active is not None:
        query["is_active"] = is_active
    
    # Apply hierarchy-based filtering
    if role == "admin" or role == "ops":
        # Admin/Ops can see all, but respect explicit filters
        if manager_id:
            query["manager_id"] = manager_id
        if tl_id:
            query["tl_id"] = tl_id
    elif role == "manager":
        # Manager sees only their team
        query["manager_id"] = user_id
        if tl_id:
            query["tl_id"] = tl_id
    elif is_gp_role(role):
        if current_user.get("is_tl"):
            # TL sees GPs assigned to them
            query["tl_id"] = user_id
        else:
            # Regular GP sees only themselves
            query["id"] = user_id
    elif role == "hr":
        # HR cannot list GPs
        raise HTTPException(status_code=403, detail="HR cannot access Growth Partner data")
    
    users = await db.users.find(query).sort("name", 1).to_list(1000)
    return serialize_docs(users)


@router.get("/users/telecallers")
async def list_telecallers(current_user: dict = Depends(get_current_user)):
    """Legacy endpoint - returns active GPs"""
    users = await db.users.find({
        "role": {"$in": GP_ROLES},
        "is_active": True
    }).to_list(1000)
    return serialize_docs(users)


@router.get("/users/managers")
async def get_managers(current_user: dict = Depends(get_current_user)):
    """Get list of managers for assignment dropdown"""
    managers = await db.users.find({
        "role": "manager",
        "is_active": True
    }, {
        "_id": 0, "id": 1, "name": 1, "email": 1, "role": 1
    }).to_list(100)
    
    # Add default option
    result = [{"id": None, "name": "Unassigned", "email": "", "role": ""}]
    result.extend(managers)
    return result


@router.get("/users/team-leads")
async def get_team_leads(
    manager_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """
    Get list of Team Leads for assignment dropdown.
    If manager_id is provided, only return TLs under that manager.
    """
    query = {
        "role": {"$in": GP_ROLES},
        "is_tl": True,
        "is_active": True
    }
    
    if manager_id:
        query["manager_id"] = manager_id
    
    tls = await db.users.find(query, {
        "_id": 0, "id": 1, "name": 1, "email": 1, "manager_id": 1
    }).to_list(100)
    
    # Add default option
    result = [{"id": None, "name": "No Team Lead (Direct to Manager)", "email": "", "manager_id": None}]
    result.extend(tls)
    return result


@router.get("/users/my-team")
async def get_my_team(current_user: dict = Depends(get_current_user)):
    """
    Get team members for the current user (TL only endpoint).
    Returns the list of GPs assigned to this TL with their stats.
    """
    user_id = current_user.get("id")
    is_tl = current_user.get("is_tl", False)
    role = normalize_role(current_user.get("role", ""))
    
    # Only TLs can access this endpoint
    if not is_tl or not is_gp_role(role):
        raise HTTPException(status_code=403, detail="Only Team Leads can access this endpoint")
    
    # Get GPs where tl_id = this user's id
    team_query = {"tl_id": user_id, "is_active": True}
    team_members = await db.users.find(team_query).to_list(100)
    
    # Get today's date for active today calculation
    today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    active_today = 0
    
    # Enrich with stats
    enriched_members = []
    for member in team_members:
        member_id = member.get("id") or str(member.get("_id"))
        
        # Count data (leads) assigned to this GP
        total_data = await db.leads.count_documents({
            "assigned_to": member_id,
            "status": {"$ne": "file"}
        })
        
        # Count files assigned to this GP
        total_files = await db.leads.count_documents({
            "$or": [
                {"assigned_to": member_id},
                {"source_id": member_id}
            ],
            "status": "file"
        })
        
        # Count calls made by this GP
        total_calls = await db.call_logs.count_documents({
            "user_id": member_id
        })
        
        # Check if active today (has activity today)
        today_activity = await db.daily_sessions.find_one({
            "user_id": member_id,
            "date": {"$gte": today}
        })
        if today_activity:
            active_today += 1
        
        member_data = serialize_doc(member)
        member_data["stats"] = {
            "total_data": total_data,
            "total_files": total_files,
            "total_calls": total_calls
        }
        enriched_members.append(member_data)
    
    return {
        "members": enriched_members,
        "stats": {
            "total": len(enriched_members),
            "active_today": active_today
        }
    }


@router.get("/users/by-role")
async def get_users_by_role(
    roles: str = Query(..., description="Comma-separated roles"),
    current_user: dict = Depends(require_admin)
):
    """Get users filtered by roles (comma-separated)"""
    role_list = [r.strip() for r in roles.split(",")]
    users = await db.users.find({
        "role": {"$in": role_list},
        "is_active": True
    }).to_list(1000)
    return serialize_docs(users)


# ===================== USER CRUD =====================

@router.post("/users")
async def create_user(user: UserRegister, current_user: dict = Depends(require_admin)):
    """Create a new user (Admin only)"""
    existing = await db.users.find_one({"email": user.email.lower()})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    
    # Validate role
    role = user.role if user.role in VALID_ROLES else "growth_partner"
    
    user_doc = {
        "email": user.email.lower(),
        "password": get_password_hash(user.password),
        "plain_password": user.password,
        "name": user.name,
        "role": role,
        "phone": None,
        "is_active": True,
        "is_approved": True,
        "approval_status": "approved",
        "is_tl": False,
        "manager_id": None,
        "tl_id": None,
        "created_at": datetime.now(timezone.utc),
        "created_by": current_user.get("id"),
        "last_login": None,
        "last_activity": None
    }
    
    result = await db.users.insert_one(user_doc)
    user_doc["_id"] = result.inserted_id
    
    # Set ID field
    await db.users.update_one(
        {"_id": result.inserted_id},
        {"$set": {"id": str(result.inserted_id)}}
    )
    user_doc["id"] = str(result.inserted_id)
    
    return serialize_doc(user_doc)


@router.put("/users/{user_id}")
async def update_user(user_id: str, update: UserUpdate, current_user: dict = Depends(require_admin)):
    """Update basic user info (Admin only)"""
    update_data = {k: v for k, v in update.dict().items() if v is not None}
    if not update_data:
        raise HTTPException(status_code=400, detail="No fields to update")
    
    # Find user using helper
    user = await find_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    await db.users.update_one(
        {"_id": user["_id"]},
        {"$set": update_data}
    )
    
    updated_user = await db.users.find_one({"_id": user["_id"]})
    return serialize_doc(updated_user)


@router.put("/users/{user_id}/role-hierarchy")
async def update_user_role_hierarchy(
    user_id: str,
    update: UserRoleUpdate,
    current_user: dict = Depends(require_admin)
):
    """
    Update user's role and hierarchy assignment.
    Admin only - handles:
    - Role changes
    - Manager assignment
    - TL assignment (for GPs only)
    - TL capability toggle (for GPs only)
    """
    # Find user using helper
    user = await find_user_by_id(user_id)
    
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    update_data = {}
    current_role = user.get("role", "growth_partner")
    target_role = update.role if update.role is not None else current_role
    
    # Role update
    if update.role is not None:
        if update.role not in VALID_ROLES:
            raise HTTPException(status_code=400, detail=f"Invalid role. Must be one of: {', '.join(VALID_ROLES)}")
        update_data["role"] = update.role
        
        # If changing to non-GP role, clear TL-related fields
        if not is_gp_role(update.role):
            update_data["is_tl"] = False
            update_data["tl_id"] = None
            update_data["tl_name"] = None
    
    # TL capability toggle - only process for GP roles
    if update.is_tl is not None and is_gp_role(target_role):
        update_data["is_tl"] = update.is_tl
        
        # If removing TL status, check for assigned GPs
        if not update.is_tl and user.get("is_tl"):
            user_id_field = user.get("id") or str(user.get("_id"))
            assigned_gps = await db.users.count_documents({"tl_id": user_id_field})
            if assigned_gps > 0:
                raise HTTPException(
                    status_code=400,
                    detail=f"Cannot remove TL status - {assigned_gps} GPs are assigned to this TL. Reassign them first."
                )
    
    # Manager assignment
    if update.manager_id is not None:
        if update.manager_id == "":
            update_data["manager_id"] = None
            update_data["manager_name"] = "Unassigned"
        else:
            # Validate manager exists and has manager role
            manager = await find_user_by_id(update.manager_id)
            if not manager or manager.get("role") != "manager":
                raise HTTPException(status_code=400, detail="Invalid manager ID or user is not a manager")
            update_data["manager_id"] = update.manager_id
            update_data["manager_name"] = manager.get("name", "Unknown")
            
            # If manager changed, validate TL assignment
            current_tl_id = update.tl_id if update.tl_id is not None else user.get("tl_id")
            if current_tl_id:
                is_valid = await validate_tl_manager_match(current_tl_id, update.manager_id)
                if not is_valid:
                    # Clear TL assignment if it doesn't match new manager
                    update_data["tl_id"] = None
                    update_data["tl_name"] = None
    
    # TL assignment - only for GPs (non-TLs)
    if update.tl_id is not None and is_gp_role(target_role):
        # Skip TL assignment if user is becoming a TL themselves
        if not update_data.get("is_tl", user.get("is_tl", False)):
            if update.tl_id == "":
                update_data["tl_id"] = None
                update_data["tl_name"] = None
            else:
                # Validate TL exists and has TL capability
                tl = await find_user_by_id(update.tl_id)
                if not tl or not tl.get("is_tl"):
                    raise HTTPException(status_code=400, detail="Invalid TL ID or user is not a Team Lead")
                
                # Validate TL belongs to same manager
                target_manager_id = update.manager_id if update.manager_id is not None else user.get("manager_id")
                is_valid = await validate_tl_manager_match(update.tl_id, target_manager_id)
                if not is_valid:
                    raise HTTPException(
                        status_code=400,
                        detail="TL must belong to the same manager hierarchy"
                    )
                
                update_data["tl_id"] = update.tl_id
                update_data["tl_name"] = tl.get("name", "Unknown")
    
    # is_active update
    if update.is_active is not None:
        update_data["is_active"] = update.is_active
    
    if not update_data:
        # No changes requested - return current user
        return serialize_doc(user)
    
    update_data["updated_at"] = datetime.now(timezone.utc)
    update_data["updated_by"] = current_user.get("id")
    
    await db.users.update_one({"_id": user["_id"]}, {"$set": update_data})
    
    # Return updated user
    updated_user = await db.users.find_one({"_id": user["_id"]})
    return serialize_doc(updated_user)


@router.put("/users/{user_id}/change-password")
async def change_user_password(user_id: str, password_data: dict, current_user: dict = Depends(require_admin)):
    """Admin can change any user's password"""
    new_password = password_data.get("new_password")
    if not new_password or len(new_password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    
    # Find user using helper
    user = await find_user_by_id(user_id)
    
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Update password
    update_result = await db.users.update_one(
        {"_id": user["_id"]},
        {"$set": {
            "password": get_password_hash(new_password),
            "plain_password": new_password,
            "password_changed_at": datetime.now(timezone.utc),
            "password_changed_by": current_user.get("id")
        }}
    )
    
    if update_result.modified_count == 0:
        raise HTTPException(status_code=500, detail="Failed to update password")
    
    return {"message": "Password changed successfully", "user_id": user_id}


# ===================== ACTIVITY & STATS =====================

@router.get("/users/{user_id}/activity")
async def get_user_activity(user_id: str, current_user: dict = Depends(require_manager_or_admin)):
    """Get user activity summary - Manager or Admin"""
    user = await find_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Check access for managers
    role = normalize_role(current_user.get("role", ""))
    if role == "manager":
        team_ids = await get_user_team_ids(current_user)
        if user_id not in team_ids:
            raise HTTPException(status_code=403, detail="Cannot view activity for users outside your team")
    
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
    current_user: dict = Depends(require_manager_or_admin)
):
    """Get user daily stats - Manager or Admin"""
    # Check access for managers
    role = normalize_role(current_user.get("role", ""))
    if role == "manager":
        team_ids = await get_user_team_ids(current_user)
        if user_id not in team_ids:
            raise HTTPException(status_code=403, detail="Cannot view stats for users outside your team")
    
    end_date = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    start_date = end_date - timedelta(days=days)
    
    sessions = await db.daily_sessions.find({
        "user_id": user_id,
        "date": {"$gte": start_date, "$lte": end_date}
    }).sort("date", -1).to_list(100)
    
    return serialize_docs(sessions)


# ===================== APPROVAL WORKFLOW =====================

@router.get("/users/pending-approval")
async def get_pending_approvals(current_user: dict = Depends(require_manager_or_admin)):
    """
    Get users pending approval.
    - Admin: All pending users
    - Manager: Only pending users in their hierarchy (if pre-assigned)
    """
    role = normalize_role(current_user.get("role", ""))
    
    query = {
        "approval_status": "pending",
        "is_approved": False
    }
    
    # Managers can only see pending users assigned to them
    if role == "manager":
        query["manager_id"] = current_user.get("id")
    
    users = await db.users.find(query).sort("created_at", -1).to_list(1000)
    return serialize_docs(users)


@router.post("/users/{user_id}/approve")
async def approve_user(
    user_id: str,
    approval_data: dict,
    current_user: dict = Depends(require_manager_or_admin)
):
    """
    Approve a pending user registration.
    Admin can approve anyone and assign any manager.
    Manager can approve users and assign to themselves.
    """
    from utils.email_service import send_registration_approval_notification
    
    role = normalize_role(current_user.get("role", ""))
    
    # Find user by ObjectId or UUID
    user = None
    try:
        user = await db.users.find_one({"_id": ObjectId(user_id)})
    except Exception:
        user = await db.users.find_one({"id": user_id})
    
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Get manager/TL info
    manager_id = approval_data.get("manager_id")
    tl_id = approval_data.get("tl_id")
    
    # Managers can only assign to themselves
    if role == "manager":
        manager_id = current_user.get("id")
    
    manager_name = "Unassigned"
    if manager_id:
        manager = await db.users.find_one({"id": manager_id})
        if manager:
            manager_name = manager.get("name", "Unknown")
    
    tl_name = None
    if tl_id:
        tl = await db.users.find_one({"id": tl_id, "is_tl": True})
        if tl:
            # Validate TL belongs to manager
            is_valid = await validate_tl_manager_match(tl_id, manager_id)
            if is_valid:
                tl_name = tl.get("name", "Unknown")
            else:
                tl_id = None  # Clear invalid TL
    
    # Update user
    update_data = {
        "is_active": True,
        "is_approved": True,
        "approval_status": "approved",
        "approval_date": datetime.now(timezone.utc),
        "approved_by": current_user.get("id"),
        "approved_by_name": current_user.get("name"),
        "manager_id": manager_id,
        "manager_name": manager_name,
        "tl_id": tl_id,
        "tl_name": tl_name,
        "role": "growth_partner",  # Ensure GP role on approval
        "is_tl": False  # New GPs are not TLs by default
    }
    
    await db.users.update_one({"_id": user["_id"]}, {"$set": update_data})
    
    # Send email notification
    await send_registration_approval_notification(
        employee_email=user.get("email"),
        employee_name=user.get("name"),
        partner_code=user.get("partner_code", "N/A"),
        manager_name=manager_name if manager_id else None
    )
    
    return {"message": "User approved successfully", "user_id": user_id}


@router.post("/users/{user_id}/reject")
async def reject_user(user_id: str, rejection_data: dict, current_user: dict = Depends(require_manager_or_admin)):
    """Reject a pending user registration"""
    from utils.email_service import send_registration_rejection_notification
    
    # Find user by ObjectId or UUID
    user = None
    try:
        user = await db.users.find_one({"_id": ObjectId(user_id)})
    except Exception:
        user = await db.users.find_one({"id": user_id})
    
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    rejection_reason = rejection_data.get("reason", "")
    
    # Update user
    update_data = {
        "is_active": False,
        "is_approved": False,
        "approval_status": "rejected",
        "rejection_date": datetime.now(timezone.utc),
        "rejected_by": current_user.get("id"),
        "rejected_by_name": current_user.get("name"),
        "rejection_reason": rejection_reason
    }
    
    await db.users.update_one({"_id": user["_id"]}, {"$set": update_data})
    
    # Send email notification
    await send_registration_rejection_notification(
        employee_email=user.get("email"),
        employee_name=user.get("name"),
        rejection_reason=rejection_reason
    )
    
    return {"message": "User rejected", "user_id": user_id}


@router.post("/users/bulk-approve")
async def bulk_approve_users(data: dict, current_user: dict = Depends(require_manager_or_admin)):
    """Bulk approve multiple pending users with manager/TL assignment"""
    from utils.email_service import send_registration_approval_notification
    
    role = normalize_role(current_user.get("role", ""))
    
    user_ids = data.get("user_ids", [])
    manager_id = data.get("manager_id")
    tl_id = data.get("tl_id")
    
    if not user_ids:
        raise HTTPException(status_code=400, detail="No users specified")
    
    # Managers can only assign to themselves
    if role == "manager":
        manager_id = current_user.get("id")
    
    # Get manager info
    manager_name = "Unassigned"
    if manager_id:
        manager = await db.users.find_one({"id": manager_id})
        if manager:
            manager_name = manager.get("name", "Unknown")
    
    # Validate TL if provided
    tl_name = None
    if tl_id:
        tl = await db.users.find_one({"id": tl_id, "is_tl": True})
        if tl:
            is_valid = await validate_tl_manager_match(tl_id, manager_id)
            if is_valid:
                tl_name = tl.get("name", "Unknown")
            else:
                tl_id = None
    
    approved_count = 0
    email_sent_count = 0
    
    for user_id in user_ids:
        try:
            # Find user
            user = None
            try:
                user = await db.users.find_one({"_id": ObjectId(user_id)})
            except Exception:
                user = await db.users.find_one({"id": user_id})
            
            if not user:
                continue
            
            # Update user
            update_data = {
                "is_active": True,
                "is_approved": True,
                "approval_status": "approved",
                "approval_date": datetime.now(timezone.utc),
                "approved_by": current_user.get("id"),
                "approved_by_name": current_user.get("name"),
                "manager_id": manager_id,
                "manager_name": manager_name,
                "tl_id": tl_id,
                "tl_name": tl_name,
                "role": "growth_partner",
                "is_tl": False
            }
            
            await db.users.update_one({"_id": user["_id"]}, {"$set": update_data})
            approved_count += 1
            
            # Send email notification
            email_sent = await send_registration_approval_notification(
                employee_email=user.get("email"),
                employee_name=user.get("name"),
                partner_code=user.get("partner_code", "N/A"),
                manager_name=manager_name if manager_id else None
            )
            if email_sent:
                email_sent_count += 1
                
        except Exception as e:
            print(f"Error approving user {user_id}: {e}")
            continue
    
    return {
        "message": f"Approved {approved_count} users",
        "approved_count": approved_count,
        "emails_sent": email_sent_count
    }


# ===================== USER DELETE & TOGGLE =====================

@router.delete("/users/{user_id}")
async def delete_user(user_id: str, current_user: dict = Depends(require_admin)):
    """
    Delete a single user - Admin only.
    Cannot delete:
    - Admin users
    - Your own account
    - Users with associated files (must deactivate instead)
    """
    if current_user["id"] == user_id:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")
    
    # Find user
    user = await find_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Cannot delete admins
    if user.get("role") == "admin":
        raise HTTPException(status_code=400, detail="Cannot delete admin users")
    
    # Check for associated files
    user_id_str = user.get("id") or str(user.get("_id"))
    file_count = await db.leads.count_documents({
        "$or": [
            {"source_id": user_id_str},
            {"assigned_to": user_id_str}
        ]
    })
    
    if file_count > 0:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot delete user - has {file_count} associated files. Deactivate instead."
        )
    
    # Check if TL with assigned GPs
    if user.get("is_tl"):
        assigned_gps = await db.users.count_documents({"tl_id": user_id_str})
        if assigned_gps > 0:
            raise HTTPException(
                status_code=400,
                detail=f"Cannot delete TL - has {assigned_gps} GPs assigned. Reassign them first."
            )
    
    # Delete user
    result = await db.users.delete_one({"_id": user["_id"]})
    
    if result.deleted_count == 0:
        raise HTTPException(status_code=500, detail="Failed to delete user")
    
    return {"message": f"User {user.get('name', 'Unknown')} deleted successfully"}


@router.put("/users/{user_id}/toggle-active")
async def toggle_user_active(user_id: str, current_user: dict = Depends(require_admin)):
    """
    Toggle user active/inactive status - Admin only.
    Cannot deactivate your own account.
    """
    if current_user["id"] == user_id:
        raise HTTPException(status_code=400, detail="Cannot deactivate your own account")
    
    user = await find_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Toggle status
    new_status = not user.get("is_active", True)
    
    # Update
    result = await db.users.update_one(
        {"_id": user["_id"]},
        {
            "$set": {
                "is_active": new_status,
                "updated_at": datetime.now(timezone.utc).isoformat()
            }
        }
    )
    
    if result.modified_count == 0:
        raise HTTPException(status_code=500, detail="Failed to update user status")
    
    status_text = "activated" if new_status else "deactivated"
    return {"message": f"User {user.get('name', 'Unknown')} {status_text}", "is_active": new_status}


# ===================== LEGACY CRM USER MAPPING =====================

@router.get("/users/legacy-mappings")
async def get_legacy_mappings(current_user: dict = Depends(require_admin)):
    """
    Get all legacy CRM users that need mapping to Connect users.
    Shows unmapped legacy users with their file counts.
    """
    # Get all mappings
    mappings = await db.user_mappings.find({}).to_list(500)
    
    result = []
    for mapping in mappings:
        legacy_id = mapping.get('legacy_user_id')
        
        # Try to get legacy user details from users collection
        legacy_user = await db.users.find_one({"id": legacy_id})
        
        # Count files associated with this legacy user
        file_count = await db.leads.count_documents({
            "$or": [
                {"source_id": legacy_id},
                {"assigned_to": legacy_id}
            ]
        })
        
        result.append({
            "legacy_user_id": legacy_id,
            "legacy_name": legacy_user.get("name") if legacy_user else mapping.get("legacy_name"),
            "legacy_email": legacy_user.get("email") if legacy_user else None,
            "legacy_role": legacy_user.get("role") if legacy_user else mapping.get("legacy_role"),
            "connect_user_id": mapping.get("connect_user_id"),
            "connect_name": mapping.get("connect_name"),
            "status": mapping.get("status", "unmapped"),
            "files_count": file_count,
            "is_mapped": mapping.get("connect_user_id") is not None
        })
    
    # Sort: unmapped first, then by file count
    result.sort(key=lambda x: (x["is_mapped"], -x["files_count"]))
    
    return result


@router.get("/users/connect-users-for-mapping")
async def get_connect_users_for_mapping(current_user: dict = Depends(require_admin)):
    """
    Get Connect users that can be mapped to legacy users.
    Returns active users with GP/Manager roles.
    """
    users = await db.users.find(
        {"is_active": True},
        {"_id": 0, "id": 1, "name": 1, "email": 1, "role": 1}
    ).sort("name", 1).to_list(500)
    
    return users


@router.post("/users/map-legacy-to-connect")
async def map_legacy_to_connect(
    data: dict,
    current_user: dict = Depends(require_admin)
):
    """
    Map a legacy CRM user to a Connect user.
    - Updates all files referencing the legacy user to point to the Connect user
    - Updates the mapping record
    - Optionally deletes the legacy user from the users collection
    """
    legacy_user_id = data.get("legacy_user_id")
    connect_user_id = data.get("connect_user_id")
    delete_legacy = data.get("delete_legacy", True)
    
    if not legacy_user_id or not connect_user_id:
        raise HTTPException(status_code=400, detail="Both legacy_user_id and connect_user_id are required")
    
    # Validate Connect user exists
    connect_user = await db.users.find_one({"id": connect_user_id})
    if not connect_user:
        raise HTTPException(status_code=404, detail="Connect user not found")
    
    # Find legacy user
    legacy_user = await db.users.find_one({"id": legacy_user_id})
    
    # Update all files: replace legacy_user_id with connect_user_id
    files_updated = 0
    
    # Update source_id references
    result1 = await db.leads.update_many(
        {"source_id": legacy_user_id},
        {"$set": {"source_id": connect_user_id}}
    )
    files_updated += result1.modified_count
    
    # Update assigned_to references
    result2 = await db.leads.update_many(
        {"assigned_to": legacy_user_id},
        {"$set": {"assigned_to": connect_user_id}}
    )
    files_updated += result2.modified_count
    
    # Update the mapping record
    await db.user_mappings.update_one(
        {"legacy_user_id": legacy_user_id},
        {
            "$set": {
                "connect_user_id": connect_user_id,
                "connect_name": connect_user.get("name"),
                "connect_role": connect_user.get("role"),
                "status": "mapped",
                "mapped_at": datetime.now(timezone.utc).isoformat(),
                "mapped_by": current_user.get("id")
            }
        },
        upsert=True
    )
    
    # Delete legacy user from users collection if requested and exists
    legacy_deleted = False
    if delete_legacy and legacy_user:
        await db.users.delete_one({"id": legacy_user_id})
        legacy_deleted = True
    
    return {
        "message": f"Successfully mapped legacy user to {connect_user.get('name')}",
        "files_updated": files_updated,
        "legacy_user_deleted": legacy_deleted,
        "connect_user": {
            "id": connect_user_id,
            "name": connect_user.get("name"),
            "email": connect_user.get("email")
        }
    }


@router.delete("/users/legacy-mapping/{legacy_user_id}")
async def delete_legacy_mapping(
    legacy_user_id: str,
    current_user: dict = Depends(require_admin)
):
    """
    Delete a legacy user and their mapping without reassigning files.
    Use this for orphaned legacy users with no files.
    """
    # Check file count
    file_count = await db.leads.count_documents({
        "$or": [
            {"source_id": legacy_user_id},
            {"assigned_to": legacy_user_id}
        ]
    })
    
    if file_count > 0:
        raise HTTPException(
            status_code=400, 
            detail=f"Cannot delete legacy user with {file_count} associated files. Map to a Connect user first."
        )
    
    # Delete mapping
    await db.user_mappings.delete_one({"legacy_user_id": legacy_user_id})
    
    # Delete legacy user if exists
    await db.users.delete_one({"id": legacy_user_id})
    
    return {"message": "Legacy user and mapping deleted"}


# ===================== BULK OPERATIONS =====================

@router.post("/users/bulk-delete")
async def bulk_delete_users(data: BulkDeleteUsersRequest, current_user: dict = Depends(require_admin)):
    """
    Bulk delete users - Admin only.
    Cannot delete admin users or users with historical records.
    """
    if not data.user_ids:
        raise HTTPException(status_code=400, detail="No users specified")
    
    if current_user["id"] in data.user_ids:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")
    
    object_ids = [ObjectId(uid) for uid in data.user_ids]
    
    # Check for admin users
    admin_count = await db.users.count_documents({
        "_id": {"$in": object_ids},
        "role": "admin"
    })
    
    if admin_count > 0:
        raise HTTPException(status_code=400, detail="Cannot bulk delete admin users")
    
    # Check for users with historical records
    for user_id in data.user_ids:
        # Check files
        file_count = await db.leads.count_documents({
            "$or": [
                {"source_id": user_id},
                {"assigned_to": user_id}
            ]
        })
        if file_count > 0:
            user = await db.users.find_one({"id": user_id})
            raise HTTPException(
                status_code=400,
                detail=f"Cannot delete user {user.get('name', user_id)} - has {file_count} associated files. Deactivate instead."
            )
    
    result = await db.users.delete_many({"_id": {"$in": object_ids}})
    
    return {"message": f"Deleted {result.deleted_count} users", "deleted_count": result.deleted_count}


@router.post("/users/bulk-deactivate")
async def bulk_deactivate_users(data: dict, current_user: dict = Depends(require_admin)):
    """Bulk deactivate users (safer than delete)"""
    user_ids = data.get("user_ids", [])
    
    if not user_ids:
        raise HTTPException(status_code=400, detail="No users specified")
    
    if current_user["id"] in user_ids:
        raise HTTPException(status_code=400, detail="Cannot deactivate your own account")
    
    # Don't deactivate admins
    admin_check = await db.users.count_documents({
        "id": {"$in": user_ids},
        "role": "admin"
    })
    if admin_check > 0:
        raise HTTPException(status_code=400, detail="Cannot deactivate admin users")
    
    result = await db.users.update_many(
        {"id": {"$in": user_ids}},
        {"$set": {
            "is_active": False,
            "deactivated_at": datetime.now(timezone.utc),
            "deactivated_by": current_user.get("id")
        }}
    )
    
    return {"message": f"Deactivated {result.modified_count} users", "count": result.modified_count}


# ===================== MISC =====================

@router.put("/users/{user_id}/file-goal")
async def set_user_file_goal(
    user_id: str,
    file_goal: int,
    current_user: dict = Depends(require_manager_or_admin)
):
    """Set file goal for a GP - Manager or Admin"""
    result = await db.users.update_one(
        {"_id": ObjectId(user_id)},
        {"$set": {"file_goal": file_goal}}
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    return {"message": "File goal updated", "file_goal": file_goal}


@router.put("/users/{user_id}/map-connect")
async def map_connect_id(
    user_id: str,
    connect_id: str,
    current_user: dict = Depends(require_admin)
):
    """Map a CRM user to a Connect user ID"""
    # Check if connect_id is already mapped to another user
    existing = await db.users.find_one({
        "connect_id": connect_id,
        "_id": {"$ne": ObjectId(user_id)}
    })
    if existing:
        raise HTTPException(status_code=400, detail="Connect ID already mapped to another user")
    
    result = await db.users.update_one(
        {"_id": ObjectId(user_id)},
        {"$set": {
            "connect_id": connect_id,
            "connect_mapped_at": datetime.now(timezone.utc),
            "connect_mapped_by": current_user["id"]
        }}
    )
    
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    
    user = await db.users.find_one({"_id": ObjectId(user_id)})
    return {
        "message": "Connect ID mapped successfully",
        "user": serialize_doc(user)
    }


@router.get("/users/unmapped")
async def get_unmapped_users(current_user: dict = Depends(require_admin)):
    """Get all CRM users without a connect_id mapping"""
    users = await db.users.find({
        "$or": [
            {"connect_id": {"$exists": False}},
            {"connect_id": None},
            {"connect_id": ""}
        ]
    }).to_list(1000)
    return serialize_docs(users)


# ===================== TEAM HIERARCHY =====================

@router.get("/users/{user_id}/team")
async def get_user_team(user_id: str, current_user: dict = Depends(require_manager_or_admin)):
    """
    Get team members for a manager or TL.
    Returns users under this person's hierarchy.
    """
    user = await db.users.find_one({"id": user_id})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    role = normalize_role(user.get("role", ""))
    is_tl = user.get("is_tl", False)
    
    if role == "manager":
        # Get all users under this manager
        team = await db.users.find({
            "manager_id": user_id,
            "is_active": True
        }).to_list(1000)
    elif is_tl and is_gp_role(role):
        # Get GPs under this TL
        team = await db.users.find({
            "tl_id": user_id,
            "is_active": True
        }).to_list(1000)
    else:
        team = []
    
    return serialize_docs(team)


@router.get("/users/hierarchy-stats")
async def get_hierarchy_stats(current_user: dict = Depends(require_admin)):
    """Get statistics about the user hierarchy"""
    # Count by role
    role_counts = {}
    for role in VALID_ROLES:
        count = await db.users.count_documents({"role": role, "is_active": True})
        role_counts[role] = count
    
    # Legacy GP roles
    gp_count = await db.users.count_documents({
        "role": {"$in": GP_ROLES},
        "is_active": True
    })
    
    # TL count
    tl_count = await db.users.count_documents({"is_tl": True, "is_active": True})
    
    # Unassigned GPs (no manager)
    unassigned_count = await db.users.count_documents({
        "role": {"$in": GP_ROLES},
        "is_active": True,
        "$or": [
            {"manager_id": {"$exists": False}},
            {"manager_id": None}
        ]
    })
    
    # Pending approvals
    pending_count = await db.users.count_documents({
        "approval_status": "pending",
        "is_approved": False
    })
    
    return {
        "role_counts": role_counts,
        "total_gps": gp_count,
        "total_tls": tl_count,
        "unassigned_gps": unassigned_count,
        "pending_approvals": pending_count
    }

