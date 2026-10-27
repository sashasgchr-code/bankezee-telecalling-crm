"""Customers & Campaigns core: customer sync from approved/disbursed files, eligibility, template payloads,
mock/live sending through the existing Meta Cloud API credentials, campaign + birthday worker, webhook hooks."""
import os
import re
import hashlib
import asyncio
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional

import httpx
from motor.motor_asyncio import AsyncIOMotorGridFSBucket
from pymongo import ReturnDocument

from utils.database import db
from routes import whatsapp as wa

logger = logging.getLogger("customers_campaigns")
IST = timezone(timedelta(hours=5, minutes=30))
CUST, CAMP, MSG, TPL, AUDIT = db.cc_customers, db.cc_campaigns, db.cc_messages, db.cc_templates, db.cc_audit
SETTINGS_KEY = "cc_settings"
OPT_OUT_WORDS = {"stop", "unsubscribe", "stop all", "opt out", "optout", "stop messages", "cancel subscription"}
STATUS_RANK = {"queued": 0, "sending": 1, "submitted": 2, "sent": 3, "delivered": 4, "read": 5}
DEFAULT_TYPES = ["Diwali Wishes", "Dussehra Wishes", "Christmas Wishes", "New Year Wishes", "Sankranti Wishes", "Ugadi Wishes",
                 "Holi Wishes", "Eid Wishes", "Ganesh Chaturthi Wishes", "Independence Day", "Republic Day", "Birthday Wishes",
                 "Anniversary Wishes", "Loan Consolidation Promotion", "Home Loan Balance Transfer", "Personal Loan Offers",
                 "Business Loan Offers", "Customer Appreciation", "Referral Campaign", "General Promotion", "Custom Campaign"]
DEFAULT_SETTINGS = {
    "key": SETTINGS_KEY, "live_sending": False, "test_number": "", "price_per_message": None,
    "campaign_types": DEFAULT_TYPES,
    "birthday": {"enabled": False, "template": "", "language": "", "var_map": {}, "media_ref": None,
                 "send_time": "10:00", "feb29_policy": "feb28", "catch_up": "none", "last_run_date": None},
}
media_bucket = AsyncIOMotorGridFSBucket(db, bucket_name="cc_media")


def now_utc():
    return datetime.now(timezone.utc)


def iso(dt=None):
    return (dt or now_utc()).isoformat()


def ist_now():
    return now_utc().astimezone(IST)


async def get_settings() -> dict:
    s = await db.app_settings.find_one({"key": SETTINGS_KEY}, {"_id": 0})
    if not s:
        s = dict(DEFAULT_SETTINGS)
        await db.app_settings.insert_one(dict(s))
        s.pop("_id", None)
    merged = {**DEFAULT_SETTINGS, **s}
    merged["birthday"] = {**DEFAULT_SETTINGS["birthday"], **(s.get("birthday") or {})}
    return merged


async def ensure_indexes():
    await MSG.create_index("dedupe_key", unique=True)
    await MSG.create_index("wamid", sparse=True)
    await MSG.create_index([("campaign_id", 1), ("status", 1)])
    await MSG.create_index("customer_id")
    await CUST.create_index("customer_id", unique=True)
    await CUST.create_index("wa_number")


async def audit(action: str, user: Optional[dict], **details):
    await AUDIT.insert_one({"action": action, "by_id": (user or {}).get("id"), "by_name": (user or {}).get("name") or "system",
                            "at": iso(), **details})


# ------------------------------------------------------------------ helpers
def phone10(raw) -> str:
    d = re.sub(r"\D", "", str(raw or ""))
    return d[-10:] if len(d) >= 10 else ""


def name_norm(n) -> str:
    return re.sub(r"[^a-z]", "", str(n or "").lower())


def num(v) -> Optional[float]:
    try:
        s = re.sub(r"[^\d.]", "", str(v)) if v not in (None, "") else ""
        return float(s) if s else None
    except ValueError:
        return None


def _yes(v) -> bool:
    return v is True or (isinstance(v, str) and v.strip().lower() in ("yes", "true"))


def _status_change_at(acts, status) -> Optional[str]:
    for a in acts or []:
        if a.get("type") == "status_change" and (a.get("to_status") == status or (a.get("message") or "").lower().endswith(f"to {status}")):
            return a.get("timestamp")
    return None


