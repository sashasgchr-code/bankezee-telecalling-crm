# Iteration 70: WhatsApp Team Inbox (/api/inbox/*) + inbound webhook capture, RBAC, notes, assign, status, quick replies
import os
import hmac
import json
import time
import uuid
import hashlib
import subprocess

import pytest
import requests
from dotenv import dotenv_values
from pymongo import MongoClient

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api/inbox"
ENV = dotenv_values("/app/backend/.env")
SECRET = ENV["META_WHATSAPP_APP_SECRET"]
PNID = ENV["META_WHATSAPP_PHONE_NUMBER_ID"]
TEST_NUM = "910000000000"
mdb = MongoClient(ENV["MONGO_URL"])[ENV["DB_NAME"]]


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
def ops():
    # rama@bankezee.com is meta_role=growth_partner; rama@neosales.org is the Meta 'ops' account (token minted)
    tok = subprocess.check_output(["python", "/app/backend/tests/mint_token.py", "rama@neosales.org"]).decode().strip().splitlines()[-1]
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {tok}"})
    return s


@pytest.fixture(scope="module")
def proc():
    return _login("teja@bankezee.com", "tejasme12")


@pytest.fixture(scope="module")
def gp():
    tok = subprocess.check_output(["python", "/app/backend/tests/mint_token.py", "yarragondaanusha@gmail.com"]).decode().strip().splitlines()[-1]
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {tok}"})
    return s


def _post_webhook(body: dict, sig=None):
    raw = json.dumps(body).encode()
    sig = sig or "sha256=" + hmac.new(SECRET.encode(), raw, hashlib.sha256).hexdigest()
    return requests.post(f"{BASE_URL}/api/integrations/whatsapp/webhook", data=raw,
                         headers={"Content-Type": "application/json", "X-Hub-Signature-256": sig}, timeout=30)


def _inbound(wamid, text="TEST_ hello from tester"):
    return {"entry": [{"changes": [{"value": {"metadata": {"phone_number_id": PNID},
            "contacts": [{"profile": {"name": "Test Tester"}}],
            "messages": [{"from": TEST_NUM, "id": wamid, "timestamp": str(int(time.time())), "type": "text",
                          "text": {"body": text}}]}}]}]}


def _test_conv():
    return mdb.wa_conversations.find_one({"wa_number": TEST_NUM, "phone_number_id": PNID}, {"_id": 0})


# ---- webhook inbound capture
class TestWebhook:
    def test_invalid_signature_401(self):
        r = _post_webhook(_inbound("wamid.TEST_bad"), sig="sha256=" + "0" * 64)
        assert r.status_code == 401

    def test_inbound_creates_and_dedupes(self):
        before = _test_conv() or {}
        wamid = f"wamid.TEST_{uuid.uuid4().hex}"
        r = _post_webhook(_inbound(wamid))
        assert r.status_code == 200, r.text
        r2 = _post_webhook(_inbound(wamid))
        assert r2.status_code == 200
        assert mdb.wa_messages.count_documents({"wamid": wamid}) == 1
        c = _test_conv()
        assert c["status"] == "waiting_team"
        assert c["unread_count"] == (before.get("unread_count") or 0) + 1
        assert c["last_inbound_at"]

    def test_button_and_interactive_parsed(self):
        w1, w2 = f"wamid.TEST_{uuid.uuid4().hex}", f"wamid.TEST_{uuid.uuid4().hex}"
        b = _inbound(w1)
        b["entry"][0]["changes"][0]["value"]["messages"][0].update({"type": "button", "button": {"text": "Yes please"}})
        b["entry"][0]["changes"][0]["value"]["messages"][0].pop("text")
        assert _post_webhook(b).status_code == 200
        i = _inbound(w2)
        i["entry"][0]["changes"][0]["value"]["messages"][0].update(
            {"type": "interactive", "interactive": {"button_reply": {"title": "Talk to expert"}}})
        assert _post_webhook(i).status_code == 200
        assert mdb.wa_messages.find_one({"wamid": w1})["text"] == "Yes please"
        assert mdb.wa_messages.find_one({"wamid": w2})["text"] == "Talk to expert"


