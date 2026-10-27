"""WhatsApp Team Inbox: one central message history (wa_messages) grouped into conversations
(wa_conversations, one per customer number + business number). Every send path logs here;
future bot messages should call log_outbound(source="bot")."""
import os
import re
import json
import time
import uuid
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Query
from fastapi.responses import Response
from pydantic import BaseModel
from pymongo.errors import DuplicateKeyError
from motor.motor_asyncio import AsyncIOMotorGridFSBucket

from utils.database import db
from utils.auth import require_meta_access
from routes.meta import _ctx, NOT_DELETED
from routes import whatsapp as wa
from routes import cc_core

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/inbox", tags=["WhatsApp Inbox"])
CONV, MSG, QR, AUDIT = db.wa_conversations, db.wa_messages, db.wa_quick_replies, db.wa_audit
bucket = AsyncIOMotorGridFSBucket(db, bucket_name="wa_media")
INBOX_ROLES = {"admin", "ops", "processor", "growth_partner"}
RANK = {"sending": 0, "accepted": 1, "submitted": 1, "sent": 2, "delivered": 3, "read": 4}
WINDOW = timedelta(hours=24)
MAX_UPLOAD = 16 * 1024 * 1024
_rate: dict = {}


def _iso(dt=None):
    return (dt or datetime.now(timezone.utc)).isoformat()


def _clean(d):
    if d:
        d.pop("_id", None)
    return d


async def ensure_indexes():
    await MSG.create_index("wamid", unique=True, sparse=True)
    await MSG.create_index("client_id", unique=True, sparse=True)
    await MSG.create_index([("conv_id", 1), ("created_at", 1)])
    await CONV.create_index([("wa_number", 1), ("phone_number_id", 1)], unique=True)
    await CONV.create_index("lead_id")
    await CONV.create_index([("last_message_at", -1)])
    await backfill()


# ------------------------------------------------------------------ conversations + logging
async def _lead_for_number(wa_number: str):
    p10 = (wa_number or "")[-10:]
    if not p10:
        return None
    return await db.meta_leads.find_one({"phone_norm": p10, **NOT_DELETED}, sort=[("created_time", -1)])


async def get_conv(wa_number: str, lead: Optional[dict] = None, profile_name: Optional[str] = None) -> dict:
    key = {"wa_number": wa_number, "phone_number_id": wa.PHONE_NUMBER_ID}
    conv = await CONV.find_one(key)
    if conv:
        upd = {}
        if not conv.get("lead_id"):
            lead = lead or await _lead_for_number(wa_number)
            if lead:
                upd.update({"lead_id": lead["lead_id"], "customer_name": lead.get("full_name") or conv.get("customer_name")})
        if profile_name and not conv.get("profile_name"):
            upd["profile_name"] = profile_name
        if upd:
            await CONV.update_one({"id": conv["id"]}, {"$set": upd})
            conv.update(upd)
        return conv
    lead = lead or await _lead_for_number(wa_number)
    doc = {**key, "id": uuid.uuid4().hex, "lead_id": lead["lead_id"] if lead else None,
           "customer_name": (lead or {}).get("full_name") or profile_name or "", "profile_name": profile_name,
           "assigned_processor_id": None, "assigned_processor_name": None, "status": "waiting_customer",
           "unread_count": 0, "last_message_at": None, "last_inbound_at": None, "sources": [], "templates": [],
           "created_at": _iso()}
    try:
        await CONV.insert_one(dict(doc))
    except DuplicateKeyError:
        return await CONV.find_one(key)
    return doc


async def _touch(conv: dict, m: dict, inbound=False):
    preview = (m.get("text") or (m.get("media") or {}).get("filename") or m.get("type") or "")[:120]
    s = {"last_message_at": m["created_at"], "last_preview": preview, "last_direction": m["direction"],
         "last_source": m["source"]}
    upd = {"$set": s, "$addToSet": {"sources": m["source"]}}
    if (m.get("template") or {}).get("name"):
        upd["$addToSet"]["templates"] = m["template"]["name"]
    if inbound:
        s.update({"last_inbound_at": m["created_at"], "status": "waiting_team"})
        upd["$inc"] = {"unread_count": 1}
    elif m["source"] in ("staff", "staff_template"):
        s["status"] = "waiting_customer"
    await CONV.update_one({"id": conv["id"]}, upd)


async def log_outbound(wa_number: str, *, source: str, type_: str, text: str = "", lead: Optional[dict] = None,
                       wamid=None, status="accepted", error=None, template=None, header=None, buttons=None,
                       media=None, campaign_id=None, sender=None, client_id=None, created_at=None) -> Optional[dict]:
    """Central outbound log. Never raises into the caller's send path."""
    try:
        conv = await get_conv(wa_number, lead)
        m = {"id": uuid.uuid4().hex, "conv_id": conv["id"], "wa_number": wa_number, "phone_number_id": wa.PHONE_NUMBER_ID,
             "lead_id": conv.get("lead_id"), "direction": "out", "source": source, "type": type_, "text": text,
             "template": template, "header": header, "buttons": buttons or [], "media": media, "campaign_id": campaign_id,
             "sender": sender, "status": status, "error": error, "created_at": created_at or _iso()}
        if wamid:
            m["wamid"] = wamid
        if client_id:
            m["client_id"] = client_id
        await MSG.insert_one(dict(m))
        await _touch(conv, m)
        return m
    except DuplicateKeyError:
        return None
    except Exception as e:
        logger.warning(f"inbox log_outbound error: {e}")
        return None


