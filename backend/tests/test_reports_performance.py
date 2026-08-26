"""
Reports Performance Tests - measure response times of optimized endpoints
"""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://responsive-crm-app-1.preview.emergentagent.com').rstrip('/')
ADMIN_EMAIL = "admin@bankezee.com"
ADMIN_PASSWORD = "ConnectSasha12!!"

PERF_BUDGET_MS = 2000  # 2 second budget for each endpoint


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=30)
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text[:200]}"
    data = r.json()
    token = data.get("token") or data.get("access_token")
    assert token, f"No token in response: {data}"
    return token


@pytest.fixture(scope="module")
def auth_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


def _timed_get(url, headers):
    t0 = time.time()
    r = requests.get(url, headers=headers, timeout=30)
    elapsed_ms = (time.time() - t0) * 1000
    return r, elapsed_ms


class TestReportsPerformance:
    """Measure and validate response for reports endpoints"""

    def test_login_works(self, admin_token):
        assert admin_token

    def test_summary_telecallers_today(self, auth_headers):
        # Summary tab endpoint
        r, ms = _timed_get(f"{BASE_URL}/api/reports/telecallers?period=today", auth_headers)
        print(f"\n[PERF] /api/reports/telecallers?period=today -> {r.status_code} in {ms:.0f}ms")
        assert r.status_code == 200
        data = r.json()
        assert "telecallers" in data
        assert "overall" in data
        assert ms < PERF_BUDGET_MS, f"Too slow: {ms:.0f}ms"

    def test_summary_this_month(self, auth_headers):
        r, ms = _timed_get(f"{BASE_URL}/api/reports/telecallers?period=this_month", auth_headers)
        print(f"\n[PERF] /api/reports/telecallers?period=this_month -> {r.status_code} in {ms:.0f}ms")
        assert r.status_code == 200
        assert ms < PERF_BUDGET_MS, f"Too slow: {ms:.0f}ms"

    def test_summary_all_time(self, auth_headers):
        r, ms = _timed_get(f"{BASE_URL}/api/reports/telecallers?period=all_time", auth_headers)
        print(f"\n[PERF] /api/reports/telecallers?period=all_time -> {r.status_code} in {ms:.0f}ms")
        assert r.status_code == 200
        assert ms < PERF_BUDGET_MS, f"Too slow: {ms:.0f}ms"

    def test_hourly_report(self, auth_headers):
        from datetime import datetime
        today = datetime.utcnow().strftime("%Y-%m-%d")
        r, ms = _timed_get(f"{BASE_URL}/api/reports/hourly?date={today}", auth_headers)
        print(f"\n[PERF] /api/reports/hourly -> {r.status_code} in {ms:.0f}ms")
        assert r.status_code == 200
        data = r.json()
        assert "telecallers" in data
        assert "overall_hourly" in data
        assert ms < PERF_BUDGET_MS, f"Too slow: {ms:.0f}ms"

    def test_activity_logs(self, auth_headers):
        from datetime import datetime
        today = datetime.utcnow().strftime("%Y-%m-%d")
        r, ms = _timed_get(f"{BASE_URL}/api/activity/logs?date={today}", auth_headers)
        print(f"\n[PERF] /api/activity/logs -> {r.status_code} in {ms:.0f}ms")
        assert r.status_code == 200
        assert ms < PERF_BUDGET_MS, f"Too slow: {ms:.0f}ms"

    def test_detailed_calls(self, auth_headers):
        from datetime import datetime
        today = datetime.utcnow().strftime("%Y-%m-%d")
        r, ms = _timed_get(f"{BASE_URL}/api/reports/detailed-calls?from_date={today}&to_date={today}", auth_headers)
        print(f"\n[PERF] /api/reports/detailed-calls -> {r.status_code} in {ms:.0f}ms")
        assert r.status_code == 200
        data = r.json()
        assert "calls" in data
        assert ms < PERF_BUDGET_MS, f"Too slow: {ms:.0f}ms"

    def test_dashboard_stats(self, auth_headers):
        r, ms = _timed_get(f"{BASE_URL}/api/dashboard/stats?period=today", auth_headers)
        print(f"\n[PERF] /api/dashboard/stats -> {r.status_code} in {ms:.0f}ms")
        assert r.status_code == 200
        assert ms < PERF_BUDGET_MS, f"Too slow: {ms:.0f}ms"

    def test_users_telecallers(self, auth_headers):
        r, ms = _timed_get(f"{BASE_URL}/api/users?role=telecaller", auth_headers)
        print(f"\n[PERF] /api/users?role=telecaller -> {r.status_code} in {ms:.0f}ms")
        assert r.status_code == 200
        assert ms < PERF_BUDGET_MS, f"Too slow: {ms:.0f}ms"
