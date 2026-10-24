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
import re
import uuid
import csv
import zipfile
import asyncio
import bcrypt
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Response, Header
from typing import Optional
from datetime import datetime, timezone, timedelta
from pydantic import BaseModel

from utils.database import db
from utils.auth import require_meta_access, require_admin
from utils.helpers import serialize_doc, serialize_docs, object_id_or_none
from utils import meta_storage
from utils.amounts import parse_amount_to_num

router = APIRouter(prefix="/api/meta", tags=["Meta"])

STAFF_ROLES = {"admin", "ops"}
CRM_STATUSES = ["NEW", "CALL_BACK", "NOT_ANSWERING", "SWITCHED_OFF", "NOT_INTERESTED", "NOT_QUALIFIED", "LEAD", "FILE"]
DISPOSITIONS = {"NOT_ANSWERING", "SWITCHED_OFF", "NOT_INTERESTED", "NOT_QUALIFIED", "CALL_BACK", "LEAD", "FILE"}
META_ROLES = ["admin", "ops", "processor", "growth_partner"]
PROCESSING_STATUSES = [
    "New", "Contacted", "Documents Collected", "Documents Pending", "Sent for Eligibility",
    "Sent for Login", "Login Done", "Sent for Approval", "Underwriting", "FI (Field Investigation)",
    "FI Negative", "FI Reinitiated", "Query", "Hold", "Customer Not Interested - Need Help from MIT & Manager",
    "Customer Not Supporting - Need Help from MIT & Manager", "Approved", "Disbursed", "Not Eligible",
    "Not Login", "Declined", "Not Disbursed",
]
# Legacy combined status — kept for DISPLAY and backward-accept only; never offered in the dropdown.
LEGACY_PROCESSING_STATUSES = {"Query/Hold"}
# Statuses that require a mandatory follow-up (description + follow-up date).
FOLLOWUP_STATUSES = {"Query", "Hold"}
ALL_PROCESSING_STATUSES = set(PROCESSING_STATUSES) | LEGACY_PROCESSING_STATUSES
ALLOWED_DOC_TYPES = {"application/pdf", "image/png", "image/jpeg", "image/jpg"}
MAX_DOC_BYTES = 10 * 1024 * 1024
NOT_DELETED = {"deleted": {"$ne": True}}


def _now_iso():
    return datetime.now(timezone.utc).isoformat()


def _ctx(user: dict):
    """(meta_role, meta_user_id) — the caller's Meta identity from their Connect account."""
    return (user.get("meta_role_normalized") or (user.get("meta_role") or "").strip().lower()), user.get("meta_user_id")


_IST_TZ = timezone(timedelta(hours=5, minutes=30))


def _ist_today():
    return datetime.now(_IST_TZ).date()


def _followup_days(followup_date):
    """Signed days until follow-up (IST). Negative = overdue. None if missing/unparseable."""
    if not followup_date:
        return None
    try:
        fd = datetime.fromisoformat(str(followup_date)[:10]).date()
    except Exception:
        return None
    return (fd - _ist_today()).days


def _followup_urgency(days):
    if days is None:
        return "none"
    if days < 0:
        return "overdue"
    if days == 0:
        return "due_today"
    if days == 1:
        return "due_tomorrow"
    if days <= 3:
        return "upcoming"
    return "later"


# ---------------------------- End-to-End TAT ----------------------------
# A file is "completed" once it first reaches one of these five final statuses.
FINAL_STATUSES = {"Disbursed", "Not Disbursed", "Declined", "Not Eligible", "Not Login"}
TAT_LIMIT_HOURS = 96  # 4 calendar days


def _ist_now():
    return datetime.now(_IST_TZ)


def _lead_created_dt(lead):
    return _parse_dt(lead.get("file_created_at") or lead.get("created_at") or lead.get("created_time"))


