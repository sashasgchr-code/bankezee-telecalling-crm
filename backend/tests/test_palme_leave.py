"""
P.A.L.M.E Leave Policy backend tests
Tests: /api/leave/balance (year 2025/2026), /api/leave/palme/policy,
       /api/leave/palme/monthly-summary, /api/leave/palme/all-employees
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
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=30)
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    data = r.json()
    tok = data.get("token") or data.get("access_token")
    assert tok, f"No token in response: {data}"
    return tok


@pytest.fixture(scope="module")
def auth_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


# ---------- Leave Balance ----------
class TestLeaveBalance:
    def test_balance_2026_accrual_from_september(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/leave/balance?year=2026", headers=auth_headers, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["year"] == 2026
        assert data["accrual_start_month"] == 9
        assert data["accrual_start_month_name"] == "September"
        # Total yearly allowance from Sep-Dec = 4 months * 2 = 8
        assert data["yearly_allowance"] == 8
        assert data["monthly_allowance"] == 2
        # Accrued depends on current month. Since we're in Jan 2026, current_month<9 → accrued=0
        # But if system considers year==now.year and now.month < accrual_start_month, accrued should be 0.
        now = datetime.now()
        if now.year == 2026:
            if now.month < 9:
                assert data["accrued"] == 0.0, f"Expected 0 accrued in month {now.month} of 2026, got {data['accrued']}"
            else:
                expected = (now.month - 9 + 1) * 2
                assert data["accrued"] == float(expected)
        else:
            # If current year != 2026, past/future logic
            print(f"Current year {now.year}, accrued={data['accrued']}")

    def test_balance_2025_from_january(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/leave/balance?year=2025", headers=auth_headers, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["year"] == 2025
        assert data["accrual_start_month"] == 1
        assert data["accrual_start_month_name"] == "January"
        assert data["yearly_allowance"] == 24
        # 2025 is a past year → accrued should be full 24
        now = datetime.now()
        if now.year > 2025:
            assert data["accrued"] == 24.0
        elif now.year == 2025:
            assert data["accrued"] == float(now.month * 2)


# ---------- Policy ----------
class TestPalmePolicy:
    def test_policy_returns_rewards_and_penalties(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/leave/palme/policy", headers=auth_headers, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["policy_name"] == "P.A.L.M.E Policy"
        assert data["policy_meaning"]["P"] == "Present"
        assert data["policy_meaning"]["A"] == "Absent"
        assert data["policy_meaning"]["L"] == "Leave"
        assert data["policy_meaning"]["M"] == "Medical"
        assert data["policy_meaning"]["E"] == "Emergency"
        # Rewards
        assert data["rewards"]["weekly_on_time"]["amount"] == 200
        assert data["rewards"]["monthly_perfect"]["amount"] == 500
        assert data["rewards"]["quarterly_outstanding"]["amount"] == 2000
        # Penalty
        assert data["leave_rules"]["uninformed_leave_penalty"] == 100
        assert data["leave_rules"]["monthly_limit"] == 2
        assert data["leave_rules"]["sick_leave_certificate_threshold"] == 3


# ---------- Monthly Summary ----------
class TestMonthlySummary:
    def test_monthly_summary_current(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/leave/palme/monthly-summary", headers=auth_headers, timeout=60)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "employees" in data
        assert "team_totals" in data
        assert "working_days" in data
        assert "month_name" in data
        assert isinstance(data["employees"], list)
        # Structure of each employee entry
        if data["employees"]:
            emp = data["employees"][0]
            for key in ["user_id", "user_name", "working_days", "present_days",
                        "leave_days", "absent_days", "attendance_percentage",
                        "leave_breakdown", "rewards", "penalties", "net_amount"]:
                assert key in emp, f"missing {key}"
            for k in ["uninformed", "emergency", "sick", "medical"]:
                assert k in emp["leave_breakdown"]

    def test_monthly_summary_specific(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/leave/palme/monthly-summary?month=10&year=2026", headers=auth_headers, timeout=60)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["month"] == 10
        assert data["year"] == 2026


# ---------- All Employees ----------
class TestAllEmployees:
    def test_all_employees_summary(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/leave/palme/all-employees?year=2026", headers=auth_headers, timeout=60)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["year"] == 2026
        assert data["accrual_starts_from"] == "September"
        assert "employees" in data
        assert "team_totals" in data
        if data["employees"]:
            emp = data["employees"][0]
            for key in ["user_id", "user_name", "leave_accrued", "leave_used",
                        "leave_available", "uninformed_leaves", "sick_leaves",
                        "total_rewards", "total_penalties", "net_amount"]:
                assert key in emp, f"missing {key}"

    def test_all_employees_2025(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/leave/palme/all-employees?year=2025", headers=auth_headers, timeout=60)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["year"] == 2025
        assert data["accrual_starts_from"] == "January"


# ---------- Auth guard ----------
class TestAuthGuard:
    def test_policy_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/leave/palme/policy", timeout=30)
        assert r.status_code in (401, 403), r.status_code

    def test_all_employees_requires_admin(self):
        r = requests.get(f"{BASE_URL}/api/leave/palme/all-employees", timeout=30)
        assert r.status_code in (401, 403), r.status_code
