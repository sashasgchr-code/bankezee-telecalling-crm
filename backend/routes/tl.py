"""
Team-Leader (TL) second-level calling + reporting — ADDITIVE layer over Connect.

Rules (do NOT break GP/Manager/Admin behaviour):
- The TL pool = Connect leads whose status became LEAD ("leads"/"converted") owned by GPs in the
  TL's team. TL calls are stored in the SEPARATE `tl_call_logs` collection with explicit
  attribution (tl_user_id + original gp_user_id + call_level="TL"). They are NEVER written into
  db.call_logs, so GP call metrics/hourly/summary stay based on GP calls only.
- A TL may update status like a GP. If a TL converts to FILE, file OWNERSHIP stays with the
  original GP (source_id = lead.assigned_to) so GP file count/commissions are unchanged; the TL
  gets separate credit via tl_call_logs.converted_to_file + lead.converted_by_tl audit fields.
"""
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from utils.database import db
from utils.auth import get_current_user
from utils.helpers import serialize_doc, serialize_docs

router = APIRouter(prefix="/api/tl", tags=["Team Leader"])

IST = timezone(timedelta(hours=5, minutes=30))
LEAD_STATUSES = ["leads", "converted"]
GP_ROLES = ["telecaller", "growth_partner", "sales_agent", "partner"]
TL_OUTCOMES = ["connected", "call_back", "not_answering", "switched_off", "not_interested", "not_qualified"]


class TLCallInput(BaseModel):
    duration_seconds: int = 0
    outcome: str
    resulting_status: Optional[str] = None
    reason: Optional[str] = None
    notes: Optional[str] = None
    follow_up_date: Optional[str] = None
    follow_up_time: Optional[str] = None
    convert_to_file: bool = False


def _uid_variants(u: dict):
    out = set()
    if u.get("id"):
        out.add(str(u["id"]))
    if u.get("_id"):
        out.add(str(u["_id"]))
    return out


def _now():
    return datetime.now(timezone.utc)


async def _tl_scope(current_user: dict):
    """Return (tl_ids set, gp_map {alias_id->name}, allowed_tl_list) using the ONE canonical
    identity/hierarchy resolver (utils.hierarchy.UserIndex) so every TL endpoint scopes
    identically to Admin User Management, the Manager Dashboard and the Files scope.

    - admin/ops/hr: all active TLs + all active GPs.
    - manager (incl. nested): full active subtree -> its TLs + its GPs.
    - TL: themselves + their active GPs.
    - GP (non-TL): blocked.

    `gp_ids`/`tl_ids` carry the FULL alias set (id, _id, connect_id, legacy_user_id) of each
    active Connect identity, so activity keyed under any already-linked identifier of the SAME
    person is matched. Separate/legacy duplicate accounts (different email, not linked) are NOT
    merged - they never enter the active subtree, so operational totals stay current-era only.
    """
    from utils.hierarchy import load_user_index

    role = (current_user.get("role") or "").lower()
    is_tl = bool(current_user.get("is_tl"))
    uid = current_user.get("id") or str(current_user.get("_id") or "")

    index = await load_user_index(db)

    if role in ("admin", "ops", "hr"):
        members = index.all_members(active_only=True)
    elif role == "manager":
        members = index.subtree_members(uid, include_self=False, active_only=True)
    elif is_tl:
        members = index.subtree_members(uid, include_self=True, active_only=True)
    else:
        raise HTTPException(status_code=403, detail="Team Leader access required")

    gp_role_set = set(GP_ROLES)
    tl_ids = set()
    allowed_tl_list = []
    seen_tl_root = set()
    gp_map = {}
    for m in members:
        cid = m.get("id") or str(m.get("_id"))
        aliases = index.aliases(cid) or {cid}
        role_l = (m.get("role") or "").lower()
        if m.get("is_tl"):
            root = index.root_for(cid) or cid
            if root not in seen_tl_root:
                seen_tl_root.add(root)
                allowed_tl_list.append({"id": cid, "name": m.get("name") or m.get("full_name") or "TL"})
            tl_ids |= aliases
        if role_l in gp_role_set:
            name = m.get("name") or m.get("full_name") or "GP"
            for a in aliases:
                gp_map[a] = name
    return tl_ids, gp_map, allowed_tl_list


