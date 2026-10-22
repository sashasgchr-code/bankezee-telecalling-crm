"""
BankEzee Loan Qualification Chatbot <-> Connect CRM integration.

The chatbot is an EXTERNAL, already-built service. This module is a thin, secure
server-side bridge:

- Stores qualification data against the EXISTING Meta lead in its own isolated
  collection `meta_chatbot_qualifications` (keyed by crm_lead_ref == meta_leads.lead_id).
- NEVER auto-converts leads to Files, never changes lead status, never touches
  commission / reporting. File data (meta_leads.file) is agent-owned and is never
  overwritten by chatbot data.
- All outbound calls carry the shared secret header `X-CRM-Key` (server-side only).
- The inbound webhook verifies an HMAC-SHA256 signature over the RAW body.

Config (server-side env only — never exposed to the browser):
  BANKEZEE_CHATBOT_BASE_URL   e.g. https://www.bankezee.com (prod) / preview URL
  BANKEZEE_CHATBOT_CRM_KEY    shared secret, must equal the chatbot's CRM_API_KEY
"""
import os
import hmac
import hashlib
import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel

from utils.database import db
from utils.auth import require_meta_access
from utils.helpers import serialize_doc
from routes.meta import _ctx, _can_action_lead, _get_lead_or_404, STAFF_ROLES

logger = logging.getLogger("chatbot_integration")

# Authenticated proxy routes live under the Meta namespace (Connect's single login + Meta gate).
router = APIRouter(prefix="/api/meta", tags=["Chatbot Integration"])
# The inbound webhook is a separate, unauthenticated-but-HMAC-verified endpoint.
webhook_router = APIRouter(prefix="/api/integrations/bankezee-chatbot", tags=["Chatbot Webhook"])

BASE_URL = (os.environ.get("BANKEZEE_CHATBOT_BASE_URL") or "").rstrip("/")
CRM_KEY = os.environ.get("BANKEZEE_CHATBOT_CRM_KEY") or ""

RECONCILE_ENABLED = os.environ.get("CHATBOT_RECONCILE_ENABLED", "true").strip().lower() == "true"
RECONCILE_INTERVAL = int(os.environ.get("CHATBOT_RECONCILE_INTERVAL_SECONDS", "600"))

SUPPORTED_EVENTS = {
    "progress_updated", "loan_saved", "loan_deleted", "document_uploaded",
    "callback_requested", "completed", "link_renewal_requested",
}


def _now_iso():
    return datetime.now(timezone.utc).isoformat()


def _configured() -> bool:
    return bool(BASE_URL and CRM_KEY)


def _require_configured():
    if not _configured():
        raise HTTPException(status_code=503, detail="Chatbot integration is not configured (missing BANKEZEE_CHATBOT_BASE_URL / BANKEZEE_CHATBOT_CRM_KEY)")


def _pick(d: dict, *keys, default=None):
    """First present, non-empty value among alias keys (tolerant to chatbot schema)."""
    if not isinstance(d, dict):
        return default
    for k in keys:
        if k in d and d[k] not in (None, "", []):
            return d[k]
    return default


# --------------------------- outbound HTTP ---------------------------
async def _chatbot_request(method: str, path: str, *, json_body=None, params=None, stream=False):
    _require_configured()
    url = f"{BASE_URL}{path}"
    headers = {"X-CRM-Key": CRM_KEY, "Accept": "application/json"}
    try:
        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as hc:
            resp = await hc.request(method, url, headers=headers, json=json_body, params=params)
    except httpx.HTTPError as e:
        logger.error(f"Chatbot request {method} {path} failed: {e}")
        raise HTTPException(status_code=502, detail="Chatbot service unreachable")
    if resp.status_code == 401:
        raise HTTPException(status_code=502, detail="Chatbot rejected the CRM key (check BANKEZEE_CHATBOT_CRM_KEY)")
    if resp.status_code == 404:
        raise HTTPException(status_code=404, detail="No chatbot session for this lead yet")
    if resp.status_code >= 400:
        detail = resp.text[:300]
        raise HTTPException(status_code=502, detail=f"Chatbot error {resp.status_code}: {detail}")
    return resp


