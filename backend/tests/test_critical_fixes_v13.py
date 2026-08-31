"""
Tests for the 4 critical fixes:
1. Attendance IST timezone in admin endpoints
2. Lead search on name/email/phone (normalized)
3. Mobile call-log endpoint (source=mobile, is_verified=true)
4. Unified call-log endpoint (combined web+mobile)
"""
import os
import pytest
import requests
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://responsive-crm-app-1.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
IST = ZoneInfo("Asia/Kolkata")

ADMIN = {"email": "admin@bankezee.com", "password": "ConnectSasha12!!"}
AGENT = {"email": "agent@test.com", "password": "agent123"}


def _login(creds):
    r = requests.post(f"{API}/auth/login", json=creds, timeout=15)
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    data = r.json()
    return data.get("token") or data.get("access_token"), data


@pytest.fixture(scope="module")
def admin_headers():
    token, _ = _login(ADMIN)
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def agent_ctx():
    token, data = _login(AGENT)
    user = data.get("user", {})
    return {
        "headers": {"Authorization": f"Bearer {token}"},
        "user_id": user.get("id") or user.get("_id"),
        "name": user.get("name"),
    }


# ================ FEATURE 1: Attendance IST timezone ================

class TestAttendanceIST:
    def test_admin_summary_returns_ist_date(self, admin_headers):
        r = requests.get(f"{API}/attendance/admin/summary", headers=admin_headers, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "date" in data
        expected_ist_date = datetime.now(IST).strftime("%Y-%m-%d")
        assert data["date"] == expected_ist_date, f"Expected IST date {expected_ist_date}, got {data['date']}"
        assert "server_time_ist" in data

    def test_admin_summary_with_explicit_date(self, admin_headers):
        target = "2026-01-15"
        r = requests.get(f"{API}/attendance/admin/summary?date={target}", headers=admin_headers, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["date"] == target

    def test_admin_today_endpoint_ok(self, admin_headers):
        r = requests.get(f"{API}/attendance/admin/today", headers=admin_headers, timeout=15)
        assert r.status_code == 200, r.text
        assert isinstance(r.json(), list)


# ================ FEATURE 2: Lead search (name/email/phone) ================

class TestLeadSearch:
    @pytest.fixture(scope="class")
    def seeded_lead(self, admin_headers):
        payload = {
            "name": "TEST_SearchZeta Kumar",
            "phone": "9876501234",
            "email": "TEST_zeta.search@example.com",
            "source": "test",
            "status": "new",
        }
        r = requests.post(f"{API}/leads", json=payload, headers=admin_headers, timeout=15)
        assert r.status_code in (200, 201), r.text
        lead = r.json()
        lead_id = lead.get("id") or lead.get("_id")
        yield {"id": lead_id, **payload}
        requests.delete(f"{API}/leads/{lead_id}", headers=admin_headers, timeout=15)

    def test_search_by_name(self, admin_headers, seeded_lead):
        r = requests.get(f"{API}/leads?search=SearchZeta", headers=admin_headers, timeout=15)
        assert r.status_code == 200, r.text
        names = [l.get("name") for l in r.json()]
        assert seeded_lead["name"] in names

    def test_search_by_name_case_insensitive(self, admin_headers, seeded_lead):
        r = requests.get(f"{API}/leads?search=searchzeta", headers=admin_headers, timeout=15)
        assert r.status_code == 200
        names = [l.get("name") for l in r.json()]
        assert seeded_lead["name"] in names

    def test_search_by_email(self, admin_headers, seeded_lead):
        r = requests.get(f"{API}/leads?search=zeta.search", headers=admin_headers, timeout=15)
        assert r.status_code == 200
        ids = [l.get("id") or l.get("_id") for l in r.json()]
        assert seeded_lead["id"] in ids

    def test_search_by_phone_full(self, admin_headers, seeded_lead):
        r = requests.get(f"{API}/leads?search=9876501234", headers=admin_headers, timeout=15)
        assert r.status_code == 200
        ids = [l.get("id") or l.get("_id") for l in r.json()]
        assert seeded_lead["id"] in ids

    def test_search_by_phone_partial(self, admin_headers, seeded_lead):
        r = requests.get(f"{API}/leads?search=98765", headers=admin_headers, timeout=15)
        assert r.status_code == 200
        ids = [l.get("id") or l.get("_id") for l in r.json()]
        assert seeded_lead["id"] in ids

    def test_search_by_phone_with_country_code(self, admin_headers, seeded_lead):
        # Search with +91 prefix should normalize to last 10 digits
        r = requests.get(f"{API}/leads?search=+919876501234", headers=admin_headers, timeout=15)
        assert r.status_code == 200
        ids = [l.get("id") or l.get("_id") for l in r.json()]
        assert seeded_lead["id"] in ids


# ================ FEATURE 3 & 4: Mobile & Unified call logs ================

class TestCallLogsUnified:
    @pytest.fixture(scope="class")
    def agent_lead(self, admin_headers, agent_ctx):
        # Create lead & assign to agent
        payload = {"name": "TEST_MobileCallLead", "phone": "9999900001", "status": "new"}
        r = requests.post(f"{API}/leads", json=payload, headers=admin_headers, timeout=15)
        assert r.status_code in (200, 201), r.text
        lead = r.json()
        lead_id = lead.get("id") or lead.get("_id")
        assign = requests.post(
            f"{API}/leads/assign",
            json={"lead_ids": [lead_id], "user_id": agent_ctx["user_id"]},
            headers=admin_headers, timeout=15,
        )
        assert assign.status_code == 200, assign.text
        yield lead_id
        requests.delete(f"{API}/leads/{lead_id}", headers=admin_headers, timeout=15)

    def test_mobile_call_log_created_with_source_mobile(self, agent_ctx, agent_lead):
        payload = {
            "lead_id": agent_lead,
            "duration_seconds": 45,
            "outcome": "connected",
            "notes": "TEST_mobile_call_note",
            "call_type": "outgoing",
            "device_timestamp": datetime.now(timezone.utc).isoformat(),
        }
        r = requests.post(f"{API}/call-logs/mobile", json=payload, headers=agent_ctx["headers"], timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("success") is True
        cl = data.get("call_log", {})
        assert cl.get("source") == "mobile"
        assert cl.get("is_verified") is True
        assert cl.get("duration") == 45 or cl.get("duration_seconds") == 45
        assert cl.get("outcome") == "connected"

    def test_lead_updated_with_last_verified_call(self, admin_headers, agent_lead):
        r = requests.get(f"{API}/leads/{agent_lead}", headers=admin_headers, timeout=15)
        assert r.status_code == 200, r.text
        lead = r.json()
        assert lead.get("last_call_outcome") == "connected"
        assert lead.get("last_verified_call_at") is not None
        assert lead.get("last_verified_call_duration") == 45
        assert lead.get("last_verified_call_type") == "outgoing"

    def test_daily_session_stats_updated_by_mobile_call(self, agent_ctx):
        r = requests.get(f"{API}/activity/my-stats", headers=agent_ctx["headers"], timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        # After the mobile call test ran, calls_made should be >=1 and total_call_seconds>=45
        # These may be higher because of previous test runs
        assert data.get("calls_made", 0) >= 1
        assert data.get("total_call_seconds", 0) >= 45

    def test_web_call_log_has_source_web(self, agent_ctx, agent_lead):
        payload = {
            "lead_id": agent_lead,
            "duration": 30,
            "outcome": "connected",
            "notes": "TEST_web_call",
            "call_type": "outgoing",
        }
        r = requests.post(f"{API}/call-logs", json=payload, headers=agent_ctx["headers"], timeout=15)
        assert r.status_code in (200, 201), r.text
        data = r.json()
        assert data.get("source") == "web"

    def test_unified_call_logs_returns_combined(self, agent_ctx, agent_lead):
        r = requests.get(f"{API}/call-logs/unified?lead_id={agent_lead}", headers=agent_ctx["headers"], timeout=15)
        assert r.status_code == 200, r.text
        logs = r.json()
        assert isinstance(logs, list)
        assert len(logs) >= 2, f"Expected at least 2 logs (web+mobile), got {len(logs)}"
        sources = {l.get("source") for l in logs}
        assert "mobile" in sources
        assert "web" in sources
        # Verify each log has source field
        for l in logs:
            assert "source" in l
            assert "is_verified" in l

    def test_unified_call_logs_filter_by_source(self, agent_ctx, agent_lead):
        r = requests.get(
            f"{API}/call-logs/unified?lead_id={agent_lead}&source=mobile",
            headers=agent_ctx["headers"], timeout=15
        )
        assert r.status_code == 200, r.text
        logs = r.json()
        for l in logs:
            assert l.get("source") == "mobile"

    def test_mobile_call_log_denied_for_unassigned_lead(self, admin_headers, agent_ctx):
        # Create lead NOT assigned to agent
        p = requests.post(f"{API}/leads", json={"name": "TEST_Unassigned", "phone": "9999900002"}, headers=admin_headers, timeout=15)
        lead_id = (p.json().get("id") or p.json().get("_id"))
        try:
            payload = {"lead_id": lead_id, "duration_seconds": 10, "outcome": "connected", "call_type": "outgoing"}
            r = requests.post(f"{API}/call-logs/mobile", json=payload, headers=agent_ctx["headers"], timeout=15)
            assert r.status_code == 403, f"Expected 403 for unassigned lead, got {r.status_code}"
        finally:
            requests.delete(f"{API}/leads/{lead_id}", headers=admin_headers, timeout=15)
