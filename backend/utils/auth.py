"""
Authentication utilities with full RBAC support
BankEzee Connect - Role-Based Access Control

Roles:
- admin: Full system access
- hr: Attendance, Leave, HR reports only (no CRM data)
- manager: Team management, sees their team's records only
- ops: Operational access across all teams for CRM processing
- growth_partner: Own records only (GP can also be TL with is_tl=true)
"""
import os
from datetime import datetime, timedelta, timezone
from typing import List, Optional
from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from passlib.context import CryptContext
from jose import JWTError, jwt
from bson import ObjectId
from dotenv import load_dotenv
from pathlib import Path

from .database import db
from .helpers import serialize_doc

ROOT_DIR = Path(__file__).parent.parent
load_dotenv(ROOT_DIR / '.env')

# JWT settings
SECRET_KEY = os.environ.get("JWT_SECRET", "bankezee_connect_secret_key_2025")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_DAYS = 7

# Password hashing
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
security = HTTPBearer()

# ===================== ROLE DEFINITIONS =====================

# Valid base roles in the system
VALID_ROLES = ["admin", "hr", "manager", "ops", "growth_partner"]

# Legacy role mapping - map old roles to new canonical roles
LEGACY_ROLE_MAP = {
    "telecaller": "growth_partner",
    "sales_agent": "growth_partner", 
    "team_leader": "growth_partner",
    "partner": "growth_partner",
    "operations": "ops",
}

# GP roles for backwards compatibility
GP_ROLES = ["growth_partner", "telecaller", "sales_agent", "team_leader", "partner"]

# Role permissions mapping
ROLE_PERMISSIONS = {
    "admin": ["*"],  # Full system access
    "hr": [
        "attendance", "leave", "wfh", "users_view", "hr_reports",
        # HR CANNOT access: leads, files, calls, customer data, CRM processing
    ],
    "manager": [
        "team_view", "team_data", "team_files", "team_calls", "team_reports",
        "team_attendance", "team_leave", "team_tracking", "team_follow_ups",
        "user_approval", "gp_assignment", "tl_assignment",
        # Manager can NOT edit: eligibility, login/app_id, approval/decline, disbursal, commission, policy_master
    ],
    "ops": [
        "all_data", "all_files", "file_detail", "documents", 
        "profile_analysis", "eligibility", "bank_login", "application_id",
        "approval_decline", "disbursal", "commission", "policy_master",
        "operational_reports", "rejection_processing",
        # Ops can NOT: create admin, change security config, role administration
    ],
    "growth_partner": [
        "own_data", "own_files", "own_calls", "own_follow_ups",
        "own_attendance", "own_leave", "own_tracking", "own_dashboard",
        # GP can NOT: edit eligibility, bank processing, user management, other GPs' records
    ],
}

# Additional TL permissions (added when is_tl=true)
TL_PERMISSIONS = [
    "team_data", "team_files", "team_calls", "team_follow_ups",
    "team_attendance", "team_reports", "team_performance",
]

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)

def create_access_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(days=ACCESS_TOKEN_EXPIRE_DAYS)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

def normalize_role(role: str) -> str:
    """Normalize legacy roles to canonical roles"""
    if role in LEGACY_ROLE_MAP:
        return LEGACY_ROLE_MAP[role]
    return role

def is_gp_role(role: str) -> bool:
    """Check if role is a Growth Partner role"""
    return role in GP_ROLES or normalize_role(role) == "growth_partner"

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
        
        serialized = serialize_doc(user)
        # Add normalized role for RBAC checks
        serialized["normalized_role"] = normalize_role(serialized.get("role", "growth_partner"))
        return serialized
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")

# ===================== ROLE-BASED ACCESS DEPENDENCIES =====================

async def require_admin(current_user: dict = Depends(get_current_user)):
    """Require admin role - full system access"""
    role = normalize_role(current_user.get("role", ""))
    if role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return current_user

async def require_hr_or_admin(current_user: dict = Depends(get_current_user)):
    """Require HR or admin role - for attendance/leave management"""
    role = normalize_role(current_user.get("role", ""))
    if role not in ["admin", "hr"]:
        raise HTTPException(status_code=403, detail="HR or Admin access required")
    return current_user

async def require_manager_or_admin(current_user: dict = Depends(get_current_user)):
    """Require manager or admin role - for team management"""
    role = normalize_role(current_user.get("role", ""))
    if role not in ["admin", "manager"]:
        raise HTTPException(status_code=403, detail="Manager or Admin access required")
    return current_user

async def require_ops_or_admin(current_user: dict = Depends(get_current_user)):
    """Require ops or admin role - for CRM operational processing"""
    role = normalize_role(current_user.get("role", ""))
    if role not in ["admin", "ops"]:
        raise HTTPException(status_code=403, detail="Operations or Admin access required")
    return current_user

