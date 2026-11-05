"""Shared eligibility engine (Connect Files + Meta Files): credit-issue classification, loan seasoning,
bank-by-bank BT selection and FOIR. Pure functions over the canonical file_details.existing_loans list."""
import itertools
import hashlib
import json
from datetime import date, datetime
from typing import Optional

CATS = ["No Issues", "Minor Issues", "Major Issues", "Settlement", "Write Off", "Settlement & Write Off"]
CLOSED = {"closed", "paid", "repaid"}
CC_WORDS = ("credit card", "cc")
APP_WORDS = ("app", "fintech", "digital", "instant")


def f(v) -> Optional[float]:
    try:
        s = str(v).replace(",", "").replace("₹", "").strip()
        return float(s) if s not in ("", "None", "nan") else None
    except (TypeError, ValueError):
        return None


def _d(v) -> Optional[date]:
    if not v:
        return None
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%Y/%m/%d", "%d-%b-%Y", "%d %b %Y", "%b %Y", "%m/%Y"):
        try:
            return datetime.strptime(str(v)[:11].strip(), fmt).date()
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(str(v)[:10]).date()
    except ValueError:
        return None


def kind(loan: dict, policy: Optional[dict] = None) -> str:
    t = str(loan.get("loan_type") or "").lower()
    lender = str(loan.get("bank") or "").lower()
    if loan.get("is_app_loan") or any(a.lower() in lender for a in (policy or {}).get("app_lenders") or []):
        return "app_loan"
    if any(w == t or w in t for w in CC_WORDS):
        return "credit_card"
    if "app" in t:
        return "app_loan"
    if "personal" in t or t in ("pl",):
        return "personal_loan"
    return t.replace(" ", "_") or "unknown"


def completed_months(start: date, as_of: date) -> int:
    m = (as_of.year - start.year) * 12 + as_of.month - start.month
    return m - (1 if as_of.day < start.day else 0)


def seasoning(loan: dict, policy: dict, as_of: date) -> dict:
    order = {"disbursal": ["disbursal_date", "open_date", "sanction_date"], "open": ["open_date", "disbursal_date", "sanction_date"],
             "sanction": ["sanction_date", "open_date", "disbursal_date"]}[policy.get("seasoning_basis") or "disbursal"]
    for i, k in enumerate(order):
        d = _d(loan.get(k))
        if d:
            return {"months": completed_months(d, as_of), "date": d.isoformat(), "source": k,
                    "fallback": i > 0 or not policy.get("seasoning_basis")}
    return {"months": None, "date": None, "source": None, "fallback": False}


def credit_profile(credit: dict) -> dict:
    """INTERNAL screening category. credit = {accounts:[{dpd_months:[YYYY-MM...], bounces:int, status}], enquiries:[{date}], history_available}"""
    accts = credit.get("accounts") or []
    if not credit.get("history_available") and not accts:
        return {"category": None, "assessment": "Needs Review", "reasons": ["Credit history not available — upload a credit report"], "flags": []}
    late = {(a.get("account_ref") or i, m) for i, a in enumerate(accts) for m in (a.get("dpd_months") or [])}
    bounces = sum(int(a.get("bounces") or 0) for a in accts)
    per_month = {}
    for e in {(x.get("date"), x.get("lender"), x.get("type")) for x in credit.get("enquiries") or [] if x.get("date")}:
        k = str(e[0])[:7]
        per_month[k] = per_month.get(k, 0) + 1
    max_enq = max(per_month.values()) if per_month else 0
    st = [str(a.get("status") or "").lower() for a in accts]
    settled = any("settl" in s for s in st) or any(a.get("settled") for a in accts)
    written = any("written" in s or "write" in s for s in st) or any(a.get("written_off") for a in accts)
    sev, reasons = "No Issues", []
    if bounces > 2 or len(late) > 2 or max_enq > 5:
        sev = "Major Issues"
    elif bounces >= 1 or len(late) >= 1 or max_enq == 5:
        sev = "Minor Issues"
    if bounces:
        reasons.append(f"{bounces} confirmed cheque/EMI bounce(s)")
    if late:
        reasons.append(f"{len(late)} distinct late-payment event(s) (account × month with DPD > 0)")
    if max_enq >= 5:
        reasons.append(f"{max_enq} enquiries in {max(per_month, key=per_month.get)}")
    cat = "Settlement & Write Off" if settled and written else "Settlement" if settled else "Write Off" if written else sev
    if settled:
        reasons.append("Settlement reported")
    if written:
        reasons.append("Write-off reported")
    period = credit.get("history_period")
    return {"category": cat, "severity": sev, "assessment": "Needs Review" if credit.get("incomplete") else "Assessed",
            "reasons": reasons or ["No adverse findings in the available data"], "late_events": len(late), "bounces": bounces,
            "max_enquiries_in_month": max_enq, "enquiries_by_month": per_month, "settlement": settled, "write_off": written,
            "history_period": period}


