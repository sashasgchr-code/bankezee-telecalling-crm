"""Customers & Campaigns API (/api/cc). Role-scoped; WhatsApp sending is mock unless an admin enables live sending."""
import csv
import io
import os
import hmac
import uuid
import asyncio
from datetime import datetime, timedelta, timezone
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Request, Response
from pydantic import BaseModel
from bson import ObjectId

from utils.database import db
from utils.auth import get_current_user, normalize_role, get_user_team_ids
from routes import cc_core as core
from routes.cc_core import CUST, CAMP, MSG, TPL, IST, iso, now_utc

router = APIRouter(prefix="/api/cc", tags=["Customers & Campaigns"])
EDIT_ROLES = {"admin", "ops", "manager"}
MEDIA_RULES = {"image/jpeg": ("IMAGE", 5), "image/png": ("IMAGE", 5), "video/mp4": ("VIDEO", 16), "application/pdf": ("DOCUMENT", 100)}


# ------------------------------------------------------------------ permissions & scope
async def ctx(user: dict) -> dict:
    role = normalize_role(user.get("role") or "")
    if role != "admin":
        raise HTTPException(403, "Customers & Campaigns is available to admins only")
    is_admin = role == "admin"
    if role in ("admin", "ops"):
        scope = {}  # matches Connect visibility: ops already see all files
    else:
        team = await get_user_team_ids(user) or [user.get("id")]
        scope = {"$or": [{"gp_ids": {"$in": team}}, {"processor_ids": {"$in": team}}]} if role == "manager" else {"gp_ids": {"$in": team}}
    return {"role": role, "is_admin": is_admin, "scope": scope, "can_edit": role in EDIT_ROLES,
            "can_campaign": is_admin or bool(user.get("cc_campaign_access")), "user": user}


async def C(user: dict = Depends(get_current_user)):
    return await ctx(user)


def need(cond, msg="Not permitted"):
    if not cond:
        raise HTTPException(403, msg)