def _ms_breakdown(ms):
    total_hours = ms / 3600000.0
    return {"ms": int(ms), "days": int(total_hours // 24), "hours": int(total_hours % 24)}


def compute_tat(lead, now=None):
    """Dynamic End-to-End TAT for a file. Start = original creation timestamp; End = first final
    status timestamp (tat_final_at) if completed, else now. Overdue when > 96h and still ongoing.
    All datetimes are naive-UTC (matching _parse_dt) to keep arithmetic consistent."""
    now = now or datetime.now(timezone.utc).replace(tzinfo=None)
    created = _lead_created_dt(lead)
    status = lead.get("processing_status") or "New"
    final_at = _parse_dt(lead.get("tat_final_at"))
    is_final = bool(final_at) or status in FINAL_STATUSES
    res = {
        "created_at": lead.get("file_created_at") or lead.get("created_at"),
        "final_status": lead.get("tat_final_status") or (status if status in FINAL_STATUSES else None),
        "state": "completed" if is_final else "ongoing",
        "ms": None, "days": None, "hours": None, "overdue": False,
        "available": created is not None, "unavailable": False,
    }
    if not created:
        res["unavailable"] = is_final
        return res
    limit_ms = TAT_LIMIT_HOURS * 3600 * 1000
    if is_final:
        if final_at:
            ms = max(0, (final_at - created).total_seconds() * 1000)
            res.update(_ms_breakdown(ms))
            res["overdue"] = False  # completed files never raise an active alert
        else:
            res["unavailable"] = True  # legacy final file with no recorded completion timestamp
        return res
    ms = max(0, (now - created).total_seconds() * 1000)
    res.update(_ms_breakdown(ms))
    res["overdue"] = ms > limit_ms
    return res


def build_processing_status_update(lead, status, desc, fdate, remarks, user_name):
    """Validate a processing-status change (incl. Query/Hold follow-up) and return a mongo update doc.
    Raises HTTPException on invalid input. Manages the active followup + followup_history."""
    if status not in ALL_PROCESSING_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid processing status")
    now = _now_iso()
    set_fields = {"processing_status": status, "updated_at": now}
    acts = [{"type": "processing", "detail": f"Processing status set to '{status}' by {user_name}", "at": now}]
    prev = lead.get("followup")
    history = list(lead.get("followup_history") or [])

    if status in FOLLOWUP_STATUSES:
        desc = (desc or "").strip()
        fdate = (fdate or "").strip()[:10]
        if not desc or not fdate:
            label = "Query Description" if status == "Query" else "Hold Reason"
            raise HTTPException(status_code=400, detail=f"{label} and Follow-up Date are required for {status}")
        if prev and prev.get("active"):
            history.append({**prev, "active": False, "closed_at": now})
        set_fields["followup"] = {
            "kind": status, "description": desc, "followup_date": fdate,
            "remarks": (remarks or "").strip(), "active": True,
            "updated_by": user_name, "updated_at": now, "created_at": now,
        }
        set_fields["followup_history"] = history
        acts.append({"type": "followup", "detail": f"{status} follow-up set for {fdate} by {user_name}", "at": now})
    else:
        if prev and prev.get("active"):
            history.append({**prev, "active": False, "resolved_at": now, "resolved_to": status})
            set_fields["followup_history"] = history
            set_fields["followup"] = {**prev, "active": False, "resolved_at": now}

    # --- End-to-End TAT: stamp first final completion / resume on reopen ---
    final_at_existing = lead.get("tat_final_at")
    if status in FINAL_STATUSES:
        if not final_at_existing:
            set_fields["tat_final_at"] = now
            set_fields["tat_final_status"] = status
            created = _lead_created_dt(lead)
            if created:
                fdt = _parse_dt(now)
                set_fields["tat_final_ms"] = int(max(0, (fdt - created).total_seconds() * 1000))
            acts.append({"type": "tat", "detail": f"File completed ('{status}') — End-to-End TAT recorded by {user_name}", "at": now})
    elif final_at_existing:
        # reopened into an ongoing status: archive the prior final record, resume tracking
        tat_hist = list(lead.get("tat_history") or [])
        tat_hist.append({
            "final_status": lead.get("tat_final_status"), "final_at": final_at_existing,
            "final_ms": lead.get("tat_final_ms"), "reopened_at": now,
            "reopened_to": status, "reopened_by": user_name,
        })
        set_fields["tat_history"] = tat_hist
        set_fields["tat_final_at"] = None
        set_fields["tat_final_status"] = None
        set_fields["tat_final_ms"] = None
        acts.append({"type": "tat", "detail": f"File reopened to '{status}' — TAT tracking resumed from original creation by {user_name}", "at": now})

    return {"$set": set_fields, "$push": {"activities": {"$each": acts}}}



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
    notes: Optional[str] = ""
    follow_up_date: Optional[str] = None
    follow_up_time: Optional[str] = None


class MetaFileInput(BaseModel):
    data: dict


class MetaProcessorInput(BaseModel):
    processor_id: Optional[str] = None


class MetaProcStatusInput(BaseModel):
    status: str
    followup_description: Optional[str] = None
    followup_date: Optional[str] = None
    followup_remarks: Optional[str] = None


class MetaFollowupInput(BaseModel):
    followup_description: str
    followup_date: str
    followup_remarks: Optional[str] = None


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


class MetaLeadEditInput(BaseModel):
    full_name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    city: Optional[str] = None
    employment_status: Optional[str] = None
    monthly_salary: Optional[str] = None
    outstanding_amount: Optional[str] = None
    cibil_score: Optional[str] = None
    campaign_name: Optional[str] = None
    form_name: Optional[str] = None
    platform: Optional[str] = None


class MetaLeadCreateInput(BaseModel):
    full_name: str
    phone: str
    email: Optional[str] = ""
    city: Optional[str] = ""
    employment_status: Optional[str] = ""
    monthly_salary: Optional[str] = ""
    outstanding_amount: Optional[str] = ""
    cibil_score: Optional[str] = ""
    campaign_name: Optional[str] = ""
    form_name: Optional[str] = ""
    platform: Optional[str] = ""
    status: Optional[str] = "NEW"
    partner_id: Optional[str] = None


class MetaCallLogInput(BaseModel):
    call_id: str
    phone: Optional[str] = None
    started_at: Optional[str] = None
    ended_at: Optional[str] = None
    duration_seconds: int = 0
    outcome: Optional[str] = None
    note: Optional[str] = None
    reason: Optional[str] = None
    follow_up_date: Optional[str] = None
    follow_up_time: Optional[str] = None
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
SORT_FIELDS = {"created_time", "full_name", "city", "status", "file_created_at",
               "monthly_salary_num", "outstanding_amount_num", "employment_status",
               "assigned_partner_name"}


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
    source: Optional[str] = None,
    processor: Optional[str] = None,
    processing_status: Optional[str] = None,
    loan_type: Optional[str] = None,
    bank: Optional[str] = None,
    docs: Optional[str] = None,
    assignment: Optional[str] = None,
    file_from: Optional[str] = None,
    file_to: Optional[str] = None,
    followup: Optional[str] = None,
    tat: Optional[str] = None,
    statuses: Optional[str] = None,
    name: Optional[str] = None,
    name_mode: Optional[str] = None,
    contact: Optional[str] = None,
    cities: Optional[str] = None,
    city_blank: Optional[bool] = False,
    employments: Optional[str] = None,
    emp_blank: Optional[bool] = False,
    salary_min: Optional[float] = None,
    salary_max: Optional[float] = None,
    salary_blank: Optional[bool] = False,
    outstanding_min: Optional[float] = None,
    outstanding_max: Optional[float] = None,
    outstanding_blank: Optional[bool] = False,
    partners: Optional[str] = None,
    partner_unassigned: Optional[bool] = False,
):
    role, uid = _ctx(user)
    query = dict(NOT_DELETED)
    if role == "processor":
        query["assigned_processor_id"] = uid
    elif role not in STAFF_ROLES:
        query["assigned_partner_id"] = uid
    if status and status != "ALL":
        query["status"] = status
    if source and source.upper() != "ALL":
        s = source.upper()
        if s == "WEBSITE":
            query["source_tab"] = "Website"
        elif s == "MANUAL":
            query["source_tab"] = "Manual Entry"
        elif s == "META":
            query["source_tab"] = {"$nin": ["Website", "Manual Entry"]}
    if partner and partner != "ALL" and role in STAFF_ROLES:
        query["assigned_partner_id"] = None if partner == "UNASSIGNED" else partner
    # ---- Files & Conversions advanced filters (AND logic) ----
    and_list = []
    if processor and processor != "ALL" and role in STAFF_ROLES:
        query["assigned_processor_id"] = None if processor == "UNASSIGNED" else processor
    if processing_status and processing_status != "ALL":
        if processing_status == "New":
            and_list.append({"$or": [
                {"processing_status": "New"}, {"processing_status": None},
                {"processing_status": ""}, {"processing_status": {"$exists": False}},
            ]})
        else:
            query["processing_status"] = processing_status
    if loan_type and loan_type != "ALL":
        query["file.loan_type"] = {"$regex": f"^\\s*{re.escape(loan_type.strip())}\\s*$", "$options": "i"}
    if bank and bank != "ALL":
        rx = {"$regex": re.escape(bank.strip()), "$options": "i"}
        and_list.append({"$or": [
            {"file.disbursed_bank": rx}, {"file.approved_bank": rx}, {"file.login_bank": rx},
            {"file.bank": rx}, {"file.lender": rx}, {"file.banks.bank_name": rx},
        ]})
    if docs == "received":
        query["docs_received"] = True
    elif docs == "pending":
        query["docs_received"] = {"$ne": True}
    if assignment and role in STAFF_ROLES:
        if assignment == "assigned":
            query["assigned_partner_id"] = {"$nin": [None, ""]}
        elif assignment == "unassigned":
            query["assigned_partner_id"] = None
    if file_from or file_to:
        rng = {}
        if file_from:
            rng["$gte"] = f"{file_from}T00:00:00"
        if file_to:
            rng["$lte"] = f"{file_to}T23:59:59.999999+00:00"
        if rng:
            and_list.append({"$or": [{"file_created_at": rng}, {"created_at": rng}]})
    if followup and followup != "ALL":
        today = _ist_today()
        today_s = today.isoformat()
        tom_s = (today + timedelta(days=1)).isoformat()
        plus3_s = (today + timedelta(days=3)).isoformat()
        if followup == "overdue":
            query["followup.active"] = True
            query["followup.followup_date"] = {"$lt": today_s}
        elif followup == "due_today":
            query["followup.active"] = True
            query["followup.followup_date"] = today_s
        elif followup == "upcoming":
            query["followup.active"] = True
            query["followup.followup_date"] = {"$gte": tom_s, "$lte": plus3_s}
        elif followup == "none":
            and_list.append({"processing_status": {"$in": ["Query", "Hold", "Query/Hold"]}})
            and_list.append({"$or": [
                {"followup": None}, {"followup": {"$exists": False}},
                {"followup.active": {"$ne": True}},
                {"followup.followup_date": {"$in": [None, ""]}},
                {"followup.followup_date": {"$exists": False}},
            ]})
    if tat and tat != "ALL":
        cutoff = (datetime.now(timezone.utc) - timedelta(hours=TAT_LIMIT_HOURS)).isoformat()
        limit_ms = TAT_LIMIT_HOURS * 3600 * 1000
        ongoing = [
            {"processing_status": {"$nin": list(FINAL_STATUSES)}},
            {"$or": [{"tat_final_at": {"$in": [None]}}, {"tat_final_at": {"$exists": False}}]},
        ]
        created_before = {"$or": [
            {"file_created_at": {"$lt": cutoff}},
            {"$and": [{"file_created_at": {"$in": [None]}}, {"created_at": {"$lt": cutoff}}]},
        ]}
        created_after = {"$or": [
            {"file_created_at": {"$gte": cutoff}},
            {"$and": [{"file_created_at": {"$in": [None]}}, {"created_at": {"$gte": cutoff}}]},
        ]}
        if tat == "exceeded":
            and_list.extend(ongoing)
            and_list.append(created_before)
        elif tat == "within":
            and_list.extend(ongoing)
            and_list.append(created_after)
        elif tat == "completed_within":
            and_list.append({"tat_final_ms": {"$exists": True, "$ne": None, "$lte": limit_ms}})
        elif tat == "completed_beyond":
            and_list.append({"tat_final_ms": {"$exists": True, "$ne": None, "$gt": limit_ms}})
    if from_date or to_date:
        # Meta Leads date filtering is by ASSIGNMENT date (assigned_at, set when a lead is
        # assigned to a GP/user) — NOT created_time / imported / sheet-row date. Unassigned
        # leads (assigned_at=None) are naturally excluded from a date-scoped view.
        ct = {}
        if from_date:
            ct["$gte"] = f"{from_date}T00:00:00"
        if to_date:
            ct["$lte"] = f"{to_date}T23:59:59.999999+00:00"
        if ct:
            query["assigned_at"] = ct
    if q:
        query["$or"] = [
            {"full_name": {"$regex": q, "$options": "i"}},
            {"phone": {"$regex": q, "$options": "i"}},
            {"email": {"$regex": q, "$options": "i"}},
            {"city": {"$regex": q, "$options": "i"}},
            {"lead_id": {"$regex": q, "$options": "i"}},
        ]
    # ---- Per-column advanced filters (Leads table). OR within a column, AND across columns. ----
    def _csv(v):
        return [x.strip() for x in (v or "").split(",") if x.strip()]

    if statuses:
        st_list = [s.upper() for s in _csv(statuses)]
        if st_list:
            query["status"] = {"$in": st_list}
    if name:
        esc = re.escape(name.strip())
        mode = (name_mode or "contains").lower()
        if mode == "exact":
            pat = f"^{esc}$"
        elif mode == "starts":
            pat = f"^{esc}"
        else:
            pat = esc
        and_list.append({"full_name": {"$regex": pat, "$options": "i"}})
    if contact:
        digits = re.sub(r"\D", "", contact)
        if digits.startswith("91") and len(digits) > 10:
            digits = digits[2:]
        if digits:
            and_list.append({"phone": {"$regex": re.escape(digits)}})
    city_ors = []
    sel_cities = _csv(cities)
    if sel_cities:
        city_ors.extend({"city": {"$regex": f"^\\s*{re.escape(c)}\\s*$", "$options": "i"}} for c in sel_cities)
    if city_blank:
        city_ors.append({"$or": [{"city": {"$in": [None, ""]}}, {"city": {"$exists": False}}]})
    if city_ors:
        and_list.append({"$or": city_ors})
    emp_ors = []
    sel_emps = _csv(employments)
    if sel_emps:
        emp_ors.extend({"employment_status": {"$regex": f"^\\s*{re.escape(e)}\\s*$", "$options": "i"}} for e in sel_emps)
    if emp_blank:
        emp_ors.append({"$or": [{"employment_status": {"$in": [None, ""]}}, {"employment_status": {"$exists": False}}]})
    if emp_ors:
        and_list.append({"$or": emp_ors})

    def _amount_filter(field, lo, hi, blank):
        ors = []
        rng = {}
        if lo is not None:
            rng["$gte"] = lo
        if hi is not None:
            rng["$lte"] = hi
        if rng:
            ors.append({field: rng})
        if blank:
            ors.append({"$or": [{field: {"$in": [None]}}, {field: {"$exists": False}}]})
        if ors:
            and_list.append({"$or": ors})

    _amount_filter("monthly_salary_num", salary_min, salary_max, salary_blank)
    _amount_filter("outstanding_amount_num", outstanding_min, outstanding_max, outstanding_blank)

    if role in STAFF_ROLES and (partners or partner_unassigned):
        p_ors = []
        sel_partners = _csv(partners)
        if sel_partners:
            p_ors.append({"assigned_partner_id": {"$in": sel_partners}})
        if partner_unassigned:
            p_ors.append({"assigned_partner_id": {"$in": [None, ""]}})
        if p_ors:
            and_list.append({"$or": p_ors})

    if and_list:
        query.setdefault("$and", []).extend(and_list)
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


@router.get("/leads/filter-options")
async def meta_leads_filter_options(user: dict = Depends(require_meta_access)):
    """Distinct cities / employment types for the Leads column-filter dropdowns, scoped to the
    caller's visible leads (role-aware). Partners come from /meta/partners."""
    role, uid = _ctx(user)
    base = dict(NOT_DELETED)
    if role == "processor":
        base["assigned_processor_id"] = uid
    elif role not in STAFF_ROLES:
        base["assigned_partner_id"] = uid
    cities = await db.meta_leads.distinct("city", base)
    employments = await db.meta_leads.distinct("employment_status", base)
    def _clean(vals):
        seen = {}
        for v in vals:
            s = (str(v).strip() if v is not None else "")
            if not s:
                continue
            key = s.lower()
            if key not in seen:
                seen[key] = s
        return sorted(seen.values(), key=lambda x: x.lower())
    return {"cities": _clean(cities), "employments": _clean(employments)}


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


@router.post("/leads")
async def meta_create_lead(inp: MetaLeadCreateInput, user: dict = Depends(require_meta_access)):
    """Admin/Ops: manually add a Meta lead that did NOT come from the Google Sheet."""
    role, _ = _ctx(user)
    if role not in STAFF_ROLES:
        raise HTTPException(status_code=403, detail="Only Admin/Ops can add Meta leads")
    name = (inp.full_name or "").strip()
    phone = (inp.phone or "").strip()
    if not name or not phone:
        raise HTTPException(status_code=400, detail="Name and phone are required")
    status = (inp.status or "NEW").strip().upper()
    if status not in CRM_STATUSES:
        status = "NEW"
    # Optional assignment to an approved growth partner
    partner_id = None
    partner_name = None
    assigned_at = None
    assigned_by = None
    if inp.partner_id:
        partner = await db.meta_users.find_one({"user_id": inp.partner_id})
        if not partner:
            raise HTTPException(status_code=404, detail="Partner not found")
        if partner.get("role") != "growth_partner" or not partner.get("approved"):
            raise HTTPException(status_code=400, detail="Leads can only be assigned to an approved growth partner")
        partner_id = inp.partner_id
        partner_name = partner.get("name")
        assigned_at = _now_iso()
        assigned_by = user.get("name")
    now = _now_iso()
    doc = {
        "sheet_id": None,
        "source": "manual",
        "source_tab": "Manual Entry",
        "created_time": now,
        "full_name": name,
        "phone": phone,
        "email": (inp.email or "").strip(),
        "city": (inp.city or "").strip(),
        "employment_status": (inp.employment_status or "").strip(),
        "monthly_salary": (inp.monthly_salary or "").strip(),
        "outstanding_amount": (inp.outstanding_amount or "").strip(),
        "monthly_salary_num": parse_amount_to_num(inp.monthly_salary),
        "outstanding_amount_num": parse_amount_to_num(inp.outstanding_amount),
        "cibil_score": (inp.cibil_score or "").strip(),
        "campaign_name": (inp.campaign_name or "").strip(),
        "form_name": (inp.form_name or "").strip() or "Manual Entry",
        "platform": (inp.platform or "").strip(),
        "sheet_status": status,
        "lead_id": f"lead_{uuid.uuid4().hex[:12]}",
        "status": status,
        "assigned_partner_id": partner_id,
        "assigned_partner_name": partner_name,
        "assigned_at": assigned_at,
        "assigned_by": assigned_by,
        "notes": [],
        "activities": [{"type": "created", "detail": f"Lead added manually by {user.get('name', 'Admin')}", "at": now}],
        "created_at": now,
        "updated_at": now,
    }
    await db.meta_leads.insert_one(doc)
    return serialize_doc(doc)


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


@router.patch("/leads/{lead_id}/info")
async def meta_edit_lead_info(lead_id: str, inp: MetaLeadEditInput, user: dict = Depends(require_meta_access)):
    """Admin/Ops: edit a Meta lead's info fields (name, phone, salary, CIBIL, etc.)."""
    role, _ = _ctx(user)
    if role not in STAFF_ROLES:
        raise HTTPException(status_code=403, detail="Only Admin/Ops can edit lead info")
    lead = await _get_lead_or_404(lead_id)
    editable = ["full_name", "phone", "email", "city", "employment_status", "monthly_salary",
                "outstanding_amount", "cibil_score", "campaign_name", "form_name", "platform"]
    updates = {}
    changed = []
    for f in editable:
        val = getattr(inp, f)
        if val is None:
            continue
        val = val.strip()
        if val != (lead.get(f) or ""):
            updates[f] = val
            changed.append(f.replace("_", " "))
    if "full_name" in updates and not updates["full_name"]:
        raise HTTPException(status_code=400, detail="Name cannot be empty")
    if "phone" in updates and not updates["phone"]:
        raise HTTPException(status_code=400, detail="Phone cannot be empty")
    if not updates:
        return serialize_doc(lead)
    updates["updated_at"] = _now_iso()
    activity = {"type": "edit",
                "detail": f"Lead info edited ({', '.join(changed)}) by {user.get('name', 'Admin')}",
                "at": _now_iso()}
    await db.meta_leads.update_one({"lead_id": lead_id}, {"$set": updates, "$push": {"activities": activity}})
    updated = await db.meta_leads.find_one({"lead_id": lead_id})
    return serialize_doc(updated)


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
        try:
            from routes.chatbot_integration import prefill_file_from_qualification
            await prefill_file_from_qualification(lead_id)
        except Exception:
            pass
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
    # Idempotent: only notify the partner when the assignment actually CHANGED to a new partner
    if inp.partner_id and partner and lead.get("assigned_partner_id") != inp.partner_id:
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
            "reason": inp.reason or "", "docs_received": inp.docs_received,
            "notes": (inp.notes or "").strip(),
            "follow_up_date": inp.follow_up_date, "follow_up_time": inp.follow_up_time}
    detail = f"{user.get('name')} logged a call ({dur // 60}m {dur % 60}s) — {inp.disposition.replace('_', ' ').title()}"
    set_fields = {"disposition": inp.disposition, "updated_at": now}
    if lead.get("status") != "FILE":
        set_fields["status"] = inp.disposition
    if inp.follow_up_date:
        set_fields["follow_up_date"] = inp.follow_up_date
        set_fields["follow_up_time"] = inp.follow_up_time
    push = {"call_logs": call, "activities": {"type": "call", "detail": detail, "at": now}}
    if (inp.notes or "").strip():
        push["notes"] = {"text": inp.notes.strip(), "author": user.get("name"), "at": now}
    if inp.disposition == "FILE" and not lead.get("file_created_at"):
        set_fields["file_created_at"] = now
    if inp.docs_received is not None:
        set_fields["docs_received"] = inp.docs_received
    if inp.disposition == "FILE" and not lead.get("file"):
        set_fields["file"] = {}
    await db.meta_leads.update_one({"lead_id": lead_id}, {"$set": set_fields, "$push": push})
    is_new_file = inp.disposition == "FILE" and lead.get("status") != "FILE"
    if is_new_file:
        await _auto_assign_processor(lead_id, {**lead, **set_fields})
        try:
            from routes.chatbot_integration import prefill_file_from_qualification
            await prefill_file_from_qualification(lead_id)
        except Exception:
            pass
    updated = await db.meta_leads.find_one({"lead_id": lead_id})
    if is_new_file:
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
        "duration_seconds": int(inp.duration_seconds or 0), "disposition": inp.outcome, "note": inp.note,
        "notes": inp.note, "reason": inp.reason, "follow_up_date": inp.follow_up_date, "follow_up_time": inp.follow_up_time, "at": now,
    }
    push = {"call_logs": call, "activities": {
        "type": "call",
        "detail": f"{user.get('name')} called {call['phone']} — {inp.outcome or 'no outcome'} ({call['duration_seconds']}s)",
        "at": now}}
    if inp.note:
        push["notes"] = {"text": inp.note, "author": user.get("name"), "at": now}
    set_fields = {"updated_at": now}
    if inp.follow_up_date:
        set_fields["follow_up_date"] = inp.follow_up_date
        set_fields["follow_up_time"] = inp.follow_up_time
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
    role, uid = _ctx(user)
    lead = await _get_lead_or_404(lead_id)
    assigned_proc = role == "processor" and lead.get("assigned_processor_id") == uid
    if role not in ("admin", "ops") and not assigned_proc:
        raise HTTPException(status_code=403, detail="Not authorized")
    update = build_processing_status_update(lead, inp.status, inp.followup_description,
                                            inp.followup_date, inp.followup_remarks, user.get("name"))
    await db.meta_leads.update_one({"lead_id": lead_id}, update)
    return serialize_doc(await db.meta_leads.find_one({"lead_id": lead_id}))


