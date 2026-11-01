"""Meta Ad Performance: attribution drill-down (Campaign -> Ad Set -> Ad -> Leads/Files), import quality,
file outcomes, Meta spend/CPL (Marketing API, when an ads_read token is configured) and best/worst ads."""
import csv
import io
import os
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from utils.database import db
from utils.auth import require_meta_access
from routes.meta import _ctx, NOT_DELETED, _parse_dt
from routes import meta_metrics as mm

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/meta/ad-perf", tags=["Meta Ad Performance"])
INS = db.meta_ad_insights
GRAPH = f"https://graph.facebook.com/{os.environ.get('META_GRAPH_VERSION') or 'v21.0'}"
LEVELS = {"campaign": ("campaign_id", "campaign_name"), "adset": ("adset_id", "adset_name"), "ad": ("ad_id", "ad_name")}
RANKS = {"cpl": ("CRM CPL", True), "file_conv": ("Lead-to-file conversion", False), "disb_conv": ("Lead-to-disbursal conversion", False),
         "cost_per_disb": ("Cost per disbursed file", True), "disbursed_amount": ("Disbursed amount", False),
         "not_eligible_pct": ("Not-eligible %", True)}


def _ads_cfg():
    return (os.environ.get("META_ADS_ACCESS_TOKEN") or "").strip(), (os.environ.get("META_AD_ACCOUNT_ID") or "").strip().replace("act_", "")


async def ensure_indexes():
    for k in ("meta_attr.ad_id", "meta_attr.adset_id", "meta_attr.campaign_id", "status", "assigned_processor_id", "file_created_at"):
        await db.meta_leads.create_index(k)
    await INS.create_index([("ad_id", 1), ("date", 1)], unique=True)


def _scope(role, uid):
    if role in ("admin", "ops"):
        return {}
    if role == "processor":
        return {"assigned_processor_id": uid}
    if role == "growth_partner":
        return {"assigned_partner_id": uid}
    raise HTTPException(status_code=403, detail="Not authorized")


async def _facts(user, q: dict):
    role, uid = _ctx(user)
    mq = {**NOT_DELETED, "source_tab": {"$ne": "Website"}, **_scope(role, uid)}
    for k in ("campaign_id", "adset_id", "ad_id"):
        if q.get(k):
            mq[f"meta_attr.{k}"] = q[k]
    if q.get("attr") == "yes":
        mq["meta_attr.ad_id"] = {"$ne": None}
    elif q.get("attr") == "no":
        mq["meta_attr.ad_id"] = None
    for k, f in (("partner", "assigned_partner_id"), ("processor", "assigned_processor_id"), ("status", "status"), ("stage", "processing_status")):
        if q.get(k):
            mq[f] = q[k]
    if q.get("loan_type"):
        mq["file.loan_type"] = q["loan_type"]
    now = mm.now_naive()
    out = []
    async for lead in db.meta_leads.find(mq, {"_id": 0, "notes": 0, "call_logs": 0}):
        f = mm.lead_facts(lead, now)
        f["latest"] = lead.get("meta_attr_latest") or {}
        out.append(f)
    return out, role, now


def _rng(q):
    s = datetime.fromisoformat(q["date_from"]) - mm.IST if q.get("date_from") else None
    e = datetime.fromisoformat(q["date_to"]) + timedelta(days=1) - mm.IST if q.get("date_to") else None
    return s, e


def _in(dt, s, e):
    return dt is not None and (s is None or dt >= s) and (e is None or dt < e)


def _select(facts, view, s, e, metric=None):
    """Return the facts counted for a metric under the chosen view (cohort: by lead creation; activity: by event time)."""
    if view == "cohort":
        base = [f for f in facts if _in(f["created"], s, e) or (s is None and e is None)]
    else:
        ev = {"leads": "imported", "files": "file_at", "approved": "approved_at", "disbursed": "disbursed_at"}
        key = ev.get(metric or "leads", "imported")
        base = [f for f in facts if (s is None and e is None and f[key]) or _in(f[key], s, e)]
    return base


