"""Growth Partner programme: signup/onboarding, partner portal (leads, payouts, rates, card, KYC, agreement)
and admin tools (KYC review, payout-structure CSV import with versioning, payout ledger, agreement templates)."""
import csv
import hashlib
import io
import re
import secrets
import uuid
from datetime import datetime, timezone, timedelta, date
from typing import Optional, List

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Request
from fastapi.responses import Response
from motor.motor_asyncio import AsyncIOMotorGridFSBucket
from pydantic import BaseModel

from utils.database import db
from utils.auth import get_current_user, get_password_hash, verify_password, is_gp_role, normalize_role

router = APIRouter(prefix="/api/gp", tags=["Growth Partner"])
BUCKET = lambda: AsyncIOMotorGridFSBucket(db, bucket_name="gp_documents")  # noqa: E731
COMPANY = {"name": "NeoSales Consulting Pvt Ltd", "brand": "Bankezee"}
PRODUCT_CODES = {"PL": "Personal Loan", "BL": "Business Loan", "HL": "Home Loan", "LAP": "Loan Against Property",
                 "BT": "Balance Transfer", "CC": "Credit Card", "AL": "Auto Loan", "EL": "Education Loan", "GL": "Gold Loan"}
KYC_ITEMS = {"individual": ["pan", "identity", "bank"], "business": ["pan", "identity", "business_reg", "bank"]}
STEPS = ["account", "profile", "kyc", "payout", "agreement"]
PAYOUT_STATUSES = ["Under Verification", "Payable", "Paid", "On Hold", "Reversed"]


def now():
    return datetime.now(timezone.utc).isoformat()


def uid(u):
    return u.get("id") or str(u.get("_id"))


def mask(v, keep=4):
    v = str(v or "")
    return ("•" * max(0, len(v) - keep) + v[-keep:]) if v else ""


def slug(s):
    return re.sub(r"[^A-Z0-9]+", "_", str(s or "").upper()).strip("_")


async def require_gp(user: dict = Depends(get_current_user)):
    if not is_gp_role(user.get("role", "")):
        raise HTTPException(403, "Growth Partner access only")
    return user


async def require_admin_only(user: dict = Depends(get_current_user)):
    if normalize_role(user.get("role", "")) != "admin":
        raise HTTPException(403, "Admin only")
    return user


async def ensure_code(u):
    if not u.get("partner_code"):
        from routes.auth import generate_partner_code
        code = generate_partner_code(u.get("name") or "PART")
        await db.users.update_one({"_id": u["_id"]}, {"$set": {"partner_code": code}})
        u["partner_code"] = code
    return u["partner_code"]


# ---------------- signup / sign-in ----------------
class Signup(BaseModel):
    reg_type: str
    mobile: str
    email: str
    name: str
    password: str


def norm_mobile(m):
    d = re.sub(r"\D", "", m or "")
    return d[-10:] if len(d) >= 10 else d


@router.post("/signup")
async def signup(inp: Signup):
    from routes.auth import login, UserLogin
    mob, email = norm_mobile(inp.mobile), inp.email.strip().lower()
    if inp.reg_type not in KYC_ITEMS or len(mob) != 10 or not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
        raise HTTPException(400, "Enter a valid 10-digit mobile number and email")
    if len(inp.password) < 8:
        raise HTTPException(400, "Password must be at least 8 characters")
    if await db.users.find_one({"$or": [{"phone": {"$regex": f"{mob}$"}}, {"email": {"$regex": f"^{re.escape(email)}$", "$options": "i"}}]}):
        raise HTTPException(409, "already_registered")
    h = get_password_hash(inp.password)
    doc = {"id": str(uuid.uuid4()), "email": email, "password": h, "password_hash": h, "name": inp.name.strip(), "phone": mob,
           "role": "growth_partner", "source": "gp_signup", "is_active": True, "is_approved": True, "approval_status": "approved",
           "gp_status": "onboarding", "gp_profile": {"reg_type": inp.reg_type, "legal_name": inp.name.strip(), "email": email},
           "gp_kyc": {}, "gp_steps": {"account": True}, "created_at": datetime.now(timezone.utc), "manager_name": "Unassigned"}
    r = await db.users.insert_one(doc)
    doc["_id"] = r.inserted_id
    await db.users.update_one({"_id": r.inserted_id}, {"$set": {"id": str(r.inserted_id)}})
    await ensure_code(doc)
    return await login(UserLogin(email=email, password=inp.password, platform="web"))


class MobileLogin(BaseModel):
    identifier: str
    password: str


@router.post("/login")
async def gp_login(inp: MobileLogin):
    ident = inp.identifier.strip()
    email = ident.lower()
    norm = email if "@" in ident else norm_mobile(ident)
    acct = await db.users.find_one({"email": {"$regex": f"^{re.escape(norm)}$", "$options": "i"}} if "@" in ident else {"phone": {"$regex": f"{norm}$"}}, {"id": 1})
    key = uid(acct) if acct else norm
    since = (datetime.now(timezone.utc) - timedelta(minutes=15)).isoformat()
    if await db.gp_login_failures.count_documents({"key": key, "at": {"$gte": since}}) >= 5:
        raise HTTPException(429, "Too many failed attempts — try again in 15 minutes")
    try:
        res = await _gp_login(ident, email, inp.password)
    except HTTPException as e:
        if e.status_code == 401:
            await db.gp_login_failures.insert_one({"key": key, "at": now()})
        raise
    await db.gp_login_failures.delete_many({"key": key})
    return res


async def _gp_login(ident, email, password):
    from routes.auth import login, UserLogin
    if "@" not in ident:
        mob = norm_mobile(ident)
        cands = await db.users.find({"phone": {"$regex": f"{mob}$"}}, {"email": 1, "password": 1, "password_hash": 1, "is_active": 1}).to_list(10)
        hit = next((c for c in cands if any(c.get(k) and verify_password(password, c[k]) for k in ("password", "password_hash"))), None)
        if not hit:
            raise HTTPException(401, "Invalid mobile number or password")
        email = hit["email"]
    return await login(UserLogin(email=email, password=password, platform="web"))


@router.get("/check")
async def check_registered(mobile: str):
    return {"registered": bool(await db.users.find_one({"phone": {"$regex": f"{norm_mobile(mobile)}$"}}, {"_id": 1}))}


# ---------------- onboarding state ----------------
def kyc_view(u):
    p = u.get("gp_profile") or {}
    items = KYC_ITEMS.get(p.get("reg_type") or "individual")
    k = u.get("gp_kyc") or {}
    out = {}
    for it in items:
        x = dict(k.get(it) or {})
        if it == "bank":
            pay = u.get("gp_payout") or {}
            x.update({"holder": pay.get("holder"), "account": mask(pay.get("account_number")), "ifsc": pay.get("ifsc")})
        if x.get("number"):
            x["number"] = mask(x["number"]) if it != "pan" else x["number"][:2] + "•••••" + x["number"][-3:]
        x.setdefault("status", "Not Submitted")
        out[it] = x
    return out


async def agreement_for(pid):
    return await db.gp_agreements.find_one({"partner_id": pid, "superseded": {"$ne": True}}, {"_id": 0, "otp_hash": 0}, sort=[("issued_at", -1)])


