"""Salaried payslip scenarios A-E + typed registration names (mocked WhatsApp sends)."""
import asyncio, sys, time, uuid
loop = asyncio.new_event_loop(); asyncio.set_event_loop(loop)
sys.path.insert(0, '/app/backend')
from dotenv import load_dotenv; load_dotenv('/app/backend/.env')
from routes import wa_bot, wa_inbox
from utils.database import db

SENT = []
async def fake_graph(payload):
    SENT.append(payload); return {"ok": True, "wamid": f"wamid.P{len(SENT)}"}
async def fake_log(*a, **k): return None
wa_inbox._graph = fake_graph
wa_inbox.log_outbound = fake_log
body = lambda p: (p.get("text") or {}).get("body") or p["interactive"]["body"]["text"]
last = lambda: body(SENT[-1])
PAYSLIP_Q = wa_bot.STEPS["payslip"][0]
ok = lambda c, msg: print(("PASS " if c else "FAIL ") + msg)


async def mk(campaign="Personal Loan – TEST"):
    num = "91" + "8" + str(int(time.time() * 1000))[-9:]
    lid = f"lead_TESTPS{uuid.uuid4().hex[:8]}"
    await db.meta_leads.insert_one({"lead_id": lid, "full_name": "TEST Payslip", "phone": num, "phone_norm": num[-10:], "campaign_name": campaign})
    conv = {"id": uuid.uuid4().hex, "lead_id": lid, "wa_number": num}
    await wa_bot._start(conv)
    return lid, conv


async def say(conv, text="", reply_id=None, media=False, mid=None):
    m = {"id": mid or uuid.uuid4().hex, "text": text, "type": "document" if media else ("interactive" if reply_id else "text"),
         "media": {"kind": "meta", "id": "x", "mime": "application/pdf", "filename": "payslip.pdf"} if media else None}
    raw = {"interactive": {"button_reply": {"id": reply_id}}} if reply_id else {}
    await wa_bot.handle_inbound(conv, m, raw)


sess = lambda lid: wa_bot.SESS.find_one({"lead_id": lid}, {"_id": 0})


async def to_payslip(conv):
    await say(conv, "Salaried", "emp_sal")


async def main():
    # A – upload payslip
    lid, conv = await mk(); await to_payslip(conv)
    s = await sess(lid); ok(s["answers"]["payslip_status"] == "not_asked" or s["step"] == "payslip", "payslip asked after salaried")
    await say(conv, "Upload Payslip", "ps_up")
    s = await sess(lid); ok(s["answers"]["payslip_status"] == "pending_upload" and s["step"] == "payslip_upload", "A: pending_upload, waiting for document")
    await say(conv, "hello")
    ok(last() == wa_bot.STEPS["payslip_upload"][0], "A: text while waiting -> asks for document again (not payslip question)")
    n = len(SENT); await say(conv, media=True, mid="M1")
    s = await sess(lid)
    ok(s["step"] == "cibil_report" and s["answers"]["payslip_status"] == "uploaded" and s["answers"]["payslip_uploaded"] and s["answers"]["payslip_question_completed"], "A: uploaded -> credit report step")
    ok(len(SENT) == n + 1 and last() == wa_bot.CIBIL_Q, "A: credit report question sent once")
    ok(not any(body(p) in (wa_bot.STEPS["company"][0], wa_bot.STEPS["salary"][0]) for p in SENT[n:]), "A: company/salary skipped")
    # D – duplicate media event + extra pages
    n = len(SENT); await say(conv, media=True, mid="M1"); await say(conv, media=True, mid="M2")
    s = await sess(lid)
    ok(len(SENT) == n, "D: duplicate/extra page sends no message")
    ok([d["msg_id"] for d in s["documents"]] == ["M1", "M2"], "D: no duplicate document, extra page attached")
    # E – another text after upload
    await say(conv, "ok thanks")
    ok(last() == wa_bot.CIBIL_Q and PAYSLIP_Q not in [body(p) for p in SENT[n:]], "E: resumes credit report question, payslip not repeated")
    await say(conv, "Yes continue"); s = await sess(lid)
    ok(s["step"] == "cibil_report" and s["answers"]["payslip_uploaded"], "E: 'Yes continue' does not reset payslip state")
    # A2 – document sent straight at payslip question
    lid2, conv2 = await mk(); await to_payslip(conv2); await say(conv2, media=True, mid="M3")
    s = await sess(lid2); ok(s["step"] == "cibil_report" and s["answers"]["payslip_status"] == "uploaded", "A2: file without tapping Upload accepted")
    # concurrency – two pages at the same time
    lid3, conv3 = await mk(); await to_payslip(conv3); await say(conv3, "Upload Payslip", "ps_up")
    n = len(SENT); await asyncio.gather(say(conv3, media=True, mid="M4"), say(conv3, media=True, mid="M5"))
    s = await sess(lid3); ok(len(SENT) == n + 1 and len(s["documents"]) == 2, "D: simultaneous pages -> one question, both saved")
    # B – share later
    lid4, conv4 = await mk(); await to_payslip(conv4); await say(conv4, "Share Later", "ps_later")
    s = await sess(lid4); ok(s["answers"]["payslip_status"] == "share_later" and last() == wa_bot.STEPS["company"][0], "B: share later -> company")
    await say(conv4, "Infosys"); ok(last() == wa_bot.STEPS["salary"][0], "B: then salary")
    await say(conv4, "45000"); ok(last() == wa_bot.CIBIL_Q, "B: then credit report")
    # C – don't have it
    lid5, conv5 = await mk(); await to_payslip(conv5); await say(conv5, "I Don't Have It", "ps_no")
    s = await sess(lid5); ok(s["answers"]["payslip_status"] == "not_available" and last() == wa_bot.STEPS["company"][0], "C: not_available -> existing fallback (company)")
    # typed registrations
    P = wa_bot._parse_regs
    ok(P("GST, Udyam", wa_bot.REGS_CAR) == [1, 2], "regs: typed names")
    ok(P("1,2,4", wa_bot.REGS_CAR) == [1, 2, 4] and P("124", wa_bot.REGS_CAR) == [1, 2, 4], "regs: numbers")
    ok(P("gst and 3 years itr", wa_bot.REGS_CAR) == [1, 5], "regs: mixed")
    ok(P("10", wa_bot.REGS_CAR) == [] and P("None of the above", wa_bot.REGS_CAR) == [6], "regs: '10' invalid, None")
    ok(P("trade licence, labour", wa_bot.REGS) == [3, 4] and P("itr", wa_bot.REGS) == [], "regs: personal list")
    lid6, conv6 = await mk("Car Loans – TEST"); await say(conv6, "Yes Continue", "car_yes"); await say(conv6, "Self-employed", "emp_self")
    await say(conv6, "GST, Udyam"); s = await sess(lid6)
    ok(s["answers"]["business_registrations"] == ["GST Registration", "Udyam Registration / Udyam Aadhaar"] and s["step"] == "se_name", "regs: car bot accepts typed names")
    ids = [lid, lid2, lid3, lid4, lid5, lid6]
    await db.meta_leads.delete_many({"lead_id": {"$in": ids}}); await wa_bot.SESS.delete_many({"lead_id": {"$in": ids}})

loop.run_until_complete(main())
