# Iter72 helper: fresh fixture -> repeated GET (no dup jobs) -> read -> apply Kotak conflict -> EMI 58,329, 7 loans, no dup Kotak
import os, subprocess, requests, time
B = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") + "/api"
L = "lead_swamytest01"
subprocess.run(["python3", "/app/backend/tests/swamy_fixture.py"], check=True, cwd="/app/backend")
s = requests.Session()
tok = s.post(f"{B}/auth/login", json={"email": "admin@bankezee.com", "password": "ConnectSasha12!!"}).json()
s.headers["Authorization"] = "Bearer " + (tok.get("access_token") or tok.get("token"))
for i in range(4):
    d = s.get(f"{B}/doc-extract/meta/{L}").json()
    print("GET", i, "processing", d["processing"], "docs", len(d["documents"]), "conflicts", len(d["conflicts"]))
d = s.post(f"{B}/doc-extract/meta/{L}/read-documents").json()
print("read: docs", len(d["documents"]), "conflicts", [c["label"] for c in d["conflicts"]])
k = next(c for c in d["conflicts"] if "Kotak" in c["label"])
d = s.post(f"{B}/doc-extract/meta/{L}/conflicts/{k['id']}", json={"action": "apply"}).json()
print("after apply conflicts:", [c["label"] for c in d["conflicts"]])
r = s.post(f"{B}/meta/files-compat/{L}/check-eligibility").json()
p = r["customer_profile"] if "customer_profile" in r else r.get("profile", {})
print("existing_emi", p.get("existing_emi"), "foir", p.get("foir"), "loans", p.get("existing_loans_count"), "strength", r.get("profile_strength"))
print("kotak rows", [ (x.get("bank"), x.get("outstanding"), x.get("emi")) for x in p.get("existing_loans", []) if "otak" in str(x.get("bank"))])
print("counts", r.get("eligible_count"), r.get("possibly_eligible_count"), r.get("not_eligible_count"), r.get("total_policies"), len(r["results"]))
d = s.post(f"{B}/doc-extract/meta/{L}/read-documents").json()
print("after re-read conflicts:", [c["label"] for c in d["conflicts"]])
print("doc ext count:", len(s.get(f"{B}/doc-extract/meta/{L}").json()["documents"]))
