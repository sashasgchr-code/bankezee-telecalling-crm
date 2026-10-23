"""
Direct Meta WhatsApp Cloud API integration (official Graph API — NOT a BSP).

On a brand-new Meta lead-form lead arriving via the Google Sheet sync, the CRM:
  1. treats the Meta form submission as WhatsApp opt-in (Meta-sourced leads only),
  2. reuses the existing website chatbot to mint/reuse a customer-specific secure link,
  3. extracts the token after "/loan-review/" and sends the approved template
     `loan_application_response` (named body var `customer_name` + dynamic URL button token),
  4. stores the Meta message id (wamid), send time, delivery status and 30-day link expiry
     against the CRM lead, with idempotency so re-imports/re-syncs never resend.

Delivery-status webhooks (sent/delivered/read/failed) are verified via X-Hub-Signature-256.

Secrets (server-side only, never logged/exposed):
  META_WHATSAPP_ACCESS_TOKEN, META_WHATSAPP_APP_SECRET, META_WHATSAPP_VERIFY_TOKEN
Plain config:
  META_WHATSAPP_PHONE_NUMBER_ID, META_WHATSAPP_WABA_ID, META_GRAPH_VERSION,
  WHATSAPP_AUTOSEND_ENABLED, WHATSAPP_TEMPLATE_NAME, WHATSAPP_TEMPLATE_LANG,
  WHATSAPP_LINK_TTL_DAYS, WHATSAPP_DEFAULT_COUNTRY_CODE
"""
import os
import re
import hmac
import hashlib
import asyncio
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Response, Query, Header
from utils.database import db
from utils.auth import require_meta_access
from routes.chatbot_integration import ensure_chatbot_link
from routes.meta import _ctx, _can_action_lead, _get_lead_or_404, STAFF_ROLES

logger = logging.getLogger("whatsapp")

router = APIRouter(prefix="/api/meta", tags=["WhatsApp"])
webhook_router = APIRouter(prefix="/api/integrations/whatsapp", tags=["WhatsApp Webhook"])

ACCESS_TOKEN = os.environ.get("META_WHATSAPP_ACCESS_TOKEN") or ""
APP_SECRET = os.environ.get("META_WHATSAPP_APP_SECRET") or ""
VERIFY_TOKEN = os.environ.get("META_WHATSAPP_VERIFY_TOKEN") or ""
PHONE_NUMBER_ID = os.environ.get("META_WHATSAPP_PHONE_NUMBER_ID") or ""
GRAPH_VERSION = os.environ.get("META_GRAPH_VERSION", "v21.0")
TEMPLATE_NAME = os.environ.get("WHATSAPP_TEMPLATE_NAME", "loan_application_response")
TEMPLATE_LANG = os.environ.get("WHATSAPP_TEMPLATE_LANG", "en")
AUTOSEND_ENABLED = os.environ.get("WHATSAPP_AUTOSEND_ENABLED", "true").strip().lower() == "true"
LINK_TTL_DAYS = int(os.environ.get("WHATSAPP_LINK_TTL_DAYS", "30"))
DEFAULT_CC = os.environ.get("WHATSAPP_DEFAULT_COUNTRY_CODE", "91")

GRAPH_URL = f"https://graph.facebook.com/{GRAPH_VERSION}/{PHONE_NUMBER_ID}/messages"

# Statuses that mean the automatic trigger attempted but did NOT get a wamid — safe to retry.
# Anything with a wamid (accepted/sent/delivered/read) is a success and is never retried.
RETRYABLE_STATUSES = {"failed", "link_failed", "no_token", "invalid_phone"}


def _now():
    return datetime.now(timezone.utc)


def _iso(dt=None):
    return (dt or _now()).isoformat()


def _send_configured() -> bool:
    return bool(ACCESS_TOKEN and PHONE_NUMBER_ID)


def _norm_digits(raw: str) -> str:
    return re.sub(r"\D", "", raw or "")


def _to_recipient(phone: str) -> Optional[str]:
    """Return E.164 digits (no +). Adds default country code for bare 10-digit Indian numbers."""
    d = _norm_digits(phone)
    if len(d) == 10:
        d = DEFAULT_CC + d
    elif d.startswith("0") and len(d) == 11:
        d = DEFAULT_CC + d[1:]
    if len(d) < 11 or len(d) > 15:
        return None
    return d


