"""Unified live business reports for the Meta CRM (/api/meta/reports/live).
Read-only: one role-scoped Mongo read with projection, aggregated server-side. Reuses compute_tat
(working-day TAT, Sundays excluded) so numbers match the bell / Files page."""
import io
import csv
import re
from statistics import median
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Response
from utils.database import db
from utils.auth import require_meta_access
from routes.meta import (
    _ctx, STAFF_ROLES, NOT_DELETED, PROCESSING_STATUSES, LEGACY_PROCESSING_STATUSES,
    TAT_LIMIT_HOURS, compute_tat, _parse_dt, _working_ms,
)

router = APIRouter(prefix="/api/meta/reports", tags=["Meta Reports"])

IST = timedelta(hours=5, minutes=30)
DAY_MS = 24 * 3600 * 1000
LIMIT_MS = TAT_LIMIT_HOURS * 3600 * 1000
LOGIN_PLUS = {"Login Done", "Sent for Approval", "Underwriting", "FI (Field Investigation)", "FI Negative",
              "FI Reinitiated", "Approved", "Disbursed", "Not Disbursed"}
APPROVED_PLUS = {"Approved", "Disbursed", "Not Disbursed"}
HOLD_STATUSES = {"Hold", "Query", "Query/Hold"}
AWAIT_APPROVAL = {"Login Done", "Sent for Approval", "Underwriting"}
AGE_BUCKETS = [("0-1", 0, 1), ("2", 2, 2), ("3", 3, 3), ("4", 4, 4), ("5-7", 5, 7), ("8-14", 8, 14), ("15+", 15, 10 ** 6)]
PROJECTION = {"_id": 0, "lead_id": 1, "full_name": 1, "phone": 1, "status": 1, "processing_status": 1, "source_tab": 1,
              "created_time": 1, "created_at": 1, "file_created_at": 1, "assigned_partner_id": 1,
              "assigned_partner_name": 1, "assigned_processor_id": 1, "assigned_processor_name": 1,
              "docs_received": 1, "tat_final_at": 1, "tat_final_status": 1, "call_logs": 1,
              "file.loan_type": 1, "file.banks": 1, "activities": 1}


def _num(v):
    try:
        return float(re.sub(r"[^\d.]", "", str(v))) if v not in (None, "") else 0.0
    except ValueError:
        return 0.0


def _ist_date(dt):
    return (dt + IST).strftime("%Y-%m-%d") if dt else None


def _in(dstr, f, t):
    return bool(dstr) and (not f or dstr >= f) and (not t or dstr <= t)


def _source(d):
    st = d.get("source_tab") or ""
    return "WEBSITE" if st == "Website" else ("MANUAL" if st == "Manual Entry" else "META")


def _loan_key(d):
    lt = ((d.get("file") or {}).get("loan_type") or "").strip()
    return lt.lower() if lt else ""


def _status_at(d, wanted):
    """Earliest activity timestamp where the processing status was set to one of `wanted`."""
    best = None
    for a in d.get("activities") or []:
        if a.get("type") != "processing":
            continue
        m = re.search(r"set to '([^']+)'", a.get("detail") or "")
        if m and m.group(1) in wanted:
            dt = _parse_dt(a.get("at"))
            if dt and (best is None or dt < best):
                best = dt
    return best


def _min_dt(vals):
    vals = [v for v in vals if v]
    return min(vals) if vals else None


