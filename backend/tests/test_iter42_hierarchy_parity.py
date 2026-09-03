"""Iteration 42 regression: shared identity resolver, recursive manager scope,
fail-closed filters, list-vs-stats parity, daily tracking sheet for growth_partner role.
"""
import os
import pytest
import requests
from dotenv import load_dotenv

load_dotenv("/app/frontend/.env")
BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")

CREDS = {
    "admin": ("admin@bankezee.com", "ConnectSasha12!!"),
    "manager_teja": ("teja@bankezee.com", "tejasme12"),
    "manager_saikiran": ("saikiran@bankezee.com", "saikiran12"),
    "tl_anusha": ("yarragondaanusha@gmail.com", "9063023292"),
    "tl_pinky": ("pinkynagulapally@gmail.com", "Pinky@1234"),
    "gp_nithin": ("banothunithinnaik@gmail.com", "Nithin@123"),
    "ops": ("rama@bankezee.com", "rama@bzc12"),
    "hr": ("hr@neosales.in", "HrNeo12!!"),
}


def _login(email, password):
    r = requests.post(f"{BASE}/api/auth/login", json={"email": email, "password": password}, timeout=30)
    if r.status_code != 200:
        return None
    tok = r.json().get("access_token") or r.json().get("token")
    return {"Authorization": f"Bearer {tok}"} if tok else None


@pytest.fixture(scope="module")
def H():
    return {k: _login(*v) for k, v in CREDS.items()}


def _files_total(headers, qs=""):
    r = requests.get(f"{BASE}/api/files/?page=1&limit=1{('&' + qs) if qs else ''}", headers=headers, timeout=45)
    assert r.status_code == 200, f"{qs} -> {r.status_code} {r.text[:300]}"
    return r.json().get("pagination", {}).get("total")


def _stats_total(headers, qs=""):
    url = f"{BASE}/api/files/dashboard/stats" + (f"?{qs}" if qs else "")
    r = requests.get(url, headers=headers, timeout=45)
    assert r.status_code == 200, f"stats {qs} -> {r.status_code} {r.text[:300]}"
    j = r.json()
    # try common keys
    for k in ("total_files", "total", "totalFiles"):
        if k in j:
            return j[k]
    # nested?
    if isinstance(j.get("stats"), dict):
        for k in ("total_files", "total"):
            if k in j["stats"]:
                return j["stats"][k]
    return j


# ---------- Baseline totals ----------
def test_admin_no_filter_514(H):
    assert H["admin"], "admin login failed"
    assert _files_total(H["admin"]) == 514


def test_manager_teja_recursive_94(H):
    assert H["manager_teja"], "teja login failed"
    total = _files_total(H["manager_teja"])
    assert total == 94, f"expected 94 (recursive), got {total}"


def test_manager_saikiran_56(H):
    if not H["manager_saikiran"]:
        pytest.skip("saikiran login unavailable (creds may be invalid per review note)")
    total = _files_total(H["manager_saikiran"])
    assert total == 56, f"expected 56, got {total}"


def test_tl_anusha_own_14(H):
    assert _files_total(H["tl_anusha"]) == 14


def test_tl_anusha_team_view_42(H):
    total = _files_total(H["tl_anusha"], "team_view=true")
    assert total == 42, f"expected 42, got {total}"


def test_tl_pinky_own_32(H):
    assert _files_total(H["tl_pinky"]) == 32


def test_gp_nithin_15(H):
    assert _files_total(H["gp_nithin"]) == 15


# ---------- Admin filter parity list vs stats ----------
def _users_lookup(H):
    r = requests.get(f"{BASE}/api/users?page=1&limit=500", headers=H["admin"], timeout=45)
    body = r.json()
    users = body.get("users") if isinstance(body, dict) else body
    if isinstance(users, dict):
        users = users.get("items") or users.get("data")
    return users or []


