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
from datetime import datetime, timezone, timedelta
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
LINK_TTL_DAYS = int(os.environ.get("WHATSAPP_LINK_TTL_DAYS", "30"))

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
    # Fail fast: return a clean JSON error well before any gateway/Cloudflare timeout,
    # so a slow/unreachable chatbot never surfaces as an "invalid/incomplete origin response".
    timeout = httpx.Timeout(15.0, connect=8.0)
    try:
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as hc:
            resp = await hc.request(method, url, headers=headers, json=json_body, params=params)
    except httpx.TimeoutException:
        logger.error(f"Chatbot request {method} {path} timed out")
        raise HTTPException(status_code=504, detail="Chatbot service did not respond in time. Please try again.")
    except httpx.HTTPError as e:
        logger.error(f"Chatbot request {method} {path} failed: {type(e).__name__}")
        raise HTTPException(status_code=502, detail="Could not reach the chatbot service. Please try again shortly.")
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
        "outstanding_balance": _pick(raw, "outstanding_balance", "outstanding", "balance", "outstanding_amount", "total_outstanding"),
        "interest_rate": _pick(raw, "interest_rate", "roi", "rate"),
        "monthly_emi": _pick(raw, "monthly_emi", "emi", "emi_amount", "total_emi", "monthly_payment"),
        "count": _pick(raw, "number_of_loans", "count", "loan_count", "num_loans", "no_of_loans", default=1) or 1,
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


_GROUP_TYPE_LABELS = {
    "personal_loan": "Personal Loan", "home_loan": "Home Loan", "car_loan": "Car Loan",
    "two_wheeler_loan": "Two-Wheeler Loan", "business_loan": "Business Loan",
    "lap": "Loan Against Property", "education_loan": "Education Loan", "gold_loan": "Gold Loan",
    "credit_card": "Credit Card Outstanding", "consumer_durable_loan": "Consumer Durable Loan",
    "overdraft": "Overdraft", "other": "Other",
}


def _num_val(v):
    try:
        return float(v) if v not in (None, "") else 0.0
    except Exception:
        return 0.0


def _build_loan_groups(loans: list) -> list:
    """Aggregate individual or already-grouped loans into per-loan-type groups:
    (loan_type, label, count, total_outstanding, total_emi)."""
    groups = {}
    for l in loans:
        ctype = _map_loan_type(l.get("loan_type")) or "other"
        label = _GROUP_TYPE_LABELS.get(ctype) or (str(l.get("loan_type")).title() if l.get("loan_type") else "Other")
        g = groups.setdefault(ctype, {"loan_type": ctype, "label": label, "count": 0,
                                      "total_outstanding": 0.0, "total_emi": 0.0})
        g["count"] += int(l.get("count") or 1)
        g["total_outstanding"] += _num_val(l.get("outstanding_balance"))
        g["total_emi"] += _num_val(l.get("monthly_emi"))
    return [{"loan_type": g["loan_type"], "label": g["label"], "count": g["count"],
             "total_outstanding": round(g["total_outstanding"]), "total_emi": round(g["total_emi"])}
            for g in groups.values()]


