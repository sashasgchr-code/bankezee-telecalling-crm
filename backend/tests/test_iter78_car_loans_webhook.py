"""Iter78: Car Loans — webhook-level duplicate prevention + bot flow + template routing.
In-process ASGI calls to POST /api/integrations/whatsapp/webhook with a valid HMAC signature.
ALL WhatsApp sends are mocked (wa_inbox._graph, wa_inbox.log_outbound, whatsapp.send_whatsapp_for_lead)."""
import asyncio, sys, time, uuid, json, hmac, hashlib
import pytest
LOOP = asyncio.new_event_loop(); asyncio.set_event_loop(LOOP)

sys.path.insert(0, '/app/backend')
from dotenv import load_dotenv; load_dotenv('/app/backend/.env')
import httpx
from fastapi import FastAPI
from routes import wa_bot, wa_inbox, whatsapp as wa, meta_sync
from utils.database import db

run = lambda c: (asyncio.set_event_loop(LOOP), LOOP.run_until_complete(c))[1]
SECRET = "TEST_SECRET_iter78"
SENT, TPL_SENDS = [], []
LEADS, NUMS = [], []


# ---- mocks (no real WhatsApp traffic) ----
async def fake_graph(payload):
    SENT.append(payload); return {"ok": True, "wamid": f"wamid.T{len(SENT)}"}

async def fake_log(*a, **k): return None

async def fake_send_for_lead(lead, **k):
    tpl = await wa.template_for(lead)
    TPL_SENDS.append({"lead_id": lead["lead_id"], "template": tpl["name"]})
    await db.meta_leads.update_one({"lead_id": lead["lead_id"]}, {"$set": {"whatsapp.wamid": f"wamid.TPL{len(TPL_SENDS)}"}})
    return {"ok": True, "template": tpl["name"]}

wa_inbox._graph = fake_graph
wa_inbox.log_outbound = fake_log
wa.send_whatsapp_for_lead = fake_send_for_lead
wa._send_configured = lambda: True
wa.APP_SECRET = SECRET
APP = FastAPI(); APP.include_router(wa.webhook_router)


def last():
    p = SENT[-1]
    return (p.get("text") or {}).get("body") or p["interactive"]["body"]["text"]


def new_num():
    n = "91" + "8" + uuid.uuid4().int.__str__()[-9:]
    NUMS.append(n); return n


async def mk_lead(num, campaign, name="TEST_Car Person", wamid=None, created="2026-11-20"):
    lid = f"lead_TEST78{uuid.uuid4().hex[:8]}"
    doc = {"lead_id": lid, "full_name": name, "phone": num, "phone_norm": num[-10:], "campaign_name": campaign, "created_time": created}
    if wamid:
        doc["whatsapp"] = {"wamid": wamid}
    await db.meta_leads.insert_one(doc); LEADS.append(lid)
    return lid


async def hook(num, text=None, reply=None, profile="TEST_Profile"):
    msg = {"from": num, "id": f"wamid.IN{uuid.uuid4().hex}", "timestamp": str(int(time.time()))}
    if reply:
        msg.update({"type": "interactive", "interactive": {"type": "button_reply", "button_reply": {"id": reply[0], "title": reply[1]}}})
    else:
        msg.update({"type": "text", "text": {"body": text}})
    body = json.dumps({"entry": [{"changes": [{"value": {"contacts": [{"profile": {"name": profile}}], "messages": [msg]}}]}]}).encode()
    sig = "sha256=" + hmac.new(SECRET.encode(), body, hashlib.sha256).hexdigest()
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=APP), base_url="http://t") as c:
        r = await c.post("/api/integrations/whatsapp/webhook", content=body, headers={"X-Hub-Signature-256": sig, "Content-Type": "application/json"})
    assert r.status_code == 200, r.text
    return msg


async def leads_for(num):
    return await db.meta_leads.count_documents({"phone_norm": num[-10:]})


async def convs_for(num):
    return await wa_inbox.CONV.find({"wa_number": num}, {"_id": 0}).to_list(10)


@pytest.fixture(scope="module", autouse=True)
def cleanup():
    yield
    async def _c():
        convs = await wa_inbox.CONV.find({"wa_number": {"$in": NUMS}}, {"id": 1}).to_list(100)
        cids = [c["id"] for c in convs]
        new_leads = await wa_inbox.CONV.distinct("lead_id", {"id": {"$in": cids}})
        await wa_inbox.MSG.delete_many({"conv_id": {"$in": cids}})
        await wa_inbox.CONV.delete_many({"id": {"$in": cids}})
        ids = list(set(LEADS + [l for l in new_leads if l]))
        await db.wa_bot_sessions.delete_many({"lead_id": {"$in": ids}})
        await db.meta_leads.delete_many({"lead_id": {"$in": ids}, "phone_norm": {"$in": [n[-10:] for n in NUMS]}})
        await db.wa_inbound_welcome.delete_many({"_id": {"$in": [n[-10:] for n in NUMS]}})
    run(_c())