def render(tpl: Optional[dict], values: dict, btn_values: dict):
    if not tpl:
        return "", []
    text = cc_core.VAR_RE.sub(lambda mm: str(values.get(mm.group(1)) or mm.group(0)), tpl.get("body") or "")
    if tpl.get("header_type") == "TEXT" and tpl.get("header_text"):
        text = cc_core.VAR_RE.sub(lambda mm: str(values.get(mm.group(1)) or ""), tpl["header_text"]) + "\n\n" + text
    if tpl.get("footer"):
        text += "\n\n" + tpl["footer"]
    btns = []
    for i, b in enumerate(tpl.get("buttons") or []):
        url = b.get("url")
        if url and "{{" in url:
            url = url.split("{{")[0] + str(btn_values.get(str(i)) or "")
        btns.append({"type": b.get("type"), "text": b.get("text"), "url": url})
    return text, btns


async def _tpl(name, language=None):
    q = {"name": name, **({"language": language} if language else {})}
    return await cc_core.TPL.find_one(q, {"_id": 0})


async def log_welcome(lead: dict, recipient: str, res: dict, token: str, trigger: str, created_at=None, status=None, tpl_name=None):
    tpl_name = tpl_name or wa.TEMPLATE_NAME
    tpl = await _tpl(tpl_name)
    name = wa.clean_param(lead.get("full_name")) or "Customer"
    values = {v: name for v in (tpl or {}).get("body_vars", [])}
    text, btns = render(tpl, values, {"0": token})
    hdr = {"type": "image", "ref_kind": "welcome"} if (tpl or {}).get("header_type") == "IMAGE" and wa.HEADER_IMAGE_PATH else None
    err = res.get("error")
    await log_outbound(recipient, source="welcome", type_="template", lead=lead, text=text or f"[Template {tpl_name}]",
                       wamid=res.get("wamid"), status=status or ("accepted" if res.get("ok") else "failed"),
                       error=(err.get("message") if isinstance(err, dict) else err), header=hdr, buttons=btns,
                       template={"name": tpl_name, "language": wa.TEMPLATE_LANG, "values": values, "button_params": {"0": token}},
                       sender={"name": "Automation", "role": trigger}, created_at=created_at)


async def log_campaign(msg: dict, tpl: dict, c: dict, res: dict):
    vm = msg.get("var_map") or {}
    values = {v: cc_core.resolve_var(vm.get(v), c or {}) for v in tpl.get("header_vars", []) + tpl.get("body_vars", [])}
    btn_values = {str(b["index"]): cc_core.resolve_var(vm.get(f"button_{b['index']}"), c or {}) for b in tpl.get("button_vars", [])}
    text, btns = render(tpl, values, btn_values)
    ht = tpl.get("header_type")
    hdr = {"type": ht.lower(), "ref_kind": "cc_media", "ref": msg.get("media_ref")} if ht in ("IMAGE", "VIDEO", "DOCUMENT") else None
    await log_outbound(msg["wa_number"], source="birthday" if msg.get("kind") == "birthday" else "campaign", type_="template",
                       text=text, wamid=res.get("wamid"), status="accepted" if res.get("ok") else "failed",
                       error=None if res.get("ok") else res.get("error"), header=hdr, buttons=btns, campaign_id=msg.get("campaign_id"),
                       template={"name": tpl["name"], "language": tpl.get("language"), "category": tpl.get("category"),
                                 "values": values, "button_params": btn_values}, sender={"name": "Campaign", "role": msg.get("kind")})


async def backfill():
    """Import already-stored sends (welcome wamids on leads, campaign wamids) once; dedup by wamid."""
    try:
        async for lead in db.meta_leads.find({"whatsapp.wamid": {"$ne": None}, **NOT_DELETED}):
            w = lead["whatsapp"]
            if await MSG.find_one({"wamid": w["wamid"]}, {"_id": 1}):
                continue
            rec = w.get("to") or wa._to_recipient(lead.get("phone") or "")
            if rec:
                await log_welcome(lead, rec, {"ok": True, "wamid": w["wamid"]}, w.get("token") or "", w.get("trigger") or "auto",
                                  created_at=w.get("sent_at"), status=w.get("status"), tpl_name=w.get("template"))
        async for m in cc_core.MSG.find({"wamid": {"$ne": None}}):
            if await MSG.find_one({"wamid": m["wamid"]}, {"_id": 1}):
                continue
            tpl = await _tpl(m.get("template"), m.get("language"))
            if tpl:
                await log_campaign(m, tpl, await cc_core.CUST.find_one({"customer_id": m.get("customer_id")}) or {"name": m.get("name")},
                                   {"ok": True, "wamid": m["wamid"]})
    except Exception as e:
        logger.warning(f"inbox backfill error: {e}")


# ------------------------------------------------------------------ webhook hooks
async def on_status(st: dict):
    state, wamid = st.get("status"), st.get("id")
    m = await MSG.find_one({"wamid": wamid}, {"status": 1, "id": 1})
    if not m:
        return
    s = {f"{state}_at": _iso()}
    if state == "failed":
        e = (st.get("errors") or [{}])[0]
        s.update({"status": "failed", "error": f"{e.get('code')}: {e.get('message') or e.get('title') or 'failed'}"})
    elif RANK.get(state, -1) > RANK.get(m.get("status"), -1):
        s["status"] = state
    await MSG.update_one({"id": m["id"]}, {"$set": s})