def _meta_status_at(acts, status) -> Optional[str]:
    for a in acts or []:
        if a.get("type") == "processing" and f"set to '{status}'" in (a.get("detail") or ""):
            return a.get("at")
    return None


def _date_only(v) -> Optional[str]:
    return str(v)[:10] if v else None


# ------------------------------------------------------------------ customer sync
async def sync_customers() -> dict:
    """Rebuild loan rows from the files (source of truth). DOB/consent/history fields are never overwritten."""
    users = {u["id"]: u for u in await db.users.find({}, {"_id": 0, "id": 1, "name": 1, "meta_user_id": 1}).to_list(5000) if u.get("id")}
    meta_to_connect = {u["meta_user_id"]: uid for uid, u in users.items() if u.get("meta_user_id")}
    uname = lambda i: (users.get(i) or {}).get("name") if i else None  # noqa: E731
    groups = {}

    def add(file_name, phone, loan):
        p = phone10(phone)
        key = f"{p}|{name_norm(file_name)}" if p else f"file|{loan['source']}:{loan['file_id']}"
        g = groups.setdefault(key, {"names": [], "phone": phone, "loans": []})
        g["names"].append(file_name)
        g["loans"].append(loan)

    async for f in db.leads.find({"status": "file"}, {"_id": 1, "id": 1, "name": 1, "phone": 1, "eligibilities": 1, "file_status": 1,
                                                       "source_id": 1, "assigned_to": 1, "file_assigned_to": 1, "file_activities": 1,
                                                       "requirement": 1, "additional_data.type_of_loan": 1}):
        fid = f.get("id") or str(f["_id"])  # some legacy file docs have no `id` field
        rows = [e for e in (f.get("eligibilities") or []) if isinstance(e, dict)
                and (e.get("approval_status") == "approved" or _yes(e.get("disbursed")))]
        fs = f.get("file_status")
        gp = f.get("source_id") or f.get("assigned_to")
        proc = f.get("file_assigned_to")
        ltype = (f.get("additional_data") or {}).get("type_of_loan") or f.get("requirement") or ""
        base = {"source": "connect", "file_id": fid, "loan_type": str(ltype).replace("_", " ").title(),
                "gp_id": gp, "gp_name": uname(gp), "processor_id": proc, "processor_name": uname(proc)}
        acts = f.get("file_activities")
        if not rows and fs in ("approved", "disbursed"):
            rows = [{"_file_level": True}]
        for i, e in enumerate(rows):
            disb = _yes(e.get("disbursed")) or (e.get("_file_level") and fs == "disbursed")
            appr_at = e.get("approved_at") or _status_change_at(acts, "approved")
            disb_at = (e.get("disbursed_at") or e.get("disbursal_date") or _status_change_at(acts, "disbursed")) if disb else None
            add(f.get("name"), f.get("phone"), {**base, "loan_key": f"connect:{fid}:{i}",
                "bank": e.get("disbursed_bank") or e.get("approved_bank") or e.get("bank_name") or "",
                "status": "Disbursed" if disb else "Approved",
                "approval_date": _date_only(appr_at), "approval_date_source": "bank row" if e.get("approved_at") else ("status history" if appr_at else None),
                "approved_amount": num(e.get("approved_amount")),
                "disbursement_date": _date_only(disb_at), "disbursed_amount": num(e.get("disbursed_amount")) if disb else None})

    async for d in db.meta_leads.find({"status": "FILE", "deleted": {"$ne": True}}, {"_id": 0, "lead_id": 1, "full_name": 1, "phone": 1, "file": 1,
                                       "processing_status": 1, "assigned_partner_id": 1, "assigned_processor_id": 1, "activities": 1}):
        banks = [b for b in ((d.get("file") or {}).get("banks") or []) if b.get("approval_status") == "Approved" or b.get("disbursed") == "Yes"]
        ps = d.get("processing_status")
        if not banks and ps in ("Approved", "Disbursed"):
            banks = [{"_file_level": True}]
        gp = meta_to_connect.get(d.get("assigned_partner_id"))
        proc = meta_to_connect.get(d.get("assigned_processor_id"))
        base = {"source": "meta", "file_id": d["lead_id"], "loan_type": ((d.get("file") or {}).get("loan_type") or "").strip(),
                "gp_id": gp, "gp_name": uname(gp), "processor_id": proc, "processor_name": uname(proc)}
        for i, b in enumerate(banks):
            disb = b.get("disbursed") == "Yes" or (b.get("_file_level") and ps == "Disbursed")
            appr_at = b.get("approved_at") or _meta_status_at(d.get("activities"), "Approved")
            disb_at = (b.get("disbursed_at") or b.get("disbursal_date") or _meta_status_at(d.get("activities"), "Disbursed")) if disb else None
            add(d.get("full_name"), d.get("phone"), {**base, "loan_key": f"meta:{d['lead_id']}:{i}", "bank": (b.get("bank_name") or "").strip(),
                "status": "Disbursed" if disb else "Approved", "approval_date": _date_only(appr_at),
                "approval_date_source": "bank row" if b.get("approved_at") else ("status history" if appr_at else None),
                "approved_amount": num(b.get("approved_amount")), "disbursement_date": _date_only(disb_at),
                "disbursed_amount": num(b.get("disbursed_amount")) if disb else None})

    seen = set()
    for key, g in groups.items():
        cid = "cus_" + hashlib.sha1(key.encode()).hexdigest()[:12]
        seen.add(cid)
        name = max(g["names"], key=lambda n: len(str(n or ""))) or ""
        recipient = wa._to_recipient(g["phone"] or "")
        loans = sorted(g["loans"], key=lambda x: x["loan_key"])
        await CUST.update_one({"customer_id": cid}, {
            "$set": {"name": str(name).strip(), "phone": phone10(g["phone"]) or str(g["phone"] or ""), "wa_number": recipient,
                     "loans": loans, "active": True, "synced_at": iso(),
                     "gp_ids": sorted({x["gp_id"] for x in loans if x.get("gp_id")}),
                     "processor_ids": sorted({x["processor_id"] for x in loans if x.get("processor_id")})},
            "$setOnInsert": {"customer_id": cid, "created_at": iso(), "dob": None, "consent": {"status": "unknown"}},
        }, upsert=True)
    await CUST.update_many({"customer_id": {"$nin": list(seen)}, "active": True}, {"$set": {"active": False, "synced_at": iso()}})
    # Opt-outs stay consistent across records sharing a WhatsApp number (never auto opt-in).
    for w in await CUST.distinct("wa_number", {"consent.status": "opted_out", "wa_number": {"$ne": None}}):
        src = await CUST.find_one({"wa_number": w, "consent.status": "opted_out"}, {"consent": 1})
        await CUST.update_many({"wa_number": w, "consent.status": {"$ne": "opted_out"}}, {"$set": {"consent": src["consent"]}})
    await db.app_settings.update_one({"key": "cc_last_sync"}, {"$set": {"key": "cc_last_sync", "at": iso(), "customers": len(seen)}}, upsert=True)
    return {"customers": len(seen)}


