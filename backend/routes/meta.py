"""
Isolated Meta module for BankEzee Connect (/api/meta/*).

- Reads ONLY the isolated meta_* collections (meta_leads, meta_users,
  meta_user_sessions, meta_meta, meta_fs.files). Never touches Connect CRM data.
- Authentication is Connect's single login; access is gated by require_meta_access.
- Preserves Meta's business scoping: admin/ops see all leads; growth_partner sees
  leads assigned to them; processor sees leads they process. Leads keyed by lead_id.
- GridFS binaries are a separate pending backfill: file metadata is served with
  binary_pending=True and downloads return 409 (migration pending) - never a crash.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional
from datetime import datetime, timezone
from pydantic import BaseModel

from utils.database import db
from utils.auth import require_meta_access, require_admin
from utils.helpers import serialize_doc, serialize_docs, object_id_or_none

router = APIRouter(prefix="/api/meta", tags=["Meta"])

STAFF_ROLES = {"admin", "ops"}
CRM_STATUSES = ["NEW", "CALL_BACK", "NOT_ANSWERING", "SWITCHED_OFF", "NOT_INTERESTED", "NOT_QUALIFIED", "LEAD", "FILE"]
META_ROLES = ["admin", "ops", "processor", "growth_partner"]


def _now_iso():
    return datetime.now(timezone.utc).isoformat()


class MetaStatusInput(BaseModel):
    status: str


class MetaAssignInput(BaseModel):
    partner_id: Optional[str] = None


class MetaNoteInput(BaseModel):
    text: str


class MetaUserMgmtInput(BaseModel):
    meta_access: bool
    meta_role: Optional[str] = None
    meta_email: Optional[str] = None
    meta_user_id: Optional[str] = None


class MetaCallLogInput(BaseModel):
    call_id: str  # native call/session identifier for dedupe
    phone: Optional[str] = None
    started_at: Optional[str] = None
    ended_at: Optional[str] = None
    duration_seconds: int = 0
    outcome: Optional[str] = None          # disposition / call outcome
    note: Optional[str] = None
    resulting_status: Optional[str] = None  # optional Meta status transition


def _meta_ctx(user: dict):
    """Resolve the caller's Meta identity/role from their linked Connect account."""
    return (user.get("meta_role_normalized") or "").strip().lower(), user.get("meta_user_id")


def _lead_scope(user: dict) -> dict:
    """Mongo filter enforcing Meta's per-role lead visibility (server-side)."""
    role, meta_uid = _meta_ctx(user)
    if role in STAFF_ROLES:
        return {}
    if role == "processor":
        return {"assigned_processor_id": meta_uid}
    # growth_partner (and any GP-like role): only their assigned leads
    return {"assigned_partner_id": meta_uid}


@router.get("/me")
async def meta_me(user: dict = Depends(require_meta_access)):
    """Caller's Meta identity - drives the frontend/mobile Meta section."""
    return {
        "meta_access": True,
        "meta_role": user.get("meta_role"),
        "meta_email": user.get("meta_email"),
        "meta_user_id": user.get("meta_user_id"),
        "connect_user_id": user.get("id"),
        "name": user.get("name"),
    }


@router.get("/dashboard")
async def meta_dashboard(user: dict = Depends(require_meta_access)):
    scope = _lead_scope(user)
    total = await db.meta_leads.count_documents(scope)
    files = await db.meta_leads.count_documents({**scope, "status": "FILE"})
    unassigned = await db.meta_leads.count_documents({**scope, "assigned_partner_id": None})
    # status breakdown
    pipeline = [{"$match": scope}, {"$group": {"_id": "$status", "n": {"$sum": 1}}}]
    by_status = {}
    async for row in db.meta_leads.aggregate(pipeline):
        by_status[row["_id"] or "UNKNOWN"] = row["n"]
    return {"total_leads": total, "files": files, "unassigned": unassigned, "by_status": by_status}