# ---- webhook auth ----
def test_webhook_rejects_bad_signature():
    async def t():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=APP), base_url="http://t") as c:
            r = await c.post("/api/integrations/whatsapp/webhook", content=b"{}", headers={"X-Hub-Signature-256": "sha256=" + "0" * 64})
        assert r.status_code == 401
    run(t())


# ---- template routing ----
@pytest.mark.parametrize("campaign,car", [("Car Loan Leads campaign", True), ("Car Loans – November", True), ("used CAR loan", True),
                                          ("Scarlet Personal", False), ("Personal Loan – November", False), ("Scar campaign", False), ("", False)])
def test_template_for(campaign, car):
    name = run(wa.template_for({"campaign_name": campaign}))["name"]
    default = run(wa.active_template())["name"]
    assert (name == "car_loans_welcome") == car
    if not car:
        assert name == default


# ---- inbound duplicate prevention (webhook level) ----
def test_inbound_existing_car_lead_with_wamid_no_duplicate():
    async def t():
        num = new_num(); lid = await mk_lead(num, "Car Loan Leads campaign", wamid="wamid.OLD")
        n0 = await leads_for(num)
        await hook(num, "hello")
        await hook(num, "are you there?")
        convs = await convs_for(num)
        assert await leads_for(num) == n0 == 1
        assert len(convs) == 1 and convs[0]["lead_id"] == lid
        assert not [s for s in TPL_SENDS if s["lead_id"] == lid]  # no re-welcome
    run(t())


def test_inbound_car_lead_without_wamid_gets_car_template_once():
    async def t():
        num = new_num(); lid = await mk_lead(num, "Car Loans – Jan")
        await hook(num, "Hi I need a car loan")
        await hook(num, "hello again")
        sends = [s for s in TPL_SENDS if s["lead_id"] == lid]
        assert await leads_for(num) == 1
        assert len(sends) == 1 and sends[0]["template"] == "car_loans_welcome"
        convs = await convs_for(num)
        assert len(convs) == 1 and convs[0]["lead_id"] == lid
    run(t())


def test_inbound_car_lead_wins_over_newer_non_car_lead():
    async def t():
        num = new_num()
        car = await mk_lead(num, "Car Loan Leads campaign", wamid="wamid.OLD", created="2026-10-01")
        await mk_lead(num, "Personal Loan – Dec", wamid="wamid.OLD2", created="2026-12-01")
        await hook(num, "hello")
        convs = await convs_for(num)
        assert await leads_for(num) == 2 and len(convs) == 1
        assert convs[0]["lead_id"] == car, f"conv linked to {convs[0]['lead_id']} not car lead {car}"
    run(t())


def test_inbound_unknown_number_creates_single_lead():
    async def t():
        num = new_num()
        await hook(num, "hello")
        await hook(num, "hello 2")
        convs = await convs_for(num)
        assert await leads_for(num) == 1 and len(convs) == 1 and convs[0]["lead_id"]
        assert [s for s in TPL_SENDS if s["lead_id"] == convs[0]["lead_id"]][0]["template"] != "car_loans_welcome"
    run(t())


# ---- full car bot flow via webhook ----
def test_car_bot_self_employed_flow_via_webhook_and_resume():
    async def t():
        num = new_num(); lid = await mk_lead(num, "Car Loan Leads campaign", name="TEST_Ravi", wamid="wamid.OLD")
        await hook(num, reply=("yes_continue", "Yes Continue"))
        assert "Thank you for your loan enquiry with Bankezee" in last() and "TEST_Ravi" in last()
        assert SENT[-1]["interactive"]["action"]["buttons"][0]["reply"]["id"] == "car_yes"
        await hook(num, reply=("car_yes", "Yes Continue"))
        assert last().startswith("Are you:")
        await hook(num, reply=("emp_self", "Self-employed"))
        q = last()
        for opt in ["1. GST Registration", "2. Udyam Registration / Udyam Aadhaar", "3. Labour Licence", "4. Trade Licence", "5. 3 years ITRs", "6. None of the Above"]:
            assert opt in q
        await hook(num, "2,6"); assert "can't be combined" in last()
        await hook(num, "7"); assert "1 to 6" in last()
        await hook(num, "hello"); assert "1 to 6" in last()
        lead = await db.meta_leads.find_one({"lead_id": lid})
        assert lead["car_loan_profile"]["business_registrations"] is None
        await hook(num, "4 and 5")
        lead = await db.meta_leads.find_one({"lead_id": lid})
        assert lead["car_loan_profile"]["business_registrations"] == ["Trade Licence", "3 years ITRs"]
        assert lead["campaign_type"] == "Car Loans" and lead["car_loan_profile"]["employment_type"] == "Self-employed"
        assert "business/company name" in last()
        await hook(num, "TEST_Motors"); assert "turnover" in last().lower()
        # abandoned -> any message resumes at last unanswered question
        await db.wa_bot_sessions.update_one({"lead_id": lid}, {"$set": {"status": "abandoned"}})
        await hook(num, "hi"); assert "turnover" in last().lower()
        s = await db.wa_bot_sessions.find_one({"lead_id": lid})
        assert s["status"] == "active" and s["step"] == "se_turnover"
        await hook(num, "50 lakh"); assert "credit report" in last().lower()
        assert await leads_for(num) == 1 and len(await convs_for(num)) == 1
    run(t())