async def maybe_sync(max_age_s=120):
    s = await db.app_settings.find_one({"key": "cc_last_sync"})
    if not s or datetime.fromisoformat(s["at"]) < now_utc() - timedelta(seconds=max_age_s):
        await sync_customers()


# ------------------------------------------------------------------ eligibility
def exclusion_reason(c: dict) -> Optional[str]:
    if not c.get("wa_number"):
        return "no valid WhatsApp number"
    st = (c.get("consent") or {}).get("status")
    if st == "opted_out":
        return "opted out"
    if st != "opted_in":
        return "no marketing consent recorded"
    return None


def birthday_matches(dob: Optional[str], day: datetime, feb29_policy: str) -> bool:
    if not dob:
        return False
    mm, dd = dob[-5:-3], dob[-2:]
    if (mm, dd) == ("02", "29") and not _is_leap(day.year):
        target = (2, 28) if feb29_policy == "feb28" else (3, 1)
        return (day.month, day.day) == target
    return (int(mm), int(dd)) == (day.month, day.day)


def _is_leap(y):
    return y % 4 == 0 and (y % 100 != 0 or y % 400 == 0)


# ------------------------------------------------------------------ templates & payloads
VAR_RE = re.compile(r"\{\{\s*([a-z0-9_]+)\s*\}\}")


