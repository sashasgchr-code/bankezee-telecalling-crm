"""Shared eligibility engine (Connect Files + Meta Files): credit-issue classification, loan seasoning,
bank-by-bank BT selection and FOIR. Pure functions over the canonical file_details.existing_loans list."""
import itertools
import hashlib
import json
import re
from datetime import date, datetime
from typing import Optional

CATS = ["No Issues", "Minor Issues", "Major Issues", "Settlement", "Write Off", "Settlement & Write Off"]
CAT_CODE = {"No Issues": "no_issues", "Minor Issues": "minor_issues", "Major Issues": "major_issues", "Settlement": "settlement",
            "Write Off": "write_off", "Settlement & Write Off": "settlement"}
CODE_CAT = {"no_issues": "No Issues", "minor_issues": "Minor Issues", "major_issues": "Major Issues", "settlement": "Settlement", "write_off": "Write Off"}
CLOSED = {"closed", "paid", "repaid", "settled & closed"}
CC_WORDS = ("credit card", "cc")


def f(v) -> Optional[float]:
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    m = re.search(r"-?\d+(?:\.\d+)?", str(v or "").replace(",", "").replace("₹", ""))
    return float(m.group(0)) if m else None


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


def is_closed(loan: dict) -> bool:
    s = str(loan.get("status") or "active").lower()
    return (s in CLOSED or "closed" in s) and not f(loan.get("outstanding"))


def completed_months(start: date, as_of: date) -> int:
    m = (as_of.year - start.year) * 12 + as_of.month - start.month
    return m - (1 if as_of.day < start.day else 0)


def seasoning(loan: dict, policy: dict, as_of: date) -> dict:
    order = {"disbursal": ["disbursal_date", "open_date", "sanction_date"], "open": ["open_date", "disbursal_date", "sanction_date"],
             "sanction": ["sanction_date", "open_date", "disbursal_date"]}.get(policy.get("seasoning_basis") or "disbursal")
    for i, k in enumerate(order):
        d = _d(loan.get(k))
        if d:
            return {"months": completed_months(d, as_of), "date": d.isoformat(), "source": k,
                    "fallback": i > 0 or not policy.get("seasoning_basis")}
    return {"months": None, "date": None, "source": None, "fallback": False}


def credit_profile(credit: dict, manual_code: Optional[str] = None) -> dict:
    """INTERNAL screening category. credit = {accounts:[{dpd_months:[YYYY-MM...], bounces:int, status}], enquiries:[{date}], history_available}"""
    accts = credit.get("accounts") or []
    if not credit.get("history_available") and not accts:
        if manual_code in CODE_CAT:
            return {"category": CODE_CAT[manual_code], "assessment": "Entered on file", "events": [], "flags": [],
                    "reasons": ["Category entered on file — no credit report details available to verify it"]}
        return {"category": None, "assessment": "Needs Review", "reasons": ["Credit history not available — upload a credit report"], "flags": [], "events": []}
    events = sorted({(a.get("lender") or "?", a.get("account_ref") or str(i), m) for i, a in enumerate(accts) for m in (a.get("dpd_months") or [])},
                    key=lambda x: x[2])
    bounces = sum(int(f(a.get("bounces")) or 0) for a in accts)
    per_month = {}
    for e in {(x.get("date"), x.get("lender"), x.get("type")) for x in credit.get("enquiries") or [] if x.get("date")}:
        k = str(e[0])[:7]
        per_month[k] = per_month.get(k, 0) + 1
    max_enq = max(per_month.values()) if per_month else 0
    st = [str(a.get("status") or "").lower() for a in accts]
    settled_acc = [a.get("lender") for a, s in zip(accts, st) if "settl" in s or a.get("settled")]
    written_acc = [a.get("lender") for a, s in zip(accts, st) if "written" in s or "write" in s or a.get("written_off")]
    sev, reasons = "No Issues", []
    if bounces > 2 or len(events) > 2 or max_enq > 5:
        sev = "Major Issues"
    elif bounces >= 1 or len(events) >= 1 or max_enq == 5:
        sev = "Minor Issues"
    if bounces:
        reasons.append(f"{bounces} confirmed cheque/EMI bounce(s) stated in the documents")
    if events:
        reasons.append(f"{len(events)} late-payment event(s): " + ", ".join(f"{e[0]} {e[2]}" for e in events[:12]) + (" …" if len(events) > 12 else ""))
    if max_enq >= 5:
        reasons.append(f"{max_enq} enquiries in {max(per_month, key=per_month.get)}")
    cat = "Settlement & Write Off" if settled_acc and written_acc else "Settlement" if settled_acc else "Write Off" if written_acc else sev
    if settled_acc:
        reasons.append("Settlement reported: " + ", ".join(sorted(set(map(str, settled_acc)))))
    if written_acc:
        reasons.append("Write-off reported: " + ", ".join(sorted(set(map(str, written_acc)))))
    return {"category": cat, "severity": sev, "assessment": "Needs Review" if credit.get("incomplete") else "Assessed",
            "reasons": reasons or ["No adverse findings in the available data"], "late_events": len(events), "bounces": bounces,
            "events": [{"lender": e[0], "account": e[1], "month": e[2]} for e in events],
            "max_enquiries_in_month": max_enq, "enquiries_by_month": per_month, "settlement": bool(settled_acc), "write_off": bool(written_acc),
            "history_period": credit.get("history_period"), "report_date": credit.get("report_date")}


