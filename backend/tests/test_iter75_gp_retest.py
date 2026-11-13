# GP programme iteration 75 retest: kyc_decide 404/400, docs invalid id 404, /gp/login lockout (fresh TEST GP),
# legacy partner identity (temporary TEST legacy user: KYC decide, docs, leads, agreement sign w/ on-screen code, payouts),
# download filenames.
import asyncio
import os
import random
import sys
import uuid

import pytest
import requests

sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv  # noqa: E402
load_dotenv("/app/backend/.env")

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    for ln in open("/app/frontend/.env"):
        if ln.startswith("REACT_APP_BACKEND_URL="):
            BASE_URL = ln.split("=", 1)[1].strip().rstrip("/")
API = BASE_URL + "/api"
PDF = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF"
S = {}


def H(t):
    return {"Authorization": f"Bearer {t}"}


def mob(p="9"):
    return p + "".join(random.choice("0123456789") for _ in range(9))


def run(coro):
    return asyncio.get_event_loop().run_until_complete(coro) if False else asyncio.run(coro)


def mdb():
    from pymongo import MongoClient
    return MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]


@pytest.fixture(scope="module")
def admin():
    r = requests.post(f"{API}/auth/login", json={"email": "admin@bankezee.com", "password": "ConnectSasha12!!"})
    assert r.status_code == 200
    return r.json()["token"]


@pytest.fixture(scope="module")
def gp():
    m = mob()
    email = f"test_gp75_{m}@example.com"
    r = requests.post(f"{API}/gp/signup", json={"reg_type": "individual", "mobile": m, "email": email, "name": "TEST_GP75 Full Name", "password": "Partner@123"})
    assert r.status_code == 200, r.text
    S.update(mobile=m, email=email)
    me = requests.get(f"{API}/gp/me", headers=H(r.json()["token"])).json()
    S["gp_uid"] = me["user_id"]
    return r.json()["token"]


@pytest.fixture(scope="module")
def legacy(admin):
    """Temporary legacy-style GP: users.id (uuid) != str(_id)."""
    from utils.auth import create_access_token, get_password_hash

    m = mob("5")
    code = "TESTLG" + m[-4:]

    def mk():
        r = mdb().users.insert_one({"id": str(uuid.uuid4()), "email": f"test_legacy75_{m}@example.com", "name": "TEST_Legacy SeventyFive",
                                          "phone": m, "role": "growth_partner", "source": "connect", "is_active": True,
                                          "partner_code": code, "password": get_password_hash("x12345678")})
        return r.inserted_id
    oid = mk()
    tok = create_access_token({"user_id": str(oid), "platform": "web"})
    S.update(leg_oid=oid, leg_code=code, leg_lead=None, leg_pay=None)
    yield tok

    def clean():
        d = mdb()
        d.gp_agreements.delete_many({"partner_code": code})
        if S.get("leg_pay"):
            d.gp_payouts.delete_one({"id": S["leg_pay"]})
        if S.get("leg_lead"):
            d.leads.delete_one({"id": S["leg_lead"]})
        d.users.delete_one({"_id": oid})
    clean()


class TestKycDecideAndDocs:
    def test_unknown_item_404(self, admin, gp):
        r = requests.post(f"{API}/gp/admin/partners/{S['gp_uid']}/kyc/bogus_item", headers=H(admin), json={"status": "Verified"})
        assert r.status_code == 404, r.text

    def test_never_submitted_400(self, admin, gp):
        r = requests.post(f"{API}/gp/admin/partners/{S['gp_uid']}/kyc/identity", headers=H(admin), json={"status": "Verified"})
        assert r.status_code == 400, r.text

    def test_reject_requires_note(self, admin, gp):
        requests.post(f"{API}/gp/me/kyc/pan", headers=H(gp), files={"file": ("p.pdf", PDF, "application/pdf")}, data={"number": "ABCDE1234F"})
        r = requests.post(f"{API}/gp/admin/partners/{S['gp_uid']}/kyc/pan", headers=H(admin), json={"status": "Action Required"})
        assert r.status_code == 400
        r = requests.post(f"{API}/gp/admin/partners/{S['gp_uid']}/kyc/pan", headers=H(admin), json={"status": "Action Required", "note": "TEST_ blurry"})
        assert r.status_code == 200
        k = requests.get(f"{API}/gp/me", headers=H(gp)).json()["kyc"]["pan"]
        assert k["status"] == "Action Required" and k["note"] == "TEST_ blurry"

    def test_unknown_partner_404(self, admin):
        r = requests.post(f"{API}/gp/admin/partners/000000000000000000000000/kyc/pan", headers=H(admin), json={"status": "Verified"})
        assert r.status_code == 404

    def test_docs_invalid_404(self, gp):
        assert requests.get(f"{API}/gp/docs/not-an-id", headers=H(gp)).status_code == 404
        assert requests.get(f"{API}/gp/docs/000000000000000000000000", headers=H(gp)).status_code == 404


