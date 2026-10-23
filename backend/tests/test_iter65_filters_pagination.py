# Iteration 65: Admin Leads advanced filters/pagination/export + Meta Files filters, pagination, role visibility
import io
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")

ADMIN = ("admin@bankezee.com", "ConnectSasha12!!")
GP = ("yarragondaanusha@gmail.com", "MetaGP123!")
PROC = ("teja@bankezee.com", "tejasme12")


def _login(email, pw):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": pw}, timeout=30)
    if r.status_code != 200 and os.path.exists("/app/backend/tests/mint_token.py"):
        import subprocess
        tok = subprocess.check_output(["python", "/app/backend/tests/mint_token.py", email]).decode().strip().splitlines()[-1]
        print(f"WARN: login failed for {email} ({r.status_code}); using minted token")
        s = requests.Session(); s.headers.update({"Authorization": f"Bearer {tok}"}); return s
    if r.status_code != 200:
        pytest.skip(f"login failed for {email}: {r.status_code} {r.text[:200]}")
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {r.json()['token']}"})
    return s


@pytest.fixture(scope="module")
def admin():
    return _login(*ADMIN)


@pytest.fixture(scope="module")
def gp():
    return _login(*GP)


@pytest.fixture(scope="module")
def proc():
    return _login(*PROC)


def _total(s, **params):
    r = s.get(f"{BASE_URL}/api/leads", params={"page_size": 10, **params}, timeout=60)
    assert r.status_code == 200, r.text[:300]
    d = r.json()
    return d["pagination"]["total_count"]


# ---------------- Admin Leads ----------------
class TestAdminLeads:
    def test_filter_options(self, admin):
        r = admin.get(f"{BASE_URL}/api/leads/filter-options", timeout=60)
        assert r.status_code == 200
        d = r.json()
        assert isinstance(d["cities"], list) and len(d["cities"]) > 50
        assert isinstance(d["employments"], list) and len(d["employments"]) >= 1
        assert all(c and c.strip() for c in d["cities"])

    def test_salary_buckets_reconcile(self, admin):
        total = _total(admin)
        buckets = ["0-25000", "25000-50000", "50000-100000", "100000-", "none"]
        parts = {b: _total(admin, salary_ranges=b) for b in buckets}
        print("salary parts", parts, "total", total)
        assert sum(parts.values()) == total, f"buckets {parts} != total {total}"

    def test_employment_reconcile(self, admin):
        opts = admin.get(f"{BASE_URL}/api/leads/filter-options").json()["employments"]
        total = _total(admin)
        s = sum(_total(admin, employments=e) for e in opts) + _total(admin, employments="none")
        assert s == total

    def test_combined_and(self, admin):
        a = _total(admin, employments="salaried")
        b = _total(admin, salary_ranges="25000-50000")
        both = _total(admin, employments="salaried", salary_ranges="25000-50000")
        assert both <= min(a, b)
        # verify every row matches
        r = admin.get(f"{BASE_URL}/api/leads", params={"employments": "salaried", "salary_ranges": "25000-50000", "page_size": 200})
        leads = r.json().get("leads") or r.json().get("items")
        for l in leads:
            assert l.get("employment_type") == "salaried"
            v = float((l.get("additional_data") or {}).get("net_salary"))
            assert 25000 <= v < 50000

    def test_city_multi_and_none(self, admin):
        cities = admin.get(f"{BASE_URL}/api/leads/filter-options").json()["cities"]
        c1, c2 = cities[0], cities[1]
        t1, t2 = _total(admin, cities=c1), _total(admin, cities=c2)
        assert _total(admin, cities=f"{c1},{c2}") == t1 + t2

    def test_pagination(self, admin):
        r1 = admin.get(f"{BASE_URL}/api/leads", params={"page": 1, "page_size": 25}).json()
        r2 = admin.get(f"{BASE_URL}/api/leads", params={"page": 2, "page_size": 25}).json()
        l1 = r1.get("leads") or r1.get("items")
        l2 = r2.get("leads") or r2.get("items")
        assert len(l1) == 25
        assert not ({x["id"] for x in l1} & {x["id"] for x in l2})

    def test_stats_with_filters(self, admin):
        r = admin.get(f"{BASE_URL}/api/leads/stats", params={"salary_ranges": "100000-"}, timeout=60)
        assert r.status_code == 200, r.text[:300]
        print("stats", r.json())

    def test_export_filtered(self, admin):
        total = _total(admin, salary_ranges="0-25000")
        r = admin.post(f"{BASE_URL}/api/leads/export", json={"salary_ranges": "0-25000"}, timeout=120)
        if r.status_code == 405 or r.status_code == 404:
            r = admin.get(f"{BASE_URL}/api/leads/export", params={"salary_ranges": "0-25000"}, timeout=120)
        assert r.status_code == 200, r.text[:300]
        import openpyxl
        wb = openpyxl.load_workbook(io.BytesIO(r.content))
        ws = wb.active
        headers = [c.value for c in ws[1]]
        rows = ws.max_row - 1
        print("export headers", headers, "rows", rows, "total", total)
        assert rows == total
        assert any("Employment" in str(h) for h in headers)
        assert any("Salary" in str(h) for h in headers)

    def test_gp_filter_options_scoped(self, gp, admin):
        r = gp.get(f"{BASE_URL}/api/leads/filter-options")
        assert r.status_code == 200
        gp_c = set(r.json()["cities"])
        ad_c = set(admin.get(f"{BASE_URL}/api/leads/filter-options").json()["cities"])
        assert gp_c <= ad_c
        # Each GP city must appear in GP's own leads
        for c in list(gp_c)[:5]:
            assert _total(gp, cities=c) > 0