@router.patch("/leads/{lead_id}/followup")
async def meta_update_followup(lead_id: str, inp: MetaFollowupInput, user: dict = Depends(require_meta_access)):
    """Edit the active Query/Hold follow-up (reason, date, remarks) without changing status.
    Admin, Ops and the assigned Processor only. Snapshots the previous values to history."""
    role, uid = _ctx(user)
    lead = await _get_lead_or_404(lead_id)
    assigned_proc = role == "processor" and lead.get("assigned_processor_id") == uid
    if role not in ("admin", "ops") and not assigned_proc:
        raise HTTPException(status_code=403, detail="Not authorized")
    prev = lead.get("followup")
    if not prev or not prev.get("active"):
        raise HTTPException(status_code=400, detail="No active follow-up on this file")
    desc = (inp.followup_description or "").strip()
    fdate = (inp.followup_date or "").strip()[:10]
    if not desc or not fdate:
        raise HTTPException(status_code=400, detail="Follow-up reason and date are required")
    now = _now_iso()
    history = list(lead.get("followup_history") or [])
    history.append({**prev, "active": False, "closed_at": now})
    new_fu = {**prev, "description": desc, "followup_date": fdate,
              "remarks": (inp.followup_remarks or "").strip(), "active": True,
              "updated_by": user.get("name"), "updated_at": now}
    await db.meta_leads.update_one({"lead_id": lead_id}, {
        "$set": {"followup": new_fu, "followup_history": history, "updated_at": now},
        "$push": {"activities": {"type": "followup", "detail": f"{prev.get('kind')} follow-up updated (due {fdate}) by {user.get('name')}", "at": now}},
    })
    return serialize_doc(await db.meta_leads.find_one({"lead_id": lead_id}))


