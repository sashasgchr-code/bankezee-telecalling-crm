"""Iter80: Credit report step (upload / download help / reminder / continue without), at webhook level.
In-process ASGI POST /api/integrations/whatsapp/webhook with valid HMAC. ALL WhatsApp sends/media downloads mocked."""
import asyncio, sys, time, uuid, json, hmac, hashlib
import pytest
LOOP = asyncio.new_event_loop(); asyncio.set_event_loop(LOOP)

sys.path.insert(0, '/app/backend')
from dotenv import load_dotenv; load_dotenv('/app/backend/.env')
import httpx
from fastapi import FastAPI
from routes import wa_bot, wa_inbox, whatsapp as wa
from utils.database import db

run = lambda c: (asyncio.set_event_loop(LOOP), LOOP.run_until_complete(c))[1]
SECRET = "TEST_SECRET_iter80"
SENT, LEADS, NUMS = [], [], []


# ---- mocks (no real WhatsApp traffic) ----
async def fake_graph(payload):
    SENT.append(payload); return {"ok": True, "wamid": f"wamid.T80{len(SENT)}"}

async def fake_log(*a, **k): return None
async def fake_send_for_lead(lead, **k): return {"ok": True}
async def fake_cache(*a, **k): return None

wa_inbox._graph = fake_graph
wa_inbox.log_outbound = fake_log
wa_inbox._cache_media = fake_cache
wa.send_whatsapp_for_lead = fake_send_for_lead
wa._send_configured = lambda: True
wa.APP_SECRET = SECRET
APP = FastAPI(); APP.include_router(wa.webhook_router)

body_of = lambda p: (p.get("text") or {}).get("body") or p["interactive"]["body"]["text"]
btns_of = lambda p: [b["reply"]["title"] for b in (p.get("interactive") or {}).get("action", {}).get("buttons", [])]
last = lambda: body_of(SENT[-1])
UPLOAD = wa_bot.STEPS["report_upload"][0]
NUDGE = wa_bot.STEPS["report_nudge"][0]
SCORE_Q = wa_bot.STEPS["cibil_score"][0]
SES = lambda lid: db.wa_bot_sessions.find_one({"lead_id": lid}, {"_id": 0})


def is_help(p):
    return body_of(p) == wa_bot.HELP_TEXT and btns_of(p) == ["Upload Report", "Continue Without"]


def new_num():
    n = "91" + "6" + str(uuid.uuid4().int)[-9:]
    NUMS.append(n); return n


async def mk_lead(num, campaign):
    lid = f"lead_TEST80{uuid.uuid4().hex[:8]}"
    await db.meta_leads.insert_one({"lead_id": lid, "full_name": "TEST_Report", "phone": num, "phone_norm": num[-10:],
                                    "campaign_name": campaign, "created_time": "2026-01-10", "whatsapp": {"wamid": "wamid.OLD"}})
    LEADS.append(lid); return lid


async def hook(num, text=None, reply=None, doc=None, wamid=None):
    msg = {"from": num, "id": wamid or f"wamid.IN80{uuid.uuid4().hex}", "timestamp": str(int(time.time()))}
    if reply:
        msg.update({"type": "interactive", "interactive": {"type": "button_reply", "button_reply": {"id": reply[0], "title": reply[1]}}})
    elif doc:
        msg.update({"type": "document", "document": {"id": f"media{uuid.uuid4().hex[:6]}", "mime_type": "application/pdf", "filename": doc}})
    else:
        msg.update({"type": "text", "text": {"body": text}})
    body = json.dumps({"entry": [{"changes": [{"value": {"contacts": [{"profile": {"name": "TEST_R"}}], "messages": [msg]}}]}]}).encode()
    sig = "sha256=" + hmac.new(SECRET.encode(), body, hashlib.sha256).hexdigest()
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=APP), base_url="http://t") as c:
        r = await c.post("/api/integrations/whatsapp/webhook", content=body, headers={"X-Hub-Signature-256": sig, "Content-Type": "application/json"})
    assert r.status_code == 200, r.text
    return msg


async def to_report_q(campaign="Loan Consolidation – TEST80"):
    """Salaried -> Share Later -> company -> salary -> credit report question (no payslip doc on file)."""
    num = new_num(); lid = await mk_lead(num, campaign)
    await hook(num, reply=("yes_continue", "Yes Continue"))
    if "car" in campaign.lower():
        await hook(num, reply=("car_yes", "Yes Continue"))
    await hook(num, reply=("emp_sal", "Salaried"))
    await hook(num, reply=("ps_later", "Share Later"))
    await hook(num, "TEST_Acme")
    await hook(num, "50000")
    assert last() == wa_bot.CIBIL_Q
    assert btns_of(SENT[-1]) == ["Yes, I'll Share", "Help Me Download", "Don't Want To"]
    s = await SES(lid); assert s["answers"]["credit_report_status"] == "not_asked" and s["step"] == "cibil_report"
    return num, lid


