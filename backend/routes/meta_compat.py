"""
Meta File-Detail compatibility adapter (/api/meta/files-compat/*).

Purpose: let the EXISTING Connect File Detail UI (web FileDetailsPage.js and mobile
FileDetailScreen.js) render Meta files without duplicating the component. Every endpoint here
speaks the EXACT Connect File-Detail JSON contract but reads/writes the ISOLATED meta_leads
collection. No Meta data is migrated into Connect files; Meta stays in meta_* collections.

Security reuses meta.py's helpers: require_meta_access is the master gate, meta_role governs
permissions and meta_user_id governs ownership/scoping. Permissions mirror Connect:
  admin / ops  -> full edit
  processor    -> edit (banks + status), only for files assigned to them
  growth_partner -> edit customer info, VIEW-ONLY banks/status, only their own files
"""
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Response
from typing import Optional, List
import uuid

from utils.database import db
from utils.auth import require_meta_access
from utils.helpers import serialize_doc
from utils import meta_storage
from routes.meta import (
    _get_lead_or_404, _ctx, _now_iso, STAFF_ROLES,
    PROCESSING_STATUSES, ALLOWED_DOC_TYPES, MAX_DOC_BYTES,
)
from routes.files_crm import calculate_star_rating

router = APIRouter(prefix="/api/meta/files-compat", tags=["Meta File-Detail Compat"])

BANK_EDIT_ROLES = {"admin", "ops", "processor"}


# --------------------------- permission helpers ---------------------------
def _perm(user: dict, lead: dict):
    """Return (can_edit_info, can_edit_bank, is_admin) mirroring Connect File-Detail RBAC."""
    role, uid = _ctx(user)
    is_admin = role == "admin"
    is_staff = role in STAFF_ROLES  # admin/ops
    assigned_proc = role == "processor" and lead.get("assigned_processor_id") == uid
    assigned_gp = role == "growth_partner" and lead.get("assigned_partner_id") == uid
    can_edit_info = is_staff or assigned_proc or assigned_gp
    can_edit_bank = is_staff or assigned_proc
    return can_edit_info, can_edit_bank, is_admin


def _authorize_read(user: dict, lead: dict):
    role, uid = _ctx(user)
    if role in STAFF_ROLES:
        return
    if role == "growth_partner" and lead.get("assigned_partner_id") == uid:
        return
    if role == "processor" and lead.get("assigned_processor_id") == uid:
        return
    raise HTTPException(status_code=403, detail="Not authorized for this Meta file")


# --------------------------- field mapping ---------------------------
def _yn(v):
    s = str(v).strip().lower()
    if s in ("yes", "true", "1", "y"):
        return "yes"
    if s in ("no", "false", "0", "n"):
        return "no"
    return ""


def _title_yn(v):
    s = _yn(v)
    return "Yes" if s == "yes" else ("No" if s == "no" else "")


def _pick(b, *keys):
    for k in keys:
        val = b.get(k)
        if val not in (None, ""):
            return val
    return ""