# Statuses that indicate a customer reached the LEAD stage or beyond (converted to FILE).
LEAD_OR_BEYOND = ["leads", "converted", "file"]


def _became_lead_dt(lead):
    """Stable 'became LEAD' timestamp. Prefer lead_created_at; then a status-change-to-leads
    activity; then file_created_at; then created_at. Robust to missing lead_created_at."""
    v = lead.get("lead_created_at")
    if not v:
        for a in (lead.get("activities") or []):
            if (a.get("resulting_status") or a.get("to_status")) == "leads" and a.get("timestamp"):
                v = a.get("timestamp"); break
    if not v:
        v = lead.get("file_created_at") or lead.get("created_at") or lead.get("updated_at")
    if isinstance(v, str):
        try:
            v = datetime.fromisoformat(v.replace("Z", "+00:00"))
        except Exception:
            return None
    if isinstance(v, datetime) and v.tzinfo is None:
        v = v.replace(tzinfo=timezone.utc)
    return v


def _period_bounds(period=None, from_date=None, to_date=None):
    if from_date and to_date:
        s = datetime.fromisoformat(from_date).replace(tzinfo=IST).astimezone(timezone.utc)
        e = (datetime.fromisoformat(to_date).replace(tzinfo=IST) + timedelta(days=1)).astimezone(timezone.utc)
        return s, e
    now_ist = datetime.now(IST)
    today = datetime(now_ist.year, now_ist.month, now_ist.day, tzinfo=IST)
    p = (period or "today").lower()
    if p == "today":
        s, e = today, today + timedelta(days=1)
    elif p == "yesterday":
        s, e = today - timedelta(days=1), today
    elif p == "week":
        s, e = today - timedelta(days=today.weekday()), today + timedelta(days=1)
    elif p == "month":
        s, e = datetime(now_ist.year, now_ist.month, 1, tzinfo=IST), today + timedelta(days=1)
    else:
        return None, None
    return s.astimezone(timezone.utc), e.astimezone(timezone.utc)


async def _get_lead(lead_id):
    try:
        lead = await db.leads.find_one({"_id": ObjectId(lead_id)}) if len(lead_id) == 24 else None
    except Exception:
        lead = None
    if not lead:
        lead = await db.leads.find_one({"id": lead_id})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    return lead


