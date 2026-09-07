"""
Tests for BankEzee CRM:
- A. Canonical Growth Partner (GP) resolution and filtering
- B. Two independent date filters on Files Dashboard
- C. Direct File creation via POST /api/files/create
"""
import os
import pytest
import requests
from datetime import date

def _load_backend_url():
    url = os.environ.get('REACT_APP_BACKEND_URL')
    if not url:
        try:
            with open('/app/frontend/.env') as f:
                for line in f:
                    if line.strip().startswith('REACT_APP_BACKEND_URL='):
                        url = line.strip().split('=', 1)[1].strip().strip('"').strip("'")
                        break
        except Exception:
            pass
    assert url, 'REACT_APP_BACKEND_URL not set'
    return url.rstrip('/')

BASE_URL = _load_backend_url()
API = f"{BASE_URL}/api"

ADMIN = {"email": "admin@bankezee.com", "password": "ConnectSasha12!!"}
MANAGER = {"email": "teja@bankezee.com", "password": "tejasme12"}
GP = {"email": "banothunithinnaik@gmail.com", "password": "Nithin@123"}


def _login(creds):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json=creds, timeout=30)
    assert r.status_code == 200, f"Login failed for {creds['email']}: {r.status_code} {r.text[:200]}"
    data = r.json()
    tok = data.get("access_token") or data.get("token")
    if tok:
        s.headers.update({"Authorization": f"Bearer {tok}"})
    return s, data


@pytest.fixture(scope="module")
def admin_session():
    s, _ = _login(ADMIN)
    return s


@pytest.fixture(scope="module")
def manager_session():
    s, _ = _login(MANAGER)
    return s


@pytest.fixture(scope="module")
def gp_session():
    s, _ = _login(GP)
    return s


# =========== A. GP resolution ===========

class TestGPResolution:
    def test_admin_growth_partners_canonical(self, admin_session):
        r = admin_session.get(f"{API}/users/growth-partners", timeout=30)
        assert r.status_code == 200, r.text[:300]
        data = r.json()
        # accept either list or {users:[]}
        gps = data if isinstance(data, list) else data.get("users") or data.get("growth_partners") or []
        assert len(gps) > 0, "Admin GP list empty"
        ids = [g.get("id") or g.get("user_id") for g in gps]
        assert len(ids) == len(set(ids)), "Duplicate GP ids returned"
        print(f"Admin GP count: {len(gps)}")

    def test_manager_growth_partners_subtree(self, manager_session):
        r = manager_session.get(f"{API}/users/growth-partners", timeout=30)
        assert r.status_code == 200, r.text[:300]
        data = r.json()
        gps = data if isinstance(data, list) else data.get("users") or data.get("growth_partners") or []
        assert len(gps) > 0, "Manager teja GP list empty (should be recursive subtree)"
        print(f"Manager teja GP count: {len(gps)}")

    def test_canonical_id_matches_tracking(self, admin_session):
        r = admin_session.get(f"{API}/users/growth-partners", timeout=30)
        gps = r.json() if isinstance(r.json(), list) else r.json().get("users") or r.json().get("growth_partners") or []
        assert gps
        gp_id = gps[0].get("id") or gps[0].get("user_id")
        r2 = admin_session.get(
            f"{API}/reports/daily-tracking-sheet",
            params={"user_id": gp_id, "month": 9, "year": 2026},
            timeout=30,
        )
        assert r2.status_code == 200, r2.text[:300]
        data = r2.json()
        rows = data if isinstance(data, list) else data.get("rows") or data.get("data") or []
        if rows:
            uid = rows[0].get("user_id")
            assert uid == gp_id, f"user_id in tracking ({uid}) != GP id ({gp_id})"

    def test_manager_canonical_alignment(self, manager_session):
        r = manager_session.get(f"{API}/users/growth-partners", timeout=30)
        gps = r.json() if isinstance(r.json(), list) else r.json().get("users") or r.json().get("growth_partners") or []
        assert gps
        gp_id = gps[0].get("id") or gps[0].get("user_id")
        r2 = manager_session.get(
            f"{API}/reports/daily-tracking-sheet",
            params={"user_id": gp_id, "month": 9, "year": 2026},
            timeout=30,
        )
        assert r2.status_code == 200
        rows = r2.json() if isinstance(r2.json(), list) else r2.json().get("rows") or r2.json().get("data") or []
        if rows:
            assert rows[0].get("user_id") == gp_id


