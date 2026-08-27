"""
Tests for incoming call tracking:
- /api/dashboard/stats returns incoming_calls {count, total_time_seconds}
- /api/call-logs/sync properly tracks incoming calls in verified_call_logs + daily_sessions
"""
import os
import pytest
import requests
from datetime import datetime, timezone

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://responsive-crm-app-1.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

TELECALLER_EMAIL = "agent@test.com"
TELECALLER_PASSWORD = "agent123"


@pytest.fixture(scope="module")
def telecaller_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{API}/auth/login", json={"email": TELECALLER_EMAIL, "password": TELECALLER_PASSWORD})
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    token = r.json().get("token") or r.json().get("access_token")
    assert token, f"No token returned: {r.json()}"
    s.headers.update({"Authorization": f"Bearer {token}"})
    return s


@pytest.fixture(scope="module")
def user_info(telecaller_client):
    r = telecaller_client.get(f"{API}/auth/me")
    assert r.status_code == 200
    return r.json()


@pytest.fixture(scope="module")
def assigned_lead(telecaller_client):
    """Get one lead assigned to the telecaller with a phone number."""
    r = telecaller_client.get(f"{API}/leads")
    assert r.status_code == 200, r.text
    leads = r.json()
    if isinstance(leads, dict) and "leads" in leads:
        leads = leads["leads"]
    for l in leads:
        if l.get("phone"):
            return l
    pytest.skip("No leads with phone available for the telecaller")


class TestDashboardIncoming:
    def test_dashboard_stats_has_incoming_calls_field(self, telecaller_client):
        r = telecaller_client.get(f"{API}/dashboard/stats?period=today")
        assert r.status_code == 200, r.text
        data = r.json()
        assert "incoming_calls" in data, f"Missing 'incoming_calls' key: {list(data.keys())}"
        ic = data["incoming_calls"]
        assert isinstance(ic, dict)
        assert "count" in ic and isinstance(ic["count"], int)
        assert "total_time_seconds" in ic and isinstance(ic["total_time_seconds"], int)
        assert ic["count"] >= 0
        assert ic["total_time_seconds"] >= 0

    def test_dashboard_has_verified_talk_time(self, telecaller_client):
        r = telecaller_client.get(f"{API}/dashboard/stats?period=today")
        assert r.status_code == 200
        data = r.json()
        assert "verified_talk_time_seconds" in data
        assert isinstance(data["verified_talk_time_seconds"], int)


class TestCallLogSyncIncoming:
    def test_sync_incoming_call_creates_verified_log(self, telecaller_client, assigned_lead):
        phone = assigned_lead["phone"]
        # Use unique timestamp to avoid dedup
        ts = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        payload = {
            "call_logs": [
                {
                    "phone_number": phone,
                    "type": "incoming",
                    "duration_seconds": 123,
                    "timestamp": ts,
                    "name": "TEST_INCOMING"
                }
            ]
        }
        r = telecaller_client.post(f"{API}/call-logs/sync", json=payload)
        assert r.status_code == 200, r.text
        result = r.json()
        assert result["synced"] >= 1
        assert result["matched"] >= 1, f"Expected phone {phone} to match assigned lead. Got: {result}"
        # verified_calls entry
        assert any(vc["type"] == "incoming" for vc in result.get("verified_calls", [])), result

    def test_sync_incoming_reflected_in_dashboard(self, telecaller_client, assigned_lead):
        # Baseline
        before = telecaller_client.get(f"{API}/dashboard/stats?period=today").json()
        base_count = before["incoming_calls"]["count"]
        base_time = before["incoming_calls"]["total_time_seconds"]
        base_talk = before.get("verified_talk_time_seconds", 0)

        phone = assigned_lead["phone"]
        ts = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        duration = 77
        payload = {
            "call_logs": [
                {"phone_number": phone, "type": "incoming", "duration_seconds": duration, "timestamp": ts}
            ]
        }
        r = telecaller_client.post(f"{API}/call-logs/sync", json=payload)
        assert r.status_code == 200, r.text

        after = telecaller_client.get(f"{API}/dashboard/stats?period=today").json()
        # daily_session field is recomputed from all verified logs today; new call should increase counts by 1
        assert after["incoming_calls"]["count"] >= base_count + 1, (
            f"Incoming count did not increase. before={base_count} after={after['incoming_calls']['count']}"
        )
        assert after["incoming_calls"]["total_time_seconds"] >= base_time + duration
        assert after["verified_talk_time_seconds"] >= base_talk + duration

    def test_sync_incoming_zero_duration_not_counted(self, telecaller_client, assigned_lead):
        before = telecaller_client.get(f"{API}/dashboard/stats?period=today").json()
        base_count = before["incoming_calls"]["count"]

        phone = assigned_lead["phone"]
        ts = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        payload = {
            "call_logs": [
                {"phone_number": phone, "type": "incoming", "duration_seconds": 0, "timestamp": ts}
            ]
        }
        r = telecaller_client.post(f"{API}/call-logs/sync", json=payload)
        assert r.status_code == 200

        after = telecaller_client.get(f"{API}/dashboard/stats?period=today").json()
        # Zero-duration incoming shouldn't inflate count (business rule)
        assert after["incoming_calls"]["count"] == base_count, (
            f"Zero-duration incoming was counted. before={base_count} after={after['incoming_calls']['count']}"
        )

    def test_verified_call_logs_endpoint_returns_incoming(self, telecaller_client, assigned_lead):
        r = telecaller_client.get(f"{API}/call-logs/verified")
        assert r.status_code == 200, r.text
        logs = r.json()
        assert isinstance(logs, list)
        incoming = [l for l in logs if l.get("call_type") == "incoming"]
        assert len(incoming) >= 1, "Expected at least one incoming verified call log after sync tests"

    def test_sync_unmatched_phone_not_counted(self, telecaller_client):
        before = telecaller_client.get(f"{API}/dashboard/stats?period=today").json()
        base_count = before["incoming_calls"]["count"]

        ts = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        payload = {
            "call_logs": [
                {"phone_number": "+10000000000", "type": "incoming", "duration_seconds": 50, "timestamp": ts}
            ]
        }
        r = telecaller_client.post(f"{API}/call-logs/sync", json=payload)
        assert r.status_code == 200
        result = r.json()
        assert result["matched"] == 0

        after = telecaller_client.get(f"{API}/dashboard/stats?period=today").json()
        assert after["incoming_calls"]["count"] == base_count
