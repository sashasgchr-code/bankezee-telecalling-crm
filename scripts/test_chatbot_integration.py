import os, sys, json, hmac, hashlib, asyncio
import httpx
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path("/app/backend/.env"))
API = "http://localhost:8001"
KEY = os.environ["BANKEZEE_CHATBOT_CRM_KEY"]
LEAD = open("/tmp/lead.txt").read().strip()

passed, failed = [], []
def check(name, cond):
    (passed if cond else failed).append(name)
    print(("PASS " if cond else "FAIL ") + name)

def login():
    r = httpx.post(f"{API}/api/auth/login", json={"email": "admin@bankezee.com", "password": "ConnectSasha12!!"}, timeout=20)
    return r.json()["token"]

def sign(body: bytes):
    return hmac.new(KEY.encode(), body, hashlib.sha256).hexdigest()

def main():
    tok = login()
    H = {"Authorization": f"Bearer {tok}"}
    print(f"lead={LEAD}")

    # 1. Create link (live chatbot)
    r = httpx.post(f"{API}/api/meta/leads/{LEAD}/chatbot/link", headers=H,
                   json={"renew": False, "whatsapp_consent": False}, timeout=40)
    check("1. create link 200", r.status_code == 200)
    link = r.json().get("secure_link")
    check("1b. secure_link returned", bool(link))

    # 2. Reuse (renew=false) returns reused link, no new issuance
    r2 = httpx.post(f"{API}/api/meta/leads/{LEAD}/chatbot/link", headers=H,
                    json={"renew": False}, timeout=40)
    check("2. reuse link (reused=True)", r2.json().get("reused") is True)

    # 3. Signed webhook: loan_saved with two loans
    session = {
        "crm_lead_ref": LEAD,
        "status": "in_progress", "progress": 60,
        "net_monthly_salary": 85000, "company_name": "Acme Corp", "city": "Hyderabad",
        "cibil_score": 762, "cibil_bureau": "CIBIL",
        "loans": [
            {"loan_id": "L-1", "lender": "HDFC", "loan_type": "Personal", "original_amount": 500000,
             "sanction_date": "2023-01-15", "outstanding_balance": 320000, "interest_rate": 12.5,
             "monthly_emi": 11000, "original_tenure": 60, "emis_paid": 18},
            {"loan_id": "L-2", "lender": "Bajaj", "loan_type": "Consumer", "original_amount": 80000,
             "outstanding_balance": 20000, "monthly_emi": 4000, "original_tenure": 24, "emis_paid": 18},
        ],
        "documents": [{"doc_id": "D-1", "type": "payslip", "status": "uploaded"}],
    }
    body = json.dumps({"event": "loan_saved", "session": session}).encode()
    r = httpx.post(f"{API}/api/integrations/bankezee-chatbot/webhook",
                   content=body, headers={"X-Bankezee-Signature": sign(body), "Content-Type": "application/json"}, timeout=20)
    check("3. signed webhook 200", r.status_code == 200)

    # 3b. Bad signature rejected
    rb = httpx.post(f"{API}/api/integrations/bankezee-chatbot/webhook",
                    content=body, headers={"X-Bankezee-Signature": "bad", "Content-Type": "application/json"}, timeout=20)
    check("3b. bad signature 401", rb.status_code == 401)

    # 4. GET qualification reflects webhook data + computed totals/ratio
    r = httpx.get(f"{API}/api/meta/leads/{LEAD}/chatbot", headers=H, timeout=20)
    q = r.json().get("qualification") or {}
    check("4a. net salary", q.get("net_monthly_salary") == 85000)
    check("4b. company", q.get("company_name") == "Acme Corp")
    check("4c. cibil", q.get("cibil_score") == 762)
    check("4d. 2 loans", len(q.get("loans") or []) == 2)
    check("4e. total obligations computed (15000)", float(q.get("total_monthly_obligations") or 0) == 15000)
    check("4f. emi-to-salary ratio computed", q.get("emi_to_salary_ratio") is not None)
    check("4g. payslip status detected", bool(q.get("payslip_status")))

    # 5. Idempotency: re-fire same webhook -> still 2 loans (dedup by loan_id via replace)
    r = httpx.post(f"{API}/api/integrations/bankezee-chatbot/webhook",
                   content=body, headers={"X-Bankezee-Signature": sign(body), "Content-Type": "application/json"}, timeout=20)
    r = httpx.get(f"{API}/api/meta/leads/{LEAD}/chatbot", headers=H, timeout=20)
    check("5. idempotent (still 2 loans)", len(((r.json().get("qualification") or {}).get("loans")) or []) == 2)

    # 6. loan_deleted event removes a loan
    session2 = {**session, "loans": [session["loans"][0]]}
    body2 = json.dumps({"event": "loan_deleted", "session": session2}).encode()
    httpx.post(f"{API}/api/integrations/bankezee-chatbot/webhook", content=body2,
               headers={"X-Bankezee-Signature": sign(body2), "Content-Type": "application/json"}, timeout=20)
    r = httpx.get(f"{API}/api/meta/leads/{LEAD}/chatbot", headers=H, timeout=20)
    check("6. loan removed (1 loan)", len(((r.json().get("qualification") or {}).get("loans")) or []) == 1)

    # 7. callback_requested webhook accepted
    bodyc = json.dumps({"event": "callback_requested", "session": {"crm_lead_ref": LEAD}}).encode()
    rc = httpx.post(f"{API}/api/integrations/bankezee-chatbot/webhook", content=bodyc,
                    headers={"X-Bankezee-Signature": sign(bodyc), "Content-Type": "application/json"}, timeout=20)
    check("7. callback event 200", rc.status_code == 200)

    # 8. unknown lead ref rejected
    bodyu = json.dumps({"event": "loan_saved", "session": {"crm_lead_ref": "NON-EXISTENT-XYZ"}}).encode()
    ru = httpx.post(f"{API}/api/integrations/bankezee-chatbot/webhook", content=bodyu,
                    headers={"X-Bankezee-Signature": sign(bodyu), "Content-Type": "application/json"}, timeout=20)
    check("8. unknown lead 404", ru.status_code == 404)

    # 9. unsupported event rejected
    bodye = json.dumps({"event": "hacked", "session": {"crm_lead_ref": LEAD}}).encode()
    re_ = httpx.post(f"{API}/api/integrations/bankezee-chatbot/webhook", content=bodye,
                     headers={"X-Bankezee-Signature": sign(bodye), "Content-Type": "application/json"}, timeout=20)
    check("9. unsupported event 400", re_.status_code == 400)

    # 10. Refresh pulls live session (lead has a real link now)
    rr = httpx.post(f"{API}/api/meta/leads/{LEAD}/chatbot/refresh", headers=H, timeout=40)
    check("10. refresh 200", rr.status_code == 200)

    print(f"\n{len(passed)} passed, {len(failed)} failed")
    if failed:
        print("FAILED:", failed); sys.exit(1)

main()
