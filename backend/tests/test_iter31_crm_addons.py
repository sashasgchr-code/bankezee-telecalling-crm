"""
Iter31 - Tests for OLD CRM port additions:
- Commission Module (/api/files/commissions)
- Eligibility Check (/api/files/{id}/check-eligibility)
- Export Reports (dashboard, rejected, growth-partner, commissions)
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://responsive-crm-app-1.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "admin@bankezee.com"
ADMIN_PASSWORD = "ConnectSasha12!!"


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=30)
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text[:200]}"
    tok = r.json().get("access_token") or r.json().get("token")
    assert tok, f"No token: {r.json()}"
    return tok


@pytest.fixture(scope="module")
def headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture(scope="module")
def one_file_id(headers):
    r = requests.get(f"{BASE_URL}/api/files", headers=headers, timeout=30)
    assert r.status_code == 200
    body = r.json()
    files = body if isinstance(body, list) else body.get("files") or body.get("items") or []
    for f in files:
        if f.get("id"):
            return f["id"]
    pytest.skip("No file with id found")


# ---------- Commission module ----------
class TestCommissions:
    def test_get_commissions(self, headers):
        r = requests.get(f"{BASE_URL}/api/files/commissions", headers=headers, timeout=30)
        assert r.status_code == 200, r.text[:300]
        data = r.json()
        for key in ["commissions", "total", "total_amount", "by_growth_partner", "by_bank"]:
            assert key in data, f"missing {key}"
        assert isinstance(data["by_growth_partner"], list)
        assert isinstance(data["by_bank"], list)
        assert isinstance(data["total_amount"], (int, float))
        print(f"Commissions: total={data['total']} total_amount={data['total_amount']} gp={len(data['by_growth_partner'])} bank={len(data['by_bank'])}")

    def test_commission_summary(self, headers):
        r = requests.get(f"{BASE_URL}/api/files/commissions/summary", headers=headers, timeout=30)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        for k in ["total_paid", "total_count", "pending_count", "pending_estimated"]:
            assert k in d

    def test_gp_aggregation_sorted(self, headers):
        r = requests.get(f"{BASE_URL}/api/files/commissions", headers=headers, timeout=30)
        gp = r.json().get("by_growth_partner", [])
        if len(gp) >= 2:
            assert gp[0]["total_amount"] >= gp[1]["total_amount"], "by_growth_partner not sorted desc"


# ---------- Eligibility ----------
class TestEligibilityCheck:
    def test_check_eligibility(self, headers, one_file_id):
        r = requests.post(f"{BASE_URL}/api/files/{one_file_id}/check-eligibility", headers=headers, timeout=60)
        assert r.status_code == 200, r.text[:400]
        d = r.json()
        assert "results" in d and isinstance(d["results"], list)
        assert "eligible_count" in d
        assert "not_eligible_count" in d
        assert "customer_data" in d
        assert d["eligible_count"] + d["not_eligible_count"] == len(d["results"])
        print(f"Eligibility on {one_file_id}: eligible={d['eligible_count']} not={d['not_eligible_count']}")

    def test_check_eligibility_not_found(self, headers):
        r = requests.post(f"{BASE_URL}/api/files/nonexistent-xyz-abc/check-eligibility", headers=headers, timeout=30)
        assert r.status_code == 404


# ---------- Exports ----------
class TestExports:
    def _assert_csv(self, r, name):
        assert r.status_code == 200, f"{name}: {r.status_code} {r.text[:200]}"
        ctype = r.headers.get("content-type", "")
        assert "csv" in ctype.lower(), f"{name} content-type={ctype}"
        assert "attachment" in r.headers.get("content-disposition", "").lower()
        assert len(r.text) > 0

    def test_export_dashboard(self, headers):
        r = requests.get(f"{BASE_URL}/api/files/export/dashboard", headers=headers, timeout=60)
        self._assert_csv(r, "dashboard")
        first_line = r.text.splitlines()[0]
        for col in ["File ID", "Name", "Phone", "Loan Type", "CIBIL"]:
            assert col in first_line, f"missing column {col} in dashboard export"

    def test_export_rejected(self, headers):
        r = requests.get(f"{BASE_URL}/api/files/export/rejected", headers=headers, timeout=60)
        self._assert_csv(r, "rejected")
        assert "BANK-LEVEL REJECTION SUMMARY" in r.text
        assert "REJECTED FILES DETAIL" in r.text

    def test_export_growth_partner(self, headers):
        r = requests.get(f"{BASE_URL}/api/files/export/growth-partner", headers=headers, timeout=60)
        self._assert_csv(r, "growth-partner")
        first_line = r.text.splitlines()[0]
        for col in ["Growth Partner", "Files (Current)", "Files (Spillover)", "Approved Amount", "Disbursed Amount"]:
            assert col in first_line, f"missing column {col} in GP export"

    def test_export_commissions(self, headers):
        r = requests.get(f"{BASE_URL}/api/files/export/commissions", headers=headers, timeout=60)
        self._assert_csv(r, "commissions")


# ---------- Auth guard ----------
class TestAuthGuard:
    def test_commissions_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/files/commissions", timeout=30)
        assert r.status_code in (401, 403), f"expected auth error, got {r.status_code}"

    def test_export_dashboard_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/files/export/dashboard", timeout=30)
        assert r.status_code in (401, 403)
