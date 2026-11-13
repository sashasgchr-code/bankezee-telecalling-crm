# Iteration 76: Growth Partner submissions become real Connect CRM Files (/api/gp/files),
# validation, idempotency, staff filters (file_source / queue), status sync, reassignment,
# isolation, public application link + upload token, payouts file attribution, doc extraction.
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
FIX = "/app/backend/tests/fixtures"
OPS_ID = "d4dad061-7403-4e38-bb06-b3cdf277237b"
PARTNER_CODE = "TEST9B4002D6"
S = {"files": [], "users": [], "subs": [], "payouts": []}


def _env():
    e = {}
    for ln in open("/app/backend/.env"):
        if "=" in ln:
            k, v = ln.strip().split("=", 1)
            e[k] = v.strip('"')
    return e


ENV = _env()
DB = MongoClient(ENV["MONGO_URL"])[ENV["DB_NAME"]]


def H(t):
    return {"Authorization": f"Bearer {t}"}


def mob():
    return "9" + "".join(random.choice("0123456789") for _ in range(9))


def body(**kw):
    b = {"name": f"TEST_GPF {uuid.uuid4().hex[:6]}", "mobile": mob(), "loan_type": "new_personal_loan", "employment_type": "salaried", "consent": True}
    b.update(kw)
    return b


@pytest.fixture(scope="module", autouse=True)
def cleanup():
    yield
    for fid in S["files"]:
        DB.leads.delete_one({"id": fid})
        DB.doc_extractions.delete_many({"ref_id": fid}) if "doc_extractions" in DB.list_collection_names() else None
    for sid in S["subs"]:
        DB.gp_submissions.delete_one({"_id": sid})
    for u in S["users"]:
        DB.users.delete_one({"id": u})
    for p in S["payouts"]:
        DB.gp_payouts.delete_one({"id": p})


@pytest.fixture(scope="module")
def admin():
    r = requests.post(f"{API}/auth/login", json={"email": "admin@bankezee.com", "password": "ConnectSasha12!!"})
    assert r.status_code == 200
    return r.json().get("token") or r.json().get("access_token")


@pytest.fixture(scope="module")
def gp():
    r = requests.post(f"{API}/gp/login", json={"identifier": "8125832945", "password": "Partner@123"})
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def gp_b():
    m = mob()
    r = requests.post(f"{API}/gp/signup", json={"reg_type": "business", "mobile": m, "email": f"test_gpb_{m}@example.com", "name": "TEST_GP B", "password": "Partner@123"})
    assert r.status_code == 200, r.text
    me = requests.get(f"{API}/gp/me", headers=H(r.json()["token"])).json()
    S["users"].append(me["user_id"])
    assert me["profile"]["reg_type"] == "individual"
    return r.json()["token"]


def create(t, **kw):
    r = requests.post(f"{API}/gp/files", headers=H(t), json=body(**kw))
    assert r.status_code == 200, r.text
    d = r.json()
    S["files"].append(d["file_id"])
    if kw.get("submission_id"):
        S["subs"].append(kw["submission_id"])
    return d


class TestFormAndValidation:
    def test_form_config(self):
        d = requests.get(f"{API}/gp/files/form-config").json()
        assert any(t["value"] == "new_personal_loan" for t in d["loan_types"])
        assert {e["value"] for e in d["employment_types"]} == {"salaried", "self_employed"}
        assert [x["category"] for x in d["documents"]["salaried"]] == ["payslip", "cibil_report", "bank_statement", "pan", "aadhaar"]
        assert "itr" in [x["category"] for x in d["documents"]["self_employed"]]

    @pytest.mark.parametrize("override", [{"loan_type": "Personal Loan"}, {"employment_type": "business"}, {"consent": False},
                                          {"cibil_score": 250}, {"cibil_score": 950}, {"mobile": "12345"}])
    def test_validation_400(self, gp, override):
        r = requests.post(f"{API}/gp/files", headers=H(gp), json=body(**override))
        assert r.status_code == 400, f"{override}: {r.status_code} {r.text}"