def extract_token(secure_link: str) -> Optional[str]:
    """Only the token AFTER /loan-review/ — never the full URL."""
    if not secure_link:
        return None
    m = re.search(r"/loan-review/([^/?#\s]+)", secure_link)
    if m:
        return m.group(1)
    return None


# --------------------------- Graph send (with bounded retry) ---------------------------
async def _graph_send_template(recipient: str, customer_name: str, url_token: str) -> dict:
    payload = {
        "messaging_product": "whatsapp",
        "recipient_type": "individual",
        "to": recipient,
        "type": "template",
        "template": {
            "name": TEMPLATE_NAME,
            "language": {"code": TEMPLATE_LANG},
            "components": [
                {"type": "body", "parameters": [
                    {"type": "text", "parameter_name": "customer_name", "text": customer_name or "Customer"}
                ]},
                {"type": "button", "sub_type": "url", "index": "0", "parameters": [
                    {"type": "text", "text": url_token}
                ]},
            ],
        },
    }
    headers = {"Authorization": f"Bearer {ACCESS_TOKEN}", "Content-Type": "application/json"}
    last_err = None
    for attempt in range(3):
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(20.0)) as hc:
                resp = await hc.post(GRAPH_URL, json=payload, headers=headers)
        except httpx.HTTPError as e:
            last_err = {"message": "network error", "detail": str(e)[:200]}
            await asyncio.sleep(1.5 * (attempt + 1))
            continue
        try:
            data = resp.json()
        except Exception:
            data = {}
        if resp.status_code == 200:
            wamid = ((data.get("messages") or [{}])[0]).get("id")
            if wamid:
                return {"ok": True, "wamid": wamid, "status": "accepted"}
            return {"ok": False, "error": {"message": "no wamid in response"}}
        # Retry only transient failures; never blindly retry an ambiguous timeout above.
        if resp.status_code in (429, 500, 502, 503, 504) and attempt < 2:
            last_err = (data.get("error") or {"message": f"http {resp.status_code}"})
            await asyncio.sleep(1.5 * (attempt + 1))
            continue
        err = data.get("error") or {"message": f"http {resp.status_code}"}
        # Redacted log — never include token/headers.
        logger.warning(f"WhatsApp send failed: code={err.get('code')} subcode={err.get('error_subcode')} "
                       f"fbtrace={err.get('fbtrace_id')} http={resp.status_code}")
        return {"ok": False, "error": {k: err.get(k) for k in ("message", "code", "error_subcode", "fbtrace_id")},
                "http": resp.status_code}
    return {"ok": False, "error": last_err or {"message": "send failed"}}


# --------------------------- core send-for-lead (idempotent) ---------------------------
async def send_whatsapp_for_lead(lead: dict, *, force_renew: bool = False, trigger: str = "auto") -> dict:
    """Idempotent: skips if a wamid already exists (unless force_renew). Returns a result dict."""
    lead_id = lead.get("lead_id")
    if not _send_configured():
        return {"ok": False, "skipped": "not_configured"}

    wa = lead.get("whatsapp") or {}
    if wa.get("wamid") and not force_renew:
        return {"ok": True, "skipped": "already_sent", "wamid": wa.get("wamid")}

    recipient = _to_recipient(lead.get("phone") or lead.get("phone_norm") or "")
    if not recipient:
        await _mark(lead_id, {"whatsapp.status": "invalid_phone", "whatsapp.updated_at": _iso()})
        return {"ok": False, "skipped": "invalid_phone"}

    # Reuse or (re)mint the customer-specific secure chatbot link, then extract the token.
    try:
        secure_link = await ensure_chatbot_link(lead, renew=force_renew)
    except HTTPException as e:
        await _mark(lead_id, {"whatsapp.status": "link_failed",
                              "whatsapp.last_error": {"message": str(e.detail)[:300]},
                              "whatsapp.trigger": trigger, "whatsapp.updated_at": _iso()},
                    activity="WhatsApp not sent: chatbot link error")
        return {"ok": False, "error": {"message": f"link error: {e.detail}"}}
    token = extract_token(secure_link)
    if not token:
        await _mark(lead_id, {"whatsapp.status": "no_token",
                              "whatsapp.trigger": trigger, "whatsapp.updated_at": _iso()},
                    activity="WhatsApp not sent: no link token")
        return {"ok": False, "skipped": "no_token"}

    res = await _graph_send_template(recipient, lead.get("full_name") or "Customer", token)
    now = _now()
    if res.get("ok"):
        expires = now + timedelta(days=LINK_TTL_DAYS)
        wa_doc = {
            "wamid": res["wamid"], "status": res.get("status", "accepted"),
            "to": recipient, "template": TEMPLATE_NAME, "token": token,
            "sent_at": _iso(now), "link_expires_at": _iso(expires),
            "trigger": trigger, "updated_at": _iso(now), "last_error": None,
        }
        await _mark(lead_id, {"whatsapp": wa_doc}, activity=f"WhatsApp template sent (wamid {res['wamid']})")
        await db.meta_whatsapp_log.update_one(
            {"wamid": res["wamid"]},
            {"$setOnInsert": {"wamid": res["wamid"], "lead_id": lead_id, "to": recipient,
                              "template": TEMPLATE_NAME, "created_at": _iso(now)}},
            upsert=True,
        )
    else:
        await _mark(lead_id, {"whatsapp.status": "failed", "whatsapp.last_error": res.get("error"),
                              "whatsapp.updated_at": _iso(now)},
                    activity=f"WhatsApp send failed: {(res.get('error') or {}).get('message')}")
    return res


