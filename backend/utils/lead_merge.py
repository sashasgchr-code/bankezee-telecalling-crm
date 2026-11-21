"""Meta lead de-duplication by mobile number: merge chat-created copies, flag repeat applications, fill bot answers."""
import logging
from datetime import datetime, timezone

from utils.database import db

logger = logging.getLogger(__name__)
NOT_DELETED = {"deleted": {"$ne": True}}
CHAT_CREATED = {"$or": [{"source": "whatsapp"}, {"source_tab": "WhatsApp Inbound"}]}
NOT_CHAT = {"source": {"$ne": "whatsapp"}, "source_tab": {"$ne": "WhatsApp Inbound"}}


def _now():
    return datetime.now(timezone.utc).isoformat()


def _inr(n) -> str:
    return f"₹{int(n):,}" if isinstance(n, (int, float)) else ""


async def _move_session(dup_id: str, orig_id: str):
    dup = await db.wa_bot_sessions.find_one({"lead_id": dup_id}, {"_id": 0})
    if not dup:
        return
    orig = await db.wa_bot_sessions.find_one({"lead_id": orig_id}, {"_id": 0})
    if orig and len(orig.get("answers") or {}) >= len(dup.get("answers") or {}):
        await db.wa_bot_sessions.update_one({"id": dup["id"]}, {"$set": {"lead_id": f"merged:{dup_id}", "merged_into": orig_id}})
        return
    if orig:
        await db.wa_bot_sessions.update_one({"id": orig["id"]}, {"$set": {"lead_id": f"merged:{orig_id}", "merged_into": orig_id}})
    await db.wa_bot_sessions.update_one({"id": dup["id"]}, {"$set": {"lead_id": orig_id}})


async def merge_into(dup: dict, orig: dict):
    """Move everything from a chat-created copy into the original Meta entry, then hide the copy (soft delete)."""
    d, o, now = dup["lead_id"], orig["lead_id"], _now()
    for coll in (db.wa_conversations, db.wa_messages, db.call_logs, db.tl_call_logs):
        await coll.update_many({"lead_id": d}, {"$set": {"lead_id": o}})
    await db.meta_chatbot_qualifications.update_many({"crm_lead_ref": d}, {"$set": {"crm_lead_ref": o}})
    await _move_session(d, o)
    upd = {"updated_at": now}
    for k in ("whatsapp", "whatsapp_qualification", "assigned_partner_id", "assigned_partner_name", "assigned_processor_id", "assigned_processor_name"):
        if dup.get(k) and not orig.get(k):
            upd[k] = dup[k]
    await db.meta_leads.update_one({"lead_id": o}, {"$set": upd, "$push": {
        "notes": {"$each": dup.get("notes") or []},
        "activities": {"$each": (dup.get("activities") or []) + [{"type": "merged", "detail": "Merged the WhatsApp chat entry created for this customer", "at": now}]}}})
    await db.meta_leads.update_one({"lead_id": d}, {"$set": {"deleted": True, "deleted_at": now, "deleted_reason": "merged_chat_duplicate", "merged_into": o}})
    await sync_bot_fields(o)
    logger.info(f"Merged chat-created lead {d} into {o}")


async def merge_chat_duplicates(phone_norm: str = None) -> int:
    q = {**CHAT_CREATED, **NOT_DELETED, "phone_norm": phone_norm or {"$nin": [None, ""]}}
    merged = 0
    async for dup in db.meta_leads.find(q, {"_id": 0}):
        orig = await db.meta_leads.find_one({"phone_norm": dup["phone_norm"], "lead_id": {"$ne": dup["lead_id"]}, **NOT_CHAT, **NOT_DELETED},
                                            {"_id": 0}, sort=[("created_time", -1)])
        if orig:
            await merge_into(dup, orig)
            merged += 1
    return merged


async def flag_duplicate(lead: dict):
    """Point a repeat application at the customer's first entry with the same mobile number."""
    if not lead.get("phone_norm"):
        return
    first = await db.meta_leads.find_one({"phone_norm": lead["phone_norm"], "lead_id": {"$ne": lead["lead_id"]}, **NOT_CHAT, **NOT_DELETED,
                                          "created_at": {"$lt": lead.get("created_at") or _now()}},
                                         {"_id": 0, "lead_id": 1, "full_name": 1, "campaign_name": 1, "created_time": 1, "created_at": 1}, sort=[("created_at", 1)])
    if first:
        await db.meta_leads.update_one({"lead_id": lead["lead_id"]}, {"$set": {"duplicate_of": {
            "lead_id": first["lead_id"], "full_name": first.get("full_name"), "campaign_name": first.get("campaign_name"),
            "created_time": first.get("created_time") or first.get("created_at")}}})


async def flag_all_duplicates() -> int:
    n = 0
    pipe = [{"$match": {**NOT_CHAT, **NOT_DELETED, "phone_norm": {"$nin": [None, ""]}}},
            {"$group": {"_id": "$phone_norm", "c": {"$sum": 1}}}, {"$match": {"c": {"$gt": 1}}}]
    async for g in db.meta_leads.aggregate(pipe):
        async for lead in db.meta_leads.find({"phone_norm": g["_id"], **NOT_CHAT, **NOT_DELETED}, {"_id": 0, "lead_id": 1, "phone_norm": 1, "created_at": 1}):
            await flag_duplicate(lead)
            n += 1
    return n


async def sync_bot_fields(lead_id: str):
    """Fill empty Employment / Salary / Outstanding columns from the WhatsApp bot answers."""
    s = await db.wa_bot_sessions.find_one({"lead_id": lead_id}, {"_id": 0, "answers": 1}) or {}
    a = s.get("answers") or {}
    empty = lambda f: {"lead_id": lead_id, "$or": [{f: {"$in": [None, ""]}}, {f: {"$exists": False}}]}
    if a.get("employment_type"):
        await db.meta_leads.update_one(empty("employment_status"), {"$set": {"employment_status": a["employment_type"]}})
    if isinstance(a.get("net_monthly_salary"), (int, float)):
        await db.meta_leads.update_one(empty("monthly_salary"), {"$set": {"monthly_salary": _inr(a["net_monthly_salary"]), "monthly_salary_num": a["net_monthly_salary"]}})
    if isinstance(a.get("total_loan_outstanding"), (int, float)):
        await db.meta_leads.update_one(empty("outstanding_amount"), {"$set": {"outstanding_amount": _inr(a["total_loan_outstanding"]),
                                                                              "outstanding_amount_num": a["total_loan_outstanding"]}})


async def run_backfill():
    try:
        merged = await merge_chat_duplicates()
        async for s in db.wa_bot_sessions.find({"answers": {"$ne": {}}, "lead_id": {"$not": {"$regex": "^merged:"}}}, {"_id": 0, "lead_id": 1}):
            await sync_bot_fields(s["lead_id"])
        flagged = await flag_all_duplicates()
        logger.info(f"Lead dedup backfill: merged {merged} chat copies, checked {flagged} repeat entries")
    except Exception as e:
        logger.warning(f"Lead dedup backfill failed: {e}")