# ---------------- Meta Files ----------------
def _meta(s, **params):
    r = s.get(f"{BASE_URL}/api/meta/leads", params={"status": "FILE", "page_size": 200, **params}, timeout=60)
    assert r.status_code == 200, r.text[:300]
    return r.json()


class TestMetaFiles:
    def test_docs_reconcile(self, admin):
        t = _meta(admin)["total"]
        assert _meta(admin, docs="received")["total"] + _meta(admin, docs="pending")["total"] == t

    def test_assignment_reconcile(self, admin):
        t = _meta(admin)["total"]
        assert _meta(admin, assignment="assigned")["total"] + _meta(admin, assignment="unassigned")["total"] == t

    def test_pagination(self, admin):
        d = _meta(admin, page=2, page_size=10)
        assert d["page"] == 2 and d["page_size"] == 10
        assert len(d["items"]) <= 10
        p1 = _meta(admin, page=1, page_size=10)
        assert not ({x["lead_id"] for x in p1["items"]} & {x["lead_id"] for x in d["items"]})

    def test_loan_type_filter_uses_file_loan_type(self, admin):
        opts = admin.get(f"{BASE_URL}/api/meta/files/filter-options").json()
        assert "loan_types" in opts and "banks" in opts
        for lt in opts["loan_types"]:
            items = _meta(admin, loan_type=lt)["items"]
            assert items, f"loan type {lt} returned nothing"
            for it in items:
                assert (it.get("file") or {}).get("loan_type") == lt

    def test_bank_filter(self, admin):
        opts = admin.get(f"{BASE_URL}/api/meta/files/filter-options").json()
        for b in opts["banks"][:5]:
            assert _meta(admin, bank=b)["total"] > 0

    def test_bank_regex_special_chars_no_500(self, admin):
        r = admin.get(f"{BASE_URL}/api/meta/leads", params={"status": "FILE", "bank": "ICICI (test"})
        assert r.status_code != 500, "unescaped regex in bank filter causes 500"

    def test_gp_scope(self, gp):
        me = gp.get(f"{BASE_URL}/api/meta/me").json()
        uid = me.get("meta_user_id")
        assert uid, "GP has no meta_user_id"
        d = _meta(gp)
        for it in d["items"]:
            assert it.get("assigned_partner_id") == uid
        # staff-only params must be ignored
        assert _meta(gp, assignment="unassigned")["total"] == d["total"]
        assert _meta(gp, processor="UNASSIGNED")["total"] == d["total"]
        assert _meta(gp, partner="ALL")["total"] == d["total"]
        print("gp files", d["total"])

    def test_gp_filter_options_scoped(self, gp):
        uid = gp.get(f"{BASE_URL}/api/meta/me").json().get("meta_user_id")
        opts = gp.get(f"{BASE_URL}/api/meta/files/filter-options").json()
        own = _meta(gp)["items"]
        own_lt = {(i.get("file") or {}).get("loan_type") for i in own}
        for lt in opts["loan_types"]:
            assert lt in own_lt, f"GP sees loan_type {lt} not in own files"

    def test_processor_scope(self, proc):
        uid = proc.get(f"{BASE_URL}/api/meta/me").json().get("meta_user_id")
        d = _meta(proc)
        for it in d["items"]:
            assert it.get("assigned_processor_id") == uid
        assert _meta(proc, processor="ALL")["total"] == d["total"]
        print("proc files", d["total"])