def obligation(loan: dict, policy: dict) -> tuple:
    """Monthly obligation for one account under this bank's rule -> (amount|None, note)."""
    k, out = kind(loan, policy), f(loan.get("outstanding"))
    if is_closed(loan):
        return 0.0, "closed — excluded from current obligations"
    if k == "credit_card":
        rule = policy.get("cc_obligation_rule")
        if rule == "pct_outstanding" and f(policy.get("cc_obligation_pct")) is not None and out is not None:
            return round(out * f(policy["cc_obligation_pct"]) / 100, 2), f"{policy['cc_obligation_pct']}% of card outstanding"
        if rule == "emi" and f(loan.get("emi")) is not None:
            return f(loan.get("emi")), "card EMI per bank rule"
        if rule == "none":
            return 0.0, "bank does not count card balances"
        return None, f"Card obligation unknown for {loan.get('bank') or 'card'} (bank card rule not configured or card EMI missing)"
    emi = f(loan.get("emi"))
    return (emi, "reported EMI") if emi is not None else (None, f"EMI missing for {loan.get('bank') or 'loan'} {loan.get('loan_type') or ''}".strip())


def emi_for(p: float, roi: float, n: int) -> float:
    r = roi / 1200
    return round(p * r * (1 + r) ** n / ((1 + r) ** n - 1), 2) if r else round(p / n, 2)


def principal_for(emi: float, roi: float, n: int) -> float:
    r = roi / 1200
    return round(emi * ((1 + r) ** n - 1) / (r * (1 + r) ** n), 2) if r else round(emi * n, 2)


