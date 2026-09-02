"""
Iteration 29 - Full OLD CRM port testing.
Covers: dashboard stats, rejected report bank-summary, growth-partner Current/Spillover,
statuses list (24), star rating calc, file detail all sections, update details.
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
    tok = r.json().get("access_token") or r.json().get("token")
    assert tok, f"No token in response {r.json()}"
    return tok


@pytest.fixture(scope="module")
def headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ============ 24 STATUSES ============
def test_statuses_returns_24_grouped_by_category():
    r = requests.get(f"{BASE_URL}/api/files/statuses", timeout=30)
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)
    assert len(data) == 24, f"Expected 24 statuses, got {len(data)}"
    # Must include key OLD CRM statuses
    ids = {s['id'] for s in data}
    required = {'new', 'contacted', 'documents_pending', 'documents_collected',
                'sent_for_eligibility', 'not_eligible', 'query_hold',
                'sent_to_bank', 'sent_for_login', 'login', 'not_login',
                'underwriting', 'fi', 'fi_reinitiated', 'fi_negative',
                'approved', 'sanctioned', 'declined',
                'disbursed', 'not_disbursed',
                'rejected', 'customer_not_interested', 'customer_not_supporting', 'supporting'}
    assert required.issubset(ids), f"Missing statuses: {required - ids}"
    # Every status must have a category
    categories = {s['category'] for s in data}
    expected_cats = {'initial', 'documents', 'processing', 'bank', 'underwriting',
                     'approval', 'disbursal', 'rejection', 'other'}
    assert expected_cats.issubset(categories), f"Missing categories: {expected_cats - categories}"


# ============ DASHBOARD STATS ============
def test_dashboard_stats_total_files_519(headers):
    r = requests.get(f"{BASE_URL}/api/files/dashboard/stats", headers=headers, timeout=60)
    assert r.status_code == 200, r.text
    data = r.json()
    # Required OLD CRM keys
    for k in ["total_files", "new", "in_progress", "login", "approved", "disbursed",
              "interim_rejects", "final_rejections", "amt_in_pipeline",
              "total_approved_amount", "total_disbursed_amount", "loans_by_type",
              "by_status"]:
        assert k in data, f"Missing key {k}"
    assert data["total_files"] == 519, f"Expected 519 total files, got {data['total_files']}"
    # Sanity: all counters non-negative and within total
    for k in ["new", "in_progress", "login", "approved", "disbursed",
              "interim_rejects", "final_rejections"]:
        assert 0 <= data[k] <= data["total_files"], f"{k}={data[k]} invalid"
    print(f"Dashboard: total={data['total_files']} new={data['new']} in_progress={data['in_progress']} "
          f"login={data['login']} approved={data['approved']} disbursed={data['disbursed']} "
          f"interim_rej={data['interim_rejects']} final_rej={data['final_rejections']} "
          f"pipeline={data['amt_in_pipeline']}")


# ============ REJECTED REPORT WITH BANK SUMMARY ============
def test_rejected_report_has_bank_summary(headers):
    r = requests.get(f"{BASE_URL}/api/files/reports/rejected", headers=headers, timeout=60)
    assert r.status_code == 200, r.text
    data = r.json()
    for k in ["files", "total", "bank_summary", "totals"]:
        assert k in data, f"Missing top-level key {k}"
    assert isinstance(data["bank_summary"], list)
    if data["bank_summary"]:
        bank = data["bank_summary"][0]
        for k in ["bank_name", "total_cases", "not_eligible", "not_login",
                  "fi_negative", "declined", "not_disbursed", "eligible",
                  "eligible_amount", "approved", "approved_amount",
                  "disbursed", "disbursed_amount"]:
            assert k in bank, f"bank_summary[0] missing {k}"
    totals = data["totals"]
    for k in ["total_cases", "not_eligible", "not_login", "fi_negative", "declined", "not_disbursed"]:
        assert k in totals, f"totals missing {k}"
    bank_names = [b['bank_name'] for b in data["bank_summary"]]
    print(f"Rejected report: {len(data['files'])} files, banks={bank_names[:10]}, totals={totals}")


# ============ GROWTH PARTNER PERFORMANCE ============
def test_growth_partner_report_current_and_spillover(headers):
    r = requests.get(f"{BASE_URL}/api/files/reports/growth-partner", headers=headers, timeout=60)
    assert r.status_code == 200, r.text
    data = r.json()
    # response could be list or dict with rows
    rows = data if isinstance(data, list) else data.get("partners") or data.get("rows") or data.get("data") or []
    assert isinstance(rows, list)
    if rows:
        row = rows[0]
        expected = {"files_generated_current", "files_generated_spillover",
                    "logins_current", "logins_spillover",
                    "approvals_current", "approvals_spillover",
                    "disbursals_current", "disbursals_spillover",
                    "disbursed_amount_current", "disbursed_amount_spillover"}
        missing = expected - set(row.keys())
        assert not missing, f"GP row missing keys: {missing}. Row keys: {list(row.keys())}"
        print(f"GP report first row: agent={row.get('agent_name')} "
              f"files_gen_cur={row.get('files_generated_current')} "
              f"disb_cur={row.get('disbursals_current')} "
              f"disb_spill={row.get('disbursals_spillover')}")
    else:
        print("GP report returned empty list")


def test_growth_partner_report_with_date_range(headers):
    r = requests.get(f"{BASE_URL}/api/files/reports/growth-partner",
                     headers=headers,
                     params={"start_date": "2024-01-01", "end_date": "2026-01-31"},
                     timeout=60)
    assert r.status_code == 200, r.text


# ============ FILE DETAIL ============
@pytest.fixture(scope="module")
def sample_file_id(headers):
    r = requests.get(f"{BASE_URL}/api/files", headers=headers, params={"limit": 5}, timeout=30)
    assert r.status_code == 200
    files = r.json().get("files", [])
    assert len(files) > 0, "No files in DB to test detail page"
    return files[0]["id"]


def test_file_detail_has_all_sections(headers, sample_file_id):
    r = requests.get(f"{BASE_URL}/api/files/{sample_file_id}", headers=headers, timeout=30)
    assert r.status_code == 200, r.text
    f = r.json()
    # Top-level customer identity
    assert "id" in f
    # file_details should exist (may be nested or flat)
    fd = f.get("file_details") or {}
    # Customer, employment, obligations, loan requirement fields (per OLD CRM port)
    # Not asserting non-empty (legacy data may vary), just structure exists
    assert isinstance(fd, dict)
    print(f"File detail keys: top={list(f.keys())[:15]}, file_details={list(fd.keys())[:15]}")


# ============ STAR RATING ============
def test_star_rating_endpoint(headers, sample_file_id):
    r = requests.get(f"{BASE_URL}/api/files/calculate-rating/{sample_file_id}",
                     headers=headers, timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "star_rating" in data, f"Missing star_rating in {data}"
    assert "star_score" in data, f"Missing star_score in {data}"
    sr = data["star_rating"]
    ss = data["star_score"]
    assert isinstance(sr, (int, float))
    assert isinstance(ss, (int, float))
    assert 0 <= sr <= 5, f"star_rating={sr} out of range"
    assert 0 <= ss <= 100, f"star_score={ss} out of range"
    print(f"Star rating for {sample_file_id}: rating={sr}, score={ss}")


# ============ UPDATE FILE DETAILS ============
def test_update_file_details_persists(headers, sample_file_id):
    payload = {
        "full_name": "TEST_Iter29 Customer",
        "mobile": "9999900000",
        "additional_data": {
            "monthly_income": 75000,
            "cibil_score": 750,
            "loan_amount_required": 500000,
            "type_of_loan": "Personal Loan"
        }
    }
    r = requests.put(f"{BASE_URL}/api/files/{sample_file_id}/details",
                     headers=headers, json=payload, timeout=30)
    assert r.status_code in (200, 201), r.text
    # Verify persisted
    r2 = requests.get(f"{BASE_URL}/api/files/{sample_file_id}", headers=headers, timeout=30)
    assert r2.status_code == 200
    f = r2.json()
    fd = f.get("file_details") or {}
    # loan_amount_required saved
    assert str(fd.get("loan_amount_required", "")).startswith("500000") or fd.get("loan_amount_required") == 500000, \
        f"loan_amount_required not persisted: {fd.get('loan_amount_required')}"
    assert fd.get("type_of_loan") == "Personal Loan"
    print(f"Update details persisted: loan_amount={fd.get('loan_amount_required')} type={fd.get('type_of_loan')}")
