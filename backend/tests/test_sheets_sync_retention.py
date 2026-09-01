"""
Backend tests for Google Sheets Sync + Data Retention endpoints (iteration 18).
Covers /api/sheets-sync/* endpoints.
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
ADMIN_EMAIL = "admin@bankezee.com"
ADMIN_PASSWORD = "ConnectSasha12!!"
AGENT_EMAIL = "agent@test.com"
AGENT_PASSWORD = "agent123"


def _login(email, password):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"Login failed for {email}: {r.status_code} {r.text}"
    j = r.json()
    return j.get("access_token") or j.get("token")


@pytest.fixture(scope="module")
def admin_headers():
    return {"Authorization": f"Bearer {_login(ADMIN_EMAIL, ADMIN_PASSWORD)}"}


@pytest.fixture(scope="module")
def agent_headers():
    return {"Authorization": f"Bearer {_login(AGENT_EMAIL, AGENT_PASSWORD)}"}


# ============ Google Sheets Sync ============

class TestSheetsSync:
    def test_leads_by_status(self, admin_headers):
        # api_key is a Query param but current_user is required via require_admin, so pass a dummy api_key
        r = requests.get(f"{BASE_URL}/api/sheets-sync/leads-by-status?api_key=dummy", headers=admin_headers, timeout=60)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "timestamp" in data
        assert "summary" in data
        assert "data" in data
        # All expected status tabs present
        for k in ["new", "not_interested", "follow_up", "presentation", "leads", "file", "wrong_number", "other"]:
            assert k in data["data"], f"Missing tab {k}"
            assert isinstance(data["data"][k], list)
        # Summary matches counts
        for k, v in data["summary"].items():
            assert v == len(data["data"][k])

    def test_leads_by_status_requires_admin(self, agent_headers):
        r = requests.get(f"{BASE_URL}/api/sheets-sync/leads-by-status?api_key=dummy", headers=agent_headers, timeout=30)
        assert r.status_code in (401, 403)

    def test_daily_report(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/sheets-sync/daily-report", headers=admin_headers, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "date" in data
        assert "generated_at" in data
        assert "user_stats" in data
        assert isinstance(data["user_stats"], list)

    def test_daily_report_with_date(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/sheets-sync/daily-report?date=2025-01-15", headers=admin_headers, timeout=30)
        assert r.status_code == 200, r.text
        assert r.json()["date"] == "2025-01-15"

    def test_attendance_summary(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/sheets-sync/attendance-summary", headers=admin_headers, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "period" in data
        assert "records" in data
        assert isinstance(data["records"], list)


# ============ Data Retention ============

class TestRetention:
    def test_call_logs_stats(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/sheets-sync/retention/call-logs-stats", headers=admin_headers, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "total_call_logs" in data
        assert "by_age" in data
        assert isinstance(data["by_age"], list) and len(data["by_age"]) == 5
        for bucket in data["by_age"]:
            assert "period" in bucket and "count" in bucket

    def test_activity_logs_stats(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/sheets-sync/retention/activity-logs-stats", headers=admin_headers, timeout=30)
        assert r.status_code == 200, r.text
        assert "total_activity_logs" in r.json()

    def test_delete_call_logs_confirm_false_returns_warning(self, admin_headers):
        r = requests.delete(f"{BASE_URL}/api/sheets-sync/retention/delete-call-logs?older_than_days=365&confirm=false",
                            headers=admin_headers, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "warning" in data
        assert "count_to_delete" in data
        assert "action_required" in data
        # Nothing should have been deleted
        assert "deleted_count" not in data

    def test_delete_activity_logs_confirm_false_returns_warning(self, admin_headers):
        r = requests.delete(f"{BASE_URL}/api/sheets-sync/retention/delete-activity-logs?older_than_days=90&confirm=false",
                            headers=admin_headers, timeout=30)
        assert r.status_code == 200
        assert "warning" in r.json()

    def test_delete_verified_call_logs_confirm_false_returns_warning(self, admin_headers):
        r = requests.delete(f"{BASE_URL}/api/sheets-sync/retention/delete-verified-call-logs?older_than_days=180&confirm=false",
                            headers=admin_headers, timeout=30)
        assert r.status_code == 200
        assert "warning" in r.json()

    def test_export_call_logs(self, admin_headers):
        # Use a large threshold to likely have 0 records -> returns 404 (documented behaviour)
        r = requests.post(f"{BASE_URL}/api/sheets-sync/retention/export-call-logs?older_than_days=999",
                          headers=admin_headers, timeout=60)
        # Either 200 with xlsx stream, or 404 if no records
        assert r.status_code in (200, 404), r.text
        if r.status_code == 200:
            ct = r.headers.get("content-type", "")
            assert "spreadsheetml" in ct or "octet-stream" in ct
            assert len(r.content) > 0

    def test_export_call_logs_small_threshold(self, admin_headers):
        # Use minimum 30 days - likely to return either data or 404
        r = requests.post(f"{BASE_URL}/api/sheets-sync/retention/export-call-logs?older_than_days=30",
                          headers=admin_headers, timeout=60)
        assert r.status_code in (200, 404), r.text

    def test_deletion_history(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/sheets-sync/retention/deletion-history", headers=admin_headers, timeout=30)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_retention_requires_admin(self, agent_headers):
        r = requests.get(f"{BASE_URL}/api/sheets-sync/retention/call-logs-stats", headers=agent_headers, timeout=30)
        assert r.status_code in (401, 403)


# ============ Clean slate reassignment (leads + calls) ============

class TestCleanSlateReassignment:
    def test_reassign_marks_previous_agent_history(self, admin_headers, agent_headers):
        # Find a lead currently assigned to the agent OR find any lead to reassign
        # Get current agent user_id
        me_agent = requests.get(f"{BASE_URL}/api/auth/me", headers=agent_headers, timeout=30)
        assert me_agent.status_code == 200
        agent_id = me_agent.json()["id"]

        # Get all telecallers to pick another to reassign to
        users_r = requests.get(f"{BASE_URL}/api/users", headers=admin_headers, timeout=30)
        assert users_r.status_code == 200
        telecallers = [u for u in users_r.json() if u.get("role") == "telecaller" and u.get("id") != agent_id]
        if not telecallers:
            pytest.skip("No other telecaller available for reassignment test")
        other_id = telecallers[0]["id"]

        # Get a lead assigned to agent
        leads_r = requests.get(f"{BASE_URL}/api/leads?assigned_to={agent_id}&limit=1", headers=admin_headers, timeout=30)
        if leads_r.status_code != 200 or not leads_r.json().get("leads"):
            # Try to grab any lead and first assign to agent
            any_leads = requests.get(f"{BASE_URL}/api/leads?limit=1", headers=admin_headers, timeout=30).json()
            if not any_leads.get("leads"):
                pytest.skip("No leads in DB")
            lead_id = any_leads["leads"][0]["id"]
            requests.post(f"{BASE_URL}/api/leads/assign", headers=admin_headers,
                          json={"lead_ids": [lead_id], "user_id": agent_id}, timeout=30)
        else:
            lead_id = leads_r.json()["leads"][0]["id"]

        # Now reassign to other telecaller
        r = requests.post(f"{BASE_URL}/api/leads/assign", headers=admin_headers,
                          json={"lead_ids": [lead_id], "user_id": other_id}, timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["assigned_count"] >= 1

        # Verify lead status is 'new' after reassignment (clean slate)
        lead_get = requests.get(f"{BASE_URL}/api/leads/{lead_id}", headers=admin_headers, timeout=30)
        assert lead_get.status_code == 200
        lead_data = lead_get.json()
        assert lead_data.get("status") == "new", f"Expected 'new' status, got {lead_data.get('status')}"
        # last_call_outcome should be cleared
        assert lead_data.get("last_call_outcome") in (None, ""), f"Expected cleared outcome, got {lead_data.get('last_call_outcome')}"
        # reassigned_from_status should be a plain string, not a dict (checks for the $ifNull bug)
        rfs = lead_data.get("reassigned_from_status")
        if rfs is not None:
            assert isinstance(rfs, str), f"reassigned_from_status should be a string but got {type(rfs).__name__}: {rfs}"
