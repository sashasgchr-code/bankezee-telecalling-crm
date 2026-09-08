"""
Meta module - Google Sheet CSV sync + email notifications (ported from META-APP).

- Writes ONLY to isolated meta_* collections (meta_leads, meta_meta). Never Connect CRM.
- Dedupes leads on sheet_id exactly like the old Meta app (one sheet row = one meta lead).
- Recipients resolve from meta_users.email (the Meta operational identity == meta_email).
- PREVIEW SAFETY: real emails are sent ONLY when META_EMAIL_ENABLED=true AND EMERGENT_EMAIL_KEY
  is set. Otherwise every intended send is CAPTURED into meta_email_log (no real send), so we can
  verify recipient/meta_email/one-send logic in preview without blasting production users.
- Routes are under /api/meta/*; cron/webhook keep WEBHOOK_CRON_SECRET protection.
- NO background scheduler is started here (production sync cutover stays pending).
"""
import os, io, csv, uuid, asyncio, hmac, time, logging
from datetime import datetime, timezone
from html import escape
from typing import List, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Header, Request

from utils.database import db
from utils.auth import require_meta_access

logger = logging.getLogger("meta_sync")
router = APIRouter(prefix="/api/meta", tags=["Meta Sync"])

SHEET_ID = os.environ.get("GOOGLE_SHEET_ID", "1Ugq8BpctyY0ZdqxCknR1OdWGvvUW9Xa1FKBzs_Gyy_4")
SHEET_CSV_URL = f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/export?format=csv&gid=0"
WEBHOOK_CRON_SECRET = os.environ.get("WEBHOOK_CRON_SECRET", "")
EMAIL_BASE_URL = "https://integrations.emergentagent.com"
EMAIL_KEY = os.environ.get("EMERGENT_EMAIL_KEY", "")
EMAIL_FROM_NAME = os.environ.get("EMAIL_FROM_NAME", "BankEzee CRM")
EMAIL_REPLY_TO = os.environ.get("EMAIL_REPLY_TO")
APP_BASE_URL = os.environ.get("APP_BASE_URL", "")
# Kill-switch: real sends happen only when explicitly enabled (default OFF in preview).
META_EMAIL_ENABLED = os.environ.get("META_EMAIL_ENABLED", "false").strip().lower() == "true"

SHEET_STATUS_MAP = {"CREATED": "NEW", "FILE": "FILE"}


def now_iso():
    return datetime.now(timezone.utc).isoformat()


# ------------------- email transport (captured by default in preview) -------------------
async def _real_send(to: str, subject: str, html: str) -> Optional[str]:
    payload = {"to": [to], "subject": subject, "html": html, "from_name": EMAIL_FROM_NAME}
    if EMAIL_REPLY_TO:
        payload["contact_email"] = EMAIL_REPLY_TO
    async with httpx.AsyncClient(timeout=30) as hc:
        resp = await hc.post(f"{EMAIL_BASE_URL}/api/v1/email/send",
                             headers={"X-Email-Key": EMAIL_KEY}, json=payload)
    resp.raise_for_status()
    return resp.json().get("id")


async def _send_safe(to: str, subject: str, html: str, event: str = "generic"):
    if not to:
        return
    sent = False
    err = None
    if META_EMAIL_ENABLED and EMAIL_KEY:
        try:
            await _real_send(to, subject, html)
            sent = True
        except Exception as e:
            err = str(e)
            logger.error(f"Meta email failed to {to}: {e}")
    else:
        logger.info(f"[META EMAIL SUPPRESSED] event={event} to={to} subject={subject!r}")
    await db.meta_email_log.insert_one({
        "event": event, "to": to, "subject": subject,
        "sent": sent, "suppressed": (not sent and err is None), "error": err, "at": now_iso(),
    })


# recipients come from the ISOLATED meta_users (their email == meta_email)
async def staff_emails() -> list:
    users = await db.meta_users.find({"role": {"$in": ["admin", "ops"]}}, {"_id": 0, "email": 1}).to_list(50)
    return [u["email"] for u in users if u.get("email")]


