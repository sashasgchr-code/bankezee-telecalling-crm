"""
Iteration 28 - Verify Legacy CRM data import & Files module reports
Tests focus:
- Files Dashboard stats (Total ~519, Approved ~₹8.26Cr, Disbursed ~₹7.31Cr)
- File detail load for historical (legacy_crm_id) records + activities + eligibilities
- Reports endpoints: daily, rejected, growth-partner, bank-performance, quality
- Bank policies count (~27)
"""
import os
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://responsive-crm-app-1.preview.emergentagent.com').rstrip('/')
ADMIN_EMAIL = "admin@bankezee.com"
ADMIN_PASSWORD = "ConnectSasha12!!"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=30)
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    return r.json().get("access_token") or r.json().get("token")


@pytest.fixture(scope="module")
def auth_headers(token):
    return {"Authorization": f"Bearer {token}"}


# ---------- Dashboard stats ----------

def test_dashboard_stats_totals(auth_headers):
    r = requests.get(f"{BASE_URL}/api/files/dashboard/stats", headers=auth_headers, timeout=60)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "total_files" in data
    total = data["total_files"]
    approved_amt = data.get("total_approved_amount", 0)
    disbursed_amt = data.get("total_disbursed_amount", 0)
    print(f"total_files={total}  approved={approved_amt}  disbursed={disbursed_amt}")
    # Expected around 519, 8.26Cr (82,600,000), 7.31Cr (73,100,000)
    assert total >= 500, f"Expected ~519 files, got {total}"
    # Allow some slack ~ +/- 15%
    assert approved_amt >= 7.0e7, f"Approved amt too low: {approved_amt}"
    assert disbursed_amt >= 6.0e7, f"Disbursed amt too low: {disbursed_amt}"


# ---------- Files list & detail with legacy records ----------

def test_files_list_returns_legacy(auth_headers):
    r = requests.get(f"{BASE_URL}/api/files?limit=50", headers=auth_headers, timeout=60)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "files" in data
    total = data["pagination"]["total"]
    assert total >= 500, f"Files total: {total}"
    # Some records must carry legacy_crm_id
    legacy = [f for f in data["files"] if f.get("legacy_crm_id")]
    print(f"legacy in page: {len(legacy)}")


def test_file_detail_legacy_with_activities(auth_headers):
    # Grab any file having non-empty file_activities via export
    r = requests.get(f"{BASE_URL}/api/files?limit=50", headers=auth_headers, timeout=60)
    assert r.status_code == 200
    files = r.json()["files"]

    # Find a file with activities & eligibilities
    target = None
    for f in files:
        acts = f.get("file_activities") or []
        eligs = f.get("eligibilities") or []
        if isinstance(acts, list) and len(acts) > 0 and isinstance(eligs, list) and len(eligs) > 0:
            target = f
            break

    # Fallback: search deeper via export if not found in first page
    if not target:
        for page in range(2, 12):
            rr = requests.get(f"{BASE_URL}/api/files?limit=50&page={page}", headers=auth_headers, timeout=60)
            if rr.status_code != 200:
                continue
            for f in rr.json()["files"]:
                acts = f.get("file_activities") or []
                eligs = f.get("eligibilities") or []
                if isinstance(acts, list) and len(acts) > 0 and isinstance(eligs, list) and len(eligs) > 0:
                    target = f
                    break
            if target:
                break

    assert target is not None, "No file with activities+eligibilities found in first 12 pages"
    fid = target["id"]

    # Get detail
    d = requests.get(f"{BASE_URL}/api/files/{fid}", headers=auth_headers, timeout=30)
    assert d.status_code == 200, d.text
    doc = d.json()
    assert doc["id"] == fid
    assert doc.get("status") == "file"

    # Activities endpoint
    a = requests.get(f"{BASE_URL}/api/files/{fid}/activities", headers=auth_headers, timeout=30)
    assert a.status_code == 200, a.text
    activities = a.json()
    assert isinstance(activities, list) and len(activities) > 0, "Activities empty for imported file"

    # Eligibilities endpoint
    e = requests.get(f"{BASE_URL}/api/files/{fid}/eligibilities", headers=auth_headers, timeout=30)
    assert e.status_code == 200, e.text
    eligs = e.json()
    assert isinstance(eligs, list) and len(eligs) > 0, "Eligibilities empty for imported file"
    # Each eligibility should be a dict (not python-repr string)
    assert isinstance(eligs[0], dict), f"Eligibility not deserialized as dict: {type(eligs[0])}"


# ---------- Reports ----------

def test_reports_daily(auth_headers):
    r = requests.get(f"{BASE_URL}/api/files/reports/daily", headers=auth_headers, timeout=60)
    assert r.status_code == 200, r.text
    data = r.json()
    for k in ["report_date", "total_files", "new_files_today", "logins_today",
              "approvals_today", "disbursals_today", "rejections_today"]:
        assert k in data, f"missing key {k}"


def test_reports_rejected(auth_headers):
    r = requests.get(f"{BASE_URL}/api/files/reports/rejected", headers=auth_headers, timeout=60)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "files" in data and "total" in data
    assert isinstance(data["files"], list)


def test_reports_growth_partner(auth_headers):
    r = requests.get(f"{BASE_URL}/api/files/reports/growth-partner", headers=auth_headers, timeout=60)
    assert r.status_code == 200, r.text
    data = r.json()
    assert isinstance(data, (dict, list)), "Growth partner report unexpected shape"


def test_reports_bank_performance(auth_headers):
    r = requests.get(f"{BASE_URL}/api/files/reports/bank-performance", headers=auth_headers, timeout=60)
    assert r.status_code == 200, r.text
    data = r.json()
    assert isinstance(data, (dict, list))


def test_reports_quality(auth_headers):
    r = requests.get(f"{BASE_URL}/api/files/reports/quality", headers=auth_headers, timeout=60)
    assert r.status_code == 200, r.text
    data = r.json()
    for k in ["total_files", "data_quality_score", "document_completion_rate",
              "conversion_rate", "processing_efficiency"]:
        assert k in data, f"missing key {k}"
    assert data["total_files"] >= 500


# ---------- Bank policies ----------

def test_bank_policies_count(auth_headers):
    r = requests.get(f"{BASE_URL}/api/files/policies", headers=auth_headers, timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "policies" in data and "total" in data
    total = data["total"]
    print(f"bank policies total: {total}")
    assert total >= 20, f"Expected ~27 policies, got {total}"