async def scoped_customer(c, customer_id: str) -> dict:
    doc = await CUST.find_one({"customer_id": customer_id, **c["scope"]}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Customer not found")
    return doc


# ------------------------------------------------------------------ customer filtering
def loan_match(l, f) -> bool:
    st = f.get("status") or "both"
    if st == "approved" and l["status"] != "Approved":
        return False
    if st == "disbursed" and l["status"] != "Disbursed":
        return False
    for k, field in (("gp", "gp_id"), ("processor", "processor_id")):
        if f.get(k) and (l.get(field) or "UNASSIGNED") != f[k]:
            return False
    if f.get("loan_type") and (l.get("loan_type") or "").lower() != f["loan_type"].lower():
        return False
    if f.get("bank") and (l.get("bank") or "").strip().lower() != f["bank"].strip().lower():
        return False
    for prefix, field in (("", None), ("approval_", "approval_date"), ("disbursement_", "disbursement_date")):
        fr, to = f.get(f"{prefix}date_from"), f.get(f"{prefix}date_to")
        if not (fr or to):
            continue
        d = l.get(field) if field else (l.get("disbursement_date") or l.get("approval_date"))
        if not d or (fr and d < fr) or (to and d > to):
            return False
    for k, field in (("approved", "approved_amount"), ("disbursed", "disbursed_amount")):
        lo, hi = f.get(f"{k}_min"), f.get(f"{k}_max")
        v = l.get(field)
        if (lo not in (None, "") and (v is None or v < float(lo))) or (hi not in (None, "") and (v is None or v > float(hi))):
            return False
    return True


def customer_match(c, f) -> bool:
    if f.get("name") and f["name"].lower() not in (c.get("name") or "").lower():
        return False
    if f.get("mobile"):
        digits = "".join(ch for ch in f["mobile"] if ch.isdigit())
        digits = digits[-10:] if len(digits) > 10 else digits
        if not digits or digits not in (c.get("phone") or ""):
            return False
    if f.get("dob") == "has" and not c.get("dob"):
        return False
    if f.get("dob") == "missing" and c.get("dob"):
        return False
    if f.get("consent") and (c.get("consent") or {}).get("status", "unknown") != f["consent"]:
        return False
    return any(loan_match(l, f) for l in c.get("loans") or [])


async def filtered(c, f) -> list:
    await core.maybe_sync()
    docs = await CUST.find({"active": True, **c["scope"]}, {"_id": 0}).to_list(20000)
    if f.get("customer_ids"):
        ids = set(f["customer_ids"])
        docs = [d for d in docs if d["customer_id"] in ids]
    return [d for d in docs if customer_match(d, f)]


def kpis(rows) -> dict:
    loans = [l for r in rows for l in r.get("loans") or []]
    with_dob = sum(1 for r in rows if r.get("dob"))
    return {"customers": len(rows), "approved_loans": len(loans), "approved_amount": sum(l.get("approved_amount") or 0 for l in loans),
            "disbursed_loans": sum(1 for l in loans if l["status"] == "Disbursed"),
            "disbursed_amount": sum(l.get("disbursed_amount") or 0 for l in loans if l["status"] == "Disbursed"),
            "with_dob": with_dob, "without_dob": len(rows) - with_dob,
            "eligible": sum(1 for r in rows if not core.exclusion_reason(r))}


def missing_by_processor(rows) -> list:
    out = {}
    for r in rows:
        procs = {(l.get("processor_id") or "UNASSIGNED", l.get("processor_name") or "Unassigned") for l in r.get("loans") or []} or {("UNASSIGNED", "Unassigned")}
        for pid, pname in procs:
            o = out.setdefault(pid, {"processor_id": pid, "processor": pname, "customers": 0, "missing": 0})
            o["customers"] += 1
            o["missing"] += 0 if r.get("dob") else 1
    return sorted(out.values(), key=lambda x: -x["missing"])


SORTS = {"name": lambda r: (r.get("name") or "").lower(),
         "latest": lambda r: max([l.get("disbursement_date") or l.get("approval_date") or "" for l in r.get("loans") or []] or [""]),
         "approved_amount": lambda r: sum(l.get("approved_amount") or 0 for l in r.get("loans") or []),
         "disbursed_amount": lambda r: sum(l.get("disbursed_amount") or 0 for l in r.get("loans") or []),
         "dob": lambda r: (r.get("dob") or "")[-5:], "last_whatsapp": lambda r: r.get("last_whatsapp_at") or ""}


def _int(v, default):
    try:
        return int(v)
    except (TypeError, ValueError):
        return default


def qfilters(request: Request) -> dict:
    return {k: v for k, v in request.query_params.items() if v not in ("", None)}


@router.get("/me")
async def me(c=Depends(C)):
    s = await core.get_settings()
    return {"role": c["role"], "is_admin": c["is_admin"], "can_edit": c["can_edit"], "can_campaign": c["can_campaign"],
            "live_sending": s["live_sending"], "test_number_set": bool(s.get("test_number")), "campaign_types": s["campaign_types"]}


@router.get("/customers")
async def list_customers(request: Request, c=Depends(C)):
    f = qfilters(request)
    rows = await filtered(c, f)
    key = SORTS.get(f.get("sort") or "latest", SORTS["latest"])
    rows.sort(key=key, reverse=(f.get("dir", "desc") == "desc"))
    page, size = max(1, _int(f.get("page"), 1)), min(200, max(10, _int(f.get("page_size"), 25)))
    k = kpis(rows)
    return {"items": rows[(page - 1) * size: page * size], "total": len(rows), "page": page, "page_size": size, "kpis": k,
            "dob_completion": {"with": k["with_dob"], "total": len(rows), "pct": round(k["with_dob"] * 100 / len(rows), 1) if rows else 0},
            "missing_by_processor": missing_by_processor(rows),
            "last_sync": (await db.app_settings.find_one({"key": "cc_last_sync"}, {"_id": 0}) or {}).get("at")}


@router.get("/filter-options")
async def filter_options(c=Depends(C)):
    await core.maybe_sync()
    rows = await CUST.find({"active": True, **c["scope"]}, {"_id": 0, "loans": 1}).to_list(20000)
    loans = [l for r in rows for l in r.get("loans") or []]
    pairs = lambda a, b: sorted({(l[a], l.get(b) or l[a]) for l in loans if l.get(a)}, key=lambda x: str(x[1]).lower())  # noqa: E731
    return {"gps": [{"id": i, "name": n} for i, n in pairs("gp_id", "gp_name")],
            "processors": [{"id": i, "name": n} for i, n in pairs("processor_id", "processor_name")],
            "loan_types": sorted({l["loan_type"] for l in loans if l.get("loan_type")}, key=str.lower),
            "banks": sorted({l["bank"].strip() for l in loans if (l.get("bank") or "").strip()}, key=str.lower)}


@router.get("/customers/export")
async def export_customers(request: Request, c=Depends(C)):
    rows = await filtered(c, qfilters(request))
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["Customer ID", "Customer Name", "Mobile", "DOB", "File ID", "Source", "Loan Type", "Bank/NBFC", "Loan Status", "Approval Date",
                "Approved Amount", "Disbursement Date", "Disbursed Amount", "Growth Partner", "Processor", "Last WhatsApp", "WhatsApp Consent"])
    for r in rows:
        for l in r.get("loans") or []:
            w.writerow([r["customer_id"], r.get("name"), r.get("phone"), fmt_dob(r.get("dob")), l["file_id"], l["source"], l.get("loan_type"), l.get("bank"),
                        l["status"], l.get("approval_date") or "", l.get("approved_amount") or "", l.get("disbursement_date") or "",
                        l.get("disbursed_amount") or "", l.get("gp_name") or "", l.get("processor_name") or "", (r.get("last_whatsapp_at") or "")[:10],
                        (r.get("consent") or {}).get("status", "unknown")])
    return Response(out.getvalue(), media_type="text/csv", headers={"Content-Disposition": 'attachment; filename="customers.csv"'})


def fmt_dob(d):
    if not d:
        return ""
    return f"{d[8:10]}-{d[5:7]}-{d[:4]}" if not d.startswith("--") else f"{d[-2:]}-{d[-5:-3]}"


@router.get("/customers/{customer_id}")
async def customer_detail(customer_id: str, c=Depends(C)):
    doc = await scoped_customer(c, customer_id)
    hist = await MSG.find({"customer_id": customer_id, "kind": {"$ne": "test"}}, {"_id": 0, "var_map": 0}).sort("created_at", -1).to_list(200)
    names = {x["campaign_id"]: x["name"] for x in await CAMP.find({"campaign_id": {"$in": [h.get("campaign_id") for h in hist if h.get("campaign_id")]}}, {"campaign_id": 1, "name": 1}).to_list(500)}
    for h in hist:
        h["campaign_name"] = names.get(h.get("campaign_id")) or ("Birthday greeting" if h["kind"] == "birthday" else "")
    # Existing welcome-message records from the Meta CRM (read-only, not duplicated).
    if doc.get("phone"):
        async for ml in db.meta_leads.find({"phone_norm": doc["phone"], "whatsapp.wamid": {"$exists": True}}, {"_id": 0, "whatsapp": 1}):
            w = ml["whatsapp"]
            hist.append({"kind": "welcome", "campaign_name": "Welcome message (Meta lead)", "template": w.get("template"), "category": "",
                         "status": w.get("status"), "submitted_at": w.get("sent_at") or w.get("attempted_at"), "error": (w.get("last_error") or {}).get("title")})
    audit_rows = await core.AUDIT.find({"customer_id": customer_id}, {"_id": 0}).sort("at", -1).to_list(50)
    return {**doc, "history": hist, "audit": audit_rows}


