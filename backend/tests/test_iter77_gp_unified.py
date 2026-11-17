# Iteration 77 (T1): GP unified login/dashboard round 1 — dual login paths, mobile-login ambiguity (409),
# meta gating, files scope enforcement, policy read-only for GP, change-password, certificate, admin partner
# management (edit/password/view/active/delete/approve) and background creatives upload.
import os
import random
import time
import uuid

import pytest
import requests
from bson import ObjectId
from pymongo import MongoClient
from passlib.context import CryptContext

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    for ln in open("/app/frontend/.env"):
        if ln.startswith("REACT_APP_BACKEND_URL="):
            BASE_URL = ln.split("=", 1)[1].strip().rstrip("/")
API = BASE_URL + "/api"
ENV = dict(ln.strip().split("=", 1) for ln in open("/app/backend/.env") if "=" in ln)
DB = MongoClient(ENV["MONGO_URL"].strip('"'))[ENV["DB_NAME"].strip('"')]
PWD = CryptContext(schemes=["bcrypt"], deprecated="auto")
S = {"users": [], "policies": [], "creatives": [], "review_mobiles": []}

META_MOB, META_EMAIL, META_PW = "9398249851", "banothunithinnaik@gmail.com", "MetaGp@2026"
NM_MOB, NM_EMAIL, NM_PW = "8125832945", "test_ui_8125832945@example.com", "Partner@123"


def H(t):
    return {"Authorization": f"Bearer {t}"}


def mob():
    return "7" + "".join(random.choice("0123456789") for _ in range(9))


def tok(r):
    j = r.json()
    return j.get("token") or j.get("access_token")


def login(email, pw):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": pw})
    assert r.status_code == 200, r.text
    return tok(r)


def gp_login(ident, pw):
    return requests.post(f"{API}/gp/login", json={"identifier": ident, "password": pw})


@pytest.fixture(scope="module", autouse=True)
def cleanup():
    yield
    for u in S["users"]:
        DB.users.delete_one({"id": u})
        DB.gp_agreements.delete_many({"partner_id": u})
    for p in S["policies"]:
        DB.bank_policies.delete_one({"id": p})
    for c in S["creatives"]:
        DB.gp_creatives.delete_one({"id": c})
    for m in S["review_mobiles"]:
        DB.gp_login_review.delete_one({"mobile": m})
        DB.gp_login_failures.delete_many({"key": m})


@pytest.fixture(scope="module")
def admin():
    return login("admin@bankezee.com", "ConnectSasha12!!")


@pytest.fixture(scope="module")
def meta_gp():
    r = gp_login(META_MOB, META_PW)
    assert r.status_code == 200, r.text
    return tok(r)


@pytest.fixture(scope="module")
def nm_gp():
    r = gp_login(NM_MOB, NM_PW)
    assert r.status_code == 200, r.text
    return tok(r)


def signup_test_gp():
    m = mob()
    r = requests.post(f"{API}/gp/signup", json={"mobile": m, "email": f"test_iter77_{m}@example.com", "name": f"TEST Iter77 {m}", "password": "TestPass@123"})
    assert r.status_code == 200, r.text
    uid = r.json()["user"]["id"]
    S["users"].append(uid)
    return uid, m, tok(r)


# ---- (1) one account for both login paths ----
class TestDualLogin:
    def test_meta_gp_same_user_both_paths(self):
        a = gp_login(META_MOB, META_PW)
        b = requests.post(f"{API}/auth/login", json={"email": META_EMAIL, "password": META_PW})
        assert a.status_code == 200 and b.status_code == 200
        assert a.json()["user"]["id"] == b.json()["user"]["id"]
        assert a.json()["user"].get("meta_access") is True
        fa = requests.get(f"{API}/files", headers=H(tok(a))).json()["pagination"]["total"]
        fb = requests.get(f"{API}/files", headers=H(tok(b))).json()["pagination"]["total"]
        assert fa == fb

    def test_nonmeta_gp_same_user_both_paths(self):
        a = gp_login(NM_MOB, NM_PW)
        b = requests.post(f"{API}/auth/login", json={"email": NM_EMAIL, "password": NM_PW})
        assert a.status_code == 200 and b.status_code == 200
        assert a.json()["user"]["id"] == b.json()["user"]["id"]

    def test_wrong_password_401(self):
        r = gp_login("7000000001", "nope-nope")
        assert r.status_code == 401

    def test_ambiguous_mobile_409_and_flagged(self):
        m = mob()
        S["review_mobiles"].append(m)
        h = PWD.hash("TestPass@123")
        for i in range(2):
            oid = ObjectId()
            DB.users.insert_one({"_id": oid, "id": str(oid), "email": f"test_iter77_dup{i}_{m}@example.com", "password": h, "password_hash": h,
                                 "name": f"TEST dup {i}", "phone": m, "role": "growth_partner", "is_active": True})
            S["users"].append(str(oid))
        r = gp_login(m, "TestPass@123")
        assert r.status_code == 409, r.text
        assert DB.gp_login_review.find_one({"mobile": m}) is not None

    def test_active_preferred_over_dormant_duplicate(self):
        m = mob()
        S["review_mobiles"].append(m)
        h = PWD.hash("TestPass@123")
        ids = []
        for i, active in enumerate((False, True)):
            oid = ObjectId()
            DB.users.insert_one({"_id": oid, "id": str(oid), "email": f"test_iter77_dorm{i}_{m}@example.com", "password": h, "password_hash": h,
                                 "name": f"TEST dorm {i}", "phone": m, "role": "growth_partner", "is_active": active})
            S["users"].append(str(oid))
            ids.append(str(oid))
        r = gp_login(m, "TestPass@123")
        assert r.status_code == 200, r.text
        assert r.json()["user"]["id"] == ids[1]


