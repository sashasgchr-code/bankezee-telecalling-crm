# GP programme (iteration 74): signup/login, onboarding steps, KYC review, agreement signing,
# leads/referrals, payout-structure CSV import + versioning, payout ledger, templates, role guards, legacy partner.
import io
import os
import random
import subprocess

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    for ln in open("/app/frontend/.env"):
        if ln.startswith("REACT_APP_BACKEND_URL="):
            BASE_URL = ln.split("=", 1)[1].strip().rstrip("/")
API = BASE_URL + "/api"
PDF = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF"
S = {}  # shared state across ordered tests
HDR = "rate_code,product_code,lender_code,payout_type,payout_value,slab_min_inr,slab_max_inr,qualifying_event,effective_from,effective_to,partner_code,partner_visible_terms"


def H(t):
    return {"Authorization": f"Bearer {t}"}


def mob():
    return "9" + "".join(random.choice("0123456789") for _ in range(9))


def staff_login(email, pw):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": pw})
    assert r.status_code == 200, r.text
    d = r.json()
    return d.get("token") or d.get("access_token")


@pytest.fixture(scope="module")
def admin():
    return staff_login("admin@bankezee.com", "ConnectSasha12!!")


@pytest.fixture(scope="module")
def gp():
    m = mob()
    email = f"test_gp_{m}@example.com"
    r = requests.post(f"{API}/gp/signup", json={"reg_type": "individual", "mobile": m, "email": email, "name": "TEST_GP Indiv", "password": "Partner@123"})
    assert r.status_code == 200, r.text
    S.update(mobile=m, email=email)
    return r.json()["token"]


def me(t):
    r = requests.get(f"{API}/gp/me", headers=H(t))
    assert r.status_code == 200, r.text
    return r.json()


# ---- signup / login ----
class TestSignup:
    def test_signup_state(self, gp):
        d = me(gp)
        S["code"], S["uid"] = d["partner_id"], d["user_id"]
        assert d["status"] == "Onboarding" and d["first_incomplete"] == "profile" and d["legacy_partner"] is False

    def test_duplicate_mobile(self, gp):
        r = requests.post(f"{API}/gp/signup", json={"reg_type": "individual", "mobile": S["mobile"], "email": "x" + S["email"], "name": "TEST_dup", "password": "Partner@123"})
        assert r.status_code == 409 and r.json().get("detail") == "already_registered"
        assert requests.get(f"{API}/gp/check", params={"mobile": S["mobile"]}).json()["registered"] is True

    def test_business_signup(self):
        m = mob()
        r = requests.post(f"{API}/gp/signup", json={"reg_type": "business", "mobile": m, "email": f"test_biz_{m}@example.com", "name": "TEST_Biz Sig", "password": "Partner@123"})
        assert r.status_code == 200
        d = me(r.json()["token"])
        assert set(d["kyc"]) == {"pan", "identity", "business_reg", "bank"}
        # business profile needs entity_name for the profile step
        d = requests.put(f"{API}/gp/me/profile", headers=H(r.json()["token"]), json={"legal_name": "TEST Biz", "city": "Hyd", "pin": "500001"}).json()
        assert d["steps"]["profile"] is False

    def test_login_mobile_and_email(self, gp):
        for ident in (S["mobile"], S["email"]):
            r = requests.post(f"{API}/gp/login", json={"identifier": ident, "password": "Partner@123"})
            assert r.status_code == 200 and r.json().get("token")
        assert requests.post(f"{API}/gp/login", json={"identifier": S["mobile"], "password": "wrong"}).status_code == 401


