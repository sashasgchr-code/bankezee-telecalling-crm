# Iteration 71: Meta Ad Performance (/api/meta/ad-perf*), lead attribution filters, Processor Performance (/api/meta/processor-perf*)
import os
import subprocess

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api/meta"


def _login(email, pw):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": pw}, timeout=30)
    if r.status_code != 200:
        pytest.skip(f"login failed for {email}: {r.status_code}")
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {r.json()['token']}"})
    return s


@pytest.fixture(scope="module")
def admin():
    return _login("admin@bankezee.com", "ConnectSasha12!!")


@pytest.fixture(scope="module")
def proc():
    return _login("teja@bankezee.com", "tejasme12")


@pytest.fixture(scope="module")
def gp():
    tok = subprocess.check_output(["python", "/app/backend/tests/mint_token.py", "yarragondaanusha@gmail.com"],
                                  env={**os.environ, "PYTHONPATH": "/app/backend"}).decode().strip().splitlines()[-1]
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {tok}"})
    return s


@pytest.fixture(scope="module")
def cohort(admin):
    r = admin.get(f"{API}/ad-perf", params={"level": "campaign", "view": "cohort", "rank_by": "file_conv"}, timeout=120)
    assert r.status_code == 200, r.text
    return r.json()


# --- Ad performance main endpoint
class TestAdPerf:
    def test_structure_and_spend_unavailable(self, cohort):
        for k in ("rows", "total", "best", "worst", "imports", "spend"):
            assert k in cohort
        assert cohort["spend"]["available"] is False
        assert "ads_read" in cohort["spend"]["reason"]
        assert all("spend" not in r for r in cohort["rows"])

    def test_cohort_rows_reconcile(self, cohort):
        assert sum(r["leads"] for r in cohort["rows"]) == cohort["total"]["leads"]
        assert sum(r["files"] for r in cohort["rows"]) == cohort["total"]["files"]
        assert cohort["total"]["leads"] > 0
        print("total", {k: cohort["total"][k] for k in ("leads", "files", "approved", "disbursed", "tat_exceeded", "not_contacted")})
        print("attributed", cohort["attributed"], "unattributed", cohort["unattributed"], "best", len(cohort["best"]), "worst", len(cohort["worst"]))

    @pytest.mark.parametrize("level", ["adset", "ad"])
    def test_levels_reconcile(self, admin, cohort, level):
        r = admin.get(f"{API}/ad-perf", params={"level": level, "view": "cohort"}, timeout=120)
        assert r.status_code == 200
        d = r.json()
        assert sum(x["leads"] for x in d["rows"]) == cohort["total"]["leads"]

    def test_activity_view(self, admin):
        r = admin.get(f"{API}/ad-perf", params={"level": "campaign", "view": "activity", "date_from": "2025-01-01", "date_to": "2026-12-31"}, timeout=120)
        assert r.status_code == 200
        assert r.json()["view"] == "activity"

    def test_invalid_level(self, admin):
        assert admin.get(f"{API}/ad-perf", params={"level": "x"}, timeout=60).status_code == 422

    def test_default_rank_by(self, admin):
        # backend default rank_by=cpl while spend unavailable -> best list empty (report only)
        d = admin.get(f"{API}/ad-perf", timeout=120).json()
        print("default rank_by cpl best:", len(d["best"]), "label", d["rank_label"])

    def test_campaign_filter_drill(self, admin, cohort):
        row = next(x for x in cohort["rows"] if x["id"])
        d = admin.get(f"{API}/ad-perf", params={"level": "adset", "campaign_id": row["id"]}, timeout=120).json()
        assert d["total"]["leads"] == row["leads"]
        assert sum(x["leads"] for x in d["rows"]) == row["leads"]


