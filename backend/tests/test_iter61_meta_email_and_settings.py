"""Iteration 61 tests: Meta email sender resolution + settings sender_name + meta reports regression."""
import os
import sys
import asyncio
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/") or "http://localhost:8001"
sys.path.insert(0, "/app/backend")

ADMIN_EMAIL = "admin@bankezee.com"
ADMIN_PASSWORD = "ConnectSasha12!!"


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    return r.json().get("access_token") or r.json().get("token")


@pytest.fixture(scope="module")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


# ---- Email sender resolution ----
def test_resolve_sender_returns_bankezee_format():
    """_resolve_sender must return 'BankEzee <noreply@bankezee.com>' given env EMAIL_FROM/EMAIL_FROM_NAME."""
    # Ensure env expected values (they're in backend/.env already)
    os.environ["EMAIL_FROM"] = "noreply@bankezee.com"
    os.environ["EMAIL_FROM_NAME"] = "BankEzee"

    # Reimport module to pick up env
    import importlib
    from utils import email_service
    importlib.reload(email_service)

    result = asyncio.get_event_loop().run_until_complete(email_service._resolve_sender())
    assert result == "BankEzee <noreply@bankezee.com>", f"Got: {result!r}"


# ---- Settings integrations includes sender_name ----
def test_get_integrations_has_sender_name(admin_headers):
    r = requests.get(f"{BASE_URL}/api/settings/integrations", headers=admin_headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "sender_name" in body, f"sender_name missing in: {list(body.keys())}"
    assert "sender_email" in body


def test_post_integrations_accepts_sender_name(admin_headers):
    payload = {"sender_name": "BankEzee", "sender_email": "noreply@bankezee.com"}
    r = requests.post(f"{BASE_URL}/api/settings/integrations", json=payload, headers=admin_headers)
    assert r.status_code == 200, r.text
    assert r.json().get("success") is True

    # Verify persistence
    g = requests.get(f"{BASE_URL}/api/settings/integrations", headers=admin_headers)
    body = g.json()
    assert body.get("sender_name") == "BankEzee"
    assert body.get("sender_email") == "noreply@bankezee.com"


# ---- Meta reporting regression ----
def test_meta_reports_summary_lifetime(admin_headers):
    r = requests.get(f"{BASE_URL}/api/meta/reports/summary",
                     params={"period": "lifetime"}, headers=admin_headers)
    assert r.status_code == 200, r.text
    data = r.json()
    # Expected shape from prior iterations: overall + partners (or rows)
    assert isinstance(data, dict)
    # Check that overall == sum of partner rows for total_leads if both exist
    overall = data.get("overall") or data.get("totals") or {}
    rows = data.get("partners") or data.get("rows") or []
    if overall and rows:
        for key in ("total_leads", "leads", "total_calls", "calls"):
            if key in overall:
                partner_sum = sum((r.get(key) or 0) for r in rows)
                assert overall[key] == partner_sum, f"{key}: overall={overall[key]} partners_sum={partner_sum}"
                break


def test_meta_reports_hourly(admin_headers):
    r = requests.get(f"{BASE_URL}/api/meta/reports/hourly", headers=admin_headers)
    assert r.status_code == 200, r.text
    data = r.json()
    assert isinstance(data, (list, dict))
