"""Rule-based WhatsApp qualification bot. Deterministic step machine; every bot message goes through
wa_inbox.log_outbound(source="bot") so it shows in the Team Inbox conversation.
Session doc (wa_bot_sessions): one per lead; answers saved immediately after each valid reply."""
import re
import uuid
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional

from utils.database import db
from routes import wa_inbox as inbox

logger = logging.getLogger(__name__)
SESS = db.wa_bot_sessions
RESUME_DAYS = 7
PAGE_WINDOW_MIN = 3
START_TEXTS = {"yes, continue", "yes continue"}
STOP_WORDS = {"stop", "unsubscribe", "stop all", "opt out", "optout"}
REGS = ["GST Registration", "Udyam Registration / Udyam Aadhaar", "Labour Licence", "Trade Licence", "None of the Above"]
# Car Loans campaigns only (campaign name contains "car"): own intro + a 6-option registrations question.
REGS_CAR = ["GST Registration", "Udyam Registration / Udyam Aadhaar", "Labour Licence", "Trade Licence", "3 years ITRs", "None of the Above"]
CAR_INTRO = ("Hi {name} 👋\n\nThank you for your loan enquiry with Bankezee.\nWe've received your request.\n\nTo help our loan advisor review your "
             "eligibility and available loan options, we'd like to collect a few details.\n\nYou can complete everything directly here on WhatsApp.\n\n"
             "Bankezee Loans Made Easy")
REG_WORDS = [("GST Registration", r"\bgst"), ("Udyam Registration / Udyam Aadhaar", r"udyam|udyog|msme"), ("Labour Licence", r"labou?r"),
             ("Trade Licence", r"\btrade"), ("3 years ITRs", r"\bitrs?\b|income\s*tax|\b3\s*(years?|yrs?)\b"), ("None of the Above", r"\bnone\b|\bnothing\b|\bno\s+(registration|licen[cs]e)s?\b")]
CAR_RE = re.compile(r"\bcars?\b", re.I)
CIBIL_Q = ("Do you have your latest credit report?\n\nSharing your report helps our loan advisor review your existing loans, "
           "repayment history and outstanding balances without you having to enter every loan individually.")
HELP_TEXT = ("You can get your credit report from:\n\nCIBIL:\nhttps://www.cibil.com/freecibilscore\n\nPaisabazaar:\n"
             "https://www.paisabazaar.com/cibil/\n\nGoodScore:\nhttps://goodscore.app/\n\nCIBIL offers one free score and report "
             "per calendar year. Other services and features may vary.\n\nDownload your report and share it here on WhatsApp.\n\n"
             "Would you like to upload your report or continue without it?")
REPORT_HELP_RE = re.compile(r"\b(where|how|help|download|find|get|check|what\s+is|know|pdf|cibil|credit|score|report|link|site|website|app|"
                            r"continue|yes|available|don'?t\s+have|dont\s+have)\b", re.I)
SKIP_REPORT_RE = re.compile(r"^(no|nope|skip|continue without|i\s+)?(don'?t|do\s+not)?\s*want\s*to\.?$|^(no|nope|skip)\.?$", re.I)
THANKS = ("Thank you, {name}! ✅\n\nWe've received your information for an initial loan review.\n\nOur Bankezee loan advisor will "
          "review your details and contact you to discuss suitable options.\n\nNo loan application will be submitted to a bank or "
          "NBFC without your consent.\n\nBankezee — Loans Made Easy")

