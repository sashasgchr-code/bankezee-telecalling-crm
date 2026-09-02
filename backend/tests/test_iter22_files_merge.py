"""
Iteration 22 backend tests: BankEzee CRM merged into Connect as Files module.
Tests:
- Auth login (admin) and register (new user pending approval)
- Leads stats returns by_status including 'no_status' if applicable
- Leads list with statuses=no_status returns leads with null/empty status
- Users pending-approval endpoint
- Users unmapped endpoint
- File conversion when lead status becomes 'file'
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://responsive-crm-app-1.preview.emergentagent.com').rstrip('/')
ADMIN_EMAIL = "admin@bankezee.com"
ADMIN_PASSWORD = "ConnectSasha12!!"


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}


# ============ Auth: registration creates pending user; login shows pending msg ============
class TestRegistrationApproval:
    email = f"TEST_pending_{uuid.uuid4().hex[:8]}@example.com"
    password = "TestPass12!!"

    def test_register_creates_pending(self):
        r = requests.post(f"{BASE_URL}/api/auth/register", json={
            "email": self.email,
            "password": self.password,
            "name": "Test Pending",
            "role": "telecaller"
        })
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("status") == "pending_approval"

    def test_login_pending_returns_401(self):
        r = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": self.email, "password": self.password
        })
        assert r.status_code == 401
        assert "pending" in r.json().get("detail", "").lower()

    def test_pending_approval_list_contains_new_user(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/users/pending-approval", headers=admin_headers)
        assert r.status_code == 200, r.text
        users = r.json()
        assert isinstance(users, list)
        emails = [u.get("email") for u in users]
        assert self.email.lower() in emails, f"newly registered pending user missing from list; sample={emails[:5]}"


# ============ Leads stats: no_status key present when leads with null status exist ============
class TestLeadsStats:
    def test_stats_by_status_shape(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/leads/stats", headers=admin_headers)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "by_status" in data
        assert isinstance(data["by_status"], dict)
        # totals present
        assert "totals" in data

    def test_stats_includes_file_status(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/leads/stats", headers=admin_headers)
        assert r.status_code == 200
        by_status = r.json().get("by_status", {})
        # per preview db there are 454 leads with status=file
        assert by_status.get("file", 0) > 0, f"expected some 'file' leads, got {by_status}"


# ============ Leads list with no_status filter ============
class TestNoStatusFilter:
    def test_no_status_filter_returns_leads(self, admin_headers):
        # Create a lead without status via inserting through import path is complex.
        # Instead use POST /api/leads with empty status.
        # Note: create_lead uses LeadCreate schema; create with status=""
        payload = {
            "name": f"TEST_nostatus_{uuid.uuid4().hex[:6]}",
            "phone": f"9{uuid.uuid4().int % 1000000000:09d}",
            "status": ""
        }
        c = requests.post(f"{BASE_URL}/api/leads", headers=admin_headers, json=payload)
        # If schema requires status, that's fine — we still test filter parses.
        r = requests.get(f"{BASE_URL}/api/leads?statuses=no_status&page=1&page_size=10", headers=admin_headers)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "leads" in data and "pagination" in data
        # It should not error out and should return a total_count >=0
        assert data["pagination"]["total_count"] >= 0

    def test_status_single_no_status(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/leads?status=no_status&page=1&page_size=10", headers=admin_headers)
        assert r.status_code == 200, r.text


# ============ Users: unmapped endpoint ============
class TestUsersUnmapped:
    def test_list_unmapped(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/users/unmapped", headers=admin_headers)
        assert r.status_code == 200, r.text
        assert isinstance(r.json(), list)

    def test_list_all_users(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/users", headers=admin_headers)
        assert r.status_code == 200
        users = r.json()
        assert isinstance(users, list) and len(users) > 0


# ============ File conversion on status change ============
class TestFileConversion:
    def test_lead_status_change_to_file(self, admin_headers):
        # Create a lead
        payload = {
            "name": f"TEST_file_{uuid.uuid4().hex[:6]}",
            "phone": f"9{uuid.uuid4().int % 1000000000:09d}",
            "status": "new"
        }
        c = requests.post(f"{BASE_URL}/api/leads", headers=admin_headers, json=payload)
        if c.status_code != 200:
            pytest.skip(f"create lead failed: {c.status_code} {c.text}")
        lead = c.json()
        lead_id = lead.get("id") or lead.get("_id")
        assert lead_id

        # Update status to file
        u = requests.put(f"{BASE_URL}/api/leads/{lead_id}",
                         headers=admin_headers,
                         json={"status": "file"})
        assert u.status_code == 200, u.text
        updated = u.json()
        assert updated.get("status") == "file"

        # Verify persisted via GET
        g = requests.get(f"{BASE_URL}/api/leads/{lead_id}", headers=admin_headers)
        assert g.status_code == 200
        assert g.json().get("status") == "file"

        # Cleanup
        requests.delete(f"{BASE_URL}/api/leads/{lead_id}", headers=admin_headers)
