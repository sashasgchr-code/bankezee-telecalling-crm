"""
User Consolidation and Legacy CRM Mapping Script
Based on @users spreadsheet as source of truth
"""
import os
import sys
from datetime import datetime, timezone
from pymongo import MongoClient
from bson import ObjectId
from passlib.context import CryptContext

# Load environment
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from dotenv import load_dotenv
load_dotenv()

client = MongoClient(os.environ.get('MONGO_URL'))
db = client[os.environ.get('DB_NAME')]

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# @users spreadsheet data - source of truth
USERS_DATA = [
    {
        "name": "Anusha",
        "connect_email": "yarragondaanusha@gmail.com",
        "connect_password": "9063023292",
        "crm_email": "yarragondaanusha@gmail.com",
        "crm_password": "123456",
        "tl_name": "Saikiran",
        "manager_name": "Saikiran"
    },
    {
        "name": "Wamiz",
        "connect_email": "mohammadwameez607@gmail.com",
        "connect_password": "C865cLzckips4yC",
        "crm_email": "mohammadwameez607@gmail.com",
        "crm_password": "wameez123",
        "tl_name": "Pinky",
        "manager_name": "Teja"
    },
    {
        "name": "Vijayendra",
        "connect_email": "regurivijayendra@gmail.com",
        "connect_password": "vijay@12345",
        "crm_email": "regurivijayendra@gmail.com",
        "crm_password": "vijay@12345",
        "tl_name": "Pinky",
        "manager_name": "Teja"
    },
    {
        "name": "Pinky",
        "connect_email": "pinkynagulapally@gmail.com",
        "connect_password": "Pinky@1234",
        "crm_email": "akshaya03302023@gmail.com",  # Different from Connect!
        "crm_password": "Pinky@03082002",
        "tl_name": "Teja",
        "manager_name": "Teja",
        "is_tl": True  # Pinky is a TL
    },
    {
        "name": "Vishnu",
        "connect_email": "jkavithabhai@gmail.com",
        "connect_password": "vishnu404",
        "crm_email": "jkavithabhai@gmail.com",
        "crm_password": "vishnu1431",
        "tl_name": "Pinky",
        "manager_name": "Teja"
    },
    {
        "name": "G Saikiran",
        "connect_email": "gujjarisaikiran13@gmail.com",
        "connect_password": "Gujjari@21",
        "crm_email": None,  # No CRM account
        "crm_password": None,
        "tl_name": "Pinky",
        "manager_name": "Teja"
    },
    {
        "name": "Pushpa",
        "connect_email": "pushparajbha911@gmail.com",
        "connect_password": "ragini",
        "crm_email": "pushparajbha911@gmail.com",
        "crm_password": "pushparaj",
        "tl_name": "Anusha",
        "manager_name": "Saikiran"
    },
    {
        "name": "Deevena",
        "connect_email": "gosangideevenadevaswamy@gmail.com",
        "connect_password": "Divi@8074",
        "crm_email": None,  # No CRM account
        "crm_password": None,
        "tl_name": "Anusha",
        "manager_name": "Saikiran"
    },
    {
        "name": "Shanthi",
        "connect_email": "srivallisiri537@gmail.com",
        "connect_password": "santhi",
        "crm_email": None,  # No CRM account
        "crm_password": None,
        "tl_name": "Anusha",
        "manager_name": "Saikiran"
    },
    {
        "name": "Chandana",
        "connect_email": "lellachandana24@gmail.com",
        "connect_password": "mahi@123",
        "crm_email": None,  # No CRM account
        "crm_password": None,
        "tl_name": "Pinky",
        "manager_name": "Teja"
    },
    {
        "name": "Anil",
        "connect_email": "nani9346480@gmail.com",
        "connect_password": "Anil@123",
        "crm_email": "nani9346480@gmail.com",
        "crm_password": "Anil@123",
        "tl_name": "Anusha",
        "manager_name": "Saikiran"
    },
    {
        "name": "Nithin",
        "connect_email": "banothunithinnaik@gmail.com",
        "connect_password": "Nithin@123",
        "crm_email": "banothunithinnaik@gmail.com",
        "crm_password": "Nithin@123",
        "tl_name": "Anusha",
        "manager_name": "Saikiran"
    },
    {
        "name": "Priya",
        "connect_email": "nalavonilakshmipriya@gmail.com",
        "connect_password": "ammu@2006",
        "crm_email": "nalavonilakshmipriya@gmail.com",
        "crm_password": "ammu@2006",
        "tl_name": "Anusha",
        "manager_name": "Saikiran"
    },
    {
        "name": "Raju",
        "connect_email": "kemidiraju134@gmail.com",
        "connect_password": "rajuking@225",
        "crm_email": "kemidiraju134@gmail.com",
        "crm_password": "rajuking@225",
        "tl_name": "Anusha",
        "manager_name": "Saikiran"
    },
    {
        "name": "Meghana",
        "connect_email": "meghanaaaa.36@gmail.com",
        "connect_password": "Meghana@0260",
        "crm_email": "meghanaaaa.36@gmail.com",
        "crm_password": "Meghana@0260",
        "tl_name": "Anusha",
        "manager_name": "Saikiran"
    },
    {
        "name": "Rishikesh",
        "connect_email": "mivimivi51@gmail.com",
        "connect_password": "Rishi@7650",
        "crm_email": None,  # No CRM account
        "crm_password": None,
        "tl_name": "Anusha",
        "manager_name": "Saikiran"
    },
    {
        "name": "Masoom",
        "connect_email": "masoommd7472@gmai.com",  # Note: typo in spreadsheet (gmai.com)
        "connect_password": "masoom@123",
        "crm_email": "masoommd7472@gmail.com",  # Correct email in CRM
        "crm_password": "masoom@123",
        "tl_name": "Anusha",
        "manager_name": "Saikiran"
    },
    {
        "name": "Shiva",
        "connect_email": "pillalamarrishivasai@gmail.com",
        "connect_password": "Shivasai939@",
        "crm_email": "pillalamarrishivasai@gmail.com",
        "crm_password": "Shivasai9391",
        "tl_name": "Pinky",
        "manager_name": "Teja"
    },
    {
        "name": "Asma",
        "connect_email": "asma.sultana0r@gmail.com",
        "connect_password": "Asma@0309",
        "crm_email": "asma.sultana0r@gmail.com",
        "crm_password": "Asma@0309",
        "tl_name": "Anusha",
        "manager_name": "Saikiran"
    }
]