def parse_template(t: dict) -> dict:
    comps = {c.get("type"): c for c in t.get("components") or []}
    header, body, footer = comps.get("HEADER") or {}, comps.get("BODY") or {}, comps.get("FOOTER") or {}
    buttons = (comps.get("BUTTONS") or {}).get("buttons") or []
    btn_vars = [{"index": i, "type": b.get("type"), "text": b.get("text"), "url": b.get("url")}
                for i, b in enumerate(buttons) if b.get("type") == "URL" and "{{" in (b.get("url") or "")]
    return {"name": t.get("name"), "language": t.get("language"), "category": t.get("category"), "status": t.get("status"),
            "header_type": header.get("format") or "NONE", "header_text": header.get("text"),
            "header_vars": VAR_RE.findall(header.get("text") or "") if header.get("format") == "TEXT" else [],
            "body": body.get("text") or "", "body_vars": list(dict.fromkeys(VAR_RE.findall(body.get("text") or ""))),
            "named_params": t.get("parameter_format") == "NAMED" or any(not v.isdigit() for v in VAR_RE.findall(body.get("text") or "")),
            "footer": footer.get("text"), "buttons": [{"type": b.get("type"), "text": b.get("text"), "url": b.get("url")} for b in buttons],
            "button_vars": btn_vars, "sendable": t.get("status") == "APPROVED", "id": t.get("id")}


async def sync_templates() -> dict:
    if not (wa.ACCESS_TOKEN and os.environ.get("META_WHATSAPP_WABA_ID")):
        raise RuntimeError("WhatsApp Business Account credentials are not configured")
    url = f"https://graph.facebook.com/{wa.GRAPH_VERSION}/{os.environ['META_WHATSAPP_WABA_ID']}/message_templates"
    params = {"fields": "name,status,category,language,components,parameter_format,id", "limit": 100}
    items = []
    async with httpx.AsyncClient(timeout=30) as hc:
        while url:
            r = await hc.get(url, params=params, headers={"Authorization": f"Bearer {wa.ACCESS_TOKEN}"})
            data = r.json()
            if r.status_code != 200:
                raise RuntimeError((data.get("error") or {}).get("message") or f"http {r.status_code}")
            items += data.get("data") or []
            url, params = (data.get("paging") or {}).get("next"), None
    synced = iso()
    keep = []
    for t in items:
        p = parse_template(t)
        keep.append(f"{p['name']}|{p['language']}")
        await TPL.update_one({"key": f"{p['name']}|{p['language']}"}, {"$set": {**p, "key": f"{p['name']}|{p['language']}", "last_synced": synced}}, upsert=True)
    await TPL.update_many({"key": {"$nin": keep}}, {"$set": {"status": "DELETED", "sendable": False, "last_synced": synced}})
    return {"count": len(items), "last_synced": synced}


def resolve_var(spec: dict, c: dict) -> str:
    src = (spec or {}).get("source")
    name = wa.clean_param(c.get("name"))
    if src == "customer_name":
        return name.split(" ")[0].title() if spec.get("first_name") else name.title()
    return wa.clean_param((spec or {}).get("value"))


def validate_mapping(tpl: dict, var_map: dict, media_ref) -> list:
    errs = []
    for v in tpl.get("header_vars", []) + tpl.get("body_vars", []):
        spec = (var_map or {}).get(v)
        if not spec or (spec.get("source") != "customer_name" and not str(spec.get("value") or "").strip()):
            errs.append(f"Variable {{{{{v}}}}} has no value")
    for b in tpl.get("button_vars", []):
        if not str(((var_map or {}).get(f"button_{b['index']}") or {}).get("value") or "").strip():
            errs.append(f"Button '{b['text']}' needs its link value")
    if tpl.get("header_type") in ("IMAGE", "VIDEO", "DOCUMENT") and not media_ref:
        errs.append(f"This template needs a {tpl['header_type'].lower()} header — upload one")
    return errs


def build_components(tpl: dict, var_map: dict, c: dict, media_id: Optional[str]) -> list:
    comps = []
    ht = tpl.get("header_type")
    if ht in ("IMAGE", "VIDEO", "DOCUMENT"):
        comps.append({"type": "header", "parameters": [{"type": ht.lower(), ht.lower(): {"id": media_id}}]})
    elif tpl.get("header_vars"):
        comps.append({"type": "header", "parameters": [{"type": "text", "text": resolve_var(var_map.get(v), c)} for v in tpl["header_vars"]]})
    if tpl.get("body_vars"):
        named = tpl.get("named_params")
        comps.append({"type": "body", "parameters": [
            {"type": "text", "text": resolve_var(var_map.get(v), c) or "Customer", **({"parameter_name": v} if named else {})}
            for v in tpl["body_vars"]]})
    for b in tpl.get("button_vars", []):
        comps.append({"type": "button", "sub_type": "url", "index": str(b["index"]),
                      "parameters": [{"type": "text", "text": resolve_var((var_map or {}).get(f"button_{b['index']}"), c)}]})
    return comps