class TestDetailedCallsFiltering:
    def test_admin_all_calls(self, admin_session):
        r = admin_session.get(
            f"{API}/reports/detailed-calls",
            params={"telecaller_id": "all", "from_date": "2020-01-01", "to_date": "2026-12-31"},
            timeout=60,
        )
        assert r.status_code == 200, r.text[:300]

    def test_admin_specific_gp(self, admin_session):
        gps = admin_session.get(f"{API}/users/growth-partners").json()
        gps = gps if isinstance(gps, list) else gps.get("users") or gps.get("growth_partners") or []
        gp_id = gps[0].get("id") or gps[0].get("user_id")
        r = admin_session.get(
            f"{API}/reports/detailed-calls",
            params={"telecaller_id": gp_id, "from_date": "2020-01-01", "to_date": "2026-12-31"},
            timeout=60,
        )
        assert r.status_code == 200

    def test_manager_cannot_widen(self, admin_session, manager_session):
        # get an admin-only GP that is NOT in manager subtree
        admin_gps = admin_session.get(f"{API}/users/growth-partners").json()
        admin_gps = admin_gps if isinstance(admin_gps, list) else admin_gps.get("users") or admin_gps.get("growth_partners") or []
        mgr_gps = manager_session.get(f"{API}/users/growth-partners").json()
        mgr_gps = mgr_gps if isinstance(mgr_gps, list) else mgr_gps.get("users") or mgr_gps.get("growth_partners") or []
        mgr_ids = {g.get("id") or g.get("user_id") for g in mgr_gps}
        outside = None
        for g in admin_gps:
            gid = g.get("id") or g.get("user_id")
            if gid not in mgr_ids:
                outside = gid
                break
        if not outside:
            pytest.skip("No out-of-scope GP found")

        r = manager_session.get(
            f"{API}/reports/daily-tracking-sheet",
            params={"user_id": outside, "month": 9, "year": 2026},
            timeout=30,
        )
        # Expect empty
        assert r.status_code in (200, 403)
        if r.status_code == 200:
            rows = r.json() if isinstance(r.json(), list) else r.json().get("rows") or r.json().get("data") or []
            assert rows == [], f"Manager should not see out-of-scope tracking; got {len(rows)} rows"

        r2 = manager_session.get(
            f"{API}/reports/detailed-calls",
            params={"telecaller_id": outside, "from_date": "2020-01-01", "to_date": "2026-12-31"},
            timeout=30,
        )
        assert r2.status_code in (200, 403)
        if r2.status_code == 200:
            data = r2.json()
            total = data.get("total_count") if isinstance(data, dict) else 0
            calls = data.get("calls") if isinstance(data, dict) else data
            assert (total in (0, None)) and (not calls), f"Manager widened scope: {data}"


# =========== B. Files Dashboard independent date filters ===========

class TestFilesDashboardStats:
    def test_baseline(self, admin_session):
        r = admin_session.get(f"{API}/files/dashboard/stats", timeout=30)
        assert r.status_code == 200, r.text[:300]
        self._baseline = r.json()
        assert "total_files" in self._baseline

    def test_file_created_window_only(self, admin_session):
        base = admin_session.get(f"{API}/files/dashboard/stats").json()
        r = admin_session.get(
            f"{API}/files/dashboard/stats",
            params={"start_date": "2020-01-01", "end_date": "2020-12-31"},
            timeout=30,
        )
        assert r.status_code == 200
        d = r.json()
        # total_files should change (likely 0 for 2020 window), login/approved/disbursed unchanged
        assert d.get("login") == base.get("login"), f"login changed under created window: {d.get('login')} vs {base.get('login')}"
        assert d.get("approved") == base.get("approved"), "approved changed under created window"
        assert d.get("disbursed") == base.get("disbursed"), "disbursed changed under created window"

    def test_activity_window_only(self, admin_session):
        base = admin_session.get(f"{API}/files/dashboard/stats").json()
        r = admin_session.get(
            f"{API}/files/dashboard/stats",
            params={"activity_start_date": "2020-01-01", "activity_end_date": "2020-12-31"},
            timeout=30,
        )
        assert r.status_code == 200
        d = r.json()
        assert d.get("total_files") == base.get("total_files"), \
            f"total_files changed under activity window: {d.get('total_files')} vs {base.get('total_files')}"

    def test_both_windows_together(self, admin_session):
        r = admin_session.get(
            f"{API}/files/dashboard/stats",
            params={
                "start_date": "2025-01-01", "end_date": "2026-12-31",
                "activity_start_date": "2020-01-01", "activity_end_date": "2020-12-31",
            },
            timeout=30,
        )
        assert r.status_code == 200


# =========== C. Direct File creation ===========