async def _mark(lead_id: str, set_doc: dict, activity: Optional[str] = None):
    update = {"$set": {**set_doc, "updated_at": _iso()}}
    if activity:
        update["$push"] = {"activities": {"type": "whatsapp", "detail": activity, "at": _iso()}}
    await db.meta_leads.update_one({"lead_id": lead_id}, update)


async def maybe_autosend(lead: dict):
    """Fire-and-forget hook for a freshly imported lead. Meta lead-form leads only; never raises."""
    try:
        if not (AUTOSEND_ENABLED and _send_configured()):
            return
        if (lead.get("source_tab") or "").strip().lower() == "website":
            return  # opt-in basis = Meta lead-form submission only
        await send_whatsapp_for_lead(lead, trigger="auto")
    except Exception as e:
        logger.warning(f"WhatsApp autosend error for {lead.get('lead_id')}: {e}")


# --------------------------- manual resend / renew endpoint ---------------------------
@router.post("/leads/{lead_id}/whatsapp/resend")
async def resend_whatsapp(lead_id: str, user: dict = Depends(require_meta_access)):
    """Authorized resend / link-renewal (e.g. expired 30-day link or a failed send)."""
    lead = await _get_lead_or_404(lead_id)
    role, uid = _ctx(user)
    if not _can_action_lead(role, uid, lead):
        raise HTTPException(status_code=403, detail="Not authorized for this lead")
    if not _send_configured():
        raise HTTPException(status_code=503, detail="WhatsApp not configured (missing access token / phone id)")

    wa = lead.get("whatsapp") or {}
    expired = False
    if wa.get("link_expires_at"):
        try:
            expired = datetime.fromisoformat(wa["link_expires_at"]) < _now()
        except Exception:
            expired = False
    res = await send_whatsapp_for_lead(lead, force_renew=True, trigger=f"manual:{role}")
    if not res.get("ok"):
        raise HTTPException(status_code=502, detail=(res.get("error") or res.get("skipped") or "send failed"))
    return {"ok": True, "wamid": res.get("wamid"), "renewed_link": expired or True}


@router.get("/leads/{lead_id}/whatsapp")
async def get_whatsapp_status(lead_id: str, user: dict = Depends(require_meta_access)):
    lead = await _get_lead_or_404(lead_id)
    role, uid = _ctx(user)
    if not _can_action_lead(role, uid, lead):
        raise HTTPException(status_code=403, detail="Not authorized for this lead")
    wa = lead.get("whatsapp") or {}
    wa.pop("token", None)  # token stays server-side
    return {"configured": _send_configured(), "autosend": AUTOSEND_ENABLED, "whatsapp": wa}