@router.get("/followups")
async def meta_followups(user: dict = Depends(require_meta_access)):
    """Role-scoped active Query/Hold follow-ups with IST urgency + counts.
    Used by the dashboard widget and the header notification bell."""
    role, uid = _ctx(user)
    match = {"status": "FILE", "followup.active": True, **NOT_DELETED}
    if role == "processor":
        match["assigned_processor_id"] = uid
    elif role not in STAFF_ROLES:
        match["assigned_partner_id"] = uid
    docs = await db.meta_leads.find(match).to_list(2000)
    items = []
    for d in docs:
        fu = d.get("followup") or {}
        days = _followup_days(fu.get("followup_date"))
        items.append({
            "lead_id": d.get("lead_id"),
            "full_name": d.get("full_name") or "",
            "phone": d.get("phone") or "",
            "kind": fu.get("kind"),
            "description": fu.get("description") or "",
            "followup_date": fu.get("followup_date"),
            "remarks": fu.get("remarks") or "",
            "assigned_processor_name": d.get("assigned_processor_name") or "",
            "assigned_partner_name": d.get("assigned_partner_name") or "",
            "updated_by": fu.get("updated_by") or "",
            "updated_at": fu.get("updated_at"),
            "days": days,
            "urgency": _followup_urgency(days),
        })
    items.sort(key=lambda x: (x["days"] is None, x["days"] if x["days"] is not None else 0))
    counts = {
        "total_active": len(items),
        "overdue": sum(1 for i in items if i["urgency"] == "overdue"),
        "due_today": sum(1 for i in items if i["urgency"] == "due_today"),
        "upcoming": sum(1 for i in items if i["urgency"] in ("due_tomorrow", "upcoming")),
    }
    # Reminders = anything needing attention within 3 days (overdue, today, next 3 days).
    reminders = [i for i in items if i["days"] is not None and i["days"] <= 3]
    counts["reminders"] = len(reminders)
    return {"items": items, "reminders": reminders, "counts": counts}


