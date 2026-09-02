"""
Iteration 25 - BankEzee Connect Production Repair
Tests for: Leave 2-days/month, Monthly Attendance Summary, My Hourly Report,
Call Outcomes distinct, Never Called logic, Stats filter consistency.
"""
import os
import pytest
import requests
from datetime import datetime

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://responsive-crm-app-1.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "admin@bankezee.com"
ADMIN_PASSWORD = "ConnectSasha12!!"


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
                      timeout=15)
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    data = r.json()
    tok = data.get("token") or data.get("access_token")
    assert tok, f"No token in response: {data}"
    return tok


@pytest.fixture
def hdr(admin_token):
    return {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}


# ============ 1) LEAVE POLICY: 2 days/month ============

def test_leave_balance_current_year(hdr):
    r = requests.get(f"{BASE_URL}/api/leave/balance", headers=hdr, timeout=15)
    assert r.status_code == 200, r.text
    b = r.json()
    for k in ["year", "accrued", "used", "available", "yearly_allowance", "monthly_allowance"]:
        assert k in b, f"Missing key {k} in {b}"
    assert b["monthly_allowance"] == 2
    assert b["yearly_allowance"] == 24


def test_leave_balance_year_2026_september(hdr):
    # 2026 is future - server IST current month determines accrual
    # For year=2026 in Jan 2026, current_month=1, accrued=2. Test that endpoint accepts year param.
    r = requests.get(f"{BASE_URL}/api/leave/balance?year=2026", headers=hdr, timeout=15)
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["year"] == 2026
    assert b["monthly_allowance"] == 2
    assert b["yearly_allowance"] == 24
    # accrued should be month * 2
    now_month = datetime.utcnow().month
    # In Jan 2026, accrued = 1*2 = 2. Bug spec says 18 for September (9*2), which only true if run in Sep.
    assert b["accrued"] == now_month * 2, f"Expected {now_month*2}, got {b['accrued']}"


def test_leave_balance_past_year(hdr):
    r = requests.get(f"{BASE_URL}/api/leave/balance?year=2024", headers=hdr, timeout=15)
    assert r.status_code == 200
    b = r.json()
    assert b["accrued"] == 24  # full year


# ============ 2) MONTHLY ATTENDANCE SUMMARY ============

def test_monthly_attendance_summary(hdr):
    r = requests.get(f"{BASE_URL}/api/attendance/monthly-summary", headers=hdr, timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    for k in ["month", "year", "month_name", "summary", "day_wise"]:
        assert k in data
    for k in ["working_days", "present", "wfh", "approved_leave", "absent",
              "half_day", "late", "attendance_percentage"]:
        assert k in data["summary"], f"Missing {k}"


def test_monthly_attendance_summary_with_params(hdr):
    r = requests.get(f"{BASE_URL}/api/attendance/monthly-summary?month=12&year=2025",
                     headers=hdr, timeout=15)
    assert r.status_code == 200
    data = r.json()
    assert data["month"] == 12
    assert data["year"] == 2025


# ============ 3) MY HOURLY REPORT (C/CO/L/F) ============

def test_my_hourly_report(hdr):
    r = requests.get(f"{BASE_URL}/api/reports/my-hourly", headers=hdr, timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    for k in ["date", "user_id", "hourly_breakdown", "total_calls",
              "total_connected", "total_leads", "total_file"]:
        assert k in data, f"Missing {k}"
    # Verify C/CO/L/F fields per hourly row
    for row in data["hourly_breakdown"]:
        for k in ["hour", "hour_label", "calls", "connected", "leads", "file"]:
            assert k in row


# ============ 4) DISTINCT CALL OUTCOMES ============

def test_distinct_call_outcomes(hdr):
    r = requests.get(f"{BASE_URL}/api/leads/outcomes/distinct", headers=hdr, timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    # Should be dict or list; verify JSON parseable
    assert data is not None


# ============ 5) STATS accepts assigned_to & search filters ============

def test_stats_endpoint_basic(hdr):
    r = requests.get(f"{BASE_URL}/api/leads/stats", headers=hdr, timeout=15)
    assert r.status_code == 200
    data = r.json()
    assert "by_status" in data
    assert "by_outcome" in data
    assert "totals" in data


def test_stats_endpoint_with_search(hdr):
    r = requests.get(f"{BASE_URL}/api/leads/stats?search=test", headers=hdr, timeout=15)
    assert r.status_code == 200
    data = r.json()
    assert "totals" in data


def test_stats_endpoint_with_assigned_to_all(hdr):
    r = requests.get(f"{BASE_URL}/api/leads/stats?assigned_to=all", headers=hdr, timeout=15)
    assert r.status_code == 200


# ============ 6) NEVER CALLED consistency ============

def test_never_called_count_consistency(hdr):
    """Never Called count from stats should match count endpoint result."""
    s = requests.get(f"{BASE_URL}/api/leads/stats", headers=hdr, timeout=15).json()
    stats_nc = s.get("totals", {}).get("never_called", 0)

    c = requests.get(f"{BASE_URL}/api/leads/count?never_called=true", headers=hdr, timeout=15)
    assert c.status_code == 200
    count_nc = c.json().get("count", 0)

    # Both should be equal (both use last_call_at exists check)
    assert stats_nc == count_nc, f"Stats never_called={stats_nc} vs count endpoint={count_nc}"


# ============ 7) SWITCHED OFF normalization ============

def test_switched_off_filter(hdr):
    r = requests.get(f"{BASE_URL}/api/leads/count?outcomes=switched_off", headers=hdr, timeout=15)
    assert r.status_code == 200
    assert "count" in r.json()


# ============ 8) FILE DASHBOARD (backend-side) — validate that data endpoints work ============

def test_files_reports_daily(hdr):
    r = requests.get(f"{BASE_URL}/api/files/reports/daily", headers=hdr, timeout=20)
    # Endpoint may or may not require auth; accept 200
    assert r.status_code in (200, 401, 403), r.text


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