def _agg(facts, view, s, e, now, maturity_days):
    if view == "activity":
        leads, files, appr, disb = (_select(facts, view, s, e, k) for k in ("leads", "files", "approved", "disbursed"))
    else:
        leads = _select(facts, view, s, e)
        files = [f for f in leads if f["is_file"]]
        appr = [f for f in files if f["approved"]]
        disb = [f for f in files if f["disbursed"]]
    n = len(leads)
    stages = {}
    for f in files:
        stages[f["stage"]] = stages.get(f["stage"], 0) + 1
    ages = [(now - f["created"]).days for f in leads if f["created"]]
    r = {
        "leads": n, "not_contacted": sum(not f["contacted"] for f in leads), "contacted": sum(f["contacted"] for f in leads),
        "qualified": sum(f["qualified"] for f in leads), "not_eligible": sum(f["not_eligible"] for f in leads),
        "files": len(files), "stages": stages, "tat_exceeded": sum(bool((f["tat"] or {}).get("overdue")) for f in files),
        "approved": len(appr), "approved_amount": sum(f["approved_amount"] or 0 for f in appr),
        "approved_amount_missing": sum(not f["approved_amount"] for f in appr),
        "disbursed": len(disb), "disbursed_amount": sum(f["disbursed_amount"] or 0 for f in disb),
        "disbursed_amount_missing": sum(not f["disbursed_amount"] for f in disb),
        "declined": sum(f["declined"] for f in files), "median_age_days": mm.median(ages),
        "mature_leads": sum(a >= maturity_days for a in ages),
        "unattended_files": sum(1 for f in files if not f["final"] and (not f["last_activity"] or f["last_activity"] < now - timedelta(days=3))),
    }
    pct = lambda a, b: round(a * 100 / b, 1) if b else None  # noqa: E731
    r.update({"file_conv": pct(r["files"], n), "approval_conv": pct(r["approved"], n), "disb_conv": pct(r["disbursed"], n),
              "file_to_disb": pct(r["disbursed"], r["files"]), "not_eligible_pct": pct(r["not_eligible"], n),
              "not_contacted_pct": pct(r["not_contacted"], n)})
    return r


async def _spend(level_key: Optional[str], ids: Optional[set], q):
    """Sum daily ad-level insights in the range (account timezone dates) — never repeats campaign spend per ad."""
    mq = {}
    if q.get("date_from") or q.get("date_to"):
        mq["date"] = {**({"$gte": q["date_from"]} if q.get("date_from") else {}), **({"$lte": q["date_to"]} if q.get("date_to") else {})}
    for k in ("campaign_id", "adset_id", "ad_id"):
        if q.get(k):
            mq[k] = q[k]
    out = {}
    async for d in INS.find(mq, {"_id": 0}):
        k = d.get(level_key) if level_key else "_all"
        o = out.setdefault(k, {"spend": 0.0, "impressions": 0, "reach": 0, "clicks": 0, "meta_leads": 0})
        for f in o:
            o[f] += d.get(f) or 0
    return out


def _cost(r, sp):
    if not sp:
        return {}
    c = {**sp}
    div = lambda a, b: round(a / b, 2) if b else None  # noqa: E731
    c.update({"meta_cpl": div(sp["spend"], sp["meta_leads"]), "crm_cpl": div(sp["spend"], r["leads"]),
              "cost_per_file": div(sp["spend"], r["files"]), "cost_per_approved": div(sp["spend"], r["approved"]),
              "cost_per_disb": div(sp["spend"], r["disbursed"])})
    return c


async def _spend_status(role):
    tok, acct = _ads_cfg()
    st = await db.meta_meta.find_one({"key": "ads_sync"}, {"_id": 0}) or {}
    if role not in ("admin", "ops"):
        return {"available": False, "reason": "Spend is visible to Admin and Operations only."}
    if not tok or not acct:
        return {"available": False, "reason": "Meta spend unavailable — connect a Meta Marketing API token with the ads_read permission "
                "(META_ADS_ACCESS_TOKEN) and your ad account ID (META_AD_ACCOUNT_ID). The current WhatsApp token only has "
                "whatsapp_business_management / whatsapp_business_messaging / business_management scopes."}
    return {"available": bool(st.get("last_success")), "last_success": st.get("last_success"), "last_error": st.get("last_error"),
            "currency": st.get("currency"), "timezone": st.get("timezone"),
            "reason": None if st.get("last_success") else "Spend not synced yet — use Sync spend."}


def _q(**kw):
    return {k: v for k, v in kw.items() if v not in (None, "")}


