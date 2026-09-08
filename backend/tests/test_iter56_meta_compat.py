"""Iter56 - Meta File-Detail compat adapter + Admin User Management Meta access.

Tests:
1. Admin can read/write meta_files-compat endpoints.
2. GP scoping: 200 on own file GET/details, 403 on eligibilities and 403 on other file.
3. Admin PATCH /api/meta/admin/users/{id} persists meta_access, meta_role, meta_user_id, meta_email.
4. Connect regression: GET /api/files/{id} still works with green Connect contract; no meta sidebar field impact.
"""
import os
import pytest
import requests

def _load_backend_url():
    v = os.environ.get("REACT_APP_BACKEND_URL")
    if v:
        return v.rstrip("/")
    try:
        with open("/app/frontend/.env") as f:
            for ln in f:
                if ln.startswith("REACT_APP_BACKEND_URL="):
                    return ln.split("=", 1)[1].strip().rstrip("/")
    except Exception:
        pass
    return ""

BASE_URL = _load_backend_url()
API = f"{BASE_URL}/api"

ADMIN = {"email": "admin@bankezee.com", "password": "ConnectSasha12!!"}
GP = {"email": "banothunithinnaik@gmail.com", "password": "Nithin@123"}


def _login(session, creds):
    r = session.post(f"{API}/auth/login", json=creds, timeout=30)
    assert r.status_code == 200, f"Login failed for {creds['email']}: {r.status_code} {r.text[:200]}"
    data = r.json()
    tok = data.get("access_token") or data.get("token")
    if tok:
        session.headers.update({"Authorization": f"Bearer {tok}"})
    return data


@pytest.fixture(scope="module")
def admin_sess():
    s = requests.Session()
    _login(s, ADMIN)
    return s


@pytest.fixture(scope="module")
def gp_sess():
    s = requests.Session()
    _login(s, GP)
    return s


# ------------------- Admin compat file detail -------------------
class TestAdminCompatFileDetail:
    KNOWN_FILE = "lead_f5b36fe331b7"

    def test_bank_names(self, admin_sess):
        r = admin_sess.get(f"{API}/meta/files-compat/bank-names")
        assert r.status_code == 200
        assert isinstance(r.json().get("banks"), list)

    def test_get_file(self, admin_sess):
        r = admin_sess.get(f"{API}/meta/files-compat/{self.KNOWN_FILE}")
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert d.get("lead_id") == self.KNOWN_FILE
        assert "file_details" in d and isinstance(d["file_details"], dict)
        assert "eligibilities" in d and isinstance(d["eligibilities"], list)
        assert "file_activities" in d
        assert d.get("file_status")  # present

    def test_update_details_persist(self, admin_sess):
        payload = {"additional_data": {"company_name": "TEST_iter56_Co", "net_salary": 55000}}
        r = admin_sess.put(f"{API}/meta/files-compat/{self.KNOWN_FILE}/details", json=payload)
        assert r.status_code == 200, r.text[:300]
        assert r.json()["file_details"]["company_name"] == "TEST_iter56_Co"
        # verify persist
        r2 = admin_sess.get(f"{API}/meta/files-compat/{self.KNOWN_FILE}")
        assert r2.json()["file_details"]["company_name"] == "TEST_iter56_Co"

    def test_update_eligibilities_and_commission(self, admin_sess):
        payload = {"eligibilities": [{
            "bank_name": "TEST_ITER56_BANK",
            "is_eligible": "yes",
            "disbursed": "yes",
            "disbursed_amount": 480000,
            "commission_percentage": 1.5,
        }]}
        r = admin_sess.put(f"{API}/meta/files-compat/{self.KNOWN_FILE}/eligibilities", json=payload)
        assert r.status_code == 200, r.text[:300]
        eligs = r.json()["eligibilities"]
        assert any(e.get("bank_name") == "TEST_ITER56_BANK" for e in eligs)
        # commission auto-computed: 480000*1.5% = 7200 (stored in meta mirror; connect view maps commission_amount)
        # commission_amount is on the meta bank; connect returns it as well
        bank = next(e for e in eligs if e["bank_name"] == "TEST_ITER56_BANK")
        assert float(bank.get("commission_amount") or 0) == 7200.0

    def test_status_update(self, admin_sess):
        r = admin_sess.put(f"{API}/meta/files-compat/{self.KNOWN_FILE}/file-status", json={"file_status": "Disbursed"})
        assert r.status_code == 200, r.text[:300]
        assert r.json()["file_status"] == "Disbursed"

    def test_add_note(self, admin_sess):
        r = admin_sess.post(f"{API}/meta/files-compat/{self.KNOWN_FILE}/notes", json={"note": "TEST_iter56 note"})
        assert r.status_code == 200, r.text[:300]
        acts = r.json()["file_activities"]
        assert any("TEST_iter56 note" in (a.get("message") or "") for a in acts)