class TestCreateAndSync:
    def test_create_minimal(self, gp, admin):
        d = create(gp)
        assert d["status"]["label"] == "New" and d["duplicate"] is False
        S["fid"] = fid = d["file_id"]
        f = requests.get(f"{API}/files/{fid}", headers=H(admin)).json()
        assert f["status"] == "file" and f["file_source"] == "growth_partner"
        assert f["gp_referral"]["partner_code"] == PARTNER_CODE and f["gp_referral"]["consent_by"] == "partner"
        S["name"] = f["name"]
        rows = requests.get(f"{API}/gp/files", headers=H(gp)).json()["rows"]
        assert any(r["id"] == fid for r in rows)

    def test_staff_filters(self, admin):
        r = requests.get(f"{API}/files", headers=H(admin), params={"file_source": "growth_partner", "search": S["name"]}).json()
        assert any(f["id"] == S["fid"] for f in r["files"])
        assert all(f.get("file_source") == "growth_partner" for f in requests.get(f"{API}/files", headers=H(admin), params={"file_source": "growth_partner", "limit": 50}).json()["files"])
        st_all = requests.get(f"{API}/files/dashboard/stats", headers=H(admin)).json()["total_files"]
        st_gp = requests.get(f"{API}/files/dashboard/stats", headers=H(admin), params={"file_source": "growth_partner"}).json()["total_files"]
        assert 0 < st_gp < st_all
        un = requests.get(f"{API}/files", headers=H(admin), params={"queue": "unassigned", "limit": 50}).json()["files"]
        # unassigned = no staff owner (empty or still owned by the submitting partner/source)
        assert all(not f.get("file_assigned_to") or f.get("file_assigned_to") == f.get("source_id") for f in un)
        ex = requests.get(f"{API}/files/export/dashboard", headers=H(admin), params={"file_source": "growth_partner"})
        assert ex.status_code == 200

    def test_status_sync(self, gp, admin):
        r = requests.put(f"{API}/files/{S['fid']}/file-status", headers=H(admin), json={"file_status": "sent_for_login"})
        assert r.status_code == 200, r.text
        requests.post(f"{API}/files/{S['fid']}/notes", headers=H(admin), json={"note": "TEST_INTERNAL_SECRET_NOTE"})
        d = requests.get(f"{API}/gp/files/{S['fid']}", headers=H(gp))
        assert d.status_code == 200
        d = d.json()
        assert d["status"]["label"] == "Sent for Login"
        assert any(h["label"] == "Sent for Login" for h in d["history"])
        assert "TEST_INTERNAL_SECRET_NOTE" not in str(d)
        lst = requests.get(f"{API}/gp/files", headers=H(gp)).json()
        assert next(r for r in lst["rows"] if r["id"] == S["fid"])["status"]["label"] == "Sent for Login"
        assert any(c["label"] == "Sent for Login" for c in lst["counts"])

    def test_reassign_keeps_partner(self, gp, admin):
        r = requests.put(f"{API}/files/{S['fid']}/assign", headers=H(admin), json={"assigned_to": OPS_ID})
        assert r.status_code == 200, r.text
        f = requests.get(f"{API}/files/{S['fid']}", headers=H(admin)).json()
        assert f["file_assigned_to"] == OPS_ID and f["gp_referral"]["partner_code"] == PARTNER_CODE
        assert any(r["id"] == S["fid"] for r in requests.get(f"{API}/gp/files", headers=H(gp)).json()["rows"])


class TestIdempotency:
    def test_submission_id_and_mobile(self, gp):
        sid = f"TEST_sub_{uuid.uuid4().hex}"
        m = mob()
        a = create(gp, submission_id=sid, mobile=m)
        r = requests.post(f"{API}/gp/files", headers=H(gp), json=body(submission_id=sid, mobile=m))
        assert r.status_code == 200 and r.json()["file_id"] == a["file_id"] and r.json()["duplicate"] is True
        sid2 = f"TEST_sub_{uuid.uuid4().hex}"
        S["subs"].append(sid2)
        r2 = requests.post(f"{API}/gp/files", headers=H(gp), json=body(submission_id=sid2, mobile=m))
        assert r2.json()["file_id"] == a["file_id"] and r2.json()["duplicate"] is True
        assert DB.leads.count_documents({"phone": {"$regex": f"{m}$"}}) == 1

    def test_submission_id_cross_partner(self, gp, gp_b):
        # another partner re-using a submission_id must not receive partner A's file id
        sid = f"TEST_sub_{uuid.uuid4().hex}"
        a = create(gp, submission_id=sid)
        r = requests.post(f"{API}/gp/files", headers=H(gp_b), json=body(submission_id=sid))
        if r.status_code == 200 and not r.json()["duplicate"]:
            S["files"].append(r.json()["file_id"])
        assert not (r.status_code == 200 and r.json()["file_id"] == a["file_id"]), "cross-partner submission_id leaks other partner's file"


