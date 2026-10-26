# Iteration 69: Customers & Campaigns module (/api/cc/*) — customers, DOB/consent, CSV import, campaigns (MOCK only), birthdays, templates, RBAC
import os
import io
import time
from datetime import datetime, timedelta

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api/cc"
ADMIN = ("admin@bankezee.com", "ConnectSasha12!!")
MANAGER = ("teja@bankezee.com", "tejasme12")
OPS = ("rama@bankezee.com", "rama@bzc12")
GP = ("pinkynagulapally@gmail.com", "Pinky@1234")
TEST_CUST = "cus_632193f49f3d"  # Domala naveen kumar — TEST data, opted_in
DOB_CUST = "cus_c755190fb0ed"   # multi-loan customer without DOB (reverted after test)


def _login(email, pw):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": pw}, timeout=30)
    if r.status_code != 200:
        pytest.skip(f"login failed for {email}: {r.status_code}")
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {r.json()['token']}"})
    return s


@pytest.fixture(scope="module")
def admin():
    return _login(*ADMIN)


@pytest.fixture(scope="module")
def manager():
    return _login(*MANAGER)


@pytest.fixture(scope="module")
def ops():
    return _login(*OPS)


@pytest.fixture(scope="module")
def gp():
    return _login(*GP)


# --- safety: live sending must stay OFF
def test_live_sending_off(admin):
    me = admin.get(f"{API}/me").json()
    assert me["live_sending"] is False and me["is_admin"] and me["can_campaign"]


# --- customers list / filters / sort / pagination / export
class TestCustomers:
    def test_list_kpis_pagination(self, admin):
        d = admin.get(f"{API}/customers", params={"page_size": 10, "page": 2}).json()
        assert d["total"] > 10 and len(d["items"]) == 10 and d["page"] == 2
        assert {"customers", "approved_loans", "disbursed_loans", "with_dob", "eligible"} <= set(d["kpis"])
        assert d["dob_completion"]["total"] == d["total"]
        assert isinstance(d["missing_by_processor"], list)

    def test_status_filters_partition(self, admin):
        both = admin.get(f"{API}/customers", params={"status": "both"}).json()["total"]
        ap = admin.get(f"{API}/customers", params={"status": "approved"}).json()
        ds = admin.get(f"{API}/customers", params={"status": "disbursed"}).json()
        assert ap["total"] <= both and ds["total"] <= both and ap["total"] + ds["total"] >= both
        for c in ds["items"]:
            assert any(l["status"] == "Disbursed" for l in c["loans"])

    def test_name_mobile_dob_consent_filters(self, admin):
        d = admin.get(f"{API}/customers", params={"name": "domala"}).json()
        assert d["total"] == 1 and d["items"][0]["customer_id"] == TEST_CUST
        phone = d["items"][0]["phone"]
        assert admin.get(f"{API}/customers", params={"mobile": phone[-10:]}).json()["total"] >= 1
        miss = admin.get(f"{API}/customers", params={"dob": "missing"}).json()
        assert all(not c.get("dob") for c in miss["items"])
        oi = admin.get(f"{API}/customers", params={"consent": "opted_in"}).json()
        assert all(c["consent"]["status"] == "opted_in" for c in oi["items"])

    def test_processor_filter_and_options(self, admin):
        o = admin.get(f"{API}/filter-options").json()
        assert o["processors"] and o["gps"] and "banks" in o and "loan_types" in o
        pid = o["processors"][0]["id"]
        d = admin.get(f"{API}/customers", params={"processor": pid, "page_size": 200}).json()
        assert all(any(l.get("processor_id") == pid for l in c["loans"]) for c in d["items"])

    def test_sort_name(self, admin):
        a = admin.get(f"{API}/customers", params={"sort": "name", "dir": "asc", "page_size": 50}).json()["items"]
        names = [(c.get("name") or "").lower() for c in a]
        assert names == sorted(names)

    def test_bad_page_param(self, admin):
        r = admin.get(f"{API}/customers", params={"page": "abc"})
        assert r.status_code in (400, 422), f"non-numeric page returns {r.status_code}"

    def test_export_csv(self, admin):
        r = admin.get(f"{API}/customers/export")
        assert r.status_code == 200 and "text/csv" in r.headers["content-type"]
        assert r.text.startswith("Customer ID,Customer Name,Mobile,DOB")

    def test_detail_multiple_loans(self, admin):
        d = admin.get(f"{API}/customers/{DOB_CUST}").json()
        assert len(d["loans"]) >= 2 and "history" in d and "audit" in d


