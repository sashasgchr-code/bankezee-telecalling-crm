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
import os, io, csv, uuid, asyncio, hmac, time, logging, re
import pandas as pd
from datetime import datetime, timezone
from html import escape
from typing import List, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Header, Request

from utils.database import db
from utils.auth import require_meta_access
from utils.email_service import send_email as connect_send_email, _resolve_sender
from utils.amounts import parse_amount_to_num

logger = logging.getLogger("meta_sync")
router = APIRouter(prefix="/api/meta", tags=["Meta Sync"])

SHEET_ID = os.environ.get("GOOGLE_SHEET_ID", "1Ugq8BpctyY0ZdqxCknR1OdWGvvUW9Xa1FKBzs_Gyy_4")
SHEET_CSV_URL = f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/export?format=csv&gid=0"
# Full-workbook export: pulls EVERY tab (including any sheet/tab added in the future) in one request.
WORKBOOK_XLSX_URL = f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/export?format=xlsx"
# Secondary source: the website lead-capture sheet. Campaign is forced to "Direct Website Lead".
# Dedup rule: if a phone exists in BOTH this sheet and the Meta (loan consolidation) sheet, the
# Meta sheet wins and the website row is skipped (no duplicate meta_leads doc).
WEBSITE_SHEET_ID = os.environ.get("GOOGLE_WEBSITE_SHEET_ID", "1lptkIozGQ4eP16bQ7eVdhUSusiiQmLrpSFdNPA4qjBQ")
WEBSITE_WORKBOOK_XLSX_URL = f"https://docs.google.com/spreadsheets/d/{WEBSITE_SHEET_ID}/export?format=xlsx"
WEBSITE_CAMPAIGN = "Direct Website Lead"
WEBHOOK_CRON_SECRET = os.environ.get("WEBHOOK_CRON_SECRET", "")
EMAIL_FROM_NAME = os.environ.get("EMAIL_FROM_NAME", "BankEzee CRM")
APP_BASE_URL = os.environ.get("APP_BASE_URL", "")
# Meta email enable-switch. Resolved per-send from env first, then the admin-saved DB setting
# (app_settings.type=integrations.meta_email_enabled). DB fallback is required because production
# reads env from the Secrets store and runs multiple replicas — the DB value is seen by every
# replica and survives restarts. Real Meta sends happen ONLY when this returns True.
async def _meta_email_enabled() -> bool:
    if os.environ.get("META_EMAIL_ENABLED", "false").strip().lower() in ("true", "1", "yes", "on"):
        return True
    try:
        s = await db.app_settings.find_one({"type": "integrations"}, {"_id": 0, "meta_email_enabled": 1})
        return bool((s or {}).get("meta_email_enabled"))
    except Exception:
        return False

SHEET_STATUS_MAP = {"CREATED": "NEW", "FILE": "FILE"}


def now_iso():
    return datetime.now(timezone.utc).isoformat()