def obligation(loan: dict, policy: dict) -> tuple:
    """Monthly obligation for one account under this bank's rule -> (amount|None, note)."""
    k, out = kind(loan, policy), f(loan.get("outstanding"))
    status = str(loan.get("status") or "active").lower()
    if status in CLOSED and not out:
        return 0.0, "closed — excluded from current obligations"
    if k == "credit_card":
        rule = policy.get("cc_obligation_rule")
        if rule == "pct_outstanding" and policy.get("cc_obligation_pct") is not None and out is not None:
            return round(out * float(policy["cc_obligation_pct"]) / 100, 2), f"{policy['cc_obligation_pct']}% of card outstanding"
        if rule == "emi" and f(loan.get("emi")) is not None:
            return f(loan.get("emi")), "card EMI per bank rule"
        if rule == "none":
            return 0.0, "bank does not count card balances"
        return None, "credit card obligation rule missing in bank policy"
    emi = f(loan.get("emi"))
    return (emi, "reported EMI") if emi is not None else (None, f"EMI unavailable for {loan.get('bank') or 'loan'}")


def emi_for(p: float, roi: float, n: int) -> float:
    r = roi / 1200
    return round(p * r * (1 + r) ** n / ((1 + r) ** n - 1), 2) if r else round(p / n, 2)


def principal_for(emi: float, roi: float, n: int) -> float:
    r = roi / 1200
    return round(emi * ((1 + r) ** n - 1) / (r * (1 + r) ** n), 2) if r else round(emi * n, 2)


