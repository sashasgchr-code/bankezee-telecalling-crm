"""Credit report upload assistance scenarios (mocked WhatsApp sends)."""
import asyncio, sys, time, uuid
loop = asyncio.new_event_loop(); asyncio.set_event_loop(loop)
sys.path.insert(0, '/app/backend')
from dotenv import load_dotenv; load_dotenv('/app/backend/.env')
from routes import wa_bot, wa_inbox
from utils.database import db

SENT = []
async def fake_graph(payload):
    SENT.append(payload); return {"ok": True, "wamid": f"wamid.R{len(SENT)}"}
async def fake_log(*a, **k): return None
wa_inbox._graph = fake_graph
wa_inbox.log_outbound = fake_log
body = lambda p: (p.get("text") or {}).get("body") or p["interactive"]["body"]["text"]
btns = lambda p: [b["reply"]["title"] for b in (p.get("interactive") or {}).get("action", {}).get("buttons", [])]
last = lambda: body(SENT[-1])
UPLOAD = wa_bot.STEPS["report_upload"][0]
ok = lambda c, msg: print(("PASS " if c else "FAIL ") + msg)
IDS = []


async def mk():
    num = "91" + "7" + str(int(time.time() * 1000))[-9:]
    lid = f"lead_TESTCR{uuid.uuid4().hex[:8]}"; IDS.append(lid)
    await db.meta_leads.insert_one({"lead_id": lid, "full_name": "TEST Report", "phone": num, "phone_norm": num[-10:], "campaign_name": "Loan Consolidation – TEST"})
    conv = {"id": uuid.uuid4().hex, "lead_id": lid, "wa_number": num}
    await wa_inbox.CONV.insert_one(dict(conv))
    await wa_bot._start(conv)
    await say(conv, "Salaried", "emp_sal"); await say(conv, "Upload", "ps_up"); await say(conv, media=True)
    return lid, conv


async def say(conv, text="", reply_id=None, media=False, mid=None):
    m = {"id": mid or uuid.uuid4().hex, "text": text, "type": "document" if media else ("interactive" if reply_id else "text"),
         "media": {"kind": "meta", "id": "x", "mime": "application/pdf", "filename": "report.pdf"} if media else None}
    raw = {"interactive": {"button_reply": {"id": reply_id}}} if reply_id else {}
    await wa_bot.handle_inbound(conv, m, raw)


sess = lambda lid: wa_bot.SESS.find_one({"lead_id": lid}, {"_id": 0})
is_help = lambda: last() == wa_bot.HELP_TEXT and btns(SENT[-1]) == ["Upload Report", "Continue Without"]


async def main():
    lid, conv = await mk()
    ok(last() == wa_bot.CIBIL_Q and (await sess(lid))["answers"]["credit_report_status"] == "not_asked", "credit report question asked, status not_asked")
    await say(conv, "Yes, I'll Share", "cr_yes")
    ok(last() == UPLOAD and (await sess(lid))["answers"]["credit_report_status"] == "awaiting_upload", "Yes I'll Share -> upload prompt, awaiting_upload")
    for q in ["Where can we find?", "How do I download it?", "How to get CIBIL report?", "I don't know how to download.", "What is a credit report?", "Help", "Continue"]:
        await say(conv, "Upload Report", "rc_up")
        await say(conv, q); s = await sess(lid)
        ok(is_help() and s["answers"]["credit_report_status"] == "help_requested", f"'{q}' -> download help + 2 buttons")
    await say(conv, "Upload Report", "rc_up")
    await say(conv, "Yes, Continue"); ok(is_help(), "'Yes, Continue' while waiting -> download help")
    await say(conv, "Upload Report", "rc_up"); s = await sess(lid)
    ok(last() == UPLOAD and s["step"] == "report_upload" and s["answers"]["credit_report_status"] == "awaiting_upload", "Upload Report -> waits for document")
    await say(conv, "ok"); ok(last() == wa_bot.STEPS["report_nudge"][0] and btns(SENT[-1]) == ["Upload Report", "Continue Without"], "unrelated 'ok' -> short reminder with buttons")
    await say(conv, "tomorrow"); ok(last() != UPLOAD, "unrelated text never repeats bare upload prompt")
    n = len(SENT); await say(conv, media=True, mid="R1"); s = await sess(lid)
    ok(s["status"] == "completed" and s["answers"]["credit_report_status"] == "uploaded" and "Thank you" in last() and len(SENT) == n + 1, "upload -> uploaded, thank you, finished")
    n = len(SENT); await say(conv, media=True, mid="R1"); await say(conv, "hello")
    s = await sess(lid); ok(len(SENT) == n and [d["msg_id"] for d in s["documents"]].count("R1") == 1, "after upload: duplicate/other messages don't restart")
    # Help Me Download button
    lid2, conv2 = await mk(); await say(conv2, "Help Me Download", "cr_help")
    ok(is_help() and (await sess(lid2))["answers"]["credit_report_status"] == "help_requested", "Help Me Download -> same help message")
    await say(conv2, "Continue Without", "rc_no"); s = await sess(lid2)
    ok(s["step"] == "cibil_score" and s["answers"]["credit_report_status"] == "not_provided", "Continue Without -> not_provided, next question")
    await say(conv2, "Yes continue"); ok(last() == wa_bot.STEPS["cibil_score"][0], "not asked for report again")
    # Continue Without from the reminder while waiting
    lid3, conv3 = await mk(); await say(conv3, "Yes, I'll Share", "cr_yes"); await say(conv3, "ok"); await say(conv3, "Continue Without", "rc_no")
    s = await sess(lid3); ok(s["step"] == "cibil_score" and s["answers"]["credit_report_status"] == "not_provided", "Continue Without from reminder")
    # two report pages at once
    lid4, conv4 = await mk(); await say(conv4, "Yes, I'll Share", "cr_yes"); n = len(SENT)
    await asyncio.gather(say(conv4, media=True, mid="R4"), say(conv4, media=True, mid="R5")); s = await sess(lid4)
    ok(len(SENT) == n + 1 and len([d for d in s["documents"] if d["kind"] == "credit_report"]) == 2, "simultaneous pages -> one thank-you, both saved")
    await db.meta_leads.delete_many({"lead_id": {"$in": IDS}}); await wa_bot.SESS.delete_many({"lead_id": {"$in": IDS}})

loop.run_until_complete(main())