async def state(u):
    pid = uid(u)
    code = await ensure_code(u)
    p = u.get("gp_profile") or {}
    kyc = kyc_view(u)
    ag = await agreement_for(pid)
    legacy = u.get("source") != "gp_signup"
    steps = {"account": True,
             "profile": bool(p.get("legal_name") and p.get("city") and p.get("pin") and (p.get("reg_type") != "business" or p.get("entity_name"))),
             "kyc": all(v.get("status") in ("Pending", "Verified") for k2, v in kyc.items() if k2 != "bank"),
             "payout": bool((u.get("gp_payout") or {}).get("account_number")),
             "agreement": bool(ag and ag.get("status") == "Signed")}
    verified = all(v.get("status") == "Verified" for v in kyc.values())
    active = u.get("gp_status") == "active" or (legacy and u.get("is_active", True))
    if not active and verified and steps["agreement"]:
        await db.users.update_one({"_id": u["_id"]}, {"$set": {"gp_status": "active", "gp_activated_at": now()}})
        active = True
    tasks = [{"key": k, "label": lbl} for k, lbl, need in (
        ("profile", "Complete your profile", not steps["profile"]), ("kyc", "Upload KYC documents", not steps["kyc"] and not any(v.get("status") == "Action Required" for v in kyc.values())),
        ("payout", "Add payout bank account", not steps["payout"]),
        ("bank_doc", "Upload a cancelled cheque or bank statement", steps["payout"] and kyc.get("bank", {}).get("status") == "Not Submitted"),
        ("kyc_review", "Your documents are being reviewed by Bankezee (usually 1–2 working days)", not active and any(v.get("status") == "Pending" for v in kyc.values())),
        ("kyc_fix", "Correct KYC items marked Action Required", any(v.get("status") == "Action Required" for v in kyc.values())),
        ("agreement", "Sign your Partner Agreement", bool(ag and ag.get("status") != "Signed"))) if need]
    if not ag and not active and all(steps[s] for s in STEPS[:4]):
        tasks.append({"key": "agreement_wait", "label": "Sign your Partner Agreement"})
    return {"partner_id": code, "user_id": pid, "name": u.get("name"), "mobile": u.get("phone"), "email": u.get("email"),
            "status": "Active" if active else "Onboarding", "profile": p, "kyc": kyc, "steps": steps,
            "first_incomplete": next((s for s in STEPS if not steps[s]), None), "tasks": tasks, "legacy_partner": legacy,
            "payout": {"holder": (u.get("gp_payout") or {}).get("holder"), "account": mask((u.get("gp_payout") or {}).get("account_number")),
                       "ifsc": (u.get("gp_payout") or {}).get("ifsc"), "status": (u.get("gp_kyc") or {}).get("bank", {}).get("status", "Not Submitted")},
            "agreement": ag and {k: ag.get(k) for k in ("id", "status", "version", "title", "issued_at", "signed_at")}}


@router.get("/me")
async def me(u: dict = Depends(require_gp)):
    return await state(await raw_user(u))


async def raw_user(u):
    if u.get("id"):
        r = await db.users.find_one({"id": u["id"]})
        if r:
            return r
    i = str(u.get("_id") or u.get("id"))
    return await db.users.find_one({"_id": ObjectId(i)}) if ObjectId.is_valid(i) else None


class Profile(BaseModel):
    reg_type: Optional[str] = None
    legal_name: Optional[str] = None
    email: Optional[str] = None
    dob: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    pin: Optional[str] = None
    entity_name: Optional[str] = None
    entity_type: Optional[str] = None
    registered_address: Optional[str] = None
    signatory_name: Optional[str] = None
    signatory_designation: Optional[str] = None
    gstin: Optional[str] = None
    registration_no: Optional[str] = None


@router.put("/me/profile")
async def save_profile(inp: Profile, u: dict = Depends(require_gp)):
    raw = await raw_user(u)
    p = {**(raw.get("gp_profile") or {}), **{k: v.strip() if isinstance(v, str) else v for k, v in inp.dict().items() if v is not None}}
    if p.get("pin") and not re.match(r"^\d{6}$", p["pin"]):
        raise HTTPException(400, "PIN code must be 6 digits")
    await db.users.update_one({"_id": raw["_id"]}, {"$set": {"gp_profile": p, "city": p.get("city") or raw.get("city")}})
    return await state(await raw_user(u))


@router.post("/me/kyc/{item}")
async def upload_kyc(item: str, request: Request, file: UploadFile = File(...), u: dict = Depends(require_gp)):
    raw = await raw_user(u)
    if item not in KYC_ITEMS["business"]:
        raise HTTPException(404, "Unknown KYC item")
    form = await request.form()
    number = (form.get("number") or "").strip().upper()
    if item == "pan" and not re.match(r"^[A-Z]{5}\d{4}[A-Z]$", number):
        raise HTTPException(400, "Enter a valid PAN (e.g. ABCDE1234F)")
    data = await file.read()
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(400, "File must be under 10 MB")
    gid = await BUCKET().upload_from_stream(file.filename or item, data, metadata={"partner_id": uid(raw), "item": item, "content_type": file.content_type})
    cur = (raw.get("gp_kyc") or {}).get(item) or {}
    rec = {"status": "Pending", "doc_id": str(gid), "file_name": file.filename, "submitted_at": now(), "note": None,
           "number": number or cur.get("number"), "id_type": form.get("id_type") or cur.get("id_type"),
           "history": (cur.get("history") or []) + ([{k: cur.get(k) for k in ("status", "doc_id", "note", "submitted_at")}] if cur else [])}
    await db.users.update_one({"_id": raw["_id"]}, {"$set": {f"gp_kyc.{item}": rec}})
    return await state(await raw_user(u))


class Payout(BaseModel):
    holder: str
    account_number: str
    confirm_account_number: str
    ifsc: str


@router.put("/me/payout")
async def save_payout(inp: Payout, u: dict = Depends(require_gp)):
    raw = await raw_user(u)
    acc = re.sub(r"\s", "", inp.account_number)
    if acc != re.sub(r"\s", "", inp.confirm_account_number):
        raise HTTPException(400, "Account numbers do not match")
    if not re.match(r"^\d{9,18}$", acc) or not re.match(r"^[A-Z]{4}0[A-Z0-9]{6}$", inp.ifsc.strip().upper()):
        raise HTTPException(400, "Enter a valid account number (9–18 digits) and IFSC (e.g. HDFC0001234)")
    cur = (raw.get("gp_kyc") or {}).get("bank") or {}
    await db.users.update_one({"_id": raw["_id"]}, {"$set": {"gp_payout": {"holder": inp.holder.strip(), "account_number": acc, "ifsc": inp.ifsc.strip().upper(), "updated_at": now()},
                                                            "gp_kyc.bank": {**cur, "status": "Pending" if cur.get("doc_id") else "Not Submitted", "note": "Bank details changed — re-verification required" if cur.get("status") == "Verified" else cur.get("note")}}})
    return await state(await raw_user(u))