class CustomerPatch(BaseModel):
    dob: Optional[str] = None          # YYYY-MM-DD or --MM-DD ; "" clears
    overwrite_dob: bool = False
    consent_status: Optional[str] = None  # opted_in | unknown | opted_out
    consent_date: Optional[str] = None
    consent_source: Optional[str] = None
    consent_reference: Optional[str] = None
    opt_out_reason: Optional[str] = None


def valid_dob(v: str) -> str:
    try:
        if v.startswith("--"):
            datetime.strptime(f"2000-{v[2:]}", "%Y-%m-%d")  # 2000 is a leap year so 29 Feb is allowed without a year
            return v
        d = datetime.strptime(v, "%Y-%m-%d")
        if d > datetime.now() or d.year < 1900:
            raise ValueError
        return v
    except ValueError:
        raise HTTPException(400, "Invalid date of birth")


@router.patch("/customers/{customer_id}")
async def patch_customer(customer_id: str, body: CustomerPatch, c=Depends(C)):
    need(c["can_edit"], "You cannot edit customer details")
    doc = await scoped_customer(c, customer_id)
    u, s = c["user"], {}
    if body.dob is not None:
        new = valid_dob(body.dob) if body.dob else None
        if doc.get("dob") and new != doc["dob"] and not body.overwrite_dob:
            raise HTTPException(409, "A date of birth already exists. Confirm to overwrite it.")
        s.update({"dob": new, "dob_updated_by": u.get("name"), "dob_updated_at": iso()})
        if not doc.get("dob_added_by") and new:
            s.update({"dob_added_by": u.get("name"), "dob_added_at": iso()})
        await core.audit("dob_change", u, customer_id=customer_id, old=doc.get("dob"), new=new)
    if body.consent_status:
        if body.consent_status not in ("opted_in", "unknown", "opted_out"):
            raise HTTPException(400, "Invalid consent status")
        if body.consent_status == "opted_in" and not (body.consent_source and body.consent_date):
            raise HTTPException(400, "Recording consent needs the consent date and source")
        consent = {"status": body.consent_status, "consent_date": body.consent_date, "source": body.consent_source,
                   "reference": body.consent_reference, "updated_by": u.get("name"), "updated_at": iso()}
        if body.consent_status == "opted_out":
            consent.update({"opt_out_date": iso(), "opt_out_reason": body.opt_out_reason or "Recorded by staff"})
            if doc.get("wa_number"):
                await CUST.update_many({"wa_number": doc["wa_number"]}, {"$set": {"consent": consent}})
        s["consent"] = consent
        await core.audit("consent_change", u, customer_id=customer_id, old=(doc.get("consent") or {}).get("status"), new=body.consent_status)
    if s:
        await CUST.update_one({"customer_id": customer_id}, {"$set": s})
    return await CUST.find_one({"customer_id": customer_id}, {"_id": 0})


@router.post("/sync")
async def manual_sync(c=Depends(C)):
    need(c["can_edit"])
    return await core.sync_customers()


# ------------------------------------------------------------------ CSV import (DOB / consent)
def parse_dob_text(v: str) -> Optional[str]:
    v = (v or "").strip()
    for fmt, out in (("%d-%m-%Y", "%Y-%m-%d"), ("%d/%m/%Y", "%Y-%m-%d"), ("%Y-%m-%d", "%Y-%m-%d")):
        try:
            return datetime.strptime(v, fmt).strftime(out)
        except ValueError:
            pass
    for sep in ("-", "/"):
        p = v.split(sep)
        if len(p) == 2 and all(x.isdigit() for x in p):
            try:
                datetime.strptime(f"2000-{int(p[1]):02d}-{int(p[0]):02d}", "%Y-%m-%d")
                return f"--{int(p[1]):02d}-{int(p[0]):02d}"
            except ValueError:
                return None
    return None


