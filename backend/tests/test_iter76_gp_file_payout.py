# Iteration 76 (T1): GP payout on a disbursed File — auto CSV calc, idempotency, manual required,
# admin/ops overrides + restore, disbursed-amount change, frozen rate vs later CSV, Paid lock + adjustment,
# partner-facing projection, role guards.
import io
import os
import random
import time
import uuid

import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    for ln in open("/app/frontend/.env"):
        if ln.startswith("REACT_APP_BACKEND_URL="):
            BASE_URL = ln.split("=", 1)[1].strip().rstrip("/")
API = BASE_URL + "/api"
ENV = dict(ln.strip().split("=", 1) for ln in open("/app/backend/.env") if "=" in ln)
DB = MongoClient(ENV["MONGO_URL"].strip('"'))[ENV["DB_NAME"].strip('"')]
S = {"files": [], "users": [], "rates": [], "batches": []}
CTX = {}


def H(t):
    return {"Authorization": f"Bearer {t}"}


def mob():
    return "9" + "".join(random.choice("0123456789") for _ in range(9))


def login(email, pw):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": pw})
    assert r.status_code == 200, r.text
    return r.json().get("token") or r.json().get("access_token")


@pytest.fixture(scope="module", autouse=True)
def cleanup():
    yield
    for fid in S["files"]:
        DB.leads.delete_one({"id": fid})
        DB.gp_payouts.delete_many({"file_id": fid})
    for u in S["users"]:
        DB.users.delete_one({"id": u})
    for rc in S["rates"]:
        DB.gp_rates.delete_many({"rate_code": rc})
    for b in S["batches"]:
        DB.gp_rate_batches.delete_one({"id": b})


@pytest.fixture(scope="module")
def admin():
    return login("admin@bankezee.com", "ConnectSasha12!!")


@pytest.fixture(scope="module")
def ops():
    return login("ops@bankezee.com", "ops@bzc12")


@pytest.fixture(scope="module")
def manager():
    return login("teja@bankezee.com", "tejasme12")


@pytest.fixture(scope="module")
def gp():
    m = mob()
    r = requests.post(f"{API}/gp/signup", json={"reg_type": "individual", "mobile": m, "email": f"test_gpp_{m}@example.com", "name": "TEST_GP Payout", "password": "Partner@123"})
    assert r.status_code == 200, r.text
    t = r.json()["token"]
    me = requests.get(f"{API}/gp/me", headers=H(t)).json()
    S["users"].append(me["user_id"])
    CTX["code"] = DB.users.find_one({"id": me["user_id"]})["partner_code"]
    return t


def new_file(gp, loan="new_personal_loan"):
    r = requests.post(f"{API}/gp/files", headers=H(gp), json={"name": f"TEST_PAY {uuid.uuid4().hex[:5]}", "mobile": mob(), "loan_type": loan,
                                                              "employment_type": "salaried", "consent": True})
    assert r.status_code == 200, r.text
    S["files"].append(r.json()["file_id"])
    return r.json()["file_id"]


def disburse(tok, fid, amt, bank="HDFC"):
    r = requests.put(f"{API}/files/{fid}/eligibilities", headers=H(tok),
                     json={"eligibilities": [{"bank_name": bank, "disbursed": "yes", "disbursed_amount": amt, "disbursed_bank": bank}]})
    assert r.status_code == 200, r.text
    time.sleep(1.5)


def view(tok, fid):
    r = requests.get(f"{API}/gp/file-payout/{fid}", headers=H(tok))
    assert r.status_code == 200, r.text
    return r.json()