async def to_waiting(campaign="Loan Consolidation – TEST80"):
    num, lid = await to_report_q(campaign)
    await hook(num, reply=("cr_yes", "Yes, I'll Share"))
    return num, lid


@pytest.fixture(scope="module", autouse=True)
def cleanup():
    yield
    async def _c():
        convs = await wa_inbox.CONV.find({"wa_number": {"$in": NUMS}}, {"id": 1}).to_list(500)
        cids = [c["id"] for c in convs]
        await wa_inbox.MSG.delete_many({"conv_id": {"$in": cids}})
        await wa_inbox.CONV.delete_many({"id": {"$in": cids}})
        await db.wa_bot_sessions.delete_many({"lead_id": {"$in": LEADS}})
        await db.meta_leads.delete_many({"lead_id": {"$in": LEADS}, "phone_norm": {"$in": [n[-10:] for n in NUMS]}})
        await db.wa_inbound_welcome.delete_many({"_id": {"$in": [n[-10:] for n in NUMS]}})
    run(_c())


# ---- S1/S2: Yes, I'll Share -> upload prompt, awaiting_upload ----
def test_S1_yes_share_upload_prompt():
    async def t():
        num, lid = await to_waiting()
        s = await SES(lid)
        assert last() == UPLOAD and btns_of(SENT[-1]) == []
        assert s["step"] == "report_upload" and s["answers"]["credit_report_status"] == "awaiting_upload"
    run(t())


# ---- S3: help-like messages while waiting -> HELP_TEXT + 2 buttons, help_requested ----
@pytest.mark.parametrize("q", ["Where can we find?", "How do I download it?", "How to get CIBIL report?", "What is a credit report?",
                               "Help", "Continue", "Yes, Continue", "Yes Continue"])
def test_S3_help_like_while_waiting(q):
    async def t():
        num, lid = await to_waiting()
        await hook(num, q)
        s = await SES(lid)
        assert is_help(SENT[-1]), (q, last()[:80])
        assert s["answers"]["credit_report_status"] == "help_requested" and s["step"] == "report_choice"
    run(t())


def test_S3b_yes_continue_button_while_waiting():
    async def t():
        num, lid = await to_waiting()
        await hook(num, reply=("yes_continue", "Yes Continue"))
        assert is_help(SENT[-1]), last()[:80]
    run(t())


# ---- S4: Help Me Download -> same help ----
def test_S4_help_me_download():
    async def t():
        num, lid = await to_report_q()
        await hook(num, reply=("cr_help", "Help Me Download"))
        s = await SES(lid)
        assert is_help(SENT[-1]) and s["answers"]["credit_report_status"] == "help_requested"
    run(t())


# ---- S5: Upload Report -> upload prompt, waits ----
def test_S5_upload_report_button_then_waits():
    async def t():
        num, lid = await to_report_q()
        await hook(num, reply=("cr_help", "Help Me Download"))
        await hook(num, reply=("rc_up", "Upload Report"))
        s = await SES(lid)
        assert last() == UPLOAD and s["step"] == "report_upload" and s["answers"]["credit_report_status"] == "awaiting_upload"
    run(t())


# ---- S6: Continue Without -> not_provided, CIBIL score, never asked again; full completion ----
def test_S6_continue_without_never_asked_again():
    async def t():
        num, lid = await to_report_q()
        await hook(num, reply=("cr_help", "Help Me Download"))
        n = len(SENT)
        await hook(num, reply=("rc_no", "Continue Without"))
        s = await SES(lid)
        assert s["step"] == "cibil_score" and s["answers"]["credit_report_status"] == "not_provided" and last() == SCORE_Q
        await hook(num, "Yes continue"); assert last() == SCORE_Q
        for txt in ["750", "0", "0"]:
            await hook(num, txt)
        s = await SES(lid)
        assert s["status"] == "completed" and s["answers"]["credit_report_status"] == "not_provided"
        bodies = [body_of(p) for p in SENT[n:]]
        assert wa_bot.CIBIL_Q not in bodies and UPLOAD not in bodies and wa_bot.HELP_TEXT not in bodies
    run(t())


def test_S6b_continue_without_from_nudge():
    async def t():
        num, lid = await to_waiting()
        await hook(num, "ok"); await hook(num, reply=("rc_no", "Continue Without"))
        s = await SES(lid)
        assert s["step"] == "cibil_score" and s["answers"]["credit_report_status"] == "not_provided"
    run(t())