# --- DOB + consent validation (reverted)
class TestDobConsent:
    def test_dob_flow(self, admin):
        url = f"{API}/customers/{DOB_CUST}"
        orig = admin.get(url).json().get("dob")
        try:
            r = admin.patch(url, json={"dob": "1990-08-15", "overwrite_dob": bool(orig)})
            assert r.status_code == 200 and r.json()["dob"] == "1990-08-15"
            assert r.json()["dob_updated_by"]
            assert admin.patch(url, json={"dob": "1991-01-01"}).status_code == 409
            assert admin.patch(url, json={"dob": "1990-02-31", "overwrite_dob": True}).status_code == 400
            future = (datetime.now() + timedelta(days=5)).strftime("%Y-%m-%d")
            assert admin.patch(url, json={"dob": future, "overwrite_dob": True}).status_code == 400
            r = admin.patch(url, json={"dob": "--06-05", "overwrite_dob": True})
            assert r.status_code == 200 and r.json()["dob"] == "--06-05"
            assert admin.patch(url, json={"dob": "--02-30", "overwrite_dob": True}).status_code == 400
            assert admin.get(url).json()["dob"] == "--06-05"
        finally:
            admin.patch(url, json={"dob": orig or "", "overwrite_dob": True})
        assert admin.get(url).json().get("dob") == orig

    def test_consent_flow(self, admin):
        url = f"{API}/customers/{DOB_CUST}"
        orig = admin.get(url).json().get("consent") or {}
        try:
            assert admin.patch(url, json={"consent_status": "opted_in", "consent_date": "2026-01-01"}).status_code == 400
            assert admin.patch(url, json={"consent_status": "bogus"}).status_code == 400
            r = admin.patch(url, json={"consent_status": "opted_in", "consent_date": "2026-01-01", "consent_source": "TEST form"})
            assert r.status_code == 200 and r.json()["consent"]["status"] == "opted_in"
        finally:
            admin.patch(url, json={"consent_status": orig.get("status") or "unknown"})
        assert (admin.get(url).json().get("consent") or {}).get("status", "unknown") == (orig.get("status") or "unknown")


# --- CSV import preview statuses
def test_import_preview_statuses(admin):
    csv_text = f"customer_id,dob\n{TEST_CUST},01-01-1985\n{DOB_CUST},15-08-1990\n{DOB_CUST},31-02-1990\ncus_nonexistent,01-01-1990\n{TEST_CUST},26-10\n"
    r = admin.post(f"{API}/import/preview", data={"kind": "dob"}, files={"file": ("t.csv", io.BytesIO(csv_text.encode()), "text/csv")})
    assert r.status_code == 200
    st = [x["status"] for x in r.json()["rows"]]
    assert st == ["conflict", "new", "invalid", "not_found", "unchanged"], st


# --- templates
def test_templates_and_sync(admin):
    t = admin.get(f"{API}/templates").json()
    assert any(x["name"] == "loan_application_response" and x["sendable"] for x in t)
    assert all(not x["sendable"] for x in t if x["status"] != "APPROVED")
    r = admin.post(f"{API}/templates/sync")
    assert r.status_code == 200, r.text