# ---- onboarding ----
class TestOnboarding:
    def test_profile(self, gp):
        r = requests.put(f"{API}/gp/me/profile", headers=H(gp), json={"legal_name": "TEST_GP Indiv", "city": "Hyderabad", "pin": "5000"})
        assert r.status_code == 400 and "6 digits" in r.json()["detail"]
        d = requests.put(f"{API}/gp/me/profile", headers=H(gp), json={"legal_name": "TEST_GP Indiv", "city": "Hyderabad", "pin": "500081", "address": "1 Road", "state": "Telangana", "dob": "1990-01-01"}).json()
        assert d["steps"]["profile"] and d["first_incomplete"] == "kyc"

    def test_kyc(self, gp):
        f = {"file": ("pan.pdf", PDF, "application/pdf")}
        r = requests.post(f"{API}/gp/me/kyc/pan", headers=H(gp), files=f, data={"number": "ABC123"})
        assert r.status_code == 400
        d = requests.post(f"{API}/gp/me/kyc/pan", headers=H(gp), files={"file": ("pan.pdf", PDF, "application/pdf")}, data={"number": "abcde1234f"}).json()
        assert d["kyc"]["pan"]["status"] == "Pending" and d["steps"]["kyc"] is False
        S["pan_doc"] = None
        d = requests.post(f"{API}/gp/me/kyc/identity", headers=H(gp), files={"file": ("id.pdf", PDF, "application/pdf")}, data={"number": "1234", "id_type": "Aadhaar"}).json()
        assert d["steps"]["kyc"] is True and d["first_incomplete"] == "payout"

    def test_payout(self, gp):
        base = {"holder": "TEST GP", "account_number": "123456789012", "ifsc": "HDFC0001234"}
        r = requests.put(f"{API}/gp/me/payout", headers=H(gp), json=base | {"confirm_account_number": "123456789013"})
        assert r.status_code == 400 and "do not match" in r.json()["detail"]
        r = requests.put(f"{API}/gp/me/payout", headers=H(gp), json=base | {"ifsc": "HDFC123", "confirm_account_number": "123456789012"})
        assert r.status_code == 400
        d = requests.put(f"{API}/gp/me/payout", headers=H(gp), json=base | {"confirm_account_number": "123456789012"}).json()
        assert d["payout"]["account"].endswith("9012") and "1234567" not in d["payout"]["account"]
        d = requests.post(f"{API}/gp/me/kyc/bank", headers=H(gp), files={"file": ("chq.pdf", PDF, "application/pdf")}).json()
        assert d["kyc"]["bank"]["status"] == "Pending" and d["first_incomplete"] == "agreement"

    def test_agreement_sign(self, gp):
        a = requests.get(f"{API}/gp/agreement", headers=H(gp)).json()
        assert a["current"] and a["current"]["status"] == "Awaiting Signature"
        aid = S["aid"] = a["current"]["id"]
        r = requests.post(f"{API}/gp/agreement/{aid}/send-code", headers=H(gp))
        assert r.status_code == 200, r.text
        code = r.json().get("preview_code")
        assert r.json()["delivery"] == "on_screen" and code and len(code) == 6
        bad = "000000" if code != "000000" else "111111"
        r = requests.post(f"{API}/gp/agreement/{aid}/sign", headers=H(gp), json={"code": bad, "accept": True})
        assert r.status_code == 400 and r.json()["detail"] == "Incorrect code"
        r = requests.post(f"{API}/gp/agreement/{aid}/sign", headers=H(gp), json={"code": code, "accept": True})
        assert r.status_code == 200 and r.json()["status"] == "Signed"
        p = requests.get(f"{API}/gp/agreement/{aid}/pdf", headers=H(gp))
        assert p.status_code == 200 and p.content[:4] == b"%PDF" and "signed" in p.headers.get("content-disposition", "")
        d = me(gp)
        assert d["steps"]["agreement"] and d["status"] == "Onboarding"
        assert requests.get(f"{API}/gp/certificate.pdf", headers=H(gp)).status_code == 403


