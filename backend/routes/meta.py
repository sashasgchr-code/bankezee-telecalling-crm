"""
Isolated Meta module for BankEzee Connect (/api/meta/*).

- Reads/writes ONLY the isolated meta_* collections (meta_leads, meta_users,
  meta_meta, meta_fs.files). Never touches Connect CRM data.
- Authentication is Connect's single login; the master gate is require_meta_access
  (meta_access must be truthy). Role gating uses meta_role; identity/ownership and
  "assigned to me" scoping use meta_user_id. Enforced server-side here AND in the UI.
- Preserves Meta's business rules: admin/ops (STAFF) see everything; growth_partner
  sees leads assigned to them; processor sees leads they process.
- New lead documents use Emergent Object Storage (utils.meta_storage). The 149 legacy
  GridFS binaries remain a pending backfill: legacy docs return 409 on download.
"""
import io
import uuid
import csv
import zipfile
import asyncio
import bcrypt
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Response
from typing import Optional
from datetime import datetime, timezone
from pydantic import BaseModel

from utils.database import db
from utils.auth import require_meta_access, require_admin
from utils.helpers import serialize_doc, serialize_docs, object_id_or_none
from utils import meta_storage

router = APIRouter(prefix="/api/meta", tags=["Meta"])

STAFF_ROLES = {"admin", "ops"}
CRM_STATUSES = ["NEW", "CALL_BACK", "NOT_ANSWERING", "SWITCHED_OFF", "NOT_INTERESTED", "NOT_QUALIFIED", "LEAD", "FILE"]
DISPOSITIONS = {"NOT_ANSWERING", "SWITCHED_OFF", "NOT_INTERESTED", "NOT_QUALIFIED", "CALL_BACK", "LEAD", "FILE"}
META_ROLES = ["admin", "ops", "processor", "growth_partner"]
PROCESSING_STATUSES = [
    "New", "Contacted", "Documents Collected", "Documents Pending", "Sent for Eligibility",
    "Sent for Login", "Login Done", "Sent for Approval", "Underwriting", "FI (Field Investigation)",
    "FI Negative", "FI Reinitiated", "Query/Hold", "Customer Not Interested - Need Help from MIT & Manager",
    "Customer Not Supporting - Need Help from MIT & Manager", "Approved", "Disbursed", "Not Eligible",
    "Not Login", "Declined", "Not Disbursed",
]
ALLOWED_DOC_TYPES = {"application/pdf", "image/png", "image/jpeg", "image/jpg"}
MAX_DOC_BYTES = 10 * 1024 * 1024
NOT_DELETED = {"deleted": {"$ne": True}}


def _now_iso():
    return datetime.now(timezone.utc).isoformat()


def _ctx(user: dict):
    """(meta_role, meta_user_id) — the caller's Meta identity from their Connect account."""
    return (user.get("meta_role_normalized") or (user.get("meta_role") or "").strip().lower()), user.get("meta_user_id")


# --------------------------- input models ---------------------------
class MetaStatusInput(BaseModel):
    status: str
    docs_received: Optional[bool] = None


class MetaAssignInput(BaseModel):
    partner_id: Optional[str] = None


class MetaNoteInput(BaseModel):
    text: str


class MetaCallInput(BaseModel):
    duration_seconds: int = 0
    disposition: str
    reason: Optional[str] = ""
    docs_received: Optional[bool] = None


class MetaFileInput(BaseModel):
    data: dict


class MetaProcessorInput(BaseModel):
    processor_id: Optional[str] = None


class MetaProcStatusInput(BaseModel):
    status: str


class MetaBulkInput(BaseModel):
    lead_ids: list
    partner_id: Optional[str] = None


class MetaDefaultProcessorInput(BaseModel):
    processor_id: Optional[str] = None


class MetaApproveInput(BaseModel):
    approved: bool


class MetaPasswordInput(BaseModel):
    password: str


class MetaUserMgmtInput(BaseModel):
    meta_access: bool
    meta_role: Optional[str] = None
    meta_email: Optional[str] = None
    meta_user_id: Optional[str] = None


class MetaCallLogInput(BaseModel):
    call_id: str
    phone: Optional[str] = None
    started_at: Optional[str] = None
    ended_at: Optional[str] = None
    duration_seconds: int = 0
    outcome: Optional[str] = None
    note: Optional[str] = None
    resulting_status: Optional[str] = None


# --------------------------- scope helpers ---------------------------
def _lead_scope(user: dict) -> dict:
    role, uid = _ctx(user)
    base = dict(NOT_DELETED)
    if role in STAFF_ROLES:
        return base
    if role == "processor":
        base["assigned_processor_id"] = uid
        return base
    base["assigned_partner_id"] = uid
    return base


def _can_action_lead(role, uid, lead) -> bool:
    if role in STAFF_ROLES:
        return True
    if role == "growth_partner" and lead.get("assigned_partner_id") == uid:
        return True
    if role == "processor" and lead.get("assigned_processor_id") == uid:
        return True
    return False


async def _get_lead_or_404(lead_id: str):
    lead = await db.meta_leads.find_one({"lead_id": lead_id})
    if not lead:
        raise HTTPException(status_code=404, detail="Meta lead not found")
    return lead


async def _auto_assign_processor(lead_id: str, lead: dict):
    """On FILE conversion, inherit the assigned partner's default processor (like old Meta)."""
    try:
        pid = lead.get("assigned_partner_id")
        if not pid:
            return
        partner = await db.meta_users.find_one({"user_id": pid})
        dpid = (partner or {}).get("default_processor_id")
        if not dpid:
            return
        proc = await db.meta_users.find_one({"user_id": dpid, "role": "processor"})
        if not proc:
            return
        await db.meta_leads.update_one({"lead_id": lead_id}, {"$set": {
            "assigned_processor_id": dpid, "assigned_processor_name": proc.get("name"),
            "updated_at": _now_iso(),
        }})
    except Exception:
        pass


def _fire_file_notifications(updated_lead, actor_name):
    try:
        from routes.meta_sync import notify_staff_converted, notify_processors_new_file
        asyncio.create_task(notify_staff_converted(updated_lead, actor_name))
        asyncio.create_task(notify_processors_new_file(updated_lead, actor_name))
    except Exception:
        pass


