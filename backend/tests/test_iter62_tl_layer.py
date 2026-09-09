"""Iteration 62 — Team-Leader (TL) 2nd-level calling + reporting.

Verifies the additive TL layer over Connect:
- Acceptance flow (leads pool, TL call, FILE conversion keeps GP ownership)
- TL call log + filters
- Reports (summary, hourly, conversion)
- Scoping (TL sees only her team, non-TL GP blocked, cross-team POST blocked, admin sees all)
- Regression: GP + Meta reports untouched by TL calls
"""
import os
import pytest
import requests

def _load_env(p):
    try:
        for line in open(p):
            if "=" in line and not line.strip().startswith("#"):
                k, v = line.strip().split("=", 1)
                os.environ.setdefault(k, v)
    except FileNotFoundError:
        pass

_load_env("/app/frontend/.env")
BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN = ("admin@bankezee.com", "ConnectSasha12!!")
TL = ("yarragondaanusha@gmail.com", "TLtest@123")
GP = ("banothunithinnaik@gmail.com", "Nithin@123")


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def admin_h():
    return {"Authorization": f"Bearer {_login(*ADMIN)}"}


@pytest.fixture(scope="module")
def tl_h():
    return {"Authorization": f"Bearer {_login(*TL)}"}


@pytest.fixture(scope="module")
def gp_h():
    return {"Authorization": f"Bearer {_login(*GP)}"}


