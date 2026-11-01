"""Processor Performance & Pending Action — ONE shared calculation used by both Dashboard and Reports."""
import csv
import io
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from utils.database import db
from utils.auth import require_meta_access
from routes.meta import _ctx, NOT_DELETED
from routes import meta_metrics as mm

router = APIRouter(prefix="/api/meta/processor-perf", tags=["Processor Performance"])
EXCEPTIONS = {
    "tat_exceeded": "TAT Exceeded", "due_soon": "Due Soon", "no_activity": "No Recent Activity", "followup_overdue": "Follow-up Overdue",
    "no_followup": "Query/Hold without follow-up date", "no_reason": "Query/Hold without reason", "awaiting_customer": "Awaiting Customer",
    "awaiting_bank": "Awaiting Bank", "processor_action": "Processor Action Required", "missing_info": "Missing Information",
    "rework": "Reopened / reworked (FI Reinitiated or reopened after a final stage)",
}


def _exc(f, now, inactive_days):
    if not f["is_file"]:
        return set()
    out = set()
    labels = mm.tat_label(f, now, inactive_days)
    for k, lbl in (("tat_exceeded", "TAT Exceeded"), ("due_soon", "Due Soon"), ("no_activity", "No Recent Activity"),
                   ("followup_overdue", "Follow-up Overdue"), ("awaiting_customer", "Awaiting Customer"),
                   ("awaiting_bank", "Awaiting Bank"), ("processor_action", "Processor Action Required")):
        if lbl in labels:
            out.add(k)
    mi = mm.missing_info(f)
    if mi:
        out.add("missing_info")
    if "Query/Hold follow-up date missing" in mi and not f["final"]:
        out.add("no_followup")
    if "Query/Hold reason missing" in mi:
        out.add("no_reason")
    if "FI Reinitiated" in f["reached"]:
        out.add("rework")
    return out


async def _files(user, q):
    role, uid = _ctx(user)
    if role not in ("admin", "ops", "processor"):
        raise HTTPException(status_code=403, detail="Processor performance is available to Admin, Operations and Processors")
    mq = {**NOT_DELETED, "status": "FILE"}
    if role == "processor":
        mq["assigned_processor_id"] = uid
    elif q.get("processor"):
        mq["assigned_processor_id"] = None if q["processor"] == "UNASSIGNED" else q["processor"]
    if q.get("loan_type"):
        mq["file.loan_type"] = q["loan_type"]
    if q.get("stage"):
        mq["processing_status"] = q["stage"]
    now = mm.now_naive()
    facts = [mm.lead_facts(d, now) async for d in db.meta_leads.find(mq, {"_id": 0, "notes": 0, "call_logs": 0})]
    inactive = int(q.get("inactive_days") or 2)
    for f in facts:
        f["labels"] = mm.tat_label(f, now, inactive)
        f["exceptions"] = _exc(f, now, inactive)
        f["resp"] = mm.responsibility(f)
    if q.get("tat_status"):
        facts = [f for f in facts if q["tat_status"] in f["labels"]]
    if q.get("responsibility"):
        facts = [f for f in facts if f["resp"] == q["responsibility"]]
    return facts, now, role


def _rng(q):
    s = datetime.fromisoformat(q["date_from"]) - mm.IST if q.get("date_from") else None
    e = datetime.fromisoformat(q["date_to"]) + timedelta(days=1) - mm.IST if q.get("date_to") else None
    return s, e


def _in(dt, s, e):
    return dt is not None and (s is None or dt >= s) and (e is None or dt < e)