def meta_bank_to_connect(b: dict) -> dict:
    """One Meta bank (legacy 'banks' schema OR connect-mirrored) -> Connect eligibility row."""
    appr = str(_pick(b, "approval_status")).strip().lower()
    connect_appr = "approved" if appr == "approved" else ("declined" if appr in ("rejected", "declined") else "")
    row = {
        "bank_name": _pick(b, "bank_name"),
        "is_eligible": _yn(_pick(b, "is_eligible", "eligible")),
        "not_eligible_reason": _pick(b, "not_eligible_reason", "ineligible_reason"),
        "eligible_amount": _pick(b, "eligible_amount"),
        "eligible_roi": _pick(b, "eligible_roi", "roi"),
        "login_done": _yn(_pick(b, "login_done")),
        "login_bank": _pick(b, "login_bank"),
        "application_id": _pick(b, "application_id"),
        "sm_name": _pick(b, "sm_name"),
        "sm_number": _pick(b, "sm_number"),
        "login_rejection_reason": _pick(b, "login_rejection_reason", "login_reason"),
        "approval_status": _pick(b, "approval_status") and connect_appr,
        "approved_bank": _pick(b, "approved_bank"),
        "approved_amount": _pick(b, "approved_amount"),
        "approved_tenure": _pick(b, "approved_tenure", "approval_tenure"),
        "approved_roi": _pick(b, "approved_roi", "approval_roi"),
        "declined_bank": _pick(b, "declined_bank"),
        "declined_reason": _pick(b, "declined_reason"),
        "rc_submitted": _yn(b["rc_submitted"]) if b.get("rc_submitted") else "",
        "rc_not_submitted_reason": _pick(b, "rc_not_submitted_reason"),
        "noc_submitted": _yn(b["noc_submitted"]) if b.get("noc_submitted") else "",
        "noc_not_submitted_reason": _pick(b, "noc_not_submitted_reason"),
        "hypothecation": _yn(b["hypothecation"]) if b.get("hypothecation") else "",
        "hypothecation_not_done_reason": _pick(b, "hypothecation_not_done_reason"),
        "disbursed": _yn(_pick(b, "disbursed")),
        "disbursal_date": _pick(b, "disbursal_date"),
        "disbursed_bank": _pick(b, "disbursed_bank"),
        "disbursed_amount": _pick(b, "disbursed_amount"),
        "disbursed_tenure": _pick(b, "disbursed_tenure"),
        "disbursed_roi": _pick(b, "disbursed_roi"),
        "disbursement_rejection_reason": _pick(b, "disbursement_rejection_reason"),
        "commission_percentage": _pick(b, "commission_percentage", "commission_pct"),
        "commission_amount": _pick(b, "commission_amount"),
        "pf": _pick(b, "pf"),
        "emi": _pick(b, "emi"),
        "first_emi_date": _pick(b, "first_emi_date"),
        "notes": _pick(b, "notes"),
        # transition timestamps (display only)
        "login_done_at": b.get("login_done_at"),
        "approved_at": b.get("approved_at"),
        "rejected_at": b.get("rejected_at"),
        "disbursed_at": b.get("disbursed_at"),
    }
    return row


def connect_bank_to_meta(e: dict, prev: dict | None = None) -> dict:
    """Connect eligibility row -> Meta bank. Stores connect keys AND refreshes the legacy meta
    mirror keys so the old Meta lead-detail view stays consistent. Preserves transition stamps."""
    prev = prev or {}
    m = dict(prev)
    m.update(e)  # keep every Connect field verbatim
    appr = str(e.get("approval_status", "")).strip().lower()
    # legacy meta mirror keys (read by meta/LeadDetail.js FileCard)
    m["eligible"] = _title_yn(e.get("is_eligible"))
    m["ineligible_reason"] = e.get("not_eligible_reason", "")
    m["roi"] = e.get("eligible_roi", "")
    m["login_reason"] = e.get("login_rejection_reason", "")
    m["approval_status"] = ("Approved" if appr == "approved" else ("Rejected" if appr == "declined" else ""))
    m["approval_tenure"] = e.get("approved_tenure", "")
    m["approval_roi"] = e.get("approved_roi", "")
    m["disbursed"] = _title_yn(e.get("disbursed"))
    m["login_done"] = _title_yn(e.get("login_done"))
    m["commission_pct"] = e.get("commission_percentage", "")
    # commission recompute server-side (never trust client)
    try:
        amt = float(e.get("disbursed_amount") or 0)
        pct = float(e.get("commission_percentage") or 0)
        m["commission_amount"] = round(amt * pct / 100, 2) if (m["disbursed"] == "Yes" and amt and pct) else ""
    except (TypeError, ValueError):
        m["commission_amount"] = ""
    # timestamps on transition
    now = _now_iso()
    def stamp(cond_field, cond_val, stamp_field):
        if _yn(e.get(cond_field)) == cond_val and not prev.get(stamp_field):
            m[stamp_field] = now
    stamp("login_done", "yes", "login_done_at")
    if str(e.get("approval_status", "")).lower() == "approved" and not prev.get("approved_at"):
        m["approved_at"] = now
    if str(e.get("approval_status", "")).lower() == "declined" and not prev.get("rejected_at"):
        m["rejected_at"] = now
    stamp("disbursed", "yes", "disbursed_at")
    return m