@router.get("/tat/alerts")
async def meta_tat_alerts(exclude_snoozed: bool = False, user: dict = Depends(require_meta_access)):
    """Role-scoped list of ONGOING files whose End-to-End TAT already exceeds 96h (4 days).
    Computed dynamically from the original creation timestamp; completed files are excluded.
    When exclude_snoozed=true, files this user snoozed for the current IST day are hidden
    (used by the header bell to stay focused; the dashboard table shows all)."""
    role, uid = _ctx(user)
    match = {"status": "FILE", "processing_status": {"$nin": list(FINAL_STATUSES)}, **NOT_DELETED}
    if role == "processor":
        match["assigned_processor_id"] = uid
    elif role not in STAFF_ROLES:
        match["assigned_partner_id"] = uid
    snoozed = set()
    if exclude_snoozed:
        today = _ist_now().strftime("%Y-%m-%d")
        async for s in db.meta_tat_snoozes.find({"user_id": uid, "date": today}):
            snoozed.add(s.get("lead_id"))
    docs = await db.meta_leads.find(match).to_list(5000)
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    items = []
    for d in docs:
        if d.get("tat_final_at"):
            continue
        if d.get("lead_id") in snoozed:
            continue
        tat = compute_tat(d, now)
        if tat["state"] == "ongoing" and tat["overdue"]:
            items.append({
                "lead_id": d.get("lead_id"),
                "full_name": d.get("full_name") or "",
                "phone": d.get("phone") or "",
                "file_created_at": tat["created_at"],
                "processing_status": d.get("processing_status") or "New",
                "assigned_processor_name": d.get("assigned_processor_name") or "",
                "assigned_partner_name": d.get("assigned_partner_name") or "",
                "tat_days": tat["days"], "tat_hours": tat["hours"], "tat_ms": tat["ms"],
            })
    items.sort(key=lambda x: x["tat_ms"] or 0, reverse=True)
    return {"items": items, "count": len(items), "limit_hours": TAT_LIMIT_HOURS}