def render_preview(tpl: dict, var_map: dict, c: dict) -> str:
    return VAR_RE.sub(lambda m: resolve_var((var_map or {}).get(m.group(1)), c) or m.group(0), tpl.get("body") or "")


async def meta_media_id(media_ref: str) -> Optional[str]:
    """Upload a stored campaign file to Meta once and cache the id (~30 day expiry)."""
    from bson import ObjectId
    fid = ObjectId(media_ref)
    meta = await db["cc_media.files"].find_one({"_id": fid})
    if not meta:
        return None
    cache = (meta.get("metadata") or {})
    if cache.get("meta_media_id") and datetime.fromisoformat(cache["meta_uploaded_at"]) > now_utc() - timedelta(days=25):
        return cache["meta_media_id"]
    stream = await media_bucket.open_download_stream(fid)
    content = await stream.read()
    ctype = cache.get("content_type") or "image/jpeg"
    async with httpx.AsyncClient(timeout=60) as hc:
        r = await hc.post(f"https://graph.facebook.com/{wa.GRAPH_VERSION}/{wa.PHONE_NUMBER_ID}/media",
                          headers={"Authorization": f"Bearer {wa.ACCESS_TOKEN}"},
                          data={"messaging_product": "whatsapp", "type": ctype}, files={"file": (meta.get("filename") or "media", content, ctype)})
    mid = (r.json() or {}).get("id") if r.status_code == 200 else None
    if mid:
        await db["cc_media.files"].update_one({"_id": fid}, {"$set": {"metadata.meta_media_id": mid, "metadata.meta_uploaded_at": iso()}})
    return mid


async def graph_send(recipient: str, tpl: dict, components: list) -> dict:
    """Single attempt. Returns ok/wamid, or error with `transient` flag; the worker owns retries."""
    payload = {"messaging_product": "whatsapp", "recipient_type": "individual", "to": recipient, "type": "template",
               "template": {"name": tpl["name"], "language": {"code": tpl["language"]}, "components": components}}
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(20.0)) as hc:
            r = await hc.post(wa.GRAPH_URL, json=payload, headers={"Authorization": f"Bearer {wa.ACCESS_TOKEN}"})
    except httpx.HTTPError as e:
        return {"ok": False, "transient": False, "error": f"network error (not retried to avoid duplicates): {str(e)[:120]}"}
    data = {}
    try:
        data = r.json()
    except Exception:
        pass
    if r.status_code == 200 and (data.get("messages") or [{}])[0].get("id"):
        return {"ok": True, "wamid": data["messages"][0]["id"]}
    err = data.get("error") or {}
    transient = r.status_code in (429, 500, 502, 503) or err.get("code") in (4, 80007, 130429, 131048, 131056)
    return {"ok": False, "transient": transient, "error": f"{err.get('code') or r.status_code}: {err.get('message') or 'send failed'}"}


async def deliver(msg: dict, settings: dict) -> dict:
    """Send one queued message (mock unless live sending is enabled). Updates the message record."""
    tpl = await TPL.find_one({"name": msg["template"], "language": msg["language"]}, {"_id": 0})
    if not tpl or not tpl.get("sendable"):
        return await _finish(msg, "failed", error="template not approved/available — no substitute used")
    c = await CUST.find_one({"customer_id": msg["customer_id"]}, {"_id": 0}) if msg.get("customer_id") else {"name": msg.get("name")}
    if msg["kind"] != "test":
        reason = exclusion_reason(c or {})
        if reason:
            return await _finish(msg, "skipped", error=reason)
    if not settings.get("live_sending"):
        return await _finish(msg, "mock", wamid=None, note="mock mode — not sent to WhatsApp")
    media_id = None
    if tpl.get("header_type") in ("IMAGE", "VIDEO", "DOCUMENT"):
        media_id = await meta_media_id(msg.get("media_ref") or "")
        if not media_id:
            return await _finish(msg, "failed", error="media header upload failed")
    res = await graph_send(msg["wa_number"], tpl, build_components(tpl, msg.get("var_map") or {}, c or {}, media_id))
    if res["ok"]:
        return await _finish(msg, "submitted", wamid=res["wamid"])
    if res["transient"] and msg.get("attempts", 0) < 3:
        await MSG.update_one({"_id": msg["_id"]}, {"$set": {"status": "queued", "last_error": res["error"],
                             "next_attempt_at": iso(now_utc() + timedelta(seconds=60 * (msg.get("attempts", 0) + 1)))}})
        return {"status": "queued"}
    return await _finish(msg, "failed", error=res["error"])


