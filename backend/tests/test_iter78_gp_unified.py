# Iteration 78: unified GP login (/login + /gp/login), Meta gating, GP file scoping, policy read-only,
# payouts summary, certificate png/pdf, change-password, non-active GP certificate, approve-as-active.
import os
import random
import uuid

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    for ln in open("/app/frontend/.env"):
        if ln.startswith("REACT_APP_BACKEND_URL="):
            BASE_URL = ln.split("=", 1)[1].strip().rstrip("/")
API = BASE_URL + "/api"
META = ("banothunithinnaik@gmail.com", "9398249851", "MetaGp@2026")
GP = ("8125832945", "Partner@123")
ADMIN = ("admin@bankezee.com", "ConnectSasha12!!")
CREATED = {"users": [], "policies": []}


def H(t):
    return {"Authorization": f"Bearer {t}"}


def staff_login(e, p):
    return requests.post(f"{API}/auth/login", json={"email": e, "password": p})


def gp_login(i, p):
    return requests.post(f"{API}/gp/login", json={"identifier": i, "password": p})


@pytest.fixture(scope="module")
def admin():
    r = staff_login(*ADMIN)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def gp():
    r = gp_login(*GP)
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="module", autouse=True)
def cleanup():
    yield
    t = staff_login(*ADMIN).json()["token"]
    for pid in CREATED["policies"]:
        requests.delete(f"{API}/files/policies/{pid}", headers=H(t))
        requests.delete(f"{API}/bank-policies/{pid}", headers=H(t))
    for uid in CREATED["users"]:
        requests.delete(f"{API}/gp/admin/partners/{uid}", headers=H(t))


# ---- unified login: Meta GP ----
class TestMetaGpLogin:
    def test_same_user_all_paths(self):
        a = staff_login(META[0], META[2])
        b = gp_login(META[1], META[2])
        c = gp_login(META[0], META[2])
        for r in (a, b, c):
            assert r.status_code == 200, r.text
        ids = {r.json()["user"]["id"] for r in (a, b, c)}
        assert len(ids) == 1, ids
        assert all(r.json()["user"].get("meta_access") for r in (a, b, c))
        # same file totals
        tots = set()
        for r in (a, b):
            f = requests.get(f"{API}/files?limit=5", headers=H(r.json()["token"]))
            assert f.status_code == 200
            tots.add(f.json()["pagination"]["total"])
        assert len(tots) == 1, tots
        m = requests.get(f"{API}/meta/me", headers=H(b.json()["token"]))
        assert m.status_code == 200, m.text


# ---- non-Meta GP blocked ----
class TestNonMetaGp:
    def test_meta_api_403(self, gp):
        assert not gp["user"].get("meta_access")
        for ep in ("meta/me", "meta/dashboard"):
            r = requests.get(f"{API}/{ep}", headers=H(gp["token"]))
            assert r.status_code == 403, (ep, r.status_code)


# ---- GP scope cannot be widened ----
class TestGpScope:
    def test_files_scope(self, gp, admin):
        t = gp["token"]
        base = requests.get(f"{API}/files?limit=200", headers=H(t)).json()
        other = requests.get(f"{API}/files?limit=200&gp_id=someoneelse&manager_id=x&tl_id=y", headers=H(t))
        assert other.status_code == 200
        od = other.json()
        print("own", base["pagination"]["total"], "with params", od["pagination"]["total"])
        assert od["pagination"]["total"] == base["pagination"]["total"]
        me = gp["user"]["id"]
        for f in od["files"]:
            assert me in (f.get("source_id"), f.get("assigned_to"), f.get("file_assigned_to")), f.get("file_id")
        s1 = requests.get(f"{API}/files/dashboard/stats", headers=H(t)).json()
        s2 = requests.get(f"{API}/files/dashboard/stats?gp_id=someoneelse&manager_id=x", headers=H(t)).json()
        print("stats", s1.get("total_files", s1.get("total")), s2.get("total_files", s2.get("total")))
        assert s1.get("total_files", s1.get("total")) == s2.get("total_files", s2.get("total"))