# step -> (question text, buttons [(id, title)] or None)
STEPS = {
    "employment": ("Are you:\n1️⃣ Salaried\n2️⃣ Self-employed\n3️⃣ Other", [("emp_sal", "Salaried"), ("emp_self", "Self-employed"), ("emp_other", "Other")]),
    "payslip": ("Can you share your latest monthly payslip?", [("ps_up", "Upload Payslip"), ("ps_no", "I Don't Have It"), ("ps_later", "Share Later")]),
    "payslip_upload": ("Please attach your latest monthly payslip as a PDF or image.", None),
    "company": ("What's the name of your company?", None),
    "salary": ("What's your exact monthly take-home salary?", None),
    "se_regs": ("Which of these business registrations or licences do you have? Select all that apply.\n\n"
                + "\n".join(f"{i}. {r}" for i, r in enumerate(REGS, 1)) + "\n\nReply with the numbers or names, e.g. 1,2,4 or GST, Udyam", None),
    "se_regs_car": ("Which of these business registrations or licences do you have? Select all that apply.\n\n"
                    + "\n".join(f"{i}. {r}" for i, r in enumerate(REGS_CAR, 1)) + "\n\nReply with the numbers or names, e.g. 1,2,4 or GST, Udyam", None),
    "car_intro": (CAR_INTRO, [("car_yes", "Yes Continue")]),
    "se_name": ("What's your business/company name?", None),
    "se_turnover": ("What's your approximate annual turnover?", None),
    "other_cat": ("What's your employment or income category?", None),
    "other_regular": ("Do you have regular monthly income?", [("reg_yes", "Yes"), ("reg_no", "No")]),
    "other_income": ("What's your approximate monthly income and its source?", None),
    "cibil_report": (CIBIL_Q, [("cr_yes", "Yes, I'll Share"), ("cr_help", "Help Me Download"), ("cr_no", "Don't Want To")]),
    "report_choice": (HELP_TEXT, [("rc_up", "Upload Report"), ("rc_no", "Continue Without")]),
    "report_upload": ("Please upload your latest credit report here as a PDF or supported document.", None),
    "report_nudge": ("Whenever you're ready, upload your latest credit report here as a PDF or supported document.",
                     [("rc_up", "Upload Report"), ("rc_no", "Continue Without")]),
    "cibil_score": ("What's your CIBIL score?", None),
    "loans_count": ("How many existing loans do you have?", None),
    "cards_count": ("How many credit cards do you have?", None),
    "loan_outstanding": ("What's your approximate total outstanding loan amount?", None),
    "loan_emi": ("What's your total monthly EMI across all loans?", None),
    "card_outstanding": ("What's your approximate total outstanding credit card balance?", None),
}
UNSURE = re.compile(r"^(not\s*sure|don'?t\s*know|dont\s*know|dk|no\s*idea|na|n/a|unsure)\.?$", re.I)
WORD_NUM = {"zero": 0, "none": 0, "nil": 0, "no": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5}


def _now():
    return datetime.now(timezone.utc)


def parse_amount(text: str):
    """'45,000' / '4.5 lakh' / '2L' / '1.2 cr' / '45k' / 'zero' / 'not sure' -> (ok, value|'not_sure')."""
    t = (text or "").strip().lower().replace("₹", "").replace("rs.", "").replace("rs", "").replace("inr", "").strip()
    if UNSURE.match(t):
        return True, "not_sure"
    if t in WORD_NUM:
        return True, WORD_NUM[t]
    m = re.match(r"^([\d,]*\.?\d+)\s*(lakhs?|lacs?|l|crores?|cr|k|thousand)?\b", t)
    if not m:
        return False, None
    n = float(m.group(1).replace(",", ""))
    mult = {"l": 1e5, "lakh": 1e5, "lakhs": 1e5, "lac": 1e5, "lacs": 1e5, "cr": 1e7, "crore": 1e7, "crores": 1e7,
            "k": 1e3, "thousand": 1e3}.get(m.group(2) or "", 1)
    return True, int(round(n * mult))


def parse_count(text: str):
    ok, v = parse_amount(text)
    if ok and v != "not_sure" and (v > 50):
        return False, None
    return ok, v


async def _send(sess: dict, step: str, text: Optional[str] = None):
    body, buttons = STEPS[step] if step in STEPS else (text, None)
    body = text or body
    if buttons:
        payload = {"type": "interactive", "interactive": {"type": "button", "body": {"text": body[:1024]},
                   "action": {"buttons": [{"type": "reply", "reply": {"id": i, "title": t}} for i, t in buttons]}}}
    else:
        payload = {"type": "text", "text": {"body": body, "preview_url": False}}
    m = await inbox.log_outbound(sess["wa_number"], source="bot", type_="interactive" if buttons else "text", text=body,
                                 buttons=[{"type": "QUICK_REPLY", "text": t} for _, t in buttons or []], status="sending",
                                 sender={"name": "WhatsApp Bot", "role": "bot"})
    res = await inbox._graph({"to": sess["wa_number"], **payload})
    if m:
        await inbox._finish_send(m, res)
    return res