def _file_facts(d, now):
    banks = (d.get("file") or {}).get("banks") or []
    ps = d.get("processing_status") or "New"
    login = any(b.get("login_done") == "Yes" for b in banks) or ps in LOGIN_PLUS
    approved = any(b.get("approval_status") == "Approved" for b in banks) or ps in APPROVED_PLUS
    declined = any(str(b.get("approval_status") or "").lower() in ("rejected", "declined") for b in banks) or ps == "Declined"
    disbursed = any(b.get("disbursed") == "Yes" for b in banks) or ps == "Disbursed"
    appr_amt = sum(_num(b.get("approved_amount")) for b in banks if b.get("approval_status") == "Approved")
    disb_amt = sum(_num(b.get("disbursed_amount")) for b in banks if b.get("disbursed") == "Yes")
    login_at = _min_dt([_parse_dt(b.get("login_done_at")) for b in banks] + [_status_at(d, LOGIN_PLUS)]) if login else None
    appr_at = _min_dt([_parse_dt(b.get("approved_at")) for b in banks] + [_status_at(d, APPROVED_PLUS)]) if approved else None
    decl_at = _min_dt([_parse_dt(b.get("rejected_at")) for b in banks] + [_status_at(d, {"Declined"})]) if declined else None
    disb_at = _min_dt([_parse_dt(b.get("disbursed_at")) or _parse_dt(b.get("disbursal_date")) for b in banks if b.get("disbursed") == "Yes"]
                      + [_status_at(d, {"Disbursed"})]) if disbursed else None
    tat = compute_tat(d, now)
    created = _parse_dt(d.get("file_created_at") or d.get("created_at"))
    return {"ps": ps, "login": login, "approved": approved, "declined": declined, "disbursed": disbursed,
            "approved_amount": appr_amt, "disbursed_amount": disb_amt, "created": created,
            "login_at": login_at, "approved_at": appr_at, "declined_at": decl_at, "disbursed_at": disb_at,
            "active": tat["state"] == "ongoing", "tat_ms": tat["ms"], "tat_days": tat["days"], "tat_hours": tat["hours"],
            "overdue": tat["state"] == "ongoing" and tat["overdue"]}


async def _gp_manager_map():
    out = {}
    async for u in db.users.find({"meta_user_id": {"$exists": True}, "manager_id": {"$nin": [None, ""]}},
                                 {"_id": 0, "meta_user_id": 1, "manager_id": 1}):
        out[u["meta_user_id"]] = u["manager_id"]
    return out