def evaluate_bank(profile: dict, loans: list, policy: dict, credit: dict, as_of: date) -> dict:
    name = policy.get("bank_name")
    reasons, missing, notes, partial = [], [], [], []
    sal = profile.get("net_salary")
    max_foir = f(policy.get("max_foir"))
    roi = f(policy.get("roi_min")) or f(policy.get("roi_max"))
    tenure = int(f(policy.get("max_tenure")) or 0) or None
    if not sal:
        missing.append("Net monthly salary")
    if not profile.get("obligations_known"):
        missing.append("Existing obligations not established — upload a credit report or enter loan EMIs")
    for k, lbl in ((max_foir, "Maximum FOIR"), (roi, "Interest rate"), (tenure, "Maximum tenure")):
        if not k:
            missing.append(f"Bank policy: {lbl} not configured")
    if f(policy.get("min_salary")) and sal and sal < f(policy["min_salary"]):
        reasons.append(f"Net salary ₹{sal:,.0f} below bank minimum ₹{f(policy['min_salary']):,.0f}")
    cib = profile.get("cibil_score")
    if f(policy.get("min_cibil")) and cib is not None and cib < f(policy["min_cibil"]):
        reasons.append(f"CIBIL {cib} below bank minimum {int(f(policy['min_cibil']))}")
    if f(policy.get("min_cibil")) and cib is None:
        missing.append("CIBIL score")
    if credit.get("settlement") and policy.get("settlement_allowed") is False:
        reasons.append("Settlement found; this bank's policy does not permit settlement")
    if credit.get("write_off") and policy.get("writeoff_allowed") is False:
        reasons.append("Write-off found; this bank's policy does not permit write-off")
    if f(policy.get("max_enquiries_month")) is not None and credit.get("max_enquiries_in_month", 0) > f(policy["max_enquiries_month"]):
        reasons.append(f"{credit['max_enquiries_in_month']} enquiries in a month; bank allows {int(f(policy['max_enquiries_month']))}")
    if f(policy.get("max_dpd_events")) is not None and credit.get("late_events", 0) > f(policy["max_dpd_events"]):
        reasons.append(f"{credit['late_events']} late-payment events; bank allows {int(f(policy['max_dpd_events']))}")
    rows, total_obl = [], 0.0
    bt_types = set(policy.get("bt_loan_types") or (["personal_loan"] if policy.get("bt_allowed") else []))
    if policy.get("app_loan_bt"):
        bt_types.add("app_loan")
    if policy.get("cc_bt_allowed"):
        bt_types.add("credit_card")
    min_season = f(policy.get("min_loan_seasoning_months"))
    min_emis = f(policy.get("min_emis_paid"))
    for i, l in enumerate(loans):
        k = kind(l, policy)
        amt, note = obligation(l, policy)
        se = seasoning(l, policy, as_of)
        row = {"idx": i, "lender": l.get("bank"), "type": k, "outstanding": f(l.get("outstanding")), "obligation": amt, "note": note,
               "seasoning": se, "bt": "Retained", "bt_reason": None}
        if amt is None:
            partial.append(note)
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
            elif min_emis and f(l.get("emis_paid")) is None:
                row.update(bt="Needs Review", bt_reason=f"Bank requires {int(min_emis)} EMIs paid — payment history not verified")
            elif min_emis and f(l["emis_paid"]) < min_emis:
                row["bt_reason"] = f"{int(f(l['emis_paid']))} EMIs paid; bank requires {int(min_emis)}"
            elif amt is None:
                row.update(bt="Needs Review", bt_reason="EMI missing — cannot release its obligation")
            else:
                row["bt"] = "Candidate"
        rows.append(row)
    declared = profile.get("declared_obligations")
    if not loans and declared:
        total_obl = declared
        notes.append(f"Obligations from the EMI entered on file (₹{declared:,.0f}/month) — no loan rows to evaluate for BT")
    existing_foir = round(total_obl * 100 / sal, 1) if sal and profile.get("obligations_known") else None
    if partial:
        notes.append("FOIR calculated on available EMIs only — " + "; ".join(sorted(set(partial))))
    if f(policy.get("pre_bt_max_foir")) and existing_foir is not None and existing_foir > f(policy["pre_bt_max_foir"]):
        reasons.append(f"Existing FOIR {existing_foir}% exceeds bank pre-BT limit {policy['pre_bt_max_foir']}%")
    result = {"bank_name": name, "policy_id": policy.get("id"), "policy_version": policy.get("version") or policy.get("updated_at"),
              "existing_obligations": round(total_obl, 2), "existing_foir": existing_foir, "foir_basis": "partial" if partial else "complete",
              "max_foir": max_foir, "roi": roi, "tenure": tenure, "accounts": rows, "missing": sorted(set(missing)), "partial": sorted(set(partial)),
              "reasons": reasons, "notes": notes}
    if missing:
        result.update(status="Not Eligible" if reasons else "Needs Review")
        return result
    max_amt = f(policy.get("max_loan_amount"))
    cands = [r for r in rows if r["bt"] == "Candidate"]
    max_bt = int(f(policy.get("max_bt_count")) or len(cands) or 0)
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
    topup_ok = policy.get("additional_cash_allowed", policy.get("topup_allowed"))
    extra = max(0.0, max_eligible - bt_out) if topup_ok else None
    proposed = (bt_out + (extra or 0)) if bt_out else max_eligible
    p_emi = emi_for(proposed, roi, tenure) if proposed else 0
    post = round((retained + p_emi) * 100 / sal, 1)
    if post > max_foir + 0.05:
        reasons.append(f"Post-BT FOIR is {post}%; maximum permitted is {max_foir}%")
    if f(policy.get("min_loan_amount")) and proposed < f(policy["min_loan_amount"]):
        reasons.append(f"Proposed amount ₹{proposed:,.0f} below bank minimum ₹{f(policy['min_loan_amount']):,.0f}")
    for r in rows:
        if r["bt"] == "Retained" and r["type"] == "app_loan" and r["obligation"]:
            notes.append(f"App loan retained as obligation: ₹{r['obligation']:,.0f}/month")
        if r["bt"] == "Retained" and r["type"] == "credit_card" and r["obligation"]:
            notes.append(f"Credit card retained using bank policy ({r['note']}): ₹{r['obligation']:,.0f}/month")
    review = partial or any(r["bt"] == "Needs Review" for r in rows)
    result.update(status="Not Eligible" if reasons else ("Needs Review" if review else "Eligible"),
                  bt_selected=[r["idx"] for r in combo], bt_outstanding=round(bt_out, 2), proposed_amount=round(proposed, 2),
                  proposed_emi=p_emi, retained_obligations=round(retained, 2), post_bt_foir=post, max_eligible_amount=round(max_eligible, 2),
                  additional_amount=None if extra is None else round(extra, 2),
                  assumptions=["Indicative rate (bank minimum ROI) and reported outstanding; foreclosure balances unverified"])
    return result


