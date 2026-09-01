"""
Tests for Stage 2-5 features:
- Bulk Select All (POST /api/leads/select-all-ids)
- Suppression List (GET/POST /api/suppression-list)
- Archive (POST /api/leads/archive)
- Import Batches (GET /api/import-batches)
- Excel Export (POST /api/leads/export)
"""
import os
import io
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL") or open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].split("\n")[0].strip()
BASE_URL = BASE_URL.rstrip("/")

ADMIN_EMAIL = "admin@bankezee.com"
ADMIN_PASSWORD = "ConnectSasha12!!"
AGENT_EMAIL = "agent@test.com"
AGENT_PASSWORD = "agent123"


@pytest.fixture(scope="session")
def admin_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, f"Admin login failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="session")
def agent_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": AGENT_EMAIL, "password": AGENT_PASSWORD})
    assert r.status_code == 200, f"Agent login failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}


@pytest.fixture
def agent_headers(agent_token):
    return {"Authorization": f"Bearer {agent_token}", "Content-Type": "application/json"}


# ---------- Stage 2: Select All Filtered ----------

class TestSelectAllIds:
    def test_select_all_ids_returns_shape(self, admin_headers):
        r = requests.post(f"{BASE_URL}/api/leads/select-all-ids", headers=admin_headers, json={})
        assert r.status_code == 200, r.text
        data = r.json()
        assert "lead_ids" in data and "count" in data
        assert isinstance(data["lead_ids"], list)
        assert data["count"] == len(data["lead_ids"])

    def test_select_all_ids_matches_total_count(self, admin_headers):
        # Fetch total via /api/leads
        lr = requests.get(f"{BASE_URL}/api/leads?page=1&page_size=10", headers=admin_headers)
        assert lr.status_code == 200
        total = lr.json()["pagination"]["total_count"]
        r = requests.post(f"{BASE_URL}/api/leads/select-all-ids", headers=admin_headers, json={})
        assert r.status_code == 200
        assert r.json()["count"] == total

    def test_select_all_ids_with_status_filter(self, admin_headers):
        r = requests.post(f"{BASE_URL}/api/leads/select-all-ids", headers=admin_headers,
                          json={"statuses": "new"})
        assert r.status_code == 200
        assert isinstance(r.json()["lead_ids"], list)

    def test_select_all_ids_telecaller_scoped(self, agent_headers):
        r = requests.post(f"{BASE_URL}/api/leads/select-all-ids", headers=agent_headers, json={})
        assert r.status_code == 200
        assert "lead_ids" in r.json()


# ---------- Stage 3: Suppression List ----------

class TestSuppressionList:
    def test_get_suppression_list_paginated(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/suppression-list", headers=admin_headers)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "entries" in data and "pagination" in data
        assert isinstance(data["entries"], list)
        pag = data["pagination"]
        for k in ("page", "page_size", "total_count", "total_pages"):
            assert k in pag

    def test_add_suppression_entry(self, admin_headers):
        phone = "9990001234"
        r = requests.post(f"{BASE_URL}/api/suppression-list", headers=admin_headers,
                          json={"phone": phone, "reason": "wrong_number", "notes": "TEST"})
        assert r.status_code == 200, r.text
        data = r.json()
        assert "message" in data
        # Add again should return already_exists
        r2 = requests.post(f"{BASE_URL}/api/suppression-list", headers=admin_headers,
                           json={"phone": phone, "reason": "wrong_number"})
        assert r2.status_code == 200
        assert r2.json().get("already_exists") is True

        # GET should include it
        g = requests.get(f"{BASE_URL}/api/suppression-list?search=9990001234", headers=admin_headers)
        assert g.status_code == 200
        assert g.json()["pagination"]["total_count"] >= 1

        # Cleanup: DELETE
        d = requests.delete(f"{BASE_URL}/api/suppression-list/{phone}", headers=admin_headers)
        assert d.status_code == 200

    def test_telecaller_forbidden_from_suppression_list(self, agent_headers):
        r = requests.get(f"{BASE_URL}/api/suppression-list", headers=agent_headers)
        assert r.status_code in (401, 403)


# ---------- Stage 4: Archive & Import Batches ----------

class TestArchiveAndImportBatches:
    def test_get_import_batches(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/import-batches", headers=admin_headers)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "batches" in data and "pagination" in data
        assert isinstance(data["batches"], list)

    def test_archive_requires_ids_or_filter(self, admin_headers):
        r = requests.post(f"{BASE_URL}/api/leads/archive", headers=admin_headers,
                          json={"archive": True})
        assert r.status_code == 400

    def test_archive_and_unarchive_lead(self, admin_headers):
        # Get a lead to archive
        lr = requests.get(f"{BASE_URL}/api/leads?page=1&page_size=10", headers=admin_headers)
        assert lr.status_code == 200
        leads = lr.json()["leads"]
        if not leads:
            pytest.skip("No leads available for archive test")
        lid = leads[0]["id"]

        # Archive
        a = requests.post(f"{BASE_URL}/api/leads/archive", headers=admin_headers,
                         json={"lead_ids": [lid], "archive": True})
        assert a.status_code == 200, a.text
        assert a.json()["modified_count"] >= 1

        # Verify lead no longer in default listing
        lr2 = requests.get(f"{BASE_URL}/api/leads?page=1&page_size=100", headers=admin_headers)
        active_ids = [l["id"] for l in lr2.json()["leads"]]
        assert lid not in active_ids

        # Verify visible in archived filter
        lr3 = requests.get(f"{BASE_URL}/api/leads?page=1&page_size=100&archived=true", headers=admin_headers)
        assert lr3.status_code == 200
        arch_ids = [l["id"] for l in lr3.json()["leads"]]
        assert lid in arch_ids

        # Unarchive
        u = requests.post(f"{BASE_URL}/api/leads/archive", headers=admin_headers,
                         json={"lead_ids": [lid], "archive": False})
        assert u.status_code == 200
        assert u.json()["modified_count"] >= 1


# ---------- Stage 5: Excel Export ----------

class TestExport:
    def test_export_returns_xlsx(self, admin_headers):
        # Note: StreamingResponse - use POST
        headers = {**admin_headers}
        r = requests.post(f"{BASE_URL}/api/leads/export", headers=headers, json={})
        # If no leads matching, 404. Otherwise should return xlsx
        if r.status_code == 404:
            pytest.skip("No leads to export")
        assert r.status_code == 200, r.text
        ct = r.headers.get("content-type", "")
        assert "spreadsheetml" in ct or "octet-stream" in ct, f"Unexpected content-type: {ct}"
        cd = r.headers.get("content-disposition", "")
        assert "attachment" in cd and ".xlsx" in cd
        # Content should be > 100 bytes (valid xlsx)
        assert len(r.content) > 100

    def test_export_respects_status_filter(self, admin_headers):
        r = requests.post(f"{BASE_URL}/api/leads/export", headers=admin_headers,
                          json={"statuses": "nonexistent_status_zzz"})
        assert r.status_code == 404  # No leads match

    def test_export_telecaller_scoped(self, agent_headers):
        r = requests.post(f"{BASE_URL}/api/leads/export", headers=agent_headers, json={})
        # Either 200 or 404 based on assignment
        assert r.status_code in (200, 404)