# ---- admin KYC review -> activation ----
class TestAdminKyc:
    def test_partner_listed(self, admin, gp):
        r = requests.get(f"{API}/gp/admin/partners", headers=H(admin), timeout=120)
        assert r.status_code == 200
        hit = [p for p in r.json() if p["partner_id"] == S["code"]]
        assert hit and hit[0]["kyc"]["pan"]["status"] == "Pending"

    def test_action_required_and_replace(self, admin, gp):
        u = f"{API}/gp/admin/partners/{S['code']}/kyc/identity"
        assert requests.post(u, headers=H(admin), json={"status": "Action Required"}).status_code == 400
        assert requests.post(u, headers=H(admin), json={"status": "Action Required", "note": "TEST blurry"}).status_code == 200
        d = me(gp)
        assert d["kyc"]["identity"]["status"] == "Action Required" and d["kyc"]["identity"]["note"] == "TEST blurry"
        assert any(t["key"] == "kyc_fix" for t in d["tasks"])
        d = requests.post(f"{API}/gp/me/kyc/identity", headers=H(gp), files={"file": ("id2.pdf", PDF, "application/pdf")}, data={"number": "5678"}).json()
        assert d["kyc"]["identity"]["status"] == "Pending"

    def test_verify_all_activates(self, admin, gp):
        for it in ("pan", "identity", "bank"):
            assert requests.post(f"{API}/gp/admin/partners/{S['code']}/kyc/{it}", headers=H(admin), json={"status": "Verified"}).status_code == 200
        d = me(gp)
        assert d["status"] == "Active", d
        c = requests.get(f"{API}/gp/certificate.pdf", headers=H(gp))
        assert c.status_code == 200 and c.content[:4] == b"%PDF"

    def test_kyc_decide_unknown_item(self, admin, gp):
        r = requests.post(f"{API}/gp/admin/partners/{S['code']}/kyc/bogus_item", headers=H(admin), json={"status": "Verified"})
        assert r.status_code in (400, 404), f"arbitrary KYC item accepted: {r.status_code}"


# ---- leads & referrals ----
class TestLeads:
    def test_add_lead(self, gp):
        body = {"name": "TEST_Lead One", "mobile": mob(), "city": "Hyd", "loan_type": "Personal Loan", "amount": 500000}
        assert requests.post(f"{API}/gp/leads", headers=H(gp), json=body | {"consent": False}).status_code == 400
        r = requests.post(f"{API}/gp/leads", headers=H(gp), json=body | {"consent": True})
        assert r.status_code == 200, r.text
        S["lead_name"] = body["name"]
        d = requests.get(f"{API}/gp/leads", headers=H(gp), params={"search": "TEST_Lead One"}).json()
        assert d["total"] >= 1 and d["rows"][0]["name"] == "TEST_Lead One"

    def test_public_referral(self, gp):
        p = requests.get(f"{API}/gp/public/partner/{S['code']}")
        assert p.status_code == 200 and p.json()["partner_id"] == S["code"]
        r = requests.post(f"{API}/gp/public/refer/{S['code']}", json={"name": "TEST_Ref Cust", "mobile": mob(), "loan_type": "Home Loan", "consent": True})
        assert r.status_code == 200 and r.json()["ok"]
        rows = requests.get(f"{API}/gp/leads", headers=H(gp)).json()["rows"]
        assert any(x["name"] == "TEST_Ref Cust" and x["via"] == "Referral link" for x in rows)
        assert requests.get(f"{API}/gp/public/partner/NOPE000000").status_code == 404


# ---- payout structure CSV ----
def upload(admin, rows):
    body = HDR + "\n" + "\n".join(rows) + "\n"
    return requests.post(f"{API}/gp/admin/rates/preview", headers=H(admin), files={"file": ("t.csv", body.encode(), "text/csv")})