@router.post("/import/preview")
async def import_preview(kind: str = Form(...), file: UploadFile = File(...), c=Depends(C)):
    need(c["can_edit"])
    text = (await file.read()).decode("utf-8-sig", errors="ignore")
    rows = list(csv.DictReader(io.StringIO(text)))
    custs = await CUST.find({"active": True, **c["scope"]}, {"_id": 0, "customer_id": 1, "name": 1, "dob": 1, "loans.file_id": 1, "consent": 1}).to_list(20000)
    by_id = {x["customer_id"]: x for x in custs}
    by_file = {}
    for x in custs:
        for l in x.get("loans") or []:
            by_file.setdefault(l["file_id"], set()).add(x["customer_id"])
    out = []
    for i, r in enumerate(rows, start=2):
        r = {k.strip().lower().replace(" ", "_"): (v or "").strip() for k, v in r.items() if k}
        cid = r.get("customer_id")
        if not cid and r.get("file_id"):
            m = by_file.get(r["file_id"], set())
            cid = next(iter(m)) if len(m) == 1 else None
            if len(m) > 1:
                out.append({"row": i, "status": "ambiguous", "message": "File ID matches more than one customer", **r})
                continue
        cust = by_id.get(cid)
        if not cust:
            out.append({"row": i, "status": "not_found", "message": "No matching customer you can edit", **r})
            continue
        item = {"row": i, "customer_id": cid, "name": cust.get("name")}
        if kind == "dob":
            dob = parse_dob_text(r.get("dob", ""))
            if not dob:
                out.append({**item, "status": "invalid", "message": "DOB must be DD-MM-YYYY or DD-MM", "raw": r.get("dob")})
                continue
            st = "unchanged" if cust.get("dob") == dob else ("conflict" if cust.get("dob") else "new")
            out.append({**item, "status": st, "dob": dob, "existing": cust.get("dob"),
                        "message": "Existing DOB differs — tick to overwrite" if st == "conflict" else ""})
        else:
            status = (r.get("consent") or r.get("consent_status") or "").lower().replace(" ", "_").replace("-", "_")
            if status not in ("opted_in", "opted_out", "unknown") or (status == "opted_in" and not (r.get("consent_date") and r.get("consent_source"))):
                out.append({**item, "status": "invalid", "message": "Need consent (opted_in/opted_out/unknown); opted_in needs consent_date and consent_source"})
                continue
            out.append({**item, "status": "new", "consent_status": status, "consent_date": r.get("consent_date"), "consent_source": r.get("consent_source"),
                        "consent_reference": r.get("consent_reference"), "existing": (cust.get("consent") or {}).get("status")})
    return {"kind": kind, "rows": out, "summary": {s: sum(1 for x in out if x["status"] == s) for s in {x["status"] for x in out}}}


class ImportCommit(BaseModel):
    kind: str
    rows: List[dict]


@router.post("/import/commit")
async def import_commit(body: ImportCommit, c=Depends(C)):
    need(c["can_edit"])
    done = 0
    for r in body.rows:
        if r.get("status") not in ("new", "conflict") or (r["status"] == "conflict" and not r.get("overwrite")):
            continue
        if body.kind == "dob":
            p = CustomerPatch(dob=r["dob"], overwrite_dob=bool(r.get("overwrite")))
        else:
            p = CustomerPatch(consent_status=r["consent_status"], consent_date=r.get("consent_date"), consent_source=r.get("consent_source"),
                              consent_reference=r.get("consent_reference"), opt_out_reason="CSV import")
        try:
            await patch_customer(r["customer_id"], p, c)
            done += 1
        except HTTPException:
            pass
    await core.audit(f"csv_import_{body.kind}", c["user"], updated=done)
    return {"updated": done}


# ------------------------------------------------------------------ settings & access (admin)
class SettingsIn(BaseModel):
    live_sending: Optional[bool] = None
    test_number: Optional[str] = None
    price_per_message: Optional[float] = None
    campaign_types: Optional[List[str]] = None
    birthday: Optional[dict] = None


@router.get("/settings")
async def get_settings(c=Depends(C)):
    need(c["is_admin"] or c["can_campaign"])
    s = await core.get_settings()
    users = await db.users.find({"role": {"$in": ["ops", "manager"]}, "is_active": True}, {"_id": 0, "id": 1, "name": 1, "role": 1, "cc_campaign_access": 1}).to_list(500) if c["is_admin"] else []
    return {**s, "users": users}


@router.put("/settings")
async def put_settings(body: SettingsIn, c=Depends(C)):
    need(c["is_admin"], "Only an admin can change these settings")
    s = {k: v for k, v in body.dict().items() if v is not None}
    if "test_number" in s and s["test_number"] and not core.wa._to_recipient(s["test_number"]):
        raise HTTPException(400, "Invalid test number")
    if "birthday" in s:
        cur = (await core.get_settings())["birthday"]
        b = {**cur, **{k: v for k, v in s.pop("birthday").items() if k != "last_run_date"}}
        if b.get("enabled"):
            t = await TPL.find_one({"name": b.get("template"), "language": b.get("language")}, {"_id": 0})
            if not t or not t.get("sendable"):
                raise HTTPException(400, "Choose an approved birthday template before enabling automation")
            errs = core.validate_mapping(t, b.get("var_map") or {}, b.get("media_ref"))
            if errs:
                raise HTTPException(400, "; ".join(errs))
        s["birthday"] = b
    await db.app_settings.update_one({"key": core.SETTINGS_KEY}, {"$set": s}, upsert=True)
    await core.audit("settings_change", c["user"], changes=list(s.keys()), live_sending=s.get("live_sending"))
    return await core.get_settings()


@router.put("/users-access/{user_id}")
async def set_access(user_id: str, body: dict, c=Depends(C)):
    need(c["is_admin"])
    await db.users.update_one({"id": user_id}, {"$set": {"cc_campaign_access": bool(body.get("enabled"))}})
    await core.audit("campaign_access", c["user"], target=user_id, enabled=bool(body.get("enabled")))
    return {"ok": True}


# ------------------------------------------------------------------ templates & media
@router.get("/templates")
async def templates(c=Depends(C)):
    need(c["can_campaign"] or c["is_admin"])
    return await TPL.find({"status": {"$ne": "DELETED"}}, {"_id": 0}).sort("name", 1).to_list(500)


@router.post("/templates/sync")
async def templates_sync(c=Depends(C)):
    need(c["is_admin"], "Only an admin can sync templates")
    try:
        return await core.sync_templates()
    except RuntimeError as e:
        raise HTTPException(502, f"Meta template sync failed: {e}")


