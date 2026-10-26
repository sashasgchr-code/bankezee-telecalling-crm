"""Iter68: extra regression for live reports - overdue independent of date range, filter consistency, role scoping depth."""
import os
import subprocess
from datetime import datetime, timedelta, timezone
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
ADMIN = ("admin@bankezee.com", "ConnectSasha12!!")
PROC = ("teja@bankezee.com", "tejasme12")
GP_EMAIL = "yarragondaanusha@gmail.com"
U = f"{BASE_URL}/api/meta/reports/live"


def _login(email, pw):
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": pw}, timeout=30)
    assert r.status_code == 200, r.text[:200]
    tok = r.json().get("access_token") or r.json().get("token")
    if tok:
        s.headers["Authorization"] = f"Bearer {tok}"
    return s


@pytest.fixture(scope="module")
def admin():
    return _login(*ADMIN)


@pytest.fixture(scope="module")
def proc():
    return _login(*PROC)


@pytest.fixture(scope="module")
def gp():
    tok = subprocess.check_output(["python3", "tests/mint_token.py", GP_EMAIL], cwd="/app/backend").decode().strip().splitlines()[-1]
    s = requests.Session()
    s.headers["Authorization"] = f"Bearer {tok}"
    return s


def _this_month():
    now = datetime.now(timezone.utc) + timedelta(hours=5, minutes=30)
    return now.replace(day=1).strftime("%Y-%m-%d"), now.strftime("%Y-%m-%d")


def _check_consistency(d):
    assert sum(p["count"] for p in d["pipeline"]) == d["total_files"] == d["kpis"]["files"]
    assert sum(r["files"] for r in d["gp"]) == d["kpis"]["files"]
    if d["processors"]:
        assert sum(r["files"] for r in d["processors"]) == d["kpis"]["files"]


# Overdue list ignores the date range
class TestOverdueIndependent:
    def test_this_month_vs_all(self, admin):
        f, t = _this_month()
        tm = admin.get(U, params={"from_date": f, "to_date": t}, timeout=60).json()
        al = admin.get(U, timeout=60).json()
        far = admin.get(U, params={"from_date": "2020-01-01", "to_date": "2020-01-31"}, timeout=60).json()
        bell = admin.get(f"{BASE_URL}/api/meta/tat/alerts", timeout=60).json()
        print("overdue this_month", len(tm["overdue"]), "all", len(al["overdue"]), "far", len(far["overdue"]), "bell", bell["count"])
        assert len(tm["overdue"]) == len(al["overdue"]) == len(far["overdue"]) == bell["count"]
        assert far["kpis"]["files"] == 0
        _check_consistency(tm)
        _check_consistency(far)


# Filters keep all sections consistent
class TestFilterConsistency:
    @pytest.mark.parametrize("params", [{"source": "META"}, {"source": "WEBSITE"}, {"file_status": "New"},
                                        {"partner": "UNASSIGNED"}, {"processor": "UNASSIGNED"}, {"basis": "activity"}])
    def test_consistent(self, admin, params):
        d = admin.get(U, params=params, timeout=60).json()
        print(params, "files", d["kpis"]["files"], "leads", d["kpis"]["leads"])
        _check_consistency(d)

    def test_processor_filter(self, admin):
        al = admin.get(U, timeout=60).json()
        row = max([p for p in al["processors"] if p["id"] != "UNASSIGNED"], key=lambda r: r["files"])
        d = admin.get(U, params={"processor": row["id"]}, timeout=60).json()
        assert d["kpis"]["files"] == row["files"]
        assert all(o["processor"] == row["name"] for o in d["overdue"])
        _check_consistency(d)

    def test_loan_type_filter(self, admin):
        al = admin.get(U, timeout=60).json()
        lt = next(r for r in al["loan_types"] if r["key"])
        d = admin.get(U, params={"loan_type": lt["loan_type"]}, timeout=60).json()
        assert d["kpis"]["files"] == lt["files"]
        _check_consistency(d)

    def test_files_page_matches_gp(self, admin):
        al = admin.get(U, timeout=60).json()
        row = max(al["gp"], key=lambda r: r["files"])
        l = admin.get(f"{BASE_URL}/api/meta/leads", params={"status": "FILE", "partner_id": row["id"], "limit": 200}, timeout=60).json()
        print("gp", row["name"], row["files"], "leads api total", l.get("total"))


# Role scoping depth
class TestRoleDepth:
    def test_processor_overdue_only_own(self, proc, admin):
        d = proc.get(U, timeout=60).json()
        names = {p["name"] for p in d["processors"] if p["files"]}
        assert all(o["processor"] in names for o in d["overdue"])
        _check_consistency(d)
        # processor cannot widen scope with filters
        al = admin.get(U, timeout=60).json()
        other = next((p for p in al["processors"] if p["files"] and p["name"] not in names and p["id"] != "UNASSIGNED"), None)
        if other:
            r = proc.get(U, params={"processor": other["id"]}, timeout=60).json()
            assert r["kpis"]["files"] == 0

    def test_gp_exports_scoped(self, gp):
        d = gp.get(U, timeout=60).json()
        r = gp.get(f"{U}/export", params={"section": "overdue"}, timeout=60)
        assert r.status_code == 200
        assert len(r.text.strip().splitlines()) - 1 == len(d["overdue"])
        _check_consistency(d)
