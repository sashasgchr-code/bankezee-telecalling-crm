"""
Tests for Bank Policies + Eligibility Check (Old CRM parity) - Iteration 38
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://responsive-crm-app-1.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "admin@bankezee.com"
ADMIN_PASSWORD = "ConnectSasha12!!"
TEST_LEAD_ID = "7217c29e-9f4c-47ce-8e73-2f73203a57f6"


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=30)
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    data = r.json()
    token = data.get("access_token") or data.get("token")
    assert token, f"No token in response: {data}"
    return token


@pytest.fixture(scope="module")
def auth_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}


# --- Bank Policy CRUD ---
class TestBankPolicies:
    def test_list_policies(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/bank-policies/policies", headers=auth_headers, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, list)
        assert len(data) >= 12, f"Expected >=12 seeded policies, got {len(data)}"
        # Validate structure
        first = data[0]
        assert "id" in first
        assert "bank_name" in first
        assert "_id" not in first

    def test_get_single_policy(self, auth_headers):
        listing = requests.get(f"{BASE_URL}/api/bank-policies/policies", headers=auth_headers, timeout=30).json()
        pid = listing[0]["id"]
        r = requests.get(f"{BASE_URL}/api/bank-policies/policies/{pid}", headers=auth_headers, timeout=30)
        assert r.status_code == 200
        assert r.json()["id"] == pid

    def test_get_policy_not_found(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/bank-policies/policies/nonexistent-id-xyz", headers=auth_headers, timeout=30)
        assert r.status_code == 404

    def test_crud_policy(self, auth_headers):
        # Create
        payload = {
            "bank_name": "TEST_Bank_Iter38",
            "min_cibil": 700,
            "min_salary": 25000,
            "max_foir": 55,
            "roi_min": 10.5,
            "roi_max": 14.5,
            "max_tenure": 60,
            "min_age": 21,
            "max_age": 60,
            "loan_types": ["personal_loan"],
            "applicable_profiles": ["salaried"],
        }
        r = requests.post(f"{BASE_URL}/api/bank-policies/policies", headers=auth_headers, json=payload, timeout=30)
        assert r.status_code in (200, 201), r.text
        created = r.json()
        pid = created["id"]
        assert created["bank_name"] == "TEST_Bank_Iter38"
        assert created["min_cibil"] == 700

        # GET verify persistence
        g = requests.get(f"{BASE_URL}/api/bank-policies/policies/{pid}", headers=auth_headers, timeout=30)
        assert g.status_code == 200
        assert g.json()["bank_name"] == "TEST_Bank_Iter38"

        # Update
        u = requests.put(
            f"{BASE_URL}/api/bank-policies/policies/{pid}",
            headers=auth_headers,
            json={"min_cibil": 720, "special_notes": "Updated by test"},
            timeout=30,
        )
        assert u.status_code == 200, u.text
        assert u.json()["min_cibil"] == 720

        # Verify update persisted
        g2 = requests.get(f"{BASE_URL}/api/bank-policies/policies/{pid}", headers=auth_headers, timeout=30)
        assert g2.json()["min_cibil"] == 720
        assert g2.json()["special_notes"] == "Updated by test"

        # Delete
        d = requests.delete(f"{BASE_URL}/api/bank-policies/policies/{pid}", headers=auth_headers, timeout=30)
        assert d.status_code == 200

        # Verify deletion
        g3 = requests.get(f"{BASE_URL}/api/bank-policies/policies/{pid}", headers=auth_headers, timeout=30)
        assert g3.status_code == 404


# --- Eligibility Check ---
class TestEligibilityCheck:
    def test_check_eligibility(self, auth_headers):
        r = requests.post(
            f"{BASE_URL}/api/bank-policies/check-eligibility/{TEST_LEAD_ID}",
            headers=auth_headers,
            timeout=90,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        # Structure assertions
        for key in ("id", "lead_id", "profile", "profile_strength", "results",
                    "eligible_count", "possibly_eligible_count", "not_eligible_count",
                    "total_policies", "missing_info"):
            assert key in data, f"missing key: {key}"
        assert data["lead_id"] == TEST_LEAD_ID
        assert isinstance(data["results"], list)
        assert data["total_policies"] == len(data["results"])
        assert data["total_policies"] >= 12
        # sanity: counts sum
        assert (data["eligible_count"] + data["possibly_eligible_count"] + data["not_eligible_count"]) == data["total_policies"]
        # Each result has required fields
        r0 = data["results"][0]
        for key in ("bank_name", "eligibility", "confidence", "reasons_pass", "reasons_fail", "reasons_warning"):
            assert key in r0
        assert r0["eligibility"] in ("eligible", "possibly_eligible", "not_eligible")
        # profile has FOIR (high FOIR test lead: ~215%)
        assert "foir" in data["profile"]

    def test_check_eligibility_invalid_lead(self, auth_headers):
        r = requests.post(
            f"{BASE_URL}/api/bank-policies/check-eligibility/nonexistent-lead-id-xyz",
            headers=auth_headers,
            timeout=30,
        )
        assert r.status_code == 404

    def test_eligibility_history(self, auth_headers):
        # Trigger a check first (to ensure history exists)
        requests.post(
            f"{BASE_URL}/api/bank-policies/check-eligibility/{TEST_LEAD_ID}",
            headers=auth_headers,
            timeout=90,
        )
        r = requests.get(
            f"{BASE_URL}/api/bank-policies/eligibility-history/{TEST_LEAD_ID}",
            headers=auth_headers,
            timeout=30,
        )
        assert r.status_code == 200
        history = r.json()
        assert isinstance(history, list)
        assert len(history) >= 1


# --- Auth guard: unauthenticated ---
class TestAuthGuard:
    def test_policies_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/bank-policies/policies", timeout=15)
        assert r.status_code in (401, 403)

    def test_create_requires_admin(self):
        r = requests.post(f"{BASE_URL}/api/bank-policies/policies", json={"bank_name": "X"}, timeout=15)
        assert r.status_code in (401, 403)