# ---- meta gating ----
class TestMetaGate:
    def test_meta_gp_can_access_meta(self, meta_gp):
        assert requests.get(f"{API}/meta/me", headers=H(meta_gp)).status_code == 200

    def test_nonmeta_gp_denied(self, nm_gp):
        assert requests.get(f"{API}/meta/me", headers=H(nm_gp)).status_code == 403
        assert requests.get(f"{API}/meta/leads", headers=H(nm_gp)).status_code == 403


# ---- (2) files scope ----
class TestFilesScope:
    def test_gp_cannot_widen_scope(self, nm_gp, meta_gp):
        me = requests.get(f"{API}/auth/me", headers=H(nm_gp)).json()["id"]
        other = requests.get(f"{API}/auth/me", headers=H(meta_gp)).json()["id"]
        r = requests.get(f"{API}/files", headers=H(nm_gp), params={"gp_id": other, "manager_id": "x", "tl_id": "y", "limit": 200})
        assert r.status_code == 200
        for f in r.json()["files"]:
            assert me in (f.get("source_id"), f.get("assigned_to"), f.get("file_assigned_to"))


# ---- (3) policies read-only for GP ----
class TestPolicies:
    def test_gp_policy_writes_forbidden(self, nm_gp, admin):
        r = requests.post(f"{API}/files/policies", headers=H(admin), json={"bank_name": "TEST_Iter77 Bank", "is_active": False})
        assert r.status_code == 200, r.text
        pid = r.json()["id"]
        S["policies"].append(pid)
        assert requests.post(f"{API}/files/policies", headers=H(nm_gp), json={"bank_name": "TEST_gp"}).status_code == 403
        assert requests.put(f"{API}/files/policies/{pid}", headers=H(nm_gp), json={"bank_name": "TEST_hack"}).status_code == 403
        assert requests.delete(f"{API}/files/policies/{pid}", headers=H(nm_gp)).status_code == 403
        assert requests.get(f"{API}/files/policies", headers=H(nm_gp)).status_code == 200

    def test_admin_can_edit_and_delete(self, admin):
        r = requests.post(f"{API}/files/policies", headers=H(admin), json={"bank_name": "TEST_Iter77 Bank2", "is_active": False})
        pid = r.json()["id"]
        S["policies"].append(pid)
        u = requests.put(f"{API}/files/policies/{pid}", headers=H(admin), json={"bank_name": "TEST_Iter77 Bank2 edited"})
        assert u.status_code == 200 and u.json()["bank_name"] == "TEST_Iter77 Bank2 edited"
        assert requests.delete(f"{API}/files/policies/{pid}", headers=H(admin)).status_code == 200
        assert requests.get(f"{API}/files/policies/{pid}", headers=H(admin)).status_code == 404


