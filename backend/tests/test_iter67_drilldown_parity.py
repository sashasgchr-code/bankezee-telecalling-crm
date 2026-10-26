"""Iter67: Reports drill-down parity — Files page API (/api/meta/leads status=FILE) count vs report counts."""
import os
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")


@pytest.fixture(scope="module")
def s():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": "admin@bankezee.com", "password": "ConnectSasha12!!"}, timeout=30)
    tok = r.json().get("access_token") or r.json().get("token")
    if tok:
        s.headers["Authorization"] = f"Bearer {tok}"
    return s


def files_total(s, **p):
    return s.get(f"{BASE_URL}/api/meta/leads", params={"status": "FILE", "page_size": 5, **p}, timeout=60).json().get("total")


def rep(s, **p):
    return s.get(f"{BASE_URL}/api/meta/reports/live", params=p, timeout=60).json()


def test_unassigned_files(s):
    r = rep(s)
    assert files_total(s, processor="UNASSIGNED") == r["kpis"]["unassigned_files"]


def test_kpi_logins_drilldown(s):
    r = rep(s)
    got = files_total(s, processing_status="Login Done")
    print("logins kpi", r["kpis"]["logins"], "files page Login Done", got)
    assert got == r["kpis"]["logins"]


def test_kpi_approved_drilldown(s):
    r = rep(s)
    got = files_total(s, processing_status="Approved")
    print("approved kpi", r["kpis"]["approved"], "files page Approved", got)
    assert got == r["kpis"]["approved"]


def test_alert_on_hold(s):
    r = rep(s)
    got = files_total(s, processing_status="Hold")
    print("on_hold alert", r["alerts"]["on_hold"], "files Hold", got)
    assert got == r["alerts"]["on_hold"]


def test_alert_awaiting_approval(s):
    r = rep(s)
    got = files_total(s, processing_status="Sent for Approval")
    print("awaiting_approval", r["alerts"]["awaiting_approval"], "files", got)
    assert got == r["alerts"]["awaiting_approval"]


def test_docs_pending_gp(s):
    r = rep(s)
    row = max(r["gp"], key=lambda x: x["files"])
    assert files_total(s, partner=row["id"], docs="pending") == row["docs_pending"]
    assert files_total(s, partner=row["id"]) == row["files"]


@pytest.mark.parametrize("fd,td", [("2026-08-01", "2026-08-31"), ("2026-09-01", "2026-09-30"), ("2026-10-01", "2026-10-31")])
def test_date_range_total_files(s, fd, td):
    r = rep(s, from_date=fd, to_date=td)
    got = files_total(s, file_from=fd, file_to=td)
    print(fd, td, "report files", r["kpis"]["files"], "files page", got)
    assert got == r["kpis"]["files"]


def test_docs_pending_sla_alert(s):
    r = rep(s)
    assert files_total(s, docs="pending", tat="exceeded") == r["alerts"]["docs_pending_sla"]


def test_tat_exceeded_alert(s):
    r = rep(s)
    assert files_total(s, tat="exceeded") == r["alerts"]["tat_exceeded"]