@router.post("/tat/snooze/{lead_id}")
async def meta_tat_snooze(lead_id: str, user: dict = Depends(require_meta_access)):
    """Snooze a file's overdue-TAT bell nudge for the rest of the current IST day (per user).
    Only hides it from the header bell; the dashboard table and TAT filters are unaffected.
    It reappears automatically the next day (or if the file leaves overdue and returns)."""
    lead = await _get_lead_or_404(lead_id)
    role, uid = _ctx(user)
    if not _can_action_lead(role, uid, lead):
        raise HTTPException(status_code=403, detail="Not authorized")
    today = _ist_now().strftime("%Y-%m-%d")
    await db.meta_tat_snoozes.update_one(
        {"user_id": uid, "lead_id": lead_id},
        {"$set": {"user_id": uid, "lead_id": lead_id, "date": today, "at": _now_iso()}},
        upsert=True,
    )
    return {"ok": True, "lead_id": lead_id, "snoozed_until_date": today}


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


@router.get("/files/filter-options")
async def meta_files_filter_options(user: dict = Depends(require_meta_access)):
    """Distinct Loan Type / Bank values across FILE records the caller can see (role-scoped)."""
    role, uid = _ctx(user)
    match = {"status": "FILE", **NOT_DELETED}
    if role == "processor":
        match["assigned_processor_id"] = uid
    elif role not in STAFF_ROLES:
        match["assigned_partner_id"] = uid
    raw_loan_types = await db.meta_leads.distinct("file.loan_type", match)
    banks = {}
    for fld in ["file.disbursed_bank", "file.approved_bank", "file.login_bank", "file.bank", "file.lender", "file.banks.bank_name"]:
        for v in await db.meta_leads.distinct(fld, match):
            if v and str(v).strip():
                s = str(v).strip()
                banks.setdefault(s.lower(), s)
    lt = {}
    for x in raw_loan_types:
        if x and str(x).strip():
            s = str(x).strip()
            lt.setdefault(s.lower(), s)
    loan_types = sorted(lt.values(), key=lambda s: s.lower())
    return {"loan_types": loan_types, "banks": sorted(banks.values(), key=lambda s: s.lower())}


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


# =========================== reporting (isolated Meta) ===========================
# Meta reporting reads ONLY meta_leads/meta_call_logs. It NEVER writes to Connect
# collections and NEVER merges into Connect logs. The web/mobile UI shows Combined
# totals (computed at the presentation layer) with Connect and Meta tables kept separate.
from datetime import timedelta as _timedelta

_IST = timezone(_timedelta(hours=5, minutes=30))
_LEAD_STATUSES = {"LEAD", "FILE"}


def _parse_dt(s):
    """Parse a stored ISO timestamp to a naive UTC datetime (tolerant of Z/offset)."""
    if not s:
        return None
    try:
        txt = str(s).replace("Z", "+00:00")
        dt = datetime.fromisoformat(txt)
        if dt.tzinfo is not None:
            dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
        return dt
    except Exception:
        return None


def _ist_day_bounds_utc(date_str=None):
    if date_str:
        d = datetime.fromisoformat(date_str)
        start_ist = datetime(d.year, d.month, d.day, tzinfo=_IST)
    else:
        now_ist = datetime.now(_IST)
        start_ist = datetime(now_ist.year, now_ist.month, now_ist.day, tzinfo=_IST)
    start_utc = start_ist.astimezone(timezone.utc).replace(tzinfo=None)
    return start_utc, start_utc + _timedelta(days=1)


