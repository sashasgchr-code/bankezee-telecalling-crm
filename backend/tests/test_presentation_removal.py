"""Tests confirming 'presentation' status removed from user-facing status list."""
import os
import requests
import pytest

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://responsive-crm-app-1.preview.emergentagent.com').rstrip('/')

ADMIN = {"email": "admin@bankezee.com", "password": "ConnectSasha12!!"}
TC = {"email": "teja@bankezee.com", "password": "tejasme12"}


def _login(creds):
    r = requests.post(f"{BASE_URL}/api/auth/login", json=creds, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json().get("token") or r.json().get("access_token")


@pytest.fixture(scope="module")
def admin_hdr():
    return {"Authorization": f"Bearer {_login(ADMIN)}"}


@pytest.fixture(scope="module")
def tc_hdr():
    return {"Authorization": f"Bearer {_login(TC)}"}


def test_statuses_endpoint_no_presentation(admin_hdr):
    r = requests.get(f"{BASE_URL}/api/statuses", headers=admin_hdr, timeout=30)
    assert r.status_code == 200
    data = r.json()
    ids = [s["id"] for s in data]
    assert "presentation" not in ids
    assert set(ids) == {"not_interested", "follow_up", "leads", "file"}, f"Got {ids}"


def test_admin_dashboard_stats(admin_hdr):
    r = requests.get(f"{BASE_URL}/api/dashboard/stats?period=today", headers=admin_hdr, timeout=30)
    assert r.status_code == 200
    data = r.json()
    assert "leads_by_status" in data
    # presentation key may still be present as historical data, but should not be UI-only concern
    print("leads_by_status keys:", list(data["leads_by_status"].keys()))


def test_telecaller_dashboard_stats(tc_hdr):
    r = requests.get(f"{BASE_URL}/api/dashboard/stats?period=today", headers=tc_hdr, timeout=30)
    assert r.status_code == 200
    data = r.json()
    assert "leads_by_status" in data


def test_admin_reports_telecallers(admin_hdr):
    r = requests.get(f"{BASE_URL}/api/reports/telecallers?period=today", headers=admin_hdr, timeout=30)
    assert r.status_code == 200
    data = r.json()
    assert "telecallers" in data
    assert "overall" in data


def test_hourly_report(admin_hdr):
    r = requests.get(f"{BASE_URL}/api/reports/hourly", headers=admin_hdr, timeout=30)
    assert r.status_code == 200
    data = r.json()
    assert "telecallers" in data
    assert "overall_hourly" in data


def test_admin_leads_pagination(admin_hdr):
    r = requests.get(f"{BASE_URL}/api/leads?page=1&limit=25", headers=admin_hdr, timeout=30)
    assert r.status_code == 200


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