# ---- list / detail
class TestList:
    @pytest.mark.parametrize("f", ["all", "mine", "unassigned", "unread", "waiting_customer", "waiting_team", "resolved", "unmatched"])
    def test_filters(self, admin, f):
        r = admin.get(f"{API}/conversations", params={"filter": f, "limit": 5})
        assert r.status_code == 200, r.text
        d = r.json()
        assert isinstance(d["items"], list) and isinstance(d["total"], int)
        for it in d["items"]:
            assert "_id" not in it
            if f == "unmatched":
                assert it["lead_id"] is None
            if f == "unread":
                assert it["unread_count"] > 0
            if f in ("waiting_customer", "waiting_team", "resolved"):
                assert it["status"] == f

    def test_search_and_source_template(self, admin):
        r = admin.get(f"{API}/conversations", params={"q": "0000000000"})
        assert r.status_code == 200 and any(i["wa_number"] == TEST_NUM for i in r.json()["items"])
        r = admin.get(f"{API}/conversations", params={"source": "welcome", "limit": 3})
        assert r.status_code == 200 and all("welcome" in i["sources"] for i in r.json()["items"])
        r = admin.get(f"{API}/conversations", params={"page": 2, "limit": 2})
        assert r.status_code == 200 and len(r.json()["items"]) <= 2

    def test_welcome_rendered(self, admin):
        m = mdb.wa_messages.find_one({"source": "welcome", "lead_id": {"$ne": None}}, {"_id": 0})
        if not m:
            pytest.skip("no welcome messages")
        r = admin.get(f"{API}/conversations/{m['conv_id']}")
        assert r.status_code == 200
        d = r.json()
        assert {"messages", "customer", "window_open", "role"} <= set(d)
        assert d["role"] == "admin"
        w = [x for x in d["messages"] if x["source"] == "welcome"][0]
        assert w["text"] and "{{" not in w["text"]
        tok = (w.get("template") or {}).get("button_params", {}).get("0")
        urls = [b.get("url") for b in w.get("buttons") or [] if b.get("url")]
        print("welcome text:", w["text"][:120], "urls:", urls)
        if tok:
            assert any(tok in u for u in urls)

    def test_detail_window_open_test_conv(self, admin):
        c = _test_conv()
        d = admin.get(f"{API}/conversations/{c['id']}").json()
        assert d["window_open"] is True


# ---- sending, notes, status, assign
class TestActions:
    def test_send_text_idempotent(self, admin):
        c = _test_conv()
        cid = f"TEST_{uuid.uuid4().hex}"
        r = admin.post(f"{API}/conversations/{c['id']}/messages", json={"text": "TEST_ reply from team", "client_id": cid}, timeout=60)
        assert r.status_code == 200, r.text
        m = r.json()
        print("send status:", m.get("status"), m.get("error"))
        assert m["status"] in ("accepted", "failed") and m["direction"] == "out" and m["source"] == "staff"
        r2 = admin.post(f"{API}/conversations/{c['id']}/messages", json={"text": "TEST_ reply from team", "client_id": cid}, timeout=60)
        assert r2.status_code == 200 and r2.json()["id"] == m["id"]
        assert mdb.wa_messages.count_documents({"client_id": cid}) == 1
        assert _test_conv()["status"] == "waiting_customer"

    def test_window_expired_422(self, admin):
        cutoff = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(time.time() - 86400 * 2))
        c = mdb.wa_conversations.find_one({"$or": [{"last_inbound_at": None}, {"last_inbound_at": {"$lt": cutoff}}]}, {"_id": 0})
        r = admin.post(f"{API}/conversations/{c['id']}/messages", json={"text": "TEST_ x", "client_id": f"TEST_{uuid.uuid4().hex}"})
        assert r.status_code == 422 and "Customer service window expired" in r.json()["detail"]

    def test_note(self, admin):
        c = _test_conv()
        r = admin.post(f"{API}/conversations/{c['id']}/notes", json={"text": "TEST_ internal note"})
        assert r.status_code == 200
        n = r.json()
        assert n["direction"] == "note" and n["status"] == "internal" and "wamid" not in n
        msgs = admin.get(f"{API}/conversations/{c['id']}").json()["messages"]
        assert any(x["id"] == n["id"] for x in msgs)

    def test_status_and_read(self, ops):
        c = _test_conv()
        for st in ("waiting_customer", "resolved", "waiting_team"):
            r = ops.post(f"{API}/conversations/{c['id']}/status", json={"status": st})
            assert r.status_code == 200 and r.json()["status"] == st
        assert ops.post(f"{API}/conversations/{c['id']}/status", json={"status": "bogus"}).status_code == 422
        assert ops.post(f"{API}/conversations/{c['id']}/read").status_code == 200
        assert _test_conv()["unread_count"] == 0

    def test_assign(self, admin, proc):
        c = _test_conv()
        teja = mdb.meta_users.find_one({"email": "teja@bankezee.com"}) or {}
        pid = teja.get("user_id")
        r = admin.post(f"{API}/conversations/{c['id']}/assign", json={"processor_id": "nope_" + uuid.uuid4().hex})
        assert r.status_code == 404
        # processor cannot assign (conv not visible -> 404, or 403 if visible)
        r = proc.post(f"{API}/conversations/{c['id']}/assign", json={"processor_id": None})
        assert r.status_code in (403, 404)
        if pid and teja.get("role") == "processor":
            r = admin.post(f"{API}/conversations/{c['id']}/assign", json={"processor_id": pid})
            assert r.status_code == 200 and r.json()["assigned_processor_id"] == pid
            # now visible to processor, still cannot assign
            assert proc.get(f"{API}/conversations/{c['id']}").status_code == 200
            assert proc.post(f"{API}/conversations/{c['id']}/assign", json={"processor_id": None}).status_code == 403
            r = admin.post(f"{API}/conversations/{c['id']}/assign", json={"processor_id": None})
            assert r.status_code == 200 and r.json()["assigned_processor_id"] is None
        else:
            print("teja meta_user:", teja.get("role"), pid)