async def processor_emails() -> list:
    users = await db.meta_users.find({"role": "processor", "deleted": {"$ne": True}}, {"_id": 0, "email": 1}).to_list(200)
    return [u["email"] for u in users if u.get("email")]


def _basic_email(heading, body, url, label, color="#0F52BA"):
    return (f'<table role="presentation" width="100%"><tr><td style="padding:24px;font-family:Arial,sans-serif;color:#0f172a">'
            f'<h2 style="color:{color};margin:0 0 12px">{heading}</h2>{body}'
            f'<p><a href="{escape(url)}" style="background:#0F52BA;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block">{label}</a></p>'
            f'<p style="font-size:12px;color:#888;margin-top:24px">Sent by {escape(EMAIL_FROM_NAME)}.</p></td></tr></table>')


async def notify_staff_new_leads(count: int):
    body = f'<p><strong>{count}</strong> new lead{"s" if count != 1 else ""} imported from the Google Sheet.</p>'
    html = _basic_email("New Leads Imported", body, f"{APP_BASE_URL}/leads", "Open leads")
    for to in set(await staff_emails()):
        await _send_safe(to, f"{count} new lead{'s' if count != 1 else ''} imported", html, "new_leads")


async def notify_partner_assignment(partner: dict, lead: dict, admin_name: str):
    to = partner.get("email")
    if not to:
        return
    body = (f'<p>Hi {escape(partner.get("name") or "")}, {escape(admin_name)} assigned you a lead: '
            f'<strong>{escape(lead.get("full_name") or "-")}</strong> ({escape(lead.get("phone") or "-")}).</p>')
    html = _basic_email("New Lead Assigned", body, f"{APP_BASE_URL}/leads/{lead.get('lead_id')}", "View lead")
    await _send_safe(to, f"New lead assigned - {lead.get('full_name') or 'Lead'}", html, "assignment")


async def notify_staff_converted(lead: dict, actor_name: str):
    body = (f'<p>{escape(actor_name)} moved <strong>{escape(lead.get("full_name") or "-")}</strong> to the FILE stage.</p>')
    html = _basic_email("New Loan File", body, f"{APP_BASE_URL}/leads/{lead.get('lead_id')}", "View lead", "#7c3aed")
    for to in set(await staff_emails()):
        await _send_safe(to, f"New File: {lead.get('full_name') or 'Lead'}", html, "file_converted")


async def notify_processors_new_file(lead: dict, actor_name: str):
    body = f'<p>A new loan file was opened for <strong>{escape(lead.get("full_name") or "a lead")}</strong> by {escape(actor_name)}.</p>'
    html = _basic_email("New File to Process", body, f"{APP_BASE_URL}/leads/{lead.get('lead_id')}", "Open file", "#7c3aed")
    for to in set(await processor_emails()):
        await _send_safe(to, f"New File to process: {lead.get('full_name') or 'Lead'}", html, "processor_new_file")


# ------------------- Google Sheet import (into meta_leads) -------------------
def _clean_phone(raw: str) -> str:
    return (raw or "").replace("p:", "").strip()


def _pretty(val: str) -> str:
    return (val or "").replace("_", " ").strip()


async def fetch_sheet_rows() -> List[dict]:
    async with httpx.AsyncClient(timeout=30, follow_redirects=True) as hc:
        resp = await hc.get(SHEET_CSV_URL)
        resp.raise_for_status()
        text = resp.text
    reader = csv.DictReader(io.StringIO(text))
    rows = []
    for r in reader:
        if not r.get("id"):
            continue
        if (r.get("is_organic", "").strip().lower() == "true"):
            continue
        name = (r.get("full_name") or "")
        if "test lead" in name.lower() or "<test" in name.lower():
            continue
        if (r.get("email") or "").strip().lower() == "test@meta.com":
            continue
        rows.append(r)
    return rows


