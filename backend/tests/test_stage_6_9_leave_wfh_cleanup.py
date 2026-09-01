"""
Backend tests for Stages 6-9:
- Leave & WFH workflows
- HR RBAC (HR cannot access /api/leads)
- Data cleanup / call log dedup endpoints
"""
import os
import pytest
import requests
from datetime import datetime, timedelta, timezone
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / "frontend" / ".env")
BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN = {"email": "admin@bankezee.com", "password": "ConnectSasha12!!"}
TELECALLER = {"email": "agent@test.com", "password": "agent123"}


# ---------- helpers ----------
def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, f"Login failed for {email}: {r.status_code} {r.text}"
    return r.json()["token"]


def _next_weekday(base: datetime, offset_days: int = 7) -> datetime:
    d = base + timedelta(days=offset_days)
    while d.weekday() >= 5:
        d += timedelta(days=1)
    return d


# ---------- fixtures ----------
@pytest.fixture(scope="session")
def admin_token():
    return _login(ADMIN["email"], ADMIN["password"])


@pytest.fixture(scope="session")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="session")
def telecaller_token():
    return _login(TELECALLER["email"], TELECALLER["password"])


@pytest.fixture(scope="session")
def telecaller_headers(telecaller_token):
    return {"Authorization": f"Bearer {telecaller_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="session")
def hr_user_and_token(admin_headers):
    """Create an HR user via admin endpoint (if not exists) and return token."""
    email = "TEST_hr_user@bankezee.com"
    password = "HrTest12!!"

    # Try login first
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    if r.status_code == 200:
        return {"email": email, "token": r.json()["token"]}

    # Create user via admin
    payload = {"email": email, "password": password, "name": "TEST HR User", "role": "hr"}
    cr = requests.post(f"{API}/auth/register", json=payload, headers=admin_headers, timeout=15)
    if cr.status_code not in (200, 201):
        # Try alternate route
        cr = requests.post(f"{API}/users", json=payload, headers=admin_headers, timeout=15)
    assert cr.status_code in (200, 201), f"HR user create failed: {cr.status_code} {cr.text}"

    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, f"HR login failed: {r.text}"
    return {"email": email, "token": r.json()["token"]}


# =====================================================================
# Leave / WFH Endpoints
# =====================================================================
class TestLeaveBalance:
    def test_get_leave_balance(self, telecaller_headers):
        r = requests.get(f"{API}/leave/balance", headers=telecaller_headers, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        for key in ["casual", "sick", "earned", "unpaid"]:
            assert key in data, f"Missing key {key}"
            assert "total" in data[key] and "used" in data[key]
        assert data["casual"]["total"] == 12
        assert data["sick"]["total"] == 6
        assert data["earned"]["total"] == 15
        assert data["unpaid"]["total"] == "Unlimited"


class TestLeaveRequests:
    submitted_id = None

    def test_submit_leave_request_weekday(self, telecaller_headers):
        # Use weekdays to get non-zero leave_days
        start = _next_weekday(datetime.now(timezone.utc), 14)
        end = start + timedelta(days=1)
        # ensure both weekdays
        while end.weekday() >= 5:
            end += timedelta(days=1)

        payload = {
            "start_date": start.isoformat(),
            "end_date": end.isoformat(),
            "leave_type": "CASUAL",
            "reason": "TEST_ pytest leave request",
            "half_day": False,
            "half_day_type": None,
        }
        r = requests.post(f"{API}/leave/requests", json=payload, headers=telecaller_headers, timeout=15)
        # If overlapping request exists, retry with later dates
        if r.status_code == 400 and "overlapping" in r.text.lower():
            start = _next_weekday(datetime.now(timezone.utc), 45)
            end = start + timedelta(days=1)
            while end.weekday() >= 5:
                end += timedelta(days=1)
            payload["start_date"] = start.isoformat()
            payload["end_date"] = end.isoformat()
            r = requests.post(f"{API}/leave/requests", json=payload, headers=telecaller_headers, timeout=15)

        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("success") is True
        req = data["request"]
        assert req["status"] == "PENDING"
        assert req["leave_type"] == "CASUAL"
        assert req["leave_days"] >= 1.0, f"Expected weekday leave_days >= 1, got {req['leave_days']}"
        TestLeaveRequests.submitted_id = req.get("id") or req.get("_id")

    def test_invalid_leave_type(self, telecaller_headers):
        start = _next_weekday(datetime.now(timezone.utc), 60)
        payload = {
            "start_date": start.isoformat(),
            "end_date": start.isoformat(),
            "leave_type": "INVALID_TYPE",
            "reason": "test",
            "half_day": False,
        }
        r = requests.post(f"{API}/leave/requests", json=payload, headers=telecaller_headers, timeout=15)
        assert r.status_code == 400

    def test_end_before_start(self, telecaller_headers):
        start = _next_weekday(datetime.now(timezone.utc), 70)
        end = start - timedelta(days=3)
        payload = {
            "start_date": start.isoformat(),
            "end_date": end.isoformat(),
            "leave_type": "CASUAL",
            "reason": "test",
            "half_day": False,
        }
        r = requests.post(f"{API}/leave/requests", json=payload, headers=telecaller_headers, timeout=15)
        assert r.status_code == 400

    def test_get_my_leave_requests(self, telecaller_headers):
        r = requests.get(f"{API}/leave/requests/my", headers=telecaller_headers, timeout=15)
        assert r.status_code == 200, r.text
        arr = r.json()
        assert isinstance(arr, list)
        assert len(arr) >= 1

    def test_pending_requires_hr_or_admin(self, telecaller_headers, admin_headers):
        # Telecaller should be forbidden
        r = requests.get(f"{API}/leave/requests/pending", headers=telecaller_headers, timeout=15)
        assert r.status_code == 403

        # Admin should get list
        r2 = requests.get(f"{API}/leave/requests/pending", headers=admin_headers, timeout=15)
        assert r2.status_code == 200
        assert isinstance(r2.json(), list)

    def test_approve_leave_request(self, admin_headers):
        # Get a pending request
        r = requests.get(f"{API}/leave/requests/pending", headers=admin_headers, timeout=15)
        assert r.status_code == 200
        pending = r.json()
        if not pending:
            pytest.skip("No pending leave requests to approve")
        req_id = pending[0].get("id") or pending[0].get("_id")

        payload = {"status": "APPROVED", "admin_notes": "TEST_ approved by pytest"}
        pr = requests.patch(f"{API}/leave/requests/{req_id}", json=payload, headers=admin_headers, timeout=15)
        assert pr.status_code == 200, pr.text
        updated = pr.json()
        assert updated["status"] == "APPROVED"


class TestWFH:
    def test_submit_wfh_request(self, telecaller_headers):
        d = _next_weekday(datetime.now(timezone.utc), 21)
        payload = {"date": d.isoformat(), "reason": "TEST_ WFH pytest"}
        r = requests.post(f"{API}/leave/wfh/requests", json=payload, headers=telecaller_headers, timeout=15)
        if r.status_code == 400 and "already exists" in r.text.lower():
            d = _next_weekday(datetime.now(timezone.utc), 50)
            payload["date"] = d.isoformat()
            r = requests.post(f"{API}/leave/wfh/requests", json=payload, headers=telecaller_headers, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("success") is True
        assert data["request"]["status"] == "PENDING"


# =====================================================================
# HR RBAC - HR cannot access /api/leads
# =====================================================================
class TestHRRBAC:
    def test_hr_cannot_access_leads(self, hr_user_and_token):
        headers = {"Authorization": f"Bearer {hr_user_and_token['token']}"}
        r = requests.get(f"{API}/leads", headers=headers, timeout=15)
        assert r.status_code == 403, f"Expected 403 for HR on /api/leads, got {r.status_code}: {r.text}"

    def test_hr_can_access_leave_pending(self, hr_user_and_token):
        headers = {"Authorization": f"Bearer {hr_user_and_token['token']}"}
        r = requests.get(f"{API}/leave/requests/pending", headers=headers, timeout=15)
        assert r.status_code == 200, r.text

    def test_hr_can_access_leave_balance(self, hr_user_and_token):
        headers = {"Authorization": f"Bearer {hr_user_and_token['token']}"}
        r = requests.get(f"{API}/leave/balance", headers=headers, timeout=15)
        assert r.status_code == 200


# =====================================================================
# Data Cleanup
# =====================================================================
class TestDataCleanup:
    def test_stats(self, admin_headers):
        r = requests.get(f"{API}/data-cleanup/stats", headers=admin_headers, timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "collections" in data
        assert "call_logs" in data["collections"]
        assert "recent_7_days" in data

    def test_analysis(self, admin_headers):
        r = requests.get(f"{API}/data-cleanup/call-log-analysis?days=30", headers=admin_headers, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["period_days"] == 30
        assert "source_breakdown" in data
        for k in ["web", "mobile", "legacy", "device_sync"]:
            assert k in data["source_breakdown"]
        assert "potential_duplicate_groups" in data

    def test_deduplicate_dry_run(self, admin_headers):
        r = requests.post(
            f"{API}/data-cleanup/deduplicate-call-logs?dry_run=true&days=30",
            headers=admin_headers,
            timeout=60,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["dry_run"] is True
        assert "duplicate_groups_found" in data
        assert "records_to_delete" in data
        # Ensure nothing was actually deleted
        assert "deleted_count" not in data

    def test_cleanup_requires_admin(self, telecaller_headers):
        r = requests.get(f"{API}/data-cleanup/stats", headers=telecaller_headers, timeout=15)
        assert r.status_code == 403
