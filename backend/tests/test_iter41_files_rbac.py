"""Iteration 41: Files CRM RBAC + JSON-safe fixes regression."""
import os
import pytest
import requests
from dotenv import load_dotenv

load_dotenv("/app/frontend/.env")
BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")

CREDS = {
    "admin": ("admin@bankezee.com", "ConnectSasha12!!"),
    "manager": ("teja@bankezee.com", "tejasme12"),
    "tl": ("yarragondaanusha@gmail.com", "9063023292"),
    "gp": ("banothunithinnaik@gmail.com", "Nithin@123"),
}


def _login(email, password):
    r = requests.post(f"{BASE}/api/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"login {email} -> {r.status_code} {r.text[:200]}"
    tok = r.json().get("access_token") or r.json().get("token")
    assert tok
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="module")
def headers():
    return {k: _login(*v) for k, v in CREDS.items()}


def test_admin_files_page1(headers):
    r = requests.get(f"{BASE}/api/files/?page=1&limit=50", headers=headers["admin"], timeout=30)
    assert r.status_code == 200, r.text[:300]
    data = r.json()
    assert data.get("pagination", {}).get("total") == 514
    assert len(data.get("files", [])) > 0


def test_admin_files_page2(headers):
    r = requests.get(f"{BASE}/api/files/?page=2&limit=50", headers=headers["admin"], timeout=30)
    assert r.status_code == 200
    assert len(r.json().get("files", [])) > 0


@pytest.mark.parametrize("qs", ["status=file", "search=a", "loan_type=Home Loan"])
def test_admin_filters(headers, qs):
    r = requests.get(f"{BASE}/api/files/?{qs}&page=1&limit=20", headers=headers["admin"], timeout=30)
    assert r.status_code == 200, r.text[:300]


def test_gp_scoping(headers):
    r = requests.get(f"{BASE}/api/files/?page=1&limit=100", headers=headers["gp"], timeout=30)
    assert r.status_code == 200
    assert r.json().get("pagination", {}).get("total") == 15


def test_tl_own(headers):
    r = requests.get(f"{BASE}/api/files/?page=1&limit=100", headers=headers["tl"], timeout=30)
    assert r.status_code == 200
    assert r.json().get("pagination", {}).get("total") == 14


def test_tl_team_view(headers):
    r = requests.get(f"{BASE}/api/files/?page=1&limit=100&team_view=true", headers=headers["tl"], timeout=30)
    assert r.status_code == 200
    assert r.json().get("pagination", {}).get("total") == 38


def test_manager_team(headers):
    r = requests.get(f"{BASE}/api/files/?page=1&limit=100", headers=headers["manager"], timeout=30)
    assert r.status_code == 200
    assert r.json().get("pagination", {}).get("total") == 46


def test_file_detail_uuid_and_objectid(headers):
    lst = requests.get(f"{BASE}/api/files/?page=1&limit=100", headers=headers["admin"], timeout=30).json()
    files = lst["files"]
    uuid_files = [f for f in files if len(str(f.get("id", ""))) > 30]
    objid_files = [f for f in files if len(str(f.get("id", ""))) == 24]
    tested = 0
    for f in (uuid_files[:1] + objid_files[:1]):
        fid = f["id"]
        d = requests.get(f"{BASE}/api/files/{fid}", headers=headers["admin"], timeout=30)
        assert d.status_code == 200, f"detail {fid} -> {d.status_code} {d.text[:200]}"
        e = requests.get(f"{BASE}/api/files/{fid}/eligibilities", headers=headers["admin"], timeout=30)
        assert e.status_code == 200
        a = requests.get(f"{BASE}/api/files/{fid}/activities", headers=headers["admin"], timeout=30)
        assert a.status_code == 200
        tested += 1
    assert tested >= 1, "no files found to test"


@pytest.mark.parametrize("path", [
    "/api/files/dashboard/stats",
    "/api/files/reports",
    "/api/files/reports/daily",
    "/api/files/reports/rejected",
    "/api/files/reports/quality",
    "/api/files/reports/bank-performance",
    "/api/files/reports/tat-metrics",
    "/api/files/reports/growth-partner",
    "/api/files/commissions",
    "/api/files/operations-team",
    "/api/files/statuses",
])
def test_reports(headers, path):
    r = requests.get(f"{BASE}{path}", headers=headers["admin"], timeout=60)
    assert r.status_code == 200, f"{path} -> {r.status_code} {r.text[:200]}"


def test_users_counts(headers):
    r = requests.get(f"{BASE}/api/users?page=1&limit=200", headers=headers["admin"], timeout=30)
    assert r.status_code == 200
    body = r.json()
    users = body.get("users") if isinstance(body, dict) else body
    if users is None and isinstance(body, dict):
        users = body.get("items") or body.get("data") or []
    assert isinstance(users, list) and len(users) > 0
    with_counts = [u for u in users if "files_count" in u]
    assert with_counts, f"files_count missing; sample keys={list(users[0].keys())[:20]}"
    assert "leads_count" in with_counts[0], f"leads_count missing; keys={list(with_counts[0].keys())[:20]}"


def test_admin_save_flows(headers):
    lst = requests.get(f"{BASE}/api/files/?page=1&limit=1", headers=headers["admin"], timeout=30).json()
    fid = lst["files"][0]["id"]
    orig = requests.get(f"{BASE}/api/files/{fid}", headers=headers["admin"], timeout=30).json()

    d = requests.put(f"{BASE}/api/files/{fid}/details",
                     json={"customer_name": orig.get("customer_name") or "Test"},
                     headers=headers["admin"], timeout=30)
    assert d.status_code == 200, f"details PUT -> {d.status_code} {d.text[:300]}"

    s = requests.put(f"{BASE}/api/files/{fid}/file-status",
                     json={"file_status": orig.get("file_status") or "Login"},
                     headers=headers["admin"], timeout=30)
    assert s.status_code == 200, f"file-status PUT -> {s.status_code} {s.text[:300]}"

    n = requests.post(f"{BASE}/api/files/{fid}/notes",
                      json={"note": "TEST_iter41_note"},
                      headers=headers["admin"], timeout=30)
    assert n.status_code in (200, 201), f"notes POST -> {n.status_code} {n.text[:300]}"

    acts = requests.get(f"{BASE}/api/files/{fid}/activities", headers=headers["admin"], timeout=30).json()
    assert "TEST_iter41_note" in str(acts), "note not persisted in activities"