# =========================== identity / dashboard ===========================
@router.get("/me")
async def meta_me(user: dict = Depends(require_meta_access)):
    return {
        "meta_access": True,
        "meta_role": user.get("meta_role"),
        "role": (user.get("meta_role") or "").strip().lower(),
        "meta_email": user.get("meta_email"),
        "meta_user_id": user.get("meta_user_id"),
        "user_id": user.get("meta_user_id"),
        "connect_user_id": user.get("id"),
        "name": user.get("name"),
        "picture": user.get("picture"),
    }


@router.get("/dashboard")
async def meta_dashboard(user: dict = Depends(require_meta_access)):
    scope = _lead_scope(user)
    total = await db.meta_leads.count_documents(scope)
    files = await db.meta_leads.count_documents({**scope, "status": "FILE"})
    unassigned = await db.meta_leads.count_documents({**scope, "assigned_partner_id": None})
    by_status = {}
    async for row in db.meta_leads.aggregate([{"$match": scope}, {"$group": {"_id": "$status", "n": {"$sum": 1}}}]):
        by_status[row["_id"] or "UNKNOWN"] = row["n"]
    return {"total_leads": total, "files": files, "unassigned": unassigned, "by_status": by_status}


@router.get("/leads/stats")
async def meta_lead_stats(user: dict = Depends(require_meta_access),
                          from_date: Optional[str] = None, to_date: Optional[str] = None,
                          partner: Optional[str] = None):
    role, uid = _ctx(user)
    match = dict(NOT_DELETED)
    if role not in STAFF_ROLES:
        match["assigned_partner_id"] = uid
    elif partner and partner != "ALL":
        match["assigned_partner_id"] = partner
    if from_date or to_date:
        rng = {}
        if from_date:
            rng["$gte"] = from_date
        if to_date:
            rng["$lte"] = to_date + "T23:59:59"
        match["created_at"] = rng
    total = await db.meta_leads.count_documents(match)
    by_status = {}
    for s in CRM_STATUSES:
        by_status[s] = await db.meta_leads.count_documents({**match, "status": s})
    unassigned = await db.meta_leads.count_documents({**match, "assigned_partner_id": None})
    file_docs = await db.meta_leads.find({**match, "status": "FILE"}, {"_id": 0, "file": 1}).to_list(10000)
    files_in_progress = 0
    for fdoc in file_docs:
        banks = (fdoc.get("file") or {}).get("banks", [])
        if not any(b.get("disbursed") == "Yes" for b in banks):
            files_in_progress += 1
    last_sync = await db.meta_meta.find_one({"key": "last_sync"}, {"_id": 0})
    pipeline = [{"$match": match}, {"$group": {"_id": "$city", "count": {"$sum": 1}}},
                {"$sort": {"count": -1}}, {"$limit": 6}]
    by_city = [{"city": d["_id"] or "Unknown", "count": d["count"]} async for d in db.meta_leads.aggregate(pipeline)]
    return {"total": total, "by_status": by_status, "unassigned": unassigned,
            "files_in_progress": files_in_progress, "last_sync": last_sync, "by_city": by_city}


# =========================== leads ===========================
SORT_FIELDS = {"created_time", "full_name", "city", "status"}