# ---- (5) change password + (7) certificate ----
class TestProfileCert:
    def test_change_password_roundtrip(self):
        uid, m, t = signup_test_gp()
        r = requests.post(f"{API}/auth/change-password", headers=H(t), json={"current_password": "TestPass@123", "new_password": "NewPass@456"})
        assert r.status_code == 200, r.text
        assert gp_login(m, "NewPass@456").status_code == 200
        assert gp_login(m, "TestPass@123").status_code == 401
        bad = requests.post(f"{API}/auth/change-password", headers=H(t), json={"current_password": "wrong", "new_password": "x12345678"})
        assert bad.status_code == 400

    def test_certificate_active_gp(self, nm_gp):
        png = requests.get(f"{API}/gp/certificate.png", headers=H(nm_gp))
        pdf = requests.get(f"{API}/gp/certificate.pdf", headers=H(nm_gp))
        assert png.status_code == 200 and png.content[:4] == b"\x89PNG"
        assert pdf.status_code == 200 and pdf.content[:4] == b"%PDF"

    def test_certificate_onboarding_gp_not_issued(self):
        uid, m, t = signup_test_gp()
        r = requests.get(f"{API}/gp/certificate.pdf", headers=H(t))
        assert r.status_code in (400, 403, 404, 409), r.status_code


# ---- (9) admin partner management ----
class TestAdminPartners:
    def test_edit_password_active_approve_delete(self, admin):
        uid, m, t = signup_test_gp()
        m2 = mob()
        e = requests.put(f"{API}/gp/admin/partners/{uid}", headers=H(admin), json={"name": "TEST Iter77 Edited", "mobile": m2, "email": f"test_iter77_ed_{m2}@example.com"})
        assert e.status_code == 200, e.text
        assert DB.users.find_one({"id": uid})["name"] == "TEST Iter77 Edited"
        dup = requests.put(f"{API}/gp/admin/partners/{uid}", headers=H(admin), json={"name": "x", "mobile": NM_MOB, "email": f"test_iter77_ed_{m2}@example.com"})
        assert dup.status_code == 409
        short = requests.put(f"{API}/gp/admin/partners/{uid}/password", headers=H(admin), json={"new_password": "abc"})
        assert short.status_code == 400
        p = requests.put(f"{API}/gp/admin/partners/{uid}/password", headers=H(admin), json={"new_password": "AdminSet@789"})
        assert p.status_code == 200
        v = requests.get(f"{API}/gp/admin/partners/{uid}/password", headers=H(admin))
        assert v.json()["password"] == "AdminSet@789"
        assert gp_login(m2, "AdminSet@789").status_code == 200
        assert requests.post(f"{API}/gp/admin/partners/{uid}/active", headers=H(admin), json={"active": False}).status_code == 200
        assert DB.users.find_one({"id": uid})["is_active"] is False
        assert requests.post(f"{API}/gp/admin/partners/{uid}/active", headers=H(admin), json={"active": True}).status_code == 200
        assert requests.post(f"{API}/gp/admin/partners/{uid}/approve", headers=H(admin), json={"reason": " "}).status_code == 400
        a = requests.post(f"{API}/gp/admin/partners/{uid}/approve", headers=H(admin), json={"reason": "TEST approval"})
        assert a.status_code == 200 and DB.users.find_one({"id": uid})["gp_status"] == "active"
        d = requests.delete(f"{API}/gp/admin/partners/{uid}", headers=H(admin))
        assert d.status_code == 200, d.text
        assert DB.users.find_one({"id": uid}) is None

    def test_delete_blocked_with_files(self, admin, nm_gp):
        uid = requests.get(f"{API}/auth/me", headers=H(nm_gp)).json()["id"]
        r = requests.delete(f"{API}/gp/admin/partners/{uid}", headers=H(admin))
        assert r.status_code == 409 and "Deactivate" in r.text
        assert DB.users.find_one({"_id": ObjectId(uid)}) is not None

    def test_non_admin_forbidden(self, nm_gp):
        assert requests.get(f"{API}/gp/admin/partners/x/password", headers=H(nm_gp)).status_code == 403


# ---- (10) creatives background upload ----
class TestCreatives:
    def test_upload_returns_immediately_then_analyses(self, admin):
        with open("/app/backend/tests/fixtures/creatives/square_clear.png", "rb") as f:
            t0 = time.time()
            r = requests.post(f"{API}/gp/admin/creatives", headers=H(admin), files=[("files", ("square_clear.png", f, "image/png"))],
                              data={"names": "TEST_Iter77 creative"})
        took = time.time() - t0
        assert r.status_code == 200, r.text
        c = r.json()["results"][0]
        S["creatives"].append(c["id"])
        assert c.get("processing") == "analysing"
        assert took < 15, f"upload took {took:.1f}s"
        done = None
        for _ in range(30):
            time.sleep(3)
            lst = requests.get(f"{API}/gp/admin/creatives", headers=H(admin)).json()
            done = next(x for x in lst if x["id"] == c["id"])
            if not done.get("processing"):
                break
        assert not done.get("processing"), "analysis still running after 90s"
        assert not done.get("processing_error"), done.get("processing_error")
        assert done.get("placement")