# ------------------------------ leads pool ------------------------------
@router.get("/leads")
async def tl_leads(current_user: dict = Depends(get_current_user),
                   tl: Optional[str] = None, gp: Optional[str] = None,
                   tl_team: Optional[str] = None,
                   status: Optional[str] = None, outcome: Optional[str] = None,
                   converted: Optional[str] = None, q: Optional[str] = None,
                   period: Optional[str] = None,
                   from_date: Optional[str] = None, to_date: Optional[str] = None):
    tl_ids, gp_map, _ = await _tl_scope(current_user)
    gp_ids = set(gp_map.keys())
    if (gp and gp != "ALL") or (tl_team and tl_team != "ALL"):
        from utils.hierarchy import load_user_index
        _idx = await load_user_index(db)
        if gp and gp != "ALL":
            gp_ids = gp_ids & (_idx.aliases(gp) or {gp})
        # tl_team narrows the pool to the SELECTED Team Leader's canonical active team, so an
        # Admin/Manager viewing a specific TL gets the identical (complete, un-truncated) lead
        # population that TL sees in their own login - not a 5000-row slice of ALL GPs.
        if tl_team and tl_team != "ALL":
            gp_ids = gp_ids & set(_idx.descendants(tl_team, include_self=True, active_only=True))
    if not gp_ids:
        return {"leads": [], "total": 0}
    match = {"assigned_to": {"$in": list(gp_ids)}, "status": {"$in": LEAD_OR_BEYOND}}
    if status and status != "ALL":
        match["status"] = status
    leads = await db.leads.find(match).to_list(20000)

    # Filter by the date the customer BECAME a LEAD (period identical to /tl/stats).
    s, e = _period_bounds(period, from_date, to_date)
    # TL calls per lead for enrichment
    lids = [str(l.get("_id")) for l in leads] + [l.get("id") for l in leads if l.get("id")]
    tl_calls = await db.tl_call_logs.find({"lead_id": {"$in": lids}}).to_list(20000)
    calls_by_lead = {}
    for c in tl_calls:
        calls_by_lead.setdefault(c["lead_id"], []).append(c)

    out = []
    for l in leads:
        lid = str(l.get("_id"))
        dt = _became_lead_dt(l)
        if s and dt and not (s <= dt < e):
            continue
        if s and not dt:
            continue
        my_calls = sorted(calls_by_lead.get(lid, []), key=lambda c: c.get("created_at") or datetime.min.replace(tzinfo=timezone.utc))
        last_tl = my_calls[-1] if my_calls else None
        if tl and tl != "ALL":
            tvar = {tl}
            if not any(str(c.get("tl_user_id")) in tvar for c in my_calls):
                continue
        if outcome and outcome != "ALL" and (not last_tl or last_tl.get("outcome") != outcome):
            continue
        if converted == "yes" and not l.get("converted_by_tl"):
            continue
        if converted == "no" and l.get("converted_by_tl"):
            continue
        if q:
            hay = f"{l.get('name','')} {l.get('phone','')} {l.get('email','')}".lower()
            if q.lower() not in hay:
                continue
        out.append({
            "lead_id": lid,
            "name": l.get("name") or l.get("full_name") or "Unnamed",
            "phone": l.get("phone") or l.get("mobile") or "",
            "loan_type": l.get("requirement") or l.get("loan_type") or l.get("product") or "",
            "status": l.get("status"),
            "gp_id": l.get("assigned_to"),
            "gp_name": gp_map.get(str(l.get("assigned_to")), l.get("telecaller_name") or "—"),
            "lead_created_at": (_became_lead_dt(l).isoformat() if _became_lead_dt(l) else None),
            "last_call_at": (l.get("last_call_at").isoformat() if isinstance(l.get("last_call_at"), datetime) else l.get("last_call_at")),
            "last_call_outcome": l.get("last_call_outcome"),
            "follow_up_date": l.get("follow_up_date"),
            "follow_up_time": l.get("follow_up_time"),
            "tl_calls_count": len(my_calls),
            "last_tl_call": ({"tl_name": last_tl.get("tl_user_name"), "outcome": last_tl.get("outcome"),
                               "at": (last_tl.get("created_at").isoformat() if isinstance(last_tl.get("created_at"), datetime) else last_tl.get("created_at")),
                               "resulting_status": last_tl.get("resulting_status")} if last_tl else None),
            "converted_by_tl": bool(l.get("converted_by_tl")),
            "tl_conversion_at": (l.get("tl_conversion_at").isoformat() if isinstance(l.get("tl_conversion_at"), datetime) else l.get("tl_conversion_at")),
        })
    return {"leads": out, "total": len(out)}


