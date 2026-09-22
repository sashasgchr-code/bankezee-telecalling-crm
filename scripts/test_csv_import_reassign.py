"""E2E test for CSV import reassignment/protection logic. Seeds fixtures, calls the API, verifies, cleans up."""
import os, io, csv, requests, time
from pymongo import MongoClient
from datetime import datetime, timezone

BACKEND_ENV = "/app/backend/.env"
FRONT_ENV = "/app/frontend/.env"

def envval(path, key):
    for line in open(path):
        line = line.strip()
        if line.startswith(key + "="):
            return line.split("=", 1)[1].strip().strip('"')
    return None

MONGO_URL = envval(BACKEND_ENV, "MONGO_URL")
DB_NAME = envval(BACKEND_ENV, "DB_NAME")
API = envval(FRONT_ENV, "REACT_APP_BACKEND_URL")

cli = MongoClient(MONGO_URL)
db = cli[DB_NAME]

GP_ROLES = ['telecaller', 'sales_agent', 'team_leader', 'partner', 'growth_partner']
gps = list(db.users.find({"role": {"$in": GP_ROLES}, "is_active": True}).limit(5))
assert len(gps) >= 2, "need 2 active GPs"
gp_old, gp_new = gps[0], gps[1]
old_id = str(gp_old["_id"])
new_id = str(gp_new["_id"])
new_name = gp_new["name"]
print(f"gp_old={gp_old['name']} ({old_id})  gp_new={new_name} ({new_id})")

PA, PB, PC, PD = "9000000011", "9000000012", "9000000013", "9000000014"
test_phones = [PA, PB, PC, PD]
# cleanup any leftovers first
db.leads.delete_many({"normalized_phone": {"$in": test_phones}})
db.lead_assignment_history.delete_many({"lead_id": {"$regex": "TESTCSV"}})

now = datetime.now(timezone.utc)
def mk(phone, status):
    return {"name": f"T {phone}", "phone": phone, "normalized_phone": phone,
            "status": status, "assigned_to": old_id, "telecaller_name": gp_old["name"],
            "created_at": now, "updated_at": now, "_test": True}

db.leads.insert_one(mk(PA, "new"))     # data -> reassign
db.leads.insert_one(mk(PB, "file"))    # file -> protected
db.leads.insert_one(mk(PC, "leads"))   # lead -> protected
# PD absent -> new insert

# Build CSV (all rows point telecaller to gp_new)
buf = io.StringIO()
w = csv.writer(buf)
w.writerow(["name", "phone", "telecaller"])
for p in test_phones:
    w.writerow([f"Import {p}", p, new_name])
csv_bytes = buf.getvalue().encode()

tok = requests.post(f"{API}/api/auth/login", json={"email": "admin@bankezee.com", "password": "ConnectSasha12!!"}).json()["token"]
r = requests.post(f"{API}/api/leads/import",
                  headers={"Authorization": f"Bearer {tok}"},
                  files={"file": ("test.csv", csv_bytes, "text/csv")})
print("STATUS", r.status_code)
resp = r.json()
print("RESP", resp)

# Verify
la = db.leads.find_one({"normalized_phone": PA})
lb = db.leads.find_one({"normalized_phone": PB})
lc = db.leads.find_one({"normalized_phone": PC})
ld = list(db.leads.find({"normalized_phone": PD}))

results = []
results.append(("A reassigned to new GP", la.get("assigned_to") == new_id and la.get("status") == "new"))
results.append(("A history recorded", db.lead_assignment_history.count_documents({"lead_id": str(la["_id"]), "to_user_id": new_id}) == 1))
results.append(("B file protected (unchanged)", lb.get("assigned_to") == old_id and lb.get("status") == "file"))
results.append(("C lead protected (unchanged)", lc.get("assigned_to") == old_id and lc.get("status") == "leads"))
results.append(("D new entry inserted assigned to new GP", len(ld) == 1 and ld[0].get("assigned_to") == new_id))
results.append(("resp reassigned>=1", resp.get("reassigned", 0) >= 1))
results.append(("resp protected>=2", resp.get("protected", 0) >= 2))
results.append(("resp total_imported==1", resp.get("total_imported") == 1))

ok = True
for label, passed in results:
    print(("PASS" if passed else "FAIL"), "-", label)
    ok = ok and passed

# cleanup
db.leads.delete_many({"normalized_phone": {"$in": test_phones}})
db.lead_assignment_history.delete_many({"lead_id": {"$in": [str(la["_id"])]}})
print("\nALL PASS" if ok else "\nSOME FAILED")