@router.get("/docs/{doc_id}")
async def get_doc(doc_id: str, u: dict = Depends(get_current_user)):
    from gridfs.errors import NoFile
    if not ObjectId.is_valid(doc_id):
        raise HTTPException(404, "Document not found")
    try:
        s = await BUCKET().open_download_stream(ObjectId(doc_id))
    except NoFile:
        raise HTTPException(404, "Document not found")
    meta = s.metadata or {}
    if normalize_role(u.get("role", "")) != "admin" and meta.get("partner_id") not in (uid(u), str(u.get("_id") or "")):
        raise HTTPException(403, "Not your document")
    return Response(await s.read(), media_type=meta.get("content_type") or "application/octet-stream",
                    headers={"Content-Disposition": f'inline; filename="{s.filename}"'})


# ---------------- leads & referrals (files attributed to the partner) ----------------
def stage(f):
    s = str(f.get("processing_status") or f.get("file_status") or "new").lower()
    if "disburs" in s:
        return "Disbursed"
    if "reject" in s or "declin" in s:
        return "Rejected"
    if "sanction" in s or "approv" in s:
        return "Sanctioned"
    if "login" in s or "process" in s or "query" in s or "hold" in s:
        return "In Process"
    return "Submitted"


@router.get("/leads")
async def my_leads(search: str = "", stage_f: str = "", u: dict = Depends(require_gp)):
    pid = uid(u)
    q = {"status": "file", "$or": [{"file_assigned_to": pid}, {"assigned_to": pid}, {"gp_referral.partner_id": pid}]}
    if search:
        q["$and"] = [{"$or": [{"name": {"$regex": re.escape(search), "$options": "i"}}, {"phone": {"$regex": re.escape(search)}}]}]
    files = await db.leads.find(q, {"_id": 0, "id": 1, "name": 1, "phone": 1, "file_details.type_of_loan": 1, "requirement": 1, "processing_status": 1,
                                   "file_status": 1, "created_at": 1, "file_created_at": 1, "updated_at": 1, "gp_referral": 1, "query_hold_reason": 1}).sort("created_at", -1).to_list(2000)
    rows = [{"id": f.get("id"), "name": f.get("name"), "phone": mask(f.get("phone"), 4), "product": (f.get("file_details") or {}).get("type_of_loan") or f.get("requirement"),
             "stage": stage(f), "status": f.get("processing_status") or f.get("file_status") or "New", "added": str(f.get("file_created_at") or f.get("created_at") or "")[:10],
             "updated": str(f.get("updated_at") or "")[:16].replace("T", " "), "via": (f.get("gp_referral") or {}).get("channel", "Partner"),
             "note": f.get("query_hold_reason")} for f in files]
    counts = {s: sum(1 for r in rows if r["stage"] == s) for s in ("Submitted", "In Process", "Sanctioned", "Disbursed", "Rejected")}
    if stage_f:
        rows = [r for r in rows if r["stage"] == stage_f]
    return {"rows": rows, "counts": counts, "total": sum(counts.values())}


class Referral(BaseModel):
    name: str
    mobile: str
    city: Optional[str] = None
    loan_type: Optional[str] = None
    amount: Optional[float] = None
    consent: bool


async def create_referral(partner: dict, inp: Referral, channel: str):
    from routes.files_crm import create_file_direct, FileCreate
    if not inp.consent:
        raise HTTPException(400, "Customer consent is required")
    mob = norm_mobile(inp.mobile)
    if len(mob) != 10:
        raise HTTPException(400, "Enter a valid 10-digit mobile number")
    pid = uid(partner)
    dup = await db.leads.find_one({"status": "file", "phone": {"$regex": f"{mob}$"}, "gp_referral.partner_id": pid,
                                   "created_at": {"$gte": datetime.now(timezone.utc) - timedelta(days=1)}}, {"id": 1})
    if dup:
        return {"id": dup.get("id"), "duplicate": True}
    res = await create_file_direct(FileCreate(full_name=inp.name.strip(), mobile=mob, city=inp.city, type_of_loan=inp.loan_type, gp_id=pid,
                                              additional_data={"loan_amount": inp.amount} if inp.amount else None), current_user=partner)
    fid = res.get("file_id") or res.get("id")
    await db.leads.update_one({"id": fid}, {"$set": {"gp_referral": {"partner_id": pid, "partner_code": partner.get("partner_code"), "channel": channel,
                                                                    "consent_at": now()}}})
    return {"id": fid, "duplicate": False}


@router.post("/leads")
async def add_lead(inp: Referral, u: dict = Depends(require_gp)):
    raw = await raw_user(u)
    return await create_referral(raw | {"id": uid(raw)}, inp, "Partner entered")


@router.get("/public/partner/{code}")
async def public_partner(code: str):
    p = await db.users.find_one({"partner_code": code.upper(), "is_active": {"$ne": False}}, {"name": 1, "partner_code": 1, "role": 1})
    if not p or not is_gp_role(p.get("role", "")):
        raise HTTPException(404, "Referral link not found")
    return {"partner_id": p["partner_code"], "display_name": (p.get("name") or "").split(" ")[0], "products": list(PRODUCT_CODES.values())}


@router.post("/public/refer/{code}")
async def public_refer(code: str, inp: Referral):
    p = await db.users.find_one({"partner_code": code.upper(), "is_active": {"$ne": False}})
    if not p or not is_gp_role(p.get("role", "")):
        raise HTTPException(404, "Referral link not found")
    p["id"] = uid(p)
    r = await create_referral(p, inp, "Referral link")
    return {"ok": True, "duplicate": r["duplicate"]}


# ---------------- payout structure (rates) ----------------
CSV_COLS = ["rate_code", "product_code", "lender_code", "payout_type", "payout_value", "slab_min_inr", "slab_max_inr", "qualifying_event",
            "effective_from", "effective_to", "partner_code", "partner_visible_terms"]
EVENTS = {"disbursement", "sanction", "login"}


async def lender_codes():
    return {slug(p.get("bank_name")) for p in await db.bank_policies.find({}, {"bank_name": 1}).to_list(500)}


def _d(s):
    return date.fromisoformat(s) if s else None


def _overlap(a, b):
    a0, a1, b0, b1 = _d(a["effective_from"]), _d(a.get("effective_to")) or date.max, _d(b["effective_from"]), _d(b.get("effective_to")) or date.max
    s = lambda r: (float(r.get("slab_min_inr") or 0), float(r.get("slab_max_inr") or 1e15))  # noqa: E731
    (x0, x1), (y0, y1) = s(a), s(b)
    return a0 <= b1 and b0 <= a1 and x0 < y1 and y0 < x1


@router.get("/admin/rates/template.csv")
async def rate_template(_: dict = Depends(require_admin_only)):
    lenders = sorted(await lender_codes())
    body = ",".join(CSV_COLS) + "\nPL_STD_2026,PL,,percent,1.25,0,,disbursement,2026-07-01,,,Paid on disbursed amount after lender payout reconciliation\n"
    body += f"# payout_type: percent (enter 1.25 for 1.25%) or fixed (INR amount). product_code: {'/'.join(PRODUCT_CODES)}. lender_code (blank = all lenders): {'/'.join(lenders[:60])}. partner_code blank = standard rate.\n"
    return Response(body, media_type="text/csv", headers={"Content-Disposition": 'attachment; filename="gp_payout_structure_template.csv"'})