def _period_bounds_utc(period=None, from_date=None, to_date=None):
    """IST-aware (start, end) as naive UTC datetimes. end=None means open-ended."""
    if from_date and to_date:
        s = datetime.fromisoformat(from_date).replace(tzinfo=_IST).astimezone(timezone.utc).replace(tzinfo=None)
        e = (datetime.fromisoformat(to_date).replace(tzinfo=_IST) + _timedelta(days=1)).astimezone(timezone.utc).replace(tzinfo=None)
        return s, e
    now_ist = datetime.now(_IST)
    today = datetime(now_ist.year, now_ist.month, now_ist.day, tzinfo=_IST)
    p = (period or "today").lower()
    if p == "today":
        s = today
    elif p == "week":
        s = today - _timedelta(days=today.weekday())
    elif p == "month":
        s = datetime(now_ist.year, now_ist.month, 1, tzinfo=_IST)
    elif p == "three_months":
        s = today - _timedelta(days=90)
    else:  # lifetime / unknown
        return None, None
    return s.astimezone(timezone.utc).replace(tzinfo=None), None


def _in_range(dt, start, end):
    if dt is None:
        return False
    if start is not None and dt < start:
        return False
    if end is not None and dt >= end:
        return False
    return True


def _reports_scope_match(user):
    """Meta report visibility: staff see all; others see only their assigned leads."""
    role, uid = _ctx(user)
    match = dict(NOT_DELETED)
    if role not in STAFF_ROLES:
        match["assigned_partner_id"] = uid
    return match


@router.get("/reports/summary")
async def meta_reports_summary(user: dict = Depends(require_meta_access),
                               period: str = "today", from_date: Optional[str] = None,
                               to_date: Optional[str] = None):
    """Per-partner Meta performance for the Connect Reports 'Summary' tab (Meta table)."""
    start, end = _period_bounds_utc(period, from_date, to_date)
    match = _reports_scope_match(user)
    leads = await db.meta_leads.find(match, {"_id": 0, "assigned_partner_id": 1, "assigned_partner_name": 1,
        "status": 1, "call_logs": 1, "updated_at": 1, "file_created_at": 1, "created_at": 1,
        "created_time": 1}).to_list(20000)

    partners = {}

    def _bucket(pid, pname):
        key = pid or "unassigned"
        if key not in partners:
            partners[key] = {"user_id": key, "user_name": pname or "Unassigned",
                             "total_calls": 0, "total_connected": 0, "total_call_seconds": 0,
                             "leads_generated": 0, "file": 0, "outcomes": {}}
        elif pname and partners[key]["user_name"] == "Unassigned":
            partners[key]["user_name"] = pname
        return partners[key]

    for l in leads:
        b = _bucket(l.get("assigned_partner_id"), l.get("assigned_partner_name"))
        # CALLS/CONNECTED/LEAD are derived ONLY from genuine call-log events in range.
        # A Meta Lead = a call-log event whose disposition == LEAD (NOT the imported/assigned record).
        for c in (l.get("call_logs") or []):
            if not _in_range(_parse_dt(c.get("at")), start, end):
                continue
            dur = int(c.get("duration_seconds") or 0)
            b["total_calls"] += 1
            b["total_call_seconds"] += dur
            if dur > 0:
                b["total_connected"] += 1
            disp = (c.get("disposition") or "").upper()
            if disp:
                b["outcomes"][disp] = b["outcomes"].get(disp, 0) + 1
            if disp == "LEAD":
                b["leads_generated"] += 1
        # FILES use the file-conversion event date (file_created_at), independent of call logs.
        fdt = _parse_dt(l.get("file_created_at"))
        if fdt is not None and _in_range(fdt, start, end):
            b["file"] += 1

    rows = [p for p in partners.values() if p["total_calls"] or p["leads_generated"] or p["file"]]
    rows.sort(key=lambda r: (-r["total_calls"], r["user_name"]))
    outcome_totals = {}
    for r in rows:
        for k, v in r["outcomes"].items():
            outcome_totals[k] = outcome_totals.get(k, 0) + v
    overall = {
        "total_calls": sum(r["total_calls"] for r in rows),
        "total_connected": sum(r["total_connected"] for r in rows),
        "total_call_seconds": sum(r["total_call_seconds"] for r in rows),
        "total_leads_generated": sum(r["leads_generated"] for r in rows),
        "total_file": sum(r["file"] for r in rows),
        "outcomes": outcome_totals,
    }
    return {"overall": overall, "partners": rows}


@router.get("/reports/hourly")
async def meta_reports_hourly(user: dict = Depends(require_meta_access), date: Optional[str] = None):
    """Per-partner Meta hourly breakdown (IST) for the Connect Reports 'Hourly' tab."""
    start, end = _ist_day_bounds_utc(date)
    match = _reports_scope_match(user)
    leads = await db.meta_leads.find(match, {"_id": 0, "assigned_partner_id": 1, "assigned_partner_name": 1,
        "status": 1, "call_logs": 1, "updated_at": 1, "file_created_at": 1}).to_list(20000)

    partners = {}

    def _bucket(pid, pname):
        key = pid or "unassigned"
        if key not in partners:
            partners[key] = {"user_id": key, "user_name": pname or "Unassigned",
                             "hours": {}, "total_calls": 0, "total_connected": 0,
                             "total_leads": 0, "total_file": 0}
        elif pname and partners[key]["user_name"] == "Unassigned":
            partners[key]["user_name"] = pname
        return partners[key]

    def _hour_of(dt):
        return (dt + _timedelta(hours=5, minutes=30)).hour

    for l in leads:
        b = _bucket(l.get("assigned_partner_id"), l.get("assigned_partner_name"))
        # Calls / Connected / Leads come ONLY from call-log events, placed in the hour they occurred.
        for c in (l.get("call_logs") or []):
            dt = _parse_dt(c.get("at"))
            if not _in_range(dt, start, end):
                continue
            hr = _hour_of(dt)
            slot = b["hours"].setdefault(hr, {"hour": hr, "calls": 0, "connected": 0, "leads": 0, "file": 0})
            slot["calls"] += 1
            b["total_calls"] += 1
            if int(c.get("duration_seconds") or 0) > 0:
                slot["connected"] += 1
                b["total_connected"] += 1
            if (c.get("disposition") or "").upper() == "LEAD":
                slot["leads"] += 1
                b["total_leads"] += 1
        # File conversion placed in the hour of file_created_at (event date), not last-edit.
        fdt = _parse_dt(l.get("file_created_at"))
        if fdt is not None and _in_range(fdt, start, end):
            hr = _hour_of(fdt)
            slot = b["hours"].setdefault(hr, {"hour": hr, "calls": 0, "connected": 0, "leads": 0, "file": 0})
            slot["file"] += 1
            b["total_file"] += 1

    out = []
    for p in partners.values():
        if not (p["total_calls"] or p["total_leads"] or p["total_file"]):
            continue
        p["hourly_breakdown"] = sorted(p["hours"].values(), key=lambda h: h["hour"])
        del p["hours"]
        out.append(p)
    out.sort(key=lambda r: (-r["total_calls"], r["user_name"]))
    return {"telecallers": out, "date": (date or datetime.now(_IST).date().isoformat())}



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


