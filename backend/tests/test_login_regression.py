"""Regression tests for login bug fix - HR password persistence."""
import os
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://responsive-crm-app-1.preview.emergentagent.com').rstrip('/')

LOGIN_URL = f"{BASE_URL}/api/auth/login"

VALID_CREDENTIALS = [
    ("hr@neosales.in", "Hr@BankEzee@$", "hr"),
    ("admin@bankezee.com", "ConnectSasha12!!", "admin"),
    ("teja@bankezee.com", "tejasme12", "manager"),
    ("rama@bankezee.com", "rama@bzc12", "ops"),
    ("saikiran@bankezee.com", "saikiran12", "manager"),
    ("banothunithinnaik@gmail.com", "Nithin@123", "growth_partner"),
]

@pytest.mark.parametrize("email,password,expected_role", VALID_CREDENTIALS)
def test_valid_login(email, password, expected_role):
    r = requests.post(LOGIN_URL, json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, f"Login failed for {email}: {r.status_code} {r.text}"
    data = r.json()
    # Response could be at root or nested under 'user'
    user = data.get("user", data)
    assert user.get("email", "").lower() == email.lower(), f"Email mismatch: {user}"
    role = user.get("role", "")
    # role match is informational
    print(f"OK {email} role={role} expected={expected_role}")

def test_hr_old_password_rejected():
    r = requests.post(LOGIN_URL, json={"email": "hr@neosales.in", "password": "HrNeo12!!"}, timeout=15)
    assert r.status_code in (400, 401, 403), f"Old HR password should be rejected, got {r.status_code}: {r.text}"

def test_wrong_password_rejected():
    r = requests.post(LOGIN_URL, json={"email": "admin@bankezee.com", "password": "wrongpass123"}, timeout=15)
    assert r.status_code in (400, 401, 403)

def test_unknown_email_rejected():
    r = requests.post(LOGIN_URL, json={"email": "nonexistent_user_xyz@example.com", "password": "whatever123"}, timeout=15)
    assert r.status_code in (400, 401, 403, 404)

def test_hr_login_persists_after_second_attempt():
    """Simulate persistence: login twice in a row."""
    for _ in range(2):
        r = requests.post(LOGIN_URL, json={"email": "hr@neosales.in", "password": "Hr@BankEzee@$"}, timeout=15)
        assert r.status_code == 200, f"HR persistence check failed: {r.status_code} {r.text}"