# ------------------- GP scoping -------------------
class TestGPScoping:
    def test_gp_own_file_and_forbidden_other(self, gp_sess, admin_sess):
        # Find one GP-owned FILE
        r = gp_sess.get(f"{API}/meta/leads?status=FILE&page_size=5")
        assert r.status_code == 200
        items = r.json().get("items") or r.json().get("leads") or []
        assert items, "GP has no FILE leads to test with"
        own_id = items[0].get("lead_id") or items[0].get("id")

        r_own = gp_sess.get(f"{API}/meta/files-compat/{own_id}")
        assert r_own.status_code == 200, r_own.text[:300]

        # PUT details -> allowed
        r_det = gp_sess.put(f"{API}/meta/files-compat/{own_id}/details",
                            json={"additional_data": {"cibil_score": 700}})
        assert r_det.status_code == 200, r_det.text[:300]

        # PUT eligibilities -> forbidden for GP
        r_el = gp_sess.put(f"{API}/meta/files-compat/{own_id}/eligibilities",
                           json={"eligibilities": []})
        assert r_el.status_code == 403, f"GP should be view-only on eligibilities, got {r_el.status_code}"

        # GET other file (lead_f5b36fe331b7 belongs to Rama, not GP Nithin) -> 403
        r_other = gp_sess.get(f"{API}/meta/files-compat/lead_f5b36fe331b7")
        assert r_other.status_code == 403


# ------------------- Admin User Management Meta access -------------------
class TestMetaUserManagement:
    def test_patch_and_persist(self, admin_sess):
        # Find non-admin connect user
        r = admin_sess.get(f"{API}/meta/admin/user-management")
        assert r.status_code == 200, r.text[:300]
        data = r.json()
        candidates = [u for u in data["connect_users"] if u.get("role") != "admin" and u.get("is_active", True)]
        assert candidates, "No non-admin connect user available"
        user = candidates[0]
        uid = user.get("id") or user.get("_id")

        # Fetch available unlinked meta user
        meta_users = [m for m in data["meta_users"] if not m.get("linked")]
        # Pick meta_user_id if any unlinked otherwise skip mapping
        m_uid = meta_users[0]["user_id"] if meta_users else None

        payload = {
            "meta_access": True,
            "meta_role": "processor",
            "meta_email": "TEST_iter56@example.com",
            "meta_user_id": m_uid,
        }
        r2 = admin_sess.patch(f"{API}/meta/admin/users/{uid}", json=payload)
        assert r2.status_code == 200, r2.text[:300]
        upd = r2.json()
        assert upd.get("meta_access") is True
        assert upd.get("meta_role") == "processor"
        assert upd.get("meta_email") == "TEST_iter56@example.com"
        if m_uid:
            assert upd.get("meta_user_id") == m_uid

        # Reload to confirm persistence
        r3 = admin_sess.get(f"{API}/meta/admin/user-management")
        found = next((u for u in r3.json()["connect_users"] if (u.get("id") or u.get("_id")) == uid), None)
        assert found is not None
        assert found.get("meta_access") is True
        assert found.get("meta_role") == "processor"

        # Cleanup: revert
        admin_sess.patch(f"{API}/meta/admin/users/{uid}", json={
            "meta_access": bool(user.get("meta_access", False)),
            "meta_role": user.get("meta_role"),
            "meta_email": user.get("meta_email"),
            "meta_user_id": user.get("meta_user_id"),
        })


# ------------------- Connect regression -------------------
class TestConnectRegression:
    def test_connect_file_detail_unchanged(self, admin_sess):
        r = admin_sess.get(f"{API}/files?limit=1")
        assert r.status_code == 200
        j = r.json()
        files = j if isinstance(j, list) else (j.get("files") or j.get("items") or [])
        assert files, "No Connect files"
        fid = files[0].get("id") or files[0].get("_id")
        r2 = admin_sess.get(f"{API}/files/{fid}")
        assert r2.status_code == 200
        d = r2.json()
        assert "file_details" in d
        assert "eligibilities" in d
        # should NOT contain meta-only sidebar fields (assigned_partner_id is legit connect field; check meta_status)
        # meta_status is only on compat response
        assert "meta_status" not in d
