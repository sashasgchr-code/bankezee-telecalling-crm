"""Meta module isolation tests - iteration_53.
Covers: access-off 403, scoping GP/processor, write workflows (status/note),
assignment (staff-only), files pending + download 409, admin user mgmt +
duplicate-mapping rejection, and Connect regression sanity.
"""
import os
import pytest
import requests
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path("/app/frontend/.env"))
BASE = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE}/api"

ADMIN = ("admin@bankezee.com", "ConnectSasha12!!")
PROCESSOR = ("teja@bankezee.com", "tejasme12")
GP = ("banothunithinnaik@gmail.com", "Nithin@123")


def _login(email, pw):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": pw}, timeout=20)
    assert r.status_code == 200, f"login {email} -> {r.status_code} {r.text}"
    j = r.json()
    return j["token"], j.get("user", {})


def _h(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def admin_ctx():
    tk, u = _login(*ADMIN)
    return tk, u


@pytest.fixture(scope="module")
def gp_ctx():
    tk, u = _login(*GP)
    return tk, u


@pytest.fixture(scope="module")
def proc_ctx():
    tk, u = _login(*PROCESSOR)
    return tk, u


# ---------- Access OFF (admin has no meta_access) ----------
class TestAccessOff:
    def test_admin_has_no_meta_access_in_login(self, admin_ctx):
        _, u = admin_ctx
        assert not u.get("meta_access"), f"admin should NOT have meta_access, got {u.get('meta_access')}"

    def test_admin_meta_me_403(self, admin_ctx):
        tk, _ = admin_ctx
        r = requests.get(f"{API}/meta/me", headers=_h(tk), timeout=20)
        assert r.status_code == 403

    def test_admin_meta_leads_403(self, admin_ctx):
        tk, _ = admin_ctx
        r = requests.get(f"{API}/meta/leads", headers=_h(tk), timeout=20)
        assert r.status_code == 403


# ---------- Growth Partner scoping + write ----------
class TestGrowthPartner:
    def test_gp_login_has_meta_access(self, gp_ctx):
        _, u = gp_ctx
        assert u.get("meta_access") is True
        assert (u.get("meta_role") or "").lower() == "growth_partner"
        assert u.get("meta_user_id")

    def test_gp_me(self, gp_ctx):
        tk, _ = gp_ctx
        r = requests.get(f"{API}/meta/me", headers=_h(tk), timeout=20)
        assert r.status_code == 200
        j = r.json()
        assert j["meta_access"] is True
        assert j["meta_role"].lower() == "growth_partner"

    def test_gp_leads_scoped(self, gp_ctx):
        tk, u = gp_ctx
        r = requests.get(f"{API}/meta/leads?page_size=500", headers=_h(tk), timeout=30)
        assert r.status_code == 200
        j = r.json()
        assert j["total"] > 0, "GP should see assigned leads"
        # Every lead assigned to this GP
        for lead in j["leads"]:
            assert lead.get("assigned_partner_id") == u["meta_user_id"], \
                f"GP saw lead not assigned to them: {lead.get('lead_id')}"
        pytest.gp_sample_lead_id = j["leads"][0]["lead_id"]
        pytest.gp_leads_total = j["total"]

    def test_gp_lead_detail(self, gp_ctx):
        tk, _ = gp_ctx
        lid = pytest.gp_sample_lead_id
        r = requests.get(f"{API}/meta/leads/{lid}", headers=_h(tk), timeout=20)
        assert r.status_code == 200
        assert r.json().get("lead_id") == lid

    def test_gp_status_change_persists_activity(self, gp_ctx):
        tk, _ = gp_ctx
        lid = pytest.gp_sample_lead_id
        r = requests.patch(f"{API}/meta/leads/{lid}/status", headers=_h(tk),
                           json={"status": "CALL_BACK"}, timeout=20)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("status") == "CALL_BACK"
        acts = d.get("activities") or []
        assert any(a.get("type") == "status_change" for a in acts), "status_change activity missing"

    def test_gp_add_note(self, gp_ctx):
        tk, _ = gp_ctx
        lid = pytest.gp_sample_lead_id
        r = requests.post(f"{API}/meta/leads/{lid}/notes", headers=_h(tk),
                          json={"text": "TEST_iteration53 automated note"}, timeout=20)
        assert r.status_code == 200, r.text
        d = r.json()
        assert any(n.get("text", "").startswith("TEST_iteration53") for n in (d.get("notes") or []))
        assert any(a.get("type") == "note" for a in (d.get("activities") or []))

    def test_gp_cannot_assign(self, gp_ctx):
        tk, _ = gp_ctx
        lid = pytest.gp_sample_lead_id
        r = requests.patch(f"{API}/meta/leads/{lid}/assign", headers=_h(tk),
                           json={"partner_id": None}, timeout=20)
        assert r.status_code == 403

    def test_gp_cannot_list_partners(self, gp_ctx):
        tk, _ = gp_ctx
        r = requests.get(f"{API}/meta/partners", headers=_h(tk), timeout=20)
        assert r.status_code == 403

    def test_gp_cannot_list_users(self, gp_ctx):
        tk, _ = gp_ctx
        r = requests.get(f"{API}/meta/users", headers=_h(tk), timeout=20)
        assert r.status_code == 403

    def test_gp_cannot_access_user_mgmt(self, gp_ctx):
        tk, _ = gp_ctx
        r = requests.get(f"{API}/meta/admin/user-management", headers=_h(tk), timeout=20)
        assert r.status_code == 403


# ---------- Processor scoping ----------
class TestProcessor:
    def test_proc_login_has_meta_access(self, proc_ctx):
        _, u = proc_ctx
        assert u.get("meta_access") is True
        assert (u.get("meta_role") or "").lower() == "processor"

    def test_proc_leads_scoped(self, proc_ctx):
        tk, u = proc_ctx
        r = requests.get(f"{API}/meta/leads?page_size=500", headers=_h(tk), timeout=30)
        assert r.status_code == 200
        j = r.json()
        for lead in j["leads"]:
            assert lead.get("assigned_processor_id") == u["meta_user_id"]

    def test_proc_files_pending(self, proc_ctx):
        tk, _ = proc_ctx
        r = requests.get(f"{API}/meta/files?page_size=200", headers=_h(tk), timeout=20)
        assert r.status_code == 200
        j = r.json()
        assert j["total"] >= 149, f"expected >=149 meta files, got {j['total']}"
        assert j["binary_pending"] >= 149

    def test_proc_file_download_409(self, proc_ctx):
        tk, _ = proc_ctx
        r = requests.get(f"{API}/meta/files?page_size=1", headers=_h(tk), timeout=20)
        fid = r.json()["files"][0].get("_id") or r.json()["files"][0].get("id")
        assert fid, "missing file id"
        r2 = requests.get(f"{API}/meta/files/{fid}/download", headers=_h(tk), timeout=20)
        assert r2.status_code == 409


# ---------- Admin Meta User Mgmt (via admin token, admin has no meta_access) ----------
class TestAdminUserMgmt:
    def test_admin_can_view_user_mgmt(self, admin_ctx):
        tk, _ = admin_ctx
        r = requests.get(f"{API}/meta/admin/user-management", headers=_h(tk), timeout=20)
        assert r.status_code == 200, r.text
        j = r.json()
        assert "connect_users" in j and "meta_users" in j and "meta_roles" in j

    def test_proc_cannot_view_user_mgmt(self, proc_ctx):
        tk, _ = proc_ctx
        r = requests.get(f"{API}/meta/admin/user-management", headers=_h(tk), timeout=20)
        assert r.status_code == 403

    def test_duplicate_meta_mapping_rejected(self, admin_ctx):
        tk, _ = admin_ctx
        # Fetch two connect users that HAVE a mapping (nithin/teja) and one different one
        r = requests.get(f"{API}/meta/admin/user-management", headers=_h(tk), timeout=20)
        j = r.json()
        cu = j["connect_users"]
        # Find nithin and any other user
        nithin = next(u for u in cu if u.get("email") == "banothunithinnaik@gmail.com")
        # pick a different connect user (not admin, not nithin, that has an id)
        candidates = [u for u in cu if u.get("email") not in
                      ("banothunithinnaik@gmail.com", "admin@bankezee.com") and u.get("id")]
        assert candidates, "no candidate connect user"
        other = candidates[0]
        payload = {
            "meta_access": bool(other.get("meta_access")),
            "meta_role": other.get("meta_role"),
            "meta_email": other.get("meta_email"),
            "meta_user_id": nithin["meta_user_id"],   # duplicate
        }
        r2 = requests.patch(f"{API}/meta/admin/users/{other['id']}",
                            headers=_h(tk), json=payload, timeout=20)
        assert r2.status_code == 400, f"expected 400 duplicate, got {r2.status_code} {r2.text}"
        assert "already mapped" in r2.text.lower()


# ---------- Connect regression - non-meta endpoints still work ----------
class TestConnectRegression:
    def test_admin_dashboard(self, admin_ctx):
        tk, _ = admin_ctx
        for path in ["/auth/me", "/files/dashboard/stats", "/leads?page=1&page_size=10"]:
            r = requests.get(f"{API}{path}", headers=_h(tk), timeout=30)
            assert r.status_code in (200, 201), f"{path} -> {r.status_code}"

    def test_manager_files_load(self, proc_ctx):
        tk, _ = proc_ctx
        r = requests.get(f"{API}/files/dashboard/stats", headers=_h(tk), timeout=30)
        assert r.status_code == 200

    def test_gp_leads_load(self, gp_ctx):
        tk, _ = gp_ctx
        r = requests.get(f"{API}/leads?page=1&page_size=10", headers=_h(tk), timeout=30)
        assert r.status_code == 200