def _parse_inbound(msg: dict):
    t = msg.get("type") or "unsupported"
    text, media = "", None
    if t == "text":
        text = (msg.get("text") or {}).get("body") or ""
    elif t == "button":
        text = (msg.get("button") or {}).get("text") or ""
    elif t == "interactive":
        it = msg.get("interactive") or {}
        text = (it.get("button_reply") or it.get("list_reply") or {}).get("title") or ""
    elif t in ("image", "document", "audio", "video", "sticker"):
        b = msg.get(t) or {}
        media = {"kind": "meta", "id": b.get("id"), "mime": b.get("mime_type"), "filename": b.get("filename"), "caption": b.get("caption")}
        text = b.get("caption") or ""
    elif t == "location":
        loc = msg.get("location") or {}
        text = f"Location: {loc.get('name') or ''} {loc.get('latitude')},{loc.get('longitude')}".strip()
    elif t == "reaction":
        text = (msg.get("reaction") or {}).get("emoji") or ""
    elif t == "contacts":
        text = "Shared contact: " + ", ".join(((c.get("name") or {}).get("formatted_name") or "") for c in msg.get("contacts") or [])
    else:
        text = "[Unsupported message type]"
    return t, text, media


async def on_inbound(msg: dict, value: dict):
    sender = wa._to_recipient(msg.get("from") or "")
    if not sender or not msg.get("id"):
        return
    if (value.get("metadata") or {}).get("phone_number_id") not in (None, wa.PHONE_NUMBER_ID):
        return
    profile = ((value.get("contacts") or [{}])[0].get("profile") or {}).get("name")
    conv = await get_conv(sender, profile_name=profile)
    t, text, media = _parse_inbound(msg)
    ts = msg.get("timestamp")
    at = _iso(datetime.fromtimestamp(int(ts), timezone.utc)) if ts and str(ts).isdigit() else _iso()
    m = {"id": uuid.uuid4().hex, "conv_id": conv["id"], "wa_number": sender, "phone_number_id": wa.PHONE_NUMBER_ID,
         "lead_id": conv.get("lead_id"), "direction": "in", "source": "customer", "type": t, "text": text, "media": media,
         "wamid": msg["id"], "context_wamid": (msg.get("context") or {}).get("id"), "status": "received", "created_at": at}
    try:
        await MSG.insert_one(dict(m))
    except DuplicateKeyError:
        return
    await _touch(conv, m, inbound=True)
    if media and media.get("id"):
        await _cache_media(m["id"], media)
    try:
        from routes import wa_bot
        await wa_bot.handle_inbound({**conv, "lead_id": conv.get("lead_id")}, m, msg)
    except Exception as e:
        logger.warning(f"wa_bot error: {e}")


async def _download_meta_media(media_id: str):
    h = {"Authorization": f"Bearer {wa.ACCESS_TOKEN}"}
    async with httpx.AsyncClient(timeout=60) as hc:
        r = await hc.get(f"https://graph.facebook.com/{wa.GRAPH_VERSION}/{media_id}", headers=h)
        url = (r.json() or {}).get("url") if r.status_code == 200 else None
        if not url:
            return None
        r2 = await hc.get(url, headers=h)
        return r2.content if r2.status_code == 200 else None


async def _cache_media(mid: str, media: dict):
    try:
        content = await _download_meta_media(media["id"])
        if content:
            gid = await bucket.upload_from_stream(media.get("filename") or "media", content, metadata={"content_type": media.get("mime")})
            await MSG.update_one({"id": mid}, {"$set": {"media.gridfs_id": str(gid)}})
    except Exception as e:
        logger.warning(f"inbox media cache failed: {e}")


# ------------------------------------------------------------------ access helpers
def _role(user):
    role, uid = _ctx(user)
    if role not in INBOX_ROLES:
        raise HTTPException(status_code=403, detail="WhatsApp Inbox access is limited to Admin, Operations, Processors and Growth Partners")
    return role, uid


async def _proc_lead_ids(uid):
    return await db.meta_leads.distinct("lead_id", {"assigned_processor_id": uid, **NOT_DELETED})


async def _scope(role, uid) -> dict:
    if role == "processor":
        return {"$or": [{"assigned_processor_id": uid}, {"lead_id": {"$in": await _proc_lead_ids(uid)}}]}
    if role == "growth_partner":
        return {"lead_id": {"$in": await db.meta_leads.distinct("lead_id", {"assigned_partner_id": uid, **NOT_DELETED})}}
    return {}


async def _conv_or_403(conv_id, user):
    role, uid = _role(user)
    conv = await CONV.find_one({"id": conv_id, **(await _scope(role, uid))}, {"_id": 0})
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conv, role, uid


def _sender(user, role):
    return {"id": user.get("meta_user_id") or user.get("id"), "name": user.get("name"), "role": role}


async def _audit(user, action, **kw):
    await AUDIT.insert_one({"at": _iso(), "user_id": user.get("meta_user_id") or user.get("id"), "user_name": user.get("name"),
                            "action": action, **kw})


def _rate_check(user):
    k, now = user.get("id"), time.time()
    hits = [t for t in _rate.get(k, []) if now - t < 60]
    if len(hits) >= 30:
        raise HTTPException(status_code=429, detail="Too many messages — wait a minute")
    _rate[k] = hits + [now]


def _window_open(conv) -> bool:
    li = conv.get("last_inbound_at")
    return bool(li) and datetime.fromisoformat(li) > datetime.now(timezone.utc) - WINDOW


async def _opted_out(wa_number) -> bool:
    return bool(await cc_core.CUST.find_one({"wa_number": wa_number, "consent.status": "opted_out"}, {"_id": 1}))


