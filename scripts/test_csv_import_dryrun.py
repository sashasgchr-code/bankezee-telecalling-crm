"""Verify dry_run=true preview returns correct counts and writes NOTHING."""
import io, csv, requests
from pymongo import MongoClient
from datetime import datetime, timezone

def envval(path, key):
    for line in open(path):
        line = line.strip()
        if line.startswith(key + "="):
            return line.split("=", 1)[1].strip().strip('"')

MONGO_URL = envval("/app/backend/.env", "MONGO_URL")
DB_NAME = envval("/app/backend/.env", "DB_NAME")
API = envval("/app/frontend/.env", "REACT_APP_BACKEND_URL")
db = MongoClient(MONGO_URL)[DB_NAME]

GP_ROLES = ['telecaller', 'sales_agent', 'team_leader', 'partner', 'growth_partner']
gps = list(db.users.find({"role": {"$in": GP_ROLES}, "is_active": True}).limit(2))
gp_old, gp_new = gps[0], gps[1]
old_id = str(gp_old["_id"]); new_name = gp_new["name"]

PA, PB, PD = "9000000021", "9000000022", "9000000024"
phones = [PA, PB, PD]
db.leads.delete_many({"normalized_phone": {"$in": phones}})
now = datetime.now(timezone.utc)
def mk(p, s): return {"name": f"T {p}", "phone": p, "normalized_phone": p, "status": s,
                      "assigned_to": old_id, "telecaller_name": gp_old["name"],
                      "created_at": now, "updated_at": now, "_test": True}
db.leads.insert_one(mk(PA, "new"))    # would reassign
db.leads.insert_one(mk(PB, "file"))   # protected
# PD absent -> would insert

buf = io.StringIO(); w = csv.writer(buf); w.writerow(["name", "phone", "telecaller"])
for p in phones: w.writerow([f"I {p}", p, new_name])
w.writerow(["I typo", "9000000099", "NoSuchGpXYZ"])  # unmatched GP, new phone
csv_bytes = buf.getvalue().encode()

tok = requests.post(f"{API}/api/auth/login", json={"email": "admin@bankezee.com", "password": "ConnectSasha12!!"}).json()["token"]
r = requests.post(f"{API}/api/leads/import?dry_run=true", headers={"Authorization": f"Bearer {tok}"},
                  files={"file": ("t.csv", csv_bytes, "text/csv")})
resp = r.json()
print("STATUS", r.status_code); print("RESP", resp)

# Nothing should have changed / been inserted
la = db.leads.find_one({"normalized_phone": PA})
lb = db.leads.find_one({"normalized_phone": PB})
pd_docs = list(db.leads.find({"normalized_phone": PD}))
typo_docs = list(db.leads.find({"normalized_phone": "9000000099"}))

checks = [
  ("dry_run flag true", resp.get("dry_run") is True),
  ("reassigned==1", resp.get("reassigned") == 1),
  ("protected==1", resp.get("protected") == 1),
  ("total_imported(would create)==2", resp.get("total_imported") == 2),  # PD + typo(unassigned)
  ("unmatched GP listed", "NoSuchGpXYZ" in resp.get("unassigned_telecallers", [])),
  ("NO write: A unchanged", la.get("assigned_to") == old_id and la.get("status") == "new"),
  ("NO write: B unchanged", lb.get("assigned_to") == old_id and lb.get("status") == "file"),
  ("NO write: PD not inserted", len(pd_docs) == 0),
  ("NO write: typo not inserted", len(typo_docs) == 0),
  ("NO write: no history rows", db.lead_assignment_history.count_documents({"lead_id": str(la["_id"])}) == 0),
]
ok = True
for label, p in checks:
    print(("PASS" if p else "FAIL"), "-", label); ok = ok and p

db.leads.delete_many({"normalized_phone": {"$in": phones + ["9000000099"]}})
print("\nALL PASS" if ok else "\nSOME FAILED")