def evaluate_bank(profile: dict, loans: list, policy: dict, credit: dict, as_of: date) -> dict:
    name = policy.get("bank_name")
    reasons, missing, notes = [], [], []
    sal = profile.get("net_salary")
    max_foir = f(policy.get("max_foir"))
    roi = f(policy.get("roi_min")) or f(policy.get("roi_max"))
    tenure = int(f(policy.get("max_tenure")) or 0) or None
    if not sal:
        missing.append("Net monthly salary")
    for k, lbl in ((max_foir, "Maximum FOIR"), (roi, "Interest rate"), (tenure, "Maximum tenure")):
        if not k:
            missing.append(f"Bank policy: {lbl}")
    if policy.get("min_salary") and sal and sal < f(policy["min_salary"]):
        reasons.append(f"Net salary ₹{sal:,.0f} below bank minimum ₹{f(policy['min_salary']):,.0f}")
    cib = profile.get("cibil_score")
    if policy.get("min_cibil") and cib is not None and cib < int(policy["min_cibil"]):
        reasons.append(f"CIBIL {cib} below bank minimum {policy['min_cibil']}")
    if policy.get("min_cibil") and cib is None:
        missing.append("CIBIL score")
    if credit.get("settlement") and policy.get("settlement_allowed") is False:
        reasons.append("Settlement found; this bank's policy does not permit settlement")
    if credit.get("write_off") and policy.get("writeoff_allowed") is False:
        reasons.append("Write-off found; this bank's policy does not permit write-off")
    if policy.get("max_enquiries_month") is not None and credit.get("max_enquiries_in_month", 0) > int(policy["max_enquiries_month"]):
        reasons.append(f"{credit['max_enquiries_in_month']} enquiries in a month; bank allows {policy['max_enquiries_month']}")
    if policy.get("max_dpd_events") is not None and credit.get("late_events", 0) > int(policy["max_dpd_events"]):
        reasons.append(f"{credit['late_events']} late-payment events; bank allows {policy['max_dpd_events']}")
    rows, total_obl = [], 0.0
    bt_types = set(policy.get("bt_loan_types") or (["personal_loan"] if policy.get("bt_allowed") else []))
    if policy.get("app_loan_bt"):
        bt_types.add("app_loan")
    if policy.get("cc_bt_allowed"):
        bt_types.add("credit_card")
    min_season = f(policy.get("min_loan_seasoning_months"))
    for i, l in enumerate(loans):
        k = kind(l, policy)
        amt, note = obligation(l, policy)
        se = seasoning(l, policy, as_of)
        row = {"idx": i, "lender": l.get("bank"), "type": k, "outstanding": f(l.get("outstanding")), "obligation": amt, "note": note,
               "seasoning": se, "bt": "Retained", "bt_reason": None}
        if amt is None:
            missing.append(note)
        elif amt == 0 and "closed" in note:
            row["bt"] = "Excluded"
            row["bt_reason"] = note
        total_obl += amt or 0
        if k == "app_loan" and policy.get("app_loan_disqualifies"):
            reasons.append("Bank policy: any app loan makes the applicant ineligible")
        if row["bt"] != "Excluded":
            if not policy.get("bt_allowed"):
                row["bt_reason"] = "Bank does not allow BT"
            elif k not in bt_types:
                row["bt_reason"] = f"{k.replace('_', ' ')} not eligible for BT with this bank — retained as obligation"
            elif not row["outstanding"]:
                row["bt_reason"] = "No current outstanding"
            elif min_season is not None and se["months"] is None:
                row.update(bt="Needs Review", bt_reason="Seasoning date unknown — kept obligated")
            elif min_season is not None and se["months"] < min_season:
                row["bt_reason"] = f"Cannot be transferred: {se['months']} completed months; bank requires {int(min_season)}"
            elif policy.get("min_emis_paid") and l.get("emis_paid") is None:
                row.update(bt="Needs Review", bt_reason=f"Bank requires {policy['min_emis_paid']} EMIs paid — payment history not verified")
            elif policy.get("min_emis_paid") and int(l["emis_paid"]) < int(policy["min_emis_paid"]):
                row["bt_reason"] = f"{l['emis_paid']} EMIs paid; bank requires {policy['min_emis_paid']}"
            elif amt is None:
                row.update(bt="Needs Review", bt_reason="EMI unknown")
            else:
                row["bt"] = "Candidate"
        rows.append(row)
    existing_foir = round(total_obl * 100 / sal, 1) if sal and not missing else None
    if policy.get("pre_bt_max_foir") and existing_foir is not None and existing_foir > f(policy["pre_bt_max_foir"]):
        reasons.append(f"Existing FOIR {existing_foir}% exceeds bank pre-BT limit {policy['pre_bt_max_foir']}%")
    result = {"bank_name": name, "policy_id": policy.get("id"), "policy_version": policy.get("version") or policy.get("updated_at"),
              "existing_obligations": round(total_obl, 2), "existing_foir": existing_foir, "max_foir": max_foir, "roi": roi,
              "tenure": tenure, "accounts": rows, "missing": sorted(set(missing)), "reasons": reasons, "notes": notes}
    if missing:
        result.update(status="Needs Review")
        return result
    max_amt = f(policy.get("max_loan_amount"))
    cands = [r for r in rows if r["bt"] == "Candidate"]
    max_bt = int(policy.get("max_bt_count") or len(cands) or 0)
    best = None
    for n in range(min(max_bt, len(cands)), -1, -1):
        for combo in itertools.combinations(cands, n):
            bt_out = sum(r["outstanding"] for r in combo)
            retained = total_obl - sum(r["obligation"] for r in combo)
            cap_emi = sal * max_foir / 100 - retained
            if cap_emi <= 0 or (max_amt and bt_out > max_amt):
                continue
            new_emi = emi_for(bt_out, roi, tenure) if bt_out else 0
            if new_emi > cap_emi + 0.5:
                continue
            if not best or bt_out > best[0]:
                best = (bt_out, combo, retained, cap_emi, new_emi)
    if not best:
        retained = total_obl
        cap = sal * max_foir / 100 - retained
        reasons.append(f"No BT combination fits: retained obligations ₹{retained:,.0f} leave ₹{max(cap, 0):,.0f}/month capacity at {max_foir}% FOIR")
        result.update(status="Not Eligible", retained_obligations=round(retained, 2))
        return result
    bt_out, combo, retained, cap_emi, new_emi = best
    for r in combo:
        r["bt"] = "Selected for BT"
    for r in cands:
        if r["bt"] == "Candidate":
            r.update(bt="Retained", bt_reason="Eligible but not selected (BT count / FOIR / amount limit)")
    max_eligible = principal_for(cap_emi, roi, tenure)
    if max_amt:
        max_eligible = min(max_eligible, max_amt)
    extra = max(0.0, max_eligible - bt_out) if policy.get("additional_cash_allowed", policy.get("topup_allowed")) else None
    proposed = bt_out if bt_out else max_eligible
    p_emi = emi_for(proposed, roi, tenure) if proposed else 0
    post = round((retained + p_emi) * 100 / sal, 1)
    if post > max_foir + 0.05:
        reasons.append(f"Post-BT FOIR is {post}%; maximum permitted is {max_foir}%")
    if policy.get("min_loan_amount") and proposed < f(policy["min_loan_amount"]):
        reasons.append(f"Proposed amount ₹{proposed:,.0f} below bank minimum ₹{f(policy['min_loan_amount']):,.0f}")
    for r in rows:
        if r["bt"] == "Retained" and r["type"] == "app_loan" and r["obligation"]:
            notes.append(f"App loan retained as obligation: ₹{r['obligation']:,.0f}/month")
        if r["bt"] == "Retained" and r["type"] == "credit_card" and r["obligation"]:
            notes.append(f"Credit card retained using bank policy ({r['note']}): ₹{r['obligation']:,.0f}/month")
    result.update(status="Not Eligible" if reasons else ("Needs Review" if any(r["bt"] == "Needs Review" for r in rows) else "Eligible"),
                  bt_selected=[r["idx"] for r in combo], bt_outstanding=round(bt_out, 2), proposed_amount=round(proposed, 2),
                  proposed_emi=p_emi, retained_obligations=round(retained, 2), post_bt_foir=post, max_eligible_amount=round(max_eligible, 2),
                  additional_amount=None if extra is None else round(extra, 2),
                  assumptions=["Indicative rate (bank minimum ROI) and reported outstanding; foreclosure balances unverified"])
    return result