async def _graph(payload: dict) -> dict:
    if not wa._send_configured():
        return {"ok": False, "error": "WhatsApp not configured"}
    for attempt in range(2):
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(20.0)) as hc:
                r = await hc.post(wa.GRAPH_URL, json={"messaging_product": "whatsapp", "recipient_type": "individual", **payload},
                                  headers={"Authorization": f"Bearer {wa.ACCESS_TOKEN}"})
            data = r.json() if r.content else {}
            break
        except Exception as e:
            if attempt:
                return {"ok": False, "error": f"network error: {str(e)[:120] or type(e).__name__}"}
    if r.status_code == 200 and (data.get("messages") or [{}])[0].get("id"):
        return {"ok": True, "wamid": data["messages"][0]["id"]}
    err = data.get("error") or {}
    det = (err.get("error_data") or {}).get("details")
    return {"ok": False, "error": f"{err.get('code') or r.status_code}: {err.get('message') or 'send failed'}" + (f" — {det}" if det else "")}


async def _upload_meta(content: bytes, mime: str, filename: str) -> Optional[str]:
    async with httpx.AsyncClient(timeout=60) as hc:
        r = await hc.post(f"https://graph.facebook.com/{wa.GRAPH_VERSION}/{wa.PHONE_NUMBER_ID}/media",
                          headers={"Authorization": f"Bearer {wa.ACCESS_TOKEN}"},
                          data={"messaging_product": "whatsapp", "type": mime}, files={"file": (filename, content, mime)})
    return (r.json() or {}).get("id") if r.status_code == 200 else None


async def _finish_send(m: dict, res: dict):
    s = {"status": "accepted", "wamid": res["wamid"], "sent_at": _iso()} if res.get("ok") else {"status": "failed", "error": res.get("error")}
    try:
        await MSG.update_one({"id": m["id"]}, {"$set": s})
    except DuplicateKeyError:
        pass
    return {**m, **s}


# ------------------------------------------------------------------ list / detail
@router.get("/conversations")
async def list_conversations(filter: str = "all", q: str = "", processor: str = "", gp: str = "", lead_status: str = "",
                             source: str = "", template: str = "", date_from: str = "", date_to: str = "",
                             page: int = 1, limit: int = 25, user: dict = Depends(require_meta_access)):
    role, uid = _role(user)
    conds = [await _scope(role, uid)]
    f = {"mine": {"assigned_processor_id": uid}, "unassigned": {"assigned_processor_id": None},
         "unread": {"unread_count": {"$gt": 0}}, "waiting_customer": {"status": "waiting_customer"},
         "waiting_team": {"status": "waiting_team"}, "resolved": {"status": "resolved"}, "unmatched": {"lead_id": None}}.get(filter)
    if f:
        conds.append(f)
    if q.strip():
        rx = {"$regex": re.escape(q.strip().replace("+", "")), "$options": "i"}
        conds.append({"$or": [{"customer_name": rx}, {"profile_name": rx}, {"wa_number": rx}]})
    if processor:
        conds.append({"assigned_processor_id": None if processor == "UNASSIGNED" else processor})
    if gp or lead_status:
        lq = {**NOT_DELETED, **({"assigned_partner_id": gp} if gp else {}),
              **({"$or": [{"status": lead_status}, {"processing_status": lead_status}]} if lead_status else {})}
        conds.append({"lead_id": {"$in": await db.meta_leads.distinct("lead_id", lq)}})
    if source:
        conds.append({"sources": source})
    if template:
        conds.append({"templates": template})
    if date_from:
        conds.append({"last_message_at": {"$gte": date_from}})
    if date_to:
        conds.append({"last_message_at": {"$lte": date_to + "T23:59:59"}})
    query = {"$and": [c for c in conds if c]} if any(conds) else {}
    limit = max(1, min(limit, 100))
    total = await CONV.count_documents(query)
    items = await CONV.find(query, {"_id": 0}).sort("last_message_at", -1).skip((max(page, 1) - 1) * limit).limit(limit).to_list(limit)
    return {"items": items, "total": total, "page": page, "limit": limit}


@router.get("/reply-alerts")
async def reply_alerts(user: dict = Depends(require_meta_access)):
    role, uid = _ctx(user)
    if role not in INBOX_ROLES:
        return {"items": [], "count": 0}
    q = {"unread_count": {"$gt": 0}, "status": {"$ne": "resolved"}, **(await _scope(role, uid))}
    items = await CONV.find(q, {"_id": 0, "id": 1, "lead_id": 1, "customer_name": 1, "profile_name": 1, "wa_number": 1,
                                "last_preview": 1, "unread_count": 1, "last_inbound_at": 1}).sort("last_inbound_at", -1).limit(30).to_list(30)
    return {"items": items, "count": await CONV.count_documents(q)}


@router.get("/unread-summary")
async def unread_summary(user: dict = Depends(require_meta_access)):
    role, uid = _ctx(user)
    if role not in INBOX_ROLES:
        return {"conversations": 0}
    q = {"unread_count": {"$gt": 0}, **(await _scope(role, uid))}
    return {"conversations": await CONV.count_documents(q)}


class LeadIds(BaseModel):
    lead_ids: list[str]


@router.post("/unread-by-leads")
async def unread_by_leads(inp: LeadIds, user: dict = Depends(require_meta_access)):
    role, uid = _role(user)
    q = {"lead_id": {"$in": inp.lead_ids[:200]}, **(await _scope(role, uid))}
    return {c["lead_id"]: c.get("unread_count", 0) async for c in CONV.find(q, {"_id": 0, "lead_id": 1, "unread_count": 1})}