# --- Records drilldown
class TestRecords:
    @pytest.mark.parametrize("metric", ["files", "approved", "disbursed", "not_contacted", "tat_exceeded", "leads"])
    def test_records_count_matches(self, admin, cohort, metric):
        r = admin.get(f"{API}/ad-perf/records", params={"metric": metric, "view": "cohort"}, timeout=120)
        assert r.status_code == 200
        assert r.json()["total"] == cohort["total"][metric], metric

    @pytest.mark.parametrize("metric", ["files", "approved", "disbursed", "not_contacted", "tat_exceeded"])
    def test_records_activity_match(self, admin, metric):
        p = {"view": "activity", "date_from": "2025-06-01", "date_to": "2026-12-31"}
        tot = admin.get(f"{API}/ad-perf", params={**p, "level": "campaign"}, timeout=120).json()["total"][metric]
        n = admin.get(f"{API}/ad-perf/records", params={**p, "metric": metric}, timeout=120).json()["total"]
        assert n == tot, f"activity {metric}: records {n} vs total {tot}"

    def test_records_bucket(self, admin, cohort):
        row = next(x for x in cohort["rows"] if x["id"] and x["files"])
        n = admin.get(f"{API}/ad-perf/records", params={"metric": "files", "level": "campaign", "bucket": row["id"]}, timeout=120).json()["total"]
        assert n == row["files"]

    def test_records_csv(self, admin):
        r = admin.get(f"{API}/ad-perf/records", params={"metric": "files", "format": "csv"}, timeout=120)
        assert r.status_code == 200
        assert r.headers["content-type"].startswith("text/csv")
        assert r.text.startswith("lead_id,")


# --- Options + Leads attribution filters
class TestOptionsLeads:
    def test_options(self, admin):
        d = admin.get(f"{API}/ad-perf/options", timeout=60).json()
        assert len(d["campaigns"]) > 0 and len(d["adsets"]) > 0 and len(d["ads"]) > 0
        assert all(c["id"] for c in d["campaigns"])

    def test_leads_ad_filter(self, admin):
        ad = admin.get(f"{API}/ad-perf/options", timeout=60).json()["ads"][0]
        r = admin.get(f"{API}/leads", params={"ad_id": ad["id"], "limit": 200}, timeout=60)
        assert r.status_code == 200
        d = r.json()
        items = d.get("leads") or d.get("items") or []
        assert len(items) > 0
        assert all((i.get("meta_attr") or {}).get("ad_id") == ad["id"] for i in items)

    def test_leads_attribution_missing(self, admin):
        r = admin.get(f"{API}/leads", params={"attribution": "missing", "limit": 50}, timeout=60)
        assert r.status_code == 200
        d = r.json()
        items = d.get("leads") or d.get("items") or []
        assert all(not (i.get("meta_attr") or {}).get("ad_id") for i in items)
        print("missing total", d.get("total"))


# --- Processor performance
class TestProcessorPerf:
    def test_rows_and_files_reconcile(self, admin):
        d = admin.get(f"{API}/processor-perf", timeout=120).json()
        assert len(d["rows"]) > 0
        print([(r["processor_name"], r["current_active"], r["exceptions"]["tat_exceeded"]) for r in d["rows"]])
        for exc in ("tat_exceeded", "followup_overdue", "missing_info", "no_activity"):
            s = sum(r["exceptions"][exc] for r in d["rows"])
            n = admin.get(f"{API}/processor-perf/files", params={"exception": exc}, timeout=120).json()["total"]
            assert n == s, f"{exc}: files {n} vs rows sum {s}"
            assert d["total"]["exceptions"][exc] == s

    def test_per_row_files(self, admin):
        d = admin.get(f"{API}/processor-perf", timeout=120).json()
        r = max(d["rows"], key=lambda x: x["exceptions"]["tat_exceeded"])
        fr = admin.get(f"{API}/processor-perf/files", params={"exception": "tat_exceeded", "processor": r["processor_id"]}, timeout=120).json()
        assert fr["total"] == r["exceptions"]["tat_exceeded"]
        if fr["items"]:
            for c in ("customer", "stage", "processor", "assigned_at", "last_activity", "tat_deadline", "elapsed_tat_days", "overdue_days", "next_action"):
                assert c in fr["items"][0]

    def test_processor_own_row(self, proc):
        r = proc.get(f"{API}/processor-perf", timeout=120)
        assert r.status_code == 200, r.text
        rows = r.json()["rows"]
        assert len(rows) <= 1
        assert all(x["processor_id"] != "UNASSIGNED" for x in rows)

    def test_gp_forbidden(self, gp):
        assert gp.get(f"{API}/processor-perf", timeout=60).status_code == 403
        assert gp.get(f"{API}/processor-perf/files", timeout=60).status_code == 403

    def test_csv(self, admin):
        r = admin.get(f"{API}/processor-perf/files", params={"format": "csv"}, timeout=120)
        assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
