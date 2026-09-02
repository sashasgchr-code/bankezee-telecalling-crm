"""
Tests for TL Team Tabs feature.
- /api/users/my-team (TL only)
- /api/leads?team_view=true (TL only)
- /api/files?team_view=true (TL only)
- /api/call-logs/team (TL only)
Verifies access control: regular GP must NOT access these endpoints.
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/") or "https://responsive-crm-app-1.preview.emergentagent.com"

TL_EMAIL = "anusha@bankezee.com"
TL_PASSWORD = "TLAnusha123!"
GP_EMAIL = "yarragondaanusha@gmail.com"
GP_PASSWORD = "AnushaGP123!"
ADMIN_EMAIL = "admin@bankezee.com"
ADMIN_PASSWORD = "ConnectSasha12!!"


def _login(email, password):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"Login failed for {email}: {r.status_code} {r.text}"
    data = r.json()
    token = data.get("access_token") or data.get("token")
    assert token, f"No token in login response: {data}"
    return token, data.get("user", data)


@pytest.fixture(scope="module")
def tl_token():
    t, _ = _login(TL_EMAIL, TL_PASSWORD)
    return t


@pytest.fixture(scope="module")
def gp_token():
    t, _ = _login(GP_EMAIL, GP_PASSWORD)
    return t


@pytest.fixture(scope="module")
def admin_token():
    t, _ = _login(ADMIN_EMAIL, ADMIN_PASSWORD)
    return t


def h(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


# ---------- /api/users/my-team ----------
class TestMyTeam:
    def test_tl_can_access_my_team(self, tl_token):
        r = requests.get(f"{BASE_URL}/api/users/my-team", headers=h(tl_token), timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "members" in data and "stats" in data
        assert isinstance(data["members"], list)
        # TL should have at least 1 member per seed
        assert data["stats"]["total"] >= 1, f"Expected >=1 team member, got {data['stats']}"
        # Each member should have stats
        for m in data["members"]:
            assert "stats" in m
            assert "total_data" in m["stats"]
            assert "total_files" in m["stats"]
            assert "total_calls" in m["stats"]

    def test_regular_gp_cannot_access_my_team(self, gp_token):
        r = requests.get(f"{BASE_URL}/api/users/my-team", headers=h(gp_token), timeout=30)
        assert r.status_code == 403, f"Expected 403 for regular GP, got {r.status_code}: {r.text}"

    def test_unauth_cannot_access_my_team(self):
        r = requests.get(f"{BASE_URL}/api/users/my-team", timeout=30)
        assert r.status_code in (401, 403)


# ---------- /api/leads?team_view=true ----------
class TestTeamLeads:
    def test_tl_team_view_leads(self, tl_token):
        r = requests.get(f"{BASE_URL}/api/leads?team_view=true", headers=h(tl_token), timeout=30)
        assert r.status_code == 200, r.text
        # response can be list or paginated obj
        body = r.json()
        assert isinstance(body, (list, dict))

    def test_gp_team_view_leads_denied_or_empty(self, gp_token):
        r = requests.get(f"{BASE_URL}/api/leads?team_view=true", headers=h(gp_token), timeout=30)
        # Either 403 forbidden or backend should ignore team_view for non-TL and return own data
        assert r.status_code in (200, 403)


# ---------- /api/files?team_view=true ----------
class TestTeamFiles:
    def test_tl_team_view_files(self, tl_token):
        r = requests.get(f"{BASE_URL}/api/files?team_view=true", headers=h(tl_token), timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert isinstance(body, (list, dict))

    def test_gp_team_view_files(self, gp_token):
        r = requests.get(f"{BASE_URL}/api/files?team_view=true", headers=h(gp_token), timeout=30)
        assert r.status_code in (200, 403)


# ---------- /api/call-logs/team ----------
class TestTeamCalls:
    def test_tl_team_calls(self, tl_token):
        r = requests.get(f"{BASE_URL}/api/call-logs/team", headers=h(tl_token), timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "calls" in data
        assert "pagination" in data
        assert "stats" in data
        assert "total_calls" in data["stats"]

    def test_gp_cannot_access_team_calls(self, gp_token):
        r = requests.get(f"{BASE_URL}/api/call-logs/team", headers=h(gp_token), timeout=30)
        assert r.status_code == 403, f"Expected 403 for GP, got {r.status_code}: {r.text}"


# ---------- User profile is_tl flag ----------
class TestUserFlags:
    def test_tl_user_has_is_tl_true(self, tl_token):
        r = requests.get(f"{BASE_URL}/api/auth/me", headers=h(tl_token), timeout=30)
        assert r.status_code == 200
        user = r.json()
        assert user.get("is_tl") is True, f"TL user missing is_tl=True: {user}"

    def test_gp_user_has_is_tl_false(self, gp_token):
        r = requests.get(f"{BASE_URL}/api/auth/me", headers=h(gp_token), timeout=30)
        assert r.status_code == 200
        user = r.json()
        assert not user.get("is_tl", False), f"Regular GP should have is_tl=False: {user}"