async def _customer(conv):
    lead = await db.meta_leads.find_one({"lead_id": conv["lead_id"]}, {"_id": 0, "activities": 0, "call_logs": 0, "notes": 0}) if conv.get("lead_id") else None
    if not lead:
        return None
    from routes.chatbot_integration import _compute_stage
    prof = await db.meta_chatbot_qualifications.find_one({"crm_lead_ref": lead["lead_id"]}) or {}
    q = prof.get("qualification") or {}
    f = lead.get("file") or {}
    return {"lead_id": lead["lead_id"], "full_name": lead.get("full_name"), "phone": lead.get("phone"), "status": lead.get("status"),
            "processing_status": lead.get("processing_status"), "assigned_partner_name": lead.get("assigned_partner_name"),
            "assigned_processor_name": lead.get("assigned_processor_name"), "source": lead.get("source_tab") or lead.get("platform"),
            "campaign_name": lead.get("campaign_name"), "employment": lead.get("employment_status") or f.get("employment_type"),
            "company_name": f.get("company_name") or q.get("company_name"), "salary": lead.get("monthly_salary") or q.get("net_monthly_salary"),
            "cibil_score": lead.get("cibil_score") or f.get("cibil_score"), "chatbot_stage": _compute_stage(prof)["stage"] if prof else "No link",
            "credit_report_status": q.get("credit_report_status"), "payslip_status": q.get("payslip_status"),
            "last_activity": lead.get("updated_at")}


@router.get("/conversations/{conv_id}")
async def get_conversation(conv_id: str, user: dict = Depends(require_meta_access)):
    conv, role, _ = await _conv_or_403(conv_id, user)
    msgs = await MSG.find({"conv_id": conv_id}, {"_id": 0}).sort("created_at", 1).to_list(2000)
    bot = await db.wa_bot_sessions.find_one({"conv_id": conv_id}, {"_id": 0, "status": 1, "step": 1, "paused_reason": 1})
    return {"conversation": conv, "messages": msgs, "customer": await _customer(conv), "window_open": _window_open(conv), "bot": bot,
            "opted_out": await _opted_out(conv["wa_number"]), "role": role}


@router.post("/conversations/{conv_id}/read")
async def mark_read(conv_id: str, user: dict = Depends(require_meta_access)):
    await _conv_or_403(conv_id, user)
    await CONV.update_one({"id": conv_id}, {"$set": {"unread_count": 0}})
    return {"ok": True}


async def _lead_access(lead_id, user):
    role, uid = _role(user)
    lead = await db.meta_leads.find_one({"lead_id": lead_id, **NOT_DELETED})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    conv = await CONV.find_one({"lead_id": lead_id}, {"_id": 0})
    if role == "processor" and lead.get("assigned_processor_id") != uid and (conv or {}).get("assigned_processor_id") != uid:
        raise HTTPException(status_code=403, detail="Not authorized for this lead")
    if role == "growth_partner" and lead.get("assigned_partner_id") != uid:
        raise HTTPException(status_code=403, detail="Not authorized for this lead")
    return lead, conv


@router.get("/leads/{lead_id}/conversation")
async def lead_conversation(lead_id: str, user: dict = Depends(require_meta_access)):
    lead, conv = await _lead_access(lead_id, user)
    if not conv:
        rec = wa._to_recipient(lead.get("phone") or "")
        conv = await CONV.find_one({"wa_number": rec, "phone_number_id": wa.PHONE_NUMBER_ID}, {"_id": 0}) if rec else None
    return {"conversation": conv}


@router.post("/leads/{lead_id}/conversation")
async def start_conversation(lead_id: str, user: dict = Depends(require_meta_access)):
    lead, conv = await _lead_access(lead_id, user)
    if conv:
        return {"conversation": conv}
    rec = wa._to_recipient(lead.get("phone") or "")
    if not rec:
        raise HTTPException(status_code=422, detail="Lead has no valid WhatsApp number")
    return {"conversation": _clean(await get_conv(rec, lead))}


# ------------------------------------------------------------------ sending
class TextIn(BaseModel):
    text: str
    client_id: str


@router.post("/conversations/{conv_id}/messages")
async def send_text(conv_id: str, inp: TextIn, user: dict = Depends(require_meta_access)):
    conv, role, _ = await _conv_or_403(conv_id, user)
    if not inp.text.strip():
        raise HTTPException(status_code=422, detail="Message is empty")
    if not _window_open(conv):
        raise HTTPException(status_code=422, detail="Customer service window expired. Select an approved WhatsApp template to continue.")
    existing = await MSG.find_one({"client_id": inp.client_id, "conv_id": conv_id}, {"_id": 0})
    if existing:
        return existing
    _rate_check(user)
    m = await log_outbound(conv["wa_number"], source="staff", type_="text", text=inp.text.strip()[:4096], status="sending",
                           sender=_sender(user, role), client_id=inp.client_id)
    if not m:
        return await MSG.find_one({"client_id": inp.client_id, "conv_id": conv_id}, {"_id": 0})
    from routes import wa_bot
    await wa_bot.pause_for_staff(conv_id, user.get("name"))
    res = await _graph({"to": conv["wa_number"], "type": "text", "text": {"body": m["text"], "preview_url": True}})
    await _audit(user, "send_text", conv_id=conv_id, ok=res.get("ok"))
    return _clean(await _finish_send(m, res))


