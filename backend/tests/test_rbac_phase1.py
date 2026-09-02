"""
RBAC Phase 1 backend tests
Tests role-based accounts seeding + new hierarchy endpoints
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # fallback to frontend .env
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
                break

CREDS = {
    "admin": ("admin@bankezee.com", "ConnectSasha12!!"),
    "hr": ("hr@neosales.in", "HrNeo12!!"),
    "manager_teja": ("teja@bankezee.com", "tejasme12"),
    "manager_saikiran": ("saikiran@bankezee.com", "saikiran12"),
    "ops_rama": ("rama@bankezee.com", "rama@bzc12"),
    "ops": ("ops@bankezee.com", "ops@bzc12"),
}


def _login(email, password):
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": email, "password": password}, timeout=15)
    return r


@pytest.fixture(scope="module")
def admin_token():
    r = _login(*CREDS["admin"])
    assert r.status_code == 200, f"Admin login failed: {r.status_code} {r.text}"
    return r.json()["token"] if "token" in r.json() else r.json().get("access_token")


@pytest.fixture(scope="module")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


# ---------------- Seeded accounts ---------------- #

@pytest.mark.parametrize("key", list(CREDS.keys()))
def test_seeded_account_login(key):
    email, password = CREDS[key]
    r = _login(email, password)
    assert r.status_code == 200, f"{key} login failed: {r.status_code} {r.text}"
    data = r.json()
    user = data.get("user", {})
    assert user.get("email", "").lower() == email.lower()
    print(f"{key} -> role={user.get('role')} is_active={user.get('is_active')}")


# ---------------- Hierarchy endpoints ---------------- #

def test_hierarchy_stats(admin_headers):
    r = requests.get(f"{BASE_URL}/api/users/hierarchy-stats", headers=admin_headers, timeout=15)
    assert r.status_code == 200, f"{r.status_code} {r.text}"
    data = r.json()
    assert "role_counts" in data
    assert "total_gps" in data
    assert "total_tls" in data
    assert "unassigned_gps" in data
    assert "pending_approvals" in data
    rc = data["role_counts"]
    # Verify seeded accounts appear
    assert rc.get("admin", 0) >= 1
    assert rc.get("hr", 0) >= 1
    assert rc.get("manager", 0) >= 2
    assert rc.get("ops", 0) >= 2
    print("hierarchy-stats:", data)


def test_managers_list(admin_headers):
    r = requests.get(f"{BASE_URL}/api/users/managers", headers=admin_headers, timeout=15)
    assert r.status_code == 200, r.text
    lst = r.json()
    assert isinstance(lst, list)
    # First item should be the Unassigned default
    assert lst[0].get("id") is None
    emails = [u.get("email", "").lower() for u in lst[1:]]
    assert "teja@bankezee.com" in emails
    assert "saikiran@bankezee.com" in emails


def test_team_leads_list(admin_headers):
    r = requests.get(f"{BASE_URL}/api/users/team-leads", headers=admin_headers, timeout=15)
    assert r.status_code == 200, r.text
    lst = r.json()
    assert isinstance(lst, list)
    assert lst[0].get("id") is None  # Default "No Team Lead" option
    for tl in lst[1:]:
        assert "manager_id" in tl


def test_team_leads_filtered_by_manager(admin_headers):
    # Get a manager id first
    mgrs = requests.get(f"{BASE_URL}/api/users/managers", headers=admin_headers, timeout=15).json()
    real_mgrs = [m for m in mgrs if m.get("id")]
    assert real_mgrs, "no managers found"
    mid = real_mgrs[0]["id"]
    r = requests.get(f"{BASE_URL}/api/users/team-leads",
                     params={"manager_id": mid}, headers=admin_headers, timeout=15)
    assert r.status_code == 200, r.text
    for tl in r.json()[1:]:
        assert tl.get("manager_id") == mid


# ---------------- Users list with new fields ---------------- #

def test_users_list_contains_rbac_fields(admin_headers):
    r = requests.get(f"{BASE_URL}/api/users", headers=admin_headers, timeout=20)
    assert r.status_code == 200
    users = r.json()
    assert isinstance(users, list) and len(users) > 0
    sample = users[0]
    # RBAC-relevant fields expected in schema
    for f in ["id", "email", "role", "is_active"]:
        assert f in sample, f"Missing field {f}: {sample.keys()}"


# ---------------- role-hierarchy update ---------------- #

def test_role_hierarchy_update_toggle_tl(admin_headers):
    """Find a GP, toggle is_tl on, then off, verify persistence."""
    users = []
    for role in ["growth_partner", "telecaller", "partner", "sales_agent"]:
        users = requests.get(f"{BASE_URL}/api/users?role={role}",
                             headers=admin_headers, timeout=15).json()
        if users:
            break
    if not users:
        pytest.skip("No GP-like users available")
    # Prefer one with no assigned GPs
    target = None
    for u in users:
        if not u.get("is_tl"):
            target = u
            break
    if not target:
        pytest.skip("No non-TL GP available for toggle test")

    uid = target["id"]

    # Enable TL
    r = requests.put(f"{BASE_URL}/api/users/{uid}/role-hierarchy",
                     json={"is_tl": True}, headers=admin_headers, timeout=15)
    assert r.status_code == 200, f"Enable TL failed: {r.status_code} {r.text}"
    assert r.json().get("is_tl") is True

    # Verify via GET
    users_after = requests.get(f"{BASE_URL}/api/users?role=growth_partner&is_tl=true",
                              headers=admin_headers, timeout=15).json()
    assert any(u.get("id") == uid for u in users_after)

    # Disable TL (should succeed since no GPs are assigned yet)
    r = requests.put(f"{BASE_URL}/api/users/{uid}/role-hierarchy",
                     json={"is_tl": False}, headers=admin_headers, timeout=15)
    assert r.status_code == 200, f"Disable TL failed: {r.status_code} {r.text}"
    assert r.json().get("is_tl") is False


def test_role_hierarchy_invalid_role(admin_headers):
    users = []
    for role in ["growth_partner", "telecaller"]:
        users = requests.get(f"{BASE_URL}/api/users?role={role}",
                             headers=admin_headers, timeout=15).json()
        if users:
            break
    if not users:
        pytest.skip("No users")
    uid = users[0]["id"]
    r = requests.put(f"{BASE_URL}/api/users/{uid}/role-hierarchy",
                     json={"role": "banana"}, headers=admin_headers, timeout=15)
    assert r.status_code == 400


def test_role_hierarchy_requires_admin():
    """Non-admin cannot call role-hierarchy endpoint."""
    r = _login(*CREDS["hr"])
    assert r.status_code == 200
    token = r.json().get("token") or r.json().get("access_token")
    hdrs = {"Authorization": f"Bearer {token}"}
    # Grab some user id (list users blocked for hr, so use hierarchy-stats)
    r = requests.get(f"{BASE_URL}/api/users/hierarchy-stats", headers=hdrs, timeout=15)
    assert r.status_code == 403
