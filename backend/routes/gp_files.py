"""Growth Partner files: every partner / customer submission becomes a real Connect CRM File
(created through files_crm.create_file_direct) and is processed in the normal Files workspace."""
import re
import secrets
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from pydantic import BaseModel
from pymongo.errors import DuplicateKeyError

from utils.database import db
from utils.files_query import build_files_query
from config.loan_types import LOAN_TYPES
from routes.gp_portal import require_gp, raw_user, uid, mask, norm_mobile, now

router = APIRouter(prefix="/api/gp", tags=["Growth Partner Files"])

EMPLOYMENT = {"salaried": "Salaried", "self_employed": "Self-employed"}
LOAN_LABEL = {t["value"]: t["label"] for t in LOAN_TYPES}
DOCS = {
    "salaried": [("payslip", "Latest payslip"), ("cibil_report", "Latest CIBIL / credit report"), ("bank_statement", "Bank statement (last 6 months)"),
                 ("pan", "PAN card"), ("aadhaar", "Aadhaar card")],
    "self_employed": [("itr", "ITR (last 2 years)"), ("bank_statement", "Bank statement (last 12 months)"), ("business_proof", "GST / business registration"),
                      ("cibil_report", "Latest CIBIL / credit report"), ("pan", "PAN card"), ("aadhaar", "Aadhaar card")],
}
DOC_CATS = {k for v in DOCS.values() for k, _ in v} | {"general"}
LEGACY_STATUS = {"sent_to_bank": "Sent to Bank", "sanctioned": "Sanctioned", "supporting": "Supporting"}
PARTNER_SOURCE = "growth_partner"


def status_info(code):
    from routes.files_crm import FILE_STATUS_OPTIONS
    code = (code or "new").lower()
    o = next((s for s in FILE_STATUS_OPTIONS if s["id"] == code), None)
    return {"code": code, "label": o["label"] if o else LEGACY_STATUS.get(code, code.replace("_", " ").title()), "category": (o or {}).get("category", "initial")}


@router.get("/files/form-config")
async def form_config():
    from routes.files_crm import FILE_STATUS_OPTIONS
    return {"loan_types": LOAN_TYPES, "employment_types": [{"value": k, "label": v} for k, v in EMPLOYMENT.items()],
            "documents": {k: [{"category": c, "label": lbl} for c, lbl in v] for k, v in DOCS.items()}, "statuses": FILE_STATUS_OPTIONS}


async def scope_query(u):
    base = await build_files_query(db, u)
    mine = {"status": "file", "gp_referral.partner_id": uid(u)}
    return {"$or": [base, mine]} if base else mine


def row(f):
    fd = f.get("file_details") or {}
    lt = fd.get("type_of_loan") or f.get("requirement")
    return {"id": f.get("id"), "name": f.get("name"), "phone": mask(f.get("phone"), 4), "loan_type": LOAN_LABEL.get(lt, lt),
            "employment": EMPLOYMENT.get(fd.get("employment_type") or f.get("employment_type"), fd.get("employment_type")), "status": status_info(f.get("file_status")),
            "added": str(f.get("file_created_at") or f.get("created_at") or "")[:10], "updated": str(f.get("updated_at") or "")[:16].replace("T", " "),
            "via": (f.get("gp_referral") or {}).get("channel", "Growth Partner")}


@router.get("/files")
async def my_files(search: str = "", status: str = "", u: dict = Depends(require_gp)):
    q = await scope_query(u)
    if search:
        q = {"$and": [q, {"$or": [{"name": {"$regex": re.escape(search), "$options": "i"}}, {"phone": {"$regex": re.escape(search)}}, {"id": search.strip()}]}]}
    files = await db.leads.find(q, {"_id": 0, "id": 1, "name": 1, "phone": 1, "file_details.type_of_loan": 1, "file_details.employment_type": 1, "employment_type": 1,
                                   "requirement": 1, "file_status": 1, "created_at": 1, "file_created_at": 1, "updated_at": 1, "gp_referral.channel": 1}).sort("created_at", -1).to_list(3000)
    rows = [row(f) for f in files]
    counts = {}
    for r in rows:
        c = counts.setdefault(r["status"]["code"], {**r["status"], "count": 0})
        c["count"] += 1
    if status:
        rows = [r for r in rows if r["status"]["code"] == status]
    return {"rows": rows, "counts": sorted(counts.values(), key=lambda c: -c["count"]), "total": len(files)}