# -------------------- meta / scoping --------------------
class TestScoping:
    def test_tl_meta_for_tl(self, tl_h):
        r = requests.get(f"{API}/tl/meta", headers=tl_h, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["is_tl"] is True
        assert isinstance(d.get("tls"), list) and len(d["tls"]) == 1, f"TL should see only herself: {d.get('tls')}"
        assert len(d.get("gps") or []) >= 1, f"TL should see her GPs, got {len(d.get('gps') or [])}"
        print(f"TL meta -> tls={len(d['tls'])} gps={len(d['gps'])}")

    def test_tl_meta_for_admin(self, admin_h):
        r = requests.get(f"{API}/tl/meta", headers=admin_h, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert len(d.get("tls") or []) >= 1
        assert len(d.get("gps") or []) >= 1
        print(f"Admin meta -> tls={len(d['tls'])} gps={len(d['gps'])}")

    def test_non_tl_gp_blocked(self, gp_h):
        r = requests.get(f"{API}/tl/leads", headers=gp_h, timeout=30)
        assert r.status_code == 403, f"expected 403 got {r.status_code} {r.text}"


# -------------------- leads pool + acceptance flow --------------------
@pytest.fixture(scope="module")
def tl_lead(tl_h):
    r = requests.get(f"{API}/tl/leads", headers=tl_h, timeout=30)
    assert r.status_code == 200
    leads = r.json().get("leads", [])
    assert leads, "TL has no leads to test"
    # pick a lead currently in LEAD status (not already file)
    for l in leads:
        if l.get("status") in ("leads", "converted"):
            return l
    pytest.skip("No LEAD-status leads currently in TL pool")


class TestAcceptanceFlow:
    def test_gp_calls_before(self, admin_h, tl_lead):
        # baseline GP call_logs count for the lead - use admin to fetch activities/calls
        lid = tl_lead["lead_id"]
        r = requests.get(f"{API}/calls?lead_id={lid}", headers=admin_h, timeout=30)
        # endpoint may or may not exist; tolerate 404 and use activities instead
        if r.status_code == 200:
            data = r.json()
            calls = data if isinstance(data, list) else data.get("calls", data.get("logs", []))
            tl_lead["_baseline_gp_calls"] = len([c for c in calls if (c.get("call_level") or "GP") != "TL"])
        else:
            tl_lead["_baseline_gp_calls"] = None
        print(f"Baseline GP calls for {lid}: {tl_lead['_baseline_gp_calls']}")

    def test_tl_call_back(self, tl_h, tl_lead):
        lid = tl_lead["lead_id"]
        payload = {"duration_seconds": 45, "outcome": "call_back",
                   "resulting_status": "follow_up", "notes": "TL test callback",
                   "follow_up_date": "2026-01-20", "follow_up_time": "10:00"}
        r = requests.post(f"{API}/tl/leads/{lid}/call", json=payload, headers=tl_h, timeout=30)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["ok"] is True and j["converted_to_file"] is False
        tl_lead["_first_tl_call_id"] = j["tl_call_id"]

    def test_tl_call_conversion(self, tl_h, tl_lead):
        lid = tl_lead["lead_id"]
        payload = {"duration_seconds": 90, "outcome": "connected",
                   "resulting_status": "file", "convert_to_file": True,
                   "notes": "TL converting to file"}
        r = requests.post(f"{API}/tl/leads/{lid}/call", json=payload, headers=tl_h, timeout=30)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["ok"] is True and j["converted_to_file"] is True
        tl_lead["_second_tl_call_id"] = j["tl_call_id"]

    def test_lead_ownership_preserved(self, admin_h, tl_lead):
        from pymongo import MongoClient
        from bson import ObjectId
        lid = tl_lead["lead_id"]
        original_gp = tl_lead["gp_id"]
        c = MongoClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))[os.environ.get("DB_NAME", "test_database")]
        match = c.leads.find_one({"_id": ObjectId(lid)})
        assert match, f"Lead {lid} not found"
        assert match.get("status") == "file", f"status should be file, got {match.get('status')}"
        assert str(match.get("source_id")) == str(original_gp), \
            f"source_id should stay = original GP {original_gp}, got {match.get('source_id')}"
        assert bool(match.get("converted_by_tl")) is True
        # assigned_to (GP owner) must still be original
        assert str(match.get("assigned_to")) == str(original_gp)

    def test_gp_call_logs_unchanged(self, admin_h, tl_lead):
        from pymongo import MongoClient
        lid = tl_lead["lead_id"]
        c = MongoClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))[os.environ.get("DB_NAME", "test_database")]
        gp_count = c.call_logs.count_documents({"lead_id": lid})
        print(f"GP call_logs for {lid} = {gp_count} (should be 0 — TL calls go to tl_call_logs only)")
        assert gp_count == 0, f"GP call_logs should be 0, got {gp_count}"
        tl_count = c.tl_call_logs.count_documents({"lead_id": lid})
        assert tl_count >= 2, f"tl_call_logs should have >=2 entries, got {tl_count}"


# -------------------- call log listing + filters --------------------
class TestCallLogs:
    def test_tl_call_logs_list(self, tl_h):
        r = requests.get(f"{API}/tl/call-logs", headers=tl_h, timeout=30)
        assert r.status_code == 200
        j = r.json()
        assert "logs" in j and isinstance(j["logs"], list)
        assert j["total"] >= 2
        first = j["logs"][0]
        for k in ("tl_name", "customer", "gp_name", "outcome", "resulting_status", "converted_to_file"):
            assert k in first, f"missing key {k}"

    def test_filter_outcome(self, tl_h):
        r = requests.get(f"{API}/tl/call-logs?outcome=connected", headers=tl_h, timeout=30)
        assert r.status_code == 200
        for row in r.json().get("logs", []):
            assert row["outcome"] == "connected"

    def test_filter_converted_yes(self, tl_h):
        r = requests.get(f"{API}/tl/call-logs?converted=yes", headers=tl_h, timeout=30)
        assert r.status_code == 200
        for row in r.json().get("logs", []):
            assert row["converted_to_file"] is True