async def _set(sess, upd: dict, step: Optional[str]):
    upd = {**upd, "step": step, "updated_at": _now().isoformat()}
    await SESS.update_one({"id": sess["id"]}, {"$set": upd})
    sess.update(upd)
    if sess.get("flow") == "car":
        ans = sess.get("answers") or {}
        await db.meta_leads.update_one({"lead_id": sess["lead_id"]}, {"$set": {
            "campaign_type": "Car Loans", "car_loan_profile": {"employment_type": ans.get("employment_type"), "business_registrations": ans.get("business_registrations"),
                                                               "chatbot_status": sess.get("status"), "chatbot_step": step, "updated_at": upd["updated_at"]}}})


def _a(sess, k):
    return (sess.get("answers") or {}).get(k)


async def _after_employment_salaried(sess):
    """Ask only missing company / salary (CRM website-qualification values count as known)."""
    if not _a(sess, "company_name"):
        return "company"
    if _a(sess, "net_monthly_salary") is None:
        return "salary"
    return "cibil_report"


async def _complete(sess):
    lead = await db.meta_leads.find_one({"lead_id": sess["lead_id"]}, {"full_name": 1}) or {}
    name = inbox.wa.clean_param(lead.get("full_name")) or "there"
    await _send(sess, "thanks", THANKS.format(name=name))
    now = _now().isoformat()
    await _set(sess, {"status": "completed", "completed_at": now}, None)
    await inbox.CONV.update_one({"id": sess["conv_id"]}, {"$set": {"status": "waiting_team"}, "$inc": {"unread_count": 1}})
    await db.meta_leads.update_one({"lead_id": sess["lead_id"]}, {
        "$set": {"whatsapp_qualification": {"status": "completed", "completed_at": now}, "updated_at": now},
        "$push": {"activities": {"type": "whatsapp", "detail": "Customer completed WhatsApp qualification", "at": now}}})


def _choice(m: dict, step: str) -> Optional[str]:
    """Map a reply to a button id: interactive id, exact title, or 1/2/3 number."""
    btns = STEPS[step][1] or []
    rid = m.get("reply_id")
    if rid in [i for i, _ in btns]:
        return rid
    t = (m.get("text") or "").strip().lower()
    for idx, (i, title) in enumerate(btns, 1):
        if t in (title.lower(), str(idx)) or t.replace("’", "'") == title.lower():
            return i
    if step == "employment":
        if "self" in t or "business" in t:
            return "emp_self"
        if "salar" in t:
            return "emp_sal"
    return None


async def _save_doc(sess, m, kind):
    docs = (sess.get("documents") or []) + [{"kind": kind, "msg_id": m["id"], "filename": (m.get("media") or {}).get("filename"),
                                              "mime": (m.get("media") or {}).get("mime"), "at": _now().isoformat()}]
    return {"documents": docs}


def _parse_regs(t: str, regs: list) -> list:
    """Option numbers ('1,2,4' / '124') and/or typed names ('GST, Udyam') -> sorted 1-based option numbers; [] if anything is invalid."""
    nums = set()
    for tok in re.findall(r"\d+", re.sub(r"\b3\s*(years?|yrs?)\b", "", t, flags=re.I)):
        digits = [int(d) for d in tok]
        if not all(1 <= d <= len(regs) for d in digits):
            return []
        nums.update(digits)
    for name, pat in REG_WORDS:
        if name in regs and re.search(pat, t, re.I):
            nums.add(regs.index(name) + 1)
    return sorted(nums)


def _recent_payslip(sess: dict) -> bool:
    """Extra payslip pages arrive within a few minutes of the previous page."""
    docs = [d for d in sess.get("documents") or [] if d.get("kind") == "payslip"]
    return bool(docs) and datetime.fromisoformat(docs[-1]["at"]) > _now() - timedelta(minutes=PAGE_WINDOW_MIN)


async def _take_payslip(sess: dict, m: dict):
    """Idempotent payslip receipt: the first file completes the step and moves to the credit report question; later pages are only attached."""
    doc = {"kind": "payslip", "msg_id": m["id"], "filename": (m.get("media") or {}).get("filename"), "mime": (m.get("media") or {}).get("mime"), "at": _now().isoformat()}
    now = _now().isoformat()
    first = await SESS.find_one_and_update(
        {"id": sess["id"], "answers.payslip_uploaded": {"$ne": True}},
        {"$set": {"answers.payslip_status": "uploaded", "answers.payslip_uploaded": True, "answers.payslip_question_completed": True,
                  "step": "cibil_report", "updated_at": now}, "$push": {"documents": doc}})
    if not first:
        await SESS.update_one({"id": sess["id"], "documents.msg_id": {"$ne": m["id"]}}, {"$push": {"documents": doc}})
        return
    sess["answers"] = {**(sess.get("answers") or {}), "payslip_status": "uploaded", "payslip_uploaded": True, "payslip_question_completed": True}
    await _set(sess, {}, "cibil_report")
    return await _send(sess, "cibil_report")


