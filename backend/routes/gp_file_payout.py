"""Growth Partner payout on a disbursed Connect CRM File: automatic from the published CSV rate,
or entered / overridden manually by Admin & Ops. One payout record per File (gp_payouts.file_key)."""
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from pymongo.errors import DuplicateKeyError

from utils.database import db
from utils.auth import get_current_user, normalize_role, is_gp_role
from routes.gp_portal import resolve_rate, slug, now, uid

router = APIRouter(prefix="/api/gp/file-payout", tags=["Growth Partner File Payout"])
LOCKED = ("Paid", "Reversed")
PRODUCT_OF = {"business_loan": "BL", "msme_loan": "BL", "lap": "LAP", "gold_loan": "GL", "education_loan": "EL"}


def product_code(loan_type):
    lt = str(loan_type or "").lower()
    if lt in PRODUCT_OF:
        return PRODUCT_OF[lt]
    if lt.startswith("balance_transfer"):
        return "BT"
    if lt.endswith("_pl") or "personal" in lt or lt == "merge_multiple_loans":
        return "PL"
    if lt.endswith("_hl") or "home" in lt:
        return "HL"
    if "vehicle" in lt:
        return "AL"
    return None


async def require_payout_staff(user: dict = Depends(get_current_user)):
    if normalize_role(user.get("role", "")) not in ("admin", "ops"):
        raise HTTPException(403, "Only Admin and Ops can set Growth Partner payouts")
    return user


def gross_of(ptype, pvalue, amount):
    return round(amount * pvalue / 100, 2) if ptype == "percent" else round(float(pvalue), 2)


async def context(fid):
    f = await db.leads.find_one({"id": fid, "status": "file"}, {"_id": 0, "id": 1, "eligibilities": 1, "file_details.type_of_loan": 1, "requirement": 1,
                                                               "gp_referral": 1, "source_id": 1, "file_status": 1})
    if not f:
        raise HTTPException(404, "File not found")
    pid = (f.get("gp_referral") or {}).get("partner_id")
    if not pid and f.get("source_id"):
        o = await db.users.find_one({"id": f["source_id"]}, {"role": 1, "partner_code": 1})
        pid = f["source_id"] if o and is_gp_role(o.get("role", "")) and o.get("partner_code") else None
    partner = await db.users.find_one({"id": pid}, {"_id": 0, "id": 1, "name": 1, "partner_code": 1}) if pid else None
    rows = [e for e in f.get("eligibilities") or [] if isinstance(e, dict) and e.get("disbursed") == "yes" and float(e.get("disbursed_amount") or 0) > 0]
    disb = rows and {"amount": round(sum(float(e["disbursed_amount"]) for e in rows), 2), "date": str(rows[0].get("disbursed_at") or now())[:10],
                     "lender": rows[0].get("disbursed_bank") or rows[0].get("bank_name"), "lender_code": slug(rows[0].get("disbursed_bank") or rows[0].get("bank_name"))}
    return f, partner, disb or None, product_code((f.get("file_details") or {}).get("type_of_loan") or f.get("requirement"))


async def csv_calc(rec, partner, disb, product):
    """CSV calculation: reuse the rate version already applied to this disbursement, else resolve the published rate."""
    snap = (rec or {}).get("calc")
    if snap:
        return {**snap, "disbursed_amount": disb["amount"], "gross": gross_of(snap["payout_type"], snap["payout_value"], disb["amount"])}, None
    if not product:
        return None, "Loan type has no Payout Structure product code"
    rate, err = await resolve_rate(partner["partner_code"], product, disb["lender_code"], disb["date"], disb["amount"])
    if not rate:
        return None, err
    return {"rate_code": rate["rate_code"], "rate_version": rate["version"], "payout_type": rate["payout_type"], "payout_value": rate["payout_value"],
            "disbursed_amount": disb["amount"], "gross": gross_of(rate["payout_type"], rate["payout_value"], disb["amount"])}, None


async def current(fid):
    return await db.gp_payouts.find_one({"file_key": fid}, {"_id": 0})


async def audit(fid, user, message, prev=None, new=None, reason=None):
    entry = {"type": "gp_payout", "message": message, "previous": prev, "new": new, "reason": reason, "by": user.get("id"), "by_name": user.get("name"), "timestamp": now()}
    await db.leads.update_one({"id": fid}, {"$push": {"file_activities": entry}})
    await db.gp_payouts.update_one({"file_key": fid}, {"$push": {"audit": entry}})


def amounts(gross, rec):
    ded = float((rec or {}).get("deductions") or 0)
    return {"gross": gross, "net": round(gross - ded, 2)}