@router.get("/leads")
async def meta_leads(
    user: dict = Depends(require_meta_access),
    status: Optional[str] = None,
    q: Optional[str] = None,
    partner: Optional[str] = None,
    page: int = 1,
    page_size: int = 50,
    sort_by: str = "created_time",
    sort_dir: str = "desc",
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
):
    role, uid = _ctx(user)
    query = dict(NOT_DELETED)
    if role == "processor":
        query["assigned_processor_id"] = uid
    elif role not in STAFF_ROLES:
        query["assigned_partner_id"] = uid
    if status and status != "ALL":
        query["status"] = status
    if partner and partner != "ALL" and role in STAFF_ROLES:
        query["assigned_partner_id"] = None if partner == "UNASSIGNED" else partner
    if from_date or to_date:
        ct = {}
        if from_date:
            ct["$gte"] = f"{from_date}T00:00:00"
        if to_date:
            ct["$lte"] = f"{to_date}T23:59:59"
        if ct:
            query["created_time"] = ct
    if q:
        query["$or"] = [
            {"full_name": {"$regex": q, "$options": "i"}},
            {"phone": {"$regex": q, "$options": "i"}},
            {"email": {"$regex": q, "$options": "i"}},
            {"city": {"$regex": q, "$options": "i"}},
            {"lead_id": {"$regex": q, "$options": "i"}},
        ]
    page = max(1, page)
    page_size = min(max(1, page_size), 200)
    if sort_by not in SORT_FIELDS:
        sort_by = "created_time"
    direction = 1 if sort_dir == "asc" else -1
    total = await db.meta_leads.count_documents(query)
    docs = await db.meta_leads.find(query).sort(sort_by, direction).skip((page - 1) * page_size).limit(page_size).to_list(page_size)
    items = serialize_docs(docs)
    pages = max(1, (total + page_size - 1) // page_size)
    # `leads` retained for the mobile app; `items`/`pages` added for the web parity UI.
    return {"leads": items, "items": items, "total": total, "page": page, "page_size": page_size, "pages": pages}


@router.post("/leads/bulk-assign")
async def meta_bulk_assign(inp: MetaBulkInput, user: dict = Depends(require_meta_access)):
    role, _ = _ctx(user)
    if role not in STAFF_ROLES:
        raise HTTPException(status_code=403, detail="Only Admin/Ops can assign Meta leads")
    if not inp.lead_ids:
        raise HTTPException(status_code=400, detail="No leads selected")
    partner_name = None
    if inp.partner_id:
        partner = await db.meta_users.find_one({"user_id": inp.partner_id})
        if not partner:
            raise HTTPException(status_code=404, detail="Partner not found")
        if partner.get("role") != "growth_partner" or not partner.get("approved"):
            raise HTTPException(status_code=400, detail="Leads can only be assigned to an approved growth partner")
        partner_name = partner.get("name")
        detail = f"Assigned to {partner_name} by {user.get('name')} (bulk)"
    else:
        detail = f"Unassigned by {user.get('name')} (bulk)"
    activity = {"type": "assignment", "detail": detail, "at": _now_iso()}
    res = await db.meta_leads.update_many({"lead_id": {"$in": inp.lead_ids}}, {"$set": {
        "assigned_partner_id": inp.partner_id, "assigned_partner_name": partner_name, "updated_at": _now_iso(),
        "assigned_by": (user.get("name") if inp.partner_id else None),
        "assigned_at": (_now_iso() if inp.partner_id else None),
    }, "$push": {"activities": activity}})
    return {"modified": res.modified_count}


@router.post("/leads/bulk-delete")
async def meta_bulk_delete(inp: MetaBulkInput, user: dict = Depends(require_meta_access)):
    role, _ = _ctx(user)
    if role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    if not inp.lead_ids:
        raise HTTPException(status_code=400, detail="No leads selected")
    res = await db.meta_leads.update_many({"lead_id": {"$in": inp.lead_ids}},
                                          {"$set": {"deleted": True, "deleted_at": _now_iso()}})
    return {"deleted": res.modified_count}


@router.get("/leads/{lead_id}")
async def meta_lead_detail(lead_id: str, user: dict = Depends(require_meta_access)):
    lead = await _get_lead_or_404(lead_id)
    role, uid = _ctx(user)
    if role not in STAFF_ROLES:
        allowed = (
            (role == "growth_partner" and lead.get("assigned_partner_id") == uid)
            or (role == "processor" and lead.get("assigned_processor_id") == uid)
        )
        if not allowed:
            raise HTTPException(status_code=403, detail="Not authorized for this Meta lead")
    return serialize_doc(lead)


@router.patch("/leads/{lead_id}/status")
async def meta_update_status(lead_id: str, inp: MetaStatusInput, user: dict = Depends(require_meta_access)):
    if inp.status not in CRM_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid status")
    lead = await _get_lead_or_404(lead_id)
    role, uid = _ctx(user)
    if role not in STAFF_ROLES and lead.get("assigned_partner_id") != uid:
        raise HTTPException(status_code=403, detail="Not authorized")
    activity = {"type": "status_change",
                "detail": f"Status changed from {lead.get('status')} to {inp.status} by {user.get('name')}",
                "at": _now_iso()}
    set_status = {"status": inp.status, "updated_at": _now_iso()}
    if inp.status == "FILE" and not lead.get("file_created_at"):
        set_status["file_created_at"] = _now_iso()
    if inp.status == "FILE" and inp.docs_received is not None:
        set_status["docs_received"] = inp.docs_received
    await db.meta_leads.update_one({"lead_id": lead_id}, {"$set": set_status, "$push": {"activities": activity}})
    is_new_file = inp.status == "FILE" and lead.get("status") != "FILE"
    if is_new_file:
        await _auto_assign_processor(lead_id, {**lead, **set_status})
    updated = await db.meta_leads.find_one({"lead_id": lead_id})
    if is_new_file:
        _fire_file_notifications(updated, user.get("name"))
    return serialize_doc(updated)


@router.patch("/leads/{lead_id}/assign")
async def meta_assign_lead(lead_id: str, inp: MetaAssignInput, user: dict = Depends(require_meta_access)):
    role, _ = _ctx(user)
    if role not in STAFF_ROLES:
        raise HTTPException(status_code=403, detail="Only Admin/Ops can assign Meta leads")
    lead = await _get_lead_or_404(lead_id)
    partner_name = None
    partner = None
    if inp.partner_id:
        partner = await db.meta_users.find_one({"user_id": inp.partner_id})
        if not partner:
            raise HTTPException(status_code=404, detail="Partner not found")
        if partner.get("role") != "growth_partner" or not partner.get("approved"):
            raise HTTPException(status_code=400, detail="Leads can only be assigned to an approved growth partner")
        partner_name = partner.get("name")
        detail = f"Assigned to {partner_name} by {user.get('name')}"
    else:
        detail = f"Unassigned by {user.get('name')}"
    activity = {"type": "assignment", "detail": detail, "at": _now_iso()}
    await db.meta_leads.update_one({"lead_id": lead_id}, {"$set": {
        "assigned_partner_id": inp.partner_id, "assigned_partner_name": partner_name, "updated_at": _now_iso(),
        "assigned_by": (user.get("name") if inp.partner_id else None),
        "assigned_at": (_now_iso() if inp.partner_id else None),
    }, "$push": {"activities": activity}})
    updated = await db.meta_leads.find_one({"lead_id": lead_id})
    if inp.partner_id and partner:
        try:
            from routes.meta_sync import notify_partner_assignment
            asyncio.create_task(notify_partner_assignment(partner, updated, user.get("name")))
        except Exception:
            pass
    return serialize_doc(updated)


@router.post("/leads/{lead_id}/notes")
async def meta_add_note(lead_id: str, inp: MetaNoteInput, user: dict = Depends(require_meta_access)):
    lead = await _get_lead_or_404(lead_id)
    role, uid = _ctx(user)
    if not _can_action_lead(role, uid, lead):
        raise HTTPException(status_code=403, detail="Not authorized")
    note = {"text": inp.text, "author": user.get("name"), "at": _now_iso()}
    activity = {"type": "note", "detail": f"{user.get('name')} added a note", "at": _now_iso()}
    await db.meta_leads.update_one({"lead_id": lead_id},
                                   {"$push": {"notes": note, "activities": activity}, "$set": {"updated_at": _now_iso()}})
    return serialize_doc(await db.meta_leads.find_one({"lead_id": lead_id}))


@router.post("/leads/{lead_id}/calls")
async def meta_log_call(lead_id: str, inp: MetaCallInput, user: dict = Depends(require_meta_access)):
    lead = await _get_lead_or_404(lead_id)
    role, uid = _ctx(user)
    if role not in STAFF_ROLES and lead.get("assigned_partner_id") != uid:
        raise HTTPException(status_code=403, detail="Not authorized")
    if inp.disposition not in DISPOSITIONS:
        raise HTTPException(status_code=400, detail="Invalid disposition")
    if inp.disposition == "NOT_QUALIFIED" and not (inp.reason or "").strip():
        raise HTTPException(status_code=400, detail="Reason is required for Not Qualified")
    dur = max(0, inp.duration_seconds)
    now = _now_iso()
    call = {"call_id": f"call_{uuid.uuid4().hex[:10]}", "user_id": uid, "user_name": user.get("name"),
            "at": now, "duration_seconds": dur, "disposition": inp.disposition,
            "reason": inp.reason or "", "docs_received": inp.docs_received}
    detail = f"{user.get('name')} logged a call ({dur // 60}m {dur % 60}s) — {inp.disposition.replace('_', ' ').title()}"
    set_fields = {"disposition": inp.disposition, "updated_at": now}
    if lead.get("status") != "FILE":
        set_fields["status"] = inp.disposition
    if inp.disposition == "FILE" and not lead.get("file_created_at"):
        set_fields["file_created_at"] = now
    if inp.docs_received is not None:
        set_fields["docs_received"] = inp.docs_received
    if inp.disposition == "FILE" and not lead.get("file"):
        set_fields["file"] = {}
    await db.meta_leads.update_one({"lead_id": lead_id}, {"$set": set_fields,
        "$push": {"call_logs": call, "activities": {"type": "call", "detail": detail, "at": now}}})
    is_new_file = inp.disposition == "FILE" and lead.get("status") != "FILE"
    if is_new_file:
        await _auto_assign_processor(lead_id, {**lead, **set_fields})
    updated = await db.meta_leads.find_one({"lead_id": lead_id})
    if inp.disposition == "FILE":
        _fire_file_notifications(updated, user.get("name"))
    return serialize_doc(updated)


@router.post("/leads/{lead_id}/call-log")
async def meta_add_call_log(lead_id: str, inp: MetaCallLogInput, user: dict = Depends(require_meta_access)):
    """Mobile post-call save. Idempotent on call_id. Stores ONLY in meta_leads."""
    lead = await _get_lead_or_404(lead_id)
    role, uid = _ctx(user)
    if not _can_action_lead(role, uid, lead):
        raise HTTPException(status_code=403, detail="Not authorized")
    existing = next((c for c in (lead.get("call_logs") or []) if c.get("call_id") == inp.call_id), None)
    if existing:
        return {"deduped": True, "lead": serialize_doc(lead)}
    now = _now_iso()
    call = {
        "call_id": inp.call_id, "lead_source": "meta", "source": "mobile",
        "meta_user_id": uid, "connect_user_id": user.get("id"), "user_id": uid, "user_name": user.get("name"),
        "phone": inp.phone or lead.get("phone"), "started_at": inp.started_at, "ended_at": inp.ended_at,
        "duration_seconds": int(inp.duration_seconds or 0), "disposition": inp.outcome, "note": inp.note, "at": now,
    }
    push = {"call_logs": call, "activities": {
        "type": "call",
        "detail": f"{user.get('name')} called {call['phone']} — {inp.outcome or 'no outcome'} ({call['duration_seconds']}s)",
        "at": now}}
    if inp.note:
        push["notes"] = {"text": inp.note, "author": user.get("name"), "at": now}
    set_fields = {"updated_at": now}
    if inp.resulting_status and inp.resulting_status in CRM_STATUSES:
        set_fields["status"] = inp.resulting_status
        if inp.resulting_status == "FILE" and not lead.get("file_created_at"):
            set_fields["file_created_at"] = now
    await db.meta_leads.update_one({"lead_id": lead_id}, {"$push": push, "$set": set_fields})
    updated = await db.meta_leads.find_one({"lead_id": lead_id})
    if inp.resulting_status == "FILE" and lead.get("status") != "FILE":
        _fire_file_notifications(updated, user.get("name"))
    return {"deduped": False, "lead": serialize_doc(updated)}


@router.patch("/leads/{lead_id}/file")
async def meta_save_file(lead_id: str, inp: MetaFileInput, user: dict = Depends(require_meta_access)):
    lead = await _get_lead_or_404(lead_id)
    role, uid = _ctx(user)
    allowed = (role in STAFF_ROLES
               or (role == "growth_partner" and lead.get("assigned_partner_id") == uid)
               or (role == "processor" and lead.get("assigned_processor_id") == uid))
    if not allowed:
        raise HTTPException(status_code=403, detail="Not authorized")
    data = dict(inp.data or {})
    # Only admin/processor may edit bank eligibilities; others keep the existing banks.
    if role not in ("admin", "processor"):
        data["banks"] = (lead.get("file") or {}).get("banks", [])
    activity = {"type": "file", "detail": f"{user.get('name')} updated file details", "at": _now_iso()}
    await db.meta_leads.update_one({"lead_id": lead_id},
                                   {"$set": {"file": data, "updated_at": _now_iso()}, "$push": {"activities": activity}})
    return serialize_doc(await db.meta_leads.find_one({"lead_id": lead_id}))


@router.patch("/leads/{lead_id}/processor")
async def meta_assign_processor(lead_id: str, inp: MetaProcessorInput, user: dict = Depends(require_meta_access)):
    role, _ = _ctx(user)
    if role not in ("admin", "ops", "processor"):
        raise HTTPException(status_code=403, detail="Not authorized")
    await _get_lead_or_404(lead_id)
    pname = None
    if inp.processor_id:
        proc = await db.meta_users.find_one({"user_id": inp.processor_id, "role": "processor"})
        if not proc:
            raise HTTPException(status_code=404, detail="Processor not found")
        pname = proc.get("name")
        detail = f"Processor set to {pname} by {user.get('name')}"
    else:
        detail = f"Processor unassigned by {user.get('name')}"
    await db.meta_leads.update_one({"lead_id": lead_id}, {"$set": {
        "assigned_processor_id": inp.processor_id, "assigned_processor_name": pname, "updated_at": _now_iso(),
    }, "$push": {"activities": {"type": "processor", "detail": detail, "at": _now_iso()}}})
    return serialize_doc(await db.meta_leads.find_one({"lead_id": lead_id}))


@router.patch("/leads/{lead_id}/processing-status")
async def meta_update_processing_status(lead_id: str, inp: MetaProcStatusInput, user: dict = Depends(require_meta_access)):
    role, _ = _ctx(user)
    if role not in ("admin", "processor"):
        raise HTTPException(status_code=403, detail="Not authorized")
    if inp.status not in PROCESSING_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid processing status")
    await _get_lead_or_404(lead_id)
    await db.meta_leads.update_one({"lead_id": lead_id}, {"$set": {"processing_status": inp.status, "updated_at": _now_iso()},
        "$push": {"activities": {"type": "processing", "detail": f"Processing status set to '{inp.status}' by {user.get('name')}", "at": _now_iso()}}})
    return serialize_doc(await db.meta_leads.find_one({"lead_id": lead_id}))


# =========================== documents (Object Storage) ===========================
async def _lead_for_docs(lead_id: str, user: dict):
    lead = await _get_lead_or_404(lead_id)
    role, uid = _ctx(user)
    if not _can_action_lead(role, uid, lead):
        raise HTTPException(status_code=403, detail="Not authorized")
    return lead


@router.post("/leads/{lead_id}/documents")
async def meta_upload_document(lead_id: str, file: UploadFile = File(...), user: dict = Depends(require_meta_access)):
    await _lead_for_docs(lead_id, user)
    ctype = (file.content_type or "").lower()
    if ctype not in ALLOWED_DOC_TYPES:
        raise HTTPException(status_code=400, detail="Only PDF, PNG and JPG files are allowed")
    data = await file.read()
    if len(data) > MAX_DOC_BYTES:
        raise HTTPException(status_code=400, detail="File exceeds 10MB limit")
    doc_id = uuid.uuid4().hex
    ext = (file.filename.rsplit(".", 1)[-1] if "." in (file.filename or "") else "bin").lower()
    path = f"{meta_storage.APP_PREFIX}/documents/{lead_id}/{doc_id}.{ext}"
    try:
        result = meta_storage.put_object(path, data, ctype)
    except Exception:
        raise HTTPException(status_code=502, detail="Document storage upload failed")
    doc = {"doc_id": doc_id, "storage_key": result.get("path", path), "filename": file.filename,
           "content_type": ctype, "size": len(data), "uploaded_by": user.get("name"), "at": _now_iso()}
    await db.meta_leads.update_one({"lead_id": lead_id}, {"$push": {"documents": doc}, "$set": {"updated_at": _now_iso()}})
    return doc


@router.get("/leads/{lead_id}/documents/zip")
async def meta_download_zip(lead_id: str, user: dict = Depends(require_meta_access)):
    lead = await _lead_for_docs(lead_id, user)
    docs = [d for d in (lead.get("documents") or []) if d.get("storage_key")]
    if not docs:
        raise HTTPException(status_code=404, detail="No downloadable documents (legacy binaries pending migration)")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        seen = {}
        for d in docs:
            try:
                content, _ = meta_storage.get_object(d["storage_key"])
            except Exception:
                continue
            name = d.get("filename") or d["doc_id"]
            seen[name] = seen.get(name, 0) + 1
            if seen[name] > 1:
                stem, dot, ext = name.rpartition(".")
                name = f"{stem}_{seen[name]}{dot}{ext}" if dot else f"{name}_{seen[name]}"
            zf.writestr(name, content)
    buf.seek(0)
    fname = f"{(lead.get('full_name') or 'lead')}_documents.zip".replace(" ", "_")
    return Response(content=buf.getvalue(), media_type="application/zip",
                    headers={"Content-Disposition": f'attachment; filename="{fname}"'})


@router.get("/leads/{lead_id}/documents/{doc_id}")
async def meta_download_document(lead_id: str, doc_id: str, user: dict = Depends(require_meta_access)):
    lead = await _lead_for_docs(lead_id, user)
    doc = next((d for d in (lead.get("documents") or []) if d.get("doc_id") == doc_id), None)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if not doc.get("storage_key"):
        raise HTTPException(status_code=409, detail="Document migration pending")
    try:
        content, ctype = meta_storage.get_object(doc["storage_key"])
    except Exception:
        raise HTTPException(status_code=404, detail="Document not found in storage")
    return Response(content=content, media_type=doc.get("content_type") or ctype,
                    headers={"Content-Disposition": f'inline; filename="{doc.get("filename") or doc_id}"'})


@router.delete("/leads/{lead_id}/documents/{doc_id}")
async def meta_delete_document(lead_id: str, doc_id: str, user: dict = Depends(require_meta_access)):
    await _lead_for_docs(lead_id, user)
    await db.meta_leads.update_one({"lead_id": lead_id}, {"$pull": {"documents": {"doc_id": doc_id}}})
    return {"ok": True}


# =========================== files (loan files) ===========================
@router.get("/files/stats")
async def meta_files_stats(user: dict = Depends(require_meta_access)):
    role, uid = _ctx(user)
    match = dict(NOT_DELETED)
    if role == "processor":
        match["assigned_processor_id"] = uid
    elif role not in STAFF_ROLES:
        match["assigned_partner_id"] = uid
    file_match = {**match, "status": "FILE"}
    total_files = await db.meta_leads.count_documents(file_match)
    docs_received = await db.meta_leads.count_documents({**file_match, "docs_received": True})
    return {"total_files": total_files, "docs_received": docs_received, "pending_docs": total_files - docs_received}


def _compute_report(items):
    s = {"total_files": len(items), "in_progress": 0, "login": 0, "approved": 0, "disbursed": 0,
         "rejected": 0, "approved_amount": 0.0, "disbursed_amount": 0.0, "pipeline_amount": 0.0}
    for f in items:
        banks = (f.get("file") or {}).get("banks", [])
        has_login = any(b.get("login_done") == "Yes" for b in banks)
        has_appr = any(b.get("approval_status") == "Approved" for b in banks)
        has_disb = any(b.get("disbursed") == "Yes" for b in banks)
        has_rej = any(b.get("approval_status") == "Rejected" for b in banks)
        if has_disb:
            s["disbursed"] += 1
        elif has_appr:
            s["approved"] += 1
        elif has_login:
            s["login"] += 1
        elif has_rej:
            s["rejected"] += 1
        else:
            s["in_progress"] += 1
        for b in banks:
            if b.get("approval_status") == "Approved":
                s["approved_amount"] += float(b.get("approved_amount") or 0)
            if b.get("disbursed") == "Yes":
                s["disbursed_amount"] += float(b.get("disbursed_amount") or 0)
            elif b.get("login_done") == "Yes":
                s["pipeline_amount"] += float(b.get("eligible_amount") or 0)
    return s


async def _report_match(user, partner, processor):
    role, uid = _ctx(user)
    match = {"status": "FILE", **NOT_DELETED}
    if role == "growth_partner":
        match["assigned_partner_id"] = uid
    elif role == "processor":
        match["assigned_processor_id"] = uid
    if partner and partner != "ALL":
        match["assigned_partner_id"] = partner
    if processor and processor != "ALL":
        match["assigned_processor_id"] = processor
    return match


@router.get("/files/report")
async def meta_files_report(user: dict = Depends(require_meta_access), from_date: Optional[str] = None,
                            to_date: Optional[str] = None, partner: Optional[str] = None, processor: Optional[str] = None):
    match = await _report_match(user, partner, processor)
    files = await db.meta_leads.find(match, {"_id": 0}).to_list(5000)

    def in_range(f):
        if not from_date and not to_date:
            return True
        dt = (f.get("file_created_at") or f.get("created_at") or "")[:10]
        if from_date and dt < from_date:
            return False
        if to_date and dt > to_date:
            return False
        return True

    mkey = datetime.now(timezone.utc).strftime("%Y-%m")
    ranged = [f for f in files if in_range(f)]
    this_month = [f for f in files if (f.get("file_created_at") or f.get("created_at") or "")[:7] == mkey]
    return {"overall": _compute_report(ranged), "this_month": _compute_report(this_month)}


@router.get("/files/report/export")
async def meta_files_report_export(user: dict = Depends(require_meta_access), from_date: Optional[str] = None,
                                   to_date: Optional[str] = None, partner: Optional[str] = None, processor: Optional[str] = None):
    match = await _report_match(user, partner, processor)
    files = await db.meta_leads.find(match, {"_id": 0}).to_list(5000)

    def _in(f):
        if not from_date and not to_date:
            return True
        dt = (f.get("file_created_at") or f.get("created_at") or "")[:10]
        if from_date and dt < from_date:
            return False
        if to_date and dt > to_date:
            return False
        return True

    files = [f for f in files if _in(f)]
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["Customer", "Phone", "City", "Growth Partner", "Processor", "File Date", "Bank",
                "Eligible", "Eligible Amount", "Login Done", "Approval Status", "Approved Amount",
                "Disbursed", "Disbursed Amount", "Commission Amount"])
    for f in files:
        fd = (f.get("file_created_at") or f.get("created_at") or "")[:10]
        banks = (f.get("file") or {}).get("banks", []) or [{}]
        for b in banks:
            w.writerow([f.get("full_name", ""), f.get("phone", ""), f.get("city", ""),
                        f.get("assigned_partner_name") or "", f.get("assigned_processor_name") or "", fd,
                        b.get("bank_name", ""), b.get("eligible", ""), b.get("eligible_amount", ""),
                        b.get("login_done", ""), b.get("approval_status", ""), b.get("approved_amount", ""),
                        b.get("disbursed", ""), b.get("disbursed_amount", ""), b.get("commission_amount", "")])
    return Response(content=out.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": 'attachment; filename="meta_file_report.csv"'})


# =========================== call logs ===========================
@router.get("/call-logs")
async def meta_call_logs(user: dict = Depends(require_meta_access)):
    role, uid = _ctx(user)
    match = {"call_logs.0": {"$exists": True}, **NOT_DELETED}
    if role not in STAFF_ROLES:
        match["assigned_partner_id"] = uid
    leads = await db.meta_leads.find(match, {"_id": 0, "lead_id": 1, "full_name": 1, "phone": 1,
        "city": 1, "status": 1, "call_logs": 1}).to_list(3000)
    rows = []
    for l in leads:
        for c in l.get("call_logs", []):
            rows.append({"lead_id": l["lead_id"], "customer": l.get("full_name"), "mobile": l.get("phone"),
                         "city": l.get("city"), "lead_status": l.get("status"), "caller": c.get("user_name"),
                         "at": c.get("at"), "duration_seconds": c.get("duration_seconds", 0),
                         "disposition": c.get("disposition"), "reason": c.get("reason", "")})
    rows.sort(key=lambda r: r["at"] or "", reverse=True)
    return rows


@router.get("/my-call-stats")
async def meta_my_call_stats(user: dict = Depends(require_meta_access)):
    role, uid = _ctx(user)
    scope = _lead_scope(user)
    total_calls, total_talk = 0, 0
    async for lead in db.meta_leads.find(scope, {"call_logs": 1}):
        for c in (lead.get("call_logs") or []):
            if role in STAFF_ROLES or c.get("meta_user_id") == uid or c.get("user_id") == uid:
                total_calls += 1
                total_talk += int(c.get("duration_seconds") or 0)
    return {"total_calls": total_calls, "total_talk_time_seconds": total_talk}


# =========================== partners / processors ===========================
@router.get("/partners")
async def meta_partners(user: dict = Depends(require_meta_access)):
    role, _ = _ctx(user)
    if role not in STAFF_ROLES:
        raise HTTPException(status_code=403, detail="Admin/Ops only")
    docs = await db.meta_users.find({"role": "growth_partner", "approved": True, **NOT_DELETED},
                                    {"password_hash": 0, "visible_password": 0}).to_list(1000)
    out = []
    for d in docs:
        assigned = await db.meta_leads.count_documents({"assigned_partner_id": d.get("user_id"), **NOT_DELETED})
        converted = await db.meta_leads.count_documents({"assigned_partner_id": d.get("user_id"), "status": "FILE", **NOT_DELETED})
        out.append({"user_id": d.get("user_id"), "name": d.get("name"), "email": d.get("email"),
                    "phone": d.get("phone"), "picture": d.get("picture"),
                    "assigned_leads": assigned, "converted_leads": converted})
    return out


@router.get("/processors")
async def meta_processors(user: dict = Depends(require_meta_access)):
    role, _ = _ctx(user)
    if role not in ("admin", "ops", "processor"):
        raise HTTPException(status_code=403, detail="Not authorized")
    procs = await db.meta_users.find({"role": "processor", "approved": True, **NOT_DELETED},
                                     {"_id": 0, "user_id": 1, "name": 1, "email": 1}).to_list(500)
    return procs


@router.get("/processors/workload")
async def meta_processor_workload(user: dict = Depends(require_meta_access)):
    role, _ = _ctx(user)
    if role not in ("admin", "ops"):
        raise HTTPException(status_code=403, detail="Not authorized")
    procs = await db.meta_users.find({"role": "processor", **NOT_DELETED}, {"_id": 0, "user_id": 1, "name": 1}).to_list(500)
    rows = []
    for p in procs:
        files = await db.meta_leads.find({"status": "FILE", "assigned_processor_id": p["user_id"], **NOT_DELETED},
                                         {"_id": 0, "file": 1}).to_list(3000)
        r = {"user_id": p["user_id"], "name": p["name"], "total": len(files),
             "in_progress": 0, "login": 0, "approved": 0, "disbursed": 0}
        for f in files:
            banks = (f.get("file") or {}).get("banks", [])
            if any(b.get("disbursed") == "Yes" for b in banks):
                r["disbursed"] += 1
            elif any(b.get("approval_status") == "Approved" for b in banks):
                r["approved"] += 1
            elif any(b.get("login_done") == "Yes" for b in banks):
                r["login"] += 1
            else:
                r["in_progress"] += 1
        rows.append(r)
    return rows


# =========================== Meta user management ===========================
@router.get("/users")
async def meta_users_list(user: dict = Depends(require_meta_access), include_deleted: bool = False):
    role, _ = _ctx(user)
    if role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    q = {} if include_deleted else {"deleted": {"$ne": True}}
    users = await db.meta_users.find(q, {"_id": 0, "password_hash": 0}).sort("created_at", -1).to_list(2000)
    for u in users:
        if u.get("role") in ("growth_partner", "processor"):
            fld = "assigned_partner_id" if u["role"] == "growth_partner" else "assigned_processor_id"
            u["assigned_leads"] = await db.meta_leads.count_documents({fld: u["user_id"]})
    return users


def _require_meta_admin(user: dict):
    role, _ = _ctx(user)
    if role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")


@router.patch("/users/{user_id}/approve")
async def meta_approve_user(user_id: str, inp: MetaApproveInput, user: dict = Depends(require_meta_access)):
    _require_meta_admin(user)
    target = await db.meta_users.find_one({"user_id": user_id})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if target.get("role") not in ("growth_partner", "processor"):
        raise HTTPException(status_code=400, detail="Only growth partner / processor accounts require approval")
    await db.meta_users.update_one({"user_id": user_id}, {"$set": {"approved": inp.approved}})
    return {"ok": True, "approved": inp.approved}


@router.patch("/users/{user_id}/password")
async def meta_change_password(user_id: str, inp: MetaPasswordInput, user: dict = Depends(require_meta_access)):
    _require_meta_admin(user)
    if len(inp.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    target = await db.meta_users.find_one({"user_id": user_id})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    hashed = bcrypt.hashpw(inp.password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
    await db.meta_users.update_one({"user_id": user_id}, {"$set": {
        "password_hash": hashed, "visible_password": inp.password, "auth_provider": "password"}})
    return {"ok": True}


@router.patch("/users/{user_id}/restore")
async def meta_restore_user(user_id: str, user: dict = Depends(require_meta_access)):
    _require_meta_admin(user)
    target = await db.meta_users.find_one({"user_id": user_id})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    await db.meta_users.update_one({"user_id": user_id}, {"$set": {"deleted": False}, "$unset": {"deleted_at": ""}})
    return {"ok": True}


@router.patch("/users/{user_id}/default-processor")
async def meta_set_default_processor(user_id: str, inp: MetaDefaultProcessorInput, user: dict = Depends(require_meta_access)):
    role, _ = _ctx(user)
    if role not in STAFF_ROLES:
        raise HTTPException(status_code=403, detail="Admin/Ops only")
    partner = await db.meta_users.find_one({"user_id": user_id, "role": "growth_partner"})
    if not partner:
        raise HTTPException(status_code=404, detail="Growth partner not found")
    pname = None
    if inp.processor_id:
        proc = await db.meta_users.find_one({"user_id": inp.processor_id, "role": "processor", **NOT_DELETED})
        if not proc:
            raise HTTPException(status_code=404, detail="Processor not found")
        pname = proc.get("name")
    await db.meta_users.update_one({"user_id": user_id}, {"$set": {
        "default_processor_id": inp.processor_id, "default_processor_name": pname}})
    return {"ok": True, "default_processor_id": inp.processor_id, "default_processor_name": pname}


@router.delete("/users/{user_id}")
async def meta_delete_user(user_id: str, user: dict = Depends(require_meta_access)):
    _require_meta_admin(user)
    target = await db.meta_users.find_one({"user_id": user_id})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if target.get("role") == "admin":
        raise HTTPException(status_code=400, detail="Admin accounts cannot be deleted")
    await db.meta_users.update_one({"user_id": user_id}, {"$set": {"deleted": True, "deleted_at": _now_iso()}})
    return {"ok": True}


# =========================== legacy GridFS metadata (kept) ===========================
@router.get("/files")
async def meta_files_gridfs(user: dict = Depends(require_meta_access), page: int = 1, page_size: int = 100):
    skip = max(0, (page - 1) * page_size)
    total = await db["meta_fs.files"].count_documents({})
    pending = await db["meta_fs.files"].count_documents({"binary_pending": True})
    docs = await db["meta_fs.files"].find({}).skip(skip).limit(page_size).to_list(page_size)
    return {"total": total, "binary_pending": pending, "files": serialize_docs(docs)}


# =========================== Connect Admin: Meta access mapping ===========================
@router.get("/admin/user-management")
async def meta_user_management(current_user: dict = Depends(require_admin)):
    connect_users = await db.users.find(
        {}, {"name": 1, "email": 1, "role": 1, "is_active": 1,
             "meta_access": 1, "meta_role": 1, "meta_email": 1, "meta_user_id": 1}
    ).to_list(10000)
    meta_users = await db.meta_users.find({}, {"password_hash": 0, "visible_password": 0}).to_list(1000)
    linked = {u.get("meta_user_id") for u in connect_users if u.get("meta_user_id")}
    return {
        "meta_roles": META_ROLES,
        "connect_users": serialize_docs(connect_users),
        "meta_users": [{"user_id": m.get("user_id"), "name": m.get("name"), "email": m.get("email"),
                        "role": m.get("role"), "linked": (m.get("user_id") in linked)} for m in meta_users],
    }


@router.patch("/admin/users/{connect_user_id}")
async def meta_set_user_access(connect_user_id: str, inp: MetaUserMgmtInput, current_user: dict = Depends(require_admin)):
    oid = object_id_or_none(connect_user_id)
    match = {"$or": [{"id": connect_user_id}] + ([{"_id": oid}] if oid else [])}
    target = await db.users.find_one(match)
    if not target:
        raise HTTPException(status_code=404, detail="Connect user not found")
    if inp.meta_role and inp.meta_role not in META_ROLES:
        raise HTTPException(status_code=400, detail="Invalid Meta role")
    if inp.meta_user_id:
        dup = await db.users.find_one({"meta_user_id": inp.meta_user_id, "_id": {"$ne": target["_id"]}})
        if dup:
            raise HTTPException(status_code=400, detail=f"That Meta user is already mapped to {dup.get('email')}")
    await db.users.update_one({"_id": target["_id"]}, {"$set": {
        "meta_access": bool(inp.meta_access), "meta_role": inp.meta_role,
        "meta_email": inp.meta_email, "meta_user_id": inp.meta_user_id}})
    updated = await db.users.find_one({"_id": target["_id"]},
                                      {"name": 1, "email": 1, "role": 1, "meta_access": 1,
                                       "meta_role": 1, "meta_email": 1, "meta_user_id": 1})
    return serialize_doc(updated)



# =========================== Production seed + identity mapping ===========================
# Idempotent, admin-only. Loads the approved Meta dataset bundled at backend/data/meta_seed.json.gz
# into the ISOLATED meta_* collections of WHATEVER DB this backend is bound to (i.e. production when
# run there), then applies the validated Connect<->Meta identity mapping by email (never ObjectId
# coercion; updates ALL duplicate Connect docs sharing an email). Safe to re-run.
SEED_NATURAL_KEY = {
    "meta_leads": "lead_id",
    "meta_users": "user_id",
    "meta_meta": "key",
}


@router.post("/admin/seed-production")
async def meta_seed_production(current_user: dict = Depends(require_admin)):
    import os as _os
    import gzip as _gzip
    import re as _re
    from bson import json_util

    seed_path = _os.path.join(_os.path.dirname(_os.path.dirname(__file__)), "data", "meta_seed.json.gz")
    if not _os.path.exists(seed_path):
        raise HTTPException(status_code=500, detail="Seed bundle not found in deployment")
    with _gzip.open(seed_path, "rt", encoding="utf-8") as f:
        bundle = json_util.loads(f.read())

    results = {}
    # ---- upsert isolated meta_* collections (preserve original _id and relationships) ----
    for col, docs in bundle.items():
        docs = docs or []
        upserts = 0
        for doc in docs:
            if col == "meta_fs.files":
                doc["binary_pending"] = True
            key_field = SEED_NATURAL_KEY.get(col)
            if key_field and doc.get(key_field) is not None:
                flt = {key_field: doc[key_field]}
            else:
                flt = {"_id": doc.get("_id")}
            await db[col].replace_one(flt, doc, upsert=True)
            upserts += 1
        results[col] = {"seed": len(docs), "collection_count": await db[col].count_documents({}), "upserted": upserts}
    # meta_fs.chunks intentionally left empty (legacy binaries pending backfill)
    results["meta_fs.chunks"] = {"collection_count": await db["meta_fs.chunks"].count_documents({})}

    # ---- identity mapping (mirror scripts/meta_link_identities.py) ----
    meta_users = await db.meta_users.find({}).to_list(2000)
    auto_mapped, manual_needed = 0, []
    for mu in meta_users:
        email = (mu.get("email") or "").strip().lower()
        if not email:
            continue
        meta_uid = mu.get("user_id") or (mu.get("_id") if isinstance(mu.get("_id"), str) else str(mu.get("_id")))
        res = await db.users.update_many(
            {"email": {"$regex": f"^{_re.escape(email)}$", "$options": "i"}},
            {"$set": {"meta_access": True, "meta_role": mu.get("role"),
                      "meta_email": mu.get("email"), "meta_user_id": meta_uid}},
        )
        if res.matched_count:
            auto_mapped += res.matched_count
        else:
            manual_needed.append({"email": mu.get("email"), "meta_role": mu.get("role")})

    # ---- verification of key accounts ----
    async def _verify(email):
        docs = await db.users.find({"email": {"$regex": f"^{_re.escape(email.lower())}$", "$options": "i"}},
                                   {"_id": 0, "email": 1, "meta_access": 1, "meta_role": 1, "meta_user_id": 1}).to_list(10)
        return docs
    verify = {e: await _verify(e) for e in [
        "banothunithinnaik@gmail.com", "admin@bankezee.com", "rama@bankezee.com", "teja@bankezee.com"]}

    return {
        "db": db.name,
        "collections": results,
        "identity_mapping": {"connect_docs_updated": auto_mapped,
                             "unmatched_meta_users": len(manual_needed),
                             "unmatched_sample": manual_needed[:20]},
        "verify": verify,
        "note": "Idempotent. Legacy GridFS binaries remain pending (meta_fs.chunks empty).",
    }