# -------------------- reports --------------------
class TestReports:
    def test_summary(self, tl_h):
        r = requests.get(f"{API}/tl/reports/summary?period=month", headers=tl_h, timeout=30)
        assert r.status_code == 200
        j = r.json()
        assert "overall" in j and "tls" in j
        for k in ("tl_calls", "connected", "call_back", "follow_ups", "files", "conversion_pct"):
            assert k in j["overall"], f"missing overall key {k}"
        assert isinstance(j["tls"], list) and len(j["tls"]) >= 1

    def test_hourly(self, tl_h):
        r = requests.get(f"{API}/tl/reports/hourly", headers=tl_h, timeout=30)
        assert r.status_code == 200
        j = r.json()
        assert "hours" in j
        if j["hours"]:
            h = j["hours"][0]
            for k in ("hour", "tl_calls", "connected", "call_back", "not_answering", "files"):
                assert k in h

    def test_conversion(self, tl_h):
        r = requests.get(f"{API}/tl/reports/conversion?period=month", headers=tl_h, timeout=30)
        assert r.status_code == 200
        j = r.json()
        for k in ("leads_received", "contacted", "connected", "files",
                  "contact_rate", "connected_rate", "file_conversion_rate"):
            assert k in j


# -------------------- cross-team POST 403 --------------------
class TestCrossTeamForbidden:
    def test_post_call_on_out_of_team_lead(self, admin_h, tl_h):
        # find a lead assigned to a GP NOT in Anusha's team
        rmeta = requests.get(f"{API}/tl/meta", headers=tl_h, timeout=30).json()
        my_gp_ids = {g["id"] for g in rmeta.get("gps", [])}
        # get admin leads listing and pick one whose assigned_to not in my_gp_ids
        rlist = requests.get(f"{API}/leads?limit=1000", headers=admin_h, timeout=60)
        assert rlist.status_code == 200
        rows = rlist.json() if isinstance(rlist.json(), list) else rlist.json().get("leads", [])
        target = None
        for l in rows:
            gp = str(l.get("assigned_to") or "")
            if gp and gp not in my_gp_ids and l.get("status") in ("leads", "converted", "follow_up", "new"):
                target = l
                break
        if not target:
            pytest.skip("no cross-team lead found for 403 test")
        lid = str(target.get("id") or target.get("_id"))
        r = requests.post(f"{API}/tl/leads/{lid}/call", headers=tl_h,
                          json={"outcome": "connected"}, timeout=30)
        assert r.status_code == 403, f"expected 403 got {r.status_code} {r.text}"


# -------------------- admin scope --------------------
class TestAdminScope:
    def test_admin_leads(self, admin_h):
        r = requests.get(f"{API}/tl/leads", headers=admin_h, timeout=60)
        assert r.status_code == 200

    def test_admin_reports_summary(self, admin_h):
        r = requests.get(f"{API}/tl/reports/summary?period=month", headers=admin_h, timeout=30)
        assert r.status_code == 200


# -------------------- regression: GP + Meta reports --------------------
class TestRegression:
    def test_gp_reports_telecallers(self, admin_h):
        r = requests.get(f"{API}/reports/telecallers?period=today", headers=admin_h, timeout=30)
        assert r.status_code == 200
        # ensure any TL calls (call_level=TL) NOT counted in GP calls: pick our tl_lead's GP and verify
        # this is smoke-level; deep parity is covered by iteration reports tests.

    def test_gp_reports_hourly(self, admin_h):
        r = requests.get(f"{API}/reports/hourly?period=today", headers=admin_h, timeout=30)
        assert r.status_code == 200

    def test_dashboard_stats(self, admin_h):
        r = requests.get(f"{API}/dashboard/stats", headers=admin_h, timeout=30)
        assert r.status_code == 200

    def test_meta_reports_summary(self, admin_h):
        r = requests.get(f"{API}/meta/reports/summary?period=today", headers=admin_h, timeout=30)
        assert r.status_code == 200

    def test_meta_reports_hourly(self, admin_h):
        r = requests.get(f"{API}/meta/reports/hourly?period=today", headers=admin_h, timeout=30)
        assert r.status_code == 200