@router.get("/leads")
async def meta_leads(
    user: dict = Depends(require_meta_access),
    status: Optional[str] = None,
    q: Optional[str] = None,
    page: int = 1,
    page_size: int = 50,
):
    query = _lead_scope(user)
    if status:
        query["status"] = status
    if q:
        query["$or"] = [
            {"full_name": {"$regex": q, "$options": "i"}},
            {"phone": {"$regex": q, "$options": "i"}},
            {"email": {"$regex": q, "$options": "i"}},
            {"lead_id": {"$regex": q, "$options": "i"}},
        ]
    total = await db.meta_leads.count_documents(query)
    skip = max(0, (page - 1) * page_size)
    docs = await db.meta_leads.find(query).sort("created_at", -1).skip(skip).limit(page_size).to_list(page_size)
    return {"total": total, "page": page, "page_size": page_size, "leads": serialize_docs(docs)}


@router.get("/leads/{lead_id}")
async def meta_lead_detail(lead_id: str, user: dict = Depends(require_meta_access)):
    lead = await db.meta_leads.find_one({"lead_id": lead_id})
    if not lead:
        raise HTTPException(status_code=404, detail="Meta lead not found")
    role, meta_uid = _meta_ctx(user)
    if role not in STAFF_ROLES:
        allowed = (
            (role == "growth_partner" and lead.get("assigned_partner_id") == meta_uid)
            or (role == "processor" and lead.get("assigned_processor_id") == meta_uid)
        )
        if not allowed:
            raise HTTPException(status_code=403, detail="Not authorized for this Meta lead")
    return serialize_doc(lead)


@router.get("/users")
async def meta_users(user: dict = Depends(require_meta_access)):
    role, _ = _meta_ctx(user)
    if role not in STAFF_ROLES:
        raise HTTPException(status_code=403, detail="Admin/Ops only")
    docs = await db.meta_users.find({}, {"password_hash": 0, "visible_password": 0}).to_list(1000)
    return {"total": len(docs), "users": serialize_docs(docs)}


@router.get("/files")
async def meta_files(user: dict = Depends(require_meta_access), page: int = 1, page_size: int = 100):
    """Meta document (GridFS) metadata. Binaries are a pending backfill (binary_pending)."""
    skip = max(0, (page - 1) * page_size)
    total = await db["meta_fs.files"].count_documents({})
    pending = await db["meta_fs.files"].count_documents({"binary_pending": True})
    docs = await db["meta_fs.files"].find({}).skip(skip).limit(page_size).to_list(page_size)
    return {"total": total, "binary_pending": pending, "files": serialize_docs(docs)}


@router.get("/files/{file_id}/download")
async def meta_file_download(file_id: str, user: dict = Depends(require_meta_access)):
    doc = await db["meta_fs.files"].find_one({"_id": file_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Meta document not found")
    if doc.get("binary_pending"):
        # Do NOT crash / serve a fake file - signal pending backfill to the UI.
        raise HTTPException(status_code=409, detail="Document migration pending")
    raise HTTPException(status_code=409, detail="Document migration pending")


# ------------------- Meta write workflows (preserve old Meta rules) -------------------

def _can_action_lead(role, meta_uid, lead) -> bool:
    if role in STAFF_ROLES:
        return True
    if role == "growth_partner" and lead.get("assigned_partner_id") == meta_uid:
        return True
    if role == "processor" and lead.get("assigned_processor_id") == meta_uid:
        return True
    return False


@router.patch("/leads/{lead_id}/status")
async def meta_update_status(lead_id: str, inp: MetaStatusInput, user: dict = Depends(require_meta_access)):
    if inp.status not in CRM_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid status")
    lead = await db.meta_leads.find_one({"lead_id": lead_id})
    if not lead:
        raise HTTPException(status_code=404, detail="Meta lead not found")
    role, meta_uid = _meta_ctx(user)
    # Old Meta rule: staff OR the assigned growth partner may change status
    if role not in STAFF_ROLES and lead.get("assigned_partner_id") != meta_uid:
        raise HTTPException(status_code=403, detail="Not authorized")
    activity = {"type": "status_change",
                "detail": f"Status changed from {lead.get('status')} to {inp.status} by {user.get('name')}",
                "at": _now_iso()}
    set_status = {"status": inp.status, "updated_at": _now_iso()}
    if inp.status == "FILE" and not lead.get("file_created_at"):
        set_status["file_created_at"] = _now_iso()
    await db.meta_leads.update_one({"lead_id": lead_id},
                                   {"$set": set_status, "$push": {"activities": activity}})
    updated_lead = await db.meta_leads.find_one({"lead_id": lead_id})
    # FILE-move notifications (staff + processors) - preserves old Meta triggers
    if inp.status == "FILE" and lead.get("status") != "FILE":
        from routes.meta_sync import notify_staff_converted, notify_processors_new_file
        import asyncio as _asyncio
        _asyncio.create_task(notify_staff_converted(updated_lead, user.get("name")))
        _asyncio.create_task(notify_processors_new_file(updated_lead, user.get("name")))
    return serialize_doc(updated_lead)


@router.patch("/leads/{lead_id}/assign")
async def meta_assign_lead(lead_id: str, inp: MetaAssignInput, user: dict = Depends(require_meta_access)):
    role, _ = _meta_ctx(user)
    if role not in STAFF_ROLES:
        raise HTTPException(status_code=403, detail="Only Admin/Ops can assign Meta leads")
    lead = await db.meta_leads.find_one({"lead_id": lead_id})
    if not lead:
        raise HTTPException(status_code=404, detail="Meta lead not found")
    partner_name = None
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
        "assigned_partner_id": inp.partner_id, "assigned_partner_name": partner_name,
        "updated_at": _now_iso(),
        "assigned_by": (user.get("name") if inp.partner_id else None),
        "assigned_at": (_now_iso() if inp.partner_id else None),
    }, "$push": {"activities": activity}})
    updated_lead = await db.meta_leads.find_one({"lead_id": lead_id})
    # Assignment notification to the Growth Partner's meta_email (one send)
    if inp.partner_id and partner:
        from routes.meta_sync import notify_partner_assignment
        import asyncio as _asyncio
        _asyncio.create_task(notify_partner_assignment(partner, updated_lead, user.get("name")))
    return serialize_doc(updated_lead)


