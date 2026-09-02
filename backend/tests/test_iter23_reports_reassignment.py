"""
Iteration 23 - Tests for File Reassignment Block, Clean Slate, and Files Reports
Covers:
 - POST /api/leads/assign: file status skipped, pre-file resets to 'new'
 - GET /api/files/reports/daily
 - GET /api/files/reports/rejected
 - GET /api/files/reports/quality
 - GET /api/files/reports/growth-partner
 - GET /api/files/reports/bank-performance
 - GET /api/files/reports/tat-metrics
"""
import os
import pytest
import requests
from bson import ObjectId
from pymongo import MongoClient

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://responsive-crm-app-1.preview.emergentagent.com').rstrip('/')
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@bankezee.com"
ADMIN_PASSWORD = "ConnectSasha12!!"

MONGO_URL = os.environ.get('MONGO_URL', 'mongodb://localhost:27017')
DB_NAME = os.environ.get('DB_NAME', 'bankezee_connect')


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, f"Admin login failed: {r.status_code} {r.text}"
    body = r.json()
    return body.get("access_token") or body.get("token")


@pytest.fixture(scope="module")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture(scope="module")
def mongo_db():
    # Use the same DB the backend uses (backend loads .env)
    from pathlib import Path
    from dotenv import dotenv_values
    env = dotenv_values(Path('/app/backend/.env'))
    mongo_url = env.get('MONGO_URL') or MONGO_URL
    db_name = env.get('DB_NAME') or DB_NAME
    client = MongoClient(mongo_url)
    return client[db_name]


@pytest.fixture(scope="module")
def two_telecallers(mongo_db):
    tcs = list(mongo_db.users.find({"role": "telecaller", "is_active": True}).limit(2))
    if len(tcs) < 2:
        pytest.skip("Need at least 2 active telecallers")
    return tcs


# ============ File Reassignment Block ============

class TestFileReassignmentBlock:

    def test_assign_skips_file_status(self, admin_headers, mongo_db, two_telecallers):
        # Create a file-status lead and a normal lead assigned to TC1
        tc1, tc2 = two_telecallers[0], two_telecallers[1]
        tc1_id = str(tc1["_id"])
        tc2_id = str(tc2["_id"])

        file_lead = {
            "name": "TEST_FILE_reassign",
            "phone": "9990001111",
            "status": "file",
            "assigned_to": tc1_id,
            "telecaller_name": tc1["name"],
        }
        prefile_lead = {
            "name": "TEST_PREFILE_reassign",
            "phone": "9990002222",
            "status": "follow_up",
            "last_call_outcome": "interested",
            "assigned_to": tc1_id,
            "telecaller_name": tc1["name"],
        }
        f_id = mongo_db.leads.insert_one(file_lead).inserted_id
        p_id = mongo_db.leads.insert_one(prefile_lead).inserted_id

        try:
            payload = {
                "lead_ids": [str(f_id), str(p_id)],
                "user_id": tc2_id,
            }
            r = requests.post(f"{API}/leads/assign", json=payload, headers=admin_headers)
            assert r.status_code == 200, r.text
            data = r.json()

            # File was skipped
            assert "skipped_files" in data
            assert data["skipped_count"] == 1
            skipped_ids = [s["id"] for s in data["skipped_files"]]
            assert str(f_id) in skipped_ids

            # Pre-file was assigned
            assert data["assigned_count"] == 1

            # Verify DB state: file still on tc1, still status='file'
            fdoc = mongo_db.leads.find_one({"_id": f_id})
            assert fdoc["assigned_to"] == tc1_id
            assert fdoc["status"] == "file"

            # Verify pre-file lead moved to tc2 with CLEAN SLATE: status=new, outcome cleared
            pdoc = mongo_db.leads.find_one({"_id": p_id})
            assert pdoc["assigned_to"] == tc2_id
            assert pdoc["status"] == "new", f"Expected clean-slate 'new', got {pdoc.get('status')}"
            assert pdoc.get("last_call_outcome") in (None, "")
            assert pdoc.get("reassigned_from_status") == "follow_up"
        finally:
            mongo_db.leads.delete_many({"_id": {"$in": [f_id, p_id]}})
            mongo_db.lead_assignment_history.delete_many({"lead_id": {"$in": [str(f_id), str(p_id)]}})

    def test_check_reassignment_endpoint(self, admin_headers, mongo_db, two_telecallers):
        tc1 = two_telecallers[0]
        file_id = mongo_db.leads.insert_one({
            "name": "TEST_CHK_file", "phone": "9990003333",
            "status": "file", "assigned_to": str(tc1["_id"]),
        }).inserted_id
        eligible_id = mongo_db.leads.insert_one({
            "name": "TEST_CHK_new", "phone": "9990004444",
            "status": "new", "assigned_to": str(tc1["_id"]),
        }).inserted_id
        try:
            r = requests.post(f"{API}/leads/check-reassignment",
                              json=[str(file_id), str(eligible_id)],
                              headers=admin_headers)
            assert r.status_code == 200, r.text
            d = r.json()
            assert d["eligible_count"] == 1
            assert d["blocked_count"] == 1
            assert d["blocked"][0]["id"] == str(file_id)
            assert d["eligible"][0]["id"] == str(eligible_id)
        finally:
            mongo_db.leads.delete_many({"_id": {"$in": [file_id, eligible_id]}})