# Special users to keep active (not from @users but required)
SYSTEM_USERS = [
    "admin@bankezee.com",
    "ops@bankezee.com",
    "rama@bankezee.com",  # Ops
    "teja@bankezee.com",  # Manager
    "saikiran@bankezee.com",  # Manager (if exists)
]

# Name to email mapping for TL/Manager resolution
NAME_TO_EMAIL = {
    "saikiran": "gujjarisaikiran13@gmail.com",  # G Saikiran is the manager named Saikiran
    "teja": "teja@bankezee.com",
    "pinky": "pinkynagulapally@gmail.com",
    "anusha": "yarragondaanusha@gmail.com",
}

def get_user_by_email(email):
    """Find user by email (case-insensitive)"""
    return db.users.find_one({"email": {"$regex": f"^{email}$", "$options": "i"}})

def get_or_create_connect_user(user_data):
    """Get existing Connect user or create if not exists"""
    email = user_data["connect_email"]
    existing = get_user_by_email(email)
    
    if existing:
        print(f"  ✓ Found existing Connect user: {email}")
        return existing
    
    # Create new user
    import uuid
    new_user = {
        "id": str(uuid.uuid4()),
        "email": email,
        "full_name": user_data["name"],
        "name": user_data["name"],
        "password": pwd_context.hash(user_data["connect_password"]),
        "role": "growth_partner",
        "is_active": True,
        "is_approved": True,
        "source": "connect",
        "is_tl": user_data.get("is_tl", False),
        "created_at": datetime.now(timezone.utc),
        "updated_at": datetime.now(timezone.utc)
    }
    
    result = db.users.insert_one(new_user)
    new_user["_id"] = result.inserted_id
    print(f"  + Created new Connect user: {email}")
    return new_user