# --- campaigns (MOCK)
class TestCampaigns:
    body = {"name": "TEST_QA Campaign", "type": "Custom Campaign", "customer_ids": [TEST_CUST], "filters": {"status": "both"},
            "template": "loan_application_response", "language": "en",
            "var_map": {"customer_name": {"source": "customer_name"}, "button_0": {"source": "static", "value": "abc"}}, "schedule_mode": "now"}

    def test_audience_preview(self, admin):
        r = admin.post(f"{API}/audience/preview", json={"filters": {"status": "both"}})
        d = r.json()
        assert r.status_code == 200 and d["total"] == d["eligible"] + d["excluded"] and d["reasons"]

    def test_pending_template_rejected(self, admin):
        c = admin.post(f"{API}/campaigns", json={**self.body, "template": "welcome_message2"}).json()
        r = admin.post(f"{API}/campaigns/{c['campaign_id']}/preview")
        assert r.status_code == 400
        admin.post(f"{API}/campaigns/{c['campaign_id']}/cancel")

    def test_send_now_mock(self, admin):
        c = admin.post(f"{API}/campaigns", json=self.body).json()
        cid = c["campaign_id"]
        p = admin.post(f"{API}/campaigns/{cid}/preview").json()
        assert p["live_sending"] is False and p["eligible"] == 1 and "Domala" in p["message_preview"]
        assert admin.post(f"{API}/campaigns/{cid}/confirm", json={"confirm": False}).status_code == 400
        r = admin.post(f"{API}/campaigns/{cid}/confirm", json={"confirm": True})
        assert r.status_code == 200 and r.json()["recipients"] == 1
        assert admin.post(f"{API}/campaigns/{cid}/confirm", json={"confirm": True}).status_code == 400  # idempotent
        for _ in range(10):
            d = admin.get(f"{API}/campaigns/{cid}").json()
            if d["status"] == "completed":
                break
            time.sleep(1)
        assert d["status"] == "completed" and d["mode"] == "mock"
        assert d["counts"]["mock"] == 1 and d["recipients"][0]["status"] == "mock"
        ex = admin.get(f"{API}/campaigns-export", params={"cid": cid})
        assert ex.status_code == 200 and "mock" in ex.text

    def test_draft_edit_schedule_pause_resume_cancel(self, admin):
        c = admin.post(f"{API}/campaigns", json={**self.body, "schedule_mode": "draft"}).json()
        cid = c["campaign_id"]
        assert c["status"] == "draft"
        later = (datetime.utcnow() + timedelta(hours=5, minutes=30) + timedelta(days=2)).strftime("%Y-%m-%dT%H:%M")
        u = admin.put(f"{API}/campaigns/{cid}", json={**self.body, "name": "TEST_QA Edited", "schedule_mode": "later", "schedule_at": later})
        assert u.status_code == 200 and u.json()["name"] == "TEST_QA Edited"
        r = admin.post(f"{API}/campaigns/{cid}/confirm", json={"confirm": True})
        assert r.status_code == 200 and r.json()["status"] == "scheduled"
        assert admin.post(f"{API}/campaigns/{cid}/pause").json()["status"] == "paused"
        assert admin.post(f"{API}/campaigns/{cid}/resume").json()["status"] == "running"
        # resumed early -> worker may send; must still be mock. Then cancel (may already be completed).
        r = admin.post(f"{API}/campaigns/{cid}/cancel")
        d = admin.get(f"{API}/campaigns/{cid}").json()
        print("after resume+cancel:", r.status_code, d["status"], d["counts"])
        assert d["counts"]["submitted"] + d["counts"]["sent"] == 0

    def test_cancel_scheduled(self, admin):
        later = (datetime.utcnow() + timedelta(hours=5, minutes=30) + timedelta(days=3)).strftime("%Y-%m-%dT%H:%M")
        c = admin.post(f"{API}/campaigns", json={**self.body, "name": "TEST_QA Sched", "schedule_mode": "later", "schedule_at": later}).json()
        cid = c["campaign_id"]
        assert admin.post(f"{API}/campaigns/{cid}/confirm", json={"confirm": True}).json()["status"] == "scheduled"
        assert admin.post(f"{API}/campaigns/{cid}/cancel").json()["status"] == "cancelled"
        d = admin.get(f"{API}/campaigns/{cid}").json()
        assert d["status"] == "cancelled" and d["counts"]["queued"] == 0

    def test_past_schedule_rejected(self, admin):
        c = admin.post(f"{API}/campaigns", json={**self.body, "name": "TEST_QA Past", "schedule_mode": "later", "schedule_at": "2020-01-01T10:00"}).json()
        assert admin.post(f"{API}/campaigns/{c['campaign_id']}/confirm", json={"confirm": True}).status_code == 400
        admin.post(f"{API}/campaigns/{c['campaign_id']}/cancel")

    def test_test_send_without_number(self, admin):
        cid = admin.get(f"{API}/campaigns").json()["items"][0]["campaign_id"]
        assert admin.post(f"{API}/campaigns/{cid}/test").status_code == 400

    def test_history_kpis_export(self, admin):
        d = admin.get(f"{API}/campaigns").json()
        assert d["kpis"]["campaigns"] == len(d["items"]) >= 1
        assert admin.get(f"{API}/campaigns-export").text.startswith("Campaign,Type")