@router.get("/stats")
async def tl_stats(current_user: dict = Depends(get_current_user),
                   period: str = "today", tl: Optional[str] = None, gp: Optional[str] = None,
                   from_date: Optional[str] = None, to_date: Optional[str] = None):
    tl_ids, gp_map, _ = await _tl_scope(current_user)
    gp_ids = set(gp_map.keys())
    if gp and gp != "ALL":
        from utils.hierarchy import load_user_index
        _idx = await load_user_index(db)
        gp_ids &= (_idx.aliases(gp) or {gp})

    def count_leads(p):
        s, e = _period_bounds(p)
        return s, e

    async def leads_in(s, e):
        leads = await db.leads.find({"assigned_to": {"$in": list(gp_ids)}, "status": {"$in": LEAD_OR_BEYOND}},
                                    {"lead_created_at": 1, "updated_at": 1, "created_at": 1, "file_created_at": 1, "activities": 1}).to_list(8000)
        n = 0
        for l in leads:
            dt = _became_lead_dt(l)
            if dt and (not s or s <= dt < e):
                n += 1
        return n

    counts = {}
    for label, p in [("today", "today"), ("yesterday", "yesterday"), ("week", "week"), ("month", "month")]:
        s, e = _period_bounds(p)
        counts[label] = await leads_in(s, e)

    s, e = _period_bounds(period, from_date, to_date)
    total_leads = await leads_in(s, e) if (s or from_date) else await leads_in(None, None)

    # TL activity within the selected range
    cq = {"gp_user_id": {"$in": list(gp_ids)} if gp_ids else {"$in": ["__none__"]}}
    if tl and tl != "ALL":
        cq["tl_user_id"] = tl
    all_tl_calls = await db.tl_call_logs.find(cq).to_list(50000)
    def in_range(c):
        at = c.get("created_at")
        if not isinstance(at, datetime):
            return False
        if at.tzinfo is None:
            at = at.replace(tzinfo=timezone.utc)
        return (not s) or (s <= at < e)
    ranged = [c for c in all_tl_calls if in_range(c)]
    contacted_leads = len({c["lead_id"] for c in ranged})
    connected = sum(1 for c in ranged if c.get("outcome") == "connected")
    files = sum(1 for c in ranged if c.get("converted_to_file"))
    pending = max(0, total_leads - contacted_leads)
    return {
        "range_total_leads": total_leads,
        "today": counts["today"], "yesterday": counts["yesterday"],
        "week": counts["week"], "month": counts["month"],
        "tl_calls": len(ranged), "contacted_leads": contacted_leads,
        "connected": connected, "files_converted": files, "pending": pending,
        "contact_rate": round(100 * contacted_leads / total_leads, 1) if total_leads else 0.0,
        "connected_rate": round(100 * connected / len(ranged), 1) if ranged else 0.0,
        "file_conversion_rate": round(100 * files / contacted_leads, 1) if contacted_leads else 0.0,
    }