def _lead_to_file_details(lead: dict) -> dict:
    f = lead.get("file") or {}
    return {
        "full_name": lead.get("full_name") or "",
        "mobile": lead.get("phone") or "",
        "email": lead.get("email") or "",
        "mother_name": f.get("mother_name", ""),
        "current_address": f.get("current_address", ""),
        "employment_type": f.get("employment_type") or lead.get("employment_status") or "",
        "company_name": f.get("company_name", ""),
        "net_salary": f.get("net_salary") or lead.get("monthly_salary") or "",
        "office_address": f.get("office_address", ""),
        "monthly_emi_obligations": f.get("monthly_emi", ""),
        "existing_loan_1": f.get("existing_loan_1", ""),
        "existing_loan_2": f.get("existing_loan_2", ""),
        "existing_loan_3": f.get("existing_loan_3", ""),
        "existing_loans": f.get("existing_loans") if isinstance(f.get("existing_loans"), list) else [],
        "type_of_loan": f.get("loan_type", ""),
        "cibil_score": f.get("cibil", ""),
        "loan_amount_required": f.get("loan_amount", ""),
        "tenure_required": f.get("tenure", ""),
        "source_type": lead.get("platform") or "Agent",
        "growth_partner_name": lead.get("assigned_partner_name") or "",
        "growth_partner_code": "",
        "growth_partner_contact": "",
        "cibil_issues": f.get("cibil_issues", ""),
        "foir": f.get("foir", ""),
        "company_type": f.get("company_type", ""),
    }


def _file_details_to_meta(additional: dict, lead: dict) -> dict:
    """Map incoming Connect file_details back onto the Meta lead.file dict."""
    f = dict(lead.get("file") or {})
    a = additional or {}
    mapping = {
        "mother_name": "mother_name",
        "current_address": "current_address",
        "employment_type": "employment_type",
        "company_name": "company_name",
        "net_salary": "net_salary",
        "office_address": "office_address",
        "monthly_emi_obligations": "monthly_emi",
        "existing_loan_1": "existing_loan_1",
        "existing_loan_2": "existing_loan_2",
        "existing_loan_3": "existing_loan_3",
        "existing_loans": "existing_loans",
        "type_of_loan": "loan_type",
        "cibil_score": "cibil",
        "loan_amount_required": "loan_amount",
        "tenure_required": "tenure",
        "cibil_issues": "cibil_issues",
        "foir": "foir",
        "company_type": "company_type",
    }
    for ck, mk in mapping.items():
        if ck in a:
            f[mk] = a[ck]
    return f


def _to_connect_documents(lead: dict) -> list:
    docs = []
    for d in (lead.get("documents") or []):
        docs.append({
            "id": d.get("doc_id"),
            "name": d.get("filename") or "Document",
            "filename": d.get("filename"),
            "category": d.get("content_type", "general"),
            "size": d.get("size"),
            "uploaded_at": d.get("at"),
            "storage_key": d.get("storage_key"),
            "url": f"/api/meta/files-compat/{lead.get('lead_id')}/documents/{d.get('doc_id')}/download",
        })
    return docs


def _to_connect_activities(lead: dict) -> list:
    acts = []
    for a in (lead.get("activities") or []):
        acts.append({"message": a.get("detail"), "by_name": None, "timestamp": a.get("at")})
    for n in (lead.get("notes") or []):
        acts.append({"message": n.get("text"), "by_name": n.get("author"), "timestamp": n.get("at")})
    acts.sort(key=lambda x: x.get("timestamp") or "")
    return acts


def build_connect_file(lead: dict) -> dict:
    banks = (lead.get("file") or {}).get("banks") or []
    eligibilities = [meta_bank_to_connect(b) for b in banks]
    file_details = _lead_to_file_details(lead)
    doc = {
        "id": lead.get("lead_id"),
        "lead_id": lead.get("lead_id"),
        "name": lead.get("full_name") or "",
        "phone": lead.get("phone") or "",
        "email": lead.get("email") or "",
        "employment_type": file_details["employment_type"],
        "requirement": file_details["type_of_loan"],
        "source_name": lead.get("assigned_partner_name") or "",
        "file_status": lead.get("processing_status") or "New",
        "file_details": file_details,
        "eligibilities": eligibilities,
        "documents": _to_connect_documents(lead),
        "file_activities": _to_connect_activities(lead),
        # meta-specific extras (rendered by the meta wrapper's sidebar, ignored by Connect)
        "meta_status": lead.get("status"),
        "assigned_partner_id": lead.get("assigned_partner_id"),
        "assigned_partner_name": lead.get("assigned_partner_name"),
        "assigned_processor_id": lead.get("assigned_processor_id"),
        "assigned_processor_name": lead.get("assigned_processor_name"),
    }
    # Star rating (formula or admin override), same engine as Connect
    star_source = {"file_details": file_details, "eligibilities": eligibilities,
                   "star_manual": lead.get("star_manual"), "star_rating": lead.get("star_rating"),
                   "star_score": lead.get("star_score"),
                   "star_override_reason": lead.get("star_override_reason"),
                   "star_override_by": lead.get("star_override_by")}
    rating = calculate_star_rating(star_source)
    doc.update(rating)
    doc["star_override_reason"] = lead.get("star_override_reason")
    doc["star_override_by"] = lead.get("star_override_by")
    return doc


