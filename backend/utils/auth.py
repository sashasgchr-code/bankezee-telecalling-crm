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

# The single authoritative "employee population" rule for Attendance / Leave employee views:
# an ACTIVE account whose base role is a Growth Partner role. A GP who also carries Team Lead
# capability (`is_tl`) still has a GP base role, so they stay included.
ACTIVE_GP_QUERY = {"is_active": True, "role": {"$in": GP_ROLES}}


async def active_gp_ids(db):
    """Every identifier (str(_id) and `id`) of the active Growth Partner population."""
    ids = set()
    async for user in db.users.find(ACTIVE_GP_QUERY, {"_id": 1, "id": 1}):
        ids.add(str(user["_id"]))
        if isinstance(user.get("id"), str):
            ids.add(user["id"])
    return ids


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

async def require_file_write(current_user: dict = Depends(get_current_user)):
    """Block HR from every File write - HR has view-only access to Files."""
    role = normalize_role(current_user.get("role", ""))
    if role == "hr":
        raise HTTPException(status_code=403, detail="HR has view-only access to Files")
    return current_user

async def require_file_manage(current_user: dict = Depends(get_current_user)):
    """File status edit & (re)assignment: Admin, Manager, Ops only. GP/TL/HR are rejected."""
    role = normalize_role(current_user.get("role", ""))
    if role not in ("admin", "manager", "ops"):
        raise HTTPException(status_code=403, detail="Only Admin and Manager can modify file status or assignment")
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

    Uses shared identity resolution + recursive traversal (utils.hierarchy), so duplicate
    and legacy user documents resolve to the same person and a Manager sees their whole
    downward subtree (direct GPs, TLs, GPs under TLs, sub-managers and everyone below).

    - Admin/Ops: All users (None)
    - Manager: full downward subtree, including self
    - TL: own team subtree, including self
    - GP / HR: only themselves
    """
    from utils.hierarchy import load_user_index

    role = normalize_role(user.get("role", "growth_partner"))
    user_id = user.get("id") or str(user.get("_id") or "")
    is_tl = user.get("is_tl", False)

    # Admin and Ops see everyone
    if role in ["admin", "ops"]:
        return None  # None means no filter - see all

    index = await load_user_index(db)
    own = index.aliases(user_id) or {user_id}

    # HR sees only themselves
    if role == "hr":
        return sorted(own)

    if role == "manager" or (is_tl and is_gp_role(role)):
        return sorted(index.descendants(user_id) or own)

    # Regular GP sees only themselves
    return sorted(own)

async def get_manager_hierarchy_ids(manager_id: str) -> List[str]:
    """
    Get all user IDs in a manager's FULL downward hierarchy (TLs, GPs under those TLs,
    sub-managers and everyone below), resolved across duplicate/legacy identities.
    """
    if not manager_id:
        return []
    
    from utils.hierarchy import load_user_index
    index = await load_user_index(db)
    return sorted(index.descendants(manager_id) or {manager_id})

async def validate_tl_manager_match(tl_id: str, manager_id: str) -> bool:
    """
    Validate that a TL belongs under the given manager, anywhere in the subtree,
    using shared identity resolution.
    """
    if not tl_id or not manager_id:
        return True  # No TL or no manager is valid
    
    from utils.hierarchy import load_user_index
    index = await load_user_index(db)
    if not index.root_for(tl_id):
        return False
    return index.belongs_under(tl_id, manager_id)

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