# ------------------------------ TL calling ------------------------------
@router.post("/leads/{lead_id}/call")
async def tl_log_call(lead_id: str, inp: TLCallInput, current_user: dict = Depends(get_current_user)):
    tl_ids, gp_map, _ = await _tl_scope(current_user)
    if not (current_user.get("is_tl") or (current_user.get("role") or "").lower() in ("admin", "ops", "manager")):
        raise HTTPException(status_code=403, detail="Team Leader access required")
    lead = await _get_lead(lead_id)
    gp_id = lead.get("assigned_to")
    role = (current_user.get("role") or "").lower()
    # Only admin/ops may act outside the resolved team; managers & TLs are limited to gp_map.
    if str(gp_id) not in gp_map and role not in ("admin", "ops"):
        raise HTTPException(status_code=403, detail="This lead is not in your team")
    now = _now()
    gp_name = gp_map.get(str(gp_id))
    if not gp_name:
        gu = await db.users.find_one({"$or": [{"id": gp_id}, {"_id": ObjectId(gp_id)}]}) if gp_id else None
        gp_name = (gu or {}).get("name") if gu else (lead.get("telecaller_name") or "—")

    rec = {
        "tl_call_id": str(uuid.uuid4()),
        "lead_id": str(lead.get("_id")),
        "tl_user_id": current_user.get("id"),
        "tl_user_name": current_user.get("name"),
        "gp_user_id": gp_id,
        "gp_user_name": gp_name,
        "customer_name": lead.get("name") or lead.get("full_name"),
        "phone": lead.get("phone") or lead.get("mobile"),
        "started_at": (now - timedelta(seconds=int(inp.duration_seconds or 0))),
        "ended_at": now,
        "duration_seconds": int(inp.duration_seconds or 0),
        "outcome": inp.outcome,
        "resulting_status": inp.resulting_status,
        "reason": inp.reason,
        "notes": inp.notes,
        "follow_up_date": inp.follow_up_date,
        "follow_up_time": inp.follow_up_time,
        "call_level": "TL",
        "call_type": "TL_CALL",
        "converted_to_file": False,
        "created_at": now,
    }

    lead_set = {"updated_at": now}
    activity_note = f"TL Call — {current_user.get('name')} — {inp.outcome}" + (f" ({inp.duration_seconds}s)" if inp.duration_seconds else "")
    lead_activity = {"type": "tl_call", "call_level": "TL", "detail": activity_note,
                     "by": current_user.get("id"), "by_name": current_user.get("name"),
                     "outcome": inp.outcome, "resulting_status": inp.resulting_status,
                     "notes": inp.notes, "follow_up_date": inp.follow_up_date,
                     "follow_up_time": inp.follow_up_time, "timestamp": now.isoformat()}

    converted = False
    # Resulting status update (mirrors GP status semantics) WITHOUT touching GP call_logs.
    if inp.convert_to_file or (inp.resulting_status == "file"):
        if lead.get("status") != "file":
            source_id = lead.get("assigned_to") or lead.get("source_id") or gp_id
            source_name = lead.get("telecaller_name") or gp_name
            lead_set.update({
                "status": "file", "file_status": lead.get("file_status") or "new",
                "file_assigned_to": source_id, "source_id": source_id, "source_name": source_name,
                "source_system": lead.get("source_system") or "connect",
                "file_created_at": now,
                # Separate TL conversion attribution (audit) — GP keeps ownership.
                "converted_by_tl": True, "tl_user_id": current_user.get("id"),
                "tl_user_name": current_user.get("name"), "tl_conversion_at": now,
            })
            converted = True
            rec["converted_to_file"] = True
    elif inp.resulting_status:
        lead_set["status"] = inp.resulting_status
        if inp.resulting_status in LEAD_STATUSES and not lead.get("lead_created_at"):
            lead_set["lead_created_at"] = now
    if inp.follow_up_date:
        lead_set["follow_up_date"] = inp.follow_up_date
        lead_set["follow_up_time"] = inp.follow_up_time
    lead_set["last_tl_call_at"] = now
    lead_set["last_tl_call_outcome"] = inp.outcome

    await db.tl_call_logs.insert_one(rec)
    await db.leads.update_one({"_id": lead["_id"]}, {"$set": lead_set, "$push": {"activities": lead_activity}})
    # Cross-log to the shared activity feed so GP/Ops/Manager/Admin see it in lead history.
    await db.activities.insert_one({
        "lead_id": str(lead.get("_id")), "type": "tl_call", "call_level": "TL",
        "performed_by": current_user.get("id"), "performed_by_name": current_user.get("name"),
        "to_status": lead_set.get("status", lead.get("status")),
        "timestamp": now, "notes": activity_note + (f" · Notes: {inp.notes}" if inp.notes else ""),
    })
    return {"ok": True, "converted_to_file": converted, "tl_call_id": rec["tl_call_id"]}


# ------------------------------ TL call log ------------------------------
@router.get("/call-logs")
async def tl_call_logs(current_user: dict = Depends(get_current_user),
                       tl: Optional[str] = None, gp: Optional[str] = None,
                       outcome: Optional[str] = None, status: Optional[str] = None,
                       converted: Optional[str] = None,
                       from_date: Optional[str] = None, to_date: Optional[str] = None):
    tl_ids, gp_map, _ = await _tl_scope(current_user)
    # Match calls made by TLs in scope OR on leads owned by GPs in scope.
    q = {"$or": [{"tl_user_id": {"$in": list(tl_ids)}}, {"gp_user_id": {"$in": list(gp_map.keys())}}]}
    if tl and tl != "ALL":
        q = {"tl_user_id": tl}
    if gp and gp != "ALL":
        q.setdefault("gp_user_id", gp)
    if outcome and outcome != "ALL":
        q["outcome"] = outcome
    if status and status != "ALL":
        q["resulting_status"] = status
    if converted == "yes":
        q["converted_to_file"] = True
    s, e = _period_bounds(None, from_date, to_date)
    rows = await db.tl_call_logs.find(q).sort("created_at", -1).to_list(20000)
    out = []
    for c in rows:
        at = c.get("created_at")
        if s and isinstance(at, datetime):
            atx = at if at.tzinfo else at.replace(tzinfo=timezone.utc)
            if not (s <= atx < e):
                continue
        out.append({
            "tl_call_id": c.get("tl_call_id"), "tl_name": c.get("tl_user_name"),
            "customer": c.get("customer_name"), "phone": c.get("phone"),
            "gp_name": c.get("gp_user_name"), "gp_id": c.get("gp_user_id"),
            "at": (at.isoformat() if isinstance(at, datetime) else at),
            "duration_seconds": c.get("duration_seconds", 0), "outcome": c.get("outcome"),
            "resulting_status": c.get("resulting_status"), "reason": c.get("reason"),
            "notes": c.get("notes"), "follow_up_date": c.get("follow_up_date"),
            "follow_up_time": c.get("follow_up_time"), "converted_to_file": bool(c.get("converted_to_file")),
        })
    return {"logs": out, "total": len(out)}