def _clean(r):
    return {k: (str(r.get(k) or "").strip()) for k in CSV_COLS}


@router.post("/admin/rates/preview")
async def rate_preview(file: UploadFile = File(...), u: dict = Depends(require_admin_only)):
    text = (await file.read()).decode("utf-8-sig")
    reader = csv.DictReader([ln for ln in text.splitlines() if ln.strip() and not ln.startswith("#")])
    if not reader.fieldnames or [c.strip() for c in reader.fieldnames] != CSV_COLS:
        raise HTTPException(400, "Header must be exactly: " + ",".join(CSV_COLS))
    lenders, partners = await lender_codes(), {p["partner_code"] for p in await db.users.find({"partner_code": {"$exists": True}}, {"partner_code": 1}).to_list(20000)}
    live = {r["rate_code"]: r for r in await db.gp_rates.find({"status": "published"}, {"_id": 0}).to_list(5000)}
    rows, seen = [], {}
    for i, raw in enumerate(reader, start=2):
        r, errs = _clean(raw), []
        r["product_code"], r["lender_code"], r["partner_code"], r["payout_type"] = r["product_code"].upper(), r["lender_code"].upper(), r["partner_code"].upper(), r["payout_type"].lower()
        if not re.match(r"^[A-Za-z0-9_\-]{3,40}$", r["rate_code"]):
            errs.append("rate_code required (3–40 letters/digits/_/-)")
        if r["product_code"] not in PRODUCT_CODES:
            errs.append(f"unknown product_code {r['product_code']}")
        if r["lender_code"] and r["lender_code"] not in lenders:
            errs.append(f"unknown lender_code {r['lender_code']}")
        if r["partner_code"] and r["partner_code"] not in partners:
            errs.append(f"unknown partner_code {r['partner_code']}")
        try:
            v = float(r["payout_value"])
            if r["payout_type"] == "percent" and not 0 < v <= 10:
                errs.append("percent must be between 0 and 10 (1.25 = 1.25%)")
            elif r["payout_type"] == "fixed" and v <= 0:
                errs.append("fixed amount must be > 0 INR")
            elif r["payout_type"] not in ("percent", "fixed"):
                errs.append("payout_type must be percent or fixed")
        except ValueError:
            errs.append("payout_value must be a number")
        try:
            lo, hi = float(r["slab_min_inr"] or 0), float(r["slab_max_inr"] or 1e15)
            if lo >= hi:
                errs.append("slab_min_inr must be below slab_max_inr")
        except ValueError:
            errs.append("slab values must be numbers")
        if r["qualifying_event"].lower() not in EVENTS:
            errs.append("qualifying_event must be disbursement, sanction or login")
        r["qualifying_event"] = r["qualifying_event"].lower()
        try:
            if not r["effective_from"] or not re.match(r"^\d{4}-\d{2}-\d{2}$", r["effective_from"]) or (r["effective_to"] and not re.match(r"^\d{4}-\d{2}-\d{2}$", r["effective_to"])):
                raise ValueError
            if _d(r["effective_to"]) and _d(r["effective_to"]) < _d(r["effective_from"]):
                errs.append("effective_from required and before effective_to")
        except ValueError:
            errs.append("dates must be YYYY-MM-DD")
        if r["rate_code"] in seen:
            errs.append(f"duplicate rate_code (row {seen[r['rate_code']]})")
        seen.setdefault(r["rate_code"], i)
        old = live.get(r["rate_code"])
        same = lambda k: (float(old.get(k) or 0) == float(r[k] or 0)) if k == "payout_value" and not errs else str(old.get(k) or "") == r[k]  # noqa: E731
        kind = "Error" if errs else ("New" if not old else "Unchanged" if all(same(k) for k in CSV_COLS) else "Update")
        rows.append({"row": i, **r, "kind": kind, "errors": errs, "current_version": old and old.get("version")})
    ok = [x for x in rows if x["kind"] != "Error"]
    scope = lambda x: (x["product_code"], x["lender_code"], x["partner_code"])  # noqa: E731
    pool = {k: v for k, v in live.items() if k not in {x["rate_code"] for x in ok}}
    for a in ok:
        for b in list(pool.values()) + [x for x in ok if x is not a]:
            try:
                if scope(a) == scope(b) and _overlap(a, b):
                    a["kind"], a["errors"] = "Error", a["errors"] + [f"overlaps {b['rate_code']} for the same product/lender/partner and period"]
                    break
            except ValueError:
                pass
    bid = uuid.uuid4().hex[:12]
    await db.gp_rate_batches.insert_one({"id": bid, "file_name": file.filename, "rows": rows, "status": "draft", "uploaded_by": u.get("name"), "uploaded_at": now()})
    return await _batch(bid)


async def _batch(bid):
    b = await db.gp_rate_batches.find_one({"id": bid}, {"_id": 0})
    if not b:
        raise HTTPException(404, "Batch not found")
    b["summary"] = {k: sum(1 for r in b["rows"] if r["kind"] == k) for k in ("New", "Update", "Unchanged", "Error")}
    return b


@router.get("/admin/rates/batches")
async def rate_batches(_: dict = Depends(require_admin_only)):
    out = []
    for b in await db.gp_rate_batches.find({}, {"_id": 0, "rows": 0}).sort("uploaded_at", -1).to_list(50):
        out.append((await _batch(b["id"])) | {"rows": None})
    return out


@router.get("/admin/rates/batches/{bid}")
async def rate_batch(bid: str, _: dict = Depends(require_admin_only)):
    return await _batch(bid)


