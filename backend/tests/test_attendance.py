"""
Backend API tests for BANKEZEE Connect Attendance module.
Tests: agent check-in/out, /today endpoint, admin summary/today/offices.
"""
import os
import pytest
import requests
from datetime import datetime, timezone

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://responsive-crm-app-1.preview.emergentagent.com").rstrip("/")

AGENT_CREDS = {"email": "agent@test.com", "password": "agent123"}
ADMIN_CREDS = {"email": "admin@bankezee.com", "password": "ConnectSasha12!!"}


# ---------- fixtures ----------
@pytest.fixture(scope="session")
def agent_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json=AGENT_CREDS, timeout=15)
    if r.status_code != 200:
        pytest.skip(f"Agent login failed: {r.status_code} {r.text}")
    return r.json().get("access_token") or r.json().get("token")


@pytest.fixture(scope="session")
def admin_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json=ADMIN_CREDS, timeout=15)
    if r.status_code != 200:
        pytest.skip(f"Admin login failed: {r.status_code} {r.text}")
    return r.json().get("access_token") or r.json().get("token")


@pytest.fixture
def agent_headers(agent_token):
    return {"Authorization": f"Bearer {agent_token}", "Content-Type": "application/json"}


@pytest.fixture
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}


# ---------- Agent: today ----------
class TestAgentAttendance:
    def test_today_status(self, agent_headers):
        r = requests.get(f"{BASE_URL}/api/attendance/today", headers=agent_headers, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "work_mode" in data
        assert data["work_mode"] in ["OFFICE", "WORK_FROM_HOME", "LEAVE"]
        assert "checked_in" in data
        assert "checked_out" in data
        assert "attendance_date" in data
        assert "server_time" in data
        assert "settings" in data

    def test_check_in_out_flow(self, agent_headers, admin_headers):
        # Ensure agent has WFH assigned for today to bypass geofence
        # Look up agent user id
        r = requests.get(f"{BASE_URL}/api/users", headers=admin_headers, timeout=15)
        agent_id = None
        if r.status_code == 200:
            for u in r.json():
                if u.get("email") == AGENT_CREDS["email"]:
                    agent_id = u.get("id") or u.get("_id")
                    break
        if agent_id:
            today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
            requests.post(
                f"{BASE_URL}/api/attendance/admin/wfh-assign",
                json={"user_id": agent_id, "date": today, "admin_notes": "auto-test"},
                headers=admin_headers, timeout=15
            )  # may be 400 if already exists; ignore

        # Get status
        r = requests.get(f"{BASE_URL}/api/attendance/today", headers=agent_headers, timeout=15)
        assert r.status_code == 200
        status = r.json()

        if status.get("checked_in") and status.get("checked_out"):
            pytest.skip("Agent already completed attendance today")

        work_mode = status.get("work_mode")

        if not status.get("checked_in"):
            payload = {"platform": "web"}
            if work_mode == "OFFICE":
                r = requests.post(f"{BASE_URL}/api/attendance/check-in", json=payload, headers=agent_headers, timeout=15)
                if r.status_code == 400:
                    pytest.skip(f"Office mode check-in requires location/office: {r.text}")
                assert r.status_code == 200, r.text
            else:
                # WFH or LEAVE
                r = requests.post(f"{BASE_URL}/api/attendance/check-in", json=payload, headers=agent_headers, timeout=15)
                assert r.status_code == 200, r.text
                data = r.json()
                assert data.get("success") is True
                assert "check_in_time" in data

        # Now verify /today shows checked_in
        r = requests.get(f"{BASE_URL}/api/attendance/today", headers=agent_headers, timeout=15)
        assert r.status_code == 200
        assert r.json().get("checked_in") is True

        # Check-out
        r = requests.post(f"{BASE_URL}/api/attendance/check-out", json={"platform": "web"}, headers=agent_headers, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("success") is True
        assert "working_minutes" in data
        assert isinstance(data["working_minutes"], int)
        assert "check_out_time" in data

        # Verify /today shows checked_out
        r = requests.get(f"{BASE_URL}/api/attendance/today", headers=agent_headers, timeout=15)
        assert r.json().get("checked_out") is True

    def test_double_checkout_prevented(self, agent_headers):
        r = requests.get(f"{BASE_URL}/api/attendance/today", headers=agent_headers, timeout=15)
        if not r.json().get("checked_out"):
            pytest.skip("not checked out yet")
        r = requests.post(f"{BASE_URL}/api/attendance/check-out", json={"platform": "web"}, headers=agent_headers, timeout=15)
        assert r.status_code == 400


# ---------- Admin endpoints ----------
class TestAdminAttendance:
    def test_admin_summary(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/attendance/admin/summary", headers=admin_headers, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        for k in ["date", "total_employees", "present", "late", "absent", "half_day", "on_leave", "office", "wfh", "currently_working"]:
            assert k in data, f"missing key {k}"
        assert isinstance(data["total_employees"], int)

    def test_admin_today_list(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/attendance/admin/today", headers=admin_headers, timeout=15)
        assert r.status_code == 200, r.text
        assert isinstance(r.json(), list)

    def test_admin_today_filter(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/attendance/admin/today?work_mode=OFFICE", headers=admin_headers, timeout=15)
        assert r.status_code == 200
        for rec in r.json():
            assert rec.get("work_mode") == "OFFICE"

    def test_admin_get_offices(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/attendance/admin/offices", headers=admin_headers, timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_admin_create_office_and_verify(self, admin_headers):
        payload = {
            "office_name": "TEST_Office_Automation",
            "latitude": 17.4485,
            "longitude": 78.3908,
            "allowed_radius_meters": 200,
            "is_active": False,  # keep inactive so it doesn't affect agent flow
        }
        r = requests.post(f"{BASE_URL}/api/attendance/admin/offices", json=payload, headers=admin_headers, timeout=15)
        assert r.status_code == 200, r.text
        office = r.json()
        assert office["office_name"] == payload["office_name"]
        assert abs(office["latitude"] - payload["latitude"]) < 1e-6
        office_id = office.get("id") or office.get("_id")
        assert office_id

        # Verify persistence via GET list
        r = requests.get(f"{BASE_URL}/api/attendance/admin/offices", headers=admin_headers, timeout=15)
        assert r.status_code == 200
        names = [o.get("office_name") for o in r.json()]
        assert "TEST_Office_Automation" in names

    def test_admin_get_settings(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/attendance/admin/settings", headers=admin_headers, timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert "office_start_time" in data
        assert "late_after_time" in data

    def test_agent_forbidden_admin_endpoint(self, agent_headers):
        r = requests.get(f"{BASE_URL}/api/attendance/admin/summary", headers=agent_headers, timeout=15)
        assert r.status_code in (401, 403)