# ---- misc endpoints
class TestMisc:
    def test_quick_replies(self, ops, proc):
        r = ops.post(f"{API}/quick-replies", json={"title": "TEST_qr", "text": "TEST_ hello"})
        assert r.status_code == 200
        qid = r.json()["id"]
        assert any(q["id"] == qid for q in ops.get(f"{API}/quick-replies").json())
        assert proc.post(f"{API}/quick-replies", json={"title": "TEST_x", "text": "y"}).status_code == 403
        assert proc.delete(f"{API}/quick-replies/{qid}").status_code == 403
        assert ops.delete(f"{API}/quick-replies/{qid}").status_code == 200
        assert not any(q["id"] == qid for q in ops.get(f"{API}/quick-replies").json())

    def test_unread(self, admin):
        r = admin.get(f"{API}/unread-summary")
        assert r.status_code == 200 and isinstance(r.json()["conversations"], int)
        lids = [c["lead_id"] for c in mdb.wa_conversations.find({"lead_id": {"$ne": None}}, {"lead_id": 1}).limit(5)]
        r = admin.post(f"{API}/unread-by-leads", json={"lead_ids": lids})
        assert r.status_code == 200 and isinstance(r.json(), dict)

    def test_templates_sendable(self, admin):
        r = admin.get(f"{API}/templates")
        assert r.status_code == 200
        names = [t["name"] for t in r.json()]
        print("templates:", names)
        assert all(t.get("sendable") for t in r.json())
        assert "welcome_message3" not in names


# ---- permissions
class TestRBAC:
    def test_gp_403(self, gp):
        assert gp.get(f"{API}/conversations").status_code == 403
        assert gp.get(f"{API}/templates").status_code == 403
        assert gp.get(f"{API}/quick-replies").status_code == 403

    def test_unauth(self):
        assert requests.get(f"{API}/conversations").status_code in (401, 403)

    def test_processor_scope(self, proc):
        r = proc.get(f"{API}/conversations", params={"limit": 100})
        assert r.status_code == 200
        teja = mdb.meta_users.find_one({"email": "teja@bankezee.com"}) or {}
        uid = teja.get("user_id")
        mine = set(mdb.meta_leads.distinct("lead_id", {"assigned_processor_id": uid}))
        for it in r.json()["items"]:
            assert it.get("assigned_processor_id") == uid or it.get("lead_id") in mine
        print("processor sees", r.json()["total"], "role", teja.get("role"))
