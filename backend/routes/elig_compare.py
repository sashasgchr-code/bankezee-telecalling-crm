"""Calculator vs actual bank eligibility: comparisons, reasons, controlled learning (admin-approved policy versions)."""
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from utils.database import db
from utils.auth import get_current_user, require_admin
from routes import elig_engine as eng
from routes.doc_extract import current_fd, _authorize

router = APIRouter(prefix="/api/elig-compare", tags=["Eligibility Comparison"])
CMP, PROP = db.elig_comparisons, db.policy_proposals
FIELDS = [("status", "Eligibility status"), ("amount", "Total loan amount"), ("bt_amount", "BT amount"), ("additional", "Additional amount"),
          ("roi", "Interest rate"), ("tenure", "Tenure"), ("emi", "EMI"), ("retained", "Retained obligations"), ("foir", "FOIR")]
TOL = {"amount": 0.02, "bt_amount": 0.02, "additional": 0.05, "emi": 0.03, "retained": 0.03, "roi": 0.25, "tenure": 0, "foir": 2}
VERIFIED = {"bank_email_portal", "sanction_letter", "final_disbursal"}


def _now():
    return datetime.now(timezone.utc).isoformat()


class BankResult(BaseModel):
    bank_name: str
    status: str  # Eligible | Not Eligible | Pending
    amount: Optional[float] = None
    bt_amount: Optional[float] = None
    bt_accounts: Optional[list] = None
    additional: Optional[float] = None
    roi: Optional[float] = None
    tenure: Optional[int] = None
    emi: Optional[float] = None
    foir: Optional[float] = None
    retained: Optional[float] = None
    decision_date: Optional[str] = None
    source: str = "processor_estimate"  # processor_estimate | bank_verbal | bank_email_portal | sanction_letter | final_disbursal
    reference: Optional[str] = None
    remarks: Optional[str] = None


STATUS = {"eligible": "Eligible", "possibly_eligible": "Needs Review", "not_eligible": "Not Eligible"}


async def _calc(scope, ref_id, bank_name, policy_override: Optional[dict] = None):
    """Same authoritative calculation the Check Eligibility page shows (analyze_eligibility), for one bank."""
    import re
    from routes.bank_policies import analyze_eligibility
    if scope == "meta":
        from routes.meta_compat import build_connect_file
        c = build_connect_file(await db.meta_leads.find_one({"lead_id": ref_id}, {"_id": 0}))
        lead = {"file_details": await current_fd(scope, ref_id), "full_name": c["name"], "name": c["name"],
                "requirement": c["requirement"], "eligibilities": c["eligibilities"]}
    else:
        lead = await db.leads.find_one({"id": ref_id}, {"_id": 0})
    pols = await db.bank_policies.find({"is_active": True, "bank_name": re.compile(f"^{re.escape(bank_name)}$", re.I)}, {"_id": 0}).to_list(20)
    if policy_override and pols:
        pols = [{**pols[0], **policy_override}]
    if not lead or not pols:
        return None, None
    res = await analyze_eligibility(lead, ref_id, "Comparison", policies_override=pols)
    r = (res.get("results") or [None])[0]
    if not r:
        return None, res["engine_meta"]["inputs_hash"]
    return {**r["calc"], "status": STATUS.get(r["eligibility"], r["eligibility"])}, res["engine_meta"]["inputs_hash"]


def _calc_view(b):
    if not b:
        return {}
    return {"status": b["status"], "amount": b.get("proposed_amount"), "bt_amount": b.get("bt_outstanding"), "additional": b.get("additional_amount"),
            "roi": b.get("roi"), "tenure": b.get("tenure"), "emi": b.get("proposed_emi"), "retained": b.get("retained_obligations"),
            "foir": b.get("post_bt_foir"), "bt_accounts": [a["lender"] for a in b.get("accounts") or [] if a["bt"] == "Selected for BT"]}