class TestLockout:
    def test_lockout_after_5(self, gp):
        ident = S["mobile"]
        try:
            for i in range(5):
                r = requests.post(f"{API}/gp/login", json={"identifier": ident, "password": "WrongPass!1"})
                assert r.status_code == 401, (i, r.status_code, r.text)
            r = requests.post(f"{API}/gp/login", json={"identifier": ident, "password": "Partner@123"})
            assert r.status_code == 429, r.text
            # Same account via email identifier (different key) - document behaviour
            r2 = requests.post(f"{API}/gp/login", json={"identifier": S["email"], "password": "Partner@123"})
            print("email identifier after mobile lockout:", r2.status_code)
        finally:
            mdb().gp_login_failures.delete_many({})
        r = requests.post(f"{API}/gp/login", json={"identifier": ident, "password": "Partner@123"})
        assert r.status_code == 200

    def test_success_resets_counter(self, gp):
        ident = S["email"]
        try:
            for _ in range(4):
                requests.post(f"{API}/gp/login", json={"identifier": ident, "password": "bad"})
            assert requests.post(f"{API}/gp/login", json={"identifier": ident, "password": "Partner@123"}).status_code == 200
            assert requests.post(f"{API}/gp/login", json={"identifier": ident, "password": "bad"}).status_code == 401
            assert requests.post(f"{API}/gp/login", json={"identifier": ident, "password": "Partner@123"}).status_code == 200
        finally:
            mdb().gp_login_failures.delete_many({})


class TestLegacy:
    def test_kyc_doc_and_decide(self, admin, legacy):
        me = requests.get(f"{API}/gp/me", headers=H(legacy)).json()
        assert me["legacy_partner"] is True and me["status"] == "Active"
        S["leg_uid"] = me["user_id"]
        d = requests.post(f"{API}/gp/me/kyc/pan", headers=H(legacy), files={"file": ("pan.pdf", PDF, "application/pdf")}, data={"number": "ABCDE1234F"})
        assert d.status_code == 200, d.text
        did = d.json()["kyc"]["pan"]["doc_id"]
        g = requests.get(f"{API}/gp/docs/{did}", headers=H(legacy))
        assert g.status_code == 200 and 'filename="pan.pdf"' in g.headers.get("content-disposition", "")
        r = requests.post(f"{API}/gp/admin/partners/{S['leg_uid']}/kyc/pan", headers=H(admin), json={"status": "Action Required", "note": "TEST_ redo"})
        assert r.status_code == 200, r.text
        assert requests.get(f"{API}/gp/me", headers=H(legacy)).json()["kyc"]["pan"]["status"] == "Action Required"
        r = requests.post(f"{API}/gp/admin/partners/{S['leg_uid']}/kyc/pan", headers=H(admin), json={"status": "Verified"})
        assert r.status_code == 200
        assert requests.get(f"{API}/gp/me", headers=H(legacy)).json()["kyc"]["pan"]["status"] == "Verified"
        # admin listing lookup by user_id visible
        lst = requests.get(f"{API}/gp/admin/partners", headers=H(admin)).json()
        assert any(p["user_id"] == S["leg_uid"] for p in lst)

    def test_lead_visible(self, legacy):
        lead = requests.post(f"{API}/gp/leads", headers=H(legacy), json={"name": "TEST_Leg75Lead", "mobile": mob("6"), "consent": True}).json()
        S["leg_lead"] = lead.get("id")
        lv = requests.get(f"{API}/gp/leads", headers=H(legacy)).json()
        assert lv["total"] == 1

    def test_agreement_sign(self, admin, legacy):
        tid = [t for t in requests.get(f"{API}/gp/admin/agreement-templates", headers=H(admin)).json() if t["status"] == "published"][0]["id"]
        assert requests.post(f"{API}/gp/admin/agreement-templates/{tid}/issue", headers=H(admin), json={"partner_codes": [S["leg_code"]]}).json()["issued"] == 1
        ag = requests.get(f"{API}/gp/agreement", headers=H(legacy)).json()["current"]
        assert ag and ag["status"] == "Awaiting Signature"
        sc = requests.post(f"{API}/gp/agreement/{ag['id']}/send-code", headers=H(legacy))
        assert sc.status_code == 200, sc.text
        code = sc.json().get("preview_code")
        assert code, sc.json()
        bad = requests.post(f"{API}/gp/agreement/{ag['id']}/sign", headers=H(legacy), json={"code": "000000" if code != "000000" else "111111", "accept": True})
        assert bad.status_code in (400, 401, 422)
        ok = requests.post(f"{API}/gp/agreement/{ag['id']}/sign", headers=H(legacy), json={"code": code, "accept": True})
        assert ok.status_code == 200, ok.text
        assert requests.get(f"{API}/gp/me", headers=H(legacy)).json()["agreement"]["status"] == "Signed"
        S["leg_ag"] = ag["id"]

    def test_download_filenames(self, legacy):
        pdf = requests.get(f"{API}/gp/agreement/{S['leg_ag']}/pdf", headers=H(legacy))
        print("agreement pdf", pdf.status_code, pdf.headers.get("content-disposition"))
        assert pdf.status_code == 200 and "filename=" in pdf.headers.get("content-disposition", "")
        cert = requests.get(f"{API}/gp/certificate.pdf", headers=H(legacy))
        print("certificate", cert.status_code, cert.headers.get("content-disposition"))
        st = requests.get(f"{API}/gp/payouts/statement.csv", headers=H(legacy))
        print("statement", st.status_code, st.headers.get("content-disposition"))

    def test_payout_visible(self, admin, legacy):
        p = requests.post(f"{API}/gp/admin/payouts", headers=H(admin), json={"partner_code": S["leg_code"], "product_code": "PL", "disbursement_date": "2026-11-01", "disbursed_amount": 100000})
        assert p.status_code == 200, p.text
        S["leg_pay"] = p.json()["id"]
        rows = requests.get(f"{API}/gp/payouts", headers=H(legacy)).json()["rows"]
        assert len(rows) == 1
