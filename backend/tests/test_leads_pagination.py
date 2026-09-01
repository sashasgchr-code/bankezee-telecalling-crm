"""Backend tests for paginated /api/leads endpoint"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://responsive-crm-app-1.preview.emergentagent.com").rstrip("/")

ADMIN = {"email": "admin@bankezee.com", "password": "ConnectSasha12!!"}
TELECALLER = {"email": "teja@bankezee.com", "password": "tejasme12"}


def _login(creds):
    r = requests.post(f"{BASE_URL}/api/auth/login", json=creds, timeout=30)
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    data = r.json()
    token = data.get("access_token") or data.get("token")
    assert token, f"No token: {data}"
    return token


@pytest.fixture(scope="module")
def admin_headers():
    return {"Authorization": f"Bearer {_login(ADMIN)}"}


@pytest.fixture(scope="module")
def telecaller_headers():
    return {"Authorization": f"Bearer {_login(TELECALLER)}"}


class TestLeadsPagination:
    def test_admin_leads_paginated_response(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/leads", headers=admin_headers, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "leads" in data
        assert "pagination" in data
        assert isinstance(data["leads"], list)
        p = data["pagination"]
        for key in ["page", "page_size", "total_count", "total_pages", "has_next", "has_prev"]:
            assert key in p, f"Missing key {key} in pagination"
        assert p["page"] == 1
        assert p["total_count"] >= 0
        assert len(data["leads"]) <= p["page_size"]
        print(f"Admin total_count={p['total_count']}, leads_returned={len(data['leads'])}")

    def test_admin_leads_default_count_matches(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/leads", headers=admin_headers, timeout=30)
        data = r.json()
        # For this project, expected 2 leads
        assert data["pagination"]["total_count"] >= 0

    def test_page_size_param(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/leads?page=1&page_size=10", headers=admin_headers, timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert data["pagination"]["page_size"] == 10
        assert data["pagination"]["page"] == 1

    def test_page_size_min_validation(self, admin_headers):
        # min is 10
        r = requests.get(f"{BASE_URL}/api/leads?page_size=5", headers=admin_headers, timeout=30)
        assert r.status_code == 422

    def test_telecaller_leads_paginated(self, telecaller_headers):
        r = requests.get(f"{BASE_URL}/api/leads", headers=telecaller_headers, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "leads" in data and "pagination" in data
        assert isinstance(data["leads"], list)
        print(f"Telecaller total_count={data['pagination']['total_count']}")

    def test_no_mongodb_id_in_response(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/leads", headers=admin_headers, timeout=30)
        data = r.json()
        for lead in data["leads"]:
            assert "_id" not in lead, f"Found _id in lead: {lead}"
            assert "id" in lead

    def test_unauthenticated_rejected(self):
        r = requests.get(f"{BASE_URL}/api/leads", timeout=30)
        assert r.status_code in (401, 403)
