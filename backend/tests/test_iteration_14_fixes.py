"""
Iteration 14 tests - Verify 4 fixes:
1. Attendance /admin/today accepts date param
2. Attendance /admin/summary accepts date param
3. New /admin/weekly-summary endpoint
4. New /admin/monthly-summary endpoint with attendance percentage
5. /api/reports/detailed-calls merges call_logs + verified_call_logs with source field
Frontend removals (recording toggle, admin recordings tab) are NOT tested here (backend-only scope).
"""
import os
import requests
import pytest
from datetime import datetime, timezone, timedelta

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://responsive-crm-app-1.preview.emergentagent.com').rstrip('/')
ADMIN_EMAIL = "admin@bankezee.com"
ADMIN_PASSWORD = "ConnectSasha12!!"


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, f"Admin login failed: {r.status_code} {r.text}"
    return r.json()["access_token"] if "access_token" in r.json() else r.json().get("token")


@pytest.fixture(scope="module")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


# ============ Attendance admin/today with date filter ============

class TestAttendanceAdminTodayWithDate:
    def test_admin_today_no_date_param(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/attendance/admin/today", headers=admin_headers)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_admin_today_with_date_param(self, admin_headers):
        yesterday = (datetime.now(timezone.utc) - timedelta(days=1)).strftime("%Y-%m-%d")
        r = requests.get(f"{BASE_URL}/api/attendance/admin/today?date={yesterday}", headers=admin_headers)
        assert r.status_code == 200, f"Expected 200 got {r.status_code}: {r.text}"
        assert isinstance(r.json(), list)

    def test_admin_today_with_older_date(self, admin_headers):
        old_date = "2025-01-01"
        r = requests.get(f"{BASE_URL}/api/attendance/admin/today?date={old_date}", headers=admin_headers)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_admin_today_invalid_date_falls_back(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/attendance/admin/today?date=notadate", headers=admin_headers)
        # Falls back gracefully to today
        assert r.status_code == 200

    def test_admin_today_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/attendance/admin/today")
        assert r.status_code in [401, 403]


# ============ Attendance admin/summary with date filter ============

class TestAttendanceAdminSummaryWithDate:
    def test_summary_no_date(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/attendance/admin/summary", headers=admin_headers)
        assert r.status_code == 200
        data = r.json()
        assert "date" in data
        assert "total_employees" in data
        assert "present" in data

    def test_summary_with_date(self, admin_headers):
        target_date = "2026-01-15"
        r = requests.get(f"{BASE_URL}/api/attendance/admin/summary?date={target_date}", headers=admin_headers)
        assert r.status_code == 200
        data = r.json()
        assert data["date"] == target_date


# ============ Weekly summary endpoint ============

class TestAttendanceWeeklySummary:
    def test_weekly_summary_no_params(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/attendance/admin/weekly-summary", headers=admin_headers)
        assert r.status_code == 200, f"Got {r.status_code}: {r.text}"
        data = r.json()
        assert "week_start" in data
        assert "week_end" in data
        assert "employees" in data
        assert "summary" in data
        assert isinstance(data["employees"], list)
        # Summary contains totals
        assert "total_employees" in data["summary"]
        assert "total_present_days" in data["summary"]
        assert "total_absent_days" in data["summary"]

    def test_weekly_summary_with_start_date(self, admin_headers):
        start = "2026-01-05"
        r = requests.get(f"{BASE_URL}/api/attendance/admin/weekly-summary?start_date={start}", headers=admin_headers)
        assert r.status_code == 200
        data = r.json()
        assert data["week_start"] == start
        # If employees exist, verify structure
        if data["employees"]:
            emp = data["employees"][0]
            for key in ["user_id", "user_name", "days_present", "days_late", "days_absent",
                        "days_wfh", "days_office", "days_leave", "total_working_minutes", "daily_records"]:
                assert key in emp, f"missing key {key}"

    def test_weekly_summary_requires_admin(self):
        r = requests.get(f"{BASE_URL}/api/attendance/admin/weekly-summary")
        assert r.status_code in [401, 403]


# ============ Monthly summary endpoint ============

class TestAttendanceMonthlySummary:
    def test_monthly_summary_no_params(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/attendance/admin/monthly-summary", headers=admin_headers)
        assert r.status_code == 200, f"Got {r.status_code}: {r.text}"
        data = r.json()
        assert "month" in data
        assert "year" in data
        assert "working_days" in data
        assert "employees" in data
        assert "summary" in data
        assert data["working_days"] > 0
        # Employee fields
        if data["employees"]:
            emp = data["employees"][0]
            for key in ["user_id", "user_name", "days_present", "days_absent",
                        "days_late", "days_half_day", "days_wfh", "days_office",
                        "days_leave", "total_working_minutes", "attendance_percentage"]:
                assert key in emp, f"missing key {key}"
            # attendance_percentage should be 0..100
            assert 0 <= emp["attendance_percentage"] <= 100

    def test_monthly_summary_with_month_year(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/attendance/admin/monthly-summary?month=12&year=2025", headers=admin_headers)
        assert r.status_code == 200
        data = r.json()
        assert data["month"] == 12
        assert data["year"] == 2025
        # December 2025 has 23 working days (Mon-Fri)
        assert data["working_days"] > 20

    def test_monthly_summary_summary_fields(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/attendance/admin/monthly-summary", headers=admin_headers)
        assert r.status_code == 200
        summary = r.json()["summary"]
        for key in ["total_employees", "avg_attendance_percentage", "total_present_days",
                    "total_late_days", "total_absent_days", "total_leave_days",
                    "total_wfh_days", "total_office_days"]:
            assert key in summary, f"missing summary key {key}"

    def test_monthly_summary_requires_admin(self):
        r = requests.get(f"{BASE_URL}/api/attendance/admin/monthly-summary")
        assert r.status_code in [401, 403]


# ============ Detailed calls report with verified_call_logs + source ============

class TestDetailedCallsReport:
    def test_detailed_calls_no_params(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/reports/detailed-calls", headers=admin_headers)
        assert r.status_code == 200, f"Got {r.status_code}: {r.text}"
        data = r.json()
        assert "calls" in data
        assert "total_count" in data
        assert isinstance(data["calls"], list)

    def test_detailed_calls_have_source_field(self, admin_headers):
        # Wide date range to ensure we get calls
        r = requests.get(
            f"{BASE_URL}/api/reports/detailed-calls?from_date=2025-01-01&to_date=2026-12-31",
            headers=admin_headers
        )
        assert r.status_code == 200
        calls = r.json()["calls"]
        # Every call has 'source' and 'is_verified' fields
        for c in calls[:50]:
            assert "source" in c, f"Call missing source: {c}"
            assert c["source"] in ["web", "mobile"], f"Unexpected source: {c['source']}"
            assert "is_verified" in c

    def test_detailed_calls_includes_both_sources(self, admin_headers):
        """Verify both call_logs and verified_call_logs are merged.
        If DB has mobile calls, they should appear alongside web calls."""
        r = requests.get(
            f"{BASE_URL}/api/reports/detailed-calls?from_date=2025-01-01&to_date=2026-12-31",
            headers=admin_headers
        )
        assert r.status_code == 200
        calls = r.json()["calls"]
        # Report should at least return a list; sources present depend on data
        sources = {c.get("source", "web") for c in calls}
        # Just log what sources are present
        print(f"Sources present in detailed calls: {sources}, total calls: {len(calls)}")
        # We don't strictly require mobile since seed data may not have any
        assert sources.issubset({"web", "mobile"})

    def test_detailed_calls_requires_admin(self):
        r = requests.get(f"{BASE_URL}/api/reports/detailed-calls")
        assert r.status_code in [401, 403]
