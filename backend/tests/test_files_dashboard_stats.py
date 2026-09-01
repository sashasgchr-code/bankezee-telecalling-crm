"""Tests for Files Dashboard stats (BankEzee Connect CRM merge)."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://responsive-crm-app-1.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "admin@bankezee.com"
ADMIN_PASSWORD = "ConnectSasha12!!"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=30)
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    data = r.json()
    tok = data.get("access_token") or data.get("token")
    assert tok, f"No token in login response: {data}"
    return tok


@pytest.fixture(scope="module")
def headers(token):
    return {"Authorization": f"Bearer {token}"}


def test_dashboard_stats_endpoint(headers):
    r = requests.get(f"{BASE_URL}/api/files/dashboard/stats", headers=headers, timeout=60)
    assert r.status_code == 200, f"Status {r.status_code}: {r.text}"
    data = r.json()
    print("\n=== Files Dashboard Stats ===")
    for k, v in data.items():
        if k != "by_status":
            print(f"  {k}: {v}")
    print(f"  by_status: {data.get('by_status')}")

    # Assertions on expected numbers
    assert data["total_files"] == 454, f"Expected 454 total files, got {data['total_files']}"
    assert data["login"] == 135, f"Expected 135 login, got {data['login']}"
    assert data["disbursed"] == 40, f"Expected 40 disbursed, got {data['disbursed']}"
    # Approved should be ~49-50
    assert 48 <= data["approved"] <= 52, f"Expected ~50 approved, got {data['approved']}"
    # Amounts
    assert 71000000 <= data["total_approved_amount"] <= 72500000, \
        f"Expected ~7.18Cr approved amt, got {data['total_approved_amount']}"
    assert 61500000 <= data["total_disbursed_amount"] <= 63500000, \
        f"Expected ~6.26Cr disbursed amt, got {data['total_disbursed_amount']}"


def test_files_list_endpoint(headers):
    r = requests.get(f"{BASE_URL}/api/files?limit=5", headers=headers, timeout=30)
    assert r.status_code == 200, f"Status {r.status_code}: {r.text}"
    data = r.json()
    print(f"\nFiles list keys: {list(data.keys()) if isinstance(data, dict) else type(data)}")
