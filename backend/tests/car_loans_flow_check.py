"""Car Loans bot flow + template routing + Meta form answers (mocked WhatsApp sends)."""
import asyncio, sys, time, uuid
loop = asyncio.new_event_loop(); asyncio.set_event_loop(loop)
sys.path.insert(0, '/app/backend')
from dotenv import load_dotenv; load_dotenv('/app/backend/.env')
from routes import wa_bot, wa_inbox, whatsapp as wa, meta_sync
from utils.database import db

SENT = []
async def fake_graph(payload):
    SENT.append(payload); return {"ok": True, "wamid": f"wamid.T{len(SENT)}"}
async def fake_log(*a, **k): return None
wa_inbox._graph = fake_graph
wa_inbox.log_outbound = fake_log
last = lambda: (SENT[-1].get("text") or {}).get("body") or SENT[-1]["interactive"]["body"]["text"]


async def mk(campaign):
    num = "91" + "9" + str(int(time.time() * 1000))[-9:]
    lid = f"lead_TEST{uuid.uuid4().hex[:8]}"
    await db.meta_leads.insert_one({"lead_id": lid, "full_name": "TEST Car Person", "phone": num, "phone_norm": num[-10:], "campaign_name": campaign, "created_time": "2026-11-20"})
    conv = {"id": uuid.uuid4().hex, "lead_id": lid, "wa_number": num}
    await wa_inbox.CONV.insert_one(dict(conv))
    return lid, conv


async def say(conv, text, reply_id=None):
    raw = {"interactive": {"button_reply": {"id": reply_id}}} if reply_id else {}
    await wa_bot.handle_inbound(conv, {"text": text, "type": "interactive" if reply_id else "text"}, raw)


async def main():
    ok = lambda c, m: print(("PASS " if c else "FAIL ") + m)
    ok((await wa.template_for({"campaign_name": "Car Loans – November"}))["name"] == "car_loans_welcome", "car campaign -> car_loans_welcome")
    ok((await wa.template_for({"campaign_name": "Personal Loan – November"}))["name"] == (await wa.active_template())["name"], "personal campaign -> existing welcome")
    ok(not wa.is_car_lead({"campaign_name": "Scarlet Personal"}), "'Scarlet' is not a car campaign")
    lid, conv = await mk("Car Loans – November")
    await say(conv, "Yes Continue")
    ok("Thank you for your loan enquiry with Bankezee" in last() and "TEST Car Person" in last(), "car intro sent with name")
    await say(conv, "Yes Continue", "car_yes")
    ok(last().startswith("Are you:"), "employment asked after intro")
    await say(conv, "Self-employed", "emp_self")
    ok("3 years ITRs" in last() and "6. None of the Above" in last(), "car registrations question (6 options)")
    await say(conv, "1,6"); ok("can't be combined" in last(), "None of the Above exclusive")
    await say(conv, "abc"); ok("1 to 6" in last(), "invalid -> retry")
    await say(conv, "1, 2,5")
    lead = await db.meta_leads.find_one({"lead_id": lid})
    ok(lead["car_loan_profile"]["business_registrations"] == ["GST Registration", "Udyam Registration / Udyam Aadhaar", "3 years ITRs"], "registrations stored as array")
    ok(lead.get("campaign_type") == "Car Loans" and lead["car_loan_profile"]["employment_type"] == "Self-employed", "campaign type + employment stored")
    ok("business/company name" in last(), "continues to existing Business Name question")
    await say(conv, "TEST Motors"); ok("turnover" in last().lower(), "turnover question unchanged")
    await db[wa_bot.SESS.name].update_one({"lead_id": lid}, {"$set": {"status": "abandoned"}})
    await say(conv, "hi"); ok("turnover" in last().lower(), "abandoned car conversation resumes at last unanswered question")
    # salaried + personal flows untouched
    lid2, conv2 = await mk("Car Loans – Dec")
    await say(conv2, "Yes Continue"); await say(conv2, "Yes Continue", "car_yes"); await say(conv2, "Salaried", "emp_sal")
    ok("payslip" in last().lower(), "car salaried -> existing salaried flow")
    lid3, conv3 = await mk("Personal Loan – November")
    await say(conv3, "Yes Continue"); ok(last().startswith("Are you:"), "personal flow starts at employment (unchanged)")
    await say(conv3, "Self-employed", "emp_self"); ok("5. None of the Above" in last() and "ITRs" not in last(), "personal registrations question unchanged")
    # inbound dedupe: existing car lead -> no new lead
    n0 = await db.meta_leads.count_documents({"phone_norm": conv["wa_number"][-10:]})
    await db.meta_leads.update_one({"lead_id": lid}, {"$set": {"whatsapp.wamid": "wamid.X"}})
    newconv = {"id": uuid.uuid4().hex, "lead_id": None, "wa_number": conv["wa_number"], "phone_number_id": "TEST_PNID"}
    await wa_inbox.CONV.insert_one(dict(newconv))
    wa._send_configured = lambda: True
    r = await wa_inbox.welcome_on_inbound(newconv, "+" + conv["wa_number"], "Someone", "hello")
    ok(not r and newconv["lead_id"] == lid and await db.meta_leads.count_documents({"phone_norm": conv["wa_number"][-10:]}) == n0, "existing car lead reused, no duplicate")
    # dynamic meta form answers
    row = meta_sync._normalize_row({"id": "l:1", "full_name": "A", "phone_number": "+919999999999", "city": "Pune", "which_car_model_are_you_buying?": "Creta", "car_manufacturing_year": "2024",
                                    "number_of_existing_loans": "2", "campaign_name": "Car Loans", "platform": "fb"}, "Car tab")
    labels = {a["label"]: a["value"] for a in row["form_answers"]}
    ok(labels.get("Which car model are you buying?") == "Creta" and labels.get("Car manufacturing year") == "2024" and "Campaign name" not in labels and labels.get("City") == "Pune", "dynamic form answers captured with labels")
    for l in (lid, lid2, lid3):
        await db.meta_leads.delete_many({"lead_id": l}); await db[wa_bot.SESS.name].delete_many({"lead_id": l})
    await wa_inbox.CONV.delete_many({"wa_number": {"$in": [conv["wa_number"], conv2["wa_number"], conv3["wa_number"]]}})

loop.run_until_complete(main())