class TestAuto:
    def test_auto_csv_payout(self, admin, gp):
        fid = new_file(gp)
        CTX["fid"] = fid
        disburse(admin, fid, 500000)
        v = view(admin, fid)
        assert v["calculation"]["rate_code"] == "PL_STD" and v["calculation"]["payout_value"] == 1.25
        assert v["calculation"]["gross"] == 6250
        assert v["payout"]["status"] == "Under Verification" and v["payout"]["source"] == "csv" and v["payout"]["gross"] == 6250

    def test_single_record(self, admin, gp):
        fid = CTX["fid"]
        disburse(admin, fid, 500000)
        requests.put(f"{API}/files/{fid}/file-status", headers=H(admin), json={"file_status": "sent_for_login"})
        time.sleep(1.5)
        view(admin, fid)
        assert DB.gp_payouts.count_documents({"file_key": fid}) == 1
        assert DB.gp_payouts.count_documents({"file_id": fid, "kind": "payout"}) == 1

    def test_later_csv_does_not_change_saved(self, admin, gp):
        code, rc = CTX["code"], f"TEST_{uuid.uuid4().hex[:6].upper()}"
        S["rates"].append(rc)
        csv = ("rate_code,product_code,lender_code,payout_type,payout_value,slab_min_inr,slab_max_inr,qualifying_event,effective_from,effective_to,partner_code,partner_visible_terms\n"
               f"{rc},PL,,percent,3,0,,disbursement,2025-01-01,,{code},TEST\n")
        r = requests.post(f"{API}/gp/admin/rates/preview", headers=H(admin), files={"file": ("t.csv", io.BytesIO(csv.encode()), "text/csv")})
        assert r.status_code == 200, r.text
        S["batches"].append(r.json()["id"])
        assert r.json()["summary"]["Error"] == 0, r.json()["rows"]
        p = requests.post(f"{API}/gp/admin/rates/batches/{r.json()['id']}/publish", headers=H(admin))
        assert p.status_code == 200, p.text
        v = view(admin, CTX["fid"])
        assert v["payout"]["gross"] == 6250 and v["payout"]["rate_code"] == "PL_STD"
        # auto payout recalculates with the frozen version on disbursed change
        disburse(admin, CTX["fid"], 400000)
        v = view(admin, CTX["fid"])
        assert v["payout"]["gross"] == 5000, v["payout"]
        assert v["payout"]["rate_code"] == "PL_STD"
        # a brand-new file of this partner now uses the new partner rate
        f2 = new_file(gp)
        disburse(admin, f2, 100000)
        v2 = view(admin, f2)
        assert v2["payout"]["rate_code"] == rc and v2["payout"]["gross"] == 3000


class TestManual:
    def test_manual_required_gold(self, admin, gp):
        fid = new_file(gp, "gold_loan")
        CTX["gold"] = fid
        disburse(admin, fid, 200000)
        v = view(admin, fid)
        assert v["manual_required"] is True and v["payout"] is None
        r = requests.put(f"{API}/gp/file-payout/{fid}/manual", headers=H(admin), json={"mode": "amount", "value": 3000, "reason": "TEST gold"})
        assert r.status_code == 200, r.text
        assert r.json()["payout"]["source"] == "manual" and r.json()["payout"]["gross"] == 3000 and r.json()["manual_required"] is False
        assert r.json()["payout"]["status"] == "Under Verification"

    def test_manual_validation(self, admin):
        fid = CTX["gold"]
        assert requests.put(f"{API}/gp/file-payout/{fid}/manual", headers=H(admin), json={"mode": "amount", "value": 3000, "reason": "  "}).status_code == 400
        assert requests.put(f"{API}/gp/file-payout/{fid}/manual", headers=H(admin), json={"mode": "percent", "value": 15, "reason": "x"}).status_code == 400
        # restore impossible with no CSV rate
        assert requests.post(f"{API}/gp/file-payout/{fid}/restore", headers=H(admin), json={}).status_code == 400

    def test_ops_override_percent_and_restore(self, ops, admin):
        fid = CTX["fid"]
        r = requests.put(f"{API}/gp/file-payout/{fid}/manual", headers=H(ops), json={"mode": "percent", "value": 1.5, "reason": "TEST ops pct"})
        assert r.status_code == 200, r.text
        assert r.json()["payout"]["gross"] == 6000 and r.json()["payout"]["source"] == "manual"
        r = requests.put(f"{API}/gp/file-payout/{fid}/manual", headers=H(admin), json={"mode": "amount", "value": 7000, "reason": "TEST admin amt"})
        assert r.status_code == 200 and r.json()["payout"]["gross"] == 7000
        acts = [a for a in DB.leads.find_one({"id": fid})["file_activities"] if a.get("type") == "gp_payout"]
        last = acts[-1]
        assert last["previous"] == 6000 and last["new"] == 7000 and last["reason"] == "TEST admin amt" and last["by_name"]
        # disbursed change -> review flag, amount kept
        disburse(admin, fid, 450000)
        v = view(admin, fid)
        assert v["payout"]["needs_review"] is True and v["payout"]["gross"] == 7000 and v["payout"]["review_note"]
        r = requests.post(f"{API}/gp/file-payout/{fid}/restore", headers=H(ops), json={"reason": "TEST restore"})
        assert r.status_code == 200, r.text
        assert r.json()["payout"]["source"] == "csv" and r.json()["payout"]["gross"] == 5625 and r.json()["payout"]["rate_code"] == "PL_STD"


