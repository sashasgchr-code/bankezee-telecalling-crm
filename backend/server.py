"""
BANKEZEE Connect API - Main Application
Refactored modular structure
"""
import asyncio

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from datetime import datetime, timezone
import os

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
from routes.attendance import router as attendance_router
from routes.leave_management import router as leave_router
from routes.data_cleanup import router as data_cleanup_router
from routes.sheets_sync import router as sheets_sync_router
from routes.settings import router as settings_router
from routes.files_crm import router as files_crm_router
from routes.bank_policies import router as bank_policies_router
from routes.document_ai import router as document_ai_router
from routes.admin_maintenance import router as admin_maintenance_router  # TEMPORARY - remove after prod repair

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
app.include_router(attendance_router)
app.include_router(leave_router)
app.include_router(data_cleanup_router)
app.include_router(sheets_sync_router)
app.include_router(settings_router)
app.include_router(files_crm_router)
app.include_router(bank_policies_router)
app.include_router(document_ai_router)


# Unprefixed health probe for the Kubernetes liveness/readiness check (the platform probe calls
# GET /health, not /api/health, and a 404 there stops the backend rollout).
@app.get("/health")
@app.get("/healthz")
@app.get("/api/healthz")
async def health_probe():
    return {"status": "healthy", "service": "BANKEZEE Connect API"}

app.include_router(admin_maintenance_router)  # TEMPORARY - remove after prod repair

# Predefined role-based accounts
# Note: Do NOT hard-code passwords in committed code in production
# These are seeded from environment or secure config
# Seed passwords come from the environment; the existing values stay as defaults so that a missing
# variable can never lock anyone out of an already-seeded deployment.
ROLE_ACCOUNTS = [
    {"email": "admin@bankezee.com", "password": os.environ.get("SEED_ADMIN_PASSWORD", "ConnectSasha12!!"), "name": "Admin", "role": "admin"},
    {"email": "hr@neosales.in", "password": os.environ.get("SEED_HR_PASSWORD", "HrNeo12!!"), "name": "HR", "role": "hr"},
    {"email": "teja@bankezee.com", "password": os.environ.get("SEED_MANAGER_TEJA_PASSWORD", "tejasme12"), "name": "Teja", "role": "manager"},
    {"email": "saikiran@bankezee.com", "password": os.environ.get("SEED_MANAGER_SAIKIRAN_PASSWORD", "saikiran12"), "name": "Saikiran", "role": "manager"},
    {"email": "rama@bankezee.com", "password": os.environ.get("SEED_OPS_RAMA_PASSWORD", "rama@bzc12"), "name": "Rama", "role": "ops"},
    {"email": "ops@bankezee.com", "password": os.environ.get("SEED_OPS_PASSWORD", "ops@bzc12"), "name": "Operations", "role": "ops"},
]

# Legacy admin accounts to preserve (but update role if needed)
LEGACY_ADMIN_EMAILS = ["manager@bankezee.com", "manager2@bankezee.com"]

@app.on_event("startup")
async def schedule_startup_tasks():
    """Seeding and index creation run in the background so the health probe answers immediately.

    On a managed Atlas cluster index builds and seeding can take longer than the Kubernetes
    readiness probe allows, which would keep the new revision from rolling out.
    """
    asyncio.create_task(setup_admin_accounts())


