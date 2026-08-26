"""
BANKEZEE Connect API - Main Application
Refactored modular structure
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from datetime import datetime, timezone

from utils.database import db, client
from utils.auth import pwd_context

# Import routers
from routes.auth import router as auth_router
from routes.users import router as users_router
from routes.leads import router as leads_router
from routes.calls import router as calls_router
from routes.activities import router as activities_router
from routes.follow_ups import router as follow_ups_router
from routes.reports import router as reports_router

app = FastAPI(title="BANKEZEE Connect API")

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include all routers
app.include_router(auth_router)
app.include_router(users_router)
app.include_router(leads_router)
app.include_router(calls_router)
app.include_router(activities_router)
app.include_router(follow_ups_router)
app.include_router(reports_router)

# Predefined admin accounts
ADMIN_ACCOUNTS = [
    {"email": "admin@bankezee.com", "password": "ConnectSasha12!!", "name": "Admin"},
    {"email": "rama@bankezee.com", "password": "rama@bzc12", "name": "Rama"},
    {"email": "teja@bankezee.com", "password": "tejasme12", "name": "Teja"},
    {"email": "manager@bankezee.com", "password": "mgr@bzc12", "name": "Manager"},
    {"email": "manager2@bankezee.com", "password": "mgr12@bzc!!", "name": "Manager 2"},
]

@app.on_event("startup")
async def setup_admin_accounts():
    """Create or update predefined admin accounts on startup"""
    for admin in ADMIN_ACCOUNTS:
        existing = await db.users.find_one({"email": admin["email"]})
        hashed_password = pwd_context.hash(admin["password"])
        
        if existing:
            await db.users.update_one(
                {"email": admin["email"]},
                {"$set": {
                    "password": hashed_password,
                    "plain_password": admin["password"],
                    "role": "admin",
                    "is_active": True
                }}
            )
        else:
            await db.users.insert_one({
                "email": admin["email"],
                "password": hashed_password,
                "plain_password": admin["password"],
                "name": admin["name"],
                "role": "admin",
                "phone": None,
                "is_active": True,
                "created_at": datetime.now(timezone.utc),
                "last_login": None,
                "last_activity": None
            })
    print(f"✅ Admin accounts initialized: {len(ADMIN_ACCOUNTS)} accounts")

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