@router.post("/admin/repair-meta-users")
async def meta_repair_users(current_user: dict = Depends(require_admin)):
    """Backfill meta_users for Connect users who were granted Meta access (growth_partner/processor/
    ops/admin) but never got a meta_users record or a meta_user_id — so they show in dropdowns and
    can be assigned leads. Idempotent."""
    PROVISION_ROLES = {"growth_partner", "processor", "ops", "admin"}
    repaired = []
    cursor = db.users.find({"meta_access": True, "meta_role": {"$in": list(PROVISION_ROLES)}})
    async for u in cursor:
        role = (u.get("meta_role") or "").strip().lower()
        if role not in PROVISION_ROLES:
            continue
        muid = (u.get("meta_user_id") or "").strip()
        existing = await db.meta_users.find_one({"user_id": muid}) if muid else None
        if muid and existing and existing.get("approved") and not existing.get("deleted"):
            continue  # already usable
        if not muid:
            muid = f"user_{uuid.uuid4().hex[:12]}"
            await db.users.update_one({"_id": u["_id"]}, {"$set": {"meta_user_id": muid}})
        await db.meta_users.update_one(
            {"user_id": muid},
            {"$set": {
                "user_id": muid,
                "name": u.get("name") or u.get("meta_email") or u.get("email"),
                "email": u.get("meta_email") or u.get("email"),
                "phone": u.get("phone", ""),
                "role": role,
                "approved": True,
                "deleted": False,
            }, "$setOnInsert": {"created_at": _now_iso()}},
            upsert=True,
        )
        repaired.append({"email": u.get("email"), "name": u.get("name"), "role": role, "user_id": muid})
    return {"repaired_count": len(repaired), "repaired": repaired}


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

    # Auto-provision the isolated meta_users record so a granted GP/Processor/Ops is immediately
    # usable (assignment dropdown reads meta_users where approved=True; lead scoping keys off
    # meta_user_id). Without this a newly-granted growth partner never appears in the dropdown.
    PROVISION_ROLES = {"growth_partner", "processor", "ops", "admin"}
    if inp.meta_access and (inp.meta_role in PROVISION_ROLES):
        muid = (inp.meta_user_id or "").strip()
        if not muid:
            muid = f"user_{uuid.uuid4().hex[:12]}"
            await db.users.update_one({"_id": target["_id"]}, {"$set": {"meta_user_id": muid}})
        await db.meta_users.update_one(
            {"user_id": muid},
            {"$set": {
                "user_id": muid,
                "name": target.get("name") or inp.meta_email or target.get("email"),
                "email": inp.meta_email or target.get("email"),
                "phone": target.get("phone", ""),
                "role": inp.meta_role,
                "approved": True,
                "deleted": False,
            }, "$setOnInsert": {"created_at": _now_iso()}},
            upsert=True,
        )
    elif not inp.meta_access and (inp.meta_user_id or "").strip():
        # Access revoked: drop them out of the assignment dropdown (keep the record for history).
        await db.meta_users.update_one({"user_id": inp.meta_user_id.strip()}, {"$set": {"approved": False}})

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
async def meta_seed_production(x_seed_secret: Optional[str] = Header(None),
                               authorization: Optional[str] = Header(None)):
    import os as _os
    import gzip as _gzip
    import re as _re
    import jwt as _jwt
    from bson import json_util
    from bson import ObjectId as _ObjectId
    from utils.auth import SECRET_KEY, ALGORITHM

    # Auth: EITHER the prod env secret header (for engineer-driven cutover) OR an admin JWT.
    secret = _os.environ.get("WEBHOOK_CRON_SECRET")
    authorized = bool(secret and x_seed_secret and x_seed_secret == secret)
    if not authorized:
        if not authorization or not authorization.lower().startswith("bearer "):
            raise HTTPException(status_code=401, detail="Provide X-Seed-Secret header or an admin bearer token")
        try:
            payload = _jwt.decode(authorization.split(" ", 1)[1], SECRET_KEY, algorithms=[ALGORITHM])
        except Exception:
            raise HTTPException(status_code=401, detail="Invalid token")
        uid = payload.get("user_id")
        u = None
        if uid:
            try:
                u = await db.users.find_one({"_id": _ObjectId(uid)})
            except Exception:
                u = await db.users.find_one({"id": uid})
        if not u or (u.get("role") or "").strip().lower() != "admin":
            raise HTTPException(status_code=403, detail="Admin only")

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

    # Staff whose CONNECT email differs from their META email (admin/ops) get an explicit
    # grant (mirrors the validated preview mapping; meta_user_id stays None for staff — they
    # are unrestricted scope). Idempotent.
    STAFF_OVERRIDE = {
        "admin@bankezee.com": "admin", "sasha.sgchr@gmail.com": "admin",
        "rama@bankezee.com": "ops", "rama.saffronglobal@gmail.com": "ops",
    }
    staff_mapped = 0
    for cemail, mrole in STAFF_OVERRIDE.items():
        exact = await db.meta_users.find_one({"email": {"$regex": f"^{_re.escape(cemail)}$", "$options": "i"}})
        muid = exact.get("user_id") if exact else None
        res = await db.users.update_many(
            {"email": {"$regex": f"^{_re.escape(cemail)}$", "$options": "i"}},
            {"$set": {"meta_access": True, "meta_role": mrole, "meta_email": cemail, "meta_user_id": muid}})
        staff_mapped += res.matched_count

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
                             "staff_override_updated": staff_mapped,
                             "unmatched_meta_users": len(manual_needed),
                             "unmatched_sample": manual_needed[:20]},
        "verify": verify,
        "note": "Idempotent. Legacy GridFS binaries remain pending (meta_fs.chunks empty).",
    }