# =========================== endpoints ===========================
@router.get("/bank-names")
async def compat_bank_names(user: dict = Depends(require_meta_access)):
    policy_banks = await db.bank_policies.distinct("bank_name", {"is_active": True})
    names = {str(b).strip() for b in policy_banks if str(b or "").strip()}
    return {"banks": sorted(names, key=lambda n: n.lower())}


@router.get("/{lead_id}")
async def compat_get_file(lead_id: str, user: dict = Depends(require_meta_access)):
    lead = await _get_lead_or_404(lead_id)
    _authorize_read(user, lead)
    return build_connect_file(lead)


@router.put("/{lead_id}/details")
async def compat_update_details(lead_id: str, payload: dict, user: dict = Depends(require_meta_access)):
    lead = await _get_lead_or_404(lead_id)
    can_info, _, _ = _perm(user, lead)
    if not can_info:
        raise HTTPException(status_code=403, detail="Not authorized to edit this file")
    additional = payload.get("additional_data") or {}
    new_file = _file_details_to_meta(additional, lead)
    set_fields = {"file": new_file, "updated_at": _now_iso()}
    # top-level identity fields
    if "full_name" in payload:
        set_fields["full_name"] = payload.get("full_name")
    if "mobile" in payload:
        set_fields["phone"] = payload.get("mobile")
    if "email" in payload:
        set_fields["email"] = payload.get("email")
    activity = {"type": "file", "detail": f"{user.get('name')} updated file details", "at": _now_iso()}
    await db.meta_leads.update_one({"lead_id": lead_id}, {"$set": set_fields, "$push": {"activities": activity}})
    return build_connect_file(await _get_lead_or_404(lead_id))


@router.put("/{lead_id}/eligibilities")
async def compat_update_eligibilities(lead_id: str, payload: dict, user: dict = Depends(require_meta_access)):
    lead = await _get_lead_or_404(lead_id)
    _, can_bank, _ = _perm(user, lead)
    if not can_bank:
        raise HTTPException(status_code=403, detail="Not authorized to edit bank eligibilities")
    rows = payload.get("eligibilities") or []
    if len(rows) > 7:
        raise HTTPException(status_code=400, detail="Maximum 7 banks allowed")
    prev_banks = (lead.get("file") or {}).get("banks") or []
    prev_by_name = {str(b.get("bank_name", "")).strip().lower(): b for b in prev_banks}
    new_banks = [connect_bank_to_meta(r, prev_by_name.get(str(r.get("bank_name", "")).strip().lower())) for r in rows]
    new_file = dict(lead.get("file") or {})
    new_file["banks"] = new_banks
    activity = {"type": "file", "detail": f"{user.get('name')} updated bank eligibilities", "at": _now_iso()}
    await db.meta_leads.update_one({"lead_id": lead_id}, {"$set": {"file": new_file, "updated_at": _now_iso()},
                                                          "$push": {"activities": activity}})
    return build_connect_file(await _get_lead_or_404(lead_id))


@router.put("/{lead_id}/file-status")
async def compat_update_status(lead_id: str, payload: dict, user: dict = Depends(require_meta_access)):
    lead = await _get_lead_or_404(lead_id)
    _, can_bank, _ = _perm(user, lead)
    if not can_bank:
        raise HTTPException(status_code=403, detail="Not authorized to update status")
    status = payload.get("file_status")
    if status not in PROCESSING_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid processing status")
    await db.meta_leads.update_one({"lead_id": lead_id}, {"$set": {"processing_status": status, "updated_at": _now_iso()},
        "$push": {"activities": {"type": "processing", "detail": f"Processing status set to '{status}' by {user.get('name')}", "at": _now_iso()}}})
    return build_connect_file(await _get_lead_or_404(lead_id))


