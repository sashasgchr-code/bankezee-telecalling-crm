"""Iter67: Unified live reports (/api/meta/reports/live, /options, /live/export) + working-day TAT consistency."""
import os
import subprocess
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
ADMIN = ("admin@bankezee.com", "ConnectSasha12!!")
PROC = ("teja@bankezee.com", "tejasme12")
GP_EMAIL = "yarragondaanusha@gmail.com"


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


@pytest.fixture(scope="module")
def admin_all(admin):
    r = admin.get(f"{BASE_URL}/api/meta/reports/live", timeout=60)
    assert r.status_code == 200, r.text[:300]
    return r.json()


# --- Admin all-time report consistency ---
class TestAdminReport:
    def test_structure(self, admin_all):
        for k in ("kpis", "pipeline", "total_files", "gp", "processors", "tat", "overdue", "loan_types", "alerts", "generated_at"):
            assert k in admin_all
        assert admin_all["role"] in ("admin", "ops")
        print("KPIs:", admin_all["kpis"])

    def test_pipeline_sum(self, admin_all):
        assert sum(p["count"] for p in admin_all["pipeline"]) == admin_all["total_files"] == admin_all["kpis"]["files"]

    def test_gp_total_files(self, admin_all):
        assert sum(r["files"] for r in admin_all["gp"]) == admin_all["kpis"]["files"]
        assert sum(r["leads"] for r in admin_all["gp"]) == admin_all["kpis"]["leads"]

    def test_processor_total_files(self, admin_all):
        assert sum(r["files"] for r in admin_all["processors"]) == admin_all["kpis"]["files"]

    def test_overdue_sorted_and_alerts(self, admin_all):
        ov = admin_all["overdue"]
        ms = [o["tat_ms"] for o in ov]
        assert ms == sorted(ms, reverse=True)
        assert admin_all["alerts"]["tat_exceeded"] == len(ov) == admin_all["tat"]["exceeding_sla"]
        assert all(o["tat_ms"] > 96 * 3600 * 1000 for o in ov)

    def test_buckets_sum(self, admin_all):
        assert sum(b["count"] for b in admin_all["tat"]["buckets"]) == admin_all["tat"]["active_files"]


# --- TAT working-day consistency across bell / leads filter / reports ---
class TestTatConsistency:
    def test_alerts_vs_leads_exceeded_vs_report(self, admin, admin_all):
        a = admin.get(f"{BASE_URL}/api/meta/tat/alerts", timeout=60).json()
        l = admin.get(f"{BASE_URL}/api/meta/leads", params={"status": "FILE", "tat": "exceeded", "limit": 200}, timeout=60).json()
        print("alerts", a["count"], "leads exceeded", l.get("total"), "report", len(admin_all["overdue"]))
        assert a["count"] == l.get("total") == len(admin_all["overdue"])
        assert set(i["lead_id"] for i in a["items"]) == set(o["lead_id"] for o in admin_all["overdue"])

    def test_ongoing_filter(self, admin, admin_all):
        l = admin.get(f"{BASE_URL}/api/meta/leads", params={"status": "FILE", "tat": "ongoing", "limit": 200}, timeout=60).json()
        w = admin.get(f"{BASE_URL}/api/meta/leads", params={"status": "FILE", "tat": "within", "limit": 200}, timeout=60).json()
        e = admin.get(f"{BASE_URL}/api/meta/leads", params={"status": "FILE", "tat": "exceeded", "limit": 200}, timeout=60).json()
        print("ongoing", l.get("total"), "within", w.get("total"), "exceeded", e.get("total"), "report active", admin_all["kpis"]["files_in_progress"])
        assert l.get("total") == w.get("total") + e.get("total")
        assert l.get("total") == admin_all["kpis"]["files_in_progress"]