@router.post("/conversations/{conv_id}/attachments")
async def send_attachment(conv_id: str, client_id: str = Form(...), caption: str = Form(""), file: UploadFile = File(...),
                          user: dict = Depends(require_meta_access)):
    conv, role, _ = await _conv_or_403(conv_id, user)
    if not _window_open(conv):
        raise HTTPException(status_code=422, detail="Customer service window expired. Select an approved WhatsApp template to continue.")
    existing = await MSG.find_one({"client_id": client_id, "conv_id": conv_id}, {"_id": 0})
    if existing:
        return existing
    _rate_check(user)
    content = await file.read()
    if len(content) > MAX_UPLOAD:
        raise HTTPException(status_code=413, detail="File too large (max 16 MB)")
    mime = file.content_type or "application/octet-stream"
    kind = "image" if mime in ("image/jpeg", "image/png") else "audio" if mime.startswith("audio/") else \
        "video" if mime in ("video/mp4", "video/3gpp") else "document"
    gid = await bucket.upload_from_stream(file.filename or "file", content, metadata={"content_type": mime})
    media = {"kind": "gridfs", "gridfs_id": str(gid), "mime": mime, "filename": file.filename, "caption": caption}
    m = await log_outbound(conv["wa_number"], source="staff", type_=kind, text=caption, media=media, status="sending",
                           sender=_sender(user, role), client_id=client_id)
    if not m:
        raise HTTPException(status_code=409, detail="Duplicate send")
    mid = await _upload_meta(content, mime, file.filename or "file") if wa._send_configured() else None
    if not mid:
        return _clean(await _finish_send(m, {"ok": False, "error": "media upload to WhatsApp failed"}))
    body = {"id": mid, **({"caption": caption} if caption and kind in ("image", "video", "document") else {}),
            **({"filename": file.filename} if kind == "document" else {})}
    from routes import wa_bot
    await wa_bot.pause_for_staff(conv_id, user.get("name"))
    res = await _graph({"to": conv["wa_number"], "type": kind, kind: body})
    await _audit(user, "send_attachment", conv_id=conv_id, ok=res.get("ok"))
    return _clean(await _finish_send(m, res))


@router.post("/messages/{msg_id}/retry")
async def retry_message(msg_id: str, user: dict = Depends(require_meta_access)):
    m = await MSG.find_one({"id": msg_id}, {"_id": 0})
    if not m or m.get("status") != "failed" or m.get("source") != "staff" or m.get("type") != "text":
        raise HTTPException(status_code=422, detail="Only failed staff text messages can be retried")
    conv, _, _ = await _conv_or_403(m["conv_id"], user)
    if not _window_open(conv):
        raise HTTPException(status_code=422, detail="Customer service window expired. Select an approved WhatsApp template to continue.")
    claimed = await MSG.find_one_and_update({"id": msg_id, "status": "failed"}, {"$set": {"status": "sending", "error": None}})
    if not claimed:
        raise HTTPException(status_code=409, detail="Already retrying")
    res = await _graph({"to": conv["wa_number"], "type": "text", "text": {"body": m["text"], "preview_url": True}})
    await _audit(user, "retry", msg_id=msg_id, ok=res.get("ok"))
    return _clean(await _finish_send(m, res))


@router.get("/templates")
async def templates(user: dict = Depends(require_meta_access)):
    _role(user)
    return await cc_core.TPL.find({"sendable": True}, {"_id": 0}).sort("name", 1).to_list(500)


@router.post("/conversations/{conv_id}/template")
async def send_template(conv_id: str, payload: str = Form(...), file: Optional[UploadFile] = File(None),
                        user: dict = Depends(require_meta_access)):
    conv, role, _ = await _conv_or_403(conv_id, user)
    try:
        p = json.loads(payload)
    except ValueError:
        raise HTTPException(status_code=422, detail="Invalid payload")
    tpl = await _tpl(p.get("name"), p.get("language"))
    if not tpl or not tpl.get("sendable"):
        raise HTTPException(status_code=422, detail="Template is not approved")
    if tpl.get("category") == "MARKETING" and await _opted_out(conv["wa_number"]):
        raise HTTPException(status_code=422, detail="Customer has opted out of marketing messages")
    existing = await MSG.find_one({"client_id": p.get("client_id"), "conv_id": conv_id}, {"_id": 0}) if p.get("client_id") else None
    if existing:
        return existing
    values = {k: wa.clean_param(v) for k, v in (p.get("values") or {}).items()}
    btn_values = {str(k): wa.clean_param(v) for k, v in (p.get("buttons") or {}).items()}
    missing = [v for v in tpl.get("header_vars", []) + tpl.get("body_vars", []) if not values.get(v)] + \
              [b["text"] for b in tpl.get("button_vars", []) if not btn_values.get(str(b["index"]))]
    if missing:
        raise HTTPException(status_code=422, detail=f"Fill all template fields: {', '.join(missing)}")
    _rate_check(user)
    ht, media_id, hdr = tpl.get("header_type"), None, None
    if ht in ("IMAGE", "VIDEO", "DOCUMENT"):
        if file:
            content = await file.read()
            if len(content) > MAX_UPLOAD:
                raise HTTPException(status_code=413, detail="File too large (max 16 MB)")
            mime = file.content_type or "image/jpeg"
            gid = await bucket.upload_from_stream(file.filename or "header", content, metadata={"content_type": mime})
            hdr = {"type": ht.lower(), "ref_kind": "wa_media", "ref": str(gid)}
            media_id = await _upload_meta(content, mime, file.filename or "header") if wa._send_configured() else None
        elif (tpl["name"] == wa.TEMPLATE_NAME or tpl["name"] in wa.PREFERRED_WELCOMES) and wa.HEADER_IMAGE_PATH:
            hdr = {"type": "image", "ref_kind": "welcome"}
            media_id = await wa._header_media_id() if wa._send_configured() else None
        else:
            raise HTTPException(status_code=422, detail=f"This template needs a {ht.lower()} header — attach one")
    var_map = {**{k: {"value": v} for k, v in values.items()}, **{f"button_{k}": {"value": v} for k, v in btn_values.items()}}
    text, btns = render(tpl, values, btn_values)
    m = await log_outbound(conv["wa_number"], source="staff_template", type_="template", text=text, header=hdr, buttons=btns,
                           template={"name": tpl["name"], "language": tpl.get("language"), "category": tpl.get("category"),
                                     "values": values, "button_params": btn_values},
                           status="sending", sender=_sender(user, role), client_id=p.get("client_id"))
    if ht in ("IMAGE", "VIDEO", "DOCUMENT") and not media_id:
        return _clean(await _finish_send(m, {"ok": False, "error": "header media upload failed"}))
    from routes import wa_bot
    await wa_bot.pause_for_staff(conv_id, user.get("name"))
    res = await cc_core.graph_send(conv["wa_number"], tpl, cc_core.build_components(tpl, var_map, {}, media_id)) \
        if wa._send_configured() else {"ok": False, "error": "WhatsApp not configured"}
    await _audit(user, "send_template", conv_id=conv_id, template=tpl["name"], ok=res.get("ok"))
    return _clean(await _finish_send(m, res))