async def _report_waiting(sess: dict, m: dict, ans: dict):
    """Text while waiting for the credit report: buttons, download help, or a short reminder — never the bare upload prompt again."""
    t = (m.get("text") or "").strip()
    c = _choice(m, "report_choice")
    if c == "rc_up":
        return await _send(sess, "report_upload")
    if c == "rc_no" or SKIP_REPORT_RE.match(t):
        ans["credit_report_status"] = "not_provided"
        await _set(sess, {"answers": ans}, "cibil_score")
        return await _send(sess, "cibil_score")
    if REPORT_HELP_RE.search(t) or t.endswith("?"):
        ans["credit_report_status"] = "help_requested"
        await _set(sess, {"answers": ans}, "report_choice")
        return await _send(sess, "report_choice")
    return await _send(sess, "report_nudge")


async def _advance(sess: dict, m: dict):  # noqa: C901 — one flat state machine is easiest to audit
    step, t = sess.get("step"), (m.get("text") or "").strip()
    ans = dict(sess.get("answers") or {})
    has_media = m.get("type") in ("image", "document") and m.get("media")
    if has_media and (step in ("payslip", "payslip_upload") or (ans.get("payslip_uploaded") and step == "cibil_report" and _recent_payslip(sess))):
        return await _take_payslip(sess, m)
    if has_media and step in ("cibil_report", "report_choice"):
        step = "report_upload"  # a file sent at the credit report question is the credit report

    if step in ("employment", "payslip", "other_regular", "cibil_report", "report_choice"):
        c = _choice(m, step)
        if not c and step == "report_choice":
            return await _report_waiting(sess, m, ans)
        if not c:
            return await _send(sess, step)
        if step == "employment":
            ans["employment_type"] = {"emp_sal": "Salaried", "emp_self": "Self-employed", "emp_other": "Other"}[c]
            nxt = {"emp_sal": "payslip", "emp_self": "se_regs_car" if sess.get("flow") == "car" else "se_regs", "emp_other": "other_cat"}[c]
        elif step == "payslip":
            ans["payslip_status"] = {"ps_up": "pending_upload", "ps_no": "not_available", "ps_later": "share_later"}[c]
            ans["payslip_uploaded"], ans["payslip_question_completed"] = False, c != "ps_up"
            nxt = "payslip_upload" if c == "ps_up" else await _after_employment_salaried({**sess, "answers": ans})
        elif step == "other_regular":
            ans["regular_monthly_income"] = c == "reg_yes"
            nxt = "other_income" if c == "reg_yes" else "cibil_report"
        elif step == "cibil_report":
            ans["credit_report_status"] = {"cr_yes": "awaiting_upload", "cr_help": "help_requested", "cr_no": "declined"}[c]
            nxt = {"cr_yes": "report_upload", "cr_help": "report_choice", "cr_no": "cibil_score"}[c]
        else:
            ans["credit_report_status"] = "awaiting_upload" if c == "rc_up" else "not_provided"
            nxt = "report_upload" if c == "rc_up" else "cibil_score"
        await _set(sess, {"answers": ans}, nxt)
        return await _send(sess, nxt)

    if step == "payslip_upload" and not has_media:
        return await _send(sess, step)
    if step == "report_upload" and not has_media:
        return await _report_waiting(sess, m, ans)
    if step == "report_upload":
        doc = (await _save_doc({"documents": []}, m, "credit_report"))["documents"][0]
        claimed = await SESS.find_one_and_update({"id": sess["id"], "step": {"$in": ["report_upload", "cibil_report", "report_choice"]}}, {
            "$set": {"answers.credit_report_status": "uploaded", "step": None, "updated_at": _now().isoformat()}, "$push": {"documents": doc}})
        if not claimed:  # a second page arriving at the same moment: attach only
            return await SESS.update_one({"id": sess["id"], "documents.msg_id": {"$ne": m["id"]}}, {"$push": {"documents": doc}})
        sess["answers"] = {**ans, "credit_report_status": "uploaded"}
        return await _complete(sess)

    if step in ("company", "se_name", "other_cat", "other_income"):
        if len(t) < 2:
            return await _send(sess, step)
        key = {"company": "company_name", "se_name": "company_name", "other_cat": "income_category", "other_income": "other_income_details"}[step]
        ans[key] = t[:200]
        nxt = {"company": None, "se_name": "se_turnover", "other_cat": "other_regular", "other_income": "cibil_report"}[step]
        nxt = nxt or await _after_employment_salaried({**sess, "answers": ans})
        await _set(sess, {"answers": ans}, nxt)
        return await _send(sess, nxt)

    if step == "se_regs":
        nums = _parse_regs(t, REGS)
        if not nums or (5 in nums and len(nums) > 1):
            return await _send(sess, step, STEPS[step][0] + ("\n\n\"None of the Above\" can't be combined with others." if 5 in nums else ""))
        ans["business_registrations"] = [] if nums == [5] else [REGS[n - 1] for n in nums]
        await _set(sess, {"answers": ans}, "se_name")
        return await _send(sess, "se_name")

    if step == "se_regs_car":
        nums = _parse_regs(t, REGS_CAR)
        if not nums or (6 in nums and len(nums) > 1):
            return await _send(sess, step, STEPS[step][0] + ("\n\n\"None of the Above\" can't be combined with others." if 6 in nums else
                                                             "\n\nPlease reply with one or more numbers from 1 to 6, or the names."))
        ans["business_registrations"] = [] if nums == [6] else [REGS_CAR[n - 1] for n in nums]
        await _set(sess, {"answers": ans}, "se_name")
        return await _send(sess, "se_name")

    if step == "cibil_score":
        if UNSURE.match(t.lower()):
            ans["cibil_score"] = "not_sure"
        elif t.isdigit() and 300 <= int(t) <= 900:
            ans["cibil_score"] = int(t)
        else:
            return await _send(sess, step, "Please reply with a score between 300 and 900, or \"Not sure\".\n\nWhat's your CIBIL score?")
        await _set(sess, {"answers": ans}, "loans_count")
        return await _send(sess, "loans_count")

    amount_steps = {"salary": "net_monthly_salary", "se_turnover": "annual_turnover", "loan_outstanding": "total_loan_outstanding",
                    "loan_emi": "total_monthly_emi", "card_outstanding": "credit_card_outstanding"}
    count_steps = {"loans_count": "number_of_loans", "cards_count": "number_of_credit_cards"}
    if step in amount_steps or step in count_steps:
        ok, v = (parse_count if step in count_steps else parse_amount)(t)
        if not ok:
            return await _send(sess, step, f"Please reply with a number (e.g. 45000 or 4.5 lakh), or \"Not sure\".\n\n{STEPS[step][0]}")
        ans[(amount_steps | count_steps)[step]] = v
        nxt = {"salary": "cibil_report", "se_turnover": "cibil_report", "loans_count": "cards_count" if v == 0 else "loan_outstanding",
               "loan_outstanding": "loan_emi", "loan_emi": "cards_count", "cards_count": None if v == 0 else "card_outstanding",
               "card_outstanding": None}[step]
        await _set(sess, {"answers": ans}, nxt)
        return await _send(sess, nxt) if nxt else await _complete(sess)