# --------------------------- bulk retry of failed sends (staff) ---------------------------
@router.post("/whatsapp/retry-failed")
async def retry_failed_whatsapp(
    confirm: bool = Query(False, description="Must be true to actually send; otherwise returns the match count only"),
    limit: int = Query(50, ge=1, le=500, description="Max leads to process in one run"),
    user: dict = Depends(require_meta_access),
):
    """Re-attempt the WhatsApp template ONLY for leads whose last attempt failed and which have
    no wamid yet. Leads that were already accepted/sent/delivered/read (have a wamid) are never
    touched, so this can never double-send. Staff (admin/ops) only; gated behind confirm=true."""
    role, _ = _ctx(user)
    if role not in STAFF_ROLES:
        raise HTTPException(status_code=403, detail="Admin/Ops only")
    if not _send_configured():
        raise HTTPException(status_code=503, detail="WhatsApp not configured (missing access token / phone id)")

    query = {
        "whatsapp.status": {"$in": list(RETRYABLE_STATUSES)},
        "whatsapp.wamid": {"$exists": False},
        "source_tab": {"$ne": "Website"},
    }
    total = await db.meta_leads.count_documents(query)
    if not confirm:
        return {"ok": True, "dry_run": True, "matched": total,
                "retryable_statuses": sorted(RETRYABLE_STATUSES),
                "action_required": "Re-call with confirm=true to retry (processes up to `limit` leads per run)."}

    leads = await db.meta_leads.find(query).sort("updated_at", 1).limit(limit).to_list(limit)
    summary = {"sent": 0, "failed": 0, "skipped": 0}
    for lead in leads:
        res = await send_whatsapp_for_lead(lead, trigger=f"retry:{role}")
        if res.get("ok") and res.get("wamid"):
            summary["sent"] += 1
        elif res.get("skipped"):
            summary["skipped"] += 1
        else:
            summary["failed"] += 1
        await asyncio.sleep(0.3)  # gentle pacing so a large retry never bursts the Graph API
    return {"ok": True, "matched": total, "processed": len(leads), **summary,
            "remaining": max(total - len(leads), 0)}


# --------------------------- webhook (status callbacks) ---------------------------
@webhook_router.get("/webhook")
async def verify_webhook(hub_mode: str = Query(None, alias="hub.mode"),
                         hub_verify_token: str = Query(None, alias="hub.verify_token"),
                         hub_challenge: str = Query(None, alias="hub.challenge")):
    if hub_mode != "subscribe" or not hub_challenge or not hub_verify_token:
        raise HTTPException(status_code=400, detail="invalid verification request")
    if not VERIFY_TOKEN or not hmac.compare_digest(hub_verify_token.encode(), VERIFY_TOKEN.encode()):
        raise HTTPException(status_code=403, detail="invalid verify token")
    return Response(content=hub_challenge, media_type="text/plain")


def _valid_signature(raw: bytes, header: Optional[str]) -> bool:
    if not APP_SECRET or not header or not header.startswith("sha256="):
        return False
    supplied = header[7:].strip().lower()
    if len(supplied) != 64:
        return False
    expected = hmac.new(APP_SECRET.encode("utf-8"), raw, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, supplied)


@webhook_router.post("/webhook")
async def status_webhook(request: Request, x_hub_signature_256: Optional[str] = Header(None)):
    raw = await request.body()
    if not _valid_signature(raw, x_hub_signature_256):
        raise HTTPException(status_code=401, detail="invalid signature")
    try:
        event = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="invalid JSON")

    for entry in event.get("entry", []):
        for change in entry.get("changes", []):
            value = (change or {}).get("value", {})
            for st in value.get("statuses", []):
                wamid = st.get("id")
                state = st.get("status")
                if not wamid or state not in ("sent", "delivered", "read", "failed"):
                    continue
                set_doc = {"whatsapp.status": state, "whatsapp.status_updated_at": _iso(),
                           "whatsapp.status_timestamp": st.get("timestamp")}
                if state == "failed":
                    set_doc["whatsapp.last_error"] = (st.get("errors") or [{}])[0]
                await db.meta_leads.update_one({"whatsapp.wamid": wamid}, {"$set": set_doc})
                await db.meta_whatsapp_log.update_one(
                    {"wamid": wamid}, {"$set": {"status": state, "status_at": _iso()}})
    return {"ok": True}