async def own_file(fid, u):
    f = await db.leads.find_one({"$and": [await scope_query(u), {"id": fid}]}, {"_id": 0})
    if not f:
        raise HTTPException(404, "File not found")
    return f


@router.get("/files/{fid}")
async def my_file(fid: str, u: dict = Depends(require_gp)):
    f = await own_file(fid, u)
    fd = f.get("file_details") or {}
    hist = [{"at": a.get("timestamp"), "label": "File created"} for a in f.get("file_activities") or [] if a.get("type") == "file_created"]
    hist += [{"at": a.get("timestamp"), "label": status_info(str(a.get("message", "")).replace("Status changed to ", "").strip())["label"]}
             for a in f.get("file_activities") or [] if a.get("type") == "status_change"]
    emp = fd.get("employment_type") or f.get("employment_type")
    have = {d.get("category") or d.get("document_type") for d in f.get("file_documents") or []}
    return {**row(f), "city": fd.get("city") or f.get("city"), "loan_amount_required": fd.get("loan_amount_required"), "company_name": fd.get("company_name"),
            "documents": [{"name": d.get("original_name") or d.get("file_name"), "category": d.get("category") or d.get("document_type") or "general",
                           "uploaded_at": d.get("uploaded_at")} for d in f.get("file_documents") or []],
            "checklist": [{"category": c, "label": lbl, "uploaded": c in have} for c, lbl in DOCS.get(emp, DOCS["salaried"])],
            "history": sorted(hist, key=lambda h: str(h["at"]))}


class Loan(BaseModel):
    bank: Optional[str] = None
    loan_type: Optional[str] = None
    loan_amount: Optional[float] = None
    outstanding: Optional[float] = None
    emi: Optional[float] = None


class FileSubmit(BaseModel):
    name: str
    mobile: str
    loan_type: str
    employment_type: str
    consent: bool
    submission_id: Optional[str] = None
    city: Optional[str] = None
    loan_amount_required: Optional[float] = None
    company_name: Optional[str] = None
    net_salary: Optional[float] = None
    cibil_score: Optional[int] = None
    monthly_emi_obligations: Optional[float] = None
    existing_loans: Optional[List[Loan]] = None