async def _start(conv: dict):
    lead_id = conv["lead_id"]
    prof = await db.meta_chatbot_qualifications.find_one({"crm_lead_ref": lead_id}) or {}
    q = prof.get("qualification") or {}
    answers = {k: q.get(k) for k in ("company_name", "net_monthly_salary") if q.get(k)}
    prefilled = list(answers)
    answers.update({"payslip_status": "not_asked", "payslip_uploaded": False, "payslip_question_completed": False, "credit_report_status": "not_asked"})
    now = _now().isoformat()
    lead = await db.meta_leads.find_one({"lead_id": lead_id}, {"campaign_name": 1, "full_name": 1}) or {}
    car = bool(CAR_RE.search(lead.get("campaign_name") or ""))
    sess = {"id": uuid.uuid4().hex, "lead_id": lead_id, "conv_id": conv["id"], "wa_number": conv["wa_number"], "status": "active",
            "step": "car_intro" if car else "employment", "answers": answers, "prefilled": prefilled, "documents": [], "source": "WhatsApp",
            "started_at": now, "updated_at": now, "flow": "car" if car else None}
    await SESS.update_one({"lead_id": lead_id}, {"$set": sess}, upsert=True)
    await db.meta_leads.update_one({"lead_id": lead_id}, {"$set": {"whatsapp_qualification": {"status": "in_progress", "started_at": now}}})
    if car:
        await _set(sess, {}, "car_intro")
        return await _send(sess, "car_intro", CAR_INTRO.format(name=inbox.wa.clean_param(lead.get("full_name")) or "there"))
    await _send(sess, "employment")


