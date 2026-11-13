# Iteration 73: legacy Connect telecalling / attendance / leave APIs retired (410); Files/Meta/Users/CC APIs preserved
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"


def _login(email, pw):
    ss = requests.Session()
    r = ss.post(f"{API}/auth/login", json={"email": email, "password": pw}, timeout=30)
    if r.status_code != 200:
        pytest.skip(f"login failed {email} {r.status_code}")
    ss.headers.update({"Authorization": f"Bearer {r.json().get('token')}"})
    return ss


@pytest.fixture(scope="module")
def admin():
    return _login("admin@bankezee.com", "ConnectSasha12!!")


@pytest.fixture(scope="module")
def tl():
    return _login("pinkynagulapally@gmail.com", "Pinky@1234")


RETIRED_GET = ["/call-logs", "/call-sessions/active", "/activity/my-session", "/follow-ups", "/attendance/today",
               "/leave/balance", "/dashboard/stats", "/reports/hourly", "/tl/stats", "/leads/x/call-logs",
               "/call-outcomes", "/recordings/x", "/tl/leads", "/tl/call-logs", "/tl/reports/hourly",
               "/dashboard/recent-calls", "/reports/my-hourly", "/reports/daily-tracking-sheet",
               "/reports/manager-team-stats", "/reports/verified-call-stats", "/attendance/admin/today"]


# Retired GETs return 410 with detail
@pytest.mark.parametrize("path", RETIRED_GET)
def test_retired_get_410(admin, path):
    r = admin.get(f"{API}{path}", timeout=30)
    assert r.status_code == 410, f"{path} -> {r.status_code} {r.text[:200]}"
    assert "retired" in r.json().get("detail", "").lower()


# Retired POSTs (mobile app) also 410
@pytest.mark.parametrize("path", ["/activity/ping", "/call-sessions/start", "/call-logs", "/attendance/check-in", "/follow-ups", "/leave/request"])
def test_retired_post_410(admin, path):
    r = admin.post(f"{API}{path}", json={}, timeout=30)
    assert r.status_code == 410, f"{path} -> {r.status_code}"


# Unauthenticated access also 410 (middleware runs before auth)
def test_retired_unauth():
    r = requests.get(f"{API}/call-logs", timeout=30)
    assert r.status_code == 410


PRESERVED = ["/files/dashboard/stats", "/leads?page=1&page_size=10", "/tl/meta", "/meta/reports/hourly", "/users",
             "/cc/campaigns", "/files/reports", "/auth/me", "/meta/call-logs", "/meta/leads"]


# Preserved endpoints still 200
@pytest.mark.parametrize("path", PRESERVED)
def test_preserved_200(admin, path):
    r = admin.get(f"{API}{path}", timeout=60)
    assert r.status_code == 200, f"{path} -> {r.status_code} {r.text[:200]}"
    assert r.json() is not None


# TL preserved endpoints
@pytest.mark.parametrize("path", ["/files/dashboard/stats", "/tl/meta", "/auth/me"])
def test_tl_preserved(tl, path):
    r = tl.get(f"{API}{path}", timeout=60)
    assert r.status_code == 200, f"{path} -> {r.status_code} {r.text[:200]}"


# Prefix-similar paths are NOT caught by regex (e.g. /api/leads list, /api/files/...)
def test_regex_not_overbroad(admin):
    r = admin.get(f"{API}/leads?page=1&page_size=10", timeout=30)
    assert r.status_code == 200
    r = admin.get(f"{API}/tl/meta", timeout=30)
    assert r.status_code == 200