def profile_from(fd: dict, loans: list) -> dict:
    sal = f(fd.get("net_salary"))
    cib = f(fd.get("cibil_score"))
    declared = f(fd.get("monthly_emi_obligations"))
    has_report = bool((fd.get("credit_analysis") or {}).get("history_available"))
    active = [x for x in loans if not is_closed(x)]
    loan_rows = [x for x in active if kind(x) != "credit_card"]
    cards = [x for x in active if kind(x) == "credit_card"]
    emis = [f(x.get("emi")) for x in loan_rows]
    known = (bool(loans) and (not loan_rows or any(e is not None for e in emis))) or (has_report and not loan_rows) or (not loans and declared is not None and str(fd.get("monthly_emi_obligations")).strip() != "")
    loan_emi = round(sum(e for e in emis if e is not None), 2) if loans else (declared if declared is not None else (0.0 if has_report else None))
    missing_emi = [f"{x.get('bank') or 'loan'} {x.get('loan_type') or ''}".strip() for x, e in zip(loan_rows, emis) if e is None]
    return {"net_salary": sal, "salary_basis": fd.get("salary_basis") or "Entered on file", "company_name": fd.get("company_name"),
            "cibil_score": int(cib) if cib else None, "declared_obligations": declared if not loans else None,
            "obligations_known": known, "obligations_from_loans": loan_emi if known else None, "emi_missing_for": missing_emi,
            "active_loans": len(loan_rows), "credit_cards": len(cards), "card_outstanding": round(sum(f(x.get("outstanding")) or 0 for x in cards), 2),
            "closed_accounts": len(loans) - len(active)}


def inputs_hash(fd: dict, policies: list) -> str:
    keys = {k: fd.get(k) for k in ("net_salary", "cibil_score", "existing_loans", "company_name", "credit_analysis", "monthly_emi_obligations")}
    pol = [(p.get("id"), p.get("updated_at"), p.get("version")) for p in policies]
    return hashlib.sha256(json.dumps([keys, pol], default=str, sort_keys=True).encode()).hexdigest()[:16]


def run(fd: dict, policies: list, as_of: Optional[date] = None) -> dict:
    as_of = as_of or date.today()
    loans = [x for x in (fd.get("existing_loans") or []) if isinstance(x, dict)]
    prof = profile_from(fd, loans)
    credit = credit_profile(fd.get("credit_analysis") or {}, fd.get("cibil_issues"))
    obl = prof["obligations_from_loans"]
    prof["existing_foir"] = round(obl * 100 / prof["net_salary"], 1) if prof["net_salary"] and obl is not None else None
    prof["foir_basis"] = "partial" if prof["emi_missing_for"] else "complete"
    banks = [evaluate_bank(prof, loans, p, credit, as_of) for p in policies if p.get("is_active", True)]
    return {"as_of": as_of.isoformat(), "profile": prof, "credit": credit, "banks": banks, "inputs_hash": inputs_hash(fd, policies),
            "engine_version": "2026.06-unified"}