@router.post("/leads/{lead_id}/notes")
async def meta_add_note(lead_id: str, inp: MetaNoteInput, user: dict = Depends(require_meta_access)):
    lead = await db.meta_leads.find_one({"lead_id": lead_id})
    if not lead:
        raise HTTPException(status_code=404, detail="Meta lead not found")
    role, meta_uid = _meta_ctx(user)
    if not _can_action_lead(role, meta_uid, lead):
        raise HTTPException(status_code=403, detail="Not authorized")
    note = {"text": inp.text, "author": user.get("name"), "at": _now_iso()}
    activity = {"type": "note", "detail": f"{user.get('name')} added a note", "at": _now_iso()}
    await db.meta_leads.update_one({"lead_id": lead_id},
                                   {"$push": {"notes": note, "activities": activity},
                                    "$set": {"updated_at": _now_iso()}})
    return serialize_doc(await db.meta_leads.find_one({"lead_id": lead_id}))


@router.post("/leads/{lead_id}/call-log")
async def meta_add_call_log(lead_id: str, inp: MetaCallLogInput, user: dict = Depends(require_meta_access)):
    """Save a Meta call (from the mobile post-call modal) onto the Meta lead.
    Reuses the native call lifecycle for duration; stores ONLY in isolated meta_leads.
    Idempotent on call_id so native call-log sync cannot create a duplicate."""
    lead = await db.meta_leads.find_one({"lead_id": lead_id})
    if not lead:
        raise HTTPException(status_code=404, detail="Meta lead not found")
    role, meta_uid = _meta_ctx(user)
    if not _can_action_lead(role, meta_uid, lead):
        raise HTTPException(status_code=403, detail="Not authorized")

    # Dedupe: same physical call (call_id) => exactly one record
    existing = next((c for c in (lead.get("call_logs") or []) if c.get("call_id") == inp.call_id), None)
    if existing:
        return {"deduped": True, "lead": serialize_doc(lead)}

    now = _now_iso()
    call = {
        "call_id": inp.call_id,
        "lead_source": "meta",
        "source": "mobile",
        "meta_user_id": meta_uid,
        "connect_user_id": user.get("id"),
        "user_name": user.get("name"),
        "phone": inp.phone or lead.get("phone"),
        "started_at": inp.started_at,
        "ended_at": inp.ended_at,
        "duration_seconds": int(inp.duration_seconds or 0),
        "disposition": inp.outcome,
        "note": inp.note,
        "at": now,
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
        from routes.meta_sync import notify_staff_converted, notify_processors_new_file
        import asyncio as _asyncio
        _asyncio.create_task(notify_staff_converted(updated, user.get("name")))
        _asyncio.create_task(notify_processors_new_file(updated, user.get("name")))
    return {"deduped": False, "lead": serialize_doc(updated)}


@router.get("/my-call-stats")
async def meta_my_call_stats(user: dict = Depends(require_meta_access)):
    """Growth Partner's Meta call talk-time/count derived from meta_leads.call_logs."""
    role, meta_uid = _meta_ctx(user)
    scope = _lead_scope(user)
    total_calls, total_talk = 0, 0
    async for lead in db.meta_leads.find(scope, {"call_logs": 1}):
        for c in (lead.get("call_logs") or []):
            if role in STAFF_ROLES or c.get("meta_user_id") == meta_uid:
                total_calls += 1
                total_talk += int(c.get("duration_seconds") or 0)
    return {"total_calls": total_calls, "total_talk_time_seconds": total_talk}


@router.get("/partners")
async def meta_partners(user: dict = Depends(require_meta_access)):
    """Approved growth partners for the assignment dropdown (staff only)."""
    role, _ = _meta_ctx(user)
    if role not in STAFF_ROLES:
        raise HTTPException(status_code=403, detail="Admin/Ops only")
    docs = await db.meta_users.find({"role": "growth_partner", "approved": True},
                                    {"password_hash": 0, "visible_password": 0}).to_list(1000)
    return [{"user_id": d.get("user_id"), "name": d.get("name"), "email": d.get("email")} for d in docs]


# ------------------- Meta User Management (Connect Admin controls) -------------------

@router.get("/admin/user-management")
async def meta_user_management(current_user: dict = Depends(require_admin)):
    """Connect users + their Meta linkage, plus the pool of Meta users for manual mapping."""
    connect_users = await db.users.find(
        {}, {"name": 1, "email": 1, "role": 1, "is_active": 1,
             "meta_access": 1, "meta_role": 1, "meta_email": 1, "meta_user_id": 1}
    ).to_list(10000)
    meta_users = await db.meta_users.find(
        {}, {"password_hash": 0, "visible_password": 0}).to_list(1000)
    linked = {u.get("meta_user_id") for u in connect_users if u.get("meta_user_id")}
    return {
        "meta_roles": META_ROLES,
        "connect_users": serialize_docs(connect_users),
        "meta_users": [{"user_id": m.get("user_id"), "name": m.get("name"),
                        "email": m.get("email"), "role": m.get("role"),
                        "linked": (m.get("user_id") in linked)} for m in meta_users],
    }


@router.patch("/admin/users/{connect_user_id}")
async def meta_set_user_access(connect_user_id: str, inp: MetaUserMgmtInput,
                               current_user: dict = Depends(require_admin)):
    """Set Meta Access / Role / Email / mapping for a Connect user (Admin only).
    Prevents mapping the same Meta user to two Connect accounts (no duplicate mappings)."""
    oid = object_id_or_none(connect_user_id)
    match = {"$or": [{"id": connect_user_id}] + ([{"_id": oid}] if oid else [])}
    target = await db.users.find_one(match)
    if not target:
        raise HTTPException(status_code=404, detail="Connect user not found")

    if inp.meta_role and inp.meta_role not in META_ROLES:
        raise HTTPException(status_code=400, detail="Invalid Meta role")

    if inp.meta_user_id:
        dup = await db.users.find_one({
            "meta_user_id": inp.meta_user_id,
            "_id": {"$ne": target["_id"]},
        })
        if dup:
            raise HTTPException(status_code=400,
                                detail=f"That Meta user is already mapped to {dup.get('email')}")

    set_fields = {
        "meta_access": bool(inp.meta_access),
        "meta_role": inp.meta_role,
        "meta_email": inp.meta_email,
        "meta_user_id": inp.meta_user_id,
    }
    await db.users.update_one({"_id": target["_id"]}, {"$set": set_fields})
    updated = await db.users.find_one({"_id": target["_id"]},
                                      {"name": 1, "email": 1, "role": 1, "meta_access": 1,
                                       "meta_role": 1, "meta_email": 1, "meta_user_id": 1})
    return serialize_doc(updated)