def compare(calc: dict, bank: dict) -> list:
    rows = []
    for k, lbl in FIELDS:
        c, m = calc.get(k), bank.get(k)
        if c is None or m is None:
            rows.append({"field": k, "label": lbl, "calculator": c, "bank": m, "diff": "Not provided", "mismatch": False})
            continue
        if k == "status":
            mm = m != "Pending" and (c == "Eligible") != (m == "Eligible")
            rows.append({"field": k, "label": lbl, "calculator": c, "bank": m, "diff": "Different" if mm else "Same", "mismatch": mm,
                         "flag": ("Calculator eligible, bank rejected" if c == "Eligible" else "Calculator rejected, bank eligible") if mm else None})
            continue
        d = round(m - c, 2)
        rel = abs(d) / abs(c) if c else (1 if d else 0)
        mm = (abs(d) > TOL[k]) if k in ("roi", "tenure", "foir") else rel > TOL[k]
        unit = " pp" if k in ("roi", "foir") else " months" if k == "tenure" else ""
        rows.append({"field": k, "label": lbl, "calculator": c, "bank": m, "mismatch": mm,
                     "diff": f"{d:+,.2f}{unit}" + (f" ({rel * 100:+.1f}%)" if k in ("amount", "bt_amount", "emi", "retained", "additional") else "")})
    ca, ba = set(calc.get("bt_accounts") or []), set(bank.get("bt_accounts") or [])
    if bank.get("bt_accounts") is not None:
        rows.append({"field": "bt_accounts", "label": "Selected BT accounts", "calculator": sorted(ca), "bank": sorted(ba),
                     "diff": "Same" if ca == ba else "Different loans selected for BT", "mismatch": ca != ba})
    return rows


@router.post("/{scope}/{ref_id}/bank-result")
async def save_bank_result(scope: str, ref_id: str, inp: BankResult, user: dict = Depends(get_current_user)):
    await _authorize(scope, ref_id, user)
    prior = await CMP.find_one({"scope": scope, "ref_id": ref_id, "bank": inp.bank_name.lower()}, {"_id": 0})
    b, h = await _calc(scope, ref_id, inp.bank_name)
    snap = prior["calculator"] if prior else {**_calc_view(b), "inputs_hash": h, "policy_version": (b or {}).get("policy_version"), "at": _now(), "raw": b}
    bank = inp.model_dump()
    rows = compare(snap, bank)
    mism = [r["field"] for r in rows if r["mismatch"]]
    doc = {"scope": scope, "ref_id": ref_id, "bank": inp.bank_name.lower(), "bank_name": inp.bank_name, "calculator": snap, "bank_result": bank,
           "rows": rows, "mismatches": mism, "verified": inp.source in VERIFIED, "inputs_changed": snap.get("inputs_hash") != h,
           "status": "matched" if not mism else "reason_pending", "updated_at": _now(), "updated_by": user.get("name")}
    hist = {"at": _now(), "by": user.get("name"), "bank_result": bank}
    await CMP.update_one({"scope": scope, "ref_id": ref_id, "bank": doc["bank"]},
                         {"$set": doc, "$setOnInsert": {"id": uuid.uuid4().hex, "created_at": _now(), "reasons": []}, "$push": {"history": hist}}, upsert=True)
    return await CMP.find_one({"scope": scope, "ref_id": ref_id, "bank": doc["bank"]}, {"_id": 0})


@router.get("/{scope}/{ref_id}")
async def list_for_file(scope: str, ref_id: str, user: dict = Depends(get_current_user)):
    await _authorize(scope, ref_id, user)
    return await CMP.find({"scope": scope, "ref_id": ref_id}, {"_id": 0, "history": 0}).to_list(100)


class Reason(BaseModel):
    field: str
    reason: str
    explanation: Optional[str] = None
    kind: str  # customer_correction | customer_exception | policy_change | calculator_defect
    corrected_value: Optional[str] = None
    evidence: Optional[str] = None
    effective_date: Optional[str] = None
    policy_patch: Optional[dict] = None