# ---- policies read-only for GP ----
class TestPolicies:
    def test_gp_403_admin_ok(self, gp, admin):
        t = gp["token"]
        body = {"bank_name": "TEST_Bank", "loan_type": "Personal Loan", "policy_name": "TEST_policy"}
        for base in ("files/policies", "bank-policies/policies"):
            assert requests.post(f"{API}/{base}", json=body, headers=H(t)).status_code == 403, base
            assert requests.put(f"{API}/{base}/xyz", json=body, headers=H(t)).status_code == 403, base
            assert requests.delete(f"{API}/{base}/xyz", headers=H(t)).status_code == 403, base
        assert requests.get(f"{API}/files/policies", headers=H(t)).status_code == 200
        r = requests.post(f"{API}/files/policies", json=body, headers=H(admin))
        assert r.status_code in (200, 201), r.text
        pid = r.json()["id"]
        CREATED["policies"].append(pid)
        u = requests.put(f"{API}/files/policies/{pid}", json={"policy_name": "TEST_policy2"}, headers=H(admin))
        assert u.status_code == 200, u.text
        d = requests.delete(f"{API}/files/policies/{pid}", headers=H(admin))
        assert d.status_code in (200, 204), d.text


# ---- payouts summary / certificate ----
class TestPayoutCert:
    def test_payout_summary(self, gp):
        r = requests.get(f"{API}/gp/payouts", headers=H(gp["token"]))
        assert r.status_code == 200
        s = r.json()["summary"]
        assert abs(s["earned"] - (s["under_verification"] + s["payable"] + s["paid"])) < 0.01
        print("summary", s)

    def test_certificate(self, gp):
        p = requests.get(f"{API}/gp/certificate.png", headers=H(gp["token"]))
        assert p.status_code == 200 and p.content[:4] == b"\x89PNG"
        d = requests.get(f"{API}/gp/certificate.pdf", headers=H(gp["token"]))
        assert d.status_code == 200 and d.content[:4] == b"%PDF"
        import pymupdf
        doc = pymupdf.open(stream=d.content, filetype="pdf")
        r = doc[0].rect
        assert round(r.width) == 842 and round(r.height) == 595


# ---- change password ----
class TestChangePassword:
    def test_change_and_back(self, gp):
        t = gp["token"]
        new = "TmpPass@9876"
        assert requests.post(f"{API}/auth/change-password", json={"current_password": "wrong", "new_password": new}, headers=H(t)).status_code == 400
        r = requests.post(f"{API}/auth/change-password", json={"current_password": GP[1], "new_password": new}, headers=H(t))
        assert r.status_code == 200, r.text
        try:
            assert gp_login(GP[0], new).status_code == 200
            assert gp_login(GP[0], GP[1]).status_code == 401
        finally:
            r2 = requests.post(f"{API}/auth/change-password", json={"current_password": new, "new_password": GP[1]}, headers=H(t))
            assert r2.status_code == 200
        assert gp_login(GP[0], GP[1]).status_code == 200


# ---- fresh GP: not-active cert, approve-as-active, file source ----
class TestFreshGp:
    def test_signup_cert_approve(self, admin):
        mob = "9" + "".join(random.choice("0123456789") for _ in range(9))
        email = f"test_iter78_{uuid.uuid4().hex[:6]}@example.com"
        r = requests.post(f"{API}/gp/signup", json={"mobile": mob, "email": email, "name": "TEST_Iter78 GP", "password": "TestPass@123"})
        assert r.status_code == 200, r.text
        t, uid = r.json()["token"], r.json()["user"]["id"]
        CREATED["users"].append(uid)
        assert requests.get(f"{API}/gp/certificate.png", headers=H(t)).status_code == 403
        me = requests.get(f"{API}/gp/me", headers=H(t)).json()
        assert me["status"] != "Active"
        # reason required
        assert requests.post(f"{API}/gp/admin/partners/{uid}/approve", json={"reason": " "}, headers=H(admin)).status_code == 400
        a = requests.post(f"{API}/gp/admin/partners/{uid}/approve", json={"reason": "TEST approve"}, headers=H(admin))
        assert a.status_code == 200
        assert requests.get(f"{API}/gp/me", headers=H(t)).json()["status"] == "Active"
        assert requests.get(f"{API}/gp/certificate.pdf", headers=H(t)).status_code == 200
        # GP adds a file from /agent/files -> file_source growth_partner
        f = requests.post(f"{API}/files/gp-submit", json={}, headers=H(t))
        print("gp-submit probe", f.status_code)
        # delete with no files works
        d = requests.delete(f"{API}/gp/admin/partners/{uid}", headers=H(admin))
        assert d.status_code == 200, d.text
        CREATED["users"].remove(uid)