async def upsert(fid, f, partner, disb, product, fields):
    rec = await current(fid)
    if rec:
        await db.gp_payouts.update_one({"file_key": fid}, {"$set": {**fields, "updated_at": now()}})
        return
    doc = {"id": uuid.uuid4().hex[:12], "file_key": fid, "file_id": fid, "kind": "payout", "partner_id": partner["id"], "partner_code": partner["partner_code"],
           "product_code": product or "", "lender_code": disb["lender_code"], "disbursement_date": disb["date"], "disbursed_amount": disb["amount"], "deductions": 0,
           "status": "Under Verification", "reason": None, "payment_date": None, "txn_ref": None, "created_at": now(), "audit": [], **fields}
    try:
        await db.gp_payouts.insert_one(doc)
    except DuplicateKeyError:
        await db.gp_payouts.update_one({"file_key": fid}, {"$set": {**fields, "updated_at": now()}})


async def sync(fid, user=None):
    """Idempotent: create/refresh the automatic payout when a disbursement is recorded; never touches Paid/Reversed amounts."""
    f, partner, disb, product = await context(fid)
    if not partner:
        return
    rec = await current(fid)
    sysu = user or {"id": "system", "name": "System"}
    if not disb:
        if rec and rec["status"] not in LOCKED and not rec.get("needs_review"):
            await db.gp_payouts.update_one({"file_key": fid}, {"$set": {"needs_review": True, "review_note": "Disbursement is no longer recorded on the file"}})
        return
    changed = rec and float(rec.get("disbursed_amount") or 0) != disb["amount"]
    if rec and rec["status"] in LOCKED:
        if changed and not rec.get("needs_review"):
            await db.gp_payouts.update_one({"file_key": fid}, {"$set": {"needs_review": True, "review_note": f"Disbursed amount changed to ₹{disb['amount']:,.0f} after payment — use an adjustment"}})
        return
    if rec and rec.get("source") == "manual":
        if changed:
            await db.gp_payouts.update_one({"file_key": fid}, {"$set": {"needs_review": True, "disbursed_amount": disb["amount"],
                                                                         "review_note": f"Disbursed amount changed from ₹{float(rec.get('disbursed_amount') or 0):,.0f} to ₹{disb['amount']:,.0f} — review the manual payout"}})
            await audit(fid, sysu, "Disbursed amount changed — manual payout flagged for review", rec.get("disbursed_amount"), disb["amount"])
        return
    calc, _ = await csv_calc(rec, partner, disb, product)
    if not calc or (rec and not changed and rec.get("gross") == calc["gross"]):
        return
    prev = rec and rec.get("gross")
    await upsert(fid, f, partner, disb, product, {"source": "csv", "calc": {k: calc[k] for k in ("rate_code", "rate_version", "payout_type", "payout_value")},
                                                  "rate_code": calc["rate_code"], "rate_version": calc["rate_version"], "payout_type": calc["payout_type"],
                                                  "payout_value": calc["payout_value"], "disbursed_amount": disb["amount"], "disbursement_date": disb["date"],
                                                  "needs_review": False, "review_note": None, **amounts(calc["gross"], rec)})
    await audit(fid, sysu, f"Payout calculated from CSV ({calc['rate_code']} v{calc['rate_version']})" + (" — recalculated for new disbursed amount" if rec else ""), prev, calc["gross"])


def safe_sync(fid):
    import asyncio
    import logging

    async def run():
        try:
            await sync(fid)
        except Exception as e:  # never break the file save
            logging.getLogger(__name__).warning(f"GP payout sync failed for {fid}: {e}")
    asyncio.create_task(run())


@router.get("/{fid}")
async def view(fid: str, u: dict = Depends(require_payout_staff)):
    await sync(fid, u)
    f, partner, disb, product = await context(fid)
    rec = await current(fid)
    calc, err = (await csv_calc(rec, partner, disb, product)) if partner and disb else (None, None)
    adj = await db.gp_payouts.find({"file_id": fid, "kind": "adjustment"}, {"_id": 0}).to_list(50)
    return {"is_partner_file": bool(partner), "partner": partner, "disbursement": disb, "product_code": product, "calculation": calc, "calc_error": err,
            "manual_required": bool(partner and disb and not calc and not (rec and rec.get("source") == "manual")), "payout": rec, "adjustments": adj,
            "locked": bool(rec and rec["status"] in LOCKED)}


class Manual(BaseModel):
    mode: str
    value: float
    reason: str