def _row(fs, s, e, now):
    active = [f for f in fs if not f["final"]]
    opening = [f for f in fs if s and f["assigned_at"] and f["assigned_at"] < s and not (f["final_at"] and f["final_at"] < s)]
    assigned = [f for f in fs if _in(f["assigned_at"], s, e)] if (s or e) else fs
    handled = {f["lead_id"] for f in opening + assigned}
    inp = (lambda dt: _in(dt, s, e)) if (s or e) else (lambda dt: True)
    appr = [f for f in fs if f["approved"] and (inp(f["approved_at"]) if (s or e) else True)]
    disb = [f for f in fs if f["disbursed"] and (inp(f["disbursed_at"]) if (s or e) else True)]
    done_tat = [f["tat"]["ms"] / 86400000 for f in fs if f["final"] and (f["tat"] or {}).get("ms") is not None and inp(f["final_at"])]
    pend_age = [f["tat"]["ms"] / 86400000 for f in active if (f["tat"] or {}).get("ms") is not None]
    stages = {}
    for f in active:
        stages[f["stage"]] = stages.get(f["stage"], 0) + 1
    exc = {k: sum(k in f["exceptions"] for f in active if k not in ("missing_info", "rework", "no_reason")) for k in EXCEPTIONS}
    exc["missing_info"] = sum("missing_info" in f["exceptions"] for f in fs)
    exc["no_reason"] = sum("no_reason" in f["exceptions"] for f in fs)
    exc["rework"] = sum("rework" in f["exceptions"] for f in fs)
    n_h = len(handled) or len(fs)
    pct = lambda a, b: round(a * 100 / b, 1) if b else None  # noqa: E731
    r2 = lambda x: round(x, 1) if x is not None else None  # noqa: E731
    return {
        "opening_active": len(opening) if s else None, "assigned_in_period": len(assigned), "current_active": len(active),
        "handled": n_h, "stages": stages, "sent_for_login": sum(f["login"] and inp(f["file_at"]) for f in fs),
        "approved": len(appr), "approved_amount": sum(f["approved_amount"] or 0 for f in appr),
        "disbursed": len(disb), "disbursed_amount": sum(f["disbursed_amount"] or 0 for f in disb),
        "declined": sum(f["declined"] and inp(f["final_at"] or f["file_at"]) for f in fs),
        "approval_rate": pct(len(appr), n_h), "disbursal_rate": pct(len(disb), n_h),
        "avg_tat_days": r2(sum(done_tat) / len(done_tat)) if done_tat else None, "median_tat_days": r2(mm.median(done_tat)),
        "completed_with_tat": len(done_tat), "median_pending_age_days": r2(mm.median(pend_age)),
        "max_pending_age_days": r2(max(pend_age)) if pend_age else None, "exceptions": exc,
        "overdue_pct": pct(exc["tat_exceeded"], len(active)), "followup_overdue_pct": pct(exc["followup_overdue"], len(active)),
        "responsibility": {k: sum(f["resp"] == k for f in active) for k in ("Processor action", "Customer delay", "Bank delay")},
    }


def _qd(**kw):
    return {k: v for k, v in kw.items() if v not in (None, "")}


@router.get("")
async def processor_performance(date_from: str = "", date_to: str = "", processor: str = "", loan_type: str = "", stage: str = "",
                                tat_status: str = "", responsibility: str = "", inactive_days: int = 2,
                                user: dict = Depends(require_meta_access)):
    q = _qd(date_from=date_from, date_to=date_to, processor=processor, loan_type=loan_type, stage=stage, tat_status=tat_status,
            responsibility=responsibility, inactive_days=inactive_days)
    facts, now, role = await _files(user, q)
    s, e = _rng(q)
    groups = {}
    for f in facts:
        groups.setdefault(f["processor_id"] or "UNASSIGNED", []).append(f)
    names = {u["user_id"]: u.get("name") async for u in db.meta_users.find({"role": "processor"}, {"user_id": 1, "name": 1})}
    rows = []
    for pid, fs in groups.items():
        r = _row(fs, s, e, now)
        heavy = (r["overdue_pct"] or 0) >= 30 or (r["followup_overdue_pct"] or 0) >= 30
        rows.append({"processor_id": pid, "processor_name": "Unassigned" if pid == "UNASSIGNED" else names.get(pid) or fs[0]["processor_name"],
                     "highlight": heavy, **r})
    rows.sort(key=lambda r: (r["processor_id"] == "UNASSIGNED", -(r["exceptions"]["tat_exceeded"] + r["exceptions"]["followup_overdue"])))
    return {"rows": rows, "total": _row(facts, s, e, now), "as_of": now.isoformat() + "Z", "inactive_days": inactive_days,
            "tat_definition": mm.TAT_DEFINITION, "exception_labels": EXCEPTIONS, "stage_order": mm.STAGE_ORDER,
            "definitions": {
                "Snapshot (as of now)": "Current active files, stage counts, pending age and exceptions.",
                "Period activity": "Assigned in period (latest processor assignment date), approvals/disbursals by their own dates, completed TAT by completion date.",
                "Opening active": "Files assigned before the period start and not yet final at the period start.",
                "Handled": "Distinct files that were opening-active or assigned during the period (all files when no dates are chosen).",
                "Approval / disbursal rate": "Approved (or disbursed) files ÷ files handled.",
                "No Recent Activity": f"No meaningful work event (call, status/stage change, file update, follow-up, document upload, processor transfer, WhatsApp) for {inactive_days}+ days. Opening a file or adding notes doesn't count.",
                "Responsibility": "Customer delay = Documents Pending / customer not supporting; Bank delay = eligibility/login/approval/underwriting/FI stages; Processor action = other active stages. Rejections are attributed to eligibility/bank decision, not the processor.",
                "Transfers": "Totals follow the current owner; 'time under current processor' is measured from the latest processor assignment. Earlier owners' actions are not re-attributed.",
                "Rework": "Tracked only via FI Reinitiated — other reopen/return events aren't recorded today.",
            }}