@pytest.fixture(scope="module")
def USER_IDS(H):
    users = _users_lookup(H)
    ids = {}
    for u in users:
        email = (u.get("email") or "").lower()
        if email == "yarragondaanusha@gmail.com":
            ids["anusha"] = u.get("id") or u.get("_id")
        if email == "pinkynagulapally@gmail.com":
            ids["pinky"] = u.get("id") or u.get("_id")
        if email == "banothunithinnaik@gmail.com":
            ids["nithin"] = u.get("id") or u.get("_id")
        if email == "teja@bankezee.com":
            ids["teja"] = u.get("id") or u.get("_id")
        if email == "saikiran@bankezee.com" or email == "gujjarisaikiran13@gmail.com":
            ids.setdefault("saikiran", u.get("id") or u.get("_id"))
    return ids


def test_admin_tl_anusha_42(H, USER_IDS):
    if "anusha" not in USER_IDS:
        pytest.skip("anusha id not found in /api/users")
    total = _files_total(H["admin"], f"tl_id={USER_IDS['anusha']}")
    assert total == 42, f"admin tl_id=anusha expected 42, got {total}"


def test_admin_tl_pinky_20(H, USER_IDS):
    if "pinky" not in USER_IDS:
        pytest.skip("pinky id not found")
    total = _files_total(H["admin"], f"tl_id={USER_IDS['pinky']}")
    assert total == 20, f"admin tl_id=pinky expected 20, got {total}"


def test_admin_gp_nithin_15(H, USER_IDS):
    if "nithin" not in USER_IDS:
        pytest.skip("nithin id not found")
    total = _files_total(H["admin"], f"gp_id={USER_IDS['nithin']}")
    assert total == 15, f"admin gp_id=nithin expected 15, got {total}"


# ---------- Fail-closed for unknown scopes ----------
BOGUS = "00000000-0000-0000-0000-deadbeef0000"


@pytest.mark.parametrize("qs", [
    f"manager_id={BOGUS}",
    f"tl_id={BOGUS}",
    f"gp_id={BOGUS}",
    f"assigned_to={BOGUS}",
])
def test_fail_closed_list_zero(H, qs):
    total = _files_total(H["admin"], qs)
    assert total == 0, f"{qs} expected 0 (fail-closed), got {total}"


@pytest.mark.parametrize("qs", [
    f"manager_id={BOGUS}",
    f"tl_id={BOGUS}",
    f"gp_id={BOGUS}",
])
def test_fail_closed_stats_zero(H, qs):
    s = _stats_total(H["admin"], qs)
    # Accept either total_files=0 or a dict with all zeros
    if isinstance(s, dict):
        vals = [v for v in s.values() if isinstance(v, (int, float))]
        assert all(v == 0 for v in vals), f"{qs} stats not zeroed: {s}"
    else:
        assert s == 0, f"{qs} stats expected 0, got {s}"


# ---------- list vs stats parity for admin ----------
@pytest.mark.parametrize("qs", [
    "",
    "status=file",
    "loan_type=Home Loan",
    "search=a",
])
def test_admin_list_stats_parity(H, qs):
    list_total = _files_total(H["admin"], qs)
    s = _stats_total(H["admin"], qs)
    stat_total = s if isinstance(s, int) else (s.get("total_files") if isinstance(s, dict) else None)
    assert list_total == stat_total, f"parity mismatch qs={qs!r}: list={list_total} stats={stat_total} raw={s}"


# ---------- Daily Tracking Sheet ----------
def test_daily_tracking_sheet_has_growth_partners(H):
    # Try known endpoints
    candidates = [
        "/api/reports/daily-tracking-sheet",
        "/api/reports/daily-tracking",
        "/api/files/reports/daily-tracking-sheet",
    ]
    ok = None
    for path in candidates:
        r = requests.get(f"{BASE}{path}", headers=H["admin"], timeout=45)
        if r.status_code == 200:
            ok = (path, r.json())
            break
    assert ok, f"none of {candidates} returned 200 for daily tracking"
    path, body = ok
    rows = body if isinstance(body, list) else (body.get("data") or body.get("rows") or body.get("agents") or body.get("sheet") or [])
    assert isinstance(rows, list) and len(rows) > 0, f"{path} returned empty: {str(body)[:300]}"
    names = " ".join(str(r) for r in rows).lower()
    for needle in ["meghana", "pinky", "anusha"]:
        assert needle in names, f"{needle} not in daily tracking sheet at {path}"
    # dedupe check by user id or email
    seen = set()
    dups = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        key = row.get("user_id") or row.get("id") or row.get("email") or row.get("name")
        if key and key in seen:
            dups.append(key)
        seen.add(key)
    assert not dups, f"duplicate rows in daily tracking: {dups}"