class TestRates:
    def test_template(self, admin):
        r = requests.get(f"{API}/gp/admin/rates/template.csv", headers=H(admin))
        assert r.status_code == 200 and r.text.startswith(HDR)

    def test_bad_header(self, admin):
        r = requests.post(f"{API}/gp/admin/rates/preview", headers=H(admin), files={"file": ("t.csv", b"a,b\n1,2\n", "text/csv")})
        assert r.status_code == 400

    def test_error_rows_block_publish(self, admin, gp):
        c, k = S["code"], S["code"][-4:]
        rows = [f"TEST_{k}_A,XX,,percent,1,0,,disbursement,2026-01-01,,{c},t",
                f"TEST_{k}_B,PL,,percent,12,0,,disbursement,2026-01-01,,{c},t",
                f"TEST_{k}_C,EL,,percent,1,0,100000,disbursement,2026-01-01,,{c},t",
                f"TEST_{k}_C,EL,,percent,1,200000,300000,disbursement,2026-01-01,,{c},t",
                f"TEST_{k}_D,GL,,percent,1,0,,disbursement,2026-01-01,2026-12-31,{c},t",
                f"TEST_{k}_E,GL,,percent,1,0,,disbursement,2026-06-01,,{c},t"]
        b = upload(admin, rows).json()
        errs = {(r["row"]): " ".join(r["errors"]) for r in b["rows"]}
        assert "unknown product_code" in errs[2] and "percent must be" in errs[3]
        assert "duplicate rate_code" in errs[5] and "overlaps" in (errs[6] + errs[7])
        assert b["summary"]["Error"] >= 4
        assert requests.post(f"{API}/gp/admin/rates/batches/{b['id']}/publish", headers=H(admin)).status_code == 400

    def test_publish_versions(self, admin, gp):
        c, k = S["code"], S["code"][-4:]
        hl = f"TEST_{k}_HL1,HL,,percent,{{v}},0,,disbursement,2025-01-01,,{c},TEST override"
        bl = f"TEST_{k}_BL1,BL,,fixed,5000,0,,disbursement,2030-01-01,,{c},TEST upcoming"
        b = upload(admin, [hl.format(v="2.0"), bl]).json()
        assert b["summary"] == {"New": 2, "Update": 0, "Unchanged": 0, "Error": 0}, b
        assert requests.post(f"{API}/gp/admin/rates/batches/{b['id']}/publish", headers=H(admin)).json()["published"] == 2
        b = upload(admin, [hl.format(v="2.0"), bl]).json()
        assert b["summary"]["Unchanged"] == 2, b["summary"]
        b = upload(admin, [hl.format(v="2.5"), bl]).json()
        assert b["summary"]["Update"] == 1 and b["summary"]["Unchanged"] == 1
        assert requests.post(f"{API}/gp/admin/rates/batches/{b['id']}/publish", headers=H(admin)).json()["published"] == 1
        assert requests.post(f"{API}/gp/admin/rates/batches/{b['id']}/publish", headers=H(admin)).status_code == 409
        rs = [r for r in requests.get(f"{API}/gp/rates", headers=H(gp)).json()["rates"] if r["rate_code"].startswith(f"TEST_{k}")]
        tags = {(r["rate_code"], r["version"]): r["tag"] for r in rs}
        assert tags[(f"TEST_{k}_HL1", 2)] == "Current" and tags[(f"TEST_{k}_HL1", 1)] == "Previous version"
        assert tags[(f"TEST_{k}_BL1", 1)] == "Upcoming" and all(r["override"] for r in rs)


# ---- payout ledger ----
class TestLedger:
    def test_add_and_status(self, admin, gp):
        r = requests.post(f"{API}/gp/admin/payouts", headers=H(admin), json={"partner_code": S["code"], "product_code": "HL", "disbursement_date": "2026-11-01",
                                                                          "disbursed_amount": 100000, "deductions": 100, "referral_ref": "TEST_ref"})
        assert r.status_code == 200, r.text
        p = r.json()
        assert p["rate_code"].endswith("_HL1") and p["rate_version"] == 2 and p["gross"] == 2500 and p["net"] == 2400
        u = f"{API}/gp/admin/payouts/{p['id']}"
        assert requests.patch(u, headers=H(admin), json={"status": "On Hold"}).status_code == 400
        assert requests.patch(u, headers=H(admin), json={"status": "Reversed"}).status_code == 400
        assert requests.patch(u, headers=H(admin), json={"status": "Paid", "payment_date": "2026-11-10"}).status_code == 400
        assert requests.patch(u, headers=H(admin), json={"status": "Payable"}).status_code == 200
        d = requests.get(f"{API}/gp/payouts", headers=H(gp)).json()
        assert d["summary"]["payable"] == 2400 and d["summary"]["earned"] == 2400
        assert requests.patch(u, headers=H(admin), json={"status": "Paid", "payment_date": "2026-11-10", "txn_ref": "TEST_UTR1"}).status_code == 200
        d = requests.get(f"{API}/gp/payouts", headers=H(gp), params={"status": "Paid"}).json()
        assert d["summary"]["paid"] == 2400 and len(d["rows"]) == 1
        csv_ = requests.get(f"{API}/gp/payouts/statement.csv", headers=H(gp))
        assert csv_.status_code == 200 and "TEST_UTR1" in csv_.text

    def test_unknown_partner_and_no_rate(self, admin, gp):
        assert requests.post(f"{API}/gp/admin/payouts", headers=H(admin), json={"partner_code": "NOPE00000", "product_code": "HL", "disbursement_date": "2026-11-01", "disbursed_amount": 1}).status_code == 404
        r = requests.post(f"{API}/gp/admin/payouts", headers=H(admin), json={"partner_code": S["code"], "product_code": "CC", "disbursement_date": "2001-01-01", "disbursed_amount": 1})
        assert r.status_code == 400