@router.get("/files")
async def exception_files(exception: str = "", processor: str = "", date_from: str = "", date_to: str = "", loan_type: str = "",
                          stage: str = "", tat_status: str = "", responsibility: str = "", inactive_days: int = 2, format: str = "json",
                          user: dict = Depends(require_meta_access)):
    q = _qd(date_from=date_from, date_to=date_to, processor=processor, loan_type=loan_type, stage=stage, tat_status=tat_status,
            responsibility=responsibility, inactive_days=inactive_days)
    facts, now, _ = await _files(user, q)
    if exception:
        facts = [f for f in facts if exception in f["exceptions"] and (exception in ("missing_info", "rework", "no_reason") or not f["final"])]
    rows = []
    for f in facts:
        t = f["tat"] or {}
        deadline = mm._working_cutoff_forward(f["file_at"]) if f["file_at"] else None
        nxt = ("Collect pending customer documents" if f["resp"] == "Customer delay" else "Follow up with bank" if f["resp"] == "Bank delay"
               else "Update stage / next step" if f["resp"] == "Processor action" else "—")
        if "Follow-up Overdue" in f["labels"]:
            nxt = "Complete the overdue follow-up"
        cur = mm.time_under_current_ms(f, now)
        rows.append({
            "lead_id": f["lead_id"], "customer": f["name"], "stage": f["stage"], "processor": f["processor_name"] or "Unassigned",
            "assigned_at": mm.ist_date(f["assigned_at"]), "last_activity": (f["last_activity"] + mm.IST).strftime("%Y-%m-%d %H:%M") if f["last_activity"] else None,
            "next_followup": f["followup"].get("followup_date") if f["followup"].get("active") else None,
            "tat_deadline": (deadline + mm.IST).strftime("%Y-%m-%d %H:%M") if deadline else "Unavailable",
            "elapsed_tat_days": round(t["ms"] / 86400000, 1) if t.get("ms") is not None else None,
            "overdue_days": round((t["ms"] - mm.TAT_LIMIT_HOURS * 3600000) / 86400000, 1) if t.get("overdue") else 0,
            "days_under_current_processor": round(cur / 86400000, 1) if cur is not None else None,
            "delay_reason": f["followup"].get("description") if f["stage"] in mm.QUERY_HOLD else f["resp"],
            "status_label": f["labels"][0] if f["labels"] else ("Completed" if f["final"] else "—"),
            "labels": ", ".join(f["labels"]), "missing": "; ".join(mm.missing_info(f)), "next_action": nxt,
        })
    if format == "csv":
        buf = io.StringIO()
        w = csv.DictWriter(buf, fieldnames=list(rows[0].keys()) if rows else ["lead_id"])
        w.writeheader()
        w.writerows(rows)
        return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
                                 headers={"Content-Disposition": "attachment; filename=processor_files.csv"})
    return {"items": rows, "total": len(rows)}
