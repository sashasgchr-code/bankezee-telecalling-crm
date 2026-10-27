"""Simulates WhatsApp bot flows via signed webhooks for test number 910000000000 only."""
import json, hmac, hashlib, time, urllib.request, pymongo, sys
from dotenv import dotenv_values

env = dotenv_values('/app/backend/.env')
db = pymongo.MongoClient(env['MONGO_URL'])[env['DB_NAME']]
LEAD = "lead_bottest_0000"
db.meta_leads.update_one({"lead_id": LEAD}, {"$set": {"lead_id": LEAD, "full_name": "Bot Tester", "phone": "0000000000", "phone_norm": "0000000000",
                         "status": "NEW", "created_time": "2026-10-27T00:00:00+00:00"}}, upsert=True)
db.wa_conversations.update_one({"wa_number": "910000000000"}, {"$set": {"lead_id": LEAD, "customer_name": "Bot Tester"}})
n = [0]


def send(kind="text", val=None):
    n[0] += 1
    msg = {"from": "910000000000", "id": f"wamid.BOT{time.time()}{n[0]}", "timestamp": str(int(time.time())), "type": kind}
    if kind == "text":
        msg["text"] = {"body": val}
    elif kind == "button":
        msg["button"] = {"text": val, "payload": val}
    elif kind == "interactive":
        msg["interactive"] = {"type": "button_reply", "button_reply": {"id": val[0], "title": val[1]}}
    else:
        msg[kind] = {"id": "fake_media", "mime_type": "application/pdf", "filename": "doc.pdf"}
    ev = {"entry": [{"changes": [{"value": {"metadata": {"phone_number_id": env['META_WHATSAPP_PHONE_NUMBER_ID']}, "messages": [msg]}}]}]}
    raw = json.dumps(ev).encode()
    sig = "sha256=" + hmac.new(env['META_WHATSAPP_APP_SECRET'].encode(), raw, hashlib.sha256).hexdigest()
    urllib.request.urlopen(urllib.request.Request("http://localhost:8001/api/integrations/whatsapp/webhook", data=raw,
                                                  headers={"Content-Type": "application/json", "X-Hub-Signature-256": sig})).read()
    s = db.wa_bot_sessions.find_one({"lead_id": LEAD}) or {}
    last = db.wa_messages.find_one({"lead_id": LEAD, "source": "bot"}, sort=[("created_at", -1)]) or {}
    print(f"  > {val!s:30} | step={s.get('step')} status={s.get('status')} | bot: {(last.get('text') or '')[:60]!r}")
    return s


def flow(name, steps):
    db.wa_bot_sessions.delete_many({"lead_id": LEAD})
    print(name)
    s = None
    for st in steps:
        s = send(*st)
    print("  answers:", s.get("answers"), "docs:", len(s.get("documents") or []))


flow("A salaried+payslip+report", [("button", "Yes, Continue"), ("interactive", ("emp_sal", "Salaried")), ("interactive", ("ps_up", "Upload Payslip")),
                                   ("document",), ("text", "Infosys"), ("text", "85,000"), ("interactive", ("cr_yes", "Yes, I'll Share")), ("document",)])
flow("B self-employed", [("button", "Yes, Continue"), ("text", "2"), ("text", "1,5"), ("text", "1,2"), ("text", "Sai Traders"), ("text", "12 lakh"),
                         ("interactive", ("cr_help", "Help Me Download")), ("interactive", ("rc_no", "Continue Without")), ("text", "abc"), ("text", "750"),
                         ("text", "0"), ("text", "2"), ("text", "45,000")])
flow("C other", [("button", "Yes, Continue"), ("text", "Other"), ("text", "Freelancer"), ("interactive", ("reg_yes", "Yes")), ("text", "30k from consulting"),
                 ("interactive", ("cr_no", "Don't Want To")), ("text", "Not sure"), ("text", "2"), ("text", "4.5 lakh"), ("text", "12000"), ("text", "0")])
flow("D expert call + resume-from-pause ignored", [("button", "Yes, Continue"), ("button", "Request Expert Call"), ("text", "Salaried")])
flow("E stop", [("button", "Yes, Continue"), ("text", "STOP"), ("text", "Salaried")])
print("thanks msgs:", db.wa_messages.count_documents({"lead_id": LEAD, "source": "bot", "text": {"$regex": "^Thank you"}}),
      "thanks with buttons:", db.wa_messages.count_documents({"lead_id": LEAD, "source": "bot", "text": {"$regex": "^Thank you"}, "buttons.0": {"$exists": True}}))
print("failed bot sends:", list(db.wa_messages.find({"lead_id": LEAD, "source": "bot", "status": "failed"}, {"_id": 0, "error": 1}).limit(2)))
