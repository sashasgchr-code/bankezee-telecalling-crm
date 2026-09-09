"""Tests for new Meta reporting endpoints (/api/meta/reports/summary and /hourly)."""
import os
import datetime
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://responsive-crm-app-1.preview.emergentagent.com").rstrip("/")

ADMIN_EMAIL = "admin@bankezee.com"
ADMIN_PASSWORD = "ConnectSasha12!!"

GP_META_EMAIL = "banothunithinnaik@gmail.com"
GP_META_PASSWORD = "Nithin@123"

# Non-meta user - a GP without meta_access. Use rama@bankezee.com (ops role) if meta_access
# might be enabled for ops. Better: try a plain growth_partner without meta_access.
# Use nani9346480@gmail.com (Anil@123) — not in the meta users mapping.
NON_META_EMAIL = "nani9346480@gmail.com"
NON_META_PASSWORD = "Anil@123"


def _login(email: str, password: str):
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"Login failed for {email}: {r.status_code} {r.text[:200]}"
    data = r.json()
    token = data.get("access_token") or data.get("token")
    if token:
        s.headers.update({"Authorization": f"Bearer {token}"})
    return s, data


@pytest.fixture(scope="module")
def admin_session():
    s, _ = _login(ADMIN_EMAIL, ADMIN_PASSWORD)
    return s


@pytest.fixture(scope="module")
def gp_meta_session():
    s, data = _login(GP_META_EMAIL, GP_META_PASSWORD)
    return s, data


# --------- Summary ---------
class TestMetaReportsSummary:
    def test_admin_lifetime_shape_and_totals(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/meta/reports/summary?period=lifetime", timeout=30)
        assert r.status_code == 200, r.text[:300]
        data = r.json()
        assert "overall" in data and "partners" in data
        overall = data["overall"]
        for k in ["total_calls", "total_connected", "total_call_seconds", "total_leads_generated", "total_file"]:
            assert k in overall, f"Missing overall key: {k}"
        partners = data["partners"]
        # No double counting: overall totals equal sum of partner rows
        assert overall["total_calls"] == sum(p["total_calls"] for p in partners), "total_calls mismatch"
        assert overall["total_connected"] == sum(p["total_connected"] for p in partners)
        assert overall["total_call_seconds"] == sum(p["total_call_seconds"] for p in partners)
        assert overall["total_leads_generated"] == sum(p["leads_generated"] for p in partners)
        assert overall["total_file"] == sum(p["file"] for p in partners)
        # Sanity: the manual verification numbers reported by main agent
        print("Admin lifetime overall:", overall, "partner_count:", len(partners))

    @pytest.mark.parametrize("period", ["today", "week", "month", "three_months", "lifetime"])
    def test_admin_periods_no_error(self, admin_session, period):
        r = admin_session.get(f"{BASE_URL}/api/meta/reports/summary?period={period}", timeout=30)
        assert r.status_code == 200, f"{period}: {r.status_code} {r.text[:200]}"
        d = r.json()
        assert "overall" in d and "partners" in d

    def test_admin_custom_range(self, admin_session):
        today = datetime.date.today()
        past = today - datetime.timedelta(days=30)
        r = admin_session.get(
            f"{BASE_URL}/api/meta/reports/summary?from_date={past.isoformat()}&to_date={today.isoformat()}",
            timeout=30,
        )
        assert r.status_code == 200, r.text[:200]
        d = r.json()
        assert "overall" in d and "partners" in d

    def test_gp_only_own_bucket(self, gp_meta_session):
        s, login_data = gp_meta_session
        r = s.get(f"{BASE_URL}/api/meta/reports/summary?period=lifetime", timeout=30)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        partners = d["partners"]
        # GP must see only its own bucket (single row or zero rows)
        assert len(partners) <= 1, f"GP saw {len(partners)} partners: {[p['user_name'] for p in partners]}"
        if partners:
            name = partners[0]["user_name"]
            assert "nithin" in name.lower() or "banothu" in name.lower(), f"Unexpected partner name: {name}"
            # overall must equal that one row
            assert d["overall"]["total_calls"] == partners[0]["total_calls"]
            print("GP summary row:", partners[0])

    def test_non_meta_user_forbidden(self):
        try:
            s, _ = _login(NON_META_EMAIL, NON_META_PASSWORD)
        except AssertionError:
            pytest.skip("Non-meta test user login failed")
        r = s.get(f"{BASE_URL}/api/meta/reports/summary?period=lifetime", timeout=30)
        assert r.status_code == 403, f"Expected 403 for non-meta user, got {r.status_code}: {r.text[:200]}"


# --------- Hourly ---------
class TestMetaReportsHourly:
    def test_admin_hourly_shape_and_totals(self, admin_session):
        # pick a recent date likely to have data
        for delta in range(0, 30):
            d = (datetime.date.today() - datetime.timedelta(days=delta)).isoformat()
            r = admin_session.get(f"{BASE_URL}/api/meta/reports/hourly?date={d}", timeout=30)
            assert r.status_code == 200, r.text[:200]
            data = r.json()
            assert "telecallers" in data
            if data["telecallers"]:
                break
        for tc in data["telecallers"]:
            assert "hourly_breakdown" in tc
            s_calls = sum(h["calls"] for h in tc["hourly_breakdown"])
            assert tc["total_calls"] == s_calls, f"{tc['user_name']}: total_calls {tc['total_calls']} != sum hourly {s_calls}"
            s_conn = sum(h["connected"] for h in tc["hourly_breakdown"])
            assert tc["total_connected"] == s_conn
        print(f"Admin hourly date={data.get('date')} telecallers={len(data['telecallers'])}")

    def test_gp_hourly_only_own_bucket(self, gp_meta_session):
        s, _ = gp_meta_session
        d = datetime.date.today().isoformat()
        r = s.get(f"{BASE_URL}/api/meta/reports/hourly?date={d}", timeout=30)
        assert r.status_code == 200
        data = r.json()
        tcs = data["telecallers"]
        assert len(tcs) <= 1
        if tcs:
            name = tcs[0]["user_name"].lower()
            assert "nithin" in name or "banothu" in name

    def test_non_meta_user_forbidden_hourly(self):
        try:
            s, _ = _login(NON_META_EMAIL, NON_META_PASSWORD)
        except AssertionError:
            pytest.skip("Non-meta test user login failed")
        r = s.get(f"{BASE_URL}/api/meta/reports/hourly", timeout=30)
        assert r.status_code == 403