# --------------------------- normalization / upsert ---------------------------
def _normalize_loan(raw: dict) -> dict:
    return {
        "loan_id": str(_pick(raw, "loan_id", "id", "uuid", default="") or ""),
        "lender": _pick(raw, "lender", "bank", "bank_name", "lender_name"),
        "loan_type": _pick(raw, "loan_type", "type", "product"),
        "original_amount": _pick(raw, "original_amount", "loan_amount", "sanctioned_amount", "amount"),
        "sanction_date": _pick(raw, "sanction_date", "disbursed_date", "start_date"),
        "outstanding_balance": _pick(raw, "outstanding_balance", "outstanding", "balance", "outstanding_amount"),
        "interest_rate": _pick(raw, "interest_rate", "roi", "rate"),
        "monthly_emi": _pick(raw, "monthly_emi", "emi", "emi_amount"),
        "original_tenure": _pick(raw, "original_tenure", "tenure", "tenure_months"),
        "emis_paid": _pick(raw, "emis_paid", "paid_emis", "emis_paid_count", "no_of_emis_paid"),
        "raw": raw,
    }


def _normalize_document(raw: dict) -> dict:
    return {
        "doc_id": str(_pick(raw, "doc_id", "id", "document_id", default="") or ""),
        "type": _pick(raw, "type", "doc_type", "category", "kind"),
        "name": _pick(raw, "name", "filename", "file_name"),
        "status": _pick(raw, "status", "state", default="uploaded"),
        "uploaded_at": _pick(raw, "uploaded_at", "created_at", "at"),
    }


def _normalize_session(session: dict) -> dict:
    """Best-effort mapping of the chatbot session object to CRM display fields.
    The full raw session is also stored for safety / future refinement."""
    loans_raw = _pick(session, "loans", "existing_loans", "obligations", default=[]) or []
    docs_raw = _pick(session, "documents", "docs", "uploads", default=[]) or []
    loans = [_normalize_loan(l) for l in loans_raw if isinstance(l, dict)]
    docs = [_normalize_document(x) for x in docs_raw if isinstance(x, dict)]

    total_oblig = _pick(session, "total_monthly_obligations", "total_obligations", "total_emi", "total_monthly_emi")
    if total_oblig in (None, "") and loans:
        try:
            total_oblig = sum(float(l.get("monthly_emi") or 0) for l in loans)
        except Exception:
            total_oblig = None

    net_salary = _pick(session, "net_monthly_salary", "net_salary", "take_home_salary",
                       "monthly_take_home", "monthly_salary", "salary")
    ratio = _pick(session, "emi_to_salary_ratio", "foir", "emi_ratio", "obligation_ratio")
    if ratio in (None, "") and net_salary and total_oblig:
        try:
            ns = float(net_salary)
            if ns > 0:
                ratio = round(float(total_oblig) / ns * 100, 1)
        except Exception:
            ratio = None

    def _doc_status(*types):
        for dct in docs:
            t = (dct.get("type") or dct.get("name") or "").lower()
            if any(k in t for k in types):
                return dct.get("status") or "uploaded"
        return None

    payslip = _pick(session, "payslip_status", "payslip_uploaded", default=None)
    if payslip is None:
        payslip = _doc_status("payslip", "salary", "pay slip")
    credit = _pick(session, "credit_report_status", "credit_report_uploaded", "cibil_report_status", default=None)
    if credit is None:
        credit = _doc_status("credit", "cibil", "bureau")

    return {
        "chatbot_status": _pick(session, "status", "chatbot_status", "state", default="in_progress"),
        "progress": _pick(session, "progress", "completion", "progress_percent",
                          "completion_percentage", "percent_complete", default=0),
        "completed": bool(_pick(session, "completed", "is_completed", default=False))
                     or str(_pick(session, "status", "state", default="")).lower() in ("completed", "complete", "done"),
        "net_monthly_salary": net_salary,
        "company_name": _pick(session, "company_name", "company", "employer", "employer_name"),
        "city": _pick(session, "city", "location"),
        "cibil_score": _pick(session, "cibil_score", "cibil", "credit_score"),
        "cibil_bureau": _pick(session, "cibil_bureau", "bureau", "credit_bureau"),
        "total_monthly_obligations": total_oblig,
        "emi_to_salary_ratio": ratio,
        "payslip_status": payslip,
        "credit_report_status": credit,
        "loans": loans,
        "documents": docs,
        "callback_requests": _pick(session, "callback_requests", "callbacks", "callback", default=[]) or [],
        "whatsapp_consent": _pick(session, "whatsapp_consent", "consent", default=None),
    }