async def submit_file(partner: dict, inp: FileSubmit, channel: str):
    from routes.files_crm import create_file_direct, FileCreate
    if not inp.consent:
        raise HTTPException(400, "Customer consent to be contacted is required")
    mob = norm_mobile(inp.mobile)
    if not inp.name.strip() or len(mob) != 10:
        raise HTTPException(400, "Enter the customer's full name and a valid 10-digit mobile number")
    if inp.loan_type not in LOAN_LABEL or inp.employment_type not in EMPLOYMENT:
        raise HTTPException(400, "Choose a loan type and employment type (Salaried or Self-employed)")
    if inp.cibil_score is not None and not 300 <= inp.cibil_score <= 900:
        raise HTTPException(400, "CIBIL score must be between 300 and 900")
    pid = uid(partner)
    if inp.submission_id:
        try:
            await db.gp_submissions.insert_one({"_id": inp.submission_id, "partner_id": pid, "at": now()})
        except DuplicateKeyError:
            prev = await db.leads.find_one({"gp_referral.submission_id": inp.submission_id}, {"id": 1, "file_status": 1})
            if prev:
                return {"file_id": prev["id"], "status": status_info(prev.get("file_status")), "duplicate": True}
            raise HTTPException(409, "This file is already being submitted — refresh My Files in a moment")
    dup = await db.leads.find_one({"status": "file", "phone": {"$regex": f"{mob}$"}, "gp_referral.partner_id": pid,
                                   "created_at": {"$gte": datetime.now(timezone.utc) - timedelta(days=1)}}, {"id": 1, "file_status": 1})
    if dup:
        return {"file_id": dup["id"], "status": status_info(dup.get("file_status")), "duplicate": True}
    extra = {k: v for k, v in {"loan_amount_required": inp.loan_amount_required, "company_name": (inp.company_name or "").strip() or None,
                               "net_salary": inp.net_salary, "cibil_score": inp.cibil_score, "monthly_emi_obligations": inp.monthly_emi_obligations,
                               "existing_loans": [ln.dict() for ln in inp.existing_loans or [] if ln.bank or ln.emi or ln.outstanding] or None,
                               "source_type": "Growth Partner", "growth_partner_name": partner.get("name"), "growth_partner_code": partner.get("partner_code"),
                               "growth_partner_contact": partner.get("phone")}.items() if v is not None}
    res = await create_file_direct(FileCreate(full_name=inp.name.strip(), mobile=mob, city=(inp.city or "").strip() or None, employment_type=inp.employment_type,
                                              type_of_loan=inp.loan_type, gp_id=pid, additional_data=extra), current_user=partner)
    fid = res.get("file_id") or res.get("id")
    token = secrets.token_urlsafe(24) if channel == "Application link" else None
    ref = {"partner_id": pid, "partner_code": partner.get("partner_code"), "channel": channel, "consent_at": now(), "consent_by": "customer" if token else "partner",
           "submission_id": inp.submission_id}
    if token:
        ref |= {"upload_token": token, "upload_token_exp": (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()}
    await db.leads.update_one({"id": fid}, {"$set": {"gp_referral": ref, "file_source": PARTNER_SOURCE},
                                            "$push": {"file_activities": {"type": "gp_submission", "message": f"Submitted via Growth Partner {partner.get('partner_code')} ({channel})",
                                                                          "timestamp": now()}}})
    return {"file_id": fid, "status": status_info("new"), "duplicate": False, **({"upload_token": token} if token else {})}


@router.post("/files")
async def add_file(inp: FileSubmit, u: dict = Depends(require_gp)):
    raw = await raw_user(u)
    return await submit_file(raw | {"id": uid(raw)}, inp, "Partner entered")


async def store_docs(fid, files, category, user):
    from routes.files_crm import upload_documents
    if category not in DOC_CATS:
        raise HTTPException(400, "Unknown document type")
    return await upload_documents(fid, files=files, category=category, current_user=user)


@router.post("/files/{fid}/documents")
async def add_docs(fid: str, category: str = "general", files: List[UploadFile] = File(...), u: dict = Depends(require_gp)):
    await own_file(fid, u)
    return await store_docs(fid, files, category, u)


async def public_partner_doc(code):
    from utils.auth import is_gp_role
    p = await db.users.find_one({"partner_code": code.upper(), "is_active": {"$ne": False}})
    if not p or not is_gp_role(p.get("role", "")):
        raise HTTPException(404, "Application link not found")
    p["id"] = uid(p)
    return p


@router.get("/public/partner/{code}")
async def public_partner(code: str):
    p = await public_partner_doc(code)
    return {"partner_id": p["partner_code"], "display_name": (p.get("name") or "").split(" ")[0]}


@router.post("/public/refer/{code}")
async def public_refer(code: str, inp: FileSubmit):
    return await submit_file(await public_partner_doc(code), inp, "Application link")


@router.post("/public/files/{fid}/documents")
async def public_docs(fid: str, token: str, category: str = "general", files: List[UploadFile] = File(...)):
    f = await db.leads.find_one({"id": fid, "gp_referral.upload_token": token}, {"gp_referral": 1})
    if not f or (f["gp_referral"].get("upload_token_exp") or "") < now():
        raise HTTPException(403, "This upload link has expired")
    return await store_docs(fid, files, category, {"id": "customer", "name": "Customer (application link)", "role": "customer"})


async def backfill_partner_files():
    """Idempotent: tag earlier partner-submitted Files with the Growth Partner source (files stay where they are)."""
    await db.gp_submissions.create_index("at")
    from routes.gp_file_payout import ensure_indexes
    await ensure_indexes()
    r = await db.leads.update_many({"status": "file", "gp_referral.partner_id": {"$exists": True}, "file_source": {"$ne": PARTNER_SOURCE}},
                                   {"$set": {"file_source": PARTNER_SOURCE, "file_details.source_type": "Growth Partner"}})
    return r.modified_count