def _normalize_session(session: dict) -> dict:
    """Map the real Bankezee chatbot session object to CRM display fields.
    Real schema keys: chatbot_status, questions_completed/total, current_step, last_activity,
    created_at, customer{}, answers{}, existing_loans[], summary{}, documents[], callback{},
    whatsapp{message,...}, submitted_at. The full raw session is also stored for safety.
    Keeps prefill-compatible output keys (net_monthly_salary, company_name, city, cibil_score,
    loans[], total_monthly_obligations, emi_to_salary_ratio)."""
    answers = session.get("answers") if isinstance(session.get("answers"), dict) else {}
    customer = session.get("customer") if isinstance(session.get("customer"), dict) else {}
    summary = session.get("summary") if isinstance(session.get("summary"), dict) else {}
    src = {**session, **customer, **answers}  # search answers + customer too

    loans_raw = session.get("existing_loans") or _pick(session, "loans", "obligations", default=[]) or []
    docs_raw = session.get("documents") or []
    loans = [_normalize_loan(l) for l in loans_raw if isinstance(l, dict)]
    docs = [_normalize_document(x) for x in docs_raw if isinstance(x, dict)]
    loan_groups = _build_loan_groups(loans)
    total_loans = sum(int(g.get("count") or 0) for g in loan_groups)
    total_outstanding = sum(float(g.get("total_outstanding") or 0) for g in loan_groups)
    total_monthly_emi = sum(float(g.get("total_emi") or 0) for g in loan_groups)

    # Total monthly obligations = total monthly EMI (never the outstanding balance).
    if loan_groups:
        total_oblig = total_monthly_emi or None
    else:
        total_oblig = _pick(summary, "total_monthly_emi", "total_monthly_obligations") \
            or _pick(src, "total_monthly_emi", "total_emi")

    net_salary = _pick(src, "net_monthly_salary", "net_salary", "take_home_salary",
                       "monthly_take_home", "monthly_salary", "salary", "income")
    ratio = _pick(summary, "emi_to_salary_ratio_pct") or _pick(src, "emi_to_salary_ratio", "foir", "emi_ratio")
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

    payslip = _pick(src, "payslip_status", "payslip_uploaded") or _doc_status("payslip", "salary", "pay slip")
    credit = _pick(src, "credit_report_status", "credit_report_uploaded", "cibil_report_status") \
        or _doc_status("credit", "cibil", "bureau")

    # Company vs City — never let the employer name leak into the City field.
    company = _pick(src, "company_name", "company", "employer", "employer_name")
    city = _pick(src, "city", "current_city", "home_city", "location")
    if city and company and str(city).strip().lower() == str(company).strip().lower():
        city = None
    cibil_val = _pick(src, "cibil_score", "cibil", "credit_score")
    credit_uploaded = bool(_doc_status("credit", "cibil", "bureau")) or ("upload" in str(credit or "").lower())
    loans_pending_cr = bool(credit_uploaded and not loans and not cibil_val)

    qc = _pick(session, "questions_completed", "questions_answered", "answered_count", default=0) or 0
    qt = _pick(session, "questions_total", "total_questions", default=0) or 0
    try:
        progress = round(float(qc) / float(qt) * 100) if qt else 0
    except Exception:
        progress = 0

    status = _pick(session, "chatbot_status", "status", "state", default="not_started")
    completed = str(status).lower() in ("completed", "complete", "done") or bool(session.get("submitted_at"))

    cb = session.get("callback") if isinstance(session.get("callback"), dict) else {}
    callback_requested = bool(cb.get("requested")) or bool(_pick(session, "callback_requested", default=False))

    return {
        "chatbot_status": status,
        "progress": progress,
        "completed": completed,
        "questions_completed": qc,
        "questions_total": qt,
        "current_step": session.get("current_step"),
        "last_activity": session.get("last_activity"),
        "session_created_at": session.get("created_at"),
        "net_monthly_salary": net_salary,
        "company_name": company,
        "city": city,
        "cibil_score": cibil_val,
        "cibil_bureau": _pick(src, "cibil_bureau", "bureau", "credit_bureau"),
        "total_monthly_obligations": total_oblig,
        "total_loans": total_loans,
        "total_outstanding": round(total_outstanding) if total_outstanding else None,
        "total_monthly_emi": round(total_monthly_emi) if total_monthly_emi else None,
        "loan_groups": loan_groups,
        "loans_pending_credit_report": loans_pending_cr,
        "emi_to_salary_ratio": ratio,
        "payslip_status": payslip,
        "credit_report_status": credit,
        "loans": loans,
        "documents": docs,
        "answers": answers,
        "summary": summary,
        "callback_requested": callback_requested,
        "callback_requests": [cb] if callback_requested else [],
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


def _recover_link(prof: dict) -> Optional[str]:
    """Return the stored secure_link, or recover it from the raw session's whatsapp.message."""
    if prof.get("secure_link"):
        return prof["secure_link"]
    raw = prof.get("raw_session") or {}
    import re as _re
    for blob in [(raw.get("whatsapp") or {}).get("message", ""), str(raw.get("secure_link") or "")]:
        m = _re.search(r"https?://\S*/loan-review/[^\s)]+", blob or "")
        if m:
            return m.group(0).rstrip(".,")
    return None


def _compute_stage(prof: dict) -> dict:
    """Derive funnel fields: stage (Not Started|In Progress|Completed|Expired), link dates."""
    q = prof.get("qualification") or {}
    created = prof.get("link_created_at") or q.get("session_created_at")
    expires = None
    if created:
        try:
            expires = (datetime.fromisoformat(created) + timedelta(days=LINK_TTL_DAYS)).isoformat()
        except Exception:
            expires = None
    is_expired = False
    if expires:
        try:
            is_expired = datetime.fromisoformat(expires) < datetime.now(timezone.utc)
        except Exception:
            is_expired = False
    if q.get("completed"):
        stage = "Completed"
    elif (q.get("questions_completed") or 0) > 0 or str(q.get("chatbot_status") or "").lower() == "in_progress":
        stage = "Expired" if is_expired else "In Progress"
    else:
        stage = "Expired" if (is_expired and prof.get("secure_link")) else "Not Started"
    return {"stage": stage, "link_created_at": created, "link_expires_at": expires, "link_expired": is_expired}


async def ensure_chatbot_link(lead: dict, *, renew: bool = False) -> Optional[str]:
    """Reusable (auth-free) link acquisition for internal automation (e.g. WhatsApp auto-send).
    Reuses a previously stored secure_link unless renew=True. Saves the link immediately because
    the chatbot API only returns it on first issuance for a lead."""
    lead_id = lead.get("lead_id")
    prof = await _get_profile(lead_id)
    if prof and prof.get("secure_link") and not renew:
        return prof.get("secure_link")
    payload = {
        "crm_lead_ref": lead_id,
        "name": lead.get("full_name") or "",
        "phone": lead.get("phone") or lead.get("phone_norm") or "",
        "whatsapp_consent": True,
        "renew": bool(renew),
    }
    resp = await _chatbot_request("POST", "/api/crm/chatbot/links", json_body=payload)
    data = resp.json() if resp.content else {}
    secure_link = data.get("secure_link")
    now = _now_iso()
    update = {"crm_lead_ref": lead_id, "updated_at": now}
    if secure_link:
        update["secure_link"] = secure_link
        update["link_created_at"] = now
    elif prof and prof.get("secure_link"):
        secure_link = prof.get("secure_link")  # API returned null -> reuse stored
    await db.meta_chatbot_qualifications.update_one(
        {"crm_lead_ref": lead_id},
        {"$set": update, "$setOnInsert": {"created_at": now}},
        upsert=True,
    )
    return secure_link


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

    # Reuse any recoverable link (stored, or recovered from a prior session) unless explicit renew.
    if existing and not inp.renew:
        recovered = _recover_link(existing)
        if recovered:
            return {"secure_link": recovered, "reused": True, "crm_lead_ref": lead_id}

    payload = {
        "crm_lead_ref": lead_id,
        "name": lead.get("full_name") or "",
        "phone": lead.get("phone") or "",
        "whatsapp_consent": bool(inp.whatsapp_consent),
        "renew": bool(inp.renew),
    }
    try:
        resp = await _chatbot_request("POST", "/api/crm/chatbot/links", json_body=payload)
        data = resp.json() if resp.content else {}
        secure_link = data.get("secure_link")
    except HTTPException as e:
        # Create failed (timeout/unreachable). Attempt READ-ONLY recovery of an already-issued
        # link from an existing session — never renew/invalidate on failure.
        if not inp.renew:
            try:
                s = await _chatbot_request("GET", f"/api/crm/chatbot/sessions/{lead_id}")
                session = s.json() if s.content else {}
                session = session.get("session", session) if isinstance(session, dict) else {}
                prof2 = await _upsert_qualification(lead_id, session, event="link_recovery")
                recovered = _recover_link(prof2)
                if recovered:
                    return {"secure_link": recovered, "reused": True, "recovered": True, "crm_lead_ref": lead_id}
            except HTTPException:
                pass
        raise e
    now = _now_iso()

    update = {"crm_lead_ref": lead_id, "updated_at": now,
              "whatsapp_consent": bool(inp.whatsapp_consent)}
    if secure_link:
        update["secure_link"] = secure_link
        update["link_created_at"] = now
    elif existing and _recover_link(existing):
        # API returned null because an existing link is still valid — reuse stored/recovered link.
        secure_link = _recover_link(existing)
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
    out["secure_link"] = _recover_link(prof)
    out.update(_compute_stage(prof))
    return out


@router.get("/chatbot/report")
async def chatbot_funnel_report(stage: Optional[str] = None, user: dict = Depends(require_meta_access)):
    """Funnel report: which leads received WhatsApp, opened the chatbot, started answering,
    completed qualification or abandoned. Staff see all; GP/processor see only their own."""
    role, uid = _ctx(user)
    is_staff = role in STAFF_ROLES

    profs = {p["crm_lead_ref"]: p async for p in db.meta_chatbot_qualifications.find({})}
    wa_ids = {d["lead_id"] async for d in db.meta_leads.find(
        {"whatsapp.wamid": {"$exists": True}}, {"lead_id": 1})}
    lead_ids = list(set(profs.keys()) | wa_ids)

    rows, counts = [], {"total": 0, "wa_sent": 0, "link_created": 0, "opened": 0,
                        "in_progress": 0, "completed": 0, "expired": 0, "abandoned": 0}
    for lid in lead_ids:
        lead = await db.meta_leads.find_one({"lead_id": lid})
        if not lead:
            continue
        if not is_staff and uid not in (lead.get("assigned_partner_id"), lead.get("assigned_processor_id")):
            continue
        prof = profs.get(lid) or {}
        q = prof.get("qualification") or {}
        wa = lead.get("whatsapp") or {}
        st = _compute_stage(prof) if prof else {"stage": "Not Started", "link_expires_at": None, "link_expired": False}
        qc = q.get("questions_completed") or 0

        # abandoned = started but not completed and no activity for >48h
        abandoned = False
        if st["stage"] == "In Progress" and q.get("last_activity"):
            try:
                abandoned = (datetime.now(timezone.utc) - datetime.fromisoformat(q["last_activity"])) > timedelta(hours=48)
            except Exception:
                abandoned = False

        row = {
            "lead_id": lid,
            "name": lead.get("full_name"),
            "phone": lead.get("phone"),
            "source": "Website" if (lead.get("source_tab") or "").lower() == "website" else "Meta",
            "lead_status": lead.get("status"),
            "whatsapp_sent": bool(wa.get("wamid")),
            "whatsapp_status": wa.get("status"),
            "whatsapp_sent_at": wa.get("sent_at"),
            "link_created": bool(prof.get("secure_link") or _recover_link(prof) if prof else False),
            "stage": st["stage"],
            "questions_completed": qc,
            "questions_total": q.get("questions_total") or 0,
            "last_activity": q.get("last_activity"),
            "link_expires_at": st.get("link_expires_at"),
            "abandoned": abandoned,
        }
        if stage and row["stage"] != stage:
            continue
        rows.append(row)
        counts["total"] += 1
        if row["whatsapp_sent"]:
            counts["wa_sent"] += 1
        if row["link_created"]:
            counts["link_created"] += 1
        if qc > 0:
            counts["opened"] += 1
        if row["stage"] == "In Progress":
            counts["in_progress"] += 1
        if row["stage"] == "Completed":
            counts["completed"] += 1
        if row["stage"] == "Expired":
            counts["expired"] += 1
        if abandoned:
            counts["abandoned"] += 1

    rows.sort(key=lambda r: r.get("last_activity") or r.get("whatsapp_sent_at") or "", reverse=True)
    return {"counts": counts, "rows": rows}


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
    out["secure_link"] = _recover_link(prof)
    out.update(_compute_stage(prof))
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


@router.post("/leads/{lead_id}/chatbot/apply-to-file")
async def apply_qualification_to_file(lead_id: str, user: dict = Depends(require_meta_access)):
    """Controlled repair: pull the latest chatbot session, then prefill EMPTY File fields
    (structured existing_loans, obligations_emi, foir, cibil_score, employment). Never recreates
    the File, never overwrites agent-entered values, never deletes/duplicates manual loans.
    Admin/ops/assigned GP/assigned processor only."""
    lead, role, uid = await _lead_guard(lead_id, user)
    # Best-effort refresh so we apply the freshest session (non-fatal if the chatbot is slow).
    try:
        resp = await _chatbot_request("GET", f"/api/crm/chatbot/sessions/{lead_id}")
        session = resp.json() if resp.content else {}
        session = session.get("session", session) if isinstance(session, dict) else {}
        await _upsert_qualification(lead_id, session, event="apply_to_file")
    except HTTPException:
        pass
    before = lead.get("file") or {}
    await prefill_file_from_qualification(lead_id)
    after_lead = await db.meta_leads.find_one({"lead_id": lead_id})
    after = after_lead.get("file") or {}
    return {
        "ok": True,
        "existing_loans_before": len(before.get("existing_loans") or []),
        "existing_loans_after": len(after.get("existing_loans") or []),
        "loan_groups": after.get("loan_groups") or [],
        "monthly_emi_obligations": after.get("monthly_emi"),
        "foir": after.get("foir"),
        "cibil": after.get("cibil"),
    }


# =========================== File prefill (manual convert only) ===========================
_LOAN_TYPE_MAP = [
    ("personal", "personal_loan"), ("home", "home_loan"), ("car", "car_loan"),
    ("auto", "car_loan"), ("two whee", "two_wheeler_loan"), ("2 whee", "two_wheeler_loan"),
    ("educat", "education_loan"), ("business", "business_loan"), ("credit card", "credit_card"),
    ("card", "credit_card"), ("overdraft", "overdraft"), ("lap", "lap"), ("gold", "gold_loan"),
]
_BANK_MAP = [
    ("hdfc", "hdfc"), ("icici", "icici"), ("sbi", "sbi"), ("axis", "axis"), ("kotak", "kotak"),
    ("indusind", "indusind"), ("yes", "yes"), ("bajaj", "bajaj"), ("tata", "tata_capital"),
    ("idfc", "idfc"),
]


def _map_loan_type(raw):
    s = str(raw or "").strip().lower()
    for key, val in _LOAN_TYPE_MAP:
        if key in s:
            return val
    return "other" if s else ""


def _map_bank(raw):
    s = str(raw or "").strip()
    low = s.lower()
    for key, val in _BANK_MAP:
        if key in low:
            return val
    return s  # keep the real lender name (field allows custom values, e.g. "KreditBee")


def _to_structured_loan(l: dict) -> dict:
    tenure = l.get("original_tenure")
    try:
        if l.get("original_tenure") not in (None, "") and l.get("emis_paid") not in (None, ""):
            tenure = float(l.get("original_tenure")) - float(l.get("emis_paid"))
    except Exception:
        tenure = l.get("original_tenure")
    return {
        # keys read by ExistingLoansEditor (File Details page)
        "loan_type": _map_loan_type(l.get("loan_type")),
        "bank": _map_bank(l.get("lender")),
        "loan_amount": l.get("original_amount") if l.get("original_amount") not in (None, "") else "",
        "sanction_date": l.get("sanction_date") or "",
        "outstanding": l.get("outstanding_balance") if l.get("outstanding_balance") not in (None, "") else "",
        "roi": l.get("interest_rate") if l.get("interest_rate") not in (None, "") else "",
        "emi": l.get("monthly_emi") if l.get("monthly_emi") not in (None, "") else "",
        "count": l.get("count") or 1,
        "number_of_loans": l.get("count") or 1,
        # keys read by ExistingLoansSection (compatibility)
        "type": _map_loan_type(l.get("loan_type")),
        "original_amount": l.get("original_amount") if l.get("original_amount") not in (None, "") else "",
        "start_date": l.get("sanction_date") or "",
        "interest_rate": l.get("interest_rate") if l.get("interest_rate") not in (None, "") else "",
        "tenure_remaining": tenure if tenure not in (None, "") else "",
        # provenance
        "source": "chatbot",
        "loan_id": l.get("loan_id") or "",
    }


async def prefill_file_from_qualification(lead_id: str):
    """Maps chatbot qualification into the STRUCTURED File fields the File Details page reads
    (existing_loans[], obligations_emi, foir, cibil_score, employment). Fill-when-empty only:
    never overwrites agent-entered values, never duplicates/removes manually entered loans."""
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

        changed = {}

        # 1) Structured existing_loans[] — only if none present (preserve manual entries, no dupes).
        current_loans = existing_file.get("existing_loans")
        if (not isinstance(current_loans, list) or len(current_loans) == 0) and loans:
            changed["existing_loans"] = [_to_structured_loan(l) for l in loans]

        # 2) Aggregate monthly EMI obligations. Canonical key read by the Meta File is `monthly_emi`
        # (compat maps file.monthly_emi -> monthly_emi_obligations). Fill-when-empty only.
        total_oblig = q.get("total_monthly_obligations")
        if total_oblig in (None, "") and loans:
            try:
                total_oblig = sum(float(l.get("monthly_emi") or 0) for l in loans) or None
            except Exception:
                total_oblig = None
        if total_oblig not in (None, "") and existing_file.get("monthly_emi") in (None, "", 0, "0"):
            changed["monthly_emi"] = total_oblig

        # 3) FOIR / EMI-to-salary ratio.
        if q.get("emi_to_salary_ratio") not in (None, "") and existing_file.get("foir") in (None, "", 0, "0"):
            changed["foir"] = q.get("emi_to_salary_ratio")

        # 4) Simple scalar fields using the canonical lead.file keys the compat layer reads:
        # CIBIL -> `cibil`, employment -> `employment_type`, salary -> `net_salary`.
        scalars = {
            "cibil": q.get("cibil_score"),
            "company_name": q.get("company_name"),
            "net_salary": q.get("net_monthly_salary"),
            "employment_type": _pick(q.get("answers") or {}, "employment_type", "employment_status",
                                     "employment", "are_you"),
            "loan_amount_required": _pick(q.get("answers") or {}, "loan_amount_required", "loan_amount",
                                          "required_loan_amount", "desired_loan_amount"),
        }
        for k, v in scalars.items():
            if v in (None, "", []):
                continue
            if existing_file.get(k) in (None, "", []):
                changed[k] = v

        # Grouped loan view (loan_type, count, total_outstanding, total_emi) — fill when empty.
        if not existing_file.get("loan_groups") and q.get("loan_groups"):
            changed["loan_groups"] = q.get("loan_groups")
        if q.get("loans_pending_credit_report") and not loans:
            changed["loans_pending_credit_report"] = True

        # Attach chatbot payslip / credit report to the File documents (no dupes by chatbot id).
        existing_docs = lead.get("documents") or []
        have_cb = {d.get("chatbot_doc_id") for d in existing_docs if d.get("chatbot_doc_id")}
        new_docs = []
        for d in (q.get("documents") or []):
            did = d.get("doc_id")
            t = (d.get("type") or d.get("name") or "").lower()
            if not did or did in have_cb:
                continue
            if any(k in t for k in ("credit", "cibil", "bureau")):
                category = "CIBIL / Credit Report"
            elif any(k in t for k in ("payslip", "salary", "pay slip")):
                category = "Latest Payslip"
            else:
                continue
            new_docs.append({
                "doc_id": f"cb_{did}", "chatbot_doc_id": did,
                "filename": d.get("name") or f"{category}.pdf",
                "content_type": "application/pdf", "category": category,
                "source": "chatbot", "at": d.get("uploaded_at") or _now_iso(),
            })

        # City maps to the existing lead-level field.
        lead_set = {}
        if q.get("city") and lead.get("city") in (None, "", []):
            lead_set["city"] = q.get("city")

        if not changed and not lead_set and not new_docs:
            return
        set_doc = {"updated_at": _now_iso(), **lead_set}
        if changed:
            set_doc["file"] = {**existing_file, **changed}
        n_loans = len(changed.get("existing_loans", [])) if "existing_loans" in changed else 0
        detail = f"File prefilled from chatbot: {len(changed)} field(s)"
        if n_loans:
            detail += f", {n_loans} existing loan(s)"
        if new_docs:
            detail += f", {len(new_docs)} document(s)"
        push = {"activities": {"type": "chatbot", "detail": f"{detail} — please review", "at": _now_iso()}}
        if new_docs:
            push["documents"] = {"$each": new_docs}
        await db.meta_leads.update_one({"lead_id": lead_id}, {"$set": set_doc, "$push": push})
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

    # If already converted to FILE, flow new loan/qualification data into EMPTY File fields
    # (fill-only; never overwrites agent-verified values, never deletes manual loans).
    if lead.get("status") == "FILE" and event in ("loan_saved", "loan_deleted", "completed", "progress_updated"):
        asyncio.create_task(prefill_file_from_qualification(crm_lead_ref))

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