async def _upsert_qualification(crm_lead_ref: str, session: dict, *, event: Optional[str] = None,
                                error: Optional[str] = None) -> dict:
    """Idempotent upsert of the qualification profile. Loans/documents are replaced from the
    authoritative session object (dedup by loan_id handled upstream by the chatbot UUIDs).
    Never writes to meta_leads / File data."""
    now = _now_iso()
    norm = _normalize_session(session or {})
    set_doc = {
        "crm_lead_ref": crm_lead_ref,
        "qualification": norm,
        "raw_session": session or {},
        "last_synced_at": now,
        "last_sync_error": error,
        "updated_at": now,
    }
    if event:
        set_doc["last_event"] = event
    await db.meta_chatbot_qualifications.update_one(
        {"crm_lead_ref": crm_lead_ref},
        {"$set": set_doc, "$setOnInsert": {"created_at": now}},
        upsert=True,
    )
    return await db.meta_chatbot_qualifications.find_one({"crm_lead_ref": crm_lead_ref})


async def _get_profile(crm_lead_ref: str) -> Optional[dict]:
    return await db.meta_chatbot_qualifications.find_one({"crm_lead_ref": crm_lead_ref})


# --------------------------- access guard ---------------------------
async def _lead_guard(lead_id: str, user: dict):
    lead = await _get_lead_or_404(lead_id)
    role, uid = _ctx(user)
    if not _can_action_lead(role, uid, lead):
        raise HTTPException(status_code=403, detail="Not authorized for this lead")
    return lead, role, uid


# =========================== input models ===========================
class ChatbotLinkInput(BaseModel):
    renew: bool = False
    whatsapp_consent: bool = False


class ChatbotActionInput(BaseModel):
    action: str                      # e.g. "request_missing_info" | "advisory_note"
    note: Optional[str] = ""
    fields: Optional[list] = None     # optional list of missing fields requested


# =========================== authenticated proxy routes ===========================
@router.post("/leads/{lead_id}/chatbot/link")
async def create_or_renew_link(lead_id: str, inp: ChatbotLinkInput, user: dict = Depends(require_meta_access)):
    """Create (or, when renew=True, renew) the customer's secure chatbot link.
    Uses the REAL meta lead id as crm_lead_ref and the lead's recorded phone/name.
    Never auto-renews — renewal is an explicit, authorized action."""
    lead, role, _ = await _lead_guard(lead_id, user)
    existing = await _get_profile(lead_id)

    # Reuse a previously stored link unless an explicit renew is requested.
    if existing and existing.get("secure_link") and not inp.renew:
        return {"secure_link": existing.get("secure_link"), "reused": True,
                "crm_lead_ref": lead_id}

    payload = {
        "crm_lead_ref": lead_id,
        "name": lead.get("full_name") or "",
        "phone": lead.get("phone") or "",
        "whatsapp_consent": bool(inp.whatsapp_consent),
        "renew": bool(inp.renew),
    }
    resp = await _chatbot_request("POST", "/api/crm/chatbot/links", json_body=payload)
    data = resp.json() if resp.content else {}
    secure_link = data.get("secure_link")
    now = _now_iso()

    update = {"crm_lead_ref": lead_id, "updated_at": now,
              "whatsapp_consent": bool(inp.whatsapp_consent)}
    if secure_link:
        update["secure_link"] = secure_link
        update["link_created_at"] = now
    elif existing and existing.get("secure_link"):
        # API returned null because an existing link is still valid — reuse stored link.
        secure_link = existing.get("secure_link")
    await db.meta_chatbot_qualifications.update_one(
        {"crm_lead_ref": lead_id},
        {"$set": update, "$setOnInsert": {"created_at": now}},
        upsert=True,
    )
    # Audit on the lead timeline (no status/File change).
    await db.meta_leads.update_one({"lead_id": lead_id}, {"$push": {"activities": {
        "type": "chatbot",
        "detail": f"{user.get('name', 'Agent')} {'renewed' if inp.renew else 'created'} the customer chatbot link",
        "at": now,
    }}})
    return {"secure_link": secure_link, "reused": False, "crm_lead_ref": lead_id}


