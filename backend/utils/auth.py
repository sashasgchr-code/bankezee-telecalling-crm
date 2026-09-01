"""
Authentication utilities
"""
import os
from datetime import datetime, timedelta, timezone
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

# Valid roles in the system
VALID_ROLES = ["admin", "telecaller", "hr"]

# Role permissions mapping
ROLE_PERMISSIONS = {
    "admin": ["*"],  # Full access
    "hr": [
        "attendance", "leave", "wfh", "users_view",  # HR can access attendance/leave/users
        # HR CANNOT access: leads, calls, reports (customer data)
    ],
    "telecaller": ["leads", "calls", "attendance_self"]  # Telecaller access
}

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
    """Require admin role"""
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return current_user

async def require_hr_or_admin(current_user: dict = Depends(get_current_user)):
    """Require HR or admin role - for attendance/leave management"""
    role = current_user.get("role")
    if role not in ["admin", "hr"]:
        raise HTTPException(status_code=403, detail="HR or Admin access required")
    return current_user

async def require_not_hr(current_user: dict = Depends(get_current_user)):
    """Block HR role from accessing customer data endpoints"""
    if current_user.get("role") == "hr":
        raise HTTPException(status_code=403, detail="HR role cannot access customer data")
    return current_user

def check_permission(user_role: str, permission: str) -> bool:
    """Check if a role has a specific permission"""
    permissions = ROLE_PERMISSIONS.get(user_role, [])
    if "*" in permissions:
        return True
    return permission in permissions