@router.post("/media")
async def upload_media(file: UploadFile = File(...), c=Depends(C)):
    need(c["can_campaign"])
    rule = MEDIA_RULES.get(file.content_type or "")
    if not rule:
        raise HTTPException(400, "Use JPG/PNG images, MP4 video or PDF documents")
    data = await file.read()
    if len(data) > rule[1] * 1024 * 1024:
        raise HTTPException(400, f"File too large — WhatsApp allows up to {rule[1]} MB for this type")
    fid = await core.media_bucket.upload_from_stream(file.filename or "media", data, metadata={"content_type": file.content_type, "kind": rule[0], "by": c["user"].get("id")})
    return {"media_ref": str(fid), "kind": rule[0], "filename": file.filename, "size": len(data)}


@router.get("/media/{ref}")
async def get_media(ref: str, c=Depends(C)):
    need(c["can_campaign"] or c["is_admin"])
    try:
        stream = await core.media_bucket.open_download_stream(ObjectId(ref))
    except Exception:
        raise HTTPException(404, "Not found")
    return Response(await stream.read(), media_type=(stream.metadata or {}).get("content_type") or "application/octet-stream")


# ------------------------------------------------------------------ audience
def audience_split(rows: list) -> dict:
    eligible, excluded, seen = [], [], {}
    for r in sorted(rows, key=lambda x: x["customer_id"]):
        reason = core.exclusion_reason(r)
        if not reason and r["wa_number"] in seen:
            reason = "duplicate WhatsApp number (one message per number)"
            seen[r["wa_number"]]["linked"].append(r["customer_id"])
        if reason:
            excluded.append({"customer_id": r["customer_id"], "name": r.get("name"), "reason": reason})
        else:
            item = {"customer_id": r["customer_id"], "name": r.get("name"), "wa_number": r["wa_number"], "linked": [r["customer_id"]]}
            seen[r["wa_number"]] = item
            eligible.append(item)
    reasons = {}
    for e in excluded:
        reasons[e["reason"]] = reasons.get(e["reason"], 0) + 1
    return {"total": len(rows), "eligible": eligible, "excluded": excluded, "reasons": reasons}


class AudienceIn(BaseModel):
    filters: dict = {}
    customer_ids: Optional[List[str]] = None


@router.post("/audience/preview")
async def audience_preview(body: AudienceIn, c=Depends(C)):
    need(c["can_campaign"])
    rows = await filtered(c, {**body.filters, "customer_ids": body.customer_ids})
    a = audience_split(rows)
    return {"total": a["total"], "eligible": len(a["eligible"]), "excluded": len(a["excluded"]), "reasons": a["reasons"],
            "sample_excluded": a["excluded"][:50]}


# ------------------------------------------------------------------ campaigns
class CampaignIn(BaseModel):
    name: str
    type: str
    description: Optional[str] = ""
    filters: dict = {}
    customer_ids: Optional[List[str]] = None
    template: Optional[str] = None
    language: Optional[str] = None
    var_map: dict = {}
    media_ref: Optional[str] = None
    schedule_mode: str = "draft"        # draft | now | later
    schedule_at: Optional[str] = None   # "YYYY-MM-DDTHH:MM" local to timezone
    timezone: str = "Asia/Kolkata"


def _sched_utc(body: CampaignIn) -> Optional[str]:
    if body.schedule_mode != "later":
        return None
    try:
        local = datetime.strptime(body.schedule_at or "", "%Y-%m-%dT%H:%M").replace(tzinfo=IST)
    except ValueError:
        raise HTTPException(400, "Pick the schedule date and time")
    if local < now_utc().astimezone(IST):
        raise HTTPException(400, "Scheduled time is in the past")
    return local.astimezone(core.timezone.utc).isoformat()


async def _counts(cid: str) -> dict:
    out = {"queued": 0, "submitted": 0, "sent": 0, "delivered": 0, "read": 0, "failed": 0, "skipped": 0, "mock": 0, "replied": 0}
    async for g in MSG.aggregate([{"$match": {"campaign_id": cid}}, {"$group": {"_id": "$status", "n": {"$sum": 1}}}]):
        k = "queued" if g["_id"] == "sending" else g["_id"]
        out[k] = out.get(k, 0) + g["n"]
    out["replied"] = await MSG.count_documents({"campaign_id": cid, "replied": True})
    out["recipients"] = sum(out[k] for k in ("queued", "submitted", "sent", "delivered", "read", "failed", "mock"))
    return out


@router.get("/campaigns")
async def list_campaigns(c=Depends(C)):
    need(c["can_campaign"] or c["role"] in ("admin", "manager"))
    camps = await CAMP.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    tot = {"campaigns": len(camps), "accepted": 0, "delivered": 0, "read": 0, "failed": 0, "replied": 0, "attempted": 0}
    for x in camps:
        x["counts"] = k = await _counts(x["campaign_id"])
        accepted = k["submitted"] + k["sent"] + k["delivered"] + k["read"]
        tot["accepted"] += accepted
        tot["delivered"] += k["delivered"] + k["read"]
        tot["read"] += k["read"]
        tot["failed"] += k["failed"]
        tot["replied"] += k["replied"]
        tot["attempted"] += accepted + k["failed"]
    rate = lambda a, b: round(a * 100 / b, 1) if b else None  # noqa: E731
    return {"items": camps, "kpis": {**tot, "delivery_rate": rate(tot["delivered"], tot["accepted"]), "read_rate": rate(tot["read"], tot["delivered"]),
                                     "failure_rate": rate(tot["failed"], tot["attempted"]), "reply_rate": rate(tot["replied"], tot["delivered"])}}


