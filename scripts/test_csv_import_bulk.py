"""Bulk-import stress + idempotency test: reassign (bulk), protected, new-insert, rerun safety."""
import io, csv, requests, time
from pymongo import MongoClient
from datetime import datetime, timezone

def envval(path, key):
    for line in open(path):
        if line.strip().startswith(key + "="):
            return line.split("=", 1)[1].strip().strip('"')

db = MongoClient(envval("/app/backend/.env", "MONGO_URL"))[envval("/app/backend/.env", "DB_NAME")]
API = envval("/app/frontend/.env", "REACT_APP_BACKEND_URL")

GP_ROLES = ['telecaller', 'sales_agent', 'team_leader', 'partner', 'growth_partner']
gps = list(db.users.find({"role": {"$in": GP_ROLES}, "is_active": True}).limit(2))
gp_old, gp_new = gps[0], gps[1]
old_id, new_id, new_name = str(gp_old["_id"]), str(gp_new["_id"]), gp_new["name"]

N_REASSIGN = 60   # data leads to reassign (exercises bulk path)
N_PROT = 5
prefix = "8811"
reassign_phones = [f"{prefix}{i:06d}" for i in range(N_REASSIGN)]
prot_phones = [f"8822{i:06d}" for i in range(N_PROT)]
new_phones = [f"8833{i:06d}" for i in range(10)]
all_phones = reassign_phones + prot_phones + new_phones

db.leads.delete_many({"normalized_phone": {"$in": all_phones}})
db.lead_assignment_history.delete_many({"from_user_id": old_id, "reason": "CSV import reassignment", "lead_id": {"$regex": "."}})
db.call_logs.delete_many({"_stress": True})

now = datetime.now(timezone.utc)
seeded = []
for p in reassign_phones:
    r = db.leads.insert_one({"name": f"R {p}", "phone": p, "normalized_phone": p, "status": "new",
                             "assigned_to": old_id, "telecaller_name": gp_old["name"],
                             "created_at": now, "updated_at": now, "_stress": True})
    # seed a call log owned by the OLD assignee to verify marking
    db.call_logs.insert_one({"lead_id": str(r.inserted_id), "user_id": old_id, "_stress": True})
    seeded.append(str(r.inserted_id))
for p in prot_phones:
    db.leads.insert_one({"name": f"P {p}", "phone": p, "normalized_phone": p, "status": "file",
                         "assigned_to": old_id, "created_at": now, "updated_at": now, "_stress": True})

# CSV: all rows target gp_new
buf = io.StringIO(); w = csv.writer(buf); w.writerow(["name", "phone", "telecaller"])
for p in all_phones:
    w.writerow([f"Imp {p}", p, new_name])
csv_bytes = buf.getvalue().encode()

tok = requests.post(f"{API}/api/auth/login", json={"email": "admin@bankezee.com", "password": "ConnectSasha12!!"}).json()["token"]
H = {"Authorization": f"Bearer {tok}"}

def do_import():
    t = time.time()
    r = requests.post(f"{API}/api/leads/import", headers=H, files={"file": ("s.csv", csv_bytes, "text/csv")}, timeout=120)
    return r, round(time.time() - t, 1)

r1, dur1 = do_import()
print("RUN1", r1.status_code, dur1, "s ->", r1.json())
j1 = r1.json()

reassigned = db.leads.count_documents({"normalized_phone": {"$in": reassign_phones}, "assigned_to": new_id, "status": "new"})
hist = db.lead_assignment_history.count_documents({"lead_id": {"$in": seeded}, "to_user_id": new_id})
marked = db.call_logs.count_documents({"_stress": True, "is_previous_agent_history": True})
prot_unchanged = db.leads.count_documents({"normalized_phone": {"$in": prot_phones}, "assigned_to": old_id, "status": "file"})
new_created = db.leads.count_documents({"normalized_phone": {"$in": new_phones}, "assigned_to": new_id})
new_dupe = db.leads.count_documents({"normalized_phone": {"$in": new_phones}})

checks = [
  ("RUN1 http 200", r1.status_code == 200),
  ("RUN1 completes well under timeout", dur1 < 60),
  (f"all {N_REASSIGN} data leads reassigned", reassigned == N_REASSIGN),
  ("resp reassigned count correct", j1.get("reassigned") == N_REASSIGN),
  ("assignment history written (bulk)", hist == N_REASSIGN),
  ("old GP call logs marked previous-agent", marked == N_REASSIGN),
  ("protected files unchanged", prot_unchanged == N_PROT),
  ("resp protected correct", j1.get("protected") == N_PROT),
  ("new phones inserted to new GP", new_created == 10),
  ("no duplicate new inserts", new_dupe == 10),
]

# RUN 2 - idempotency / rerun-after-partial safety
r2, dur2 = do_import()
print("RUN2", r2.status_code, dur2, "s ->", r2.json())
j2 = r2.json()
new_dupe_after = db.leads.count_documents({"normalized_phone": {"$in": new_phones}})
reassign_dupe_after = db.leads.count_documents({"normalized_phone": {"$in": reassign_phones}})
prot_after = db.leads.count_documents({"normalized_phone": {"$in": prot_phones}, "assigned_to": old_id, "status": "file"})

checks += [
  ("RUN2 http 200", r2.status_code == 200),
  ("RUN2 creates NO new leads (idempotent)", j2.get("total_imported") == 0),
  ("RUN2 reassigns 0 (already owned)", j2.get("reassigned") == 0),
  ("RUN2 no duplicate new phones", new_dupe_after == 10),
  ("RUN2 no duplicate reassign phones", reassign_dupe_after == N_REASSIGN),
  ("RUN2 protected still protected", prot_after == N_PROT),
]

ok = True
for l, c in checks:
    print(("PASS" if c else "FAIL"), "-", l); ok = ok and c

# cleanup
db.leads.delete_many({"normalized_phone": {"$in": all_phones}})
db.lead_assignment_history.delete_many({"lead_id": {"$in": seeded}})
db.call_logs.delete_many({"_stress": True})
print("\nALL PASS" if ok else "\nSOME FAILED")