class TestIsolation:
    def test_partner_b_cannot_access(self, gp_b):
        assert requests.get(f"{API}/gp/files/{S['fid']}", headers=H(gp_b)).status_code == 404
        r = requests.post(f"{API}/gp/files/{S['fid']}/documents", headers=H(gp_b), params={"category": "pan"},
                          files={"files": ("x.pdf", open(f"{FIX}/sample_payslip.pdf", "rb"), "application/pdf")})
        assert r.status_code == 404
        assert all(r["id"] != S["fid"] for r in requests.get(f"{API}/gp/files", headers=H(gp_b)).json()["rows"])

    def test_unknown_category(self, gp):
        r = requests.post(f"{API}/gp/files/{S['fid']}/documents", headers=H(gp), params={"category": "bogus"},
                          files={"files": ("x.pdf", open(f"{FIX}/sample_payslip.pdf", "rb"), "application/pdf")})
        assert r.status_code == 400


class TestPublicLink:
    def test_public_refer_and_token(self, gp, admin):
        r = requests.post(f"{API}/gp/public/refer/{PARTNER_CODE}", json=body(employment_type="self_employed"))
        assert r.status_code == 200, r.text
        d = r.json()
        S["files"].append(d["file_id"])
        assert d["upload_token"]
        f = requests.get(f"{API}/files/{d['file_id']}", headers=H(admin)).json()
        assert f["gp_referral"]["channel"] == "Application link" and f["gp_referral"]["consent_by"] == "customer"
        assert any(x["id"] == d["file_id"] and x["via"] == "Application link" for x in requests.get(f"{API}/gp/files", headers=H(gp)).json()["rows"])
        up = lambda tok: requests.post(f"{API}/gp/public/files/{d['file_id']}/documents", params={"token": tok, "category": "itr"},
                                       files={"files": ("itr.pdf", open(f"{FIX}/sample_payslip.pdf", "rb"), "application/pdf")})
        assert up("wrongtoken").status_code == 403
        ok = up(d["upload_token"])
        assert ok.status_code == 200, ok.text
        det = requests.get(f"{API}/gp/files/{d['file_id']}", headers=H(gp)).json()
        assert any(c["category"] == "itr" and c["uploaded"] for c in det["checklist"])
        DB.leads.update_one({"id": d["file_id"]}, {"$set": {"gp_referral.upload_token_exp": "2000-01-01T00:00:00+00:00"}})
        assert up(d["upload_token"]).status_code == 403
        assert requests.post(f"{API}/gp/public/refer/NOPE000000", json=body()).status_code == 404


class TestPayouts:
    def test_ledger_file_attribution(self, admin, gp_b):
        base = {"partner_code": PARTNER_CODE, "product_code": "PL", "disbursement_date": "2026-01-05", "disbursed_amount": 100000}
        foreign = create(gp_b)["file_id"]
        r = requests.post(f"{API}/gp/admin/payouts", headers=H(admin), json=base | {"file_id": foreign})
        assert r.status_code == 400, r.text
        r = requests.post(f"{API}/gp/admin/payouts", headers=H(admin), json=base | {"file_id": S["fid"]})
        assert r.status_code == 200, r.text
        pid = r.json().get("id") or (r.json().get("payout") or {}).get("id")
        S["payouts"].append(pid)
        DB.gp_payouts.delete_many({"file_id": S["fid"]})


class TestExtraction:
    def test_docs_extracted(self, gp, admin):
        d = create(gp, name=f"TEST_GPF Extract {uuid.uuid4().hex[:4]}")
        fid = d["file_id"]
        for cat, fn in (("payslip", "sample_payslip.pdf"), ("cibil_report", "sample_cibil.pdf")):
            r = requests.post(f"{API}/gp/files/{fid}/documents", headers=H(gp), params={"category": cat},
                              files={"files": (fn, open(f"{FIX}/{fn}", "rb"), "application/pdf")})
            assert r.status_code == 200, r.text
        st = None
        for _ in range(30):
            time.sleep(4)
            st = requests.get(f"{API}/doc-extract/connect/{fid}", headers=H(admin)).json()
            if not st.get("processing") and len(st.get("documents") or []) >= 2:
                break
        print("EXTRACT STATE", {k: st.get(k) for k in ("processing",)}, [(x.get("doc_type"), x.get("status")) for x in st.get("documents") or []])
        assert len(st.get("documents") or []) >= 2
        fd = requests.get(f"{API}/files/{fid}", headers=H(admin)).json().get("file_details") or {}
        print("FD", {k: fd.get(k) for k in ("company_name", "net_salary", "cibil_score", "existing_loans")})
        assert fd.get("company_name") and fd.get("net_salary")
        assert fd.get("cibil_score")