@router.get("/leads/{lead_id}/chatbot")
async def get_qualification(lead_id: str, user: dict = Depends(require_meta_access)):
    """Return the stored qualification profile for the Meta lead card."""
    await _lead_guard(lead_id, user)
    prof = await _get_profile(lead_id)
    if not prof:
        return {"crm_lead_ref": lead_id, "exists": False, "secure_link": None,
                "qualification": None, "last_synced_at": None}
    out = serialize_doc(prof)
    out["exists"] = True
    out.pop("raw_session", None)  # keep response lean; raw stays server-side
    return out


@router.post("/leads/{lead_id}/chatbot/refresh")
async def refresh_qualification(lead_id: str, user: dict = Depends(require_meta_access)):
    """Manual reconciliation: pull the authoritative session from the chatbot and upsert."""
    await _lead_guard(lead_id, user)
    try:
        resp = await _chatbot_request("GET", f"/api/crm/chatbot/sessions/{lead_id}")
        session = resp.json() if resp.content else {}
        session = session.get("session", session) if isinstance(session, dict) else {}
        prof = await _upsert_qualification(lead_id, session, event="manual_refresh")
    except HTTPException as e:
        if e.status_code == 404:
            return {"crm_lead_ref": lead_id, "exists": False, "message": "No chatbot session yet"}
        await db.meta_chatbot_qualifications.update_one(
            {"crm_lead_ref": lead_id}, {"$set": {"last_sync_error": str(e.detail), "updated_at": _now_iso()}})
        raise
    out = serialize_doc(prof)
    out["exists"] = True
    out.pop("raw_session", None)
    return out


@router.get("/leads/{lead_id}/chatbot/documents/{doc_id}")
async def proxy_document(lead_id: str, doc_id: str, user: dict = Depends(require_meta_access)):
    """Authenticated proxy for chatbot-held documents. No public URL; CRM permissions apply."""
    await _lead_guard(lead_id, user)
    resp = await _chatbot_request("GET", f"/api/crm/chatbot/sessions/{lead_id}/documents/{doc_id}")
    content_type = resp.headers.get("content-type", "application/octet-stream")
    disposition = resp.headers.get("content-disposition", f'inline; filename="{doc_id}"')
    return Response(content=resp.content, media_type=content_type,
                    headers={"Content-Disposition": disposition})


@router.post("/leads/{lead_id}/chatbot/actions")
async def record_action(lead_id: str, inp: ChatbotActionInput, user: dict = Depends(require_meta_access)):
    """Record an agent action (advisory note / request-missing-info) back to the chatbot,
    and mirror it on the lead timeline + notes."""
    lead, _, _ = await _lead_guard(lead_id, user)
    now = _now_iso()
    payload = {
        "action": inp.action,
        "note": (inp.note or "").strip(),
        "fields": inp.fields or [],
        "agent": user.get("name") or "Agent",
        "at": now,
    }
    # Best-effort to the chatbot; CRM record is authoritative regardless.
    chatbot_ok = False
    try:
        await _chatbot_request("POST", f"/api/crm/chatbot/sessions/{lead_id}/actions", json_body=payload)
        chatbot_ok = True
    except HTTPException as e:
        logger.warning(f"Chatbot action relay failed for {lead_id}: {e.detail}")

    label = "requested missing information" if inp.action == "request_missing_info" else "recorded advisory notes"
    detail = f"{user.get('name', 'Agent')} {label}"
    if inp.note:
        detail += f": {inp.note[:160]}"
    await db.meta_leads.update_one({"lead_id": lead_id}, {"$push": {
        "activities": {"type": "chatbot", "detail": detail, "at": now},
        "notes": {"text": f"[Chatbot] {label}" + (f": {inp.note}" if inp.note else ""),
                  "author": user.get("name"), "at": now},
    }, "$set": {"updated_at": now}})
    return {"ok": True, "chatbot_relayed": chatbot_ok}


