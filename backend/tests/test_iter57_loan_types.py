"""Iter57 - Loan types canonical catalog endpoint + persistence via file details PUT."""
import os
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://responsive-crm-app-1.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "admin@bankezee.com"
ADMIN_PW = "ConnectSasha12!!"

EXPECTED_VALUES = {
    "new_personal_loan", "balance_transfer_pl", "top_up_pl", "balance_transfer_topup_pl", "merge_multiple_loans",
    "new_home_loan", "balance_transfer_hl", "top_up_hl", "balance_transfer_topup_hl", "reduce_home_loan_emi",
    "new_vehicle_loan", "used_vehicle_loan_fresh", "used_vehicle_loan_bt",
    "business_loan", "msme_loan",
    "lap", "gold_loan", "education_loan", "other",
}


def test_loan_types_endpoint_public():
    r = requests.get(f"{BASE_URL}/api/config/loan-types")
    assert r.status_code == 200
    data = r.json()
    assert "loan_types" in data and "category_labels" in data and "vehicle_loan_values" in data
    values = {t["value"] for t in data["loan_types"]}
    assert len(data["loan_types"]) == 19
    assert values == EXPECTED_VALUES
    for t in data["loan_types"]:
        assert set(t.keys()) >= {"value", "label", "category", "vehicle"}
        assert t["category"] in {"personal", "home", "vehicle", "business", "other"}
    assert set(data["vehicle_loan_values"]) == {"new_vehicle_loan", "used_vehicle_loan_bt", "used_vehicle_loan_fresh"}
    # categories
    assert data["category_labels"]["vehicle"] == "Vehicle Loans"


@pytest.fixture(scope="module")
def admin_session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PW})
    assert r.status_code == 200, r.text
    token = r.json().get("token")
    assert token
    s.headers.update({"Authorization": f"Bearer {token}"})
    return s


@pytest.fixture(scope="module")
def a_file_id(admin_session):
    r = admin_session.get(f"{BASE_URL}/api/files?limit=5")
    assert r.status_code == 200
    files = r.json()
    if isinstance(files, dict):
        files = files.get("files", files.get("data", []))
    assert files, "No files available for testing"
    return files[0].get("id") or files[0].get("_id") or files[0].get("file_id")


def _put_type_of_loan(admin_session, file_id, value):
    r = admin_session.put(
        f"{BASE_URL}/api/files/{file_id}/details",
        json={"additional_data": {"type_of_loan": value}},
    )
    return r


def test_persist_used_vehicle_loan_bt(admin_session, a_file_id):
    r = _put_type_of_loan(admin_session, a_file_id, "used_vehicle_loan_bt")
    assert r.status_code == 200, f"PUT failed: {r.status_code} {r.text}"
    g = admin_session.get(f"{BASE_URL}/api/files/{a_file_id}")
    assert g.status_code == 200
    body = g.json()
    val = (body.get("file_details") or {}).get("type_of_loan")
    assert val == "used_vehicle_loan_bt", f"expected used_vehicle_loan_bt got {val}"


def test_persist_business_loan(admin_session, a_file_id):
    r = _put_type_of_loan(admin_session, a_file_id, "business_loan")
    assert r.status_code == 200, f"PUT failed: {r.status_code} {r.text}"
    g = admin_session.get(f"{BASE_URL}/api/files/{a_file_id}")
    assert g.status_code == 200
    body = g.json()
    val = (body.get("file_details") or {}).get("type_of_loan")
    assert val == "business_loan", f"expected business_loan got {val}"
