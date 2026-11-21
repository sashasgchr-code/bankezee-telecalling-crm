"""Iter79: Salaried payslip flow (scenarios A-E) + typed registrations, at webhook level.
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
SECRET = "TEST_SECRET_iter79"
SENT, TPL_SENDS, LEADS, NUMS = [], [], [], []


# ---- mocks (no real WhatsApp traffic) ----
async def fake_graph(payload):
    SENT.append(payload); return {"ok": True, "wamid": f"wamid.T{len(SENT)}"}

async def fake_log(*a, **k): return None

async def fake_send_for_lead(lead, **k):
    TPL_SENDS.append(lead["lead_id"]); return {"ok": True}

async def fake_cache(*a, **k): return None

wa_inbox._graph = fake_graph
wa_inbox.log_outbound = fake_log
wa_inbox._cache_media = fake_cache
wa.send_whatsapp_for_lead = fake_send_for_lead
wa._send_configured = lambda: True
wa.APP_SECRET = SECRET
APP = FastAPI(); APP.include_router(wa.webhook_router)

body_of = lambda p: (p.get("text") or {}).get("body") or p["interactive"]["body"]["text"]
last = lambda: body_of(SENT[-1])
PAYSLIP_Q = wa_bot.STEPS["payslip"][0]
COMPANY_Q, SALARY_Q = wa_bot.STEPS["company"][0], wa_bot.STEPS["salary"][0]
SES = lambda lid: db.wa_bot_sessions.find_one({"lead_id": lid}, {"_id": 0})


def new_num():
    n = "91" + "7" + str(uuid.uuid4().int)[-9:]
    NUMS.append(n); return n


async def mk_lead(num, campaign="Personal Loan – TEST79"):
    lid = f"lead_TEST79{uuid.uuid4().hex[:8]}"
    await db.meta_leads.insert_one({"lead_id": lid, "full_name": "TEST_Payslip", "phone": num, "phone_norm": num[-10:],
                                    "campaign_name": campaign, "created_time": "2026-01-10", "whatsapp": {"wamid": "wamid.OLD"}})
    LEADS.append(lid); return lid


async def hook(num, text=None, reply=None, doc=None, wamid=None, image=False):
    msg = {"from": num, "id": wamid or f"wamid.IN{uuid.uuid4().hex}", "timestamp": str(int(time.time()))}
    if reply:
        msg.update({"type": "interactive", "interactive": {"type": "button_reply", "button_reply": {"id": reply[0], "title": reply[1]}}})
    elif doc:
        if image:
            msg.update({"type": "image", "image": {"id": f"media{uuid.uuid4().hex[:6]}", "mime_type": "image/jpeg"}})
        else:
            msg.update({"type": "document", "document": {"id": f"media{uuid.uuid4().hex[:6]}", "mime_type": "application/pdf", "filename": doc}})
    else:
        msg.update({"type": "text", "text": {"body": text}})
    body = json.dumps({"entry": [{"changes": [{"value": {"contacts": [{"profile": {"name": "TEST_P"}}], "messages": [msg]}}]}]}).encode()
    sig = "sha256=" + hmac.new(SECRET.encode(), body, hashlib.sha256).hexdigest()
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=APP), base_url="http://t") as c:
        r = await c.post("/api/integrations/whatsapp/webhook", content=body, headers={"X-Hub-Signature-256": sig, "Content-Type": "application/json"})
    assert r.status_code == 200, r.text
    return msg


async def to_payslip(campaign="Personal Loan – TEST79"):
    num = new_num(); lid = await mk_lead(num, campaign)
    await hook(num, reply=("yes_continue", "Yes Continue"))
    if "car" in campaign.lower():
        await hook(num, reply=("car_yes", "Yes Continue"))
    assert last().startswith("Are you:")
    await hook(num, reply=("emp_sal", "Salaried"))
    assert last() == PAYSLIP_Q
    btns = [b["reply"]["title"] for b in SENT[-1]["interactive"]["action"]["buttons"]]
    assert btns == ["Upload Payslip", "I Don't Have It", "Share Later"]
    return num, lid


@pytest.fixture(scope="module", autouse=True)
def cleanup():
    yield
    async def _c():
        convs = await wa_inbox.CONV.find({"wa_number": {"$in": NUMS}}, {"id": 1}).to_list(200)
        cids = [c["id"] for c in convs]
        await wa_inbox.MSG.delete_many({"conv_id": {"$in": cids}})
        await wa_inbox.CONV.delete_many({"id": {"$in": cids}})
        await db.wa_bot_sessions.delete_many({"lead_id": {"$in": LEADS}})
        await db.meta_leads.delete_many({"lead_id": {"$in": LEADS}, "phone_norm": {"$in": [n[-10:] for n in NUMS]}})
        await db.wa_inbound_welcome.delete_many({"_id": {"$in": [n[-10:] for n in NUMS]}})
    run(_c())


# ---- Scenario A: Upload Payslip -> document -> credit report ----
def test_A_upload_then_document_goes_to_credit_report():
    async def t():
        num, lid = await to_payslip()
        await hook(num, reply=("ps_up", "Upload Payslip"))
        s = await SES(lid)
        assert s["step"] == "payslip_upload" and s["answers"]["payslip_status"] == "pending_upload"
        assert last() == wa_bot.STEPS["payslip_upload"][0]
        n = len(SENT)
        await hook(num, doc="payslip_jan.pdf")
        s = await SES(lid)
        assert s["step"] == "cibil_report"
        a = s["answers"]
        assert a["payslip_status"] == "uploaded" and a["payslip_uploaded"] is True and a["payslip_question_completed"] is True
        new = [body_of(p) for p in SENT[n:]]
        assert new == [wa_bot.CIBIL_Q], new
        assert COMPANY_Q not in new and SALARY_Q not in new
        assert [d["filename"] for d in s["documents"] if d["kind"] == "payslip"] == ["payslip_jan.pdf"]
        # continue: credit report flow proceeds normally
        await hook(num, reply=("cr_no", "Don't Want To")); assert "CIBIL score" in last()
    run(t())


# ---- Scenario B: Share Later -> company -> salary -> credit report ----
def test_B_share_later():
    async def t():
        num, lid = await to_payslip()
        await hook(num, reply=("ps_later", "Share Later"))
        s = await SES(lid)
        assert s["answers"]["payslip_status"] == "share_later" and s["step"] == "company" and last() == COMPANY_Q
        await hook(num, "TEST_Infosys"); assert last() == SALARY_Q
        await hook(num, "45,000"); assert last() == wa_bot.CIBIL_Q
        s = await SES(lid)
        assert s["answers"]["company_name"] == "TEST_Infosys" and s["answers"]["net_monthly_salary"] == 45000
        assert s["answers"]["payslip_uploaded"] is False and s["step"] == "cibil_report"
    run(t())


# ---- Scenario C: I Don't Have It -> not_available -> company ----
def test_C_dont_have_it():
    async def t():
        num, lid = await to_payslip()
        await hook(num, reply=("ps_no", "I Don't Have It"))
        s = await SES(lid)
        assert s["answers"]["payslip_status"] == "not_available" and s["step"] == "company" and last() == COMPANY_Q
        assert s["answers"]["payslip_question_completed"] is True
    run(t())


def test_C_typed_dont_have_it_curly_quote():
    async def t():
        num, lid = await to_payslip()
        await hook(num, "I don’t have it")
        s = await SES(lid)
        assert s["answers"]["payslip_status"] == "not_available" and s["step"] == "company"
    run(t())


# ---- Scenario D: duplicate webhook + extra page ----
def test_D_duplicate_wamid_and_second_page():
    async def t():
        num, lid = await to_payslip()
        await hook(num, reply=("ps_up", "Upload Payslip"))
        await hook(num, doc="p1.pdf", wamid="wamid.TEST79DUP" + lid)
        n = len(SENT)
        await hook(num, doc="p1.pdf", wamid="wamid.TEST79DUP" + lid)   # exact retry from Meta
        await hook(num, doc="p2.pdf")                                   # extra page
        await hook(num, doc="p3.jpg", image=True)                       # extra image page
        assert len(SENT) == n, [body_of(p) for p in SENT[n:]]
        s = await SES(lid)
        docs = [d for d in s["documents"] if d["kind"] == "payslip"]
        assert len(docs) == 3 and len({d["msg_id"] for d in docs}) == 3
        assert [d["filename"] for d in docs][:2] == ["p1.pdf", "p2.pdf"]
        assert s["step"] == "cibil_report" and s["answers"]["payslip_status"] == "uploaded"
        conv = await wa_inbox.CONV.find_one({"wa_number": num})
        assert await wa_inbox.MSG.count_documents({"conv_id": conv["id"], "wamid": "wamid.TEST79DUP" + lid}) == 1
    run(t())


def test_D_concurrent_pages_only_one_question():
    async def t():
        num, lid = await to_payslip()
        await hook(num, reply=("ps_up", "Upload Payslip"))
        n = len(SENT)
        await asyncio.gather(hook(num, doc="c1.pdf"), hook(num, doc="c2.pdf"), hook(num, doc="c3.pdf"))
        new = [body_of(p) for p in SENT[n:]]
        assert new == [wa_bot.CIBIL_Q], new
        s = await SES(lid)
        assert len([d for d in s["documents"] if d["kind"] == "payslip"]) == 3
    run(t())


# ---- Scenario E: message after upload resumes current question ----
def test_E_text_after_upload_and_yes_continue():
    async def t():
        num, lid = await to_payslip()
        await hook(num, reply=("ps_up", "Upload Payslip")); await hook(num, doc="x.pdf")
        n = len(SENT)
        await hook(num, "hi, did you get it?")
        assert last() == wa_bot.CIBIL_Q
        await hook(num, reply=("yes_continue", "Yes Continue"))
        assert last() == wa_bot.CIBIL_Q
        await hook(num, "Upload Payslip")  # stale button text
        assert PAYSLIP_Q not in [body_of(p) for p in SENT[n:]]
        s = await SES(lid)
        assert s["step"] == "cibil_report" and s["answers"]["payslip_status"] == "uploaded" and s["answers"]["payslip_uploaded"] is True
    run(t())


def test_E_stale_payslip_button_after_upload_does_not_reset():
    async def t():
        num, lid = await to_payslip()
        await hook(num, reply=("ps_up", "Upload Payslip")); await hook(num, doc="x.pdf")
        await hook(num, reply=("ps_later", "Share Later"))  # customer taps old button
        s = await SES(lid)
        assert s["answers"]["payslip_status"] == "uploaded" and s["step"] == "cibil_report"
        assert last() != PAYSLIP_Q
    run(t())


# ---- document directly at payslip question ----
def test_document_at_payslip_question_without_button():
    async def t():
        num, lid = await to_payslip()
        n = len(SENT)
        await hook(num, doc="direct.pdf")
        s = await SES(lid)
        assert s["step"] == "cibil_report" and s["answers"]["payslip_status"] == "uploaded"
        assert [body_of(p) for p in SENT[n:]] == [wa_bot.CIBIL_Q]
    run(t())


def test_car_flow_upload_payslip():
    async def t():
        num, lid = await to_payslip("Car Loans – TEST79")
        await hook(num, reply=("ps_up", "Upload Payslip")); await hook(num, doc="car.pdf")
        s = await SES(lid)
        assert s["step"] == "cibil_report" and s["answers"]["payslip_status"] == "uploaded"
        lead = await db.meta_leads.find_one({"lead_id": lid})
        assert lead["car_loan_profile"]["chatbot_step"] == "cibil_report"
    run(t())


def test_credit_report_upload_after_payslip_completes():
    async def t():
        num, lid = await to_payslip()
        await hook(num, reply=("ps_up", "Upload Payslip")); await hook(num, doc="pay.pdf")
        await hook(num, reply=("cr_yes", "Yes, I'll Share"))
        assert "credit report" in last().lower()
        await hook(num, doc="cibil.pdf")
        s = await SES(lid)
        kinds = [d["kind"] for d in s["documents"]]
        assert kinds == ["payslip", "credit_report"], kinds
        assert s["status"] == "completed" and s["answers"]["credit_report_status"] == "uploaded"
    run(t())


# ---- typed registrations ----
@pytest.mark.parametrize("campaign,text,expected", [
    ("Personal Loan – TEST79", "GST, Udyam", ["GST Registration", "Udyam Registration / Udyam Aadhaar"]),
    ("Personal Loan – TEST79", "1,3", ["GST Registration", "Labour Licence"]),
    ("Personal Loan – TEST79", "none", []),
    ("Car Loans – TEST79", "GST, Udyam", ["GST Registration", "Udyam Registration / Udyam Aadhaar"]),
    ("Car Loans – TEST79", "trade licence and 3 years ITRs", ["Trade Licence", "3 years ITRs"]),
    ("Car Loans – TEST79", "2 4", ["Udyam Registration / Udyam Aadhaar", "Trade Licence"]),
])
def test_typed_registrations_accepted(campaign, text, expected):
    async def t():
        num = new_num(); lid = await mk_lead(num, campaign)
        await hook(num, "Yes Continue")
        if "car" in campaign.lower():
            await hook(num, "Yes Continue")
        await hook(num, reply=("emp_self", "Self-employed"))
        await hook(num, text)
        s = await SES(lid)
        assert s["step"] == "se_name", (s["step"], last()[:80])
        assert s["answers"]["business_registrations"] == expected
    run(t())


@pytest.mark.parametrize("campaign,text", [("Personal Loan – TEST79", "10"), ("Car Loans – TEST79", "10"),
                                            ("Personal Loan – TEST79", "6"), ("Car Loans – TEST79", "GST, none"), ("Personal Loan – TEST79", "hello")])
def test_registrations_rejected(campaign, text):
    async def t():
        num = new_num(); lid = await mk_lead(num, campaign)
        await hook(num, "Yes Continue")
        if "car" in campaign.lower():
            await hook(num, "Yes Continue")
        await hook(num, reply=("emp_self", "Self-employed"))
        await hook(num, text)
        s = await SES(lid)
        assert s["step"] in ("se_regs", "se_regs_car") and s["answers"].get("business_registrations") is None
        assert "Which of these business registrations" in last()
    run(t())