async def build_report(user, f):
    role, uid = _ctx(user)
    base = dict(NOT_DELETED)
    if role == "processor":
        base["assigned_processor_id"] = uid
    elif role not in STAFF_ROLES:
        base["assigned_partner_id"] = uid
    docs = await db.meta_leads.find(base, PROJECTION).to_list(50000)
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    fd, td, basis = f.get("from_date"), f.get("to_date"), f.get("basis") or "cohort"
    gp_mgr = await _gp_manager_map() if f.get("manager") else {}

    def keep(d):
        if f.get("partner"):
            pid = d.get("assigned_partner_id")
            if (f["partner"] == "UNASSIGNED" and pid) or (f["partner"] != "UNASSIGNED" and pid != f["partner"]):
                return False
        if f.get("processor"):
            pid = d.get("assigned_processor_id")
            if (f["processor"] == "UNASSIGNED" and pid) or (f["processor"] != "UNASSIGNED" and pid != f["processor"]):
                return False
        if f.get("source") and _source(d) != f["source"]:
            return False
        if f.get("manager") and gp_mgr.get(d.get("assigned_partner_id")) != f["manager"]:
            return False
        if f.get("loan_type") and _loan_key(d) != f["loan_type"].strip().lower():
            return False
        if f.get("file_status") and (d.get("status") != "FILE" or (d.get("processing_status") or "New") != f["file_status"]):
            return False
        return True

    docs = [d for d in docs if keep(d)]
    leads, files = [], []
    for d in docs:
        lead_date = _ist_date(_parse_dt(d.get("created_time") or d.get("created_at")))
        d["_lead_in"] = _in(lead_date, fd, td) if (fd or td) else True
        if d["_lead_in"]:
            leads.append(d)
        if d.get("status") == "FILE":
            d["_f"] = _file_facts(d, now)
            d["_file_in"] = _in(_ist_date(d["_f"]["created"]), fd, td) if (fd or td) else True
            if d["_file_in"]:
                files.append(d)

    def ms_in(d, key):
        """Milestone counted for the period: cohort -> file created in range; activity -> milestone date in range."""
        fx = d["_f"]
        if not fx[key]:
            return False
        if basis == "activity" and (fd or td):
            return _in(_ist_date(fx[f"{key}_at"]), fd, td)
        return d["_file_in"]

    all_files = [d for d in docs if d.get("status") == "FILE"]
    ms_pool = all_files if basis == "activity" else files

    def perf(pool_files, pool_leads):
        r = {"leads": len(pool_leads), "new_leads": sum(1 for d in pool_leads if d.get("status") == "NEW"),
             "files": len([d for d in pool_files if d["_file_in"]]), "logins": 0, "approved": 0, "declined": 0,
             "disbursed": 0, "approved_amount": 0.0, "disbursed_amount": 0.0}
        for d in pool_files:
            fx = d["_f"]
            for k, out in (("login", "logins"), ("approved", "approved"), ("declined", "declined"), ("disbursed", "disbursed")):
                if ms_in(d, k):
                    r[out] += 1
                    if k == "approved":
                        r["approved_amount"] += fx["approved_amount"]
                    if k == "disbursed":
                        r["disbursed_amount"] += fx["disbursed_amount"]
        return r

    def pct(a, b):
        return round(a * 100.0 / b, 1) if b else 0.0

    # ---- KPIs ----
    kp = perf(ms_pool, leads)
    lead_files = sum(1 for d in leads if d.get("status") == "FILE")
    kpis = {
        **kp,
        "files_in_progress": sum(1 for d in files if d["_f"]["active"]),
        "not_eligible": sum(1 for d in files if d["_f"]["ps"] == "Not Eligible"),
        "unassigned_leads": sum(1 for d in leads if not d.get("assigned_partner_id")),
        "unassigned_files": sum(1 for d in files if not d.get("assigned_processor_id")),
        "conv_lead_file": pct(lead_files, len(leads)), "conv_lead_file_n": [lead_files, len(leads)],
        "conv_file_login": pct(kp["logins"], kp["files"]) if basis == "cohort" else None,
        "conv_login_approval": pct(kp["approved"], kp["logins"]),
        "conv_approval_disbursal": pct(kp["disbursed"], kp["approved"]),
    }

    # ---- Pipeline (current status, each file once) ----
    statuses = list(PROCESSING_STATUSES) + sorted(LEGACY_PROCESSING_STATUSES)
    counts = {s: 0 for s in statuses}
    for d in files:
        counts[d["_f"]["ps"]] = counts.get(d["_f"]["ps"], 0) + 1
    pipeline = [{"status": s, "count": counts[s], "pct": pct(counts[s], len(files))}
                for s in counts if s not in LEGACY_PROCESSING_STATUSES or counts[s]]

    # ---- GP performance ----
    gp_users = []
    if role in STAFF_ROLES or role == "processor":
        gq = {"role": "growth_partner", "approved": True, **NOT_DELETED}
        gp_users = await db.meta_users.find(gq, {"_id": 0, "user_id": 1, "name": 1}).to_list(1000)
        if f.get("partner") and f["partner"] != "UNASSIGNED":
            gp_users = [g for g in gp_users if g["user_id"] == f["partner"]]
        if f.get("manager"):
            gp_users = [g for g in gp_users if gp_mgr.get(g["user_id"]) == f["manager"]]
    else:
        gp_users = [{"user_id": uid, "name": user.get("name") or "Me"}]
    gp_names = {g["user_id"]: g["name"] for g in gp_users}
    for d in docs:  # include partners that are no longer active but still hold records
        pid = d.get("assigned_partner_id")
        if pid and pid not in gp_names:
            gp_names[pid] = d.get("assigned_partner_name") or pid

    def group_rows(key_field, names, extra):
        rows = []
        keys = list(names.keys()) + [None]
        for k in keys:
            gl = [d for d in leads if (d.get(key_field) or None) == k]
            gf_all = [d for d in ms_pool if (d.get(key_field) or None) == k]
            gf = [d for d in files if (d.get(key_field) or None) == k]
            if k is None and not gl and not gf and not gf_all:
                continue
            r = perf(gf_all, gl)
            r.update({"id": k or "UNASSIGNED", "name": names.get(k) if k else "Unassigned",
                      "docs_pending": sum(1 for d in gf if not d.get("docs_received")),
                      "docs_received": sum(1 for d in gf if d.get("docs_received")),
                      "not_eligible": sum(1 for d in gf if d["_f"]["ps"] == "Not Eligible"),
                      "by_status": {s: sum(1 for d in gf if d["_f"]["ps"] == s) for s in counts}})
            extra(r, gf)
            rows.append(r)
        return rows

    def gp_extra(r, gf):
        r["conversion"] = pct(r["files"], r["leads"])

    gp_rows = group_rows("assigned_partner_id", gp_names, gp_extra)
    gp_rows = [r for r in gp_rows if not (r["id"] == "UNASSIGNED" and role not in STAFF_ROLES)]

    # ---- Processor performance ----
    proc_names = {}
    if role in STAFF_ROLES:
        for p in await db.meta_users.find({"role": "processor", "approved": True, **NOT_DELETED}, {"_id": 0, "user_id": 1, "name": 1}).to_list(500):
            proc_names[p["user_id"]] = p["name"]
        if f.get("processor") and f["processor"] != "UNASSIGNED":
            proc_names = {k: v for k, v in proc_names.items() if k == f["processor"]}
    elif role == "processor":
        proc_names = {uid: user.get("name") or "Me"}
    for d in all_files:
        pid = d.get("assigned_processor_id")
        if pid and pid not in proc_names:
            proc_names[pid] = d.get("assigned_processor_name") or pid

    def proc_extra(r, gf):
        t = [d["_f"]["tat_ms"] for d in gf if d["_f"]["tat_ms"] is not None]
        r["avg_tat_days"] = round(sum(t) / len(t) / DAY_MS, 1) if t else None
        cur = [d for d in all_files if (d.get("assigned_processor_id") or "UNASSIGNED") == r["id"]]
        r["overdue"] = sum(1 for d in cur if d["_f"]["overdue"])
        r["active"] = sum(1 for d in cur if d["_f"]["active"])

    proc_rows = [] if role == "growth_partner" else group_rows("assigned_processor_id", proc_names, proc_extra)
    for r in proc_rows:
        r.pop("leads", None); r.pop("new_leads", None)

    # ---- TAT ----
    # Current open files: the date range does not apply (an old file still open today is still overdue today).
    active = [d for d in all_files if d["_f"]["active"] and d["_f"]["tat_ms"] is not None]
    open_ms = [d["_f"]["tat_ms"] for d in active]

    def seg(a, b):
        vals = [_working_ms(d["_f"][a], d["_f"][b]) for d in files if d["_f"][a] and d["_f"][b] and d["_f"][b] >= d["_f"][a]]
        return {"avg_days": round(sum(vals) / len(vals) / DAY_MS, 1) if vals else None, "n": len(vals)}

    buckets = []
    for label, lo, hi in AGE_BUCKETS:
        c = sum(1 for m in open_ms if lo <= int(m // DAY_MS) <= hi)
        buckets.append({"label": label, "count": c, "pct": pct(c, len(open_ms))})
    tat = {
        "active_files": len(active),
        "avg_open_days": round(sum(open_ms) / len(open_ms) / DAY_MS, 1) if open_ms else None,
        "median_open_days": round(median(open_ms) / DAY_MS, 1) if open_ms else None,
        "file_to_login": seg("created", "login_at"), "login_to_approval": seg("login_at", "approved_at"),
        "approval_to_disbursal": seg("approved_at", "disbursed_at"),
        "within_sla": sum(1 for d in active if not d["_f"]["overdue"]),
        "exceeding_sla": sum(1 for d in active if d["_f"]["overdue"]),
        "oldest_open_days": round(max(open_ms) / DAY_MS, 1) if open_ms else None,
        "buckets": buckets, "limit_hours": TAT_LIMIT_HOURS,
    }

    overdue = sorted([{
        "lead_id": d["lead_id"], "full_name": d.get("full_name") or "", "partner": d.get("assigned_partner_name") or "",
        "processor": d.get("assigned_processor_name") or "", "loan_type": (d.get("file") or {}).get("loan_type") or "",
        "created": d.get("file_created_at") or d.get("created_at"), "status": d["_f"]["ps"],
        "tat_ms": d["_f"]["tat_ms"], "tat_days": d["_f"]["tat_days"], "tat_hours": d["_f"]["tat_hours"],
        "overdue_days": round((d["_f"]["tat_ms"] - LIMIT_MS) / DAY_MS, 1),
    } for d in active if d["_f"]["overdue"]], key=lambda x: x["tat_ms"], reverse=True)

    # ---- Loan types ----
    lt_names = {}
    for d in docs:
        k = _loan_key(d)
        if k:
            lt_names.setdefault(k, ((d.get("file") or {}).get("loan_type") or "").strip())
    loan_rows = []
    for k in list(lt_names) + [""]:
        gl = [d for d in leads if _loan_key(d) == k]
        gf_all = [d for d in ms_pool if _loan_key(d) == k]
        if not gl and not gf_all:
            continue
        r = perf(gf_all, gl)
        r.update({"loan_type": lt_names.get(k) or "Not specified", "key": k, "conversion": pct(r["files"], r["leads"])})
        loan_rows.append(r)
    loan_rows.sort(key=lambda r: (-r["files"], r["loan_type"]))

    # ---- Operational alerts ----
    alerts = {
        "unassigned_leads": kpis["unassigned_leads"], "unassigned_files": kpis["unassigned_files"],
        "docs_pending_sla": sum(1 for d in active if not d.get("docs_received") and d["_f"]["overdue"]),
        "on_hold": sum(1 for d in files if d["_f"]["ps"] in HOLD_STATUSES),
        "awaiting_login": sum(1 for d in files if d["_f"]["ps"] == "Sent for Login"),
        "awaiting_approval": sum(1 for d in files if d["_f"]["ps"] in AWAIT_APPROVAL),
        "approved_not_disbursed": sum(1 for d in files if d["_f"]["ps"] == "Approved"),
        "not_contacted": sum(1 for d in leads if d.get("status") == "NEW" and not d.get("call_logs")),
        "tat_exceeded": len(overdue),
    }
    return {"kpis": kpis, "pipeline": pipeline, "total_files": len(files), "gp": gp_rows, "processors": proc_rows,
            "tat": tat, "overdue": overdue, "loan_types": loan_rows, "alerts": alerts,
            "basis": basis, "role": role, "generated_at": datetime.now(timezone.utc).isoformat()}


def _filters(from_date, to_date, partner, processor, loan_type, source, file_status, manager, basis):
    clean = lambda v: None if v in (None, "", "ALL") else v  # noqa: E731
    return {"from_date": clean(from_date), "to_date": clean(to_date), "partner": clean(partner),
            "processor": clean(processor), "loan_type": clean(loan_type), "source": clean(source and source.upper()),
            "file_status": clean(file_status), "manager": clean(manager), "basis": basis or "cohort"}


@router.get("/live")
async def live_report(user: dict = Depends(require_meta_access), from_date: Optional[str] = None, to_date: Optional[str] = None,
                      partner: Optional[str] = None, processor: Optional[str] = None, loan_type: Optional[str] = None,
                      source: Optional[str] = None, file_status: Optional[str] = None, manager: Optional[str] = None,
                      basis: Optional[str] = "cohort"):
    return await build_report(user, _filters(from_date, to_date, partner, processor, loan_type, source, file_status, manager, basis))


@router.get("/options")
async def report_options(user: dict = Depends(require_meta_access)):
    role, uid = _ctx(user)
    staff = role in STAFF_ROLES
    gps = await db.meta_users.find({"role": "growth_partner", "approved": True, **NOT_DELETED}, {"_id": 0, "user_id": 1, "name": 1}).to_list(1000) if staff else []
    procs = await db.meta_users.find({"role": "processor", "approved": True, **NOT_DELETED}, {"_id": 0, "user_id": 1, "name": 1}).to_list(500) if staff else []
    managers = []
    if staff:
        mids = set((await _gp_manager_map()).values())
        if mids:
            async for m in db.users.find({"id": {"$in": list(mids)}}, {"_id": 0, "id": 1, "name": 1}):
                managers.append({"id": m["id"], "name": m.get("name") or m["id"]})
    match = {"status": "FILE", **NOT_DELETED}
    if role == "processor":
        match["assigned_processor_id"] = uid
    elif not staff:
        match["assigned_partner_id"] = uid
    lts = {}
    for v in await db.meta_leads.distinct("file.loan_type", match):
        if v and str(v).strip():
            lts.setdefault(str(v).strip().lower(), str(v).strip())
    return {"partners": sorted(gps, key=lambda x: (x.get("name") or "").lower()),
            "processors": sorted(procs, key=lambda x: (x.get("name") or "").lower()),
            "managers": sorted(managers, key=lambda x: x["name"].lower()),
            "loan_types": sorted(lts.values(), key=str.lower),
            "file_statuses": list(PROCESSING_STATUSES), "role": role}


def _csv(rows, header):
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(header)
    for r in rows:
        w.writerow(r)
    return out.getvalue()


@router.get("/live/export")
async def live_report_export(section: str = "complete", user: dict = Depends(require_meta_access), from_date: Optional[str] = None,
                             to_date: Optional[str] = None, partner: Optional[str] = None, processor: Optional[str] = None,
                             loan_type: Optional[str] = None, source: Optional[str] = None, file_status: Optional[str] = None,
                             manager: Optional[str] = None, basis: Optional[str] = "cohort"):
    rep = await build_report(user, _filters(from_date, to_date, partner, processor, loan_type, source, file_status, manager, basis))
    k, t = rep["kpis"], rep["tat"]
    gp_h = ["Growth Partner", "Leads", "New Leads", "Files", "Docs Pending", "Docs Received", "Not Eligible", "Logins",
            "Approved", "Declined", "Disbursed", "Disbursed Amount", "Conversion %"]
    gp_r = [[r["name"], r["leads"], r["new_leads"], r["files"], r["docs_pending"], r["docs_received"], r["not_eligible"],
             r["logins"], r["approved"], r["declined"], r["disbursed"], round(r["disbursed_amount"]), r["conversion"]] for r in rep["gp"]]
    pr_h = ["Processor", "Assigned Files", "Docs Pending", "Docs Received", "Login", "Approved", "Declined", "Disbursed",
            "Approved Amount", "Disbursed Amount", "Avg TAT (working days)", "Overdue Files"]
    pr_r = [[r["name"], r["files"], r["docs_pending"], r["docs_received"], r["logins"], r["approved"], r["declined"],
             r["disbursed"], round(r["approved_amount"]), round(r["disbursed_amount"]), r["avg_tat_days"], r["overdue"]] for r in rep["processors"]]
    st_h = ["File Status", "Files", "% of Files"]
    st_r = [[p["status"], p["count"], p["pct"]] for p in rep["pipeline"]]
    tat_h = ["Metric", "Value"]
    tat_r = [["Active files", t["active_files"]], ["Average open TAT (working days)", t["avg_open_days"]],
             ["Median open TAT (working days)", t["median_open_days"]],
             ["Avg File-to-Login (working days)", t["file_to_login"]["avg_days"]],
             ["Avg Login-to-Approval (working days)", t["login_to_approval"]["avg_days"]],
             ["Avg Approval-to-Disbursement (working days)", t["approval_to_disbursal"]["avg_days"]],
             ["Within 4-day SLA", t["within_sla"]], ["Exceeding 4-day SLA", t["exceeding_sla"]],
             ["Oldest active file (working days)", t["oldest_open_days"]]] + [[f"Ageing {b['label']} days", b["count"]] for b in t["buckets"]]
    ov_h = ["Customer", "File ID", "Growth Partner", "Processor", "Loan Type", "Created", "Current Status", "Current TAT", "Days Overdue"]
    ov_r = [[o["full_name"], o["lead_id"], o["partner"], o["processor"], o["loan_type"], (o["created"] or "")[:10], o["status"],
             f"{o['tat_days']}d {o['tat_hours']}h", o["overdue_days"]] for o in rep["overdue"]]
    sections = {"gp": (gp_h, gp_r), "processor": (pr_h, pr_r), "status": (st_h, st_r), "tat": (tat_h, tat_r), "overdue": (ov_h, ov_r)}
    if section in sections:
        body = _csv(sections[section][1], sections[section][0])
    else:
        kpi_rows = [[n, k[key]] for n, key in (("Total Leads", "leads"), ("New Leads", "new_leads"), ("Total Files", "files"),
                    ("Files In Progress", "files_in_progress"), ("Not Eligible", "not_eligible"), ("Unassigned Leads", "unassigned_leads"),
                    ("Unassigned Files", "unassigned_files"), ("Logins", "logins"), ("Approved", "approved"),
                    ("Approved Amount", "approved_amount"), ("Declined", "declined"), ("Disbursed", "disbursed"),
                    ("Disbursed Amount", "disbursed_amount"))]
        parts = [("KPIs", ["Metric", "Value"], kpi_rows), ("File Status", st_h, st_r), ("Growth Partners", gp_h, gp_r),
                 ("Processors", pr_h, pr_r), ("TAT", tat_h, tat_r), ("Overdue Files", ov_h, ov_r)]
        body = "\n".join(f"{title}\n" + _csv(rows, h) for title, h, rows in parts)
    fname = f"bankezee_report_{section}_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M')}.csv"
    return Response(content=body, media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="{fname}"'})