# ------------------------------ TL reports ------------------------------
def _tl_of(c, tl_name_map):
    return c.get("tl_user_id"), (c.get("tl_user_name") or tl_name_map.get(str(c.get("tl_user_id")), "TL"))


@router.get("/reports/summary")
async def tl_summary(current_user: dict = Depends(get_current_user),
                     period: str = "today", tl: Optional[str] = None,
                     gp: Optional[str] = None, from_date: Optional[str] = None, to_date: Optional[str] = None):
    tl_ids, gp_map, allowed = await _tl_scope(current_user)
    tl_name_map = {a["id"]: a["name"] for a in allowed}
    s, e = _period_bounds(period, from_date, to_date)
    q = {"$or": [{"tl_user_id": {"$in": list(tl_ids)}}, {"gp_user_id": {"$in": list(gp_map.keys())}}]}
    if tl and tl != "ALL":
        q = {"tl_user_id": tl}
    if gp and gp != "ALL":
        q["gp_user_id"] = gp
    rows = await db.tl_call_logs.find(q).to_list(50000)
    per = {}
    for c in rows:
        at = c.get("created_at")
        if s and isinstance(at, datetime):
            atx = at if at.tzinfo else at.replace(tzinfo=timezone.utc)
            if not (s <= atx < e):
                continue
        tid, tname = _tl_of(c, tl_name_map)
        b = per.setdefault(tid, {"tl_id": tid, "tl_name": tname, "tl_calls": 0, "connected": 0,
                                 "call_back": 0, "not_answering": 0, "switched_off": 0,
                                 "not_interested": 0, "not_qualified": 0, "follow_ups": 0,
                                 "files": 0, "leads_progressed": 0, "talk_seconds": 0, "customers": set()})
        b["tl_calls"] += 1
        b["talk_seconds"] += int(c.get("duration_seconds") or 0)
        b["customers"].add(c.get("lead_id"))
        o = c.get("outcome")
        if o in b:
            b[o] += 1
        if c.get("follow_up_date"):
            b["follow_ups"] += 1
        if c.get("converted_to_file"):
            b["files"] += 1
        if c.get("resulting_status") in LEAD_STATUSES:
            b["leads_progressed"] += 1
    partners = []
    for b in per.values():
        contacted = len(b.pop("customers"))
        b["contacted"] = contacted
        b["conversion_pct"] = round(100 * b["files"] / contacted, 1) if contacted else 0.0
        partners.append(b)
    partners.sort(key=lambda x: -x["tl_calls"])
    overall = {k: sum(p.get(k, 0) for p in partners) for k in
               ["tl_calls", "connected", "call_back", "not_answering", "switched_off",
                "not_interested", "not_qualified", "follow_ups", "files", "leads_progressed", "talk_seconds", "contacted"]}
    overall["conversion_pct"] = round(100 * overall["files"] / overall["contacted"], 1) if overall["contacted"] else 0.0
    return {"overall": overall, "tls": partners}