async def require_not_hr(current_user: dict = Depends(get_current_user)):
    """Block HR role from accessing customer data endpoints"""
    role = normalize_role(current_user.get("role", ""))
    if role == "hr":
        raise HTTPException(status_code=403, detail="HR role cannot access customer data")
    return current_user

async def require_crm_access(current_user: dict = Depends(get_current_user)):
    """
    Require CRM access - Admin, Ops, Manager, or GP.
    HR is explicitly blocked from CRM data.
    """
    role = normalize_role(current_user.get("role", ""))
    if role == "hr":
        raise HTTPException(status_code=403, detail="HR role cannot access CRM data")
    return current_user

async def require_bank_processing(current_user: dict = Depends(get_current_user)):
    """
    Require bank processing permission - only Admin and Ops.
    GPs and Managers cannot edit eligibility/login/approval/disbursal.
    """
    role = normalize_role(current_user.get("role", ""))
    if role not in ["admin", "ops"]:
        raise HTTPException(status_code=403, detail="Bank processing requires Admin or Operations access")
    return current_user

# ===================== HIERARCHY SCOPING UTILITIES =====================

async def get_user_team_ids(user: dict) -> List[str]:
    """
    Get list of user IDs that the current user can see based on hierarchy.
    
    - Admin/Ops: All users
    - Manager: Users with manager_id = this manager's ID (includes TLs and their GPs)
    - TL: Users with tl_id = this user's ID
    - GP: Only themselves
    - HR: Only themselves (for attendance/leave of self)
    """
    role = normalize_role(user.get("role", "growth_partner"))
    user_id = user.get("id")
    is_tl = user.get("is_tl", False)
    
    # Admin and Ops see everyone
    if role in ["admin", "ops"]:
        return None  # None means no filter - see all
    
    # HR sees only themselves
    if role == "hr":
        return [user_id]
    
    # Manager sees their entire hierarchy
    if role == "manager":
        # Get all users where manager_id = this manager
        team_users = await db.users.find(
            {"manager_id": user_id, "is_active": True},
            {"_id": 0, "id": 1}
        ).to_list(1000)
        team_ids = [u["id"] for u in team_users if u.get("id")]
        team_ids.append(user_id)  # Include self
        return team_ids
    
    # GP with TL capability sees their team members
    if is_tl and is_gp_role(role):
        team_users = await db.users.find(
            {"tl_id": user_id, "is_active": True},
            {"_id": 0, "id": 1}
        ).to_list(1000)
        team_ids = [u["id"] for u in team_users if u.get("id")]
        team_ids.append(user_id)  # Include self
        return team_ids
    
    # Regular GP sees only themselves
    return [user_id]

async def get_manager_hierarchy_ids(manager_id: str) -> List[str]:
    """
    Get all user IDs in a manager's hierarchy (including TLs and their GPs).
    Used for Manager team visibility.
    """
    if not manager_id:
        return []
    
    # Get all users directly under this manager
    direct_reports = await db.users.find(
        {"manager_id": manager_id},
        {"_id": 0, "id": 1}
    ).to_list(1000)
    
    hierarchy_ids = [manager_id]  # Include the manager
    for user in direct_reports:
        if user.get("id"):
            hierarchy_ids.append(user["id"])
    
    return hierarchy_ids

async def validate_tl_manager_match(tl_id: str, manager_id: str) -> bool:
    """
    Validate that a TL belongs to the same manager hierarchy.
    TL must have the same manager_id as the GP being assigned.
    """
    if not tl_id or not manager_id:
        return True  # No TL or no manager is valid
    
    tl_user = await db.users.find_one({"id": tl_id})
    if not tl_user:
        return False
    
    return tl_user.get("manager_id") == manager_id

# ===================== PERMISSION CHECKS =====================

def check_permission(user_role: str, permission: str, is_tl: bool = False) -> bool:
    """Check if a role has a specific permission"""
    role = normalize_role(user_role)
    permissions = ROLE_PERMISSIONS.get(role, [])
    
    # Admin has all permissions
    if "*" in permissions:
        return True
    
    # Check base role permissions
    if permission in permissions:
        return True
    
    # Check TL additional permissions for GPs with TL capability
    if is_tl and is_gp_role(role) and permission in TL_PERMISSIONS:
        return True
    
    return False

def can_access_user_data(requester: dict, target_user_id: str, team_ids: Optional[List[str]]) -> bool:
    """
    Check if requester can access target user's data.
    
    - If team_ids is None, access is unrestricted (Admin/Ops)
    - Otherwise, target must be in team_ids
    """
    if team_ids is None:
        return True
    return target_user_id in team_ids

async def check_record_access(current_user: dict, record_owner_id: str) -> bool:
    """
    Check if current user can access a record based on owner.
    Used for Data, Files, Calls, Follow-ups, etc.
    """
    team_ids = await get_user_team_ids(current_user)
    if team_ids is None:
        return True  # Admin/Ops - full access
    return record_owner_id in team_ids