@router.put("/{fid}/manual")
async def manual(fid: str, inp: Manual, u: dict = Depends(require_payout_staff)):
    f, partner, disb, product = await context(fid)
    if not partner:
        raise HTTPException(400, "This file is not attributed to a Growth Partner")
    if not disb:
        raise HTTPException(400, "Record the disbursement (bank, Disbursed = Yes and disbursed amount) before setting a payout")
    if not inp.reason.strip():
        raise HTTPException(400, "Enter a reason for the manual payout")
    if inp.mode not in ("percent", "amount") or inp.value <= 0 or (inp.mode == "percent" and inp.value > 10):
        raise HTTPException(400, "Enter a percentage between 0 and 10, or a payout amount above ₹0")
    rec = await current(fid)
    if rec and rec["status"] in LOCKED:
        raise HTTPException(409, f"This payout is {rec['status']} and locked — use an adjustment instead")
    gross = gross_of("percent", inp.value, disb["amount"]) if inp.mode == "percent" else round(inp.value, 2)
    calc, _ = await csv_calc(rec, partner, disb, product)
    fields = {"source": "manual", "manual": {"mode": inp.mode, "value": inp.value, "reason": inp.reason.strip(), "by": u.get("name"), "at": now()},
              "payout_type": "percent" if inp.mode == "percent" else "fixed", "payout_value": inp.value, "disbursed_amount": disb["amount"],
              "needs_review": False, "review_note": None, **amounts(gross, rec)}
    if calc and not (rec or {}).get("calc"):
        fields["calc"] = {k: calc[k] for k in ("rate_code", "rate_version", "payout_type", "payout_value")}
    await upsert(fid, f, partner, disb, product, fields)
    await audit(fid, u, "Payout entered manually" if not calc else "Calculated payout overridden manually", rec and rec.get("gross"), gross, inp.reason.strip())
    return await view(fid, u)


class Reason(BaseModel):
    reason: Optional[str] = None


@router.post("/{fid}/restore")
async def restore(fid: str, inp: Reason, u: dict = Depends(require_payout_staff)):
    f, partner, disb, product = await context(fid)
    rec = await current(fid)
    if not rec or rec.get("source") != "manual":
        raise HTTPException(400, "There is no manual payout to remove")
    if rec["status"] in LOCKED:
        raise HTTPException(409, f"This payout is {rec['status']} and locked")
    calc, err = await csv_calc(rec, partner, disb, product) if disb else (None, "No disbursement recorded")
    if not calc:
        raise HTTPException(400, f"No CSV rate applies to this file ({err}) — keep the manual payout")
    await db.gp_payouts.update_one({"file_key": fid}, {"$set": {"source": "csv", "rate_code": calc["rate_code"], "rate_version": calc["rate_version"], "payout_type": calc["payout_type"],
                                                                 "payout_value": calc["payout_value"], "disbursed_amount": disb["amount"], "needs_review": False, "review_note": None,
                                                                 "calc": {k: calc[k] for k in ("rate_code", "rate_version", "payout_type", "payout_value")}, **amounts(calc["gross"], rec),
                                                                 "updated_at": now()}, "$unset": {"manual": ""}})
    await audit(fid, u, "Calculated payout restored (manual override removed)", rec.get("gross"), calc["gross"], (inp.reason or "").strip() or None)
    return await view(fid, u)


class Adjustment(BaseModel):
    amount: float
    reason: str


@router.post("/{fid}/adjustment")
async def adjustment(fid: str, inp: Adjustment, u: dict = Depends(require_payout_staff)):
    rec = await current(fid)
    if not rec or rec["status"] != "Paid":
        raise HTTPException(400, "Adjustments are only for a payout that is already Paid — edit the payout instead")
    if not inp.amount or not inp.reason.strip():
        raise HTTPException(400, "Enter a non-zero adjustment amount and a reason")
    doc = {"id": uuid.uuid4().hex[:12], "kind": "adjustment", "file_id": fid, "adjusts": rec["id"], "partner_id": rec["partner_id"], "partner_code": rec["partner_code"],
           "product_code": rec.get("product_code"), "disbursement_date": now()[:10], "disbursed_amount": None, "gross": round(inp.amount, 2), "deductions": 0,
           "net": round(inp.amount, 2), "status": "Under Verification", "reason": None, "deduction_note": f"Adjustment to paid payout {rec['id']}",
           "internal_reason": inp.reason.strip(), "source": "adjustment", "created_by": u.get("name"), "created_at": now()}
    await db.gp_payouts.insert_one(dict(doc))
    await audit(fid, u, f"Payout adjustment of ₹{inp.amount:,.2f} added (original paid payout unchanged)", None, inp.amount, inp.reason.strip())
    return await view(fid, u)


async def ensure_indexes():
    import logging
    try:
        await db.gp_payouts.update_many({"file_id": {"$nin": [None, ""]}, "kind": {"$exists": False}, "status": {"$ne": "Reversed"}, "file_key": {"$exists": False}},
                                        [{"$set": {"file_key": "$file_id", "kind": "payout", "source": "csv",
                                                   "calc": {"rate_code": "$rate_code", "rate_version": "$rate_version", "payout_type": "$payout_type", "payout_value": "$payout_value"}}}])
        await db.gp_payouts.create_index("file_key", unique=True, partialFilterExpression={"file_key": {"$type": "string"}})
    except Exception as e:
        logging.getLogger(__name__).error(f"gp_payouts file_key index: {e}")