class Reasons(BaseModel):
    items: list[Reason]


@router.post("/comparison/{cmp_id}/reasons")
async def add_reasons(cmp_id: str, inp: Reasons, user: dict = Depends(get_current_user)):
    c = await CMP.find_one({"id": cmp_id}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Comparison not found")
    await _authorize(c["scope"], c["ref_id"], user)
    items = []
    for r in inp.items:
        if r.reason == "Other" and not r.explanation:
            raise HTTPException(status_code=422, detail="'Other' needs an explanation")
        it = {**r.model_dump(), "id": uuid.uuid4().hex, "by": user.get("name"), "at": _now()}
        if r.kind == "policy_change" or r.policy_patch:
            pol = await db.bank_policies.find_one({"bank_name": {"$regex": f"^{c['bank_name']}$", "$options": "i"}}, {"_id": 0})
            if not pol or not r.policy_patch:
                raise HTTPException(status_code=422, detail="Policy change needs the bank policy and the proposed rule values")
            pid = uuid.uuid4().hex
            await PROP.insert_one({"id": pid, "policy_id": pol["id"], "bank_name": pol["bank_name"], "existing": {k: pol.get(k) for k in r.policy_patch},
                                   "proposed": r.policy_patch, "evidence": r.evidence, "explanation": r.explanation, "effective_date": r.effective_date,
                                   "comparison_ids": [cmp_id], "verified_source": c["verified"], "status": "pending", "by": user.get("name"), "at": _now()})
            it["proposal_id"] = pid
        if r.kind == "calculator_defect":
            await db.calc_issues.insert_one({"id": uuid.uuid4().hex, "comparison_id": cmp_id, "input": c["calculator"].get("raw"), "expected": c["bank_result"],
                                             "actual": {k: v for k, v in c["calculator"].items() if k != "raw"}, "note": r.explanation, "status": "open", "at": _now()})
        items.append(it)
    reasons = (c.get("reasons") or []) + items
    covered = {x["field"] for x in reasons}
    status = "resolved" if set(c["mismatches"]) <= covered else "reason_pending"
    await CMP.update_one({"id": cmp_id}, {"$set": {"reasons": reasons, "status": status, "updated_at": _now()}})
    return await CMP.find_one({"id": cmp_id}, {"_id": 0, "history": 0})


@router.post("/comparison/{cmp_id}/recalculate")
async def recalc(cmp_id: str, user: dict = Depends(get_current_user)):
    """After a customer-data correction: fresh calculator result vs the same bank result (original snapshot kept)."""
    c = await CMP.find_one({"id": cmp_id}, {"_id": 0})
    await _authorize(c["scope"], c["ref_id"], user)
    b, h = await _calc(c["scope"], c["ref_id"], c["bank_name"])
    rows = compare(_calc_view(b), c["bank_result"])
    resolved = not any(r["mismatch"] for r in rows)
    await CMP.update_one({"id": cmp_id}, {"$set": {"recalculated": {"at": _now(), "rows": rows, "resolved_difference": resolved, "inputs_hash": h}}})
    return {"rows": rows, "resolved_difference": resolved}


@router.post("/proposals/{pid}/replay")
async def replay(pid: str, user: dict = Depends(get_current_user)):
    p = await PROP.find_one({"id": pid}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Proposal not found")
    out = []
    async for c in CMP.find({"bank": p["bank_name"].lower(), "bank_result.status": {"$ne": "Pending"}}, {"_id": 0, "history": 0}):
        before = compare(_calc_view((await _calc(c["scope"], c["ref_id"], c["bank_name"]))[0]), c["bank_result"])
        after = compare(_calc_view((await _calc(c["scope"], c["ref_id"], c["bank_name"], p["proposed"]))[0]), c["bank_result"])
        nb, na = sum(r["mismatch"] for r in before), sum(r["mismatch"] for r in after)
        out.append({"comparison_id": c["id"], "ref_id": c["ref_id"], "verified": c["verified"], "mismatches_before": nb, "mismatches_after": na,
                    "effect": "improved" if na < nb else "worse" if na > nb else "unchanged"})
    conflicts = await PROP.count_documents({"policy_id": p["policy_id"], "status": "approved", "existing": p["proposed"]})
    res = {"cases": out, "improved": sum(o["effect"] == "improved" for o in out), "worse": sum(o["effect"] == "worse" for o in out),
           "conflicting_history": conflicts > 0, "verified_evidence": p.get("verified_source")}
    await PROP.update_one({"id": pid}, {"$set": {"replay": {**res, "at": _now()}}})
    return res


@router.post("/proposals/{pid}/{action}")
async def decide(pid: str, action: str, user: dict = Depends(require_admin)):
    p = await PROP.find_one({"id": pid}, {"_id": 0})
    if not p or p["status"] != "pending":
        raise HTTPException(status_code=409, detail="Proposal is not pending")
    if action == "approve":
        if not p.get("replay"):
            raise HTTPException(status_code=422, detail="Replay the proposal before approving")
        from routes.bank_policies import update_policy
        await update_policy(p["policy_id"], dict(p["proposed"]), user)  # versioned; old version archived for rollback
    elif action != "reject":
        raise HTTPException(status_code=404, detail="Unknown action")
    await PROP.update_one({"id": pid}, {"$set": {"status": "approved" if action == "approve" else "rejected", "decided_by": user.get("name"), "decided_at": _now()}})
    return {"ok": True}


@router.post("/policies/{policy_id}/rollback")
async def rollback(policy_id: str, user: dict = Depends(require_admin)):
    v = await db.bank_policy_versions.find_one({"policy_id": policy_id}, {"_id": 0}, sort=[("archived_at", -1)])
    if not v:
        raise HTTPException(status_code=404, detail="No earlier version")
    from routes.bank_policies import update_policy
    restore = {k: val for k, val in v.items() if k not in ("policy_id", "archived_at", "archived_by", "version", "id")}
    await update_policy(policy_id, restore, user)
    return {"ok": True, "restored_from": v.get("archived_at")}


@router.get("/dashboard")
async def dashboard(user: dict = Depends(get_current_user)):
    cs = await CMP.find({}, {"_id": 0, "history": 0, "calculator.raw": 0}).to_list(5000)
    comp = [c for c in cs if c["bank_result"]["status"] != "Pending"]

    def agree(xs):
        ok = [c for c in xs if not any(r["field"] == "status" and r["mismatch"] for r in c["rows"])]
        return round(len(ok) * 100 / len(xs), 1) if xs else None
    reasons = {}
    for c in cs:
        for r in c.get("reasons") or []:
            k = (c["bank_name"], r["reason"])
            reasons[k] = reasons.get(k, 0) + 1
    props = await PROP.find({}, {"_id": 0}).sort("at", -1).to_list(200)
    return {"comparable": len(comp), "matched": sum(c["status"] == "matched" for c in comp), "unresolved": sum(c["status"] == "reason_pending" for c in comp),
            "agreement_verified": agree([c for c in comp if c["verified"]]), "agreement_estimates": agree([c for c in comp if not c["verified"]]),
            "top_reasons": sorted(({"bank": k[0], "reason": k[1], "count": v} for k, v in reasons.items()), key=lambda x: -x["count"])[:10],
            "comparisons": [{k: c.get(k) for k in ("id", "scope", "ref_id", "bank_name", "status", "mismatches", "verified", "updated_at", "updated_by")}
                            for c in sorted(cs, key=lambda x: x.get("updated_at") or "", reverse=True)[:200]],
            "proposals": props, "pending_proposals": sum(p["status"] == "pending" for p in props)}