# ---- S7: upload -> uploaded, thank-you, FINISH ----
def test_S7_upload_completes_with_thanks():
    async def t():
        num, lid = await to_waiting()
        n = len(SENT)
        await hook(num, doc="cibil.pdf")
        s = await SES(lid)
        assert s["status"] == "completed" and s["answers"]["credit_report_status"] == "uploaded" and s["step"] is None
        assert len(SENT) == n + 1 and "Thank you, TEST_Report" in last()
        assert [d["filename"] for d in s["documents"] if d["kind"] == "credit_report"] == ["cibil.pdf"]
        lead = await db.meta_leads.find_one({"lead_id": lid})
        assert lead["whatsapp_qualification"]["status"] == "completed"
    run(t())


def test_S7b_upload_after_help_completes():
    async def t():
        num, lid = await to_report_q()
        await hook(num, reply=("cr_help", "Help Me Download")); await hook(num, reply=("rc_up", "Upload Report"))
        await hook(num, doc="r.pdf")
        s = await SES(lid)
        assert s["status"] == "completed" and s["answers"]["credit_report_status"] == "uploaded"
    run(t())


# ---- S8: unrelated text -> short reminder with buttons, never bare upload prompt ----
@pytest.mark.parametrize("txt", ["ok", "tomorrow"])
def test_S8_unrelated_text_nudge(txt):
    async def t():
        num, lid = await to_waiting()
        n = len(SENT)
        await hook(num, txt); await hook(num, txt)
        new = SENT[n:]
        assert len(new) == 2 and all(body_of(p) == NUDGE and btns_of(p) == ["Upload Report", "Continue Without"] for p in new)
        assert UPLOAD not in [body_of(p) for p in new]
        s = await SES(lid); assert s["step"] == "report_upload" and s["answers"]["credit_report_status"] == "awaiting_upload"
    run(t())


# ---- duplicate wamid of report upload ----
def test_duplicate_report_wamid_no_resend():
    async def t():
        num, lid = await to_waiting()
        w = "wamid.TEST80DUP" + lid
        await hook(num, doc="r1.pdf", wamid=w)
        n = len(SENT)
        await hook(num, doc="r1.pdf", wamid=w)
        assert len(SENT) == n
        s = await SES(lid)
        assert len([d for d in s["documents"] if d["kind"] == "credit_report"]) == 1
        conv = await wa_inbox.CONV.find_one({"wa_number": num})
        assert await wa_inbox.MSG.count_documents({"conv_id": conv["id"], "wamid": w}) == 1
    run(t())


# ---- extra page after completion attached silently ----
def test_extra_page_after_completion_silent():
    async def t():
        num, lid = await to_waiting()
        await hook(num, doc="p1.pdf")
        n = len(SENT)
        await hook(num, doc="p2.pdf"); await hook(num, doc="p3.pdf"); await hook(num, "hello")
        assert len(SENT) == n, [body_of(p)[:60] for p in SENT[n:]]
        s = await SES(lid)
        assert [d["filename"] for d in s["documents"] if d["kind"] == "credit_report"] == ["p1.pdf", "p2.pdf", "p3.pdf"]
        assert s["status"] == "completed" and s["answers"]["credit_report_status"] == "uploaded"
    run(t())


def test_concurrent_pages_one_thanks():
    async def t():
        num, lid = await to_waiting()
        n = len(SENT)
        await asyncio.gather(hook(num, doc="c1.pdf"), hook(num, doc="c2.pdf"))
        assert len(SENT) == n + 1
        s = await SES(lid)
        assert len([d for d in s["documents"] if d["kind"] == "credit_report"]) == 2
    run(t())


# ---- edge: file sent without tapping a button ----
def test_edge_file_at_credit_report_question_completes():
    async def t():
        num, lid = await to_report_q()
        n = len(SENT)
        await hook(num, doc="direct.pdf")
        s = await SES(lid)
        assert s["answers"]["credit_report_status"] == "uploaded" and s["status"] == "completed", (s["step"], s["answers"]["credit_report_status"])
        assert len(SENT) == n + 1 and "Thank you" in last()
    run(t())


def test_edge_file_at_help_screen_completes():
    async def t():
        num, lid = await to_report_q()
        await hook(num, reply=("cr_help", "Help Me Download"))
        n = len(SENT)
        await hook(num, doc="direct.pdf")
        s = await SES(lid)
        assert s["answers"]["credit_report_status"] == "uploaded" and s["status"] == "completed", (s["step"], s["answers"]["credit_report_status"])
        assert len(SENT) == n + 1 and "Thank you" in last()
    run(t())


def test_car_flow_report_upload():
    async def t():
        num, lid = await to_waiting("Car Loans – TEST80")
        await hook(num, "tomorrow"); assert last() == NUDGE
        await hook(num, doc="car_cibil.pdf")
        s = await SES(lid)
        assert s["status"] == "completed" and s["answers"]["credit_report_status"] == "uploaded"
    run(t())