# ---------- HR blocked from files ----------
def test_hr_no_files(H):
    if not H["hr"]:
        pytest.skip("hr login failed")
    r = requests.get(f"{BASE}/api/files/?page=1&limit=1", headers=H["hr"], timeout=30)
    # Either 403 or empty list
    if r.status_code == 200:
        assert r.json().get("pagination", {}).get("total") == 0, f"hr should not see files, got {r.json().get('pagination')}"
    else:
        assert r.status_code in (401, 403), f"hr got {r.status_code}"


# ---------- Users source badge & counts ----------
def test_users_have_source_and_can_login(H):
    users = _users_lookup(H)
    assert users
    # Check Nithin and Meghana show can_login/has_password* fields
    for u in users:
        email = (u.get("email") or "").lower()
        if email in ("banothunithinnaik@gmail.com", "meghanaaaa.36@gmail.com", "asma.sultana0r@gmail.com"):
            assert any(k in u for k in ("can_login", "source", "has_password", "has_password_hash", "has_connect_id")), \
                f"{email} missing source/can_login flags: {list(u.keys())[:15]}"


# ---------- CSV export requires auth ----------
def test_csv_export_requires_auth():
    r = requests.get(f"{BASE}/api/files/export/dashboard", timeout=30, allow_redirects=False)
    assert r.status_code in (401, 403), f"unauth CSV expected 401/403, got {r.status_code}"


def test_csv_export_with_auth(H):
    r = requests.get(f"{BASE}/api/files/export/dashboard", headers=H["admin"], timeout=60)
    assert r.status_code == 200, f"CSV export -> {r.status_code} {r.text[:200]}"
    ct = r.headers.get("content-type", "")
    assert "csv" in ct.lower(), f"content-type={ct}"


def test_csv_export_respects_filter(H, USER_IDS):
    if "nithin" not in USER_IDS:
        pytest.skip("nithin id not found")
    r = requests.get(f"{BASE}/api/files/export/dashboard?gp_id={USER_IDS['nithin']}",
                     headers=H["admin"], timeout=60)
    assert r.status_code == 200
    # header row + 15 data rows expected
    lines = [l for l in r.text.splitlines() if l.strip()]
    assert len(lines) <= 17, f"gp_id=nithin CSV expected ~16 lines (header+15), got {len(lines)}"


def test_csv_export_fail_closed(H):
    r = requests.get(f"{BASE}/api/files/export/dashboard?gp_id={BOGUS}", headers=H["admin"], timeout=60)
    assert r.status_code == 200
    lines = [l for l in r.text.splitlines() if l.strip()]
    assert len(lines) <= 1, f"fail-closed CSV should be header-only, got {len(lines)} lines"


# ---------- Reports smoke across roles ----------
@pytest.mark.parametrize("role", ["admin", "ops", "manager_teja", "tl_anusha", "gp_nithin"])
@pytest.mark.parametrize("path", [
    "/api/files/reports",
    "/api/files/reports/daily",
    "/api/files/reports/rejected",
    "/api/files/reports/quality",
    "/api/files/reports/bank-performance",
    "/api/files/reports/tat-metrics",
    "/api/files/reports/growth-partner",
    "/api/files/commissions",
    "/api/files/dashboard/stats",
])
def test_reports_no_500(H, role, path):
    if not H.get(role):
        pytest.skip(f"{role} login unavailable")
    r = requests.get(f"{BASE}{path}", headers=H[role], timeout=60)
    assert r.status_code < 500, f"{role} {path} -> {r.status_code} {r.text[:200]}"