@router.post("/campaigns")
async def create_campaign(body: CampaignIn, c=Depends(C)):
    need(c["can_campaign"])
    doc = {"campaign_id": "cmp_" + uuid.uuid4().hex[:12], **body.dict(), "status": "draft", "created_by": c["user"].get("name"),
           "created_by_id": c["user"].get("id"), "created_at": iso(), "updated_at": iso()}
    await CAMP.insert_one(dict(doc))
    await core.audit("campaign_created", c["user"], campaign_id=doc["campaign_id"])
    doc.pop("_id", None)
    return doc


@router.put("/campaigns/{cid}")
async def update_campaign(cid: str, body: CampaignIn, c=Depends(C)):
    need(c["can_campaign"])
    camp = await CAMP.find_one({"campaign_id": cid})
    if not camp or camp["status"] not in ("draft", "scheduled"):
        raise HTTPException(400, "Only draft or scheduled campaigns can be edited")
    if camp["status"] == "scheduled":
        await MSG.delete_many({"campaign_id": cid, "status": "queued"})
    await CAMP.update_one({"campaign_id": cid}, {"$set": {**body.dict(), "status": "draft", "updated_at": iso()}})
    return await CAMP.find_one({"campaign_id": cid}, {"_id": 0})


@router.get("/campaigns/{cid}")
async def campaign_detail(cid: str, c=Depends(C)):
    need(c["can_campaign"] or c["role"] in ("admin", "manager"))
    camp = await CAMP.find_one({"campaign_id": cid}, {"_id": 0})
    if not camp:
        raise HTTPException(404, "Campaign not found")
    recips = await MSG.find({"campaign_id": cid}, {"_id": 0, "var_map": 0}).sort("created_at", 1).to_list(5000)
    tpl = await TPL.find_one({"name": camp.get("template"), "language": camp.get("language")}, {"_id": 0})
    return {**camp, "counts": await _counts(cid), "recipients": recips, "template_doc": tpl,
            "log": await core.AUDIT.find({"campaign_id": cid}, {"_id": 0}).sort("at", 1).to_list(200)}


async def _validated(camp: dict) -> dict:
    tpl = await TPL.find_one({"name": camp.get("template"), "language": camp.get("language")}, {"_id": 0})
    if not tpl or not tpl.get("sendable"):
        raise HTTPException(400, "Choose a template that Meta has approved")
    errs = core.validate_mapping(tpl, camp.get("var_map") or {}, camp.get("media_ref"))
    if errs:
        raise HTTPException(400, "; ".join(errs))
    return tpl


@router.post("/campaigns/{cid}/preview")
async def campaign_preview(cid: str, c=Depends(C)):
    need(c["can_campaign"])
    camp = await CAMP.find_one({"campaign_id": cid}, {"_id": 0})
    if not camp:
        raise HTTPException(404, "Campaign not found")
    tpl = await _validated(camp)
    a = audience_split(await filtered(c, {**(camp.get("filters") or {}), "customer_ids": camp.get("customer_ids")}))
    s = await core.get_settings()
    sample = (await CUST.find_one({"customer_id": a["eligible"][0]["customer_id"]}, {"_id": 0})) if a["eligible"] else {"name": "Customer Name"}
    return {"campaign": camp, "template": tpl, "message_preview": core.render_preview(tpl, camp.get("var_map"), sample or {}),
            "eligible": len(a["eligible"]), "excluded": len(a["excluded"]), "reasons": a["reasons"],
            "estimated_cost": round(len(a["eligible"]) * s["price_per_message"], 2) if s.get("price_per_message") else None,
            "live_sending": s["live_sending"], "send_time": _sched_label(camp)}


def _sched_label(camp):
    if camp.get("schedule_mode") == "later":
        return f"{camp.get('schedule_at', '').replace('T', ' ')} ({camp.get('timezone') or 'Asia/Kolkata'})"
    return "Immediately after confirmation" if camp.get("schedule_mode") == "now" else "Draft (not scheduled)"


class ConfirmIn(BaseModel):
    confirm: bool = False


@router.post("/campaigns/{cid}/confirm")
async def confirm_campaign(cid: str, body: ConfirmIn, c=Depends(C)):
    need(c["can_campaign"])
    if not body.confirm:
        raise HTTPException(400, "Explicit confirmation required")
    s = await core.get_settings()
    need(not s["live_sending"] or c["is_admin"], "Live campaigns must be confirmed by an admin")
    camp = await CAMP.find_one({"campaign_id": cid}, {"_id": 0})
    if not camp or camp["status"] != "draft":
        raise HTTPException(400, "Only a draft campaign can be confirmed")
    if camp.get("schedule_mode") not in ("now", "later"):
        raise HTTPException(400, "Choose Send Now or Schedule for Later first")
    tpl = await _validated(camp)
    sched = _sched_utc(CampaignIn(**{k: camp.get(k) for k in CampaignIn.__fields__ if k in camp}))
    a = audience_split(await filtered(c, {**(camp.get("filters") or {}), "customer_ids": camp.get("customer_ids")}))
    if not a["eligible"]:
        raise HTTPException(400, "No eligible recipients (check consent and WhatsApp numbers)")
    base = {"campaign_id": cid, "kind": "campaign", "template": tpl["name"], "language": tpl["language"], "category": tpl.get("category"),
            "var_map": camp.get("var_map") or {}, "media_ref": camp.get("media_ref"), "attempts": 0, "created_at": iso()}
    for e in a["eligible"]:
        await MSG.update_one({"dedupe_key": f"camp:{cid}:{e['wa_number']}"}, {"$setOnInsert": {
            **base, "dedupe_key": f"camp:{cid}:{e['wa_number']}", "customer_id": e["customer_id"], "linked_customer_ids": e["linked"],
            "name": e["name"], "wa_number": e["wa_number"], "status": "queued"}}, upsert=True)
    for x in a["excluded"]:
        await MSG.update_one({"dedupe_key": f"camp:{cid}:skip:{x['customer_id']}"}, {"$setOnInsert": {
            **base, "dedupe_key": f"camp:{cid}:skip:{x['customer_id']}", "customer_id": x["customer_id"], "name": x["name"],
            "status": "skipped", "error": x["reason"]}}, upsert=True)
    status = "scheduled" if sched else "running"
    await CAMP.update_one({"campaign_id": cid}, {"$set": {"status": status, "scheduled_at": sched or iso(), "confirmed_by": c["user"].get("name"),
                                                         "confirmed_at": iso(), "mode": "live" if s["live_sending"] else "mock",
                                                         "audience_total": a["total"]}})
    await core.audit("campaign_confirmed", c["user"], campaign_id=cid, mode="live" if s["live_sending"] else "mock", recipients=len(a["eligible"]))
    if status == "running":
        asyncio.create_task(core.run_worker())
    return {"status": status, "recipients": len(a["eligible"]), "excluded": len(a["excluded"])}