@router.get("")
async def ad_performance(view: str = "cohort", level: str = "campaign", date_from: str = "", date_to: str = "", campaign_id: str = "",
                         adset_id: str = "", ad_id: str = "", loan_type: str = "", partner: str = "", processor: str = "",
                         status: str = "", stage: str = "", attr: str = "", min_sample: int = 20, maturity_days: int = 30,
                         mature_only: bool = False, rank_by: str = "cpl", user: dict = Depends(require_meta_access)):
    if level not in LEVELS or view not in ("cohort", "activity"):
        raise HTTPException(status_code=422, detail="Invalid level/view")
    q = _q(date_from=date_from, date_to=date_to, campaign_id=campaign_id, adset_id=adset_id, ad_id=ad_id, loan_type=loan_type,
           partner=partner, processor=processor, status=status, stage=stage, attr=attr)
    facts, role, now = await _facts(user, q)
    s, e = _rng(q)
    sst = await _spend_status(role)
    show_spend = sst.get("available")
    idk, namek = LEVELS[level]
    groups = {}
    for f in facts:
        groups.setdefault(f[idk] or "__unknown__", []).append(f)
    spend_q = dict(q)
    if show_spend and not q.get("date_from"):
        first = min((f["created"] for f in facts if f["created"]), default=None)
        if first:
            spend_q["date_from"] = mm.ist_date(first)  # never count spend from before the CRM's first Meta lead
    sst["spend_from"] = spend_q.get("date_from")
    spend = await _spend(idk, None, spend_q) if show_spend else {}
    rows = []
    for k, fs in groups.items():
        r = _agg(fs, view, s, e, now, maturity_days)
        if not r["leads"] and not r["files"] and not r["disbursed"]:
            continue
        rows.append({"id": None if k == "__unknown__" else k, "name": fs[0][namek] or mm.UNKNOWN if k != "__unknown__" else mm.UNKNOWN,
                     "latest_name": (fs[0]["latest"] or {}).get(namek) if k != "__unknown__" else None,
                     "campaign_id": fs[0]["campaign_id"], "adset_id": fs[0]["adset_id"], **r, **_cost(r, spend.get(k))})
    rows.sort(key=lambda x: -x["leads"])
    total = _agg(facts, view, s, e, now, maturity_days)
    total.update(_cost(total, (await _spend(None, None, spend_q)).get("_all")) if show_spend else {})
    # Best / worst ads (always ad level, cohort facts, optional mature-only cohort)
    by_ad = {}
    for f in facts:
        if f["ad_id"] and (not mature_only or (f["created"] and (now - f["created"]).days >= maturity_days)):
            by_ad.setdefault(f["ad_id"], []).append(f)
    ad_spend = await _spend("ad_id", None, spend_q) if show_spend else {}
    cands, small = [], 0
    for k, fs in by_ad.items():
        r = _agg(fs, "cohort", s, e, now, maturity_days)
        if not r["leads"]:
            continue
        if r["leads"] < min_sample:
            small += 1
            continue
        cands.append({"id": k, "name": fs[0]["ad_name"], "adset_name": fs[0]["adset_name"], **r, **_cost(r, ad_spend.get(k))})
    label, asc = RANKS.get(rank_by) if rank_by in RANKS and (show_spend or rank_by not in ("cpl", "cost_per_disb")) else RANKS["file_conv"]
    if rank_by not in RANKS or (not show_spend and rank_by in ("cpl", "cost_per_disb")):
        rank_by = "file_conv"
    field = "crm_cpl" if rank_by == "cpl" else rank_by
    ranked = [c for c in cands if c.get(field) is not None]
    ranked.sort(key=lambda c: c[field], reverse=not asc)

    def reason(c, best):
        txt = f"{c['leads']} leads, {c['files']} files, {c['disbursed']} disbursals; {label}: {c[field]}"
        txt += f" — {'best' if best else 'weakest'} {label.lower()} among {len(ranked)} eligible ads"
        if c["not_contacted_pct"] and c["not_contacted_pct"] >= 30:
            txt += f". Note: {c['not_contacted_pct']}% of leads not yet contacted (processing delay, not ad quality)"
        if c["unattended_files"]:
            txt += f". {c['unattended_files']} files with no activity for 3+ days"
        if c["median_age_days"] is not None and c["median_age_days"] < maturity_days:
            txt += f". Young cohort (median {c['median_age_days']} days) — outcomes may still change"
        return txt
    half = (len(ranked) + 1) // 2
    best = [{**c, "reason": reason(c, True)} for c in ranked[:min(5, half)]]
    worst = [{**c, "reason": reason(c, False)} for c in list(reversed(ranked[half:]))[:5]]
    runs = await db.meta_import_runs.find({}, {"_id": 0}).sort("started_at", 1).to_list(5000)
    rq = [r for r in runs if _in(_parse_dt(r["started_at"]), s, e)] if (s or e) else runs
    imports = {"tracking_since": runs[0]["started_at"] if runs else None, "runs": len(rq), "imported": sum(r["imported"] for r in rq),
               "failed": sum(r["failed"] for r in rq), "duplicates_skipped": sum(r["duplicates_skipped"] for r in rq),
               "received": sum(r["received"] for r in rq), "last_run": runs[-1] if runs else None}
    return {"view": view, "level": level, "as_of": datetime.now(timezone.utc).isoformat(), "rows": rows, "total": total,
            "best": best, "worst": worst, "insufficient_ads": small, "rank_label": label, "imports": imports, "spend": sst,
            "attributed": sum(f["has_attr"] for f in facts), "unattributed": sum(not f["has_attr"] for f in facts),
            "definitions": DEFS, "tat_definition": mm.TAT_DEFINITION}


