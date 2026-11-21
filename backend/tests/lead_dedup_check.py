"""Lead de-dup: merge chat-created copies, flag repeat applications, bot fields fill the columns."""
import asyncio, sys, uuid
loop = asyncio.new_event_loop(); asyncio.set_event_loop(loop)
sys.path.insert(0, '/app/backend')
from dotenv import load_dotenv; load_dotenv('/app/backend/.env')
from utils import lead_merge as lm
from utils.database import db

ok = lambda c, m: print(("PASS " if c else "FAIL ") + m)


async def main():
    p10 = "6" + uuid.uuid4().int.__str__()[:9]
    meta_id, chat_id, rep_id = (f"lead_TESTDD{uuid.uuid4().hex[:6]}" for _ in range(3))
    await db.meta_leads.insert_many([
        {"lead_id": meta_id, "full_name": "TEST Siva", "phone": f"+91{p10}", "phone_norm": p10, "campaign_name": "Car Loan Leads campaign",
         "source_tab": "Meta", "employment_status": "", "monthly_salary": "", "created_at": "2026-11-20T08:00:00+00:00", "notes": [], "activities": [],
         "assigned_partner_id": "u1", "assigned_partner_name": "Rama"},
        {"lead_id": chat_id, "full_name": "TEST Siva", "phone": f"91{p10}", "phone_norm": p10, "source": "whatsapp", "source_tab": "WhatsApp Inbound",
         "created_at": "2026-11-20T07:00:00+00:00", "whatsapp": {"wamid": "w1"}, "notes": [{"text": "chat note"}], "activities": [{"type": "created"}]}])
    conv = uuid.uuid4().hex
    await db.wa_conversations.insert_one({"id": conv, "lead_id": chat_id, "wa_number": f"91{p10}", "phone_number_id": "TEST"})
    await db.wa_messages.insert_one({"id": uuid.uuid4().hex, "conv_id": conv, "lead_id": chat_id, "text": "hi"})
    await db.wa_bot_sessions.insert_one({"id": uuid.uuid4().hex, "lead_id": chat_id, "conv_id": conv,
                                         "answers": {"employment_type": "Salaried", "net_monthly_salary": 45000, "total_loan_outstanding": 300000}})
    ok(await lm.merge_chat_duplicates(p10) == 1, "chat-created copy merged")
    m = await db.meta_leads.find_one({"lead_id": meta_id}); c = await db.meta_leads.find_one({"lead_id": chat_id})
    ok(c["deleted"] and c["merged_into"] == meta_id, "copy hidden (soft delete) and points to original")
    ok((await db.wa_conversations.find_one({"id": conv}))["lead_id"] == meta_id and await db.wa_messages.count_documents({"conv_id": conv, "lead_id": meta_id}) == 1, "chat + messages moved")
    ok(await db.wa_bot_sessions.count_documents({"lead_id": meta_id}) == 1, "bot session moved")
    ok(m["employment_status"] == "Salaried" and m["monthly_salary_num"] == 45000 and m["outstanding_amount_num"] == 300000, "employment/salary/outstanding filled from bot")
    ok(m["whatsapp"]["wamid"] == "w1" and m["assigned_partner_name"] == "Rama" and any(n.get("text") == "chat note" for n in m["notes"]), "whatsapp status, partner and notes kept")
    ok(await lm.merge_chat_duplicates(p10) == 0, "idempotent")
    await db.meta_leads.insert_one({"lead_id": rep_id, "full_name": "TEST Siva", "phone_norm": p10, "campaign_name": "Loan Consolidation", "source_tab": "Meta",
                                    "created_at": "2026-12-01T08:00:00+00:00"})
    await lm.flag_duplicate(await db.meta_leads.find_one({"lead_id": rep_id}))
    r = await db.meta_leads.find_one({"lead_id": rep_id})
    ok((r.get("duplicate_of") or {}).get("lead_id") == meta_id, "new campaign application flagged as duplicate of first entry")
    await lm.flag_duplicate(m); ok(not (await db.meta_leads.find_one({"lead_id": meta_id})).get("duplicate_of"), "first entry not flagged")
    await db.meta_leads.update_one({"lead_id": meta_id}, {"$set": {"employment_status": "Self-employed"}}); await lm.sync_bot_fields(meta_id)
    ok((await db.meta_leads.find_one({"lead_id": meta_id}))["employment_status"] == "Self-employed", "existing values never overwritten")
    ids = [meta_id, chat_id, rep_id]
    await db.meta_leads.delete_many({"lead_id": {"$in": ids}}); await db.wa_conversations.delete_one({"id": conv})
    await db.wa_messages.delete_many({"conv_id": conv}); await db.wa_bot_sessions.delete_many({"conv_id": conv})

loop.run_until_complete(main())
