"""Shared metric definitions for Meta Ad Performance and Processor Performance.
One function (lead_facts) derives every per-lead/per-file fact so all pages reconcile."""
import re
import statistics
from datetime import datetime, timedelta, timezone
from typing import Optional

from routes.meta import (compute_tat, _parse_dt, _working_ms, FINAL_STATUSES, TAT_LIMIT_HOURS)

IST = timedelta(hours=5, minutes=30)
UNKNOWN = "Unknown / Not available"
DUE_SOON_HOURS = 72  # 75% of the 96 working-hour TAT
PROC_RE = re.compile(r"Processing status set to '([^']+)'")
LOGIN_STAGES = {"Sent for Login", "Login Done", "Sent for Approval", "Underwriting", "FI (Field Investigation)", "FI Negative",
                "FI Reinitiated", "Approved", "Disbursed", "Not Disbursed"}
DECLINED = {"Declined", "Not Eligible", "Not Disbursed", "Not Login"}
AWAIT_CUSTOMER = {"Documents Pending", "Customer Not Interested - Need Help from MIT & Manager",
                  "Customer Not Supporting - Need Help from MIT & Manager"}
AWAIT_BANK = {"Sent for Eligibility", "Sent for Login", "Login Done", "Sent for Approval", "Underwriting", "FI (Field Investigation)"}
QUERY_HOLD = {"Query", "Hold", "Query/Hold"}
# Meaningful work events (opening a file / empty notes never count).
MEANINGFUL = {"call", "status_change", "processing", "file", "followup", "processor", "whatsapp", "tat"}
STAGE_ORDER = ["New", "Contacted", "Documents Collected", "Documents Pending", "Sent for Eligibility", "Sent for Login", "Login Done",
               "Sent for Approval", "Underwriting", "FI (Field Investigation)", "FI Negative", "FI Reinitiated", "Query", "Hold",
               "Query/Hold", "Customer Not Interested - Need Help from MIT & Manager",
               "Customer Not Supporting - Need Help from MIT & Manager", "Approved", "Disbursed", "Not Eligible", "Not Login",
               "Declined", "Not Disbursed"]


def now_naive():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def ist_date(dt: Optional[datetime]) -> Optional[str]:
    return (dt + IST).strftime("%Y-%m-%d") if dt else None


def _yes(v):
    return str(v or "").strip().lower() in ("yes", "approved", "true")


def _num(v):
    try:
        return float(v) if v not in (None, "") else None
    except (TypeError, ValueError):
        return None


def lead_facts(lead: dict, now: Optional[datetime] = None) -> dict:
    now = now or now_naive()
    acts = lead.get("activities") or []
    a = lead.get("meta_attr") or {}
    banks = (lead.get("file") or {}).get("banks") or []
    stage = lead.get("processing_status") or "New"
    first_status = {}
    for x in acts:
        m = PROC_RE.search(x.get("detail") or "") if x.get("type") == "processing" else None
        if m and m.group(1) not in first_status:
            first_status[m.group(1)] = _parse_dt(x.get("at"))
    is_file = lead.get("status") == "FILE"
    reached = set(first_status) | {stage}
    approved_banks = [b for b in banks if str(b.get("approval_status") or "").lower() == "approved"]
    disb_banks = [b for b in banks if _yes(b.get("disbursed"))]
    approved = is_file and bool(approved_banks or reached & {"Approved", "Disbursed", "Not Disbursed"} or disb_banks)
    disbursed = is_file and bool(disb_banks or "Disbursed" in reached)
    login = is_file and bool(any(_yes(b.get("login_done")) for b in banks) or reached & LOGIN_STAGES)
    disb_date = next((b.get("disbursal_date") for b in disb_banks if b.get("disbursal_date")), None)
    appr_amt = sum(_num(b.get("approved_amount")) or 0 for b in approved_banks) if approved_banks else None
    disb_amt = sum(_num(b.get("disbursed_amount")) or 0 for b in disb_banks) if disb_banks else None
    approved_at = first_status.get("Approved") or (first_status.get("Disbursed") if approved and not approved_banks else None)
    disbursed_at = first_status.get("Disbursed") or (_parse_dt(disb_date) if disb_date else None)
    created = _parse_dt(lead.get("created_time")) or _parse_dt(lead.get("created_at"))
    imported = _parse_dt(lead.get("created_at"))
    file_at = _parse_dt(lead.get("file_created_at")) if is_file else None
    proc_acts = [x for x in acts if x.get("type") == "processor"]
    assigned_at = _parse_dt(proc_acts[-1].get("at")) if proc_acts else file_at
    meaningful = [_parse_dt(x.get("at")) for x in acts if x.get("type") in MEANINGFUL and x.get("at")]
    meaningful += [_parse_dt(d.get("at")) for d in lead.get("documents") or [] if d.get("at")]
    meaningful = [m for m in meaningful if m]
    tat = compute_tat(lead, now) if is_file else None
    final = is_file and (stage in FINAL_STATUSES or bool(lead.get("tat_final_at")))
    return {
        "lead_id": lead["lead_id"], "name": lead.get("full_name"), "phone": lead.get("phone"), "status": lead.get("status"),
        "stage": stage if is_file else None, "loan_type": (lead.get("file") or {}).get("loan_type"),
        "partner_id": lead.get("assigned_partner_id"), "partner_name": lead.get("assigned_partner_name"),
        "processor_id": lead.get("assigned_processor_id"), "processor_name": lead.get("assigned_processor_name"),
        "campaign_id": a.get("campaign_id"), "campaign_name": a.get("campaign_name"), "adset_id": a.get("adset_id"),
        "adset_name": a.get("adset_name"), "ad_id": a.get("ad_id"), "ad_name": a.get("ad_name"), "has_attr": bool(a.get("ad_id")),
        "created": created, "imported": imported, "file_at": file_at, "assigned_at": assigned_at,
        "contacted": lead.get("status") not in (None, "NEW"), "qualified": lead.get("status") in ("LEAD", "FILE"),
        "not_eligible": lead.get("status") == "NOT_QUALIFIED" or stage == "Not Eligible" and is_file,
        "is_file": is_file, "login": login, "approved": approved, "disbursed": disbursed,
        "declined": is_file and (stage in DECLINED or any(str(b.get("approval_status") or "").lower() == "rejected" for b in banks)),
        "approved_amount": appr_amt, "disbursed_amount": disb_amt, "approved_at": approved_at, "disbursed_at": disbursed_at,
        "final": final, "final_at": _parse_dt(lead.get("tat_final_at")), "tat": tat,
        "last_activity": max(meaningful) if meaningful else None, "followup": lead.get("followup") or {},
        "reached": reached,
    }