@router.post("/campaigns/{cid}/{action}")
async def campaign_action(cid: str, action: str, c=Depends(C)):
    need(c["can_campaign"])
    camp = await CAMP.find_one({"campaign_id": cid}, {"_id": 0})
    if not camp:
        raise HTTPException(404, "Campaign not found")
    if action == "test":
        s = await core.get_settings()
        if not s.get("test_number"):
            raise HTTPException(400, "No test number configured — an admin can add one in Settings")
        tpl = await _validated(camp)
        r = core.wa._to_recipient(s["test_number"])
        key = f"test:{cid}:{iso()}"
        await MSG.insert_one({"dedupe_key": key, "kind": "test", "campaign_id": cid, "name": "Admin test", "wa_number": r, "template": tpl["name"],
                              "language": tpl["language"], "var_map": camp.get("var_map") or {}, "media_ref": camp.get("media_ref"),
                              "status": "sending", "attempts": 1, "created_at": iso(), "claimed_at": iso()})
        res = await core.deliver(await MSG.find_one({"dedupe_key": key}), s)
        await core.audit("campaign_test", c["user"], campaign_id=cid, result=res["status"])
        return {"result": res["status"], "to": "******" + r[-4:], "mode": "live" if s["live_sending"] else "mock"}
    transitions = {"pause": (("running", "scheduled"), "paused"), "resume": (("paused",), "running"), "cancel": (("draft", "scheduled", "running", "paused"), "cancelled")}
    if action not in transitions:
        raise HTTPException(404, "Unknown action")
    allowed, new = transitions[action]
    if camp["status"] not in allowed:
        raise HTTPException(400, f"Cannot {action} a {camp['status']} campaign")
    if action == "resume":
        s = await core.get_settings()
        need(not s["live_sending"] or c["is_admin"], "Only an admin can resume a live campaign")
    upd = {"status": new, f"{action}d_at": iso(), f"{action}d_by": c["user"].get("name")}
    if action == "pause":
        upd["paused_from"] = camp["status"]
    if action == "resume" and camp.get("paused_from") == "scheduled" and (camp.get("scheduled_at") or "") > iso():
        upd["status"] = new = "scheduled"
    await CAMP.update_one({"campaign_id": cid}, {"$set": upd})
    if action == "cancel":
        await MSG.update_many({"campaign_id": cid, "status": "queued"}, {"$set": {"status": "skipped", "error": "campaign cancelled"}})
    await core.audit(f"campaign_{action}", c["user"], campaign_id=cid)
    if action == "resume" and new == "running":
        asyncio.create_task(core.run_worker())
    return {"status": new}


@router.get("/campaigns-export")
async def export_campaigns(cid: Optional[str] = None, c=Depends(C)):
    need(c["can_campaign"] or c["role"] in ("admin", "manager"))
    out = io.StringIO()
    w = csv.writer(out)
    if cid:
        w.writerow(["Customer", "WhatsApp", "Status", "Submitted", "Delivered", "Read", "Replied", "Error"])
        async for m in MSG.find({"campaign_id": cid}):
            w.writerow([m.get("name"), "******" + (m.get("wa_number") or "")[-4:], m.get("status"), m.get("submitted_at") or "", m.get("delivered_at") or "",
                        m.get("read_at") or "", "yes" if m.get("replied") else "", m.get("error") or ""])
    else:
        w.writerow(["Campaign", "Type", "Template", "Status", "Mode", "Audience", "Queued", "Accepted", "Delivered", "Read", "Failed", "Skipped", "Replies", "Date"])
        for x in await CAMP.find({}, {"_id": 0}).sort("created_at", -1).to_list(500):
            k = await _counts(x["campaign_id"])
            w.writerow([x["name"], x["type"], x.get("template"), x["status"], x.get("mode", ""), x.get("audience_total", ""), k["queued"],
                        k["submitted"] + k["sent"] + k["delivered"] + k["read"], k["delivered"] + k["read"], k["read"], k["failed"], k["skipped"], k["replied"],
                        (x.get("confirmed_at") or x["created_at"])[:16]])
    return Response(out.getvalue(), media_type="text/csv", headers={"Content-Disposition": 'attachment; filename="campaigns.csv"'})