async def setup_admin_accounts():
    """Create or update predefined role-based accounts and database indexes"""
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
        await db.leads.create_index("id")
        await db.leads.create_index("source_id")
        await db.leads.create_index("file_created_at")
        await db.leads.create_index("lead_created_at")
        await db.leads.create_index("updated_at")
        await db.leads.create_index([("status", 1), ("source_id", 1)])
        
        # Activity logs indexes
        await db.activity_logs.create_index([("user_id", 1), ("timestamp", -1)])
        await db.activity_logs.create_index("timestamp")
        
        # Daily sessions indexes
        await db.daily_sessions.create_index([("user_id", 1), ("date", -1)])
        
        # Follow-ups indexes
        await db.follow_ups.create_index([("user_id", 1), ("is_completed", 1)])
        
        # Verified call logs indexes
        await db.verified_call_logs.create_index([("user_id", 1), ("synced_at", -1)])
        await db.verified_call_logs.create_index([("user_id", 1), ("call_timestamp", -1)])
        await db.verified_call_logs.create_index("call_timestamp")
        
        # Call recordings indexes
        await db.call_recordings.create_index([("user_id", 1), ("recorded_at", -1)])
        await db.call_recordings.create_index([("lead_id", 1)])
        await db.call_recordings.create_index("recorded_at")
        
        # Attendance indexes
        await db.attendance.create_index([("user_id", 1), ("attendance_date", -1)])
        await db.attendance.create_index([("attendance_date", 1), ("attendance_status", 1)])
        await db.attendance.create_index([("user_id", 1), ("attendance_date", 1)], unique=True)
        
        # Office indexes
        await db.offices.create_index("is_active")
        
        # WFH and Leave indexes
        await db.wfh_approvals.create_index([("user_id", 1), ("date", 1)])
        await db.wfh_requests.create_index([("user_id", 1), ("status", 1)])
        await db.leave_approvals.create_index([("user_id", 1), ("start_date", 1), ("end_date", 1)])
        await db.leave_requests.create_index([("user_id", 1), ("status", 1)])
        await db.leave_requests.create_index([("status", 1), ("created_at", -1)])
        await db.leave_balances.create_index("user_id", unique=True)
        
        # Suppression list index
        await db.suppression_list.create_index("normalized_phone", unique=True)
        
        # Import batches index
        await db.import_batches.create_index("imported_at")
        
        # NEW: RBAC indexes for role-based filtering
        await db.users.create_index("role")
        await db.users.create_index("manager_id")
        await db.users.create_index("tl_id")
        await db.users.create_index("is_active")
        await db.users.create_index("is_tl")
        await db.users.create_index([("role", 1), ("is_active", 1)])
        await db.users.create_index([("manager_id", 1), ("is_active", 1)])
        
        print("✅ Database indexes created/verified")
    except Exception as e:
        print(f"⚠️ Index creation warning: {e}")
    
    # Setup role-based accounts (upsert by email)
    reseed_passwords = os.environ.get("RESEED_ROLE_PASSWORDS", "").lower() == "true"
    for account in ROLE_ACCOUNTS:
        email = account["email"].lower()
        existing = await db.users.find_one({"email": email})
        
        if existing:
            # Reconcile role/access only. The password is NEVER re-written on boot: doing that
            # reverted every password an Admin changed in the app on the next restart/deploy
            # (this is why HR could not log in). Set RESEED_ROLE_PASSWORDS=true to force a reset.
            update_data = {
                "role": account["role"],
                "is_active": True,
                "is_approved": True,
                "approval_status": "approved"
            }
            if reseed_passwords or not (existing.get("password") or existing.get("password_hash")):
                update_data["password"] = pwd_context.hash(account["password"])
                update_data["plain_password"] = account["password"]
            # Don't overwrite is_tl if it exists
            if "is_tl" not in existing:
                update_data["is_tl"] = False
            
            await db.users.update_one(
                {"_id": existing["_id"]},
                {"$set": update_data}
            )
            print(f"  ✓ Updated: {email} ({account['role']})"
                  f"{' [password reseeded]' if 'password' in update_data else ''}")
        else:
            hashed_password = pwd_context.hash(account["password"])
            # Create new account
            user_doc = {
                "email": email,
                "password": hashed_password,
                "plain_password": account["password"],
                "name": account["name"],
                "role": account["role"],
                "phone": None,
                "is_active": True,
                "is_approved": True,
                "approval_status": "approved",
                "is_tl": False,
                "manager_id": None,
                "tl_id": None,
                "created_at": datetime.now(timezone.utc),
                "last_login": None,
                "last_activity": None
            }
            result = await db.users.insert_one(user_doc)
            # Update with ID
            await db.users.update_one(
                {"_id": result.inserted_id},
                {"$set": {"id": str(result.inserted_id)}}
            )
            print(f"  + Created: {email} ({account['role']})")
    
    # Migrate existing Growth Partners - add new fields if missing
    gp_roles = ["telecaller", "sales_agent", "team_leader", "partner", "growth_partner"]
    await db.users.update_many(
        {
            "role": {"$in": gp_roles},
            "is_tl": {"$exists": False}
        },
        {"$set": {"is_tl": False}}
    )
    await db.users.update_many(
        {
            "manager_id": {"$exists": False}
        },
        {"$set": {"manager_id": None}}
    )
    await db.users.update_many(
        {
            "tl_id": {"$exists": False}
        },
        {"$set": {"tl_id": None}}
    )
    
    print(f"✅ Role-based accounts initialized: {len(ROLE_ACCOUNTS)} accounts")

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()

# Migration endpoint for production data restore
from fastapi import Request, HTTPException
import json

MIGRATION_SECRET = os.environ.get("MIGRATION_SECRET", "BANKEZEE_CRM_MIGRATION_2026_SECRET_KEY")