# --- Filters ---
class TestFilters:
    def test_partner_filter(self, admin, admin_all):
        gp_row = max(admin_all["gp"], key=lambda r: r["files"])
        r = admin.get(f"{BASE_URL}/api/meta/reports/live", params={"partner": gp_row["id"]}, timeout=60).json()
        assert r["kpis"]["files"] == gp_row["files"]
        assert [g["id"] for g in r["gp"]] == [gp_row["id"]]

    def test_file_status_disbursed(self, admin, admin_all):
        cnt = next(p["count"] for p in admin_all["pipeline"] if p["status"] == "Disbursed")
        r = admin.get(f"{BASE_URL}/api/meta/reports/live", params={"file_status": "Disbursed"}, timeout=60).json()
        assert r["kpis"]["files"] == cnt
        l = admin.get(f"{BASE_URL}/api/meta/leads", params={"status": "FILE", "processing_status": "Disbursed", "limit": 200}, timeout=60).json()
        print("disbursed report", cnt, "leads api", l.get("total"))

    def test_date_range(self, admin):
        r = admin.get(f"{BASE_URL}/api/meta/reports/live", params={"from_date": "2026-09-01", "to_date": "2026-09-30"}, timeout=60)
        assert r.status_code == 200
        ra = admin.get(f"{BASE_URL}/api/meta/reports/live", params={"from_date": "2026-09-01", "to_date": "2026-09-30", "basis": "activity"}, timeout=60)
        assert ra.status_code == 200 and ra.json()["basis"] == "activity"

    def test_options(self, admin):
        o = admin.get(f"{BASE_URL}/api/meta/reports/options", timeout=30).json()
        assert len(o["partners"]) > 0 and len(o["processors"]) > 0 and "file_statuses" in o


# --- Export ---
class TestExport:
    @pytest.mark.parametrize("section", ["gp", "processor", "status", "tat", "overdue", "complete"])
    def test_csv(self, admin, section):
        r = admin.get(f"{BASE_URL}/api/meta/reports/live/export", params={"section": section}, timeout=60)
        assert r.status_code == 200
        assert "text/csv" in r.headers.get("content-type", "")
        assert "attachment" in r.headers.get("content-disposition", "")
        first = r.text.splitlines()[0]
        if section == "gp":
            assert first.startswith("Growth Partner,Leads")


# --- Role scoping ---
class TestRoleScoping:
    def test_processor(self, proc):
        r = proc.get(f"{BASE_URL}/api/meta/reports/live", timeout=60)
        assert r.status_code == 200, r.text[:200]
        d = r.json()
        print("processor role", d["role"], "files", d["kpis"]["files"], "procs", [(p["name"], p["files"]) for p in d["processors"]])
        assert d["role"] == "processor"
        assert len([p for p in d["processors"] if p["files"]]) <= 1
        o = proc.get(f"{BASE_URL}/api/meta/reports/options", timeout=30).json()
        assert o["partners"] == [] and o["processors"] == []
        a = proc.get(f"{BASE_URL}/api/meta/tat/alerts", timeout=30).json()
        assert a["count"] == len(d["overdue"])

    def test_gp(self, gp, admin_all):
        r = gp.get(f"{BASE_URL}/api/meta/reports/live", timeout=60)
        assert r.status_code == 200, r.text[:200]
        d = r.json()
        print("gp role", d["role"], "leads", d["kpis"]["leads"], "files", d["kpis"]["files"], "gp rows", [(g["name"], g["files"]) for g in d["gp"]])
        assert d["role"] == "growth_partner"
        assert d["processors"] == []
        assert len(d["gp"]) == 1
        assert d["kpis"]["leads"] < admin_all["kpis"]["leads"]
        # partner filter on another GP must not leak
        other = next(g for g in admin_all["gp"] if g["id"] != d["gp"][0]["id"] and g["files"])
        r2 = gp.get(f"{BASE_URL}/api/meta/reports/live", params={"partner": other["id"]}, timeout=60).json()
        assert r2["kpis"]["files"] == 0 and r2["kpis"]["leads"] == 0

    def test_unauth(self):
        assert requests.get(f"{BASE_URL}/api/meta/reports/live", timeout=30).status_code in (401, 403)