DEFS = {
    "Cohort view": "Leads whose Meta lead-creation time falls in the period; their file outcomes as of now. Spend = same period.",
    "Activity view": "Events dated in the period by their own timestamps: CRM imports, file creation, approvals, disbursals.",
    "Contacted": "Lead status moved beyond NEW.", "Qualified": "Lead status LEAD or FILE.",
    "Not eligible": "Lead status NOT_QUALIFIED, or file stage Not Eligible.",
    "Approved (milestone)": "File ever reached Approved (status history or bank approval) — still counted after disbursal.",
    "Disbursed (milestone)": "File reached Disbursed or a bank marked disbursed.", "Declined": "Stage Declined / Not Eligible / Not Disbursed / Not Login, or a bank rejection.",
    "Meta CPL": "Spend ÷ leads Meta reports for the ad.", "CRM CPL": "Spend ÷ unique Meta leads imported into the CRM.",
    "Cost per file / approved / disbursed": "Spend ÷ distinct files / approved files / disbursed files.",
    "Amounts": "Stored bank approved/disbursed amounts; files missing an amount are counted separately.",
}


@router.get("/options")
async def options(user: dict = Depends(require_meta_access)):
    role, uid = _ctx(user)
    mq = {**NOT_DELETED, "meta_attr.ad_id": {"$ne": None}, **_scope(role, uid)}
    out = {"campaigns": {}, "adsets": {}, "ads": {}}
    async for d in db.meta_leads.find(mq, {"meta_attr": 1, "_id": 0}):
        a = d["meta_attr"]
        out["campaigns"][a.get("campaign_id")] = {"id": a.get("campaign_id"), "name": a.get("campaign_name")}
        out["adsets"][a.get("adset_id")] = {"id": a.get("adset_id"), "name": a.get("adset_name"), "campaign_id": a.get("campaign_id")}
        out["ads"][a.get("ad_id")] = {"id": a.get("ad_id"), "name": a.get("ad_name"), "adset_id": a.get("adset_id"), "campaign_id": a.get("campaign_id")}
    return {k: sorted(v.values(), key=lambda x: x["name"] or "") for k, v in out.items()}


def _metric_ok(f, metric):
    if metric.startswith("stage:"):
        return f["is_file"] and f["stage"] == metric[6:]
    return {"leads": True, "not_contacted": not f["contacted"], "contacted": f["contacted"], "qualified": f["qualified"],
            "not_eligible": f["not_eligible"], "files": f["is_file"], "approved": f["approved"], "disbursed": f["disbursed"],
            "declined": f["declined"], "tat_exceeded": bool((f["tat"] or {}).get("overdue"))}.get(metric, False)


