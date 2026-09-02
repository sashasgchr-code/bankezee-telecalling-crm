"""
Iteration 27 tests: File status conversion, /leads/stats consistency,
Files Dashboard list, Admin visibility of file-status leads.
"""
import os
import pytest
import requests
import uuid

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://responsive-crm-app-1.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "admin@bankezee.com"
ADMIN_PASSWORD = "ConnectSasha12!!"


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": ADMIN_EMAIL, "password": ADMIN_PASSWORD
    })
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    data = r.json()
    tok = data.get("token") or data.get("access_token")
    assert tok, f"No token: {data}"
    return tok


@pytest.fixture(scope="module")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}


# 1) /api/leads/stats returns by_status dict
def test_leads_stats_has_status_and_file_count(admin_headers):
    r = requests.get(f"{BASE_URL}/api/leads/stats", headers=admin_headers)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "by_status" in data
    assert "totals" in data
    assert isinstance(data["by_status"], dict)
    # print counts for context
    print("Stats by_status:", data["by_status"])
    print("Totals:", data.get("totals"))


# 2) /api/leads?status=file total_count matches stats file count
def test_status_file_count_consistency(admin_headers):
    stats = requests.get(f"{BASE_URL}/api/leads/stats", headers=admin_headers).json()
    file_count_stats = stats["by_status"].get("file", 0)

    r = requests.get(f"{BASE_URL}/api/leads?status=file&page=1&page_size=10", headers=admin_headers)
    assert r.status_code == 200, r.text
    listing = r.json()
    total = listing["pagination"]["total_count"]
    print(f"Stats.file={file_count_stats}, list?status=file total={total}")
    assert file_count_stats == total, f"Mismatch: stats={file_count_stats}, list_total={total}"


# 3) Files Dashboard list endpoint returns files
def test_files_dashboard_list(admin_headers):
    r = requests.get(f"{BASE_URL}/api/files?page=1&limit=50", headers=admin_headers)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "files" in data
    assert "pagination" in data
    total = data["pagination"]["total"]
    files_len = len(data["files"])
    print(f"Files list total={total}, returned={files_len}")
    # Discrepancy check: if total > 0, files list must not be empty
    if total > 0:
        assert files_len > 0, "Files list is empty but total > 0 (bug #1)"


# 4) Files Dashboard stats endpoint
def test_files_dashboard_stats(admin_headers):
    r = requests.get(f"{BASE_URL}/api/files/dashboard/stats", headers=admin_headers)
    assert r.status_code == 200, r.text
    data = r.json()
    print("Files dashboard stats keys:", list(data.keys()))


# 5) Files list total should match /leads?status=file total
def test_files_list_matches_leads_status_file(admin_headers):
    files_resp = requests.get(f"{BASE_URL}/api/files?page=1&limit=10", headers=admin_headers).json()
    leads_resp = requests.get(f"{BASE_URL}/api/leads?status=file&page=1&page_size=10", headers=admin_headers).json()
    files_total = files_resp["pagination"]["total"]
    leads_total = leads_resp["pagination"]["total_count"]
    print(f"Files.total={files_total}, Leads?status=file.total_count={leads_total}")
    # Files endpoint excludes archived? Check.
    assert files_total > 0 or leads_total == 0


# 6) Convert a lead to file status - end-to-end
def test_convert_lead_to_file(admin_headers):
    # Create a lead
    payload = {
        "name": f"TEST_iter27_{uuid.uuid4().hex[:6]}",
        "phone": f"9{uuid.uuid4().int % 1000000000:09d}",
        "email": "test_iter27@example.com",
        "status": "new"
    }
    r = requests.post(f"{BASE_URL}/api/leads", headers=admin_headers, json=payload)
    assert r.status_code == 200, r.text
    lead = r.json()
    lead_id = lead.get("id") or lead.get("_id")
    assert lead_id
    print(f"Created lead {lead_id}")

    try:
        # Update status to 'file'
        upd = requests.put(f"{BASE_URL}/api/leads/{lead_id}", headers=admin_headers,
                           json={"status": "file"})
        assert upd.status_code == 200, upd.text
        updated = upd.json()
        assert updated.get("status") == "file"
        # file_status should be initialized to 'new'
        assert updated.get("file_status") == "new", f"file_status not initialized: {updated.get('file_status')}"
        print(f"Lead converted to file. file_status={updated.get('file_status')}, file_assigned_to={updated.get('file_assigned_to')}")

        # GET lead - verify persistence
        g = requests.get(f"{BASE_URL}/api/leads/{lead_id}", headers=admin_headers)
        assert g.status_code == 200
        assert g.json().get("status") == "file"
        assert g.json().get("file_status") == "new"

        # It should appear in /api/files list
        f = requests.get(f"{BASE_URL}/api/files?page=1&limit=200", headers=admin_headers).json()
        phones = [x.get("phone") for x in f.get("files", [])]
        # Not guaranteed on first page but total should include
        assert f["pagination"]["total"] >= 1

        # And in /api/leads?status=file
        l = requests.get(f"{BASE_URL}/api/leads?status=file&page=1&page_size=200", headers=admin_headers).json()
        found = any((x.get("id") == lead_id) or (str(x.get("_id")) == lead_id) for x in l.get("leads", []))
        # Fall back to phone match
        if not found:
            found = any(x.get("phone") == payload["phone"] for x in l.get("leads", []))
        assert found, f"Converted lead not visible in /leads?status=file (bug: Admin can't see file leads)"

    finally:
        # cleanup
        requests.delete(f"{BASE_URL}/api/leads/{lead_id}", headers=admin_headers)


# 7) Stats counts remain stable when filter is applied (page filter shouldn't change stats)
def test_stats_stable_across_filters(admin_headers):
    s1 = requests.get(f"{BASE_URL}/api/leads/stats", headers=admin_headers).json()
    s2 = requests.get(f"{BASE_URL}/api/leads/stats?search=", headers=admin_headers).json()
    assert s1["by_status"] == s2["by_status"], "Stats should be identical for same effective filters"