@router.get("/admin/rates/batches/{bid}/errors.csv")
async def rate_errors(bid: str, _: dict = Depends(require_admin_only)):
    b = await _batch(bid)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["row", "rate_code", "errors"])
    for r in b["rows"]:
        if r["kind"] == "Error":
            w.writerow([r["row"], r["rate_code"], "; ".join(r["errors"])])
    return Response(buf.getvalue(), media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="rate_errors_{bid}.csv"'})


@router.delete("/admin/rates/batches/{bid}")
async def discard_batch(bid: str, _: dict = Depends(require_admin_only)):
    await db.gp_rate_batches.update_one({"id": bid, "status": "draft"}, {"$set": {"status": "discarded"}})
    return {"ok": True}


@router.post("/admin/rates/batches/{bid}/publish")
async def publish_batch(bid: str, u: dict = Depends(require_admin_only)):
    claim = await db.gp_rate_batches.find_one_and_update({"id": bid, "status": "draft"}, {"$set": {"status": "publishing"}})
    if not claim:
        raise HTTPException(409, "Batch already published or discarded")
    b = await _batch(bid)
    if b["summary"]["Error"]:
        await db.gp_rate_batches.update_one({"id": bid}, {"$set": {"status": "draft"}})
        raise HTTPException(400, "Fix the error rows before publishing")
    docs, codes = [], []
    for r in b["rows"]:
        if r["kind"] not in ("New", "Update"):
            continue
        old = await db.gp_rates.find_one({"rate_code": r["rate_code"], "status": "published"})
        docs.append({k: r[k] for k in CSV_COLS} | {"payout_value": float(r["payout_value"]), "version": (old or {}).get("version", 0) + 1, "status": "published",
                                                   "batch_id": bid, "published_by": u.get("name"), "published_at": now(), "uploaded_by": b["uploaded_by"]})
        codes.append(r["rate_code"])
    async with await db.client.start_session() as s:
        try:
            async with s.start_transaction():
                await db.gp_rates.update_many({"rate_code": {"$in": codes}, "status": "published"}, {"$set": {"status": "superseded", "superseded_at": now()}}, session=s)
                if docs:
                    await db.gp_rates.insert_many(docs, session=s)
                await db.gp_rate_batches.update_one({"id": bid}, {"$set": {"status": "published", "published_by": u.get("name"), "published_at": now()}}, session=s)
        except Exception:
            await db.gp_rates.update_many({"rate_code": {"$in": codes}, "status": "published", "batch_id": {"$ne": bid}}, {"$set": {"status": "superseded", "superseded_at": now()}})
            if docs and not await db.gp_rates.find_one({"batch_id": bid}):
                await db.gp_rates.insert_many(docs)
            await db.gp_rate_batches.update_one({"id": bid}, {"$set": {"status": "published", "published_by": u.get("name"), "published_at": now()}})
    return {"published": len(docs)}


@router.get("/admin/rates")
async def admin_rates(_: dict = Depends(require_admin_only)):
    return await db.gp_rates.find({}, {"_id": 0}).sort([("rate_code", 1), ("version", -1)]).to_list(5000)


def rate_tag(r, today):
    if _d(r["effective_from"]) > today:
        return "Upcoming"
    if r.get("effective_to") and _d(r["effective_to"]) < today:
        return "Expired"
    return "Current"


@router.get("/rates")
async def my_rates(u: dict = Depends(require_gp)):
    code = await ensure_code(await raw_user(u))
    today = date.today()
    rs = await db.gp_rates.find({"status": {"$in": ["published", "superseded"]}, "partner_code": {"$in": ["", code]}}, {"_id": 0, "batch_id": 0, "uploaded_by": 0, "published_by": 0}).to_list(2000)
    for r in rs:
        r["product"] = PRODUCT_CODES.get(r["product_code"], r["product_code"])
        r["tag"] = "Previous version" if r["status"] == "superseded" else rate_tag(r, today)
        r["override"] = bool(r["partner_code"])
    return {"rates": sorted(rs, key=lambda r: (r["product_code"], r["lender_code"], r["effective_from"])), "published": bool(rs)}


async def resolve_rate(partner_code, product, lender, event_date, amount):
    d = event_date.isoformat() if isinstance(event_date, date) else str(event_date)[:10]
    cands = [r for r in await db.gp_rates.find({"status": "published", "product_code": product}, {"_id": 0}).to_list(500)
             if r["partner_code"] in ("", partner_code) and r["lender_code"] in ("", lender) and r["effective_from"] <= d and (not r.get("effective_to") or r["effective_to"] >= d)
             and float(r.get("slab_min_inr") or 0) <= amount < float(r.get("slab_max_inr") or 1e15)]
    cands.sort(key=lambda r: (bool(r["partner_code"]), bool(r["lender_code"])), reverse=True)
    if len(cands) > 1 and (bool(cands[0]["partner_code"]), bool(cands[0]["lender_code"])) == (bool(cands[1]["partner_code"]), bool(cands[1]["lender_code"])):
        return None, "Overlapping rates — admin correction needed: " + ", ".join(c["rate_code"] for c in cands[:3])
    return (cands[0], None) if cands else (None, "No published rate for this product/lender/date")


# ---------------- payout ledger ----------------
class LedgerEntry(BaseModel):
    partner_code: str
    file_id: Optional[str] = None
    referral_ref: Optional[str] = None
    product_code: str
    lender_code: Optional[str] = ""
    disbursement_date: str
    disbursed_amount: float
    deductions: float = 0
    deduction_note: Optional[str] = None


@router.post("/admin/payouts")
async def add_payout(inp: LedgerEntry, u: dict = Depends(require_admin_only)):
    p = await db.users.find_one({"partner_code": inp.partner_code.upper()})
    if not p:
        raise HTTPException(404, "Unknown partner_code")
    if inp.file_id and await db.gp_payouts.find_one({"file_id": inp.file_id, "status": {"$ne": "Reversed"}}):
        raise HTTPException(409, "A payout already exists for this file")
    rate, err = await resolve_rate(inp.partner_code.upper(), inp.product_code.upper(), (inp.lender_code or "").upper(), inp.disbursement_date, inp.disbursed_amount)
    if not rate:
        raise HTTPException(400, err)
    gross = round(inp.disbursed_amount * rate["payout_value"] / 100, 2) if rate["payout_type"] == "percent" else rate["payout_value"]
    doc = {"id": uuid.uuid4().hex[:12], "partner_id": uid(p), "partner_code": p["partner_code"], **inp.dict(exclude={"partner_code"}),
           "product_code": inp.product_code.upper(), "lender_code": (inp.lender_code or "").upper(), "rate_code": rate["rate_code"], "rate_version": rate["version"],
           "payout_type": rate["payout_type"], "payout_value": rate["payout_value"], "gross": gross, "net": round(gross - inp.deductions, 2),
           "status": "Under Verification", "reason": None, "payment_date": None, "txn_ref": None, "created_by": u.get("name"), "created_at": now()}
    await db.gp_payouts.insert_one(dict(doc))
    return doc


class PayoutUpdate(BaseModel):
    status: str
    reason: Optional[str] = None
    payment_date: Optional[str] = None
    txn_ref: Optional[str] = None


@router.patch("/admin/payouts/{pid}")
async def update_payout(pid: str, inp: PayoutUpdate, u: dict = Depends(require_admin_only)):
    if inp.status not in PAYOUT_STATUSES:
        raise HTTPException(400, "Invalid status")
    if inp.status in ("On Hold", "Reversed") and not inp.reason:
        raise HTTPException(400, "A partner-facing reason is required for On Hold / Reversed")
    if inp.status == "Paid" and not (inp.payment_date and inp.txn_ref):
        raise HTTPException(400, "Payment date and transaction reference are required for Paid")
    r = await db.gp_payouts.find_one_and_update({"id": pid}, {"$set": {**inp.dict(), "updated_by": u.get("name"), "updated_at": now()},
                                                              "$push": {"history": {"status": inp.status, "by": u.get("name"), "at": now()}}})
    if not r:
        raise HTTPException(404, "Payout not found")
    return {"ok": True}


@router.get("/admin/payouts")
async def admin_payouts(_: dict = Depends(require_admin_only)):
    return await db.gp_payouts.find({}, {"_id": 0}).sort("created_at", -1).to_list(5000)


async def payout_rows(pid, status="", dfrom="", dto=""):
    q = {"partner_id": pid}
    if status:
        q["status"] = status
    rows = await db.gp_payouts.find(q, {"_id": 0, "created_by": 0, "history": 0}).sort("disbursement_date", -1).to_list(5000)
    legacy = await db.commissions.find({"source_id": pid}, {"_id": 0}).to_list(5000)
    rows += [{"id": f"legacy-{i}", "referral_ref": c.get("lead_id"), "product_code": c.get("type") or "—", "disbursement_date": str(c.get("created_at") or "")[:10],
              "gross": c.get("amount"), "net": c.get("amount"), "status": "Paid" if c.get("status") == "paid" else "Payable", "legacy": True} for i, c in enumerate(legacy)]
    return [r for r in rows if (not dfrom or str(r.get("disbursement_date")) >= dfrom) and (not dto or str(r.get("disbursement_date")) <= dto)]


@router.get("/payouts")
async def my_payouts(status: str = "", dfrom: str = "", dto: str = "", u: dict = Depends(require_gp)):
    rows = await payout_rows(uid(u), status, dfrom, dto)
    s = lambda st: round(sum(r.get("net") or 0 for r in rows if r["status"] in st), 2)  # noqa: E731
    return {"rows": rows, "summary": {"earned": s(PAYOUT_STATUSES[:3]), "under_verification": s(["Under Verification"]), "payable": s(["Payable"]),
                                      "paid": s(["Paid"]), "on_hold": s(["On Hold"])}, "requests_supported": False}


@router.get("/payouts/statement.csv")
async def my_statement(status: str = "", dfrom: str = "", dto: str = "", u: dict = Depends(require_gp)):
    rows = await payout_rows(uid(u), status, dfrom, dto)
    cols = ["referral_ref", "product_code", "lender_code", "disbursement_date", "disbursed_amount", "payout_type", "payout_value", "rate_code", "rate_version",
            "gross", "deductions", "net", "status", "reason", "payment_date", "txn_ref"]
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(cols)
    for r in rows:
        w.writerow([r.get(c, "") if r.get(c) is not None else "" for c in cols])
    return Response(buf.getvalue(), media_type="text/csv", headers={"Content-Disposition": 'attachment; filename="bankezee_payout_statement.csv"'})


# ---------------- agreement ----------------
DRAFT_BODY = """BANKEZEE GROWTH PARTNER AGREEMENT
[DRAFT FOR ADMIN PREVIEW — replace with Bankezee-approved wording before publishing]

1. PARTIES AND EFFECTIVE DATE
This Agreement is between {{company_name}}, operating the Bankezee brand ("Bankezee"), and {{partner_name}} (Partner ID {{partner_id}}), effective {{effective_date}}.

2. PURPOSE AND NATURE OF THE PARTNERSHIP
[Approved wording required.]

3. APPOINTMENT AND PERMITTED ACTIVITIES
Approved activities: {{activities}}. [Approved wording required.]

4. PARTNER OBLIGATIONS
[Approved wording required.]

5. COMMISSION, RECONCILIATION AND PAYOUT
Commission is payable as per the Commercial Schedule (version {{schedule_version}}) on the qualifying event, after lender reconciliation. [Approved wording required.]

6. CUSTOMER CONDUCT, DISCLOSURES AND COMPLAINTS
[Approved wording required.]

7. DATA PROTECTION AND CONFIDENTIALITY
[Approved wording required.]

8. BRAND USAGE
[Approved wording required.]

9. TERM, SUSPENSION AND TERMINATION
[Approved wording required.]

10. DISPUTE RESOLUTION AND GOVERNING LAW
[Approved wording required.]

PARTNER DETAILS
Partner ID: {{partner_id}} | Category: {{reg_type}} | Legal name: {{partner_name}} | Address: {{address}} | Mobile: {{mobile}} | Email: {{email}} | PAN: {{pan_masked}} | Bank account: {{bank_masked}} ({{ifsc}})
"""
DRAFT_SCHEDULE = "SCHEDULE A — COMMERCIAL SCHEDULE\nThe published Growth Partner payout structure applicable to the Partner on the agreement effective date, as shown in the partner portal under Payout Structure.\n[Approved commercial terms required.]"


async def default_template():
    if not await db.gp_agreement_templates.find_one({}):
        await db.gp_agreement_templates.insert_one({"id": uuid.uuid4().hex[:10], "version": 1, "title": "Bankezee Growth Partner Agreement", "body": DRAFT_BODY,
                                                    "schedule": DRAFT_SCHEDULE, "status": "draft", "created_at": now(), "created_by": "system"})


async def render(t, p):
    prof = p.get("gp_profile") or {}
    pay = p.get("gp_payout") or {}
    pan = ((p.get("gp_kyc") or {}).get("pan") or {}).get("number") or p.get("pan_number") or ""
    vals = {"company_name": COMPANY["name"], "partner_name": prof.get("entity_name") or prof.get("legal_name") or p.get("name"), "partner_id": await ensure_code(p),
            "effective_date": date.today().isoformat(), "activities": "Referral of customers for loan products listed in the Commercial Schedule",
            "schedule_version": str(t.get("version")), "reg_type": (prof.get("reg_type") or "individual").title(),
            "address": ", ".join(x for x in (prof.get("registered_address") or prof.get("address"), prof.get("city"), prof.get("state"), prof.get("pin")) if x),
            "mobile": p.get("phone"), "email": p.get("email"), "pan_masked": pan[:2] + "•••••" + pan[-3:] if pan else "—",
            "bank_masked": mask(pay.get("account_number")) or "—", "ifsc": pay.get("ifsc") or "—"}
    txt = t["body"] + "\n\n" + t["schedule"]
    for k, v in vals.items():
        txt = txt.replace("{{" + k + "}}", str(v or "—"))
    return txt


def pdf(text, evidence=None, title="Agreement"):
    import pymupdf
    doc = pymupdf.open()
    rect = pymupdf.Rect(50, 60, 545, 790)
    chunks, cur = [], ""
    for para in text.split("\n"):
        if len(cur) + len(para) > 2600:
            chunks.append(cur)
            cur = ""
        cur += para + "\n"
    chunks.append(cur)
    for c in chunks:
        pg = doc.new_page()
        pg.insert_text((50, 40), f"{COMPANY['brand']} · {title}", fontsize=8, color=(0.2, 0.55, 0.25))
        pg.insert_textbox(rect, c, fontsize=9.5, fontname="helv")
    if evidence:
        pg = doc.new_page()
        pg.insert_textbox(pymupdf.Rect(50, 60, 545, 790), "EXECUTION AND ACCEPTANCE — SIGNING EVIDENCE\n\n" + "\n".join(f"{k}: {v}" for k, v in evidence.items()), fontsize=10)
    return doc.tobytes()


class Issue(BaseModel):
    partner_codes: Optional[List[str]] = None
    all_partners: bool = False


@router.get("/admin/agreement-templates")
async def list_templates(_: dict = Depends(require_admin_only)):
    await default_template()
    return await db.gp_agreement_templates.find({}, {"_id": 0}).sort("version", -1).to_list(50)


class Template(BaseModel):
    title: str
    body: str
    schedule: str


@router.post("/admin/agreement-templates")
async def new_template(inp: Template, u: dict = Depends(require_admin_only)):
    last = await db.gp_agreement_templates.find_one({}, sort=[("version", -1)])
    t = {"id": uuid.uuid4().hex[:10], "version": (last or {}).get("version", 0) + 1, **inp.dict(), "status": "draft", "created_at": now(), "created_by": u.get("name")}
    await db.gp_agreement_templates.insert_one(dict(t))
    t.pop("_id", None)
    return t


@router.post("/admin/agreement-templates/{tid}/publish")
async def publish_template(tid: str, u: dict = Depends(require_admin_only)):
    t = await db.gp_agreement_templates.find_one({"id": tid})
    if not t or "[Approved wording required" in t["body"] + t["schedule"] or "DRAFT FOR ADMIN PREVIEW" in t["body"]:
        raise HTTPException(400, "Replace every '[Approved wording required]' placeholder with Bankezee-approved wording before publishing")
    await db.gp_agreement_templates.update_one({"id": tid}, {"$set": {"status": "published", "published_by": u.get("name"), "published_at": now()}})
    return {"ok": True}


@router.get("/admin/agreement-templates/{tid}/preview")
async def preview_template(tid: str, partner_code: str = "", _: dict = Depends(require_admin_only)):
    t = await db.gp_agreement_templates.find_one({"id": tid})
    p = await db.users.find_one({"partner_code": partner_code.upper()}) if partner_code else None
    p = p or {"name": "Sample Partner", "partner_code": "SAMPLE0001", "phone": "9999999999", "email": "partner@example.com", "_id": ObjectId()}
    return Response(pdf(await render(t, p), title="PREVIEW"), media_type="application/pdf")


@router.post("/admin/agreement-templates/{tid}/issue")
async def issue(tid: str, inp: Issue, u: dict = Depends(require_admin_only)):
    t = await db.gp_agreement_templates.find_one({"id": tid, "status": "published"})
    if not t:
        raise HTTPException(400, "Only a published template can be issued")
    q = {"role": {"$in": ["growth_partner", "telecaller", "sales_agent", "partner"]}, "is_active": {"$ne": False}} if inp.all_partners else {"partner_code": {"$in": [c.upper() for c in inp.partner_codes or []]}}
    n = 0
    async for p in db.users.find(q):
        pid = uid(p)
        if await db.gp_agreements.find_one({"partner_id": pid, "template_id": tid}):
            continue
        await db.gp_agreements.update_many({"partner_id": pid, "status": {"$ne": "Signed"}}, {"$set": {"superseded": True}})
        await db.gp_agreements.insert_one({"id": uuid.uuid4().hex[:12], "partner_id": pid, "partner_code": await ensure_code(p), "template_id": tid, "version": t["version"],
                                           "title": t["title"], "text": await render(t, p), "status": "Awaiting Signature", "issued_at": now(), "issued_by": u.get("name")})
        n += 1
    return {"issued": n}


async def email_ready():
    from utils.email_service import _resolve_resend
    return bool(await _resolve_resend())


async def auto_issue(u):
    t = await db.gp_agreement_templates.find_one({"status": "published"}, sort=[("version", -1)])
    if not t or await agreement_for(uid(u)):
        return
    await db.gp_agreements.insert_one({"id": uuid.uuid4().hex[:12], "partner_id": uid(u), "partner_code": await ensure_code(u), "template_id": t["id"], "version": t["version"],
                                       "title": t["title"], "text": await render(t, u), "status": "Awaiting Signature", "issued_at": now(), "issued_by": "auto (onboarding)"})


@router.get("/admin/setup-status")
async def setup_status(_: dict = Depends(require_admin_only)):
    pub = await db.gp_agreement_templates.find_one({"status": "published"}, {"version": 1})
    return {"signing_email_configured": await email_ready(), "template_published": bool(pub), "published_version": (pub or {}).get("version"),
            "rates_published": await db.gp_rates.count_documents({"status": "published"}), "signing_method": "Clickwrap + email one-time code"}


@router.get("/admin/agreements")
async def admin_agreements(_: dict = Depends(require_admin_only)):
    return await db.gp_agreements.find({}, {"_id": 0, "text": 0, "otp_hash": 0}).sort("issued_at", -1).to_list(5000)


@router.get("/agreement")
async def my_agreement(u: dict = Depends(require_gp)):
    pid = uid(u)
    raw = await raw_user(u)
    st = await state(raw)
    if not st["agreement"] and all(st["steps"][s] for s in STEPS[:4]):
        await auto_issue(raw)
    cur = await agreement_for(pid)
    hist = await db.gp_agreements.find({"partner_id": pid, "status": "Signed"}, {"_id": 0, "text": 0, "otp_hash": 0}).sort("signed_at", -1).to_list(50)
    pub = await db.gp_agreement_templates.find_one({"status": "published"}, {"_id": 1})
    return {"current": cur, "signed_history": hist, "signing_method": "Email one-time code (clickwrap)", "template_published": bool(pub)}


async def own_agreement(aid, u):
    a = await db.gp_agreements.find_one({"id": aid})
    if not a or (a["partner_id"] != uid(u) and normalize_role(u.get("role", "")) != "admin"):
        raise HTTPException(404, "Agreement not found")
    return a


@router.get("/agreement/{aid}/pdf")
async def agreement_pdf(aid: str, u: dict = Depends(get_current_user)):
    a = await own_agreement(aid, u)
    if a.get("signed_pdf_id"):
        data = await (await BUCKET().open_download_stream(ObjectId(a["signed_pdf_id"]))).read()
        name = f"Bankezee_GP_Agreement_{a['partner_code']}_v{a['version']}_signed.pdf"
    else:
        data, name = pdf(a["text"], title=a["title"]), f"Bankezee_GP_Agreement_{a['partner_code']}_v{a['version']}.pdf"
    return Response(data, media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{name}"'})


@router.post("/agreement/{aid}/send-code")
async def send_code(aid: str, u: dict = Depends(require_gp)):
    from utils.email_service import send_email
    a = await own_agreement(aid, u)
    if a["status"] == "Signed":
        return {"status": "Signed"}
    code = f"{secrets.randbelow(1000000):06d}"
    await db.gp_agreements.update_one({"id": aid}, {"$set": {"status": "Signing in Progress", "otp_hash": hashlib.sha256(code.encode()).hexdigest(),
                                                            "otp_exp": (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat(), "otp_attempts": 0}})
    ok = await send_email(u["email"], "Your Bankezee agreement signing code",
                          f"<p>Your code to sign the Bankezee Growth Partner Agreement (v{a['version']}) is <b style='font-size:20px'>{code}</b>.</p><p>It expires in 10 minutes. Do not share it.</p>")
    masked = re.sub(r"(^.).*(@.*$)", r"\1•••\2", u["email"])
    if ok:
        await db.gp_agreements.update_one({"id": aid}, {"$set": {"otp_delivery": "email"}})
        return {"sent_to": masked, "delivery": "email"}
    import os
    if not await email_ready() and os.environ.get("GP_SIGNING_CODE_ON_SCREEN", "").lower() == "true":
        await db.gp_agreements.update_one({"id": aid}, {"$set": {"otp_delivery": "on_screen"}})
        return {"sent_to": masked, "delivery": "on_screen", "preview_code": code}
    await db.gp_agreements.update_one({"id": aid}, {"$set": {"status": "Action Required"}})
    raise HTTPException(400, "Could not send the signing code email (email service unavailable) — try again later or contact support")


class Sign(BaseModel):
    code: str
    accept: bool


@router.post("/agreement/{aid}/sign")
async def sign(aid: str, inp: Sign, request: Request, u: dict = Depends(require_gp)):
    a = await own_agreement(aid, u)
    if a["status"] == "Signed":
        return {"status": "Signed", "already": True}
    if not inp.accept:
        raise HTTPException(400, "Tick the acceptance checkbox")
    if not a.get("otp_hash") or a.get("otp_exp", "") < now():
        await db.gp_agreements.update_one({"id": aid}, {"$set": {"status": "Action Required"}})
        raise HTTPException(400, "Code expired — request a new code")
    if (a.get("otp_attempts") or 0) >= 5:
        raise HTTPException(429, "Too many attempts — request a new code")
    if hashlib.sha256(inp.code.strip().encode()).hexdigest() != a["otp_hash"]:
        await db.gp_agreements.update_one({"id": aid}, {"$inc": {"otp_attempts": 1}})
        raise HTTPException(400, "Incorrect code")
    claim = await db.gp_agreements.find_one_and_update({"id": aid, "status": {"$ne": "Signed"}, "signing_lock": {"$ne": True}}, {"$set": {"signing_lock": True}})
    if not claim:
        return {"status": "Signed", "already": True}
    txn = "BZ-GPA-" + uuid.uuid4().hex[:10].upper()
    signed_at = now()
    doc_hash = hashlib.sha256(a["text"].encode()).hexdigest()
    ev = {"Signer name": u.get("name"), "Partner ID": a["partner_code"], "Signer email (code sent to)": u.get("email"), "Registered mobile": u.get("phone"),
          "Signing method": "Clickwrap acceptance + " + ("one-time code shown in session (email not configured)" if a.get("otp_delivery") == "on_screen" else "email one-time code"), "Timestamp (UTC)": signed_at,
          "IP address": request.headers.get("x-forwarded-for", request.client.host if request.client else "").split(",")[0].strip(),
          "User agent": request.headers.get("user-agent", "")[:160], "Transaction ID": txn, "Agreement version": a["version"], "Document SHA-256": doc_hash}
    data = pdf(a["text"], ev, title=a["title"])
    gid = await BUCKET().upload_from_stream(f"agreement_{a['partner_code']}_v{a['version']}.pdf", data, metadata={"partner_id": a["partner_id"], "content_type": "application/pdf", "kind": "signed_agreement"})
    await db.gp_agreements.update_one({"id": aid}, {"$set": {"status": "Signed", "signed_at": signed_at, "signed_pdf_id": str(gid), "txn_ref": txn, "evidence": ev,
                                                            "signed_pdf_sha256": hashlib.sha256(data).hexdigest()}, "$unset": {"otp_hash": "", "signing_lock": ""}})
    return {"status": "Signed", "txn_ref": txn}


# ---------------- card & certificate ----------------
@router.get("/certificate.pdf")
async def certificate(u: dict = Depends(require_gp)):
    import pymupdf
    import qrcode
    raw = await raw_user(u)
    st = await state(raw)
    if st["status"] != "Active":
        raise HTTPException(403, "The certificate is available once your partnership is active")
    doc = pymupdf.open()
    pg = doc.new_page(width=842, height=595)
    pg.draw_rect(pg.rect, color=(0.19, 0.7, 0.29), width=10)
    pg.draw_rect(pymupdf.Rect(28, 28, 814, 567), color=(0.17, 0.17, 0.17), width=0.8)
    pg.insert_textbox(pymupdf.Rect(60, 70, 782, 120), "CERTIFICATE OF PARTNERSHIP", fontsize=28, fontname="hebo", align=1, color=(0.17, 0.17, 0.17))
    pg.insert_textbox(pymupdf.Rect(60, 140, 782, 170), "This is to certify that", fontsize=13, align=1)
    pg.insert_textbox(pymupdf.Rect(60, 180, 782, 225), st["profile"].get("entity_name") or st["name"], fontsize=26, fontname="hebo", align=1, color=(0.19, 0.6, 0.27))
    pg.insert_textbox(pymupdf.Rect(80, 240, 762, 300), f"is an authorised Growth Partner of {COMPANY['brand']} ({COMPANY['name']}).", fontsize=13, align=1)
    issued = str(raw.get("gp_activated_at") or raw.get("created_at") or now())[:10]
    pg.insert_textbox(pymupdf.Rect(80, 330, 600, 400), f"Partner ID: {st['partner_id']}\nIssued on: {issued}", fontsize=12)
    img = io.BytesIO()
    qrcode.make(f"https://connect.bankezee.com/r/{st['partner_id']}").save(img, format="PNG")
    pg.insert_image(pymupdf.Rect(660, 320, 760, 420), stream=img.getvalue())
    pg.insert_textbox(pymupdf.Rect(640, 425, 780, 445), "Scan to refer a customer", fontsize=8, align=1)
    return Response(doc.tobytes(), media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="Bankezee_Partner_Certificate_{st["partner_id"]}.pdf"'})


# ---------------- admin partner review ----------------
@router.get("/admin/partners")
async def admin_partners(_: dict = Depends(require_admin_only)):
    out = []
    async for p in db.users.find({"role": {"$in": ["growth_partner", "telecaller", "sales_agent", "partner"]}}, {"password": 0, "password_hash": 0, "plain_password": 0}).limit(3000):
        s = await state(p)
        out.append({k: s[k] for k in ("partner_id", "user_id", "name", "mobile", "email", "status", "kyc", "steps", "agreement", "legacy_partner")} | {"reg_type": s["profile"].get("reg_type")})
    return out


class KycDecision(BaseModel):
    status: str
    note: Optional[str] = None


@router.post("/admin/partners/{pid}/kyc/{item}")
async def kyc_decide(pid: str, item: str, inp: KycDecision, u: dict = Depends(require_admin_only)):
    if inp.status not in ("Verified", "Action Required"):
        raise HTTPException(400, "Status must be Verified or Action Required")
    if inp.status == "Action Required" and not inp.note:
        raise HTTPException(400, "Tell the partner what to correct")
    if item not in KYC_ITEMS["business"]:
        raise HTTPException(404, "Unknown KYC item")
    ors = [{"id": pid}, {"partner_code": pid}] + ([{"_id": ObjectId(pid)}] if ObjectId.is_valid(pid) else [])
    p = await db.users.find_one({"$or": ors}, {"gp_kyc": 1})
    if not p:
        raise HTTPException(404, "Partner not found")
    if not ((p.get("gp_kyc") or {}).get(item) or {}).get("doc_id"):
        raise HTTPException(400, "This document hasn't been submitted yet")
    r = await db.users.update_one({"_id": p["_id"]}, {"$set": {f"gp_kyc.{item}.status": inp.status, f"gp_kyc.{item}.note": inp.note,
                                                                                       f"gp_kyc.{item}.reviewed_by": u.get("name"), f"gp_kyc.{item}.reviewed_at": now()}})
    if not r.matched_count:
        raise HTTPException(404, "Partner not found")
    return {"ok": True}