class TestLockAndPartnerView:
    def test_paid_lock_and_adjustment(self, admin, gp):
        fid = CTX["fid"]
        pid = view(admin, fid)["payout"]["id"]
        assert requests.patch(f"{API}/gp/admin/payouts/{pid}", headers=H(admin), json={"status": "Payable"}).status_code == 200
        assert requests.patch(f"{API}/gp/admin/payouts/{pid}", headers=H(admin), json={"status": "Paid"}).status_code == 400
        r = requests.patch(f"{API}/gp/admin/payouts/{pid}", headers=H(admin), json={"status": "Paid", "payment_date": "2026-01-10", "txn_ref": "TESTUTR1"})
        assert r.status_code == 200
        v = view(admin, fid)
        assert v["locked"] is True
        assert requests.patch(f"{API}/gp/admin/payouts/{pid}", headers=H(admin), json={"status": "Payable"}).status_code == 409
        assert requests.put(f"{API}/gp/file-payout/{fid}/manual", headers=H(admin), json={"mode": "amount", "value": 1, "reason": "x"}).status_code == 409
        assert requests.post(f"{API}/gp/file-payout/{fid}/restore", headers=H(admin), json={}).status_code in (400, 409)
        # disbursed change after paid does not change amount
        disburse(admin, fid, 460000)
        v = view(admin, fid)
        assert v["payout"]["gross"] == 5625 and v["payout"]["status"] == "Paid"
        r = requests.post(f"{API}/gp/file-payout/{fid}/adjustment", headers=H(admin), json={"amount": 125, "reason": "TEST adj internal"})
        assert r.status_code == 200, r.text
        assert len(r.json()["adjustments"]) == 1 and r.json()["adjustments"][0]["gross"] == 125
        assert DB.gp_payouts.count_documents({"file_key": fid}) == 1

    def test_partner_projection(self, gp):
        rows = [x for x in requests.get(f"{API}/gp/payouts", headers=H(gp)).json()["rows"] if x.get("file_id") == CTX["fid"]]
        main = [x for x in rows if x.get("kind") == "payout"][0]
        assert main["gross"] == 5625 and main["status"] == "Paid"
        for k in ("audit", "manual", "internal_reason", "review_note", "needs_review", "calc"):
            assert all(k not in x for x in rows), k
        st = requests.get(f"{API}/gp/payouts/statement.csv", headers=H(gp)).text
        assert "TEST adj internal" not in st and "TEST admin amt" not in st and "5625" in st
        gold = [x for x in requests.get(f"{API}/gp/payouts", headers=H(gp)).json()["rows"] if x.get("file_id") == CTX["gold"]]
        assert gold and gold[0]["gross"] == 3000 and "TEST gold" not in str(gold)


class TestRoleGuard:
    def test_manager_gp_forbidden(self, manager, gp):
        fid = CTX["fid"]
        for t in (manager, gp):
            assert requests.get(f"{API}/gp/file-payout/{fid}", headers=H(t)).status_code == 403
            assert requests.put(f"{API}/gp/file-payout/{fid}/manual", headers=H(t), json={"mode": "amount", "value": 1, "reason": "x"}).status_code == 403
            assert requests.post(f"{API}/gp/file-payout/{fid}/restore", headers=H(t), json={}).status_code == 403
            assert requests.post(f"{API}/gp/file-payout/{fid}/adjustment", headers=H(t), json={"amount": 1, "reason": "x"}).status_code == 403