@router.get("/records")
async def records(metric: str = "leads", view: str = "cohort", level: str = "", bucket: str = "", date_from: str = "", date_to: str = "",
                  campaign_id: str = "", adset_id: str = "", ad_id: str = "", loan_type: str = "", partner: str = "", processor: str = "",
                  status: str = "", stage: str = "", attr: str = "", format: str = "json", user: dict = Depends(require_meta_access)):
    q = _q(date_from=date_from, date_to=date_to, campaign_id=campaign_id, adset_id=adset_id, ad_id=ad_id, loan_type=loan_type,
           partner=partner, processor=processor, status=status, stage=stage, attr=attr)
    facts, _, _ = await _facts(user, q)
    s, e = _rng(q)
    if level in LEVELS:
        idk = LEVELS[level][0]
        facts = [f for f in facts if (f[idk] or "__unknown__") == (bucket or "__unknown__")]
    ev = ("files" if metric in ("files", "tat_exceeded", "declined") or metric.startswith("stage:") else
          metric if metric in ("approved", "disbursed") else "leads") if view == "activity" else None
    sel = [f for f in _select(facts, view, s, e, ev) if _metric_ok(f, metric)]
    cols = ["lead_id", "name", "phone", "status", "stage", "campaign_name", "adset_name", "ad_name", "partner_name", "processor_name",
            "created", "file_at", "approved_at", "approved_amount", "disbursed_at", "disbursed_amount"]
    rows = [{c: (mm.ist_date(f[c]) if isinstance(f[c], datetime) else f[c]) for c in cols} for f in sel]
    if format == "csv":
        buf = io.StringIO()
        w = csv.DictWriter(buf, fieldnames=cols)
        w.writeheader()
        w.writerows(rows)
        return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
                                 headers={"Content-Disposition": f"attachment; filename=meta_ad_{metric}.csv"})
    return {"items": rows, "total": len(rows)}


async def sync_spend(days: int = 1100) -> dict:
    tok, acct = _ads_cfg()
    if not tok or not acct:
        return {"ok": False, "error": "META_ADS_ACCESS_TOKEN / META_AD_ACCOUNT_ID not configured"}
    now = datetime.now(timezone.utc).isoformat()
    try:
        async with httpx.AsyncClient(timeout=60) as hc:
            info = (await hc.get(f"{GRAPH}/act_{acct}", params={"fields": "currency,timezone_name", "access_token": tok})).json()
            if info.get("error"):
                raise RuntimeError(info["error"].get("message"))
            until = datetime.now(timezone.utc).date()
            params = {"level": "ad", "time_increment": 1, "limit": 500, "access_token": tok,
                      "fields": "ad_id,adset_id,campaign_id,spend,impressions,reach,clicks,actions",
                      "time_range": f'{{"since":"{until - timedelta(days=days)}","until":"{until}"}}'}
            url, n = f"{GRAPH}/act_{acct}/insights", 0
            while url:
                d = (await hc.get(url, params=params)).json()
                if d.get("error"):
                    raise RuntimeError(d["error"].get("message"))
                for r in d.get("data", []):
                    leads = sum(int(a.get("value") or 0) for a in r.get("actions") or [] if a.get("action_type") in ("lead", "onsite_conversion.lead_grouped"))
                    await INS.update_one({"ad_id": r["ad_id"], "date": r["date_start"]}, {"$set": {
                        "adset_id": r.get("adset_id"), "campaign_id": r.get("campaign_id"), "spend": float(r.get("spend") or 0),
                        "impressions": int(r.get("impressions") or 0), "reach": int(r.get("reach") or 0), "clicks": int(r.get("clicks") or 0),
                        "meta_leads": leads, "synced_at": now}}, upsert=True)
                    n += 1
                url, params = (d.get("paging") or {}).get("next"), None
        await db.meta_meta.update_one({"key": "ads_sync"}, {"$set": {"last_success": now, "last_error": None, "rows": n,
                                      "currency": info.get("currency"), "timezone": info.get("timezone_name"), "ad_account_id": acct}}, upsert=True)
        return {"ok": True, "rows": n}
    except Exception as ex:
        await db.meta_meta.update_one({"key": "ads_sync"}, {"$set": {"last_error": f"{now}: {str(ex)[:300]}"}}, upsert=True)
        return {"ok": False, "error": str(ex)[:300]}


@router.post("/spend/sync")
async def spend_sync(user: dict = Depends(require_meta_access)):
    if _ctx(user)[0] not in ("admin", "ops"):
        raise HTTPException(status_code=403, detail="Admin/Ops only")
    return await sync_spend()