async def _finish(msg, status, wamid=None, error=None, note=None):
    s = {"status": status, "processed_at": iso()}
    if wamid:
        s.update({"wamid": wamid, "submitted_at": iso()})
    if error:
        s["error"] = error
    if note:
        s["note"] = note
    await MSG.update_one({"_id": msg["_id"]}, {"$set": s})
    if msg.get("customer_id") and status in ("submitted", "mock"):
        await CUST.update_one({"customer_id": msg["customer_id"]}, {"$set": {"last_whatsapp_at": iso(), "last_whatsapp_mock": status == "mock"}})
    return {"status": status}


# ------------------------------------------------------------------ worker
async def _claim_lock(name: str, ttl_s=600) -> bool:
    now = now_utc()
    await db.app_settings.update_one({"key": f"cc_lock_{name}"}, {"$setOnInsert": {"key": f"cc_lock_{name}", "until": None}}, upsert=True)
    r = await db.app_settings.find_one_and_update(
        {"key": f"cc_lock_{name}", "$or": [{"until": {"$lt": iso(now)}}, {"until": None}]},
        {"$set": {"until": iso(now + timedelta(seconds=ttl_s))}}, return_document=ReturnDocument.AFTER)
    return bool(r)


async def _release(name):
    await db.app_settings.update_one({"key": f"cc_lock_{name}"}, {"$set": {"until": None}})


async def run_worker():
    if not await _claim_lock("worker"):
        return
    try:
        settings = await get_settings()
        now = now_utc()
        # Interrupted sends are never re-sent automatically (could duplicate).
        await MSG.update_many({"status": "sending", "claimed_at": {"$lt": iso(now - timedelta(minutes=10))}},
                              {"$set": {"status": "failed", "error": "interrupted while sending — not retried to avoid a duplicate"}})
        async for c in CAMP.find({"status": "scheduled", "scheduled_at": {"$lte": iso(now)}}):
            await CAMP.update_one({"campaign_id": c["campaign_id"], "status": "scheduled"}, {"$set": {"status": "running", "started_at": iso()}})
            await audit("campaign_started", None, campaign_id=c["campaign_id"])
        await _send_birthdays(settings)
        for c in await CAMP.find({"status": "running"}, {"_id": 0, "campaign_id": 1}).to_list(50):
            await _drain_campaign(c["campaign_id"], settings)
    finally:
        await _release("worker")


async def _drain_campaign(cid: str, settings: dict, budget=600):
    sent = 0
    while sent < budget:
        camp = await CAMP.find_one({"campaign_id": cid}, {"status": 1})
        if not camp or camp["status"] != "running":
            return
        msg = await MSG.find_one_and_update(
            {"campaign_id": cid, "status": "queued", "$or": [{"next_attempt_at": None}, {"next_attempt_at": {"$lte": iso()}}]},
            {"$set": {"status": "sending", "claimed_at": iso()}, "$inc": {"attempts": 1}}, return_document=ReturnDocument.AFTER)
        if not msg:
            break
        await deliver(msg, settings)
        sent += 1
        await asyncio.sleep(0.25 if settings.get("live_sending") else 0)
    left = await MSG.count_documents({"campaign_id": cid, "status": {"$in": ["queued", "sending"]}})
    if not left:
        await CAMP.update_one({"campaign_id": cid, "status": "running"}, {"$set": {"status": "completed", "completed_at": iso()}})


