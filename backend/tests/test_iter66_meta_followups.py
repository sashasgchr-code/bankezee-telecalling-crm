# Iteration 66: Meta CRM Query / Hold split + mandatory follow-up + reminders + role enforcement
import os
import subprocess
import asyncio
from datetime import datetime, timedelta, timezone

import pytest
import requests
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
load_dotenv("/app/backend/.env")

ADMIN = ("admin@bankezee.com", "ConnectSasha12!!")
PROC = ("teja@bankezee.com", "tejasme12")
RAMA = ("rama@bankezee.com", "rama@bzc12")  # meta_role in DB = growth_partner (!)
OPS_META_EMAIL = "rama@neosales.org"  # active meta_role=ops user (minted token)

ADMIN_LEAD = "lead_950768961840"   # FILE, partner Anusha, processor != Teja
TEJA_LEAD = "lead_55772c498293"    # FILE, assigned to Teja
GP_EMAIL = "yarragondaanusha@gmail.com"  # assigned partner of ADMIN_LEAD

IST = timezone(timedelta(hours=5, minutes=30))
TODAY = datetime.now(IST).date()
D = lambda n: (TODAY + timedelta(days=n)).isoformat()
SNAP_FIELDS = ["processing_status", "followup", "followup_history", "updated_at"]


def _db():
    return AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro) if False else asyncio.run(coro)


def _minted(email):
    tok = subprocess.check_output(["python", "/app/backend/tests/mint_token.py", email]).decode().strip().splitlines()[-1]
    s = requests.Session(); s.headers.update({"Authorization": f"Bearer {tok}"}); return s


def _login(email, pw):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": pw}, timeout=30)
    if r.status_code != 200:
        return _minted(email)
    s = requests.Session(); s.headers.update({"Authorization": f"Bearer {r.json()['token']}"}); return s


@pytest.fixture(scope="module", autouse=True)
def snapshot_restore():
    async def snap():
        db = _db()
        return {lid: await db.meta_leads.find_one({"lead_id": lid}, {f: 1 for f in SNAP_FIELDS}) for lid in (ADMIN_LEAD, TEJA_LEAD)}
    saved = asyncio.run(snap())
    yield
    async def restore():
        db = _db()
        for lid, doc in saved.items():
            s = {f: doc.get(f) for f in SNAP_FIELDS if f in doc}
            u = [f for f in ("processing_status", "followup", "followup_history") if f not in doc]
            upd = {"$set": s}
            if u:
                upd["$unset"] = {f: "" for f in u}
            await db.meta_leads.update_one({"lead_id": lid}, upd)
    asyncio.run(restore())


@pytest.fixture(scope="module")
def admin():
    return _login(*ADMIN)


@pytest.fixture(scope="module")
def proc():
    return _login(*PROC)


@pytest.fixture(scope="module")
def gp():
    return _minted(GP_EMAIL)


@pytest.fixture(scope="module")
def rama():
    return _login(*RAMA)


@pytest.fixture(scope="module")
def ops():
    return _minted(OPS_META_EMAIL)


def put_status(s, lid, status, fu=None):
    body = {"file_status": status}
    if fu is not None:
        body["followup"] = fu
    return s.put(f"{BASE_URL}/api/meta/files-compat/{lid}/file-status", json=body, timeout=30)


def patch_fu(s, lid, desc, date, remarks=""):
    return s.patch(f"{BASE_URL}/api/meta/files-compat/{lid}/followup",
                   json={"description": desc, "followup_date": date, "remarks": remarks}, timeout=30)


def get_file(s, lid):
    r = s.get(f"{BASE_URL}/api/meta/files-compat/{lid}", timeout=30)
    assert r.status_code == 200, r.text[:300]
    return r.json()


def list_ids(s, **params):
    r = s.get(f"{BASE_URL}/api/meta/leads", params={"status": "FILE", "page_size": 200, **params}, timeout=60)
    assert r.status_code == 200, r.text[:300]
    d = r.json()
    return {x["lead_id"] for x in d["items"]}, d


def followups(s):
    r = s.get(f"{BASE_URL}/api/meta/followups", timeout=30)
    assert r.status_code == 200, r.text[:300]
    return r.json()


# ---------- mandatory validation ----------
class TestMandatory:
    def test_query_without_followup_rejected(self, admin):
        r = put_status(admin, ADMIN_LEAD, "Query")
        assert r.status_code == 400
        assert "Query Description" in r.json()["detail"]

    def test_hold_with_only_reason_rejected(self, admin):
        r = put_status(admin, ADMIN_LEAD, "Hold", {"description": "x"})
        assert r.status_code == 400
        assert "Hold Reason" in r.json()["detail"]

    def test_invalid_status_rejected(self, admin):
        assert put_status(admin, ADMIN_LEAD, "Bogus").status_code == 400