# --- birthdays
def test_birthdays(admin):
    d = admin.get(f"{API}/birthdays").json()
    assert {"today", "tomorrow", "next7", "missing_dob"} <= set(d["counts"]) and d["settings"]["template"]
    r = admin.put(f"{API}/settings", json={"birthday": {"enabled": True, "template": "welcome_message2", "language": "en"}})
    assert r.status_code == 400
    assert admin.get(f"{API}/birthdays").json()["settings"]["template"] == d["settings"]["template"]


def test_cron_requires_auth():
    assert requests.post(f"{API}/cron/tick").status_code == 401


# --- RBAC
class TestRBAC:
    def test_manager(self, manager, admin):
        me = manager.get(f"{API}/me").json()
        assert me["can_edit"] and not me["can_campaign"]
        tot = manager.get(f"{API}/customers").json()["total"]
        assert 0 < tot <= admin.get(f"{API}/customers").json()["total"]
        assert manager.post(f"{API}/campaigns", json=TestCampaigns.body).status_code == 403
        assert manager.put(f"{API}/settings", json={"live_sending": False}).status_code == 403

    def test_manager_can_edit_dob(self, manager):
        items = manager.get(f"{API}/customers", params={"dob": "missing", "page_size": 10}).json()["items"]
        cid = items[0]["customer_id"]
        r = manager.patch(f"{API}/customers/{cid}", json={"dob": "1988-03-03"})
        assert r.status_code == 200
        manager.patch(f"{API}/customers/{cid}", json={"dob": "", "overwrite_dob": True})

    def test_ops_all_and_edit(self, ops, admin):
        me = ops.get(f"{API}/me").json()
        assert me["can_edit"]
        assert ops.get(f"{API}/customers").json()["total"] == admin.get(f"{API}/customers").json()["total"]

    def test_gp_scoped_readonly(self, gp, admin):
        me = gp.get(f"{API}/me").json()
        assert not me["can_edit"] and not me["can_campaign"]
        d = gp.get(f"{API}/customers", params={"page_size": 200}).json()
        assert d["total"] < admin.get(f"{API}/customers").json()["total"]
        if d["items"]:
            assert gp.patch(f"{API}/customers/{d['items'][0]['customer_id']}", json={"dob": "1990-01-01"}).status_code == 403
        assert gp.get(f"{API}/customers/{TEST_CUST}").status_code in (200, 404)
        assert gp.get(f"{API}/campaigns").status_code == 403
        assert gp.post(f"{API}/live-toggle-nope").status_code in (404, 405)