async def handle_inbound(conv: dict, m: dict, raw: dict):
    """Called by wa_inbox.on_inbound for each NEW (deduplicated) customer message."""
    if not conv.get("lead_id"):
        return
    it = raw.get("interactive") or {}
    m = {**m, "reply_id": (it.get("button_reply") or it.get("list_reply") or {}).get("id")}
    text = (m.get("text") or "").strip().lower()
    sess = await SESS.find_one({"lead_id": conv["lead_id"]}, {"_id": 0})
    if text in STOP_WORDS:
        if sess and sess["status"] == "active":
            await SESS.update_one({"id": sess["id"]}, {"$set": {"status": "stopped", "updated_at": _now().isoformat()}})
        return
    if text == inbox.wa.CALL_REQUEST_TEXT.lower():
        if sess and sess["status"] == "active":
            await SESS.update_one({"id": sess["id"]}, {"$set": {"status": "paused", "paused_reason": "expert_call"}})
        return
    if text in START_TEXTS and m.get("type") in ("button", "interactive", "text"):
        if sess and sess.get("flow") == "car" and sess["status"] == "abandoned" and sess.get("step"):
            return await _reactivate(sess)
        if not sess or sess["status"] in ("stopped", "abandoned"):
            return await _start(conv)
        if sess["status"] == "active":
            if sess.get("step") == "report_upload":
                return await _advance(sess, m)
            if sess.get("step") == "car_intro":
                await _set(sess, {}, "employment")
                return await _send(sess, "employment")
            return await _send(sess, sess["step"])
        return
    if sess and sess.get("flow") == "car" and sess["status"] == "abandoned" and sess.get("step"):
        return await _reactivate(sess)  # Car Loans: resume an incomplete questionnaire from the last unanswered question
    if sess and m.get("type") in ("image", "document") and m.get("media") and (sess.get("answers") or {}).get("credit_report_status") == "uploaded":
        doc = (await _save_doc({"documents": []}, m, "credit_report"))["documents"][0]  # extra report page after completion: attach only
        return await SESS.update_one({"id": sess["id"], "documents.msg_id": {"$ne": m["id"]}}, {"$push": {"documents": doc}})
    if not sess or sess["status"] != "active" or not sess.get("step"):
        return
    if sess.get("flow") == "car" and sess.get("step") == "car_intro":
        return await _send(sess, "car_intro", CAR_INTRO.format(name=inbox.wa.clean_param((await db.meta_leads.find_one({"lead_id": sess["lead_id"]}, {"full_name": 1}) or {}).get("full_name")) or "there"))
    if sess.get("flow") == "car" and datetime.fromisoformat(sess["updated_at"]) < _now() - timedelta(days=RESUME_DAYS):
        return await _reactivate(sess)
    if datetime.fromisoformat(sess["updated_at"]) < _now() - timedelta(days=RESUME_DAYS):
        await SESS.update_one({"id": sess["id"]}, {"$set": {"status": "abandoned"}})
        return
    await _advance(sess, m)


async def _reactivate(sess):
    await SESS.update_one({"id": sess["id"]}, {"$set": {"status": "active", "updated_at": _now().isoformat()}})
    sess["status"] = "active"
    if sess["step"] == "car_intro":
        await _set(sess, {}, "employment")
    return await _send(sess, sess["step"])


async def pause_for_staff(conv_id: str, user_name: str):
    await SESS.update_many({"conv_id": conv_id, "status": "active"},
                           {"$set": {"status": "paused", "paused_reason": "staff_takeover", "paused_by": user_name}})


async def resume(conv: dict) -> dict:
    sess = await SESS.find_one({"conv_id": conv["id"]}, {"_id": 0})
    if not sess or sess["status"] not in ("paused", "abandoned") or not sess.get("step"):
        return {"ok": False, "error": "Nothing to resume"}
    await SESS.update_one({"id": sess["id"]}, {"$set": {"status": "active", "updated_at": _now().isoformat(), "paused_reason": None}})
    sess["status"] = "active"
    return await _send(sess, sess["step"])