# =========================== File prefill (manual convert only) ===========================
async def prefill_file_from_qualification(lead_id: str):
    """Called by meta.py when a GP MANUALLY converts a lead to FILE. Fills EMPTY File fields
    from the qualification profile; never overwrites agent-entered (non-empty) values."""
    try:
        prof = await _get_profile(lead_id)
        if not prof:
            return
        q = prof.get("qualification") or {}
        lead = await db.meta_leads.find_one({"lead_id": lead_id})
        if not lead:
            return
        existing_file = dict(lead.get("file") or {})

        loans = q.get("loans") or []

        def _loan_summary(l):
            """Compact one-line description for the EXISTING 'Existing Loan N' text field.
            Carries every per-loan attribute the chatbot supplies (the File model has no
            structured per-loan fields, so all detail lives on this single line + raw profile)."""
            head = " · ".join([str(p) for p in [l.get("lender"), l.get("loan_type")] if p]) or "Loan"
            bits = []
            if l.get("original_amount") not in (None, ""): bits.append(f"Orig ₹{l.get('original_amount')}")
            if l.get("outstanding_balance") not in (None, ""): bits.append(f"O/S ₹{l.get('outstanding_balance')}")
            if l.get("interest_rate") not in (None, ""): bits.append(f"ROI {l.get('interest_rate')}%")
            if l.get("monthly_emi") not in (None, ""): bits.append(f"EMI ₹{l.get('monthly_emi')}")
            if l.get("original_tenure") not in (None, ""): bits.append(f"Tenure {l.get('original_tenure')}mo")
            if l.get("emis_paid") not in (None, ""): bits.append(f"Paid {l.get('emis_paid')}")
            if l.get("sanction_date") not in (None, ""): bits.append(f"Sanctioned {l.get('sanction_date')}")
            return f"{head} | {' | '.join(bits)}" if bits else head

        # Map ONLY to existing compatible File fields. The aggregate 'Monthly EMI Obligations'
        # (file.monthly_emi) is intentionally NOT prefilled — preserve its existing business logic.
        defaults = {
            "company_name": q.get("company_name"),
            "net_salary": q.get("net_monthly_salary"),
            "cibil": q.get("cibil_score"),
        }
        for i, l in enumerate(loans[:3]):
            defaults[f"existing_loan_{i + 1}"] = _loan_summary(l)

        changed = {}
        for k, v in defaults.items():
            if v in (None, "", []):
                continue
            if existing_file.get(k) in (None, "", []):  # never overwrite agent-entered values
                changed[k] = v

        # City maps to the existing lead-level field (no File field exists for it).
        lead_set = {}
        if q.get("city") and lead.get("city") in (None, "", []):
            lead_set["city"] = q.get("city")

        if not changed and not lead_set:
            return
        set_doc = {"updated_at": _now_iso(), **lead_set}
        if changed:
            set_doc["file"] = {**existing_file, **changed}
        detail_fields = list(changed.keys()) + list(lead_set.keys())
        await db.meta_leads.update_one({"lead_id": lead_id}, {"$set": set_doc, "$push": {"activities": {
            "type": "chatbot",
            "detail": f"File auto-prefilled from chatbot qualification ({', '.join(detail_fields)}) — please review",
            "at": _now_iso(),
        }}})
    except Exception as e:
        logger.warning(f"File prefill from qualification failed for {lead_id}: {e}")


# =========================== webhook receiver ===========================
def _verify_signature(raw_body: bytes, signature: str) -> bool:
    if not signature or not CRM_KEY:
        return False
    provided = signature.strip()
    if provided.lower().startswith("sha256="):
        provided = provided[7:]
    expected = hmac.new(CRM_KEY.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, provided)


async def _notify_gp_callback(lead: dict):
    """Reuse Connect's existing (gated) email notification path for the assigned GP."""
    try:
        pid = lead.get("assigned_partner_id")
        if not pid:
            return
        partner = await db.meta_users.find_one({"user_id": pid})
        if not partner or not partner.get("email"):
            return
        from routes.meta_sync import _send_safe, _basic_email, APP_BASE_URL
        from html import escape
        body = (f'<p>Customer <strong>{escape(lead.get("full_name") or "-")}</strong> '
                f'({escape(lead.get("phone") or "-")}) requested a callback via the loan chatbot.</p>')
        html = _basic_email("Callback Requested", body,
                            f"{APP_BASE_URL}/meta/leads/{lead.get('lead_id')}", "Open lead", "#0F52BA")
        await _send_safe(partner["email"], f"Callback requested — {lead.get('full_name') or 'Lead'}",
                         html, "chatbot_callback")
    except Exception as e:
        logger.warning(f"Callback notify failed: {e}")