async def _send_birthdays(settings: dict, force_date: Optional[str] = None):
    b = settings["birthday"]
    today = ist_now()
    today_s = today.strftime("%Y-%m-%d")
    if not b.get("enabled") or (b.get("last_run_date") == today_s and not force_date):
        return
    hh, mm = [int(x) for x in (b.get("send_time") or "10:00").split(":")]
    if (today.hour, today.minute) < (hh, mm) and not force_date:
        return
    tpl = await TPL.find_one({"name": b.get("template"), "language": b.get("language")}, {"_id": 0})
    await db.app_settings.update_one({"key": SETTINGS_KEY}, {"$set": {"birthday.last_run_date": today_s}})
    if not tpl or not tpl.get("sendable"):
        await audit("birthday_run_skipped", None, reason="birthday template not configured or not approved", date=today_s)
        return
    sched = today.replace(hour=hh, minute=mm, second=0, microsecond=0).isoformat()
    sent_wa = set()
    async for c in CUST.find({"active": True, "dob": {"$ne": None}}, {"_id": 0}):
        if not birthday_matches(c["dob"], today, b.get("feb29_policy")):
            continue
        reason = exclusion_reason(c)
        if not reason and c["wa_number"] in sent_wa:
            reason = "another customer with the same WhatsApp number already greeted today"
        if reason:
            await MSG.update_one({"dedupe_key": f"bday-skip:{c['customer_id']}:{today_s}"}, {"$setOnInsert": {
                "dedupe_key": f"bday-skip:{c['customer_id']}:{today_s}", "kind": "birthday", "customer_id": c["customer_id"],
                "name": c.get("name"), "wa_number": c.get("wa_number"), "dob": c["dob"], "template": tpl["name"], "language": tpl["language"],
                "status": "skipped", "error": reason, "scheduled_for": sched, "created_at": iso()}}, upsert=True)
            continue
        sent_wa.add(c["wa_number"])
        await queue_birthday(c, tpl, b, sched, today.year)
    async for m in MSG.find({"kind": "birthday", "status": "queued", "year": today.year}):
        claimed = await MSG.find_one_and_update({"_id": m["_id"], "status": "queued"}, {"$set": {"status": "sending", "claimed_at": iso()}, "$inc": {"attempts": 1}},
                                                return_document=ReturnDocument.AFTER)
        if claimed:
            await deliver(claimed, settings)


async def queue_birthday(c, tpl, b, sched, year, manual_by=None, repeat=False):
    key = f"birthday:{c['customer_id']}:{year}" + (f":manual:{iso()}" if repeat else "")
    doc = {"dedupe_key": key, "kind": "birthday", "year": year, "customer_id": c["customer_id"], "name": c.get("name"),
           "wa_number": c["wa_number"], "dob": c.get("dob"), "template": tpl["name"], "language": tpl["language"],
           "category": tpl.get("category"), "var_map": b.get("var_map") or {}, "media_ref": b.get("media_ref"),
           "status": "queued", "attempts": 0, "scheduled_for": sched, "created_at": iso(), "manual_by": manual_by}
    r = await MSG.update_one({"dedupe_key": key}, {"$setOnInsert": doc}, upsert=True)
    return bool(r.upserted_id)


# ------------------------------------------------------------------ webhook hooks (called from whatsapp.status_webhook)
async def on_status(st: dict):
    wamid, state = st.get("id"), st.get("status")
    m = await MSG.find_one({"wamid": wamid}, {"status": 1})
    if not m:
        return
    s = {f"{state}_at": iso()}
    if state == "failed":
        s.update({"status": "failed", "error": ((st.get("errors") or [{}])[0].get("title") or "failed")})
    elif STATUS_RANK.get(state, -1) > STATUS_RANK.get(m.get("status"), -1):
        s["status"] = state
    await MSG.update_one({"_id": m["_id"]}, {"$set": s})


async def on_message(msg: dict):
    sender = wa._to_recipient(msg.get("from") or "")
    if not sender:
        return
    text = ((msg.get("text") or {}).get("body") or (msg.get("button") or {}).get("text") or "").strip().lower()
    ctx = (msg.get("context") or {}).get("id")
    target = await MSG.find_one({"wamid": ctx}) if ctx else None
    if not target:
        target = await MSG.find_one({"wa_number": sender, "wamid": {"$ne": None}, "submitted_at": {"$gte": iso(now_utc() - timedelta(days=7))}},
                                    sort=[("submitted_at", -1)])
    if target:
        await MSG.update_one({"_id": target["_id"]}, {"$set": {"replied": True, "replied_at": iso(), "reply_text": text[:300]}})
    if text in OPT_OUT_WORDS:
        consent = {"status": "opted_out", "opt_out_date": iso(), "opt_out_reason": f"Customer replied '{text.upper()}' on WhatsApp",
                   "updated_by": "WhatsApp (customer)", "updated_at": iso()}
        r = await CUST.update_many({"wa_number": sender}, {"$set": {"consent": consent}})
        await audit("opt_out_whatsapp", None, wa_number=sender[-4:], customers=r.modified_count)
