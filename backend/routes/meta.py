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

from utils.database import db
from utils.auth import require_meta_access
from utils.helpers import serialize_doc, serialize_docs

router = APIRouter(prefix="/api/meta", tags=["Meta"])

STAFF_ROLES = {"admin", "ops"}


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