@router.get("/reports/hourly")
async def tl_hourly(current_user: dict = Depends(get_current_user), date: Optional[str] = None, tl: Optional[str] = None):
    tl_ids, gp_map, allowed = await _tl_scope(current_user)
    tl_name_map = {a["id"]: a["name"] for a in allowed}
    if date:
        d = datetime.fromisoformat(date)
        s = datetime(d.year, d.month, d.day, tzinfo=IST).astimezone(timezone.utc)
    else:
        n = datetime.now(IST)
        s = datetime(n.year, n.month, n.day, tzinfo=IST).astimezone(timezone.utc)
    e = s + timedelta(days=1)
    q = {"$or": [{"tl_user_id": {"$in": list(tl_ids)}}, {"gp_user_id": {"$in": list(gp_map.keys())}}]}
    if tl and tl != "ALL":
        q = {"tl_user_id": tl}
    rows = await db.tl_call_logs.find(q).to_list(50000)
    hours = {}
    for c in rows:
        at = c.get("created_at")
        if not isinstance(at, datetime):
            continue
        atx = at if at.tzinfo else at.replace(tzinfo=timezone.utc)
        if not (s <= atx < e):
            continue
        hr = (atx + timedelta(hours=5, minutes=30)).hour
        slot = hours.setdefault(hr, {"hour": hr, "tl_calls": 0, "connected": 0, "call_back": 0, "not_answering": 0, "files": 0})
        slot["tl_calls"] += 1
        if c.get("outcome") == "connected":
            slot["connected"] += 1
        if c.get("outcome") == "call_back":
            slot["call_back"] += 1
        if c.get("outcome") == "not_answering":
            slot["not_answering"] += 1
        if c.get("converted_to_file"):
            slot["files"] += 1
    return {"hours": sorted(hours.values(), key=lambda h: h["hour"]),
            "date": (date or datetime.now(IST).date().isoformat())}


@router.get("/reports/conversion")
async def tl_conversion(current_user: dict = Depends(get_current_user),
                        period: str = "month", tl: Optional[str] = None,
                        from_date: Optional[str] = None, to_date: Optional[str] = None):
    stats = await tl_stats(current_user, period, tl, None, from_date, to_date)
    return {
        "leads_received": stats["range_total_leads"],
        "contacted": stats["contacted_leads"],
        "connected": stats["connected"],
        "files": stats["files_converted"],
        "contact_rate": stats["contact_rate"],
        "connected_rate": stats["connected_rate"],
        "file_conversion_rate": stats["file_conversion_rate"],
    }


@router.get("/meta")
async def tl_meta(current_user: dict = Depends(get_current_user)):
    """Filter option lists (allowed TLs + GPs) and whether the caller is a TL (for UI defaults).

    Each GP carries a CANONICAL tl_id (the same id exposed in `tls`) so the web page can scope
    the lead list under a selected TL. GP->TL is resolved from the user's stored tl_id /
    team_lead_id / team_lead, canonicalized across id/_id/name/email/username variants — records
    frequently store a non-canonical id variant (e.g. Mongo _id) which otherwise breaks scoping.
    """
    tl_ids, gp_map, allowed = await _tl_scope(current_user)
    from utils.hierarchy import load_user_index
    index = await load_user_index(db)
    all_users = await db.users.find({}).to_list(5000)

    # Every allowed TL by its canonical id (the id used in `allowed`/`tls`).
    allowed_ids = {t["id"] for t in allowed}

    def _resolve_tl(u):
        """Canonical TL id for a GP, resolved through the shared identity index. Only returns
        a TL that is actually in this caller's allowed scope."""
        for raw in (u.get("tl_id"), u.get("team_lead_id"), u.get("team_lead")):
            if raw:
                c = index.canonical_id(raw)
                if c and c in allowed_ids:
                    return c
        return ""

    gp_tl = {}
    for u in all_users:
        if (u.get("role") or "").lower() in GP_ROLES:
            canonical = _resolve_tl(u)
            for v in _uid_variants(u):
                gp_tl[v] = canonical

    # dedupe gp by name->id (ids have variants); build simple list
    seen = set()
    gp_list = []
    for gid, gname in gp_map.items():
        if gname in seen:
            continue
        seen.add(gname)
        gp_list.append({"id": gid, "name": gname, "tl_id": gp_tl.get(gid, "")})
    my_id = current_user.get("id")
    return {"tls": allowed, "gps": sorted(gp_list, key=lambda x: x["name"]),
            "is_tl": bool(current_user.get("is_tl")), "me": my_id, "outcomes": TL_OUTCOMES}