# ---- agreement templates ----
class TestTemplates:
    def test_placeholder_blocked_and_publish_issue(self, admin, gp):
        t = requests.post(f"{API}/gp/admin/agreement-templates", headers=H(admin), json={"title": "TEST_ Agreement", "body": "Body [Approved wording required.]", "schedule": "S"}).json()
        assert t["status"] == "draft"
        assert requests.post(f"{API}/gp/admin/agreement-templates/{t['id']}/publish", headers=H(admin)).status_code == 400
        assert requests.post(f"{API}/gp/admin/agreement-templates/{t['id']}/issue", headers=H(admin), json={"partner_codes": [S["code"]]}).status_code == 400
        assert requests.get(f"{API}/gp/admin/setup-status", headers=H(admin)).json()["template_published"] is True


# ---- role guards ----
class TestGuards:
    def test_gp_cannot_admin(self, gp):
        for p in ("/gp/admin/partners", "/gp/admin/rates", "/gp/admin/payouts", "/gp/admin/setup-status"):
            assert requests.get(API + p, headers=H(gp)).status_code == 403, p

    def test_ops_cannot_admin(self):
        t = staff_login("ops@bankezee.com", "ops@bzc12")
        assert requests.get(f"{API}/gp/admin/partners", headers=H(t)).status_code == 403

    def test_doc_isolation(self, admin, gp):
        m = mob()
        o = requests.post(f"{API}/gp/signup", json={"reg_type": "individual", "mobile": m, "email": f"test_o_{m}@example.com", "name": "TEST_Other", "password": "Partner@123"}).json()["token"]
        requests.post(f"{API}/gp/me/kyc/pan", headers=H(o), files={"file": ("p.pdf", PDF, "application/pdf")}, data={"number": "ABCDE1234F"})
        ps = requests.get(f"{API}/gp/admin/partners", headers=H(admin), timeout=120).json()
        # doc_id not exposed in kyc_view? fall back to reading via raw API
        other = [p for p in ps if p["email"] == f"test_o_{m}@example.com"][0]
        did = other["kyc"]["pan"].get("doc_id")
        assert did
        assert requests.get(f"{API}/gp/docs/{did}", headers=H(gp)).status_code == 403
        assert requests.get(f"{API}/gp/docs/{did}", headers=H(o)).status_code == 200
        assert requests.get(f"{API}/gp/docs/{did}", headers=H(admin)).status_code == 200

    def test_bad_doc_id(self, gp):
        r = requests.get(f"{API}/gp/docs/not-an-id", headers=H(gp))
        assert r.status_code in (400, 404), f"invalid doc id returns {r.status_code}"


# ---- legacy partner ----
class TestLegacy:
    def test_pinky(self):
        r = requests.post(f"{API}/gp/login", json={"identifier": "pinkynagulapally@gmail.com", "password": "Pinky@1234"})
        if r.status_code != 200:
            tok = subprocess.check_output(["python", "/app/backend/tests/mint_token.py", "pinkynagulapally@gmail.com"]).decode().strip()
        else:
            tok = r.json()["token"]
        S["legacy_login_status"] = r.status_code
        d = me(tok)
        assert d["status"] == "Active" and d["legacy_partner"] is True
        d2 = requests.put(f"{API}/gp/me/profile", headers=H(tok), json={}).json()
        assert d2["status"] == "Active"
        assert r.status_code == 200, "legacy password login failed"