def median(xs):
    return statistics.median(xs) if xs else None


def tat_label(f: dict, now: datetime, inactive_days: int) -> list:
    """Neutral, evidence-based labels for an active file (first = headline)."""
    if not f["is_file"] or f["final"]:
        return []
    labels, t = [], f["tat"] or {}
    if t.get("overdue"):
        labels.append("TAT Exceeded")
    elif t.get("ms") is not None and t["ms"] > DUE_SOON_HOURS * 3600 * 1000:
        labels.append("Due Soon")
    fu = f["followup"]
    today = ist_date(now)
    if fu.get("active") and fu.get("followup_date") and fu["followup_date"] < today:
        labels.append("Follow-up Overdue")
    if not f["last_activity"] or f["last_activity"] < now - timedelta(days=inactive_days):
        labels.append("No Recent Activity")
    if missing_info(f):
        labels.append("Missing Information")
    if f["stage"] in AWAIT_CUSTOMER:
        labels.append("Awaiting Customer")
    elif f["stage"] in AWAIT_BANK:
        labels.append("Awaiting Bank")
    else:
        labels.append("Processor Action Required")
    if len(labels) == 1:
        labels.insert(0, "On Track")
    elif not any(x in labels for x in ("TAT Exceeded", "Due Soon", "Follow-up Overdue", "No Recent Activity", "Missing Information")):
        labels.insert(0, "On Track")
    return labels


def missing_info(f: dict) -> list:
    out = []
    if f["approved"] and f["approved_amount"] in (None, 0):
        out.append("Approved amount missing")
    if f["approved"] and not f["approved_at"]:
        out.append("Approval date missing")
    if f["disbursed"] and f["disbursed_amount"] in (None, 0):
        out.append("Disbursed amount missing")
    if f["disbursed"] and not f["disbursed_at"]:
        out.append("Disbursal date missing")
    if f["disbursed"] and f["approved_at"] and f["disbursed_at"] and f["disbursed_at"] < f["approved_at"] - timedelta(days=1):
        out.append("Disbursal date before approval")
    if f["disbursed"] and f["file_at"] and f["disbursed_at"] and f["disbursed_at"] < f["file_at"] - timedelta(days=1):
        out.append("Disbursal date before file creation")
    if f["stage"] in QUERY_HOLD:
        if not f["followup"].get("description"):
            out.append("Query/Hold reason missing")
        if not f["followup"].get("followup_date"):
            out.append("Query/Hold follow-up date missing")
    return out


def responsibility(f: dict) -> str:
    if not f["is_file"]:
        return "—"
    if f["stage"] in ("Not Eligible", "Declined", "Not Login", "Not Disbursed"):
        return "Customer eligibility / bank decision"
    if f["stage"] in AWAIT_CUSTOMER:
        return "Customer delay"
    if f["stage"] in AWAIT_BANK:
        return "Bank delay"
    if f["final"]:
        return "—"
    return "Processor action"


def _working_cutoff_forward(start: datetime, hours: int = TAT_LIMIT_HOURS) -> datetime:
    """TAT deadline: the instant `hours` working hours (Sundays excluded, IST) after start."""
    t, remaining = start + IST, hours * 3600.0
    while remaining > 0:
        day_end = datetime(t.year, t.month, t.day) + timedelta(days=1)
        if t.weekday() == 6:
            t = day_end
            continue
        avail = (day_end - t).total_seconds()
        if avail >= remaining:
            t += timedelta(seconds=remaining)
            remaining = 0
        else:
            remaining -= avail
            t = day_end
    return t - IST


def time_under_current_ms(f: dict, now: datetime):
    if not f["assigned_at"]:
        return None
    return _working_ms(f["assigned_at"], f["final_at"] or now)


TAT_DEFINITION = (f"End-to-end TAT starts when the lead becomes a file (file_created_at) and ends at the first final status "
                  f"({', '.join(sorted(FINAL_STATUSES))}). Limit {TAT_LIMIT_HOURS // 24} days = {TAT_LIMIT_HOURS} working hours, "
                  "IST calendar, Sundays excluded (Saturdays and holidays count). Query/Hold do not pause or reset TAT. "
                  "Due Soon = over 72 working hours. Files with no recorded start time are shown as unavailable.")
