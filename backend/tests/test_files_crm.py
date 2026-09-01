"""Backend tests for Files CRM (merged CRM into BankEzee Connect)."""
import os
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://responsive-crm-app-1.preview.emergentagent.com').rstrip('/')
ADMIN_EMAIL = "admin@bankezee.com"
ADMIN_PASSWORD = "ConnectSasha12!!"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    data = r.json()
    tok = data.get("token") or data.get("access_token")
    assert tok, f"No token: {data}"
    return tok


@pytest.fixture(scope="module")
def auth_headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


class TestFilesList:
    def test_get_all_files_no_slash(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/files", headers=auth_headers, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "files" in data
        assert "pagination" in data
        assert isinstance(data["files"], list)

    def test_get_all_files_with_slash(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/files/", headers=auth_headers, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "files" in data

    def test_files_have_expected_structure(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/files", headers=auth_headers, timeout=15)
        data = r.json()
        for f in data["files"]:
            assert "id" in f
            assert "_id" not in f  # Mongo _id excluded
            assert f.get("status") == "file"


class TestFilesDashboardStats:
    def test_dashboard_stats(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/files/dashboard/stats", headers=auth_headers, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "total_files" in data
        assert "by_status" in data
        assert "new" in data
        assert "approved" in data
        assert "disbursed" in data
        assert "rejected" in data
        assert isinstance(data["total_files"], int)


class TestFilesStatuses:
    def test_get_statuses(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/files/statuses", headers=auth_headers, timeout=15)
        assert r.status_code == 200
        statuses = r.json()
        ids = {s["id"] for s in statuses}
        for expected in ["new", "contacted", "approved", "disbursed", "rejected"]:
            assert expected in ids


class TestFilesReports:
    def test_reports_endpoint(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/files/reports", headers=auth_headers, timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "summary" in data
        assert "funnel" in data
        assert "bank_stats" in data
        assert "team_stats" in data


class TestFileDetails:
    def test_get_file_by_id(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/files", headers=auth_headers, timeout=15)
        files = r.json().get("files", [])
        if not files:
            pytest.skip("No files in DB to test file details endpoint")
        fid = files[0]["id"]
        r2 = requests.get(f"{BASE_URL}/api/files/{fid}", headers=auth_headers, timeout=15)
        assert r2.status_code == 200, r2.text
        detail = r2.json()
        assert detail.get("id") == fid
        assert "_id" not in detail

    def test_get_file_not_found(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/files/nonexistent_id_xyz", headers=auth_headers, timeout=15)
        assert r.status_code == 404

    def test_get_file_activities(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/files", headers=auth_headers, timeout=15)
        files = r.json().get("files", [])
        if not files:
            pytest.skip("No files")
        fid = files[0]["id"]
        r2 = requests.get(f"{BASE_URL}/api/files/{fid}/activities", headers=auth_headers, timeout=15)
        assert r2.status_code == 200
        assert isinstance(r2.json(), list)

    def test_get_file_documents(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/files", headers=auth_headers, timeout=15)
        files = r.json().get("files", [])
        if not files:
            pytest.skip("No files")
        fid = files[0]["id"]
        r2 = requests.get(f"{BASE_URL}/api/files/{fid}/documents", headers=auth_headers, timeout=15)
        assert r2.status_code == 200
        assert isinstance(r2.json(), list)

    def test_get_file_eligibilities(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/files", headers=auth_headers, timeout=15)
        files = r.json().get("files", [])
        if not files:
            pytest.skip("No files")
        fid = files[0]["id"]
        r2 = requests.get(f"{BASE_URL}/api/files/{fid}/eligibilities", headers=auth_headers, timeout=15)
        assert r2.status_code == 200
        assert isinstance(r2.json(), list)


class TestOperationsTeam:
    def test_operations_team(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/files/operations-team", headers=auth_headers, timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)