# ============ Files Reports ============

class TestFilesReports:

    def test_daily_report(self, admin_headers):
        r = requests.get(f"{API}/files/reports/daily", headers=admin_headers)
        assert r.status_code == 200, r.text
        d = r.json()
        for key in ["total_files", "new_files_today", "files_updated_today",
                    "logins_today", "approvals_today", "disbursals_today",
                    "rejections_today", "report_date"]:
            assert key in d, f"missing {key}"
        assert isinstance(d["total_files"], int)

    def test_daily_report_with_date(self, admin_headers):
        r = requests.get(f"{API}/files/reports/daily?report_date=2026-01-01", headers=admin_headers)
        assert r.status_code == 200, r.text
        assert r.json()["report_date"] == "2026-01-01"

    def test_rejected_report(self, admin_headers):
        r = requests.get(f"{API}/files/reports/rejected", headers=admin_headers)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "files" in d
        assert "total" in d
        assert isinstance(d["files"], list)
        assert d["total"] == len(d["files"])
        # Every file returned should have rejected-like status
        rejected_statuses = {'rejected', 'declined', 'not_eligible', 'not_login', 'not_disbursed', 'fi_negative'}
        for f in d["files"]:
            assert f.get("file_status") in rejected_statuses, f"Unexpected status: {f.get('file_status')}"

    def test_quality_report(self, admin_headers):
        r = requests.get(f"{API}/files/reports/quality", headers=admin_headers)
        assert r.status_code == 200, r.text
        d = r.json()
        for key in ["total_files", "data_quality_score", "document_completion_rate",
                    "conversion_rate", "processing_efficiency"]:
            assert key in d, f"missing {key}"
        # Scores must be 0..100
        for key in ["data_quality_score", "document_completion_rate",
                    "conversion_rate", "processing_efficiency"]:
            v = d[key]
            assert 0 <= v <= 100, f"{key}={v} out of range"

    def test_growth_partner_report(self, admin_headers):
        r = requests.get(f"{API}/files/reports/growth-partner", headers=admin_headers)
        assert r.status_code == 200, r.text
        d = r.json()
        # Accept either 'agents' or 'growth_partners' or list wrapper
        agents = d.get("agents") or d.get("growth_partners") or d.get("data") or d.get("results")
        assert agents is not None, f"No agent list in response: keys={list(d.keys())}"
        assert isinstance(agents, list)
        if agents:
            sample = agents[0]
            # Should contain files_generated / logins / approvals / disbursals-like fields
            expected_any = {"files_generated", "logins", "approvals", "disbursals",
                            "total_files", "name", "user_id", "growth_partner_name"}
            assert expected_any.intersection(sample.keys()), f"Sample keys: {list(sample.keys())}"

    def test_bank_performance_report(self, admin_headers):
        r = requests.get(f"{API}/files/reports/bank-performance", headers=admin_headers)
        assert r.status_code == 200, r.text
        d = r.json()
        banks = d.get("banks") or d.get("bank_stats") or d.get("data") or d.get("results")
        assert banks is not None, f"No banks list in response: keys={list(d.keys())}"
        assert isinstance(banks, list)

    def test_tat_metrics_report(self, admin_headers):
        r = requests.get(f"{API}/files/reports/tat-metrics", headers=admin_headers)
        assert r.status_code == 200, r.text
        d = r.json()
        # Look for timing-related fields
        keys = " ".join(d.keys()).lower()
        assert any(x in keys for x in ["tat", "login", "approval", "avg", "average"]), \
            f"No TAT-like keys: {list(d.keys())}"


# ============ Terminology quick sanity (endpoint exists) ============

class TestGeneralAvailability:
    def test_files_root(self, admin_headers):
        r = requests.get(f"{API}/files", headers=admin_headers)
        assert r.status_code in (200, 307)

    def test_files_reports_summary(self, admin_headers):
        r = requests.get(f"{API}/files/reports", headers=admin_headers)
        assert r.status_code == 200
        d = r.json()
        assert "summary" in d and "funnel" in d