# ------------------- email transport (uses Connect's production Resend service) -------------------
# Meta reuses the SAME transport as the rest of Connect (utils.email_service -> Resend). Sends are
# gated by META_EMAIL_ENABLED so preview/backfill never blasts. Every attempt is logged.
async def _send_safe(to: str, subject: str, html: str, event: str = "generic"):
    if not to:
        return
    sent = False
    err = None
    if await _meta_email_enabled():
        try:
            ok = await connect_send_email(to, subject, html)
            sent = bool(ok)
            if not ok:
                err = "email transport unavailable (RESEND_API_KEY not configured or send failed)"
                logger.error(f"Meta email not delivered to {to} (transport returned false)")
        except Exception as e:
            err = str(e)
            logger.error(f"Meta email failed to {to}: {e}")
    else:
        logger.info(f"[META EMAIL SUPPRESSED] event={event} to={to} subject={subject!r}")
    try:
        sender = await _resolve_sender()
    except Exception:
        sender = None
    await db.meta_email_log.insert_one({
        "event": event, "to": to, "subject": subject, "from": sender,
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


def _norm10(raw: str) -> str:
    """Last 10 digits of a phone — used for cross-sheet dedup."""
    d = re.sub(r"\D", "", _clean_phone(raw))
    if len(d) > 10 and d.startswith("91"):
        d = d[2:]
    return d[-10:] if len(d) >= 10 else d


def _canonical_phone(raw: str) -> str:
    """Canonical stored phone: a bare 10-digit Indian mobile (^[6-9]\\d{9}$) when the input
    resolves to one, else the lightly-cleaned original. Ensures every downstream consumer
    (chatbot link, WhatsApp recipient) gets a clean, pattern-valid number."""
    n = _norm10(raw)
    if re.fullmatch(r"[6-9]\d{9}", n):
        return n
    return _clean_phone(raw)


def _pretty(val: str) -> str:
    return (val or "").replace("_", " ").strip()


# Different Meta lead forms (tabs) use different column headers for the same concept.
# These alias lists let us pull every tab — current and future — into the one lead schema.
_PHONE_KEYS = ["phone_number", "whatsapp_number", "phone", "mobile", "mobile_number", "contact_number"]
_EMP_KEYS = ["please_select_your_current_employment_status", "are_you", "employment_status"]
_SALARY_KEYS = ["what_is_your_current_monthly_take-home_salary?", "what's_your_net_monthly_salary?",
                "whats_your_net_monthly_salary?", "monthly_salary"]
_OUTSTANDING_KEYS = ["what_is_the_total_outstanding_amount_of_your_loans_and_credit_card_bills?",
                     "what's_your_total_loan_outstanding?", "whats_your_total_loan_outstanding?", "outstanding_amount"]
_CIBIL_KEYS = ["what's_your_cibil_score?", "whats_your_cibil_score?", "cibil_score", "credit_score"]


def _first_present(row: dict, keys: list) -> str:
    for k in keys:
        v = row.get(k, "")
        if v is not None and str(v).strip() and str(v).strip().lower() not in ("nan", "none", "null"):
            return str(v).strip()
    return ""


def _clean_id(v) -> str:
    """Meta sheet IDs come prefixed ('ag:', 'as:', 'c:', 'f:', 'l:'); keep the bare numeric ID."""
    v = ("" if v is None else str(v)).strip()
    if v.lower() in ("", "nan", "none", "null"):
        return ""
    return v.split(":", 1)[1] if ":" in v and v.split(":", 1)[0].isalpha() else v


def _attribution(r: dict, sheet_id: str) -> Optional[dict]:
    if r.get("source_tab") == "Website" or not (r.get("ad_id") or r.get("campaign_id")):
        return None
    return {"meta_lead_id": _clean_id(sheet_id), "ad_account_id": None,
            "campaign_id": r.get("campaign_id") or None, "campaign_name": r.get("campaign_name") or None,
            "adset_id": r.get("adset_id") or None, "adset_name": r.get("adset_name") or None,
            "ad_id": r.get("ad_id") or None, "ad_name": r.get("ad_name") or None,
            "form_id": r.get("form_id") or None, "form_name": r.get("form_name") or None,
            "meta_created_time": r.get("created_time") or None, "import_source": "Google Sheet (Meta Lead Ads)"}


_SYSTEM_COLS = {"id", "created_time", "ad_id", "ad_name", "adset_id", "adset_name", "campaign_id", "campaign_name", "form_id", "form_name",
                "is_organic", "platform", "lead_status", "lead id", "lead_id", "inbox_url", "retailer_item_id", "vehicle_id", "home_listing_id"}


def _form_answers(raw: dict) -> list:
    """Every customer-submitted column of the Meta form, with its original question label (future fields included)."""
    out = []
    for k, v in raw.items():
        key = (k or "").strip()
        val = "" if v is None else str(v).strip()
        if not key or key.lower() in _SYSTEM_COLS or not val or val.lower() in ("nan", "none", "null"):
            continue
        label = re.sub(r"[_]+", " ", key).strip().rstrip("?").strip()
        out.append({"key": key, "label": (label[:1].upper() + label[1:]) + ("?" if key.endswith("?") else ""), "value": _pretty(val) if "_" in val else val})
    return out


def _normalize_row(raw: dict, tab_name: str) -> dict:
    """Map one raw sheet row (any tab's header layout) into the canonical Meta lead schema."""
    row = {(k or "").strip().lower(): ("" if v is None else str(v).strip()) for k, v in raw.items()}
    return {
        "id": row.get("id", "").strip(),
        "created_time": row.get("created_time", ""),
        "full_name": (row.get("full_name") or "").strip(),
        "phone_number": _first_present(row, _PHONE_KEYS),
        "email": (row.get("email") or "").strip(),
        "city": (row.get("city") or "").strip(),
        "please_select_your_current_employment_status": _first_present(row, _EMP_KEYS),
        "what_is_your_current_monthly_take-home_salary?": _first_present(row, _SALARY_KEYS),
        "what_is_the_total_outstanding_amount_of_your_loans_and_credit_card_bills?": _first_present(row, _OUTSTANDING_KEYS),
        "campaign_name": (row.get("campaign_name") or "").strip(),
        **{k: _clean_id(row.get(k)) for k in ("ad_id", "adset_id", "campaign_id", "form_id")},
        **{k: _first_present(row, [k]) for k in ("ad_name", "adset_name")},
        "form_name": (row.get("form_name") or "").strip() or tab_name,
        "platform": (row.get("platform") or "").strip(),
        "is_organic": row.get("is_organic", ""),
        "cibil_score": _first_present(row, _CIBIL_KEYS),
        "source_tab": tab_name,
        "form_answers": _form_answers(raw),
    }


async def fetch_sheet_rows() -> List[dict]:
    """Pull leads from EVERY tab of the workbook (current + any future tab) via the xlsx export."""
    async with httpx.AsyncClient(timeout=60, follow_redirects=True) as hc:
        resp = await hc.get(WORKBOOK_XLSX_URL)
        resp.raise_for_status()
        content = resp.content
    try:
        sheets = pd.read_excel(io.BytesIO(content), sheet_name=None, dtype=str)
    except Exception as e:
        logger.error(f"Meta sheet sync: could not parse workbook xlsx ({e}); falling back to first tab CSV")
        async with httpx.AsyncClient(timeout=30, follow_redirects=True) as hc:
            resp = await hc.get(SHEET_CSV_URL)
            resp.raise_for_status()
            sheets = {"Sheet1": pd.read_csv(io.StringIO(resp.text), dtype=str)}

    rows = []
    for tab_name, df in sheets.items():
        if df is None or df.empty:
            continue
        df = df.where(pd.notnull(df), "")
        for raw in df.to_dict(orient="records"):
            r = _normalize_row(raw, tab_name)
            if not r["id"]:
                continue
            if r.get("is_organic", "").strip().lower() == "true":
                continue
            name = r.get("full_name", "")
            if "test lead" in name.lower() or "<test" in name.lower():
                continue
            if r.get("email", "").strip().lower() == "test@meta.com":
                continue
            rows.append(r)
    return rows


async def fetch_website_rows() -> List[dict]:
    """Pull leads from the website capture sheet, mapped into the canonical lead schema.
    Campaign is forced to 'Direct Website Lead'. Rows are de-duplicated by phone within the sheet."""
    try:
        async with httpx.AsyncClient(timeout=60, follow_redirects=True) as hc:
            resp = await hc.get(WEBSITE_WORKBOOK_XLSX_URL)
            resp.raise_for_status()
            content = resp.content
        sheets = pd.read_excel(io.BytesIO(content), sheet_name=None, dtype=str)
    except Exception as e:
        logger.error(f"Meta website sync: could not fetch/parse website sheet ({e})")
        return []

    rows = []
    seen_phones = set()
    for tab_name, df in sheets.items():
        if df is None or df.empty:
            continue
        df = df.where(pd.notnull(df), "")
        for raw in df.to_dict(orient="records"):
            row = {(k or "").strip().lower(): ("" if v is None else str(v).strip()) for k, v in raw.items()}
            phone = row.get("phone", "")
            norm = _norm10(phone)
            if len(norm) < 10:
                continue  # need a valid phone
            if norm in seen_phones:
                continue  # dedupe within the website sheet
            seen_phones.add(norm)
            lead_id = row.get("lead id", "") or row.get("lead_id", "")
            sid = f"web:{lead_id}" if lead_id else f"web:{norm}"
            rows.append({
                "id": sid,
                "created_time": row.get("received at", "") or row.get("received_at", ""),
                "full_name": (row.get("name") or "").strip() or "Website Lead",
                "phone_number": phone,
                "email": (row.get("email") or "").strip(),
                "city": (row.get("city") or "").strip(),
                "please_select_your_current_employment_status": (row.get("employment") or "").strip(),
                "what_is_your_current_monthly_take-home_salary?": (row.get("monthly income") or "").strip(),
                "what_is_the_total_outstanding_amount_of_your_loans_and_credit_card_bills?": "",
                "campaign_name": WEBSITE_CAMPAIGN,
                "form_name": (row.get("loan type") or "").strip() or WEBSITE_CAMPAIGN,
                "platform": "website",
                "cibil_score": "",
                "source_tab": "Website",
                "lead_status": "CREATED",
            })
    return rows


async def sync_leads_from_sheet() -> dict:
    # Source A: Meta loan-consolidation workbook (all tabs). Source B: website capture sheet.
    meta_rows = await fetch_sheet_rows()
    website_rows = await fetch_website_rows()

    # DEDUP: Meta sheet wins. Any website lead whose phone already appears in the Meta sheet is
    # dropped so we never create a duplicate meta_leads doc.
    meta_phones = {_norm10(r.get("phone_number", "")) for r in meta_rows if _norm10(r.get("phone_number", ""))}
    website_kept = [r for r in website_rows if _norm10(r.get("phone_number", "")) not in meta_phones]
    website_skipped_phones = list({p for p in (_norm10(r.get("phone_number", "")) for r in website_rows) if p in meta_phones})

    # Resolve overlaps for website leads already in the DB whose phone now appears in the Meta sheet:
    #   - UNTOUCHED (unassigned + status NEW + no calls): delete it so the Meta copy takes over ("change it to meta").
    #   - WORKED/ASSIGNED: keep that website lead and SKIP the incoming Meta row for that phone (never duplicate).
    worked_website_phones = set()
    if website_skipped_phones:
        async for d in db.meta_leads.find(
            {"source_tab": "Website", "phone_norm": {"$in": website_skipped_phones}},
            {"phone_norm": 1, "assigned_partner_id": 1, "status": 1, "call_logs": 1}
        ):
            worked = bool(d.get("assigned_partner_id")) or (d.get("status") not in (None, "NEW")) or bool(d.get("call_logs"))
            if worked:
                worked_website_phones.add(d.get("phone_norm"))
        await db.meta_leads.delete_many({
            "source_tab": "Website",
            "phone_norm": {"$in": website_skipped_phones},
            "assigned_partner_id": None,
            "status": "NEW",
            "$or": [{"call_logs": {"$exists": False}}, {"call_logs": {"$size": 0}}],
        })

    rows = meta_rows + website_kept
    imported, updated, failed, skipped_worked = 0, 0, 0, 0
    run_started = now_iso()
    for r in rows:
        sheet_id = (r.get("id") or "").strip()
        if not sheet_id:
            failed += 1
            continue
        # Don't create a Meta duplicate of a website lead that has already been worked/assigned.
        is_website_row = (r.get("source_tab") == "Website")
        if not is_website_row and _norm10(r.get("phone_number", "")) in worked_website_phones:
            existing_meta = await db.meta_leads.find_one({"sheet_id": sheet_id}, {"_id": 1})
            if not existing_meta:
                skipped_worked += 1
                continue
        existing = await db.meta_leads.find_one({"sheet_id": sheet_id}, {"_id": 1, "meta_attr": 1, "created_at": 1})
        attr = _attribution(r, sheet_id)
        sheet_status = (r.get("lead_status") or "CREATED").strip().upper()
        base = {
            "sheet_id": sheet_id,
            "created_time": r.get("created_time", ""),
            "full_name": (r.get("full_name") or "").strip(),
            "phone": _canonical_phone(r.get("phone_number", "")),
            "phone_norm": _norm10(r.get("phone_number", "")),
            "email": (r.get("email") or "").strip(),
            "city": (r.get("city") or "").strip(),
            "employment_status": _pretty(r.get("please_select_your_current_employment_status", "")),
            "monthly_salary": _pretty(r.get("what_is_your_current_monthly_take-home_salary?", "")),
            "outstanding_amount": _pretty(r.get("what_is_the_total_outstanding_amount_of_your_loans_and_credit_card_bills?", "")),
            "monthly_salary_num": parse_amount_to_num(_pretty(r.get("what_is_your_current_monthly_take-home_salary?", ""))),
            "outstanding_amount_num": parse_amount_to_num(_pretty(r.get("what_is_the_total_outstanding_amount_of_your_loans_and_credit_card_bills?", ""))),
            "campaign_name": (r.get("campaign_name") or "").strip(),
            "form_name": (r.get("form_name") or "").strip(),
            "platform": (r.get("platform") or "").strip(),
            "cibil_score": (r.get("cibil_score") or "").strip(),
            "source_tab": (r.get("source_tab") or "").strip(),
            "sheet_status": sheet_status,
            "form_answers": r.get("form_answers") or [],
            **({"campaign_type": "Car Loans"} if re.search(r"\bcar", r.get("campaign_name") or "", re.I) else {}),
        }
        if attr:
            base["meta_attr_latest"] = {k: attr[k] for k in ("campaign_name", "adset_name", "ad_name", "form_name")}
        if existing:
            extra = {}
            if attr and not existing.get("meta_attr"):  # backfill keyed by Meta lead ID (sheet row id) — never by name/phone
                extra["meta_attr"] = {**attr, "crm_imported_at": existing.get("created_at"), "backfilled_at": now_iso()}
            await db.meta_leads.update_one({"sheet_id": sheet_id}, {"$set": {**base, **extra, "updated_at": now_iso()}})
            updated += 1
        else:
            src_label = "Website" if base["source_tab"] == "Website" else "Google Sheet"
            doc = {
                **base,
                "lead_id": f"lead_{uuid.uuid4().hex[:12]}",
                "status": SHEET_STATUS_MAP.get(sheet_status, "NEW"),
                "assigned_partner_id": None, "assigned_partner_name": None,
                "notes": [],
                "activities": [{"type": "imported", "detail": f"Lead imported from {src_label}", "at": now_iso()}],
                "created_at": now_iso(), "updated_at": now_iso(),
            }
            if attr:
                doc["meta_attr"] = {**attr, "crm_imported_at": doc["created_at"]}
            try:
                await db.meta_leads.insert_one(doc)
            except Exception as ie:
                failed += 1
                logger.warning(f"Meta sheet sync insert failed for {sheet_id}: {ie}")
                continue
            imported += 1
            # Fire-and-forget WhatsApp auto-send for new Meta lead-form leads (idempotent, never blocks sync).
            try:
                from routes.whatsapp import maybe_autosend
                asyncio.create_task(maybe_autosend(doc))
            except Exception as _wa_e:
                logger.warning(f"WhatsApp autosend dispatch failed: {_wa_e}")
    await db.meta_import_runs.insert_one({
        "started_at": run_started, "finished_at": now_iso(), "received": len(meta_rows) + len(website_rows),
        "meta_rows": len(meta_rows), "website_rows": len(website_rows), "imported": imported,
        "duplicates_skipped": updated + len(website_rows) - len(website_kept) + skipped_worked, "failed": failed})
    await db.meta_meta.update_one({"key": "last_sync"},
                                  {"$set": {"key": "last_sync", "at": now_iso(), "imported": imported, "updated": updated}},
                                  upsert=True)
    logger.info(f"Meta sheet sync: {imported} new, {updated} updated (meta={len(meta_rows)}, website_kept={len(website_kept)})")
    if imported > 0:
        asyncio.create_task(notify_staff_new_leads(imported))
    return {"imported": imported, "updated": updated, "total_rows": len(rows)}


async def backfill_attribution() -> dict:
    """Fill meta_attr on existing leads from the sheet, matched ONLY by Meta lead ID (sheet row id). Never imports."""
    done = 0
    for r in await fetch_sheet_rows():
        sid = (r.get("id") or "").strip()
        attr = _attribution(r, sid) if sid else None
        if not attr:
            continue
        lead = await db.meta_leads.find_one({"sheet_id": sid, "meta_attr": {"$exists": False}}, {"created_at": 1})
        if lead:
            await db.meta_leads.update_one({"_id": lead["_id"]}, {"$set": {
                "meta_attr": {**attr, "crm_imported_at": lead.get("created_at"), "backfilled_at": now_iso()},
                "meta_attr_latest": {k: attr[k] for k in ("campaign_name", "adset_name", "ad_name", "form_name")}}})
            done += 1
    logger.info(f"Meta attribution backfill: {done} leads updated")
    return {"backfilled": done}


# ------------------- routes -------------------
@router.post("/leads/sync")
async def meta_manual_sync(user: dict = Depends(require_meta_access)):
    """Manual sync (staff only). Safe to re-run; dedupes on sheet_id."""
    if (user.get("meta_role_normalized") or "") not in ("admin", "ops"):
        raise HTTPException(status_code=403, detail="Admin/Ops only")
    return await sync_leads_from_sheet()

@router.post("/email/selftest")
async def meta_email_selftest(recipient: Optional[str] = None, user: dict = Depends(require_meta_access)):
    """Admin-only controlled cutover test: fire exactly ONE assignment email via the real
    production transport to a controlled recipient, then return the resulting meta_email_log row.
    Awaited (not fire-and-forget) so the caller sees the exact delivery outcome."""
    if (user.get("meta_role_normalized") or "") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    to = (recipient or user.get("meta_email") or user.get("email") or "").strip()
    if not to:
        raise HTTPException(status_code=400, detail="No recipient available")
    partner = {"name": user.get("name") or "Admin", "email": to}
    lead = {"lead_id": "SELFTEST", "full_name": "Cutover Self-Test Lead", "phone": "0000000000"}
    await notify_partner_assignment(partner, lead, user.get("name") or "Admin")
    row = await db.meta_email_log.find_one({"event": "assignment", "to": to}, sort=[("at", -1)])
    if row:
        row.pop("_id", None)
    return {
        "gate_META_EMAIL_ENABLED": await _meta_email_enabled(),
        "resend_configured": bool((os.environ.get("RESEND_API_KEY") or "").strip()),
        "recipient": to,
        "log": row,
    }




@router.post("/cron/sync-leads")
async def meta_cron_sync(authorization: Optional[str] = Header(None)):
    if not WEBHOOK_CRON_SECRET or authorization != f"Bearer {WEBHOOK_CRON_SECRET}":
        raise HTTPException(status_code=401, detail="Unauthorized")
    asyncio.create_task(sync_leads_from_sheet())
    return {"ok": True, "queued": True}


_last_webhook_sync = {"at": 0.0}


# ------------------- self-contained auto-sync scheduler -------------------
# Makes Connect the SOLE importer for the Meta sheet: an internal loop polls the sheet's public
# CSV export and reuses sync_leads_from_sheet() (same dedupe on sheet_id). No Apps Script / Google
# service account required (the sheet is readable via CSV export). Enabled by default; interval and
# on/off are env-configurable. Email stays gated by META_EMAIL_ENABLED (no blast).
AUTO_SYNC_ENABLED = os.environ.get("META_AUTO_SYNC_ENABLED", "true").strip().lower() == "true"
AUTO_SYNC_INTERVAL = int(os.environ.get("META_SYNC_INTERVAL_SECONDS", "120"))
_auto_sync_started = False
_auto_sync_lock = asyncio.Lock()


async def _auto_sync_loop():
    # small initial delay so startup/readiness isn't blocked
    await asyncio.sleep(20)
    while True:
        try:
            async with _auto_sync_lock:
                await sync_leads_from_sheet()
        except Exception as e:  # never let the loop die
            logger.warning(f"Meta auto-sync tick failed: {e}")
        await asyncio.sleep(AUTO_SYNC_INTERVAL)


def start_auto_sync():
    global _auto_sync_started
    if _auto_sync_started or not AUTO_SYNC_ENABLED:
        return
    _auto_sync_started = True
    asyncio.create_task(_auto_sync_loop())
    logger.info(f"Meta auto-sync scheduler started (every {AUTO_SYNC_INTERVAL}s)")


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