# ------------------------------------------------------------------ birthdays
@router.get("/birthdays")
async def birthdays(c=Depends(C)):
    await core.maybe_sync()
    s = await core.get_settings()
    rows = await CUST.find({"active": True, **c["scope"]}, {"_id": 0}).to_list(20000)
    today = core.ist_now()
    pol = s["birthday"]["feb29_policy"]
    upcoming, counts = [], {"today": 0, "tomorrow": 0, "next7": 0}
    for r in rows:
        for off in range(0, 31):
            d = today + timedelta(days=off)
            if core.birthday_matches(r.get("dob"), d, pol):
                if off == 0:
                    counts["today"] += 1
                if off == 1:
                    counts["tomorrow"] += 1
                if off < 7:
                    counts["next7"] += 1
                procs = sorted({l.get("processor_name") for l in r["loans"] if l.get("processor_name")})
                gps = sorted({l.get("gp_name") for l in r["loans"] if l.get("gp_name")})
                upcoming.append({"customer_id": r["customer_id"], "name": r.get("name"), "dob": r.get("dob"), "phone": r.get("phone"),
                                 "gp": ", ".join(gps), "processor": ", ".join(procs), "birthday": d.strftime("%Y-%m-%d"), "in_days": off,
                                 "whatsapp_status": core.exclusion_reason(r) or "eligible"})
                break
    upcoming.sort(key=lambda x: x["in_days"])
    ids = [r["customer_id"] for r in rows]
    day = today.strftime("%Y-%m-%d")
    logq = {"kind": "birthday", "customer_id": {"$in": ids}}
    log = await MSG.find(logq, {"_id": 0, "var_map": 0}).sort("created_at", -1).to_list(500)
    today_log = [m for m in log if (m.get("scheduled_for") or m.get("created_at") or "")[:10] == day]
    return {"counts": {**counts, "sent_today": sum(1 for m in today_log if m["status"] in ("submitted", "sent", "delivered", "read", "mock")),
                       "delivered_today": sum(1 for m in today_log if m["status"] in ("delivered", "read")),
                       "failed_today": sum(1 for m in today_log if m["status"] == "failed"),
                       "missing_dob": sum(1 for r in rows if not r.get("dob"))},
            "upcoming": upcoming, "log": log, "settings": s["birthday"] if (c["is_admin"] or c["can_campaign"]) else None}


class ManualBirthday(BaseModel):
    customer_id: str
    confirm_repeat: bool = False


@router.post("/birthdays/manual")
async def manual_birthday(body: ManualBirthday, c=Depends(C)):
    need(c["is_admin"], "Only an admin can send a manual birthday greeting")
    s = await core.get_settings()
    b = s["birthday"]
    tpl = await TPL.find_one({"name": b.get("template"), "language": b.get("language")}, {"_id": 0})
    if not tpl or not tpl.get("sendable"):
        raise HTTPException(400, "Configure an approved birthday template first")
    cust = await scoped_customer(c, body.customer_id)
    reason = core.exclusion_reason(cust)
    if reason:
        raise HTTPException(400, f"Customer is not eligible: {reason}")
    year = core.ist_now().year
    already = await MSG.find_one({"kind": "birthday", "customer_id": body.customer_id, "year": year, "status": {"$nin": ["failed", "skipped"]}})
    if already and not body.confirm_repeat:
        raise HTTPException(409, "A birthday greeting was already sent or queued this year. Confirm to send again.")
    created = await core.queue_birthday(cust, tpl, b, iso(), year, manual_by=c["user"].get("name"), repeat=bool(already))
    m = await MSG.find_one_and_update({"customer_id": body.customer_id, "kind": "birthday", "status": "queued"},
                                      {"$set": {"status": "sending", "claimed_at": iso()}, "$inc": {"attempts": 1}}, sort=[("created_at", -1)])
    res = await core.deliver(m, s) if m else {"status": "not queued"}
    await core.audit("birthday_manual", c["user"], customer_id=body.customer_id, repeat=bool(already), result=res["status"], created=created)
    return res


@router.post("/birthdays/run-now")
async def birthday_run_now(c=Depends(C)):
    need(c["is_admin"])
    s = await core.get_settings()
    await core._send_birthdays(s, force_date=core.ist_now().strftime("%Y-%m-%d"))
    return {"ok": True}


# ------------------------------------------------------------------ cron
@router.post("/cron/tick")
async def cron_tick(request: Request):
    # Cron endpoints must ack 2xx immediately; enqueue/background the actual work.
    secret = os.environ.get("WEBHOOK_CRON_SECRET") or ""
    auth = request.headers.get("authorization") or ""
    if not secret or not auth.startswith("Bearer ") or not hmac.compare_digest(auth[7:].encode(), secret.encode()):
        raise HTTPException(401, "unauthorized")
    run_id = request.headers.get("x-webhook-id") or ""
    if run_id and await db.app_settings.find_one({"key": "cc_cron_run", "run_id": run_id}):
        return {"ok": True, "duplicate": True}
    await db.app_settings.update_one({"key": "cc_cron_run"}, {"$set": {"key": "cc_cron_run", "run_id": run_id, "at": iso()}}, upsert=True)

    async def job():
        try:
            last = await core.TPL.find_one({}, {"last_synced": 1}, sort=[("last_synced", -1)])
            if not last or (last.get("last_synced") or "") < iso(datetime.now(timezone.utc) - timedelta(hours=1)):
                await core.sync_templates()
                from routes.meta_ad_perf import sync_spend, _ads_cfg
                if all(_ads_cfg()):
                    await sync_spend(days=7)
            await core.sync_customers()
            await core.run_worker()
        except Exception:
            core.logger.exception("cc cron tick failed")
    asyncio.create_task(job())
    return {"ok": True}