@webhook_router.post("/webhook")
async def chatbot_webhook(request: Request):
    raw = await request.body()
    signature = request.headers.get("X-Bankezee-Signature") or request.headers.get("x-bankezee-signature") or ""
    if not _verify_signature(raw, signature):
        raise HTTPException(status_code=401, detail="Invalid signature")

    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    event = (payload.get("event") or "").strip()
    if event not in SUPPORTED_EVENTS:
        raise HTTPException(status_code=400, detail=f"Unsupported event: {event}")

    session = payload.get("session") or {}
    crm_lead_ref = (session.get("crm_lead_ref") or payload.get("crm_lead_ref") or "").strip()
    if not crm_lead_ref:
        raise HTTPException(status_code=400, detail="Missing crm_lead_ref")

    # Lead reference validation — must map to an existing Meta lead.
    lead = await db.meta_leads.find_one({"lead_id": crm_lead_ref})
    if not lead:
        raise HTTPException(status_code=404, detail="Unknown crm_lead_ref")

    await _upsert_qualification(crm_lead_ref, session, event=event)

    if event == "callback_requested":
        asyncio.create_task(_notify_gp_callback(lead))

    return {"ok": True, "event": event, "crm_lead_ref": crm_lead_ref}


# =========================== reconciliation (no retries from chatbot) ===========================
_reconcile_started = False


async def _reconcile_once():
    """Pull authoritative sessions for leads that have a link but are not yet completed,
    plus open callback tasks. Conservative: only stale, incomplete profiles are refreshed."""
    if not _configured():
        return
    # 1) Refresh incomplete, linked profiles.
    cursor = db.meta_chatbot_qualifications.find(
        {"secure_link": {"$ne": None},
         "$or": [{"qualification.completed": {"$ne": True}}, {"qualification": None}]},
        {"_id": 0, "crm_lead_ref": 1},
    )
    refs = [d["crm_lead_ref"] async for d in cursor]
    for ref in refs[:200]:  # cap per tick
        try:
            resp = await _chatbot_request("GET", f"/api/crm/chatbot/sessions/{ref}")
            session = resp.json() if resp.content else {}
            session = session.get("session", session) if isinstance(session, dict) else {}
            await _upsert_qualification(ref, session, event="reconcile")
        except HTTPException:
            continue
        except Exception as e:
            logger.warning(f"Reconcile session {ref} failed: {e}")

    # 2) Reconcile open callback tasks -> ensure GP notified.
    try:
        resp = await _chatbot_request("GET", "/api/crm/chatbot/tasks", params={"status": "open"})
        data = resp.json() if resp.content else {}
        tasks = data.get("tasks", data) if isinstance(data, dict) else data
        for t in (tasks or []):
            ref = (t.get("crm_lead_ref") or "").strip()
            tid = str(t.get("id") or t.get("task_id") or "")
            if not ref or not tid:
                continue
            seen = await db.meta_chatbot_tasks.find_one({"task_id": tid})
            if seen:
                continue
            await db.meta_chatbot_tasks.insert_one({"task_id": tid, "crm_lead_ref": ref,
                                                    "type": t.get("type"), "at": _now_iso()})
            if (t.get("type") or "").lower() in ("callback", "callback_requested"):
                lead = await db.meta_leads.find_one({"lead_id": ref})
                if lead:
                    await _notify_gp_callback(lead)
    except Exception as e:
        logger.warning(f"Reconcile tasks failed: {e}")


async def _reconcile_loop():
    await asyncio.sleep(40)
    while True:
        try:
            await _reconcile_once()
        except Exception as e:
            logger.warning(f"Chatbot reconcile tick failed: {e}")
        await asyncio.sleep(RECONCILE_INTERVAL)


def start_chatbot_reconcile():
    global _reconcile_started
    if _reconcile_started or not RECONCILE_ENABLED:
        return
    if not _configured():
        logger.info("Chatbot reconcile not started (integration not configured)")
        return
    _reconcile_started = True
    asyncio.create_task(_reconcile_loop())
    logger.info(f"Chatbot reconcile scheduler started (every {RECONCILE_INTERVAL}s)")