async def sync_leads_from_sheet() -> dict:
    rows = await fetch_sheet_rows()
    imported, updated = 0, 0
    for r in rows:
        sheet_id = (r.get("id") or "").strip()
        if not sheet_id:
            continue
        existing = await db.meta_leads.find_one({"sheet_id": sheet_id}, {"_id": 1})
        sheet_status = (r.get("lead_status") or "CREATED").strip().upper()
        base = {
            "sheet_id": sheet_id,
            "created_time": r.get("created_time", ""),
            "full_name": (r.get("full_name") or "").strip(),
            "phone": _clean_phone(r.get("phone_number", "")),
            "email": (r.get("email") or "").strip(),
            "city": (r.get("city") or "").strip(),
            "employment_status": _pretty(r.get("please_select_your_current_employment_status", "")),
            "monthly_salary": _pretty(r.get("what_is_your_current_monthly_take-home_salary?", "")),
            "outstanding_amount": _pretty(r.get("what_is_the_total_outstanding_amount_of_your_loans_and_credit_card_bills?", "")),
            "campaign_name": (r.get("campaign_name") or "").strip(),
            "form_name": (r.get("form_name") or "").strip(),
            "platform": (r.get("platform") or "").strip(),
            "sheet_status": sheet_status,
        }
        if existing:
            await db.meta_leads.update_one({"sheet_id": sheet_id}, {"$set": {**base, "updated_at": now_iso()}})
            updated += 1
        else:
            doc = {
                **base,
                "lead_id": f"lead_{uuid.uuid4().hex[:12]}",
                "status": SHEET_STATUS_MAP.get(sheet_status, "NEW"),
                "assigned_partner_id": None, "assigned_partner_name": None,
                "notes": [],
                "activities": [{"type": "imported", "detail": "Lead imported from Google Sheet", "at": now_iso()}],
                "created_at": now_iso(), "updated_at": now_iso(),
            }
            await db.meta_leads.insert_one(doc)
            imported += 1
    await db.meta_meta.update_one({"key": "last_sync"},
                                  {"$set": {"key": "last_sync", "at": now_iso(), "imported": imported, "updated": updated}},
                                  upsert=True)
    logger.info(f"Meta sheet sync: {imported} new, {updated} updated")
    if imported > 0:
        asyncio.create_task(notify_staff_new_leads(imported))
    return {"imported": imported, "updated": updated, "total_rows": len(rows)}


# ------------------- routes -------------------
@router.post("/leads/sync")
async def meta_manual_sync(user: dict = Depends(require_meta_access)):
    """Manual sync (staff only). Safe to re-run; dedupes on sheet_id."""
    if (user.get("meta_role_normalized") or "") not in ("admin", "ops"):
        raise HTTPException(status_code=403, detail="Admin/Ops only")
    return await sync_leads_from_sheet()


@router.post("/cron/sync-leads")
async def meta_cron_sync(authorization: Optional[str] = Header(None)):
    if not WEBHOOK_CRON_SECRET or authorization != f"Bearer {WEBHOOK_CRON_SECRET}":
        raise HTTPException(status_code=401, detail="Unauthorized")
    asyncio.create_task(sync_leads_from_sheet())
    return {"ok": True, "queued": True}


_last_webhook_sync = {"at": 0.0}


@router.post("/webhook/sheet-sync")
async def meta_webhook_sync(token: Optional[str] = None, authorization: Optional[str] = Header(None)):
    provided = token or (authorization or "").replace("Bearer ", "")
    if not WEBHOOK_CRON_SECRET or not provided or not hmac.compare_digest(provided, WEBHOOK_CRON_SECRET):
        raise HTTPException(status_code=401, detail="Unauthorized")
    now = time.time()
    if now - _last_webhook_sync["at"] < 5:
        return {"ok": True, "throttled": True}
    _last_webhook_sync["at"] = now
    asyncio.create_task(sync_leads_from_sheet())
    return {"ok": True, "queued": True}