def find_crm_user_by_email(crm_email):
    """Find CRM user by their CRM email"""
    if not crm_email:
        return None
    
    # Look for users with this email who are NOT Connect users
    user = db.users.find_one({
        "email": {"$regex": f"^{crm_email}$", "$options": "i"}
    })
    return user

def map_legacy_to_connect(legacy_user_id, connect_user_id, legacy_email=None):
    """Create or update mapping from legacy CRM user to Connect user"""
    # Check if mapping already exists
    existing = db.user_mappings.find_one({
        "legacy_user_id": legacy_user_id
    })
    
    now = datetime.now(timezone.utc)
    
    if existing:
        # Update existing mapping
        db.user_mappings.update_one(
            {"_id": existing["_id"]},
            {
                "$set": {
                    "connect_user_id": connect_user_id,
                    "status": "mapped",
                    "mapped_at": now,
                    "legacy_email": legacy_email
                }
            }
        )
        print(f"  ↔ Updated mapping: {legacy_user_id[:20]}... -> {connect_user_id}")
    else:
        # Create new mapping
        db.user_mappings.insert_one({
            "legacy_user_id": legacy_user_id,
            "connect_user_id": connect_user_id,
            "legacy_email": legacy_email,
            "status": "mapped",
            "mapped_at": now,
            "can_undo_until": None  # No undo for automated mappings
        })
        print(f"  + Created mapping: {legacy_user_id[:20]}... -> {connect_user_id}")

def resolve_name_to_user_id(name):
    """Resolve TL/Manager name to their canonical Connect user ID"""
    if not name:
        return None
    
    name_lower = name.lower().strip()
    
    # Check our mapping
    if name_lower in NAME_TO_EMAIL:
        email = NAME_TO_EMAIL[name_lower]
        user = get_user_by_email(email)
        if user:
            return str(user.get("id") or user.get("_id"))
    
    # Try to find by name
    user = db.users.find_one({
        "$or": [
            {"full_name": {"$regex": f"^{name}$", "$options": "i"}},
            {"name": {"$regex": f"^{name}$", "$options": "i"}}
        ],
        "is_active": True
    })
    
    if user:
        return str(user.get("id") or user.get("_id"))
    
    return None

def update_user_hierarchy(user_id, tl_id, manager_id, is_tl=False):
    """Update user's TL and Manager assignments"""
    update = {
        "tl_id": tl_id or "",
        "manager_id": manager_id or "",
        "is_tl": is_tl
    }
    
    db.users.update_one(
        {"$or": [{"id": user_id}, {"_id": ObjectId(user_id) if len(str(user_id)) == 24 else None}]},
        {"$set": update}
    )

def deactivate_non_approved_users(approved_emails):
    """Deactivate users not in the approved list"""
    # Get GP roles
    gp_roles = ["growth_partner", "telecaller", "sales_agent", "team_leader", "partner"]
    
    # Find users to deactivate
    to_deactivate = db.users.find({
        "email": {"$nin": approved_emails},
        "role": {"$in": gp_roles},
        "is_active": {"$ne": False}
    })
    
    deactivated = []
    for user in to_deactivate:
        email = user.get("email")
        name = user.get("full_name") or user.get("name", "Unknown")
        
        # Don't deactivate if they have files assigned
        user_id = str(user.get("id") or user.get("_id"))
        files_count = db.leads.count_documents({
            "status": "file",
            "file_assigned_to": user_id
        })
        
        if files_count > 0:
            print(f"  ⚠ Keeping {name} ({email}) active - has {files_count} files")
            continue
        
        # Deactivate
        db.users.update_one(
            {"_id": user["_id"]},
            {"$set": {"is_active": False, "deactivated_at": datetime.now(timezone.utc)}}
        )
        deactivated.append(f"{name} ({email})")
    
    return deactivated

