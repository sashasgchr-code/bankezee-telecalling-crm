"""
Tests for post-call outcome logging and lead status updates.
Covers mobile-app LeadDetailScreen new features:
- POST /api/call-logs  (log call outcome manually)
- PUT  /api/leads/{id} (quick status update)
- GET  /api/leads/{id}/call-logs (verify persistence)
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://responsive-crm-app-1.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

AGENT_EMAIL = "agent@test.com"
AGENT_PASSWORD = "agent123"
ADMIN_EMAIL = "admin@bankezee.com"
ADMIN_PASSWORD = "ConnectSasha12!!"

VALID_STATUSES = ["new", "follow_up", "not_interested", "leads", "file"]
VALID_OUTCOMES = ["connected", "no_answer", "switched_off", "not_connecting", "busy", "wrong_number", "voicemail"]


# ---------- fixtures ----------
@pytest.fixture(scope="module")
def agent_token():
    r = requests.post(f"{API}/auth/login", json={"email": AGENT_EMAIL, "password": AGENT_PASSWORD})
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def agent_headers(agent_token):
    return {"Authorization": f"Bearer {agent_token}"}


@pytest.fixture(scope="module")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture(scope="module")
def test_lead(admin_headers, agent_token):
    """Create a test lead and assign to the agent."""
    # Get agent id
    me = requests.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {agent_token}"}).json()
    agent_id = me["id"]

    lead_payload = {
        "name": "TEST_CallOutcome Lead",
        "phone": "9998887776",
        "email": "test_call@example.com",
        "city": "TestCity",
        "status": "new",
    }
    r = requests.post(f"{API}/leads", json=lead_payload, headers=admin_headers)
    assert r.status_code in (200, 201), r.text
    lead = r.json()
    lead_id = lead["id"]

    # Assign
    r2 = requests.post(f"{API}/leads/assign",
                       json={"lead_ids": [lead_id], "user_id": agent_id},
                       headers=admin_headers)
    assert r2.status_code == 200, r2.text

    yield lead_id

    # Cleanup
    requests.delete(f"{API}/leads/{lead_id}", headers=admin_headers)


# ---------- tests ----------
class TestCallOutcomeLogging:
    def test_log_connected_outcome(self, agent_headers, test_lead):
        payload = {"lead_id": test_lead, "outcome": "connected", "notes": "TEST_ good discussion", "duration": 0}
        r = requests.post(f"{API}/call-logs", json=payload, headers=agent_headers)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["outcome"] == "connected"
        assert data["lead_id"] == test_lead
        assert data["notes"] == "TEST_ good discussion"
        assert "id" in data or "_id" in data

    @pytest.mark.parametrize("outcome", VALID_OUTCOMES)
    def test_all_outcomes_accepted(self, agent_headers, test_lead, outcome):
        r = requests.post(f"{API}/call-logs",
                          json={"lead_id": test_lead, "outcome": outcome, "notes": f"TEST_{outcome}"},
                          headers=agent_headers)
        assert r.status_code == 200, f"outcome={outcome} failed: {r.text}"
        assert r.json()["outcome"] == outcome

    def test_call_logs_persisted_and_retrievable(self, agent_headers, test_lead):
        # Log one
        requests.post(f"{API}/call-logs",
                      json={"lead_id": test_lead, "outcome": "voicemail", "notes": "TEST_persist"},
                      headers=agent_headers)
        r = requests.get(f"{API}/leads/{test_lead}/call-logs", headers=agent_headers)
        assert r.status_code == 200
        logs = r.json()
        assert isinstance(logs, list)
        assert len(logs) >= 1
        # newest first
        outcomes_in_logs = [l.get("outcome") for l in logs]
        assert "voicemail" in outcomes_in_logs

    def test_missing_outcome_rejected(self, agent_headers, test_lead):
        r = requests.post(f"{API}/call-logs",
                          json={"lead_id": test_lead, "notes": "no outcome"},
                          headers=agent_headers)
        assert r.status_code in (400, 422), r.text

    def test_invalid_lead_id_returns_error(self, agent_headers):
        # Use a valid 24-char hex but non-existent id
        r = requests.post(f"{API}/call-logs",
                          json={"lead_id": "507f1f77bcf86cd799439011", "outcome": "connected"},
                          headers=agent_headers)
        assert r.status_code in (404, 400), r.text

    def test_unauthenticated_rejected(self, test_lead):
        r = requests.post(f"{API}/call-logs",
                          json={"lead_id": test_lead, "outcome": "connected"})
        assert r.status_code in (401, 403)


class TestQuickStatusUpdate:
    @pytest.mark.parametrize("status", VALID_STATUSES)
    def test_update_status_and_verify_persistence(self, agent_headers, test_lead, status):
        r = requests.put(f"{API}/leads/{test_lead}", json={"status": status}, headers=agent_headers)
        assert r.status_code == 200, r.text
        assert r.json()["status"] == status

        # GET verify persistence
        g = requests.get(f"{API}/leads/{test_lead}", headers=agent_headers)
        assert g.status_code == 200
        assert g.json()["status"] == status

    def test_partial_update_only_status(self, agent_headers, test_lead):
        before = requests.get(f"{API}/leads/{test_lead}", headers=agent_headers).json()
        r = requests.put(f"{API}/leads/{test_lead}", json={"status": "follow_up"}, headers=agent_headers)
        assert r.status_code == 200
        after = r.json()
        # Ensure other fields not wiped
        assert after["name"] == before["name"]
        assert after["phone"] == before["phone"]
        assert after["status"] == "follow_up"

    def test_update_without_auth_rejected(self, test_lead):
        r = requests.put(f"{API}/leads/{test_lead}", json={"status": "new"})
        assert r.status_code in (401, 403)


class TestCallOutcomeOptions:
    def test_call_outcomes_endpoint(self, agent_headers):
        # Backend exposes /call-outcomes; verify it returns options used by UI.
        r = requests.get(f"{API}/call-outcomes", headers=agent_headers)
        assert r.status_code == 200
        outcomes = r.json()
        assert isinstance(outcomes, list) and len(outcomes) > 0
        ids = {o["id"] for o in outcomes}
        # Core outcomes used by mobile screen must be present
        for req in ["connected", "no_answer", "busy", "wrong_number", "voicemail"]:
            assert req in ids, f"Missing outcome id: {req}"
