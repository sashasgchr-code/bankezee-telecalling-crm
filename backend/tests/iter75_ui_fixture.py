# UI fixture helper (iter75): `setup` creates a temp legacy GP (users.id != str(_id)) + a fresh onboarding GP via API;
# `cleanup <legacy_mobile> <onb_mobile>` deletes only those users and the records created for them.
import os, sys, uuid, random, json, requests
sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")
from pymongo import MongoClient
from utils.auth import get_password_hash

db = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
API = [l.split("=", 1)[1].strip() for l in open("/app/frontend/.env") if l.startswith("REACT_APP_BACKEND_URL=")][0] + "/api"

if sys.argv[1] == "setup":
    lm = "5" + "".join(random.choice("0123456789") for _ in range(9))
    om = "9" + "".join(random.choice("0123456789") for _ in range(9))
    code = "TESTLU" + lm[-4:]
    db.users.insert_one({"id": str(uuid.uuid4()), "email": f"test_legui_{lm}@example.com", "name": "TEST_Legacy Ui Partner", "phone": lm,
                         "role": "growth_partner", "source": "connect", "is_active": True, "partner_code": code,
                         "password": get_password_hash("Legacy@123")})
    r = requests.post(f"{API}/gp/signup", json={"reg_type": "individual", "mobile": om, "email": f"test_onb75_{om}@example.com", "name": "TEST_Onb Seventyfive", "password": "Partner@123"})
    print(json.dumps({"legacy_mobile": lm, "legacy_code": code, "onb_mobile": om, "onb_status": r.status_code}))
else:
    for m in sys.argv[2:]:
        u = db.users.find_one({"phone": m, "email": {"$regex": "^test_"}})
        if not u:
            continue
        code = u.get("partner_code")
        if code:
            print("agreements", db.gp_agreements.delete_many({"partner_code": code}).deleted_count,
                  "payouts", db.gp_payouts.delete_many({"partner_code": code}).deleted_count)
        for oid in [x["_id"] for x in db["gp_documents.files"].find({"metadata.partner_id": {"$in": [u.get("id"), str(u["_id"])]}})]:
            db["gp_documents.chunks"].delete_many({"files_id": oid}); db["gp_documents.files"].delete_one({"_id": oid})
        db.gp_login_failures.delete_many({"key": m})
        db.users.delete_one({"_id": u["_id"]})
        print("deleted", m)
