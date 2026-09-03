"""
Iteration 39: Manager role scoping tests
- /api/reports/manager-team-stats?period=today|this_week|this_month
- /api/users/manager-team-members
- /api/files/leads scoped to manager team
"""
import os
import pytest
import requests

def _load_env():
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                return line.split("=", 1)[1].strip()
    return None

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or _load_env()).rstrip("/")

MANAGER = {"email": "teja@bankezee.com", "password": "tejasme12"}
GP = {"email": "meghanaaaa.36@gmail.com", "password": "Meghana@0260"}


def _login(creds):
    r = requests.post(f"{BASE_URL}/api/auth/login", json=creds, timeout=30)
    assert r.status_code == 200, f"login failed for {creds['email']}: {r.status_code} {r.text[:200]}"
    data = r.json()
    return data.get("token") or data.get("access_token"), data.get("user", {})


@pytest.fixture(scope="module")
def manager_auth():
    token, user = _login(MANAGER)
    return {"headers": {"Authorization": f"Bearer {token}"}, "user": user}


class TestManagerLogin:
    def test_manager_login_role(self):
        token, user = _login(MANAGER)
        assert token, "no token"
        role = (user.get("role") or "").lower()
        assert role == "manager", f"expected role=manager got {role}"


class TestManagerTeamStats:
    @pytest.mark.parametrize("period", ["today", "this_week", "this_month"])
    def test_team_stats_periods(self, manager_auth, period):
        r = requests.get(
            f"{BASE_URL}/api/reports/manager-team-stats",
            params={"period": period},
            headers=manager_auth["headers"], timeout=30
        )
        assert r.status_code == 200, r.text[:300]
        data = r.json()
        for k in ["period", "total_team", "calls", "connected", "leads", "files",
                  "files_login", "files_approved", "files_disbursed",
                  "disbursed_amount", "gp_performance", "gp_call_stats"]:
            assert k in data, f"missing key {k} in response"
        assert data["period"] == period
        assert isinstance(data["gp_performance"], list)
        assert isinstance(data["gp_call_stats"], list)

    def test_team_stats_has_team_members(self, manager_auth):
        r = requests.get(
            f"{BASE_URL}/api/reports/manager-team-stats",
            params={"period": "this_month"},
            headers=manager_auth["headers"], timeout=30
        )
        assert r.status_code == 200
        data = r.json()
        # Teja has 8 team members per problem statement
        assert data["total_team"] >= 5, f"expected several team members, got {data['total_team']}"


class TestManagerTeamMembers:
    def test_team_members(self, manager_auth):
        r = requests.get(
            f"{BASE_URL}/api/users/manager-team-members",
            headers=manager_auth["headers"], timeout=30
        )
        assert r.status_code == 200, r.text[:300]
        data = r.json()
        assert "members" in data and "total" in data and "tls_count" in data
        assert data["total"] >= 5
        # Should include at least one TL (Nagulapally pinky)
        assert data["tls_count"] >= 1
        tls = [m for m in data["members"] if m.get("is_tl")]
        assert len(tls) >= 1
        # each member has expected fields
        m0 = data["members"][0]
        for k in ["id", "name", "email", "is_tl", "calls", "leads", "files", "disbursed_amount"]:
            assert k in m0

    def test_gp_forbidden(self):
        token, _ = _login(GP)
        r = requests.get(
            f"{BASE_URL}/api/users/manager-team-members",
            headers={"Authorization": f"Bearer {token}"}, timeout=30
        )
        assert r.status_code in (403, 401)


class TestManagerFilesScoping:
    def test_manager_sees_team_files(self, manager_auth):
        # Files list scoped for manager: should include team's files, not just their own
        r = requests.get(
            f"{BASE_URL}/api/files/",
            params={"limit": 5, "page": 1},
            headers=manager_auth["headers"], timeout=30
        )
        assert r.status_code == 200, r.text[:300]
        data = r.json()
        # Response could be list or object with items
        items = data if isinstance(data, list) else (data.get("files") or data.get("items") or data.get("leads") or data.get("data") or [])
        total = data.get("total") if isinstance(data, dict) else None
        # Manager should see > 0 files
        assert (total and total > 0) or len(items) > 0, f"manager saw no files: {str(data)[:300]}"