def consolidate_duplicate_users(connect_email, crm_email):
    """Handle case where same person has both Connect and CRM accounts with different emails"""
    if not crm_email or connect_email.lower() == crm_email.lower():
        return None
    
    # Find CRM user
    crm_user = get_user_by_email(crm_email)
    if not crm_user:
        return None
    
    # Find Connect user
    connect_user = get_user_by_email(connect_email)
    if not connect_user:
        return None
    
    # They're different users - need to map CRM to Connect
    crm_user_id = str(crm_user.get("id") or crm_user.get("_id"))
    connect_user_id = str(connect_user.get("id") or connect_user.get("_id"))
    
    if crm_user_id != connect_user_id:
        # Create mapping
        map_legacy_to_connect(crm_user_id, connect_user_id, crm_email)
        
        # Deactivate CRM account (keep Connect as canonical)
        db.users.update_one(
            {"_id": crm_user["_id"]},
            {
                "$set": {
                    "is_active": False,
                    "merged_to": connect_user_id,
                    "deactivated_at": datetime.now(timezone.utc),
                    "deactivation_reason": "merged_to_connect"
                }
            }
        )
        return crm_user_id
    
    return None

def run_consolidation():
    """Main consolidation function"""
    print("=" * 60)
    print("USER CONSOLIDATION AND LEGACY CRM MAPPING")
    print("=" * 60)
    print()
    
    results = []
    approved_emails = []
    
    # Step 1: Process each user from @users
    print("STEP 1: Processing @users spreadsheet")
    print("-" * 40)
    
    for user_data in USERS_DATA:
        name = user_data["name"]
        connect_email = user_data["connect_email"]
        crm_email = user_data.get("crm_email")
        
        print(f"\nProcessing: {name} ({connect_email})")
        
        result = {
            "name": name,
            "connect_email": connect_email,
            "legacy_crm_email": crm_email or "No Legacy CRM Account",
            "canonical_connect_id": None,
            "legacy_files_found": 0,
            "manager": user_data.get("manager_name", ""),
            "tl": user_data.get("tl_name", ""),
            "active": True,
            "duplicates_deactivated": [],
            "result": "OK"
        }
        
        # Get or create canonical Connect user
        connect_user = get_or_create_connect_user(user_data)
        connect_user_id = str(connect_user.get("id") or connect_user.get("_id"))
        result["canonical_connect_id"] = connect_user_id
        
        # Update password if needed (ensure they can log in with Connect password)
        db.users.update_one(
            {"_id": connect_user["_id"]},
            {
                "$set": {
                    "password": pwd_context.hash(user_data["connect_password"]),
                    "source": "connect",
                    "is_approved": True,
                    "is_active": True
                }
            }
        )
        
        approved_emails.append(connect_email.lower())
        
        # Handle CRM mapping if they have a CRM account
        if crm_email:
            # Check if CRM email is different from Connect email
            if crm_email.lower() != connect_email.lower():
                # Find and merge CRM user
                merged_id = consolidate_duplicate_users(connect_email, crm_email)
                if merged_id:
                    result["duplicates_deactivated"].append(crm_email)
                    print(f"  ✓ Merged CRM account {crm_email} -> Connect account")
            else:
                # Same email - map any legacy IDs
                crm_user = get_user_by_email(crm_email)
                if crm_user:
                    crm_user_id = str(crm_user.get("id") or crm_user.get("_id"))
                    if crm_user_id != connect_user_id:
                        map_legacy_to_connect(crm_user_id, connect_user_id, crm_email)
        
        # Count legacy files (would be visible through mapping)
        # For now, count files that would be accessible
        files_count = db.leads.count_documents({
            "status": "file",
            "$or": [
                {"file_assigned_to": connect_user_id},
                {"assigned_to": connect_user_id}
            ]
        })
        result["legacy_files_found"] = files_count
        
        results.append(result)
    
    # Step 2: Add system users to approved list
    print("\n\nSTEP 2: Adding system users to approved list")
    print("-" * 40)
    
    for email in SYSTEM_USERS:
        user = get_user_by_email(email)
        if user:
            approved_emails.append(email.lower())
            print(f"  ✓ Approved: {email}")
    
    # Also add HR user if exists
    hr_user = db.users.find_one({"role": "hr", "is_active": True})
    if hr_user:
        approved_emails.append(hr_user["email"].lower())
        print(f"  ✓ Approved HR: {hr_user['email']}")
    
    # Step 3: Set up Manager/TL hierarchy
    print("\n\nSTEP 3: Setting up Manager/TL hierarchy")
    print("-" * 40)
    
    for user_data in USERS_DATA:
        connect_email = user_data["connect_email"]
        tl_name = user_data.get("tl_name")
        manager_name = user_data.get("manager_name")
        is_tl = user_data.get("is_tl", False)
        
        connect_user = get_user_by_email(connect_email)
        if not connect_user:
            continue
        
        user_id = str(connect_user.get("id") or connect_user.get("_id"))
        
        # Resolve TL and Manager IDs
        tl_id = resolve_name_to_user_id(tl_name) if tl_name else None
        manager_id = resolve_name_to_user_id(manager_name) if manager_name else None
        
        # Special case: If person IS a TL, they report to manager directly
        # Anusha is TL under Saikiran (who is also GP but acting as manager)
        if is_tl or (tl_name and tl_name.lower() == user_data["name"].lower()):
            is_tl = True
            tl_id = None  # TLs don't have a TL above them in the same branch
        
        update_user_hierarchy(user_id, tl_id, manager_id, is_tl)
        print(f"  {user_data['name']}: TL={tl_name or 'None'}, Manager={manager_name or 'None'}, is_tl={is_tl}")
    
    # Make sure Anusha and Pinky are TLs
    anusha = get_user_by_email("yarragondaanusha@gmail.com")
    if anusha:
        # Anusha: TL under Saikiran as manager
        saikiran_id = resolve_name_to_user_id("saikiran")
        db.users.update_one(
            {"_id": anusha["_id"]},
            {"$set": {"is_tl": True, "manager_id": saikiran_id or "", "tl_id": ""}}
        )
        print(f"  ✓ Anusha set as TL under Saikiran")
    
    pinky = get_user_by_email("pinkynagulapally@gmail.com")
    if pinky:
        # Pinky: TL under Teja as manager
        teja_id = resolve_name_to_user_id("teja")
        db.users.update_one(
            {"_id": pinky["_id"]},
            {"$set": {"is_tl": True, "manager_id": teja_id or "", "tl_id": ""}}
        )
        print(f"  ✓ Pinky set as TL under Teja")
    
    # G Saikiran is treated as a manager in hierarchy but remains GP
    saikiran = get_user_by_email("gujjarisaikiran13@gmail.com")
    if saikiran:
        teja_id = resolve_name_to_user_id("teja")
        db.users.update_one(
            {"_id": saikiran["_id"]},
            {"$set": {"manager_id": teja_id or "", "tl_id": ""}}  # Reports to Teja as per sheet
        )
        print(f"  ✓ G Saikiran hierarchy set (under Pinky -> Teja)")
    
    # Step 4: Deactivate non-approved GP users
    print("\n\nSTEP 4: Deactivating non-approved users")
    print("-" * 40)
    
    deactivated = deactivate_non_approved_users(approved_emails)
    print(f"  Deactivated {len(deactivated)} users")
    for d in deactivated[:10]:
        print(f"    - {d}")
    if len(deactivated) > 10:
        print(f"    ... and {len(deactivated) - 10} more")
    
    # Step 5: Generate verification table
    print("\n\nSTEP 5: VERIFICATION TABLE")
    print("=" * 60)
    print(f"{'Name':<15} | {'Connect Email':<35} | {'CRM ID':<25} | {'Files':<6} | {'Active':<6}")
    print("-" * 100)
    
    for r in results:
        crm_display = r["legacy_crm_email"][:23] + ".." if len(r["legacy_crm_email"]) > 25 else r["legacy_crm_email"]
        print(f"{r['name']:<15} | {r['connect_email']:<35} | {crm_display:<25} | {r['legacy_files_found']:<6} | {r['active']}")
    
    print("\n" + "=" * 60)
    print("CONSOLIDATION COMPLETE")
    print("=" * 60)
    
    return results

if __name__ == "__main__":
    run_consolidation()
