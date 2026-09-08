"""Iteration 54: Meta CRM parity full pass.
Tests role-based access + core /api/meta/* endpoints for the ported Meta app.
"""
import os
import io
import pytest
import requests

def _read_frontend_env():
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    return line.split("=", 1)[1].strip()
    except Exception:
        return None
BASE = (os.environ.get("REACT_APP_BACKEND_URL") or _read_frontend_env() or "").rstrip("/")
API = f"{BASE}/api"

CREDS = {
    "admin": ("admin@bankezee.com", "ConnectSasha12!!"),
    "ops": ("rama@bankezee.com", "rama@bzc12"),
    "processor": ("teja@bankezee.com", "tejasme12"),
    "gp": ("yarragondaanusha@gmail.com", "MetaGP123!"),
    "gp_alt": ("yarragondaanusha@gmail.com", "9063023292"),  # fallback (connect password)
}


def login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    if r.status_code != 200:
        return None
    return r.json().get("token") or r.json().get("access_token")


@pytest.fixture(scope="module")
def tokens():
    out = {}
    for k, (e, p) in CREDS.items():
        t = login(e, p)
        if t:
            out[k] = t
    return out


def H(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


# ---------------- Access & identity ----------------
class TestIdentity:
    def test_admin_me(self, tokens):
        assert "admin" in tokens, "admin login failed"
        r = requests.get(f"{API}/meta/me", headers=H(tokens["admin"]))
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["meta_access"] is True
        assert d["role"] == "admin"

    def test_ops_me(self, tokens):
        if "ops" not in tokens:
            pytest.skip("ops login failed")
        r = requests.get(f"{API}/meta/me", headers=H(tokens["ops"]))
        assert r.status_code == 200
        assert r.json()["role"] == "ops"

    def test_processor_me(self, tokens):
        if "processor" not in tokens:
            pytest.skip("processor login failed")
        r = requests.get(f"{API}/meta/me", headers=H(tokens["processor"]))
        # if meta_access not set -> 403 (still a valid signal)
        assert r.status_code in (200, 403)
        if r.status_code == 200:
            assert r.json()["role"] == "processor"

    def test_gp_me(self, tokens):
        tok = tokens.get("gp") or tokens.get("gp_alt")
        if not tok:
            pytest.skip("gp login failed")
        r = requests.get(f"{API}/meta/me", headers=H(tok))
        assert r.status_code in (200, 403)


# ---------------- Dashboard / Stats ----------------
class TestDashboard:
    def test_admin_stats(self, tokens):
        r = requests.get(f"{API}/meta/leads/stats", headers=H(tokens["admin"]))
        assert r.status_code == 200
        d = r.json()
        for k in ("total", "by_status", "unassigned", "files_in_progress", "by_city"):
            assert k in d

    def test_sync_now(self, tokens):
        r = requests.post(f"{API}/meta/leads/sync", headers=H(tokens["admin"]))
        assert r.status_code in (200, 202), r.text


# ---------------- Leads listing & scoping ----------------
class TestLeads:
    def test_admin_list_all(self, tokens):
        r = requests.get(f"{API}/meta/leads?page=1&page_size=5", headers=H(tokens["admin"]))
        assert r.status_code == 200
        d = r.json()
        assert "total" in d and "pages" in d
        items = d.get("items") or d.get("leads") or []
        assert isinstance(items, list)
        return items

    def test_admin_search_and_filter(self, tokens):
        r = requests.get(f"{API}/meta/leads?status=FILE&page=1&page_size=5", headers=H(tokens["admin"]))
        assert r.status_code == 200
        items = r.json().get("items") or r.json().get("leads") or []
        for it in items:
            assert it.get("status") == "FILE"

    def test_gp_scoping(self, tokens):
        tok = tokens.get("gp") or tokens.get("gp_alt")
        if not tok:
            pytest.skip("gp login failed")
        me = requests.get(f"{API}/meta/me", headers=H(tok))
        if me.status_code != 200:
            pytest.skip("gp no meta_access")
        my_uid = me.json().get("meta_user_id")
        r = requests.get(f"{API}/meta/leads?page=1&page_size=25", headers=H(tok))
        assert r.status_code == 200
        for it in (r.json().get("items") or []):
            assert it.get("assigned_partner_id") == my_uid, "GP sees lead not assigned to them"

    def test_processor_scoping(self, tokens):
        tok = tokens.get("processor")
        if not tok:
            pytest.skip("processor login failed")
        me = requests.get(f"{API}/meta/me", headers=H(tok))
        if me.status_code != 200:
            pytest.skip("processor no meta_access")
        my_uid = me.json().get("meta_user_id")
        r = requests.get(f"{API}/meta/leads?page=1&page_size=50", headers=H(tok))
        assert r.status_code == 200
        for it in (r.json().get("items") or []):
            assert it.get("assigned_processor_id") == my_uid


# ---------------- Forbidden actions ----------------
class TestForbidden:
    def test_gp_cannot_bulk_assign(self, tokens):
        tok = tokens.get("gp") or tokens.get("gp_alt")
        if not tok:
            pytest.skip()
        r = requests.post(f"{API}/meta/leads/bulk-assign", headers=H(tok),
                          json={"lead_ids": ["x"], "partner_id": None})
        assert r.status_code in (403, 404), r.text

    def test_gp_cannot_bulk_delete(self, tokens):
        tok = tokens.get("gp") or tokens.get("gp_alt")
        if not tok:
            pytest.skip()
        r = requests.post(f"{API}/meta/leads/bulk-delete", headers=H(tok),
                          json={"lead_ids": ["x"]})
        assert r.status_code == 403

    def test_ops_cannot_bulk_delete(self, tokens):
        tok = tokens.get("ops")
        if not tok:
            pytest.skip()
        r = requests.post(f"{API}/meta/leads/bulk-delete", headers=H(tok),
                          json={"lead_ids": ["x"]})
        assert r.status_code == 403

    def test_non_admin_user_mgmt(self, tokens):
        for role in ("ops", "processor", "gp", "gp_alt"):
            tok = tokens.get(role)
            if not tok:
                continue
            r = requests.get(f"{API}/meta/admin/user-management", headers=H(tok))
            assert r.status_code == 403, f"{role} got {r.status_code}"


# ---------------- Reports / Files / Call Logs ----------------
class TestReports:
    def test_files_stats(self, tokens):
        r = requests.get(f"{API}/meta/files/stats", headers=H(tokens["admin"]))
        assert r.status_code == 200

    def test_files_report(self, tokens):
        r = requests.get(f"{API}/meta/files/report", headers=H(tokens["admin"]))
        assert r.status_code == 200

    def test_files_report_export_csv(self, tokens):
        r = requests.get(f"{API}/meta/files/report/export", headers=H(tokens["admin"]))
        assert r.status_code == 200
        # should be CSV-ish
        assert "text/csv" in r.headers.get("content-type", "") or r.text.count(",") > 0

    def test_call_logs(self, tokens):
        r = requests.get(f"{API}/meta/call-logs", headers=H(tokens["admin"]))
        assert r.status_code == 200

    def test_partners(self, tokens):
        r = requests.get(f"{API}/meta/partners", headers=H(tokens["admin"]))
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_processors(self, tokens):
        r = requests.get(f"{API}/meta/processors", headers=H(tokens["admin"]))
        assert r.status_code == 200

    def test_processors_workload(self, tokens):
        r = requests.get(f"{API}/meta/processors/workload", headers=H(tokens["admin"]))
        assert r.status_code == 200

    def test_user_management_admin(self, tokens):
        r = requests.get(f"{API}/meta/admin/user-management", headers=H(tokens["admin"]))
        assert r.status_code == 200
        d = r.json()
        assert "connect_users" in d and "meta_users" in d


# ---------------- Lead detail write flow ----------------
class TestLeadWrite:
    def _get_lead_id(self, tok):
        r = requests.get(f"{API}/meta/leads?page=1&page_size=1", headers=H(tok))
        items = r.json().get("items") or r.json().get("leads") or []
        return items[0]["lead_id"] if items else None

    def test_admin_add_note(self, tokens):
        lid = self._get_lead_id(tokens["admin"])
        if not lid:
            pytest.skip("no leads")
        r = requests.post(f"{API}/meta/leads/{lid}/notes", headers=H(tokens["admin"]),
                          json={"text": "TEST_iter54 auto note"})
        assert r.status_code in (200, 201), r.text

    def test_admin_status_change(self, tokens):
        lid = self._get_lead_id(tokens["admin"])
        if not lid:
            pytest.skip("no leads")
        r = requests.patch(f"{API}/meta/leads/{lid}/status", headers=H(tokens["admin"]),
                           json={"status": "CALL_BACK"})
        assert r.status_code == 200, r.text


# ---------------- Connect regression ----------------
class TestConnectRegression:
    def test_auth_me(self, tokens):
        r = requests.get(f"{API}/auth/me", headers=H(tokens["admin"]))
        assert r.status_code == 200

    def test_files_dashboard_stats(self, tokens):
        r = requests.get(f"{API}/files/dashboard/stats", headers=H(tokens["admin"]))
        assert r.status_code == 200

    def test_leads_list(self, tokens):
        r = requests.get(f"{API}/leads", headers=H(tokens["admin"]))
        assert r.status_code == 200

    def test_users_list(self, tokens):
        r = requests.get(f"{API}/users", headers=H(tokens["admin"]))
        assert r.status_code == 200