@router.post("/conversations/{conv_id}/bot/{action}")
async def bot_control(conv_id: str, action: str, user: dict = Depends(require_meta_access)):
    conv, _, _ = await _conv_or_403(conv_id, user)
    from routes import wa_bot
    if action == "pause":
        await wa_bot.pause_for_staff(conv_id, user.get("name"))
    elif action == "resume":
        if not _window_open(conv):
            raise HTTPException(status_code=422, detail="Customer service window expired — the bot can resume only after the customer replies.")
        res = await wa_bot.resume(conv)
        if not res.get("ok"):
            raise HTTPException(status_code=422, detail=res.get("error") or "Resume failed")
    else:
        raise HTTPException(status_code=404, detail="Unknown action")
    await _audit(user, f"bot_{action}", conv_id=conv_id)
    return await db.wa_bot_sessions.find_one({"conv_id": conv_id}, {"_id": 0, "status": 1, "step": 1, "paused_reason": 1})


FUNNEL = [("welcome_sent", "Welcome sent"), ("started", "Tapped Yes, Continue"), ("employment", "Answered employment type"),
          ("details", "Finished employment questions"), ("report_q", "Answered credit report question"),
          ("report_uploaded", "Uploaded credit report"), ("cibil", "Answered CIBIL score"), ("loans", "Answered loan questions"),
          ("completed", "Completed")]


@router.get("/bot-funnel")
async def bot_funnel(user: dict = Depends(require_meta_access)):
    role, uid = _role(user)
    lq = {**NOT_DELETED}
    if role == "processor":
        lq["assigned_processor_id"] = uid
    elif role == "growth_partner":
        lq["assigned_partner_id"] = uid
    scoped = role in ("processor", "growth_partner")
    sq = {"lead_id": {"$in": await db.meta_leads.distinct("lead_id", lq)}} if scoped else {}
    c = {k: 0 for k, _ in FUNNEL}
    c["welcome_sent"] = await MSG.count_documents({"source": "welcome", "template.name": wa.PREFERRED_WELCOME, "status": {"$ne": "failed"}, **sq})
    stopped_at, states = {}, {"paused": 0, "stopped": 0, "abandoned": 0, "active": 0}
    async for s in db.wa_bot_sessions.find(sq, {"_id": 0, "answers": 1, "status": 1, "step": 1}):
        a, st = s.get("answers") or {}, s.get("status")
        c["started"] += 1
        c["employment"] += "employment_type" in a
        c["details"] += "credit_report_status" in a or st == "completed"
        c["report_q"] += a.get("credit_report_status") not in (None, "awaiting_upload", "needs_help")
        c["report_uploaded"] += a.get("credit_report_status") == "received_pending_review"
        c["cibil"] += "cibil_score" in a
        c["loans"] += "number_of_loans" in a
        c["completed"] += st == "completed"
        if st != "completed" and s.get("step"):
            stopped_at[s["step"]] = stopped_at.get(s["step"], 0) + 1
            if st in states:
                states[st] += 1
    drop = sorted(({"step": k, "count": v} for k, v in stopped_at.items()), key=lambda x: -x["count"])
    return {"steps": [{"key": k, "label": lbl, "count": c[k]} for k, lbl in FUNNEL], "stopped_at": drop, "states": states}


@router.get("/leads/{lead_id}/bot-qualification")
async def bot_qualification(lead_id: str, user: dict = Depends(require_meta_access)):
    await _lead_access(lead_id, user)
    return {"session": await db.wa_bot_sessions.find_one({"lead_id": lead_id}, {"_id": 0})}


# ------------------------------------------------------------------ notes / assignment / status / link
class NoteIn(BaseModel):
    text: str


@router.post("/conversations/{conv_id}/notes")
async def add_note(conv_id: str, inp: NoteIn, user: dict = Depends(require_meta_access)):
    conv, role, _ = await _conv_or_403(conv_id, user)
    if not inp.text.strip():
        raise HTTPException(status_code=422, detail="Note is empty")
    m = {"id": uuid.uuid4().hex, "conv_id": conv_id, "wa_number": conv["wa_number"], "lead_id": conv.get("lead_id"),
         "direction": "note", "source": "note", "type": "note", "text": inp.text.strip()[:2000],
         "sender": _sender(user, role), "status": "internal", "created_at": _iso()}
    await MSG.insert_one(dict(m))
    await _audit(user, "note", conv_id=conv_id)
    return m


class AssignIn(BaseModel):
    processor_id: Optional[str] = None


@router.post("/conversations/{conv_id}/assign")
async def assign(conv_id: str, inp: AssignIn, user: dict = Depends(require_meta_access)):
    _, role, _ = await _conv_or_403(conv_id, user)
    if role not in ("admin", "ops"):
        raise HTTPException(status_code=403, detail="Only Admin and Operations can assign conversations")
    name = None
    if inp.processor_id:
        p = await db.meta_users.find_one({"user_id": inp.processor_id, "role": "processor"}, {"name": 1})
        if not p:
            raise HTTPException(status_code=404, detail="Processor not found")
        name = p.get("name")
    await CONV.update_one({"id": conv_id}, {"$set": {"assigned_processor_id": inp.processor_id or None, "assigned_processor_name": name}})
    await _audit(user, "assign", conv_id=conv_id, processor_id=inp.processor_id)
    return await CONV.find_one({"id": conv_id}, {"_id": 0})


