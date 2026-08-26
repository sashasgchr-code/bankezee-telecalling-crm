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
from routes.recordings import router as recordings_router

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
app.include_router(recordings_router)

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
    """Create or update predefined admin accounts and database indexes on startup"""
    # Create indexes for better query performance
    try:
        # Call logs indexes
        await db.call_logs.create_index([("user_id", 1), ("created_at", -1)])
        await db.call_logs.create_index([("created_at", -1)])
        await db.call_logs.create_index("lead_id")
        
        # Leads indexes
        await db.leads.create_index([("assigned_to", 1), ("updated_at", -1)])
        await db.leads.create_index([("assigned_to", 1), ("created_at", -1)])
        await db.leads.create_index([("assigned_to", 1), ("status", 1)])
        await db.leads.create_index("status")
        
        # Activity logs indexes
        await db.activity_logs.create_index([("user_id", 1), ("timestamp", -1)])
        await db.activity_logs.create_index("timestamp")
        
        # Daily sessions indexes
        await db.daily_sessions.create_index([("user_id", 1), ("date", -1)])
        
        # Follow-ups indexes
        await db.follow_ups.create_index([("user_id", 1), ("is_completed", 1)])
        
        # Verified call logs indexes
        await db.verified_call_logs.create_index([("user_id", 1), ("synced_at", -1)])
        
        # Call recordings indexes
        await db.call_recordings.create_index([("user_id", 1), ("recorded_at", -1)])
        await db.call_recordings.create_index([("lead_id", 1)])
        await db.call_recordings.create_index("recorded_at")
        
        print("✅ Database indexes created/verified")
    except Exception as e:
        print(f"⚠️ Index creation warning: {e}")
    
    # Setup admin accounts
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