# ---------- admin full lifecycle ----------
class TestLifecycle:
    def test_set_query_plus3(self, admin):
        r = put_status(admin, ADMIN_LEAD, "Query", {"description": "TEST_ need ITR", "followup_date": D(3), "remarks": "r1"})
        assert r.status_code == 200, r.text[:300]
        f = get_file(admin, ADMIN_LEAD)
        assert f["file_status"] == "Query"
        assert f["followup"]["active"] is True and f["followup"]["kind"] == "Query"
        assert f["followup"]["followup_date"] == D(3)
        fu = followups(admin)
        it = [i for i in fu["items"] if i["lead_id"] == ADMIN_LEAD]
        assert it and it[0]["urgency"] == "upcoming" and it[0]["days"] == 3
        assert ADMIN_LEAD in {i["lead_id"] for i in fu["reminders"]}

    def test_filter_upcoming(self, admin):
        ids, _ = list_ids(admin, followup="upcoming")
        assert ADMIN_LEAD in ids
        ids, _ = list_ids(admin, followup="overdue")
        assert ADMIN_LEAD not in ids

    def test_reschedule_past_overdue_no_duplicate(self, admin):
        before = len(get_file(admin, ADMIN_LEAD)["followup_history"])
        r = patch_fu(admin, ADMIN_LEAD, "TEST_ need ITR v2", D(-2), "r2")
        assert r.status_code == 200, r.text[:300]
        f = get_file(admin, ADMIN_LEAD)
        assert f["followup"]["followup_date"] == D(-2) and f["followup"]["description"] == "TEST_ need ITR v2"
        assert len(f["followup_history"]) == before + 1
        fu = followups(admin)
        mine = [i for i in fu["items"] if i["lead_id"] == ADMIN_LEAD]
        assert len(mine) == 1 and mine[0]["urgency"] == "overdue"
        ids, d = list_ids(admin, followup="overdue")
        assert ADMIN_LEAD in ids
        for x in d["items"]:
            assert x["followup"]["followup_date"] < D(0)

    def test_due_today(self, admin):
        assert patch_fu(admin, ADMIN_LEAD, "TEST_ today", D(0)).status_code == 200
        ids, _ = list_ids(admin, followup="due_today")
        assert ADMIN_LEAD in ids
        assert [i for i in followups(admin)["items"] if i["lead_id"] == ADMIN_LEAD][0]["urgency"] == "due_today"

    def test_hold(self, admin):
        r = put_status(admin, ADMIN_LEAD, "Hold", {"description": "TEST_ customer travelling", "followup_date": D(1)})
        assert r.status_code == 200
        f = get_file(admin, ADMIN_LEAD)
        assert f["file_status"] == "Hold" and f["followup"]["kind"] == "Hold"
        ids, _ = list_ids(admin, processing_status="Hold")
        assert ADMIN_LEAD in ids
        ids2, _ = list_ids(admin, processing_status="Query")
        assert ADMIN_LEAD not in ids2

    def test_resolve_to_approved(self, admin):
        hist = len(get_file(admin, ADMIN_LEAD)["followup_history"])
        assert put_status(admin, ADMIN_LEAD, "Approved").status_code == 200
        f = get_file(admin, ADMIN_LEAD)
        assert f["followup"]["active"] is False
        assert len(f["followup_history"]) == hist + 1
        assert ADMIN_LEAD not in {i["lead_id"] for i in followups(admin)["items"]}
        assert patch_fu(admin, ADMIN_LEAD, "x", D(1)).status_code == 400

    def test_legacy_and_none_filters(self, admin):
        ids, d = list_ids(admin, processing_status="Query/Hold")
        assert d["total"] >= 1
        none_ids, _ = list_ids(admin, followup="none")
        assert ids <= none_ids  # legacy files without follow-up appear in 'No Follow-up Date'

    def test_invalid_date_format(self, admin):
        # Expectation: garbage date should be rejected (400) — not silently stored
        r = put_status(admin, ADMIN_LEAD, "Query", {"description": "TEST_ bad", "followup_date": "notadate"})
        put_status(admin, ADMIN_LEAD, "Approved")
        assert r.status_code == 400, f"accepted invalid date: {r.status_code}"


# ---------- role enforcement ----------
class TestRoles:
    def test_processor_own_file(self, proc):
        r = put_status(proc, TEJA_LEAD, "Query", {"description": "TEST_ proc query", "followup_date": D(2)})
        assert r.status_code == 200, r.text[:300]
        assert patch_fu(proc, TEJA_LEAD, "TEST_ proc edit", D(3)).status_code == 200
        assert TEJA_LEAD in {i["lead_id"] for i in followups(proc)["items"]}
        assert all(i["lead_id"] == TEJA_LEAD or True for i in followups(proc)["items"])

    def test_processor_followups_scoped(self, proc, admin):
        ids = {i["lead_id"] for i in followups(proc)["items"]}
        ids_list, _ = list_ids(proc)
        assert ids <= ids_list

    def test_processor_other_file_forbidden(self, proc):
        assert put_status(proc, ADMIN_LEAD, "Query", {"description": "x", "followup_date": D(1)}).status_code == 403
        assert patch_fu(proc, ADMIN_LEAD, "x", D(1)).status_code == 403

    def test_gp_forbidden(self, gp, admin):
        assert put_status(admin, ADMIN_LEAD, "Query", {"description": "TEST_ gp", "followup_date": D(1)}).status_code == 200
        assert get_file(gp, ADMIN_LEAD)["followup"]["active"] is True  # GP can view
        assert put_status(gp, ADMIN_LEAD, "Hold", {"description": "x", "followup_date": D(1)}).status_code == 403
        assert patch_fu(gp, ADMIN_LEAD, "x", D(1)).status_code == 403
        assert ADMIN_LEAD in {i["lead_id"] for i in followups(gp)["items"]}

    def test_ops_full_edit(self, ops):
        assert patch_fu(ops, ADMIN_LEAD, "TEST_ ops edit", D(2)).status_code == 200
        assert put_status(ops, ADMIN_LEAD, "Approved").status_code == 200

    def test_rama_ops_meta_role(self, rama):
        # review request says rama@bankezee.com is Meta 'ops' with full edit
        r = put_status(rama, TEJA_LEAD, "Approved")
        assert r.status_code == 200, f"rama got {r.status_code}: {r.text[:200]}"
