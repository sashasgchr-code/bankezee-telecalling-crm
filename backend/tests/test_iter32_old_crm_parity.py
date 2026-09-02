"""
Iteration 32 - OLD CRM Parity Tests
Tests:
 - Backend search filter on complete dataset (files list + dashboard stats)
 - Dashboard stats returns OLD CRM calcs (Total, Login, Approved, Disbursed)
 - Admin can list all files
 - GP File Mapping Audit endpoint
 - Admin delete endpoint requires admin role (403 for non-admin)
"""
import os
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://responsive-crm-app-1.preview.emergentagent.com').rstrip('/')

ADMIN_EMAIL = "admin@bankezee.com"
ADMIN_PASSWORD = "ConnectSasha12!!"
TELECALLER_EMAIL = "agent@test.com"
TELECALLER_PASSWORD = "agent123"


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=30)
    assert r.status_code == 200, f"Admin login failed: {r.status_code} {r.text}"
    data = r.json()
    tok = data.get("access_token") or data.get("token")
    assert tok, f"No token: {data}"
    return tok


@pytest.fixture(scope="module")
def telecaller_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": TELECALLER_EMAIL, "password": TELECALLER_PASSWORD}, timeout=30)
    if r.status_code != 200:
        pytest.skip(f"Telecaller login failed: {r.status_code}")
    data = r.json()
    return data.get("access_token") or data.get("token")


@pytest.fixture(scope="module")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture(scope="module")
def tc_headers(telecaller_token):
    return {"Authorization": f"Bearer {telecaller_token}"}


# ============ FILES LIST (search + admin sees all) ============
class TestFilesList:
    def test_admin_can_list_all_files(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/files?limit=1", headers=admin_headers, timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert "files" in data and "pagination" in data
        total = data["pagination"]["total"]
        print(f"Total files admin sees: {total}")
        assert total >= 500, f"Expected ~514 files, got {total}"

    def test_search_reddy_returns_matches(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/files?search=reddy&limit=100", headers=admin_headers, timeout=30)
        assert r.status_code == 200
        data = r.json()
        total = data["pagination"]["total"]
        print(f"Search 'reddy' returned {total} matches")
        assert total > 0, "Expected at least one file matching 'reddy'"
        # verify at least one file contains 'reddy' in name/mobile/email
        found = False
        for f in data["files"][:20]:
            hay = " ".join([
                str(f.get("full_name") or ""),
                str(f.get("name") or ""),
                str(f.get("mobile") or ""),
                str(f.get("phone") or ""),
                str(f.get("email") or ""),
                str((f.get("file_details") or {}).get("full_name") or ""),
            ]).lower()
            if "reddy" in hay:
                found = True
                break
        assert found, "No returned file contained 'reddy' in searchable fields"


# ============ DASHBOARD STATS ============
class TestDashboardStats:
    def test_dashboard_stats_returns_old_crm_metrics(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/files/dashboard/stats", headers=admin_headers, timeout=60)
        assert r.status_code == 200, r.text
        data = r.json()
        # Expected keys
        for k in ["total_files", "login_count", "approved_count", "disbursed_count"]:
            assert k in data or k.replace("_count", "") in data, f"Missing key {k}: {list(data.keys())}"
        total = data.get("total_files")
        login = data.get("login_count") or data.get("login")
        approved = data.get("approved_count") or data.get("approved")
        disbursed = data.get("disbursed_count") or data.get("disbursed")
        print(f"Stats -> total={total} login={login} approved={approved} disbursed={disbursed}")
        assert total >= 500, f"Expected ~514, got {total}"
        assert login is not None and login > 0
        assert approved is not None and approved > 0
        assert disbursed is not None and disbursed > 0

    def test_dashboard_stats_search_filters(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/files/dashboard/stats?search=reddy", headers=admin_headers, timeout=60)
        assert r.status_code == 200
        data = r.json()
        # search-filtered total should be less than or equal to full total
        r2 = requests.get(f"{BASE_URL}/api/files/dashboard/stats", headers=admin_headers, timeout=60)
        assert data["total_files"] <= r2.json()["total_files"]
        assert data["total_files"] > 0


# ============ GP FILE MAPPING AUDIT ============
class TestGpAudit:
    def test_gp_file_mapping_audit(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/files/audit/gp-file-mapping", headers=admin_headers, timeout=60)
        assert r.status_code == 200, r.text
        data = r.json()
        for k in ["total_files", "total_gps_with_files", "unassigned_files", "gp_file_matrix"]:
            assert k in data, f"Missing key {k}"
        assert isinstance(data["gp_file_matrix"], list)
        print(f"GP matrix rows: {len(data['gp_file_matrix'])}, total={data['total_files']}, unassigned={data['unassigned_files']}")

    def test_gp_audit_requires_admin(self, tc_headers):
        r = requests.get(f"{BASE_URL}/api/files/audit/gp-file-mapping", headers=tc_headers, timeout=30)
        assert r.status_code in (401, 403), f"Expected 401/403 for non-admin, got {r.status_code}"


# ============ FILE DELETE - admin only ============
class TestFileDelete:
    def test_delete_requires_admin(self, tc_headers, admin_headers):
        # get any file id
        r = requests.get(f"{BASE_URL}/api/files?limit=1", headers=admin_headers, timeout=30)
        assert r.status_code == 200
        files = r.json()["files"]
        if not files:
            pytest.skip("No files available")
        fid = files[0].get("id")
        r = requests.delete(f"{BASE_URL}/api/files/{fid}", headers=tc_headers, timeout=30)
        assert r.status_code in (401, 403), f"Expected 401/403 for telecaller delete, got {r.status_code}: {r.text}"

    def test_delete_unauth_no_token(self):
        r = requests.delete(f"{BASE_URL}/api/files/nonexistent-id", timeout=30)
        assert r.status_code in (401, 403)


# ============ GP restriction on files list ============
class TestGpFilesRestriction:
    def test_gp_sees_only_own_files(self, tc_headers, admin_headers):
        r_admin = requests.get(f"{BASE_URL}/api/files?limit=1", headers=admin_headers, timeout=30)
        r_gp = requests.get(f"{BASE_URL}/api/files?limit=1", headers=tc_headers, timeout=30)
        assert r_gp.status_code == 200, r_gp.text
        admin_total = r_admin.json()["pagination"]["total"]
        gp_total = r_gp.json()["pagination"]["total"]
        print(f"admin_total={admin_total} gp_total={gp_total}")
        # GP total must be <= admin_total (may be 0 if agent has no files)
        assert gp_total <= admin_total