def test_car_none_of_above_stores_empty_array():
    async def t():
        num = new_num(); lid = await mk_lead(num, "Car Loans – Feb", wamid="wamid.OLD")
        await hook(num, "Yes Continue"); await hook(num, "Yes Continue"); await hook(num, "2")
        assert "6. None of the Above" in last()
        await hook(num, "6")
        lead = await db.meta_leads.find_one({"lead_id": lid})
        assert lead["car_loan_profile"]["business_registrations"] == []
        assert "business/company name" in last()
    run(t())


def test_car_salaried_and_other_branches():
    async def t():
        num = new_num(); await mk_lead(num, "Car Loans – Feb", wamid="wamid.OLD")
        await hook(num, "Yes Continue"); await hook(num, reply=("car_yes", "Yes Continue")); await hook(num, reply=("emp_sal", "Salaried"))
        assert "payslip" in last().lower()
        num2 = new_num(); await mk_lead(num2, "Car Loans – Feb", wamid="wamid.OLD")
        await hook(num2, "Yes Continue"); await hook(num2, "Yes Continue"); await hook(num2, "3")
        assert "employment or income category" in last()
    run(t())


def test_car_abandoned_at_intro_resumes_to_employment():
    async def t():
        num = new_num(); lid = await mk_lead(num, "Car Loans – Feb", wamid="wamid.OLD")
        await hook(num, "Yes Continue")
        await db.wa_bot_sessions.update_one({"lead_id": lid}, {"$set": {"status": "abandoned"}})
        await hook(num, "hello")
        assert last().startswith("Are you:")
    run(t())


def test_personal_flow_unchanged_minimal():
    async def t():
        num = new_num(); await mk_lead(num, "Personal Loan – Feb", wamid="wamid.OLD")
        await hook(num, "Yes Continue"); assert last().startswith("Are you:")
        await hook(num, "Self-employed"); assert "5. None of the Above" in last() and "ITRs" not in last()
    run(t())


def test_dynamic_form_answers_normalize():
    row = meta_sync._normalize_row({"id": "l:1", "full_name": "A", "phone_number": "+919999999999", "which_car_model_are_you_buying?": "Creta",
                                    "car_manufacturing_year": "2024", "a" * 300: "x" * 500, "campaign_name": "Car Loans", "ad_id": "1", "platform": "fb", "blank": ""}, "Car tab")
    labels = {a["label"]: a["value"] for a in row["form_answers"]}
    assert labels["Which car model are you buying?"] == "Creta" and labels["Car manufacturing year"] == "2024"
    assert "Campaign name" not in labels and "Ad id" not in labels and "Blank" not in labels
    assert any(len(v) == 500 for v in labels.values())  # no truncation


def test_car_abandoned_then_yes_continue_should_resume_not_restart():
    """Customer re-taps 'Yes Continue' (e.g. template quick reply) after abandoning mid-questionnaire."""
    async def t():
        num = new_num(); lid = await mk_lead(num, "Car Loans – Feb", wamid="wamid.OLD")
        await hook(num, "Yes Continue"); await hook(num, "Yes Continue"); await hook(num, "2"); await hook(num, "1,2")
        assert "business/company name" in last()
        await db.wa_bot_sessions.update_one({"lead_id": lid}, {"$set": {"status": "abandoned"}})
        await hook(num, "Yes Continue")
        s = await db.wa_bot_sessions.find_one({"lead_id": lid})
        assert (s.get("answers") or {}).get("business_registrations") == ["GST Registration", "Udyam Registration / Udyam Aadhaar"], f"answers wiped: {s.get('answers')} step={s.get('step')}"
        assert "business/company name" in last(), f"restarted instead of resume: {last()[:60]}"
    run(t())