class StatusIn(BaseModel):
    status: str


@router.post("/conversations/{conv_id}/status")
async def set_status(conv_id: str, inp: StatusIn, user: dict = Depends(require_meta_access)):
    await _conv_or_403(conv_id, user)
    if inp.status not in ("waiting_team", "waiting_customer", "resolved"):
        raise HTTPException(status_code=422, detail="Invalid status")
    await CONV.update_one({"id": conv_id}, {"$set": {"status": inp.status, **({"unread_count": 0} if inp.status == "resolved" else {})}})
    await _audit(user, "status", conv_id=conv_id, status=inp.status)
    return await CONV.find_one({"id": conv_id}, {"_id": 0})


class LinkIn(BaseModel):
    lead_id: str


@router.post("/conversations/{conv_id}/link")
async def link_lead(conv_id: str, inp: LinkIn, user: dict = Depends(require_meta_access)):
    _, role, _ = await _conv_or_403(conv_id, user)
    if role not in ("admin", "ops"):
        raise HTTPException(status_code=403, detail="Only Admin and Operations can link conversations")
    lead = await db.meta_leads.find_one({"lead_id": inp.lead_id, **NOT_DELETED})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    if await CONV.find_one({"lead_id": inp.lead_id, "id": {"$ne": conv_id}}, {"_id": 1}):
        raise HTTPException(status_code=409, detail="This lead already has a WhatsApp conversation")
    await CONV.update_one({"id": conv_id}, {"$set": {"lead_id": inp.lead_id, "customer_name": lead.get("full_name")}})
    await MSG.update_many({"conv_id": conv_id}, {"$set": {"lead_id": inp.lead_id}})
    await _audit(user, "link", conv_id=conv_id, lead_id=inp.lead_id)
    return await CONV.find_one({"id": conv_id}, {"_id": 0})


@router.get("/lead-search")
async def lead_search(q: str, user: dict = Depends(require_meta_access)):
    if _role(user)[0] not in ("admin", "ops"):
        raise HTTPException(status_code=403, detail="Not authorized")
    rx = {"$regex": re.escape(q.strip()), "$options": "i"}
    return await db.meta_leads.find({**NOT_DELETED, "$or": [{"full_name": rx}, {"phone_norm": rx}]},
                                    {"_id": 0, "lead_id": 1, "full_name": 1, "phone": 1, "status": 1}).limit(10).to_list(10)


# ------------------------------------------------------------------ quick replies
class QuickIn(BaseModel):
    title: str
    text: str


@router.get("/quick-replies")
async def list_quick(user: dict = Depends(require_meta_access)):
    _role(user)
    return await QR.find({}, {"_id": 0}).sort("title", 1).to_list(200)


@router.post("/quick-replies")
async def add_quick(inp: QuickIn, user: dict = Depends(require_meta_access)):
    role, _ = _role(user)
    if role not in ("admin", "ops"):
        raise HTTPException(status_code=403, detail="Only Admin and Operations can manage quick replies")
    d = {"id": uuid.uuid4().hex, "title": inp.title.strip()[:60], "text": inp.text.strip()[:1000], "created_by": user.get("name"), "created_at": _iso()}
    await QR.insert_one(dict(d))
    return d


@router.delete("/quick-replies/{qid}")
async def del_quick(qid: str, user: dict = Depends(require_meta_access)):
    role, _ = _role(user)
    if role not in ("admin", "ops"):
        raise HTTPException(status_code=403, detail="Only Admin and Operations can manage quick replies")
    await QR.delete_one({"id": qid})
    return {"ok": True}


# ------------------------------------------------------------------ authorized media
@router.get("/messages/{msg_id}/media")
async def message_media(msg_id: str, part: str = Query("media"), user: dict = Depends(require_meta_access)):
    m = await MSG.find_one({"id": msg_id}, {"_id": 0})
    if not m:
        raise HTTPException(status_code=404, detail="Not found")
    await _conv_or_403(m["conv_id"], user)
    from bson import ObjectId
    if part == "header":
        h = m.get("header") or {}
        if h.get("ref_kind") == "welcome":
            if not wa.HEADER_IMAGE_PATH:
                raise HTTPException(status_code=404, detail="Header not available")
            path = wa.HEADER_IMAGE_PATH if os.path.isabs(wa.HEADER_IMAGE_PATH) else \
                os.path.join(os.path.dirname(os.path.dirname(__file__)), wa.HEADER_IMAGE_PATH)
            if not os.path.exists(path):
                raise HTTPException(status_code=404, detail="Header not available")
            with open(path, "rb") as f:
                return Response(f.read(), media_type="image/png")
        if not h.get("ref"):
            raise HTTPException(status_code=404, detail="Header not available")
        bk = cc_core.media_bucket if h.get("ref_kind") == "cc_media" else bucket
        s = await bk.open_download_stream(ObjectId(h["ref"]))
        return Response(await s.read(), media_type=(s.metadata or {}).get("content_type") or "image/jpeg")
    md = m.get("media") or {}
    if md.get("gridfs_id"):
        s = await bucket.open_download_stream(ObjectId(md["gridfs_id"]))
        return Response(await s.read(), media_type=md.get("mime") or "application/octet-stream")
    content = await _download_meta_media(md.get("id")) if md.get("id") else None
    if not content:
        raise HTTPException(status_code=404, detail="Media no longer available")
    return Response(content, media_type=md.get("mime") or "application/octet-stream")