def profile_from(fd: dict, extraction: Optional[dict] = None) -> dict:
    ex = extraction or {}
    sal = f(fd.get("net_salary"))
    cib = f(fd.get("cibil_score"))
    return {"net_salary": sal, "salary_basis": fd.get("salary_basis") or ("Latest payslip net salary" if ex.get("payslips") else "Entered on file"),
            "company_name": fd.get("company_name"), "cibil_score": int(cib) if cib else None,
            "monthly_emi_obligations": f(fd.get("monthly_emi_obligations"))}


def inputs_hash(fd: dict, policies: list) -> str:
    keys = {k: fd.get(k) for k in ("net_salary", "cibil_score", "existing_loans", "company_name", "credit_analysis")}
    pol = [(p.get("id"), p.get("updated_at"), p.get("version")) for p in policies]
    return hashlib.sha256(json.dumps([keys, pol], default=str, sort_keys=True).encode()).hexdigest()[:16]


def run(fd: dict, policies: list, as_of: Optional[date] = None) -> dict:
    as_of = as_of or date.today()
    loans = [x for x in (fd.get("existing_loans") or []) if isinstance(x, dict)]
    prof = profile_from(fd)
    credit = credit_profile(fd.get("credit_analysis") or {})
    base_obl = sum((obligation(x, {"cc_obligation_rule": "emi"})[0] or 0) for x in loans if kind(x) != "credit_card")
    prof["existing_foir"] = round(base_obl * 100 / prof["net_salary"], 1) if prof["net_salary"] else None
    prof["obligations_from_loans"] = round(base_obl, 2)
    banks = [evaluate_bank(prof, loans, p, credit, as_of) for p in policies if p.get("is_active", True)]
    return {"as_of": as_of.isoformat(), "profile": prof, "credit": credit, "banks": banks, "inputs_hash": inputs_hash(fd, policies),
            "engine_version": "2026.11-bt1"}
