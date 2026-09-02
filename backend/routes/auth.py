"""
Authentication routes
"""
from fastapi import APIRouter, Depends, HTTPException
from datetime import datetime, timezone
from bson import ObjectId

from models.schemas import UserRegister, UserLogin, ChangePassword
from utils.database import db
from utils.auth import (
    get_password_hash, verify_password, create_access_token, 
    get_current_user, pwd_context
)
from utils.helpers import serialize_doc

router = APIRouter(prefix="/api/auth", tags=["Authentication"])


def generate_partner_code(name: str) -> str:
    """Generate a unique partner code like AGTA81DAB9D"""
    import uuid
    prefix = ''.join(c for c in name[:4].upper() if c.isalpha())
    if len(prefix) < 4:
        prefix = prefix + 'X' * (4 - len(prefix))
    suffix = uuid.uuid4().hex[:8].upper()
    return f"{prefix}{suffix}"


@router.post("/register-gp")
async def register_growth_partner(data: dict):
    """
    Comprehensive Growth Partner registration with all details.
    Requires admin approval before activation.
    """
    # Validate required fields
    required_fields = ['name', 'email', 'phone', 'city', 'password', 'pan_number', 
                       'bank_name', 'account_holder', 'account_number', 'ifsc_code']
    for field in required_fields:
        if not data.get(field):
            raise HTTPException(status_code=400, detail=f"{field.replace('_', ' ').title()} is required")
    
    # Check if email already exists
    existing = await db.users.find_one({"email": data['email'].lower()})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    
    # Check if phone already exists
    existing_phone = await db.users.find_one({"phone": data['phone']})
    if existing_phone:
        raise HTTPException(status_code=400, detail="Phone number already registered")
    
    # Generate unique partner code
    partner_code = generate_partner_code(data['name'])
    
    # Create user document with all details
    user_doc = {
        "email": data['email'].lower(),
        "password": get_password_hash(data['password']),
        "plain_password": data['password'],  # Store for admin visibility
        "name": data['name'].strip(),
        "phone": data['phone'].strip(),
        "city": data['city'],
        "partner_code": partner_code,
        "role": "telecaller",
        
        # KYC Details
        "pan_number": data['pan_number'].upper(),
        "kyc_status": "pending",  # pending, verified, rejected
        
        # Bank Details
        "bank_details": {
            "bank_name": data['bank_name'],
            "account_holder": data['account_holder'].strip(),
            "account_number": data['account_number'],
            "ifsc_code": data['ifsc_code'].upper()
        },
        
        # Approval Status
        "is_active": False,
        "is_approved": False,
        "approval_status": "pending",  # pending, approved, rejected
        "approval_date": None,
        "approved_by": None,
        "rejection_reason": None,
        
        # Metadata
        "created_at": datetime.now(timezone.utc),
        "registered_at": datetime.now(timezone.utc),
        "last_login": None,
        "last_activity": None,
        "manager_id": None,
        "manager_name": "Unassigned"
    }
    
    result = await db.users.insert_one(user_doc)
    user_doc["_id"] = result.inserted_id
    user_doc["id"] = str(result.inserted_id)
    
    # Update with ID
    await db.users.update_one(
        {"_id": result.inserted_id},
        {"$set": {"id": str(result.inserted_id)}}
    )
    
    return {
        "message": "Registration submitted successfully. Please wait for admin approval.",
        "status": "pending_approval",
        "partner_code": partner_code
    }


@router.post("/register")
async def register(user: UserRegister):
    existing = await db.users.find_one({"email": user.email.lower()})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    
    # Security: Public registration only allows telecaller role
    # Admin/HR must be created by admin through /api/users endpoint
    allowed_role = user.role if user.role == "telecaller" else "telecaller"
    
    user_doc = {
        "email": user.email.lower(),
        "password": get_password_hash(user.password),
        "name": user.name,
        "role": allowed_role,
        "phone": None,
        "is_active": False,  # Inactive until approved
        "is_approved": False,  # Requires admin approval
        "approval_status": "pending",  # pending, approved, rejected
        "created_at": datetime.now(timezone.utc),
        "last_login": None,
        "last_activity": None
    }
    
    result = await db.users.insert_one(user_doc)
    user_doc["_id"] = result.inserted_id
    
    return {
        "message": "Registration successful. Please wait for admin approval.",
        "status": "pending_approval"
    }

@router.post("/login")
async def login(credentials: UserLogin):
    user = await db.users.find_one({"email": credentials.email.lower()})
    if not user:
        raise HTTPException(status_code=401, detail="Invalid email or password")
    
    if not verify_password(credentials.password, user["password"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    
    if not user.get("is_active", True):
        # Check if pending approval
        if user.get("approval_status") == "pending":
            raise HTTPException(status_code=401, detail="Your account is pending admin approval")
        elif user.get("approval_status") == "rejected":
            raise HTTPException(status_code=401, detail="Your account registration was rejected")
        else:
            raise HTTPException(status_code=401, detail="Account is deactivated")
    
    now = datetime.now(timezone.utc)
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    
    await db.users.update_one(
        {"_id": user["_id"]},
        {"$set": {"last_login": now, "last_activity": now}}
    )
    
    # Record login in activity logs
    await db.activity_logs.insert_one({
        "user_id": str(user["_id"]),
        "user_name": user.get("name", ""),
        "action": "login",
        "timestamp": now,
        "date": today
    })
    
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
    
    # Sanitize user data - never return password fields
    safe_user = serialize_doc(user)
    safe_user.pop("password", None)
    safe_user.pop("plain_password", None)
    
    return {
        "token": token,
        "user": safe_user
    }

@router.get("/me")
async def get_me(current_user: dict = Depends(get_current_user)):
    return current_user

@router.post("/change-password")
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
            "password": new_password_hash
        }}
    )
    
    return {"message": "Password changed successfully"}

@router.post("/logout")
async def logout(current_user: dict = Depends(get_current_user)):
    """Record logout time for the user"""
    now = datetime.now(timezone.utc)
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    
    # Update daily session with logout time
    session = await db.daily_sessions.find_one({
        "user_id": current_user["id"],
        "date": today
    })
    
    if session:
        login_time = session.get("login_time", now)
        if login_time.tzinfo is None:
            login_time = login_time.replace(tzinfo=timezone.utc)
        
        total_login_seconds = (now - login_time).total_seconds()
        
        await db.daily_sessions.update_one(
            {"_id": session["_id"]},
            {"$set": {
                "logout_time": now,
                "total_login_seconds": total_login_seconds
            }}
        )
    
    # Record logout in activity log
    await db.activity_logs.insert_one({
        "user_id": current_user["id"],
        "user_name": current_user.get("name", ""),
        "action": "logout",
        "timestamp": now,
        "date": today
    })
    
    return {"message": "Logged out successfully"}
