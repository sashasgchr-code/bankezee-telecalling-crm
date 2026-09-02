"""Iter33: Test the 4 OLD-CRM-parity report endpoints (rejected, growth-partner, quality, sales-ops)."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://responsive-crm-app-1.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "admin@bankezee.com"
ADMIN_PASSWORD = "ConnectSasha12!!"


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=30)
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    data = r.json()
    token = data.get("access_token") or data.get("token")
    assert token, f"No token in login response: {data}"
    return token


@pytest.fixture(scope="module")
def headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}


# ---------------- Rejected Cases Report ----------------
class TestRejectedReport:
    def test_rejected_no_filters(self, headers):
        r = requests.get(f"{BASE_URL}/api/files/reports/rejected", headers=headers, timeout=60)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "summary" in data
        s = data["summary"]
        for key in ["total", "not_eligible", "not_login", "fi_negative", "declined", "not_disbursed"]:
            assert key in s, f"Missing summary key {key}"
            assert isinstance(s[key], int), f"{key} not int: {s[key]}"
        assert "cases" in data
        assert isinstance(data["cases"], list)

    def test_rejected_with_date_range(self, headers):
        r = requests.get(f"{BASE_URL}/api/files/reports/rejected",
                         params={"start_date": "2024-01-01", "end_date": "2026-12-31"},
                         headers=headers, timeout=60)
        assert r.status_code == 200
        d = r.json()
        assert "summary" in d and "cases" in d

    def test_rejected_no_mongodb_id_leak(self, headers):
        r = requests.get(f"{BASE_URL}/api/files/reports/rejected", headers=headers, timeout=60)
        assert r.status_code == 200
        for c in r.json().get("cases", [])[:5]:
            assert "_id" not in c, f"MongoDB _id leaked: {c}"


# ---------------- Growth Partner Performance ----------------
class TestGrowthPartnerReport:
    def test_gp_basic(self, headers):
        r = requests.get(f"{BASE_URL}/api/files/reports/growth-partner",
                         params={"start_date": "2024-01-01", "end_date": "2026-12-31"},
                         headers=headers, timeout=90)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "gps" in data and isinstance(data["gps"], list)
        assert "summary" in data and isinstance(data["summary"], dict)
        s = data["summary"]
        for k in ["total_gps", "files_generated", "login", "approved", "disbursed"]:
            assert k in s, f"Missing summary key {k}"

    def test_gp_row_shape(self, headers):
        r = requests.get(f"{BASE_URL}/api/files/reports/growth-partner",
                         params={"start_date": "2024-01-01", "end_date": "2026-12-31"},
                         headers=headers, timeout=90)
        data = r.json()
        if data["gps"]:
            gp = data["gps"][0]
            for k in ["name", "files_generated", "login_current", "login_spillover",
                      "approved", "disbursed_current", "disbursed_spillover"]:
                assert k in gp, f"GP row missing {k}: {gp.keys()}"


# ---------------- Quality Report ----------------
class TestQualityReport:
    def test_quality_basic(self, headers):
        r = requests.get(f"{BASE_URL}/api/files/reports/quality",
                         params={"start_date": "2024-01-01", "end_date": "2026-12-31"},
                         headers=headers, timeout=90)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "star_distribution" in data
        sd = data["star_distribution"]
        # keys should be 1..5 (either int or str)
        star_keys = {str(k) for k in sd.keys()}
        for s in ["1", "2", "3", "4", "5"]:
            assert s in star_keys, f"star_distribution missing key {s}: {sd}"
        assert "by_growth_partner" in data
        assert isinstance(data["by_growth_partner"], list)

    def test_quality_with_loan_type_filter(self, headers):
        r = requests.get(f"{BASE_URL}/api/files/reports/quality",
                         params={"loan_type": "New Personal Loan"},
                         headers=headers, timeout=90)
        assert r.status_code == 200


# ---------------- Sales & Ops Report ----------------
class TestSalesOpsReport:
    def test_sales_ops_basic(self, headers):
        r = requests.get(f"{BASE_URL}/api/files/reports/sales-ops",
                         params={"start_date": "2024-01-01", "end_date": "2026-12-31"},
                         headers=headers, timeout=120)
        assert r.status_code == 200, r.text
        data = r.json()
        for k in ["volume", "team", "banks", "rejection"]:
            assert k in data, f"Missing top-level key {k}. Got: {list(data.keys())}"
        v = data["volume"]
        for k in ["total_files", "in_progress", "login", "approved", "disbursed",
                  "disbursed_amount", "pipeline_amount"]:
            assert k in v, f"volume missing {k}"
        assert isinstance(data["team"], dict)
        assert "gps" in data["team"]
        assert isinstance(data["banks"], list)


# ---------------- Auth guard ----------------
class TestAuthGuard:
    def test_rejected_no_auth(self):
        r = requests.get(f"{BASE_URL}/api/files/reports/rejected", timeout=30)
        assert r.status_code in (401, 403), f"Expected 401/403, got {r.status_code}"