@app.post("/api/admin/migrate-crm-data")
async def migrate_crm_data(request: Request):
    """
    Secure endpoint to migrate CRM data from preview to production.
    Requires secret key in header for authentication.
    """
    # Check secret key
    secret = request.headers.get("X-Migration-Secret")
    if secret != MIGRATION_SECRET:
        raise HTTPException(status_code=403, detail="Invalid migration secret")
    
    try:
        body = await request.json()
        
        results = {
            "files_imported": 0,
            "all_leads_imported": 0,
            "users_imported": 0,
            "bank_policies_imported": 0,
            "commissions_imported": 0,
            "mappings_imported": 0,
            "activity_logs_imported": 0,
            "attendance_imported": 0,
            "leave_requests_imported": 0,
            "leave_balances_imported": 0,
            "app_settings_imported": 0,
            "errors": []
        }
        
        # Import all leads (including both Data and Files)
        all_leads = body.get("all_leads", [])
        for lead in all_leads:
            try:
                lead_id = lead.get("id")
                if lead_id:
                    await db.leads.update_one(
                        {"id": lead_id},
                        {"$set": lead},
                        upsert=True
                    )
                    results["all_leads_imported"] += 1
            except Exception as e:
                results["errors"].append(f"Lead {lead.get('id')}: {str(e)}")
        
        # Import users (upsert by id or email)
        users = body.get("users", [])
        for u in users:
            try:
                user_id = u.get("id")
                email = u.get("email")
                if user_id:
                    await db.users.update_one(
                        {"id": user_id},
                        {"$set": u},
                        upsert=True
                    )
                    results["users_imported"] += 1
                elif email:
                    await db.users.update_one(
                        {"email": email},
                        {"$set": u},
                        upsert=True
                    )
                    results["users_imported"] += 1
            except Exception as e:
                results["errors"].append(f"User {u.get('email')}: {str(e)}")
        
        # Import bank policies (upsert by bank_name)
        bank_policies = body.get("bank_policies", [])
        for p in bank_policies:
            try:
                bank_name = p.get("bank_name")
                if bank_name:
                    await db.bank_policies.update_one(
                        {"bank_name": bank_name},
                        {"$set": p},
                        upsert=True
                    )
                    results["bank_policies_imported"] += 1
            except Exception as e:
                results["errors"].append(f"Policy {p.get('bank_name')}: {str(e)}")
        
        # Import commissions (upsert by id)
        commissions = body.get("commissions", [])
        for c in commissions:
            try:
                comm_id = c.get("id")
                if comm_id:
                    await db.commissions.update_one(
                        {"id": comm_id},
                        {"$set": c},
                        upsert=True
                    )
                    results["commissions_imported"] += 1
            except Exception as e:
                results["errors"].append(f"Commission {c.get('id')}: {str(e)}")
        
        # Import user mappings (upsert by legacy_user_id)
        user_mappings = body.get("user_mappings", [])
        for m in user_mappings:
            try:
                legacy_id = m.get("legacy_user_id")
                if legacy_id:
                    await db.user_mappings.update_one(
                        {"legacy_user_id": legacy_id},
                        {"$set": m},
                        upsert=True
                    )
                    results["mappings_imported"] += 1
            except Exception as e:
                results["errors"].append(f"Mapping {m.get('legacy_user_id')}: {str(e)}")
        
        # Import activity logs (upsert by id)
        activity_logs = body.get("activity_logs", [])
        for a in activity_logs:
            try:
                log_id = a.get("id")
                if log_id:
                    await db.activity_logs.update_one(
                        {"id": log_id},
                        {"$set": a},
                        upsert=True
                    )
                    results["activity_logs_imported"] += 1
            except Exception as e:
                results["errors"].append(f"Activity {a.get('id')}: {str(e)}")
        
        # Import attendance (upsert by user_id + date)
        attendance = body.get("attendance", [])
        for att in attendance:
            try:
                user_id = att.get("user_id")
                date = att.get("date")
                if user_id and date:
                    await db.attendance.update_one(
                        {"user_id": user_id, "date": date},
                        {"$set": att},
                        upsert=True
                    )
                    results["attendance_imported"] += 1
            except Exception as e:
                results["errors"].append(f"Attendance: {str(e)}")
        
        # Import leave requests (upsert by id)
        leave_requests = body.get("leave_requests", [])
        for lr in leave_requests:
            try:
                lr_id = lr.get("id")
                if lr_id:
                    await db.leave_requests.update_one(
                        {"id": lr_id},
                        {"$set": lr},
                        upsert=True
                    )
                    results["leave_requests_imported"] += 1
            except Exception as e:
                results["errors"].append(f"Leave request: {str(e)}")
        
        # Import leave balances (upsert by user_id + year)
        leave_balances = body.get("leave_balances", [])
        for lb in leave_balances:
            try:
                user_id = lb.get("user_id")
                year = lb.get("year")
                if user_id:
                    await db.leave_balances.update_one(
                        {"user_id": user_id, "year": year} if year else {"user_id": user_id},
                        {"$set": lb},
                        upsert=True
                    )
                    results["leave_balances_imported"] += 1
            except Exception as e:
                results["errors"].append(f"Leave balance: {str(e)}")
        
        # Import app settings
        app_settings = body.get("app_settings", [])
        for setting in app_settings:
            try:
                setting_id = setting.get("id") or setting.get("key") or "default"
                await db.app_settings.update_one(
                    {"id": setting_id} if setting.get("id") else {},
                    {"$set": setting},
                    upsert=True
                )
                results["app_settings_imported"] += 1
            except Exception as e:
                results["errors"].append(f"App setting: {str(e)}")
        
        return {
            "status": "success",
            "results": results
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
