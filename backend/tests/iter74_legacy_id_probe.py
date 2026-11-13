import os, sys, asyncio, uuid, random, requests
sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")
from motor.motor_asyncio import AsyncIOMotorClient
from utils.auth import create_access_token, get_password_hash
API = "https://responsive-crm-app-1.preview.emergentagent.com/api"
async def main():
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    m = "5" + "".join(random.choice("0123456789") for _ in range(9))
    code = "TESTLEG" + m[-4:]
    r = await db.users.insert_one({"id": str(uuid.uuid4()), "email": f"test_legacy_{m}@example.com", "name": "TEST_Legacy Probe", "phone": m, "role": "growth_partner",
        "source": "connect", "is_active": True, "partner_code": code, "password": get_password_hash("x12345678")})
    tok = create_access_token({"user_id": str(r.inserted_id), "platform": "web"}); H = {"Authorization": f"Bearer {tok}"}
    adm = requests.post(f"{API}/auth/login", json={"email": "admin@bankezee.com", "password": "ConnectSasha12!!"}).json()["token"]; A = {"Authorization": f"Bearer {adm}"}
    me = requests.get(f"{API}/gp/me", headers=H).json(); print("me status", me["status"], "legacy", me["legacy_partner"])
    d = requests.post(f"{API}/gp/me/kyc/pan", headers=H, files={"file": ("p.pdf", b"%PDF-1.4", "application/pdf")}, data={"number": "ABCDE1234F"}).json()
    did = d["kyc"]["pan"]["doc_id"]
    print("own doc GET:", requests.get(f"{API}/gp/docs/{did}", headers=H).status_code)
    print("admin decide by user_id:", requests.post(f"{API}/gp/admin/partners/{me['user_id']}/kyc/pan", headers=A, json={"status": "Verified"}).status_code)
    lead = requests.post(f"{API}/gp/leads", headers=H, json={"name": "TEST_LegLead", "mobile": "6" + m[1:], "consent": True}).json()
    lv = requests.get(f"{API}/gp/leads", headers=H).json()
    print("lead added", lead, "-> visible in my leads:", lv["total"])
    tid = [t for t in requests.get(f"{API}/gp/admin/agreement-templates", headers=A).json() if t["status"] == "published"][0]["id"]
    print("issue:", requests.post(f"{API}/gp/admin/agreement-templates/{tid}/issue", headers=A, json={"partner_codes": [code]}).json())
    ag = requests.get(f"{API}/gp/agreement", headers=H).json()
    print("/gp/agreement current:", ag["current"] and ag["current"]["status"], "| /gp/me agreement:", requests.get(f"{API}/gp/me", headers=H).json()["agreement"])
    pay = requests.post(f"{API}/gp/admin/payouts", headers=A, json={"partner_code": code, "product_code": "PL", "disbursement_date": "2026-11-01", "disbursed_amount": 100000})
    print("admin payout", pay.status_code, "-> partner sees rows:", len(requests.get(f"{API}/gp/payouts", headers=H).json()["rows"]))
    # cleanup only what we created
    u = await db.users.find_one({"_id": r.inserted_id})
    await db.gp_agreements.delete_many({"partner_code": code})
    if pay.status_code == 200: await db.gp_payouts.delete_one({"id": pay.json()["id"]})
    if lead.get("id"): await db.leads.delete_one({"id": lead["id"]})
    await db.users.delete_one({"_id": r.inserted_id})
    print("cleaned")
asyncio.run(main())