@router.put("/{lead_id}/star-rating")
async def compat_star_rating(lead_id: str, payload: dict, user: dict = Depends(require_meta_access)):
    lead = await _get_lead_or_404(lead_id)
    role, _ = _ctx(user)
    if role != "admin":
        raise HTTPException(status_code=403, detail="Only Meta Admin can override star rating")
    if payload.get("star_manual") is False:
        set_fields = {"star_manual": False, "star_override_reason": None, "star_override_by": None, "updated_at": _now_iso()}
    else:
        set_fields = {"star_manual": True, "star_rating": int(payload.get("star_rating") or 3),
                      "star_override_reason": payload.get("reason") or "",
                      "star_override_by": user.get("name"), "updated_at": _now_iso()}
    await db.meta_leads.update_one({"lead_id": lead_id}, {"$set": set_fields})
    return build_connect_file(await _get_lead_or_404(lead_id))


@router.post("/{lead_id}/notes")
async def compat_add_note(lead_id: str, payload: dict, user: dict = Depends(require_meta_access)):
    lead = await _get_lead_or_404(lead_id)
    can_info, _, _ = _perm(user, lead)
    if not can_info:
        raise HTTPException(status_code=403, detail="Not authorized")
    text = (payload.get("note") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Note cannot be empty")
    note = {"text": text, "author": user.get("name"), "at": _now_iso()}
    activity = {"type": "note", "detail": f"{user.get('name')} added a note", "at": _now_iso()}
    await db.meta_leads.update_one({"lead_id": lead_id},
                                   {"$push": {"notes": note, "activities": activity}, "$set": {"updated_at": _now_iso()}})
    return build_connect_file(await _get_lead_or_404(lead_id))


@router.post("/{lead_id}/documents")
async def compat_upload_documents(lead_id: str, files: List[UploadFile] = File(...), user: dict = Depends(require_meta_access)):
    lead = await _get_lead_or_404(lead_id)
    can_info, _, _ = _perm(user, lead)
    if not can_info:
        raise HTTPException(status_code=403, detail="Not authorized")
    uploaded = []
    for f in files:
        ctype = (f.content_type or "").lower()
        if ctype not in ALLOWED_DOC_TYPES:
            raise HTTPException(status_code=400, detail=f"Only PDF, PNG and JPG allowed ({f.filename})")
        data = await f.read()
        if len(data) > MAX_DOC_BYTES:
            raise HTTPException(status_code=400, detail=f"{f.filename} exceeds 10MB limit")
        doc_id = uuid.uuid4().hex
        ext = (f.filename.rsplit(".", 1)[-1] if "." in (f.filename or "") else "bin").lower()
        path = f"{meta_storage.APP_PREFIX}/documents/{lead_id}/{doc_id}.{ext}"
        try:
            result = meta_storage.put_object(path, data, ctype)
        except Exception:
            raise HTTPException(status_code=502, detail="Document storage upload failed")
        doc = {"doc_id": doc_id, "storage_key": result.get("path", path), "filename": f.filename,
               "content_type": ctype, "size": len(data), "uploaded_by": user.get("name"), "at": _now_iso()}
        await db.meta_leads.update_one({"lead_id": lead_id}, {"$push": {"documents": doc}, "$set": {"updated_at": _now_iso()}})
        uploaded.append(doc)
    return {"uploaded": uploaded}


@router.get("/{lead_id}/documents/{doc_id}/download")
async def compat_download_document(lead_id: str, doc_id: str, user: dict = Depends(require_meta_access)):
    lead = await _get_lead_or_404(lead_id)
    _authorize_read(user, lead)
    doc = next((d for d in (lead.get("documents") or []) if d.get("doc_id") == doc_id), None)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if not doc.get("storage_key"):
        legacy = await _read_legacy_binary(doc_id)
        if legacy:
            content, ctype = legacy
            return Response(content=content, media_type=doc.get("content_type") or ctype,
                            headers={"Content-Disposition": f'attachment; filename="{doc.get("filename") or doc_id}"'})
        raise HTTPException(status_code=409, detail="Document migration pending")
    try:
        content, ctype = meta_storage.get_object(doc["storage_key"])
    except Exception:
        raise HTTPException(status_code=404, detail="Document not found in storage")
    return Response(content=content, media_type=doc.get("content_type") or ctype,
                    headers={"Content-Disposition": f'attachment; filename="{doc.get("filename") or doc_id}"'})


@router.delete("/{lead_id}/documents/{doc_id}")
async def compat_delete_document(lead_id: str, doc_id: str, user: dict = Depends(require_meta_access)):
    lead = await _get_lead_or_404(lead_id)
    can_info, _, _ = _perm(user, lead)
    if not can_info:
        raise HTTPException(status_code=403, detail="Not authorized")
    await db.meta_leads.update_one({"lead_id": lead_id}, {"$pull": {"documents": {"doc_id": doc_id}}})
    return {"ok": True}


async def _read_legacy_binary(doc_id: str):
    """Serve a legacy Meta document from the meta_fs GridFS bucket once its binary has been
    migrated (meta_fs.files.binary_pending == False and chunks exist). Returns (bytes, ctype)."""
    f = await db["meta_fs.files"].find_one({"_id": doc_id})
    if not f or f.get("binary_pending"):
        return None
    chunks = await db["meta_fs.chunks"].find({"files_id": doc_id}).sort("n", 1).to_list(100000)
    if not chunks:
        return None
    data = b"".join(bytes(c["data"]) for c in chunks)
    ctype = (f.get("metadata") or {}).get("content_type") or "application/octet-stream"
    return data, ctype


@router.post("/{lead_id}/check-eligibility")
async def compat_check_eligibility(lead_id: str, user: dict = Depends(require_meta_access)):
    lead = await _get_lead_or_404(lead_id)
    _authorize_read(user, lead)
    from routes.bank_policies import analyze_eligibility
    connect = build_connect_file(lead)
    synth = {
        "file_details": connect["file_details"],
        "full_name": connect["name"],
        "name": connect["name"],
        "requirement": connect["requirement"],
        "eligibilities": connect["eligibilities"],
    }
    result = await analyze_eligibility(synth, lead_id, user.get("name", "System"))
    # Store history on the ISOLATED meta lead (never touch Connect's db.leads)
    await db.meta_leads.update_one({"lead_id": lead_id}, {"$push": {"eligibility_checks": {
        "id": result["id"], "generated_at": result["generated_at"],
        "eligible_count": result["eligible_count"], "total_policies": result["total_policies"],
        "profile_strength": result["profile_strength"], "generated_by": result.get("generated_by")}}})
    return result


@router.get("/{lead_id}/eligibility-history")
async def compat_eligibility_history(lead_id: str, user: dict = Depends(require_meta_access)):
    lead = await _get_lead_or_404(lead_id)
    _authorize_read(user, lead)
    hist = list(reversed(lead.get("eligibility_checks") or []))[:20]
    return hist


@router.get("/{lead_id}/lead")
async def compat_lead_alias(lead_id: str, user: dict = Depends(require_meta_access)):
    """Connect EligibilityCheck fetches GET /leads/{id} for the customer summary. Serve the
    Connect-shaped file so the same page renders for Meta without a separate call."""
    lead = await _get_lead_or_404(lead_id)
    _authorize_read(user, lead)
    return build_connect_file(lead)


import io
import zipfile


@router.get("/{lead_id}/documents/download-all")
async def compat_download_all(lead_id: str, user: dict = Depends(require_meta_access)):
    lead = await _get_lead_or_404(lead_id)
    _authorize_read(user, lead)
    docs = lead.get("documents") or []
    entries = []  # (filename, bytes)
    for d in docs:
        if d.get("storage_key"):
            try:
                content, _ = meta_storage.get_object(d["storage_key"])
                entries.append((d.get("filename") or d.get("doc_id"), content))
            except Exception:
                continue
        else:
            legacy = await _read_legacy_binary(d.get("doc_id"))
            if legacy:
                entries.append((d.get("filename") or d.get("doc_id"), legacy[0]))
    if not entries:
        raise HTTPException(status_code=404, detail="No downloadable documents (legacy binaries pending migration)")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        seen = {}
        for name, content in entries:
            seen[name] = seen.get(name, 0) + 1
            if seen[name] > 1:
                stem, dot, ext = name.rpartition(".")
                name = f"{stem}_{seen[name]}{dot}{ext}" if dot else f"{name}_{seen[name]}"
            zf.writestr(name, content)
    buf.seek(0)
    fname = f"{(lead.get('full_name') or 'lead')}_documents.zip".replace(" ", "_")
    return Response(content=buf.getvalue(), media_type="application/zip",
                    headers={"Content-Disposition": f'attachment; filename="{fname}"'})
