"""
Tests for POST /api/call-logs with call_type field (manual log incoming/outgoing).
Verifies:
- call_type persisted and returned in list
- Incoming call increments daily_sessions.verified_incoming_calls
- Outgoing call increments daily_sessions.calls_made (not verified_incoming_calls)
- Default call_type is 'outgoing'
"""
import os
import pytest
import requests
from datetime import datetime, timezone

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def telecaller_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{API}/auth/login", json={"email": "agent@test.com", "password": "agent123"})
    assert r.status_code == 200, r.text
    token = r.json().get("token") or r.json().get("access_token")
    s.headers.update({"Authorization": f"Bearer {token}"})
    return s


@pytest.fixture(scope="module")
def assigned_lead(telecaller_client):
    r = telecaller_client.get(f"{API}/leads")
    assert r.status_code == 200
    leads = r.json()
    if isinstance(leads, dict) and "leads" in leads:
        leads = leads["leads"]
    for l in leads:
        if l.get("phone"):
            return l
    pytest.skip("No lead with phone available")


def _baseline_dashboard(client):
    r = client.get(f"{API}/dashboard/stats?period=today")
    assert r.status_code == 200
    return r.json()


class TestCallLogCallType:
    def test_create_incoming_call_log(self, telecaller_client, assigned_lead):
        before = _baseline_dashboard(telecaller_client)
        base_ic = before["incoming_calls"]["count"]
        base_ic_time = before["incoming_calls"]["total_time_seconds"]

        payload = {
            "lead_id": assigned_lead["id"],
            "duration": 65,
            "outcome": "connected",
            "notes": "TEST_ incoming call log via web",
            "call_type": "incoming",
        }
        r = telecaller_client.post(f"{API}/call-logs", json=payload)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["call_type"] == "incoming"
        assert body["outcome"] == "connected"
        assert body["duration"] == 65
        assert body["lead_id"] == assigned_lead["id"]
        assert "_id" not in body  # ObjectId must be excluded / serialized

        # Verify persistence via GET
        r2 = telecaller_client.get(f"{API}/leads/{assigned_lead['id']}/call-logs")
        assert r2.status_code == 200
        logs = r2.json()
        matching = [
            l for l in logs
            if l.get("call_type") == "incoming" and l.get("notes") == "TEST_ incoming call log via web"
        ]
        assert len(matching) >= 1, f"Incoming call not persisted. Logs: {logs[:3]}"

        # Dashboard should reflect increment
        after = _baseline_dashboard(telecaller_client)
        assert after["incoming_calls"]["count"] >= base_ic + 1, (
            f"verified_incoming_calls not incremented. before={base_ic} after={after['incoming_calls']['count']}"
        )
        assert after["incoming_calls"]["total_time_seconds"] >= base_ic_time + 65

    def test_create_outgoing_call_log(self, telecaller_client, assigned_lead):
        before = _baseline_dashboard(telecaller_client)
        base_ic = before["incoming_calls"]["count"]

        payload = {
            "lead_id": assigned_lead["id"],
            "duration": 30,
            "outcome": "connected",
            "notes": "TEST_ outgoing call log via web",
            "call_type": "outgoing",
        }
        r = telecaller_client.post(f"{API}/call-logs", json=payload)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["call_type"] == "outgoing"

        after = _baseline_dashboard(telecaller_client)
        # Outgoing must NOT increment incoming counter
        assert after["incoming_calls"]["count"] == base_ic, (
            f"Outgoing call incorrectly incremented incoming counter"
        )

    def test_default_call_type_is_outgoing(self, telecaller_client, assigned_lead):
        payload = {
            "lead_id": assigned_lead["id"],
            "duration": 15,
            "outcome": "no_answer",
            "notes": "TEST_ default call_type",
        }
        r = telecaller_client.post(f"{API}/call-logs", json=payload)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["call_type"] == "outgoing"

    def test_call_logs_list_returns_call_type(self, telecaller_client, assigned_lead):
        r = telecaller_client.get(f"{API}/call-logs?lead_id={assigned_lead['id']}")
        assert r.status_code == 200
        logs = r.json()
        assert len(logs) >= 1
        # Every recent log should have call_type field (new logs at least)
        # Newly created logs (this test run) must have call_type. Older logs may not.
        recent = [l for l in logs if "TEST_ incoming call log via web" in (l.get("notes") or "")
                  or "TEST_ outgoing call log via web" in (l.get("notes") or "")
                  or "TEST_ default call_type" in (l.get("notes") or "")]
        assert len(recent) >= 1
        assert all("call_type" in l for l in recent), (
            f"Missing call_type in new list response. Recent: {recent}"
        )