class TestFileCreateDirect:
    def test_admin_create_and_appears_and_cleanup(self, admin_session):
        gps = admin_session.get(f"{API}/users/growth-partners").json()
        gps = gps if isinstance(gps, list) else gps.get("users") or gps.get("growth_partners") or []
        gp_id = gps[0].get("id") or gps[0].get("user_id")

        payload = {
            "full_name": "TEST_ManualFile_Admin",
            "mobile": "9999900001",
            "loan_amount": 100000,
            "gp_id": gp_id,
        }
        # Try common field names
        r = admin_session.post(f"{API}/files/create", json=payload, timeout=30)
        if r.status_code == 422:
            # try alt names
            payload2 = {"name": "TEST_ManualFile_Admin", "mobile": "9999900001", "loan_amount": 100000, "gp_id": gp_id}
            r = admin_session.post(f"{API}/files/create", json=payload2, timeout=30)
        assert r.status_code in (200, 201), f"admin create failed: {r.status_code} {r.text[:400]}"
        f = r.json()
        fid = f.get("id") or f.get("_id") or f.get("file_id") or (f.get("file") or {}).get("id")
        assert fid, f"No file id in response: {f}"
        # Verify via GET
        gr = admin_session.get(f"{API}/files/{fid}", timeout=30)
        assert gr.status_code == 200, gr.text[:200]
        gf = gr.json()
        gf = gf if not isinstance(gf, dict) or "id" in gf else gf.get("file", gf)
        assert gf.get("status") == "file", f"status expected 'file', got {gf.get('status')}"
        assert gf.get("file_source") == "manual", f"file_source expected 'manual', got {gf.get('file_source')}"

        # Appears in list
        r2 = admin_session.get(f"{API}/files/", params={"gp_id": gp_id}, timeout=30)
        assert r2.status_code == 200
        files_list = r2.json()
        files_list = files_list if isinstance(files_list, list) else files_list.get("files") or files_list.get("data") or []
        ids = [x.get("id") or x.get("_id") for x in files_list]
        assert fid in ids, f"Newly created file {fid} not present in /files?gp_id={gp_id}"

        # Cleanup
        dr = admin_session.delete(f"{API}/files/{fid}", timeout=30)
        assert dr.status_code in (200, 204), f"delete failed: {dr.status_code} {dr.text[:200]}"

    def test_manager_out_of_scope_403(self, admin_session, manager_session):
        admin_gps = admin_session.get(f"{API}/users/growth-partners").json()
        admin_gps = admin_gps if isinstance(admin_gps, list) else admin_gps.get("users") or admin_gps.get("growth_partners") or []
        mgr_gps = manager_session.get(f"{API}/users/growth-partners").json()
        mgr_gps = mgr_gps if isinstance(mgr_gps, list) else mgr_gps.get("users") or mgr_gps.get("growth_partners") or []
        mgr_ids = {g.get("id") or g.get("user_id") for g in mgr_gps}
        outside = None
        for g in admin_gps:
            gid = g.get("id") or g.get("user_id")
            if gid not in mgr_ids:
                outside = gid
                break
        if not outside:
            pytest.skip("No out-of-scope GP found")
        payload = {"full_name": "TEST_OOS", "mobile": "9999900002", "loan_amount": 1000, "gp_id": outside}
        r = manager_session.post(f"{API}/files/create", json=payload, timeout=30)
        assert r.status_code == 403, f"Expected 403, got {r.status_code} {r.text[:200]}"

    def test_gp_self_create_no_gp_id(self, gp_session, admin_session):
        payload = {"full_name": "TEST_GPSelfCreate", "mobile": "9999900003", "loan_amount": 50000}
        r = gp_session.post(f"{API}/files/create", json=payload, timeout=30)
        if r.status_code == 422:
            payload2 = {"name": "TEST_GPSelfCreate", "mobile": "9999900003", "loan_amount": 50000}
            r = gp_session.post(f"{API}/files/create", json=payload2, timeout=30)
        assert r.status_code in (200, 201), f"GP create failed: {r.status_code} {r.text[:300]}"
        f = r.json()
        fid = f.get("id") or f.get("_id") or (f.get("file") or {}).get("id")
        assert fid

        # Should appear in GP's own list
        r2 = gp_session.get(f"{API}/files/", timeout=30)
        assert r2.status_code == 200
        files_list = r2.json()
        files_list = files_list if isinstance(files_list, list) else files_list.get("files") or files_list.get("data") or []
        ids = [x.get("id") or x.get("_id") for x in files_list]
        assert fid in ids, f"GP's new file not present in own /files list"

        # Cleanup via admin
        dr = admin_session.delete(f"{API}/files/{fid}", timeout=30)
        assert dr.status_code in (200, 204)
