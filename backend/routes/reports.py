"""
Optimized Reports and dashboard routes
Using MongoDB aggregation pipelines for better performance
"""
from fastapi import APIRouter, Depends, HTTPException
from datetime import datetime, timedelta, timezone
from typing import Optional
from bson import ObjectId
import asyncio

from utils.database import db
from utils.auth import (
    get_current_user, require_admin, require_crm_access, GP_ROLES,
    normalize_role, is_gp_role, get_user_team_ids,
)
from utils.helpers import serialize_doc, serialize_docs, format_duration, convert_to_ist, IST_OFFSET
from utils.hierarchy import load_user_index

# Every Growth Partner role can own call/lead activity, not just legacy 'telecaller'.
# Activity is keyed by str(_id) on some records and by the `id` field on others, so agents
# are matched through identity resolution rather than a single identifier.
AGENT_ROLE_FILTER = {"$in": GP_ROLES}

# This is an India-based CRM: all "day" boundaries and date buckets are IST, not UTC.
# Timestamps are stored in UTC, so an IST calendar day maps to a UTC window shifted by +5:30.
IST = timezone(IST_OFFSET)
IST_OFFSET_MS = int(IST_OFFSET.total_seconds() * 1000)


def _ist_midnight_utc(y, m, d):
    """UTC datetime corresponding to IST 00:00 of the given calendar day."""
    return datetime(y, m, d, tzinfo=IST).astimezone(timezone.utc)


def _ist_day_bounds_utc(date_str):
    """(start_utc, end_utc) covering the IST calendar day for an ISO 'YYYY-MM-DD' string."""
    d = datetime.fromisoformat(date_str.replace('Z', '').replace('+00:00', ''))
    start = _ist_midnight_utc(d.year, d.month, d.day)
    return start, start + timedelta(days=1)


def _as_date(field: str):
    """Coerce a timestamp field to a date. Legacy File records store ISO strings."""
    return {"$convert": {"input": f"${field}", "to": "date", "onError": None, "onNull": None}}


def date_range_match(field: str, start, end=None):
    """Range match on a timestamp that may be stored as a BSON date OR an ISO string."""
    conds = []
    if start:
        conds.append({"$gte": [_as_date(field), start]})
    if end:
        conds.append({"$lt": [_as_date(field), end]})
    if not conds:
        return {}
    return {"$expr": {"$and": conds}} if len(conds) > 1 else {"$expr": conds[0]}


def _file_created_date():
    """When the lead actually became a File (falls back to created_at for legacy records)."""
    return {"$ifNull": [_as_date("file_created_at"), _as_date("created_at")]}


def file_created_match(start, end=None):
    """Files that became Files inside the period - never 'files edited in the period'."""
    conds = []
    if start:
        conds.append({"$gte": [_file_created_date(), start]})
    if end:
        conds.append({"$lt": [_file_created_date(), end]})
    if not conds:
        return {}
    return {"$expr": {"$and": conds}} if len(conds) > 1 else {"$expr": conds[0]}


def _lead_created_date():
    """When the lead actually became a Lead (falls back to updated_at for legacy records)."""
    return {"$ifNull": [_as_date("lead_created_at"), _as_date("updated_at")]}


def lead_created_match(start, end=None):
    """Leads that became Leads inside the period - never 'leads edited in the period'."""
    conds = []
    if start:
        conds.append({"$gte": [_lead_created_date(), start]})
    if end:
        conds.append({"$lt": [_lead_created_date(), end]})
    if not conds:
        return {}
    return {"$expr": {"$and": conds}} if len(conds) > 1 else {"$expr": conds[0]}


# A File belongs to the GP who originated it; fall back to the current assignee.
FILE_OWNER = {"$ifNull": ["$source_id", "$assigned_to"]}


async def resolve_report_scope(current_user: dict):
    """Agent identifiers this user may see in reports. `None` = full scope (Admin/Ops).

    Reuses the shared scoping helper (`utils.auth.get_user_team_ids` -> `utils.hierarchy`),
    the same resolver behind the Manager Dashboard, Files list and Team Leaderboard, so a
    Manager/TL sees exactly their recursive subtree. HR and regular GPs are blocked.
    """
    role = normalize_role(current_user.get("role", ""))
    if role in ("admin", "ops"):
        return None
    if role == "manager" or (current_user.get("is_tl") and is_gp_role(role)):
        return set(await get_user_team_ids(current_user) or [])
    raise HTTPException(status_code=403, detail="Admin, Operations, Manager or Team Lead access required")


async def resolve_agent_query(user_id: Optional[str], active_only: bool = True, scope_ids=None):
    """Build the users query for reporting agents, resolving all identities of `user_id`.

    `scope_ids` (None = unrestricted) is the caller's permitted identifier set. Any requested
    `user_id` is intersected with it, so a scoped caller can never widen their scope through
    query parameters. Returns `None` for the query to signal FAIL CLOSED (0 rows).
    """
    query = {"role": AGENT_ROLE_FILTER}
    if active_only:
        query["is_active"] = True
    aliases = None
    if user_id:
        index = await load_user_index(db)
        aliases = index.aliases(user_id) or {user_id}
    if scope_ids is not None:
        allowed = set(scope_ids)
        if aliases is not None:
            allowed &= aliases
        if not allowed:
            return None, set()
        aliases = allowed
    if aliases is not None:
        or_clauses = [{"id": {"$in": sorted(aliases)}}]
        object_ids = [ObjectId(a) for a in aliases if ObjectId.is_valid(a)]
        if object_ids:
            or_clauses.append({"_id": {"$in": object_ids}})
        query["$or"] = or_clauses
    return query, aliases

router = APIRouter(prefix="/api", tags=["Reports"])

# ===================== STATUSES =====================

@router.get("/statuses")
async def get_statuses(current_user: dict = Depends(get_current_user)):
    return [
        {"id": "not_interested", "name": "Not Interested", "color": "#9E9E9E"},
        {"id": "follow_up", "name": "Follow Up", "color": "#9C27B0"},
        {"id": "leads", "name": "Lead", "color": "#00C853"},
        {"id": "file", "name": "File", "color": "#FF9800"}
    ]

# Helper to get date range
def get_date_range(period: str, from_date: str = None, to_date: str = None):
    # All boundaries are computed on the IST calendar, then returned as UTC datetimes.
    now = datetime.now(timezone.utc)
    now_ist = now.astimezone(IST)
    today_ist = now_ist.replace(hour=0, minute=0, second=0, microsecond=0)

    def u(dt_ist):
        return dt_ist.astimezone(timezone.utc)

    if from_date and to_date:
        start_date, _ = _ist_day_bounds_utc(from_date)
        _, end_date = _ist_day_bounds_utc(to_date)
        return start_date, end_date, "custom"
    elif period == "today":
        return u(today_ist), u(today_ist + timedelta(days=1)), period
    elif period == "this_week":
        start = today_ist - timedelta(days=today_ist.weekday())
        return u(start), u(now_ist + timedelta(days=1)), period
    elif period == "this_month":
        return u(today_ist.replace(day=1)), u(now_ist + timedelta(days=1)), period
    elif period == "last_month":
        first_of_this_month = today_ist.replace(day=1)
        last_month = first_of_this_month - timedelta(days=1)
        return u(last_month.replace(day=1)), u(first_of_this_month), period
    elif period == "three_months":
        start = now_ist - timedelta(days=90)
        return u(start.replace(hour=0, minute=0, second=0, microsecond=0)), u(now_ist + timedelta(days=1)), period
    elif period in ["all_time", "lifetime"]:
        return None, None, period
    else:
        return u(today_ist), u(today_ist + timedelta(days=1)), "today"

# ===================== DASHBOARD =====================

@router.get("/dashboard/stats")
async def get_dashboard_stats(
    period: str = "today",
    telecaller_id: str = None,
    from_date: str = None,
    to_date: str = None,
    current_user: dict = Depends(get_current_user)
):
    start_date, end_date, period = get_date_range(period, from_date, to_date)
    now = datetime.now(timezone.utc)
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    today_naive = today.replace(tzinfo=None)
    
    if current_user["role"] in ("admin", "hr"):
        # Build filters
        leads_filter = {}
        calls_filter = {}
        
        if telecaller_id and telecaller_id != "all":
            leads_filter["assigned_to"] = telecaller_id
            calls_filter["user_id"] = telecaller_id
        
        # Build time filters (tolerant of legacy ISO-string timestamps on File records)
        leads_time_filter = date_range_match("updated_at", start_date, end_date)
        leads_created_filter = date_range_match("created_at", start_date, end_date)
        files_created_filter = file_created_match(start_date, end_date)
        if start_date and end_date:
            calls_time_query = {"created_at": {"$gte": start_date, "$lt": end_date}}
        elif start_date:
            calls_time_query = {"created_at": {"$gte": start_date}}
        else:
            calls_time_query = {}
        
        # Leads are counted by the day they BECAME a Lead (lead_created_at), never last edit
        leads_created_at_filter = lead_created_match(start_date, end_date)

        # Run all queries in parallel
        queries = [
            db.leads.count_documents({**leads_filter, "status": "new", "created_at": {"$lt": today_naive}}),
            db.leads.count_documents({**leads_filter, **leads_created_filter}) if leads_created_filter else db.leads.count_documents(leads_filter),
            db.call_logs.count_documents({**calls_filter, **calls_time_query}),
            db.leads.count_documents({**leads_filter, **leads_created_at_filter, "status": {"$in": ["leads", "converted"]}}),
            db.leads.count_documents({**leads_filter, **files_created_filter, "status": "file"}),
            db.leads.count_documents({**leads_filter, **leads_created_at_filter, "status": "leads"}),
        ]
        
        results = await asyncio.gather(*queries)
        unused_data, total_data, connected, total_leads_generated, total_file, leads_status_count = results
        
        # Status counts aggregation
        status_match = {**leads_filter, **leads_time_filter} if leads_time_filter else leads_filter
        status_pipeline = [{"$match": status_match}, {"$group": {"_id": "$status", "count": {"$sum": 1}}}] if status_match else [{"$group": {"_id": "$status", "count": {"$sum": 1}}}]
        
        # Calls per user aggregation
        calls_match = {**calls_filter, **calls_time_query} if calls_time_query else calls_filter
        user_pipeline = [{"$match": calls_match}, {"$group": {"_id": "$user_name", "count": {"$sum": 1}}}] if calls_match else [{"$group": {"_id": "$user_name", "count": {"$sum": 1}}}]
        
        # Active telecallers
        active_pipeline = [{"$match": calls_match}, {"$group": {"_id": "$user_id"}}, {"$count": "count"}] if calls_match else [{"$group": {"_id": "$user_id"}}, {"$count": "count"}]
        
        # Incoming calls aggregation from daily_sessions
        incoming_session_filter = {"date": today}
        if telecaller_id and telecaller_id != "all":
            incoming_session_filter["user_id"] = telecaller_id
        
        incoming_pipeline = [
            {"$match": incoming_session_filter},
            {"$group": {
                "_id": None,
                "total_incoming_calls": {"$sum": {"$ifNull": ["$verified_incoming_calls", 0]}},
                "total_incoming_time_seconds": {"$sum": {"$ifNull": ["$verified_incoming_time_seconds", 0]}},
                "total_outgoing_calls": {"$sum": {"$ifNull": ["$calls_made", 0]}},
                "total_talk_time_seconds": {"$sum": {"$ifNull": ["$total_call_seconds", 0]}}
            }}
        ]
        
        agg_results = await asyncio.gather(
            db.leads.aggregate(status_pipeline).to_list(20),
            db.call_logs.aggregate(user_pipeline).to_list(100),
            db.call_logs.aggregate(active_pipeline).to_list(1),
            db.daily_sessions.aggregate(incoming_pipeline).to_list(1)
        )
        
        status_counts, calls_per_user, active_result, incoming_stats = agg_results
        active_telecallers = active_result[0]["count"] if active_result else 0
        
        # Extract incoming call stats
        incoming_data = incoming_stats[0] if incoming_stats else {}
        
        leads_by_status = {s["_id"]: s["count"] for s in status_counts}
        # Files and Leads are counted by the day they became one, not by their last edit
        leads_by_status["file"] = total_file
        leads_by_status["leads"] = leads_status_count

        return {
            "total_data": total_data,
            "unused_data": unused_data,
            "connected": connected,
            "total_leads_generated": total_leads_generated,
            "total_file": total_file,
            "leads_by_status": leads_by_status,
            "calls_per_user": {c["_id"]: c["count"] for c in calls_per_user},
            "active_telecallers": active_telecallers,
            "incoming_calls": {
                "count": incoming_data.get("total_incoming_calls", 0),
                "total_time_seconds": incoming_data.get("total_incoming_time_seconds", 0)
            },
            "outgoing_calls": {
                "count": incoming_data.get("total_outgoing_calls", 0),
                "total_time_seconds": incoming_data.get("total_talk_time_seconds", 0)
            },
            "period": period,
            "telecaller_id": telecaller_id
        }
    else:
        # Telecaller view - optimized with parallel queries
        user_id = current_user["id"]
        
        leads_time_filter = date_range_match("updated_at", start_date, end_date)
        leads_created_filter = date_range_match("created_at", start_date, end_date)
        files_created_filter = file_created_match(start_date, end_date)
        if start_date and end_date:
            calls_time_filter = {"created_at": {"$gte": start_date, "$lt": end_date}}
        elif start_date:
            calls_time_filter = {"created_at": {"$gte": start_date}}
        else:
            calls_time_filter = {}
        
        # Leads counted by the day they BECAME a Lead (lead_created_at), never last edit
        leads_created_at_filter = lead_created_match(start_date, end_date)

        # Run all queries in parallel
        queries = [
            db.leads.count_documents({"assigned_to": user_id, "status": "new", "created_at": {"$lt": today_naive}}),
            db.leads.count_documents({"assigned_to": user_id, **leads_created_filter}) if leads_created_filter else db.leads.count_documents({"assigned_to": user_id}),
            db.leads.count_documents({"assigned_to": user_id, "status": "file", **files_created_filter}),
            db.leads.count_documents({"assigned_to": user_id, "status": {"$in": ["leads", "converted"]}, **leads_created_at_filter}),
            db.leads.aggregate([{"$match": {"assigned_to": user_id, **leads_time_filter}}, {"$group": {"_id": "$status", "count": {"$sum": 1}}}]).to_list(20),
            db.call_logs.aggregate([
                {"$match": {"user_id": user_id, **calls_time_filter}},
                {"$group": {
                    "_id": None,
                    "total": {"$sum": 1},
                    "connected": {"$sum": {"$cond": [{"$eq": ["$outcome", "connected"]}, 1, 0]}},
                    "not_connecting": {"$sum": {"$cond": [{"$eq": ["$outcome", "not_connecting"]}, 1, 0]}},
                    "no_answer": {"$sum": {"$cond": [{"$eq": ["$outcome", "no_answer"]}, 1, 0]}},
                    "wrong_number": {"$sum": {"$cond": [{"$eq": ["$outcome", "wrong_number"]}, 1, 0]}},
                    "busy": {"$sum": {"$cond": [{"$eq": ["$outcome", "busy"]}, 1, 0]}},
                    "voicemail": {"$sum": {"$cond": [{"$eq": ["$outcome", "voicemail"]}, 1, 0]}}
                }}
            ]).to_list(1),
            db.daily_sessions.find_one({"user_id": user_id, "date": today}),
            db.leads.count_documents({"assigned_to": user_id, "status": "leads", **leads_created_at_filter})
        ]
        
        results = await asyncio.gather(*queries)
        my_unused_data, my_data, my_file, my_leads_generated, status_counts, call_stats, session, my_leads_only = results
        
        call_outcomes = call_stats[0] if call_stats else {"total": 0, "connected": 0, "not_connecting": 0, "no_answer": 0, "wrong_number": 0, "busy": 0, "voicemail": 0}
        
        # Get verified incoming call stats from daily session
        verified_incoming_calls = session.get("verified_incoming_calls", 0) if session else 0
        verified_incoming_time = session.get("verified_incoming_time_seconds", 0) if session else 0
        verified_talk_time = session.get("verified_talk_time_seconds", 0) if session else 0
        
        my_leads_by_status = {s["_id"]: s["count"] for s in status_counts if s["_id"]}
        my_leads_by_status["leads"] = my_leads_only
        my_leads_by_status["file"] = my_file

        return {
            "my_data": my_data,
            "my_unused_data": my_unused_data,
            "my_connected": call_outcomes.get("total", 0),
            "my_file": my_file,
            "my_leads_generated": my_leads_generated,
            "leads_by_status": my_leads_by_status,
            "call_outcomes": {
                "connected": call_outcomes.get("connected", 0),
                "not_connecting": call_outcomes.get("not_connecting", 0),
                "no_answer": call_outcomes.get("no_answer", 0),
                "wrong_number": call_outcomes.get("wrong_number", 0),
                "busy": call_outcomes.get("busy", 0),
                "voicemail": call_outcomes.get("voicemail", 0)
            },
            "incoming_calls": {
                "count": verified_incoming_calls,
                "total_time_seconds": verified_incoming_time
            },
            "verified_talk_time_seconds": verified_talk_time,
            "daily_session": serialize_doc(session) if session else None,
            "period": period
        }

@router.get("/dashboard/recent-calls")
async def get_recent_calls(limit: int = 10, current_user: dict = Depends(get_current_user)):
    query = {}
    if current_user["role"] == "telecaller":
        query["user_id"] = current_user["id"]
    
    # Use aggregation with lookup to get lead info in one query
    pipeline = [
        {"$match": query},
        {"$sort": {"created_at": -1}},
        {"$limit": limit},
        {"$addFields": {
            "lead_oid": {"$convert": {"input": "$lead_id", "to": "objectId",
                                      "onError": None, "onNull": None}},
            "lead_uuid": {"$cond": [{"$and": [{"$ne": ["$lead_id", None]},
                                              {"$ne": ["$lead_id", ""]}]},
                                    "$lead_id", "__no_lead__"]}
        }},
        {"$lookup": {
            "from": "leads",
            "localField": "lead_oid",
            "foreignField": "_id",
            "as": "lead_info"
        }},
        {"$unwind": {"path": "$lead_info", "preserveNullAndEmptyArrays": True}},
        {"$project": {
            "_id": 1,
            "lead_id": 1,
            "user_id": 1,
            "user_name": 1,
            "duration": 1,
            "outcome": 1,
            "notes": 1,
            "created_at": 1,
            "lead_name": {"$ifNull": ["$lead_info.name", "Unknown"]},
            "lead_phone": {"$ifNull": ["$lead_info.phone", ""]}
        }}
    ]
    
    calls = await db.call_logs.aggregate(pipeline, allowDiskUse=True).to_list(limit)
    return serialize_docs(calls)

# ===================== DETAILED REPORTS =====================

@router.get("/reports/detailed-calls")
async def get_detailed_call_report(
    from_date: str = None,
    to_date: str = None,
    telecaller_id: str = None,
    page: int = 1,
    page_size: int = 500,
    limit: int = None,
    current_user: dict = Depends(require_admin)
):
    """Detailed call report (manual + verified mobile calls), server-side paginated.

    Totals are always computed over the full matching dataset, never over the current page.
    """
    start_date, end_date, _ = get_date_range("today", from_date, to_date)
    MAX_ROWS = 25000
    page = max(1, page)
    page_size = max(1, min(page_size if limit is None else limit, MAX_ROWS))
    limit = MAX_ROWS
    
    match_stage = {}
    if start_date and end_date:
        match_stage["created_at"] = {"$gte": start_date, "$lt": end_date}
    elif start_date:
        match_stage["created_at"] = {"$gte": start_date}
    
    if telecaller_id and telecaller_id != "all":
        match_stage["user_id"] = telecaller_id
    
    pipeline = [
        {"$match": match_stage},
        {"$sort": {"created_at": -1}},
        {"$limit": limit},
        {"$addFields": {
            "lead_oid": {"$convert": {"input": "$lead_id", "to": "objectId",
                                      "onError": None, "onNull": None}},
            "lead_uuid": {"$cond": [{"$and": [{"$ne": ["$lead_id", None]},
                                              {"$ne": ["$lead_id", ""]}]},
                                    "$lead_id", "__no_lead__"]}
        }},
        {"$lookup": {
            "from": "leads",
            "localField": "lead_oid",
            "foreignField": "_id",
            "as": "lead_by_oid"
        }},
        {"$lookup": {
            "from": "leads",
            "localField": "lead_uuid",
            "foreignField": "id",
            "as": "lead_by_uuid"
        }},
        {"$addFields": {"lead": {"$ifNull": [{"$first": "$lead_by_oid"},
                                             {"$first": "$lead_by_uuid"}]}}},
        {"$project": {
            "id": {"$toString": "$_id"},
            "created_at": 1,
            "user_name": 1,
            "user_id": 1,
            "outcome": 1,
            "duration": 1,
            "duration_seconds": 1,
            "form_filling_seconds": 1,
            "notes": 1,
            "source": 1,
            "is_verified": 1,
            "lead_name": {"$ifNull": ["$lead.name", "Unknown"]},
            "lead_phone": {"$ifNull": ["$lead.phone", ""]},
            "lead_email": {"$ifNull": ["$lead.email", ""]},
            "lead_city": {"$ifNull": ["$lead.city", ""]},
            "lead_source": {"$ifNull": ["$lead.source", ""]},
            "lead_status": {"$ifNull": ["$lead.status", ""]}
        }}
    ]
    
    # Get calls from main call_logs collection
    call_logs = await db.call_logs.aggregate(pipeline, allowDiskUse=True).to_list(limit)
    
    # Also get verified mobile call logs
    verified_match = {}
    if start_date and end_date:
        verified_match["call_timestamp"] = {"$gte": start_date, "$lt": end_date}
    elif start_date:
        verified_match["call_timestamp"] = {"$gte": start_date}
    
    if telecaller_id and telecaller_id != "all":
        verified_match["user_id"] = telecaller_id
    
    verified_pipeline = [
        {"$match": verified_match},
        {"$sort": {"call_timestamp": -1}},
        {"$limit": limit},
        {"$addFields": {
            "lead_oid": {"$convert": {"input": "$lead_id", "to": "objectId",
                                      "onError": None, "onNull": None}},
            "lead_uuid": {"$cond": [{"$and": [{"$ne": ["$lead_id", None]},
                                              {"$ne": ["$lead_id", ""]}]},
                                    "$lead_id", "__no_lead__"]}
        }},
        {"$lookup": {
            "from": "leads",
            "localField": "lead_oid",
            "foreignField": "_id",
            "as": "lead_by_oid"
        }},
        {"$lookup": {
            "from": "leads",
            "localField": "lead_uuid",
            "foreignField": "id",
            "as": "lead_by_uuid"
        }},
        {"$addFields": {"lead": {"$ifNull": [{"$first": "$lead_by_oid"},
                                             {"$first": "$lead_by_uuid"}]}}},
        {"$project": {
            "id": {"$toString": "$_id"},
            "call_timestamp": 1,
            "user_name": 1,
            "user_id": 1,
            "call_type": 1,
            "duration_seconds": 1,
            "phone_number": 1,
            "lead_name": {"$ifNull": ["$lead.name", "Unknown"]},
            "lead_phone": {"$ifNull": ["$lead.phone", ""]},
            "lead_email": {"$ifNull": ["$lead.email", ""]},
            "lead_city": {"$ifNull": ["$lead.city", ""]},
            "lead_source": {"$ifNull": ["$lead.source", ""]},
            "lead_status": {"$ifNull": ["$lead.status", ""]}
        }}
    ]
    
    verified_logs = await db.verified_call_logs.aggregate(verified_pipeline, allowDiskUse=True).to_list(limit)
    
    detailed_calls = []
    
    # Process main call logs
    for log in call_logs:
        call_time = log.get("created_at")
        call_time_ist = convert_to_ist(call_time) if call_time else None
        duration = log.get("duration") or log.get("duration_seconds") or 0
        
        detailed_calls.append({
            "id": log.get("id", ""),
            "_sort_datetime": call_time.isoformat() if call_time else "",
            "call_date": call_time_ist.strftime("%Y-%m-%d") if call_time_ist else "",
            "call_time": call_time_ist.strftime("%I:%M %p") if call_time_ist else "",
            "caller_name": log.get("user_name", "Unknown"),
            "caller_id": log.get("user_id", ""),
            "customer_name": log.get("lead_name", "Unknown"),
            "customer_phone": log.get("lead_phone", ""),
            "customer_email": log.get("lead_email", ""),
            "customer_city": log.get("lead_city", ""),
            "customer_source": log.get("lead_source", ""),
            "lead_status": log.get("lead_status", ""),
            "call_outcome": log.get("outcome", ""),
            "call_duration_seconds": duration,
            "call_duration_formatted": format_duration(duration),
            "form_filling_seconds": log.get("form_filling_seconds", 0) or 0,
            "form_filling_formatted": format_duration(log.get("form_filling_seconds", 0) or 0),
            "notes": log.get("notes", ""),
            "source": log.get("source", "web"),
            "is_verified": log.get("is_verified", False),
        })
    
    # Process verified call logs (from mobile sync)
    for log in verified_logs:
        call_time = log.get("call_timestamp")
        call_time_ist = convert_to_ist(call_time) if call_time else None
        duration = log.get("duration_seconds") or 0
        
        # Map call_type to outcome
        call_type = log.get("call_type", "")
        outcome_map = {
            "outgoing": "connected" if duration > 0 else "no_answer",
            "incoming": "connected" if duration > 0 else "missed",
            "missed": "no_answer",
            "rejected": "not_connecting"
        }
        outcome = outcome_map.get(call_type, "unknown")
        
        detailed_calls.append({
            "id": log.get("id", ""),
            "_sort_datetime": call_time.isoformat() if call_time else "",
            "call_date": call_time_ist.strftime("%Y-%m-%d") if call_time_ist else "",
            "call_time": call_time_ist.strftime("%I:%M %p") if call_time_ist else "",
            "caller_name": log.get("user_name", "Unknown"),
            "caller_id": log.get("user_id", ""),
            "customer_name": log.get("lead_name", "Unknown"),
            "customer_phone": log.get("lead_phone") or log.get("phone_number", ""),
            "customer_email": log.get("lead_email", ""),
            "customer_city": log.get("lead_city", ""),
            "customer_source": log.get("lead_source", ""),
            "lead_status": log.get("lead_status", ""),
            "call_outcome": outcome,
            "call_duration_seconds": duration,
            "call_duration_formatted": format_duration(duration),
            "form_filling_seconds": 0,
            "form_filling_formatted": "0:00",
            "notes": "",
            "source": "mobile",
            "is_verified": True,
        })
    
    # Sort all calls by actual datetime descending (not formatted string)
    detailed_calls.sort(key=lambda x: x.get("_sort_datetime", ""), reverse=True)
    
    # Totals over the FULL matching dataset (not just the page)
    total_calls = len(detailed_calls)
    total_connected = sum(1 for c in detailed_calls if c.get("call_outcome") == "connected")
    total_duration = sum(c.get("call_duration_seconds") or 0 for c in detailed_calls)
    
    start_index = (page - 1) * page_size
    page_calls = detailed_calls[start_index:start_index + page_size]
    for call in page_calls:
        call.pop("_sort_datetime", None)
    
    return {
        "calls": page_calls,
        "total_count": total_calls,
        "page": page,
        "page_size": page_size,
        "total_pages": max(1, (total_calls + page_size - 1) // page_size),
        "has_more": start_index + len(page_calls) < total_calls,
        "totals": {
            "calls": total_calls,
            "connected": total_connected,
            "talk_time_seconds": total_duration,
            "talk_time_formatted": format_duration(total_duration)
        },
        "from_date": from_date,
        "to_date": to_date
    }

@router.get("/reports/telecallers")
async def get_telecaller_reports(
    period: str = "today",
    from_date: str = None,
    to_date: str = None,
    current_user: dict = Depends(require_admin)
):
    """Optimized telecaller reports using aggregation pipelines"""
    start_date, end_date, period = get_date_range(period, from_date, to_date)
    now = datetime.now(timezone.utc)
    
    # Get all reporting agents (every GP role, not just legacy 'telecaller')
    telecallers = await db.users.find({"role": AGENT_ROLE_FILTER}).to_list(2000)
    telecaller_ids = sorted({str(tc["_id"]) for tc in telecallers} |
                            {tc["id"] for tc in telecallers if isinstance(tc.get("id"), str)})
    telecaller_map = {str(tc["_id"]): tc for tc in telecallers}
    for tc in telecallers:
        if isinstance(tc.get("id"), str):
            telecaller_map.setdefault(tc["id"], tc)
    
    # Build time filters (tolerant of legacy ISO-string timestamps on File records)
    lead_time_filter = date_range_match("updated_at", start_date, end_date)
    lead_created_filter = date_range_match("created_at", start_date, end_date)
    lead_became_filter = lead_created_match(start_date, end_date)  # counted by the day it BECAME a Lead
    file_created_filter = file_created_match(start_date, end_date)
    index = await load_user_index(db)
    if start_date and end_date:
        call_time_filter = {"created_at": {"$gte": start_date, "$lt": end_date}}
        session_time_filter = {"date": {"$gte": start_date, "$lt": end_date}}
    elif start_date:
        call_time_filter = {"created_at": {"$gte": start_date}}
        session_time_filter = {"date": {"$gte": start_date}}
    else:
        call_time_filter = {}
        session_time_filter = {}
    
    # Aggregation for call stats per user
    call_pipeline = [
        {"$match": {"user_id": {"$in": telecaller_ids}, **call_time_filter}},
        {"$group": {
            "_id": "$user_id",
            "total_calls": {"$sum": 1},
            "total_duration": {"$sum": {"$ifNull": ["$duration", 0]}},
            "total_form_filling": {"$sum": {"$ifNull": ["$form_filling_seconds", 0]}},
            "connected": {"$sum": {"$cond": [{"$eq": ["$outcome", "connected"]}, 1, 0]}},
            "not_connecting": {"$sum": {"$cond": [{"$eq": ["$outcome", "not_connecting"]}, 1, 0]}},
            "no_answer": {"$sum": {"$cond": [{"$eq": ["$outcome", "no_answer"]}, 1, 0]}},
            "wrong_number": {"$sum": {"$cond": [{"$eq": ["$outcome", "wrong_number"]}, 1, 0]}},
            "busy": {"$sum": {"$cond": [{"$eq": ["$outcome", "busy"]}, 1, 0]}},
            "voicemail": {"$sum": {"$cond": [{"$eq": ["$outcome", "voicemail"]}, 1, 0]}}
        }}
    ]
    
    # Aggregation for lead stats per user (current assignments) - by day it BECAME a Lead
    lead_pipeline = [
        {"$match": {"assigned_to": {"$in": telecaller_ids}, **lead_became_filter}},
        {"$group": {
            "_id": {"user_id": "$assigned_to", "status": "$status"},
            "count": {"$sum": 1}
        }}
    ]
    
    # Aggregation for historical lead stats (reassigned leads - preserve old user's stats)
    # This counts leads that were reassigned AWAY from a user, using their status at time of reassignment
    historical_match = {"from_user_id": {"$in": telecaller_ids}}
    if lead_time_filter:
        historical_match.update(lead_time_filter)
    historical_lead_pipeline = [
        {"$match": historical_match},
        {"$group": {
            "_id": {"user_id": "$from_user_id", "status": "$previous_status"},
            "count": {"$sum": 1}
        }}
    ]
    
    # Aggregation for total leads created per user
    lead_created_pipeline = [
        {"$match": {"assigned_to": {"$in": telecaller_ids}, **lead_created_filter} if lead_created_filter else {"assigned_to": {"$in": telecaller_ids}}},
        {"$group": {"_id": "$assigned_to", "count": {"$sum": 1}}}
    ]
    
    # Aggregation for follow-ups per user
    followup_pipeline = [
        {"$match": {"user_id": {"$in": telecaller_ids}}},
        {"$group": {
            "_id": {"user_id": "$user_id", "completed": "$is_completed"},
            "count": {"$sum": 1}
        }}
    ]
    
    # Files counted by the day the lead BECAME a File, credited to the originating GP
    file_pipeline = [
        {"$match": {"status": "file", **file_created_filter}},
        {"$group": {"_id": FILE_OWNER, "count": {"$sum": 1}}}
    ]
    
    # Aggregation for sessions per user
    session_pipeline = [
        {"$match": {"user_id": {"$in": telecaller_ids}, **session_time_filter}},
        {"$group": {
            "_id": "$user_id",
            "total_break_seconds": {"$sum": {"$ifNull": ["$total_break_seconds", 0]}},
            "total_login_seconds": {"$sum": {"$ifNull": ["$total_login_seconds", 0]}}
        }}
    ]
    
    # Run all aggregations in parallel
    results = await asyncio.gather(
        db.call_logs.aggregate(call_pipeline).to_list(100),
        db.leads.aggregate(lead_pipeline).to_list(500),
        db.leads.aggregate(lead_created_pipeline).to_list(100),
        db.follow_ups.aggregate(followup_pipeline).to_list(200),
        db.daily_sessions.aggregate(session_pipeline).to_list(100),
        db.lead_assignment_history.aggregate(historical_lead_pipeline).to_list(500),
        db.leads.aggregate(file_pipeline).to_list(2000)
    )
    
    call_stats, lead_stats, lead_created_stats, followup_stats, session_stats, historical_lead_stats, file_stats = results
    file_map = {f["_id"]: f["count"] for f in file_stats if f.get("_id")}
    
    # Build lookup maps
    call_map = {c["_id"]: c for c in call_stats}
    lead_created_map = {c["_id"]: c["count"] for c in lead_created_stats}
    session_map = {s["_id"]: s for s in session_stats}
    
    # Build lead status map per user (current + historical for reassigned leads)
    lead_status_map = {}
    
    # First add current assignments
    for ls in lead_stats:
        user_id = ls["_id"]["user_id"]
        status = ls["_id"]["status"]
        if user_id not in lead_status_map:
            lead_status_map[user_id] = {}
        lead_status_map[user_id][status] = ls["count"]
    
    # Then add historical stats from reassigned leads (preserve old user's work)
    for hs in historical_lead_stats:
        user_id = hs["_id"]["user_id"]
        status = hs["_id"]["status"]
        if status and user_id:  # Skip if status is None/empty
            if user_id not in lead_status_map:
                lead_status_map[user_id] = {}
            # Add to existing count (don't overwrite)
            lead_status_map[user_id][status] = lead_status_map[user_id].get(status, 0) + hs["count"]
    
    # Build followup map per user
    followup_map = {}
    for fu in followup_stats:
        user_id = fu["_id"]["user_id"]
        is_completed = fu["_id"]["completed"]
        if user_id not in followup_map:
            followup_map[user_id] = {"pending": 0, "completed": 0}
        if is_completed:
            followup_map[user_id]["completed"] = fu["count"]
        else:
            followup_map[user_id]["pending"] = fu["count"]
    
    # Build report for each telecaller
    telecaller_reports = []
    total_calls = 0
    total_leads_generated = 0
    total_file = 0
    total_presentations = 0
    total_call_seconds = 0
    total_idle_seconds = 0
    total_form_filling_seconds = 0
    consumed_file_ids = set()  # each file's owner-id credited once (alias/duplicate-safe)
    
    for tc in telecallers:
        user_id = str(tc["_id"])
        calls = call_map.get(user_id, {})
        leads = lead_status_map.get(user_id, {})
        followups = followup_map.get(user_id, {"pending": 0, "completed": 0})
        sessions = session_map.get(user_id, {})
        
        user_total_calls = calls.get("total_calls", 0)
        user_call_seconds = calls.get("total_duration", 0)
        user_form_filling = calls.get("total_form_filling", 0)
        user_login_seconds = sessions.get("total_login_seconds", 0)
        user_break_seconds = sessions.get("total_break_seconds", 0)
        user_idle_seconds = max(0, user_login_seconds - user_call_seconds - user_break_seconds)
        
        # Files credited by the originating GP, resolving every legacy identifier
        owner_ids = {user_id} | ({tc.get("id")} if tc.get("id") else set()) | (index.aliases(user_id) or set())
        user_file = 0
        for oid in owner_ids:
            if oid in file_map and oid not in consumed_file_ids:
                user_file += file_map[oid]
                consumed_file_ids.add(oid)
        user_leads_generated = leads.get("leads", 0) + leads.get("converted", 0)
        user_presentations = leads.get("presentation", 0)
        
        calls_to_file_ratio = (user_file / user_total_calls * 100) if user_total_calls > 0 else 0
        avg_call_time = (user_call_seconds / user_total_calls) if user_total_calls > 0 else 0
        avg_form_filling = (user_form_filling / user_total_calls) if user_total_calls > 0 else 0
        
        telecaller_reports.append({
            "user_id": user_id,
            "user_name": tc.get("name", "Unknown"),
            "user_email": tc.get("email", ""),
            "is_active": tc.get("is_active", True),
            "last_activity": tc.get("last_activity"),
            "total_leads": lead_created_map.get(user_id, 0),
            "leads_generated": user_leads_generated,
            "file": user_file,
            "presentations": user_presentations,
            "total_calls": user_total_calls,
            "calls_connected": calls.get("connected", 0),
            "calls_not_connecting": calls.get("not_connecting", 0),
            "calls_no_answer": calls.get("no_answer", 0),
            "calls_wrong_number": calls.get("wrong_number", 0),
            "calls_busy": calls.get("busy", 0),
            "calls_voicemail": calls.get("voicemail", 0),
            "follow_ups_pending": followups["pending"],
            "follow_ups_completed": followups["completed"],
            "calls_to_file_ratio": calls_to_file_ratio,
            "total_call_seconds": user_call_seconds,
            "total_idle_seconds": user_idle_seconds,
            "total_login_seconds": user_login_seconds,
            "total_form_filling_seconds": user_form_filling,
            "avg_call_time_seconds": avg_call_time,
            "avg_form_filling_seconds": avg_form_filling,
            "status_counts": {**leads, "file": user_file}
        })
        
        total_calls += user_total_calls
        total_leads_generated += user_leads_generated
        total_file += user_file
        total_presentations += user_presentations
        total_call_seconds += user_call_seconds
        total_idle_seconds += user_idle_seconds
        total_form_filling_seconds += user_form_filling
    
    telecaller_reports.sort(key=lambda x: x["total_calls"], reverse=True)
    
    total_leads_in_period = sum(t["total_leads"] for t in telecaller_reports)
    overall_calls_to_file_ratio = (total_file / total_calls * 100) if total_calls > 0 else 0
    overall_avg_call_time = (total_call_seconds / total_calls) if total_calls > 0 else 0
    overall_avg_form_filling = (total_form_filling_seconds / total_calls) if total_calls > 0 else 0
    
    return {
        "telecallers": telecaller_reports,
        "overall": {
            "total_leads": total_leads_in_period,
            "total_calls": total_calls,
            "total_leads_generated": total_leads_generated,
            "total_file": total_file,
            "total_presentations": total_presentations,
            "active_telecallers": len([t for t in telecallers if t.get("is_active", True)]),
            "avg_calls_per_user": total_calls / len(telecallers) if telecallers else 0,
            "calls_to_file_ratio": overall_calls_to_file_ratio,
            "total_call_seconds": total_call_seconds,
            "total_idle_seconds": total_idle_seconds,
            "total_form_filling_seconds": total_form_filling_seconds,
            "avg_call_time_seconds": overall_avg_call_time,
            "avg_form_filling_seconds": overall_avg_form_filling
        },
        "period": period
    }

@router.get("/reports/hourly")
async def get_hourly_report(
    date: str = None,
    current_user: dict = Depends(require_crm_access)
):
    """
    Hourly report with role-based filtering:
    - Admin/Ops: See all telecallers
    - Manager: See telecallers under their management
    - TL: See their team members
    - GP: See only their own data
    """
    now = datetime.now(timezone.utc)

    # India CRM: bucket by IST calendar day. Timestamps are UTC, so the day window is shifted.
    if date:
        d = datetime.fromisoformat(date.replace('Z', '').replace('+00:00', ''))
        start_of_day = _ist_midnight_utc(d.year, d.month, d.day)
    else:
        now_ist = now.astimezone(IST)
        start_of_day = _ist_midnight_utc(now_ist.year, now_ist.month, now_ist.day)
    end_of_day = start_of_day + timedelta(days=1)
    target_date = start_of_day + IST_OFFSET  # wall-clock IST for the response label
    
    user_role = current_user.get("role", "").lower()
    # Handle different user ID formats
    user_obj_id = current_user.get("_id")
    user_uuid = current_user.get("id", "")
    
    # Convert to string for comparisons
    if user_obj_id:
        user_id = str(user_obj_id)
    else:
        user_id = user_uuid
    
    is_tl = current_user.get("is_tl", False)
    
    # Determine which telecallers to show based on role
    if user_role in ["admin", "ops"]:
        # Admin/Ops see all growth partners/telecallers (files are historical records -
        # count them even if the originating GP is now inactive; empty rows are suppressed below)
        telecallers = await db.users.find({
            "role": {"$in": ["telecaller", "growth_partner", "sales_agent", "partner"]}
        }).to_list(2000)
    elif user_role == "manager":
        # Manager sees GPs assigned to them (directly or via TLs)
        # First, get TLs under this manager
        tls_under_manager = await db.users.find({
            "manager_id": user_id,
            "is_tl": True
        }).to_list(100)
        tl_ids = [str(tl.get("_id", tl.get("id", ""))) for tl in tls_under_manager]
        
        # Get GPs directly under manager OR under their TLs
        telecallers = await db.users.find({
            "$or": [
                {"manager_id": user_id},  # Direct reports
                {"tl_id": {"$in": tl_ids}}  # Reports via TLs
            ],
            "role": {"$in": ["telecaller", "growth_partner", "sales_agent", "partner"]}
        }).to_list(2000)
    elif is_tl:
        # TL sees their team members - match by both possible ID formats
        telecallers = await db.users.find({
            "$or": [
                {"tl_id": user_id},
                {"tl_id": user_uuid}
            ],
            "role": {"$in": ["telecaller", "growth_partner", "sales_agent", "partner"]}
        }).to_list(2000)
    else:
        # GP sees only themselves - find by either _id or id field
        try:
            telecallers = await db.users.find({
                "$or": [
                    {"_id": ObjectId(user_id) if len(user_id) == 24 else None},
                    {"id": user_uuid}
                ]
            }).to_list(1)
        except Exception:
            # Fallback if ObjectId conversion fails
            telecallers = await db.users.find({"id": user_uuid}).to_list(1)
    
    telecaller_ids = [str(tc["_id"]) for tc in telecallers]
    telecaller_map = {str(tc["_id"]): tc for tc in telecallers}
    
    # Aggregation for calls by hour per user
    call_pipeline = [
        {"$match": {"user_id": {"$in": telecaller_ids}, "created_at": {"$gte": start_of_day, "$lt": end_of_day}}},
        {"$addFields": {
            "hour": {"$hour": {"$add": ["$created_at", 19800000]}}  # Add 5.5 hours in ms for IST
        }},
        {"$group": {
            "_id": {"user_id": "$user_id", "hour": "$hour"},
            "calls": {"$sum": 1},
            "connected": {"$sum": {"$cond": [{"$eq": ["$outcome", "connected"]}, 1, 0]}}
        }}
    ]
    
    # Aggregation for lead status updates by hour per user - by the day/hour it BECAME a Lead
    lead_pipeline = [
        {"$match": {"assigned_to": {"$in": telecaller_ids},
                    **lead_created_match(start_of_day, end_of_day)}},
        {"$addFields": {
            "hour": {"$hour": {"$add": [_lead_created_date(), 19800000]}}
        }},
        {"$group": {
            "_id": {"user_id": "$assigned_to", "hour": "$hour", "status": "$status"},
            "count": {"$sum": 1}
        }}
    ]
    
    # Files by the hour they became Files (IST), credited to the originating GP
    file_pipeline = [
        {"$match": {"status": "file", **file_created_match(start_of_day, end_of_day)}},
        {"$addFields": {"hour": {"$hour": {"$add": [_file_created_date(), 19800000]}},
                        "owner": FILE_OWNER}},
        {"$group": {"_id": {"user_id": "$owner", "hour": "$hour"}, "count": {"$sum": 1}}}
    ]
    
    call_stats, lead_stats, file_stats = await asyncio.gather(
        db.call_logs.aggregate(call_pipeline).to_list(2400),
        db.leads.aggregate(lead_pipeline).to_list(2400),
        db.leads.aggregate(file_pipeline).to_list(2400)
    )
    
    # Person-centric aggregation (alias-aware): one person can have several user docs,
    # and ownership fields may use any legacy identifier. Everything is resolved to a
    # single canonical person so nothing is lost or double-counted. Files are counted for
    # EVERY owner (any role) so totals match the Summary/dashboard exactly; managers/TLs
    # stay scoped to their own team.
    index = await load_user_index(db)
    is_admin_ops = user_role in ["admin", "ops"]
    scope_roots = None if is_admin_ops else {
        (index.root_for(tid) or f"raw:{tid}") for tid in telecaller_ids
    }

    def _pkey(raw):
        return index.root_for(raw) or f"raw:{raw}"

    persons = {}

    def _ensure(pkey, name):
        if pkey not in persons:
            persons[pkey] = {
                "user_id": pkey,
                "user_name": name or "Unknown",
                "hours": {h: {"calls": 0, "connected": 0, "presentations": 0, "leads": 0, "file": 0} for h in range(24)},
            }
        return persons[pkey]

    for cs in call_stats:
        pk = _pkey(cs["_id"]["user_id"])
        p = _ensure(pk, index.display_name(cs["_id"]["user_id"]))
        p["hours"][cs["_id"]["hour"]]["calls"] += cs["calls"]
        p["hours"][cs["_id"]["hour"]]["connected"] += cs["connected"]

    for ls in lead_stats:
        status = ls["_id"]["status"]
        if status not in ("leads", "converted", "presentation"):
            continue
        pk = _pkey(ls["_id"]["user_id"])
        p = _ensure(pk, index.display_name(ls["_id"]["user_id"]))
        if status == "presentation":
            p["hours"][ls["_id"]["hour"]]["presentations"] += ls["count"]
        else:
            p["hours"][ls["_id"]["hour"]]["leads"] += ls["count"]

    for fs in file_stats:
        owner = fs["_id"]["user_id"]
        pk = _pkey(owner)
        if scope_roots is not None and pk not in scope_roots:
            continue  # file owned outside this manager/TL's team
        p = _ensure(pk, index.display_name(owner))
        p["hours"][fs["_id"]["hour"]]["file"] += fs["count"]

    hourly_data = []
    overall_hours = {h: {"calls": 0, "connected": 0, "presentations": 0, "leads": 0, "file": 0} for h in range(24)}

    for p in persons.values():
        hours = p["hours"]
        hourly_breakdown = []
        for hour in range(24):
            h = hours[hour]
            if h["calls"] > 0 or h["presentations"] > 0 or h["leads"] > 0 or h["file"] > 0:
                hourly_breakdown.append({"hour": hour, "hour_label": f"{hour:02d}:00", **h})
                for key in ["calls", "connected", "presentations", "leads", "file"]:
                    overall_hours[hour][key] += h[key]

        if not hourly_breakdown:
            continue
        hourly_data.append({
            "user_id": p["user_id"],
            "user_name": p["user_name"],
            "total_calls": sum(h["calls"] for h in hours.values()),
            "total_connected": sum(h["connected"] for h in hours.values()),
            "total_presentations": sum(h["presentations"] for h in hours.values()),
            "total_leads": sum(h["leads"] for h in hours.values()),
            "total_file": sum(h["file"] for h in hours.values()),
            "hourly_breakdown": hourly_breakdown,
        })

    hourly_data.sort(key=lambda x: x["total_calls"], reverse=True)

    overall_hourly = [
        {"hour": h, "hour_label": f"{h:02d}:00", **overall_hours[h]}
        for h in range(24)
        if overall_hours[h]["calls"] > 0 or overall_hours[h]["presentations"] > 0
        or overall_hours[h]["leads"] > 0 or overall_hours[h]["file"] > 0
    ]
    
    return {
        "date": target_date.strftime("%Y-%m-%d"),
        "telecallers": hourly_data,
        "overall_hourly": overall_hourly
    }

@router.get("/reports/my-hourly")
async def get_my_hourly_report(
    date: str = None,
    current_user: dict = Depends(get_current_user)
):
    """
    Growth Partner's own hourly report.
    Shows C (Calls), CO (Connected), L (Leads), F (Files) by hour.
    Only shows the current user's data.
    """
    now = datetime.now(timezone.utc)

    # India CRM: bucket by IST calendar day. Timestamps are UTC, so the day window is shifted.
    if date:
        d = datetime.fromisoformat(date.replace('Z', '').replace('+00:00', ''))
        start_of_day = _ist_midnight_utc(d.year, d.month, d.day)
    else:
        now_ist = now.astimezone(IST)
        start_of_day = _ist_midnight_utc(now_ist.year, now_ist.month, now_ist.day)
    end_of_day = start_of_day + timedelta(days=1)
    target_date = start_of_day + IST_OFFSET  # wall-clock IST for the response label
    
    user_id = current_user["id"]
    user_name = current_user.get("name", current_user.get("email", "Unknown"))
    
    # Aggregation for calls by hour
    call_pipeline = [
        {"$match": {"user_id": user_id, "created_at": {"$gte": start_of_day, "$lt": end_of_day}}},
        {"$addFields": {
            "hour": {"$hour": {"$add": ["$created_at", 19800000]}}  # IST offset
        }},
        {"$group": {
            "_id": "$hour",
            "calls": {"$sum": 1},
            "connected": {"$sum": {"$cond": [{"$eq": ["$outcome", "connected"]}, 1, 0]}}
        }}
    ]
    
    # Aggregation for lead status updates by hour (leads only; Files handled separately)
    lead_pipeline = [
        {"$match": {"assigned_to": user_id, **lead_created_match(start_of_day, end_of_day)}},
        {"$addFields": {
            "hour": {"$hour": {"$add": [_lead_created_date(), 19800000]}}
        }},
        {"$group": {
            "_id": {"hour": "$hour", "status": "$status"},
            "count": {"$sum": 1}
        }}
    ]

    # Files counted ONLY by the hour the lead BECAME a File (file_created_at), never updated_at
    owner_ids = [user_id]
    if current_user.get("_id"):
        owner_ids.append(str(current_user["_id"]))
    file_pipeline = [
        {"$match": {"status": "file", "$expr": {"$and": [
            {"$in": [FILE_OWNER, owner_ids]},
            {"$gte": [_file_created_date(), start_of_day]},
            {"$lt": [_file_created_date(), end_of_day]},
        ]}}},
        {"$addFields": {"hour": {"$hour": {"$add": [_file_created_date(), 19800000]}}}},
        {"$group": {"_id": "$hour", "count": {"$sum": 1}}}
    ]

    call_stats, lead_stats, file_stats = await asyncio.gather(
        db.call_logs.aggregate(call_pipeline).to_list(24),
        db.leads.aggregate(lead_pipeline).to_list(100),
        db.leads.aggregate(file_pipeline).to_list(24)
    )
    
    # Build hourly data
    hours = {h: {"calls": 0, "connected": 0, "leads": 0, "file": 0} for h in range(24)}
    
    for cs in call_stats:
        hour = cs["_id"]
        hours[hour]["calls"] = cs["calls"]
        hours[hour]["connected"] = cs["connected"]
    
    for ls in lead_stats:
        hour = ls["_id"]["hour"]
        status = ls["_id"]["status"]
        if status in ["leads", "converted"]:
            hours[hour]["leads"] += ls["count"]

    # Files by conversion hour (file_created_at), not last-edit hour
    for fs in file_stats:
        hours[fs["_id"]]["file"] += fs["count"]
    
    # Build hourly breakdown (only non-empty hours)
    hourly_breakdown = []
    for hour in range(24):
        h = hours[hour]
        if h["calls"] > 0 or h["leads"] > 0 or h["file"] > 0:
            hourly_breakdown.append({
                "hour": hour,
                "hour_label": f"{hour:02d}:00",
                **h
            })
    
    # Calculate totals
    totals = {
        "total_calls": sum(h["calls"] for h in hours.values()),
        "total_connected": sum(h["connected"] for h in hours.values()),
        "total_leads": sum(h["leads"] for h in hours.values()),
        "total_file": sum(h["file"] for h in hours.values())
    }
    
    return {
        "date": target_date.strftime("%Y-%m-%d"),
        "user_id": user_id,
        "user_name": user_name,
        "hourly_breakdown": hourly_breakdown,
        **totals
    }

@router.get("/reports/daily-summary")
async def get_daily_summary(
    date: Optional[str] = None,
    current_user: dict = Depends(require_admin)
):
    if date:
        target_date = datetime.fromisoformat(date)
    else:
        target_date = datetime.now(timezone.utc)
    
    target_date = target_date.replace(hour=0, minute=0, second=0, microsecond=0)
    
    sessions = await db.daily_sessions.find({"date": target_date}).to_list(100)
    
    return {
        "date": target_date.isoformat(),
        "telecallers": serialize_docs(sessions)
    }

@router.get("/reports/verified-call-stats")
async def get_verified_call_stats(
    date: str = None,
    current_user: dict = Depends(require_admin)
):
    """Optimized verified call stats using aggregation"""
    now = datetime.now(timezone.utc)
    
    if date:
        target_date = datetime.fromisoformat(date).replace(tzinfo=timezone.utc)
    else:
        target_date = now
    
    start_of_day = target_date.replace(hour=0, minute=0, second=0, microsecond=0)
    end_of_day = start_of_day + timedelta(days=1)
    
    telecallers = await db.users.find({"role": AGENT_ROLE_FILTER, "is_active": True}).to_list(2000)
    telecaller_ids = sorted({str(tc["_id"]) for tc in telecallers} |
                            {tc["id"] for tc in telecallers if isinstance(tc.get("id"), str)})
    
    # Aggregation for verified logs
    verified_pipeline = [
        {"$match": {"user_id": {"$in": telecaller_ids}, "synced_at": {"$gte": start_of_day, "$lt": end_of_day}}},
        {"$group": {
            "_id": {"user_id": "$user_id", "call_type": "$call_type"},
            "count": {"$sum": 1},
            "total_duration": {"$sum": {"$cond": [{"$gt": ["$duration_seconds", 0]}, "$duration_seconds", 0]}},
            "connected_count": {"$sum": {"$cond": [{"$gt": ["$duration_seconds", 0]}, 1, 0]}}
        }}
    ]
    
    # Aggregation for manual logs
    manual_pipeline = [
        {"$match": {"user_id": {"$in": telecaller_ids}, "created_at": {"$gte": start_of_day, "$lt": end_of_day}}},
        {"$group": {"_id": "$user_id", "count": {"$sum": 1}}}
    ]
    
    # Get last sync times
    session_pipeline = [
        {"$match": {"user_id": {"$in": telecaller_ids}, "date": start_of_day}},
        {"$project": {"user_id": 1, "last_call_sync": 1}}
    ]
    
    verified_stats, manual_stats, session_stats = await asyncio.gather(
        db.verified_call_logs.aggregate(verified_pipeline).to_list(500),
        db.call_logs.aggregate(manual_pipeline).to_list(100),
        db.daily_sessions.aggregate(session_pipeline).to_list(100)
    )
    
    # Build lookup maps
    manual_map = {m["_id"]: m["count"] for m in manual_stats}
    session_map = {s["user_id"]: s.get("last_call_sync") for s in session_stats}
    
    # Build verified stats per user
    verified_map = {}
    for vs in verified_stats:
        user_id = vs["_id"]["user_id"]
        call_type = vs["_id"]["call_type"]
        if user_id not in verified_map:
            verified_map[user_id] = {"outgoing": {"count": 0, "connected": 0, "duration": 0}, "incoming": {"count": 0, "connected": 0, "duration": 0}, "missed": 0}
        if call_type == "outgoing":
            verified_map[user_id]["outgoing"]["count"] = vs["count"]
            verified_map[user_id]["outgoing"]["connected"] = vs["connected_count"]
            verified_map[user_id]["outgoing"]["duration"] = vs["total_duration"]
        elif call_type == "incoming":
            verified_map[user_id]["incoming"]["count"] = vs["count"]
            verified_map[user_id]["incoming"]["connected"] = vs["connected_count"]
            verified_map[user_id]["incoming"]["duration"] = vs["total_duration"]
        elif call_type == "missed":
            verified_map[user_id]["missed"] = vs["count"]
    
    stats = []
    for tc in telecallers:
        tc_id = str(tc["_id"])
        verified = verified_map.get(tc_id, {"outgoing": {"count": 0, "connected": 0, "duration": 0}, "incoming": {"count": 0, "connected": 0, "duration": 0}, "missed": 0})
        manual_count = manual_map.get(tc_id, 0)
        
        total_verified = verified["outgoing"]["count"] + verified["incoming"]["count"] + verified.get("missed", 0)
        total_all = max(total_verified, manual_count)
        
        if total_all == 0:
            verification_score = 0
            sync_status = "no_calls"
        elif total_verified >= manual_count and total_verified > 0:
            verification_score = 100
            sync_status = "synced"
        elif total_verified > 0:
            verification_score = round((total_verified / total_all) * 100)
            sync_status = "partial"
        else:
            verification_score = 0
            sync_status = "not_synced"
        
        last_sync = session_map.get(tc_id)
        
        stats.append({
            "user_id": tc_id,
            "user_name": tc.get("name", "Unknown"),
            "total_outgoing_calls": verified["outgoing"]["count"],
            "connected_outgoing_calls": verified["outgoing"]["connected"],
            "outgoing_talk_time_seconds": verified["outgoing"]["duration"],
            "total_incoming_calls": verified["incoming"]["count"],
            "connected_incoming_calls": verified["incoming"]["connected"],
            "incoming_talk_time_seconds": verified["incoming"]["duration"],
            "total_verified_talk_time_seconds": verified["outgoing"]["duration"] + verified["incoming"]["duration"],
            "missed_calls": verified.get("missed", 0),
            "manual_calls_logged": manual_count,
            "verification_score": verification_score,
            "sync_status": sync_status,
            "last_sync": last_sync.isoformat() if last_sync else None
        })
    
    return stats

@router.get("/reports/daily-tracking-sheet")
async def get_daily_tracking_sheet(
    user_id: str = None,
    month: int = None,
    year: int = None,
    start_date: str = None,
    end_date: str = None,
    current_user: dict = Depends(get_current_user)
):
    """Optimized daily tracking sheet using aggregation.

    Admin/Ops see every agent; Manager/TL are restricted to their recursive subtree.
    """
    scope_ids = await resolve_report_scope(current_user)
    now = datetime.now(timezone.utc)
    
    if not year:
        year = now.year
    if not month:
        month = now.month
    
    if start_date and end_date:
        range_start, _ = _ist_day_bounds_utc(start_date)
        _, range_end = _ist_day_bounds_utc(end_date)
    else:
        range_start = _ist_midnight_utc(year, month, 1)
        if month == 12:
            range_end = _ist_midnight_utc(year + 1, 1, 1)
        else:
            range_end = _ist_midnight_utc(year, month + 1, 1)
    
    query, _aliases = await resolve_agent_query(user_id, active_only=False, scope_ids=scope_ids)
    if query is None:
        return []  # requested agent is outside the caller's permitted scope
    
    telecallers = await db.users.find(query).to_list(2000)
    # Activity records reference either str(_id) or the `id` field - match both, deduplicated
    telecaller_ids = sorted({str(tc["_id"]) for tc in telecallers} |
                            {tc["id"] for tc in telecallers if isinstance(tc.get("id"), str)})
    
    # Aggregation for activity logs (login/logout times by date)
    activity_pipeline = [
        {"$match": {"user_id": {"$in": telecaller_ids}, "timestamp": {"$gte": range_start, "$lt": range_end}, "action": {"$in": ["login", "logout"]}}},
        {"$addFields": {"date_str": {"$dateToString": {"format": "%Y-%m-%d", "date": "$timestamp"}}}},
        {"$sort": {"timestamp": 1}},
        {"$group": {
            "_id": {"user_id": "$user_id", "date": "$date_str"},
            "activities": {"$push": {"action": "$action", "time": {"$dateToString": {"format": "%H:%M", "date": {"$add": ["$timestamp", 19800000]}}}}}
        }}
    ]
    
    # Aggregation for call logs by date
    call_pipeline = [
        {"$match": {"user_id": {"$in": telecaller_ids}, "created_at": {"$gte": range_start, "$lt": range_end}}},
        {"$addFields": {"date_str": {"$dateToString": {"format": "%Y-%m-%d", "date": {"$add": ["$created_at", 19800000]}}}}},
        {"$group": {
            "_id": {"user_id": "$user_id", "date": "$date_str"},
            "calls": {"$sum": 1},
            "connected": {"$sum": {"$cond": [{"$eq": ["$outcome", "connected"]}, 1, 0]}},
            "talk_time": {"$sum": {"$ifNull": ["$duration", 0]}}
        }}
    ]
    
    # Aggregation for leads by date (status=leads only; Files handled separately)
    lead_pipeline = [
        {"$match": {"assigned_to": {"$in": telecaller_ids}, "status": "leads", **lead_created_match(range_start, range_end)}},
        {"$addFields": {"date_str": {"$dateToString": {"format": "%Y-%m-%d", "date": {"$add": [_lead_created_date(), 19800000]}}}}},
        {"$group": {
            "_id": {"user_id": "$assigned_to", "date": "$date_str"},
            "count": {"$sum": 1}
        }}
    ]

    # Files counted ONLY by file_created_at (the day the lead became a File), credited to the originating GP
    file_pipeline = [
        {"$match": {"status": "file", **file_created_match(range_start, range_end)}},
        {"$addFields": {
            "owner": FILE_OWNER,
            "date_str": {"$dateToString": {"format": "%Y-%m-%d", "date": {"$add": [_file_created_date(), 19800000]}}}
        }},
        {"$group": {"_id": {"user_id": "$owner", "date": "$date_str"}, "count": {"$sum": 1}}}
    ]

    activity_stats, call_stats, lead_stats, file_stats = await asyncio.gather(
        db.activity_logs.aggregate(activity_pipeline).to_list(3100),
        db.call_logs.aggregate(call_pipeline).to_list(3100),
        db.leads.aggregate(lead_pipeline).to_list(3100),
        db.leads.aggregate(file_pipeline).to_list(3100)
    )
    
    # Build lookup maps
    activity_map = {}
    for a in activity_stats:
        key = (a["_id"]["user_id"], a["_id"]["date"])
        activity_map[key] = a["activities"]
    
    call_map = {}
    for c in call_stats:
        key = (c["_id"]["user_id"], c["_id"]["date"])
        call_map[key] = {"calls": c["calls"], "connected": c["connected"], "talk_time": c["talk_time"]}
    
    lead_map = {}
    for l in lead_stats:
        key = (l["_id"]["user_id"], l["_id"]["date"])
        if key not in lead_map:
            lead_map[key] = {"leads": 0, "files": 0}
        lead_map[key]["leads"] = l["count"]

    for f in file_stats:
        key = (f["_id"]["user_id"], f["_id"]["date"])
        if key not in lead_map:
            lead_map[key] = {"leads": 0, "files": 0}
        lead_map[key]["files"] += f["count"]
    
    results = []
    
    # One row per PERSON: duplicate/legacy documents of the same user must not produce
    # two rows or double-counted activity.
    index = await load_user_index(db)
    seen_people = set()
    deduped = []
    for tc in telecallers:
        person = index.root_for(str(tc["_id"])) or index.root_for(tc.get("id")) or str(tc["_id"])
        if person in seen_people:
            continue
        seen_people.add(person)
        deduped.append(tc)
    
    for tc in deduped:
        tc_id = str(tc["_id"])
        tc_keys = sorted({tc_id} | (index.aliases(tc_id) or set()) |
                         ({tc["id"]} if isinstance(tc.get("id"), str) else set()))
        tc_name = tc.get("name", "Unknown")
        file_goal = tc.get("file_goal", 5)
        
        daily_data = []
        total_calls = 0
        total_connected = 0
        total_leads = 0
        total_files = 0
        total_talk_time = 0
        
        current_date = range_start
        while current_date < range_end:
            date_str = current_date.strftime("%Y-%m-%d")
            day_name = current_date.strftime("%A")[:3]
            
            # Merge activity recorded under any of this person's identifiers
            activities = []
            calls = {"calls": 0, "connected": 0, "talk_time": 0}
            leads = {"leads": 0, "files": 0}
            for tc_key in tc_keys:
                key = (tc_key, date_str)
                activities.extend(activity_map.get(key, []))
                c = call_map.get(key)
                if c:
                    calls = {k: calls[k] + c[k] for k in calls}
                l = lead_map.get(key)
                if l:
                    leads = {k: leads[k] + l[k] for k in leads}
            
            start_time = None
            end_time = None
            for act in activities:
                if act["action"] == "login" and not start_time:
                    start_time = act["time"]
                elif act["action"] == "logout":
                    end_time = act["time"]
            
            if start_time or calls["calls"] > 0 or leads["leads"] > 0 or leads["files"] > 0:
                talk_time_seconds = calls["talk_time"]
                daily_data.append({
                    "date": date_str,
                    "day": day_name,
                    "start_time": start_time or "-",
                    "end_time": end_time or "-",
                    "calls": calls["calls"],
                    "connected": calls["connected"],
                    "leads": leads["leads"],
                    "files": leads["files"],
                    "talk_time_seconds": talk_time_seconds,
                    "talk_time_formatted": f"{talk_time_seconds // 60}m {talk_time_seconds % 60}s" if talk_time_seconds else "0m"
                })
                
                total_calls += calls["calls"]
                total_connected += calls["connected"]
                total_leads += leads["leads"]
                total_files += leads["files"]
                total_talk_time += talk_time_seconds
            
            current_date += timedelta(days=1)
        
        # Skip GPs with no activity in the range (the full GP list now includes
        # inactive/legacy records so every File is counted, but empty rows are hidden)
        if not daily_data:
            continue

        results.append({
            "user_id": tc_id,
            "user_name": tc_name,
            "month": range_start.strftime("%B %Y"),
            "achieved_files": total_files,
            "daily_data": daily_data,
            "totals": {
                "calls": total_calls,
                "connected": total_connected,
                "leads": total_leads,
                "files": total_files,
                "talk_time_seconds": total_talk_time,
                "talk_time_formatted": f"{total_talk_time // 3600}h {(total_talk_time % 3600) // 60}m" if total_talk_time else "0m"
            }
        })
    
    return results

# ===================== DATA MIGRATION =====================

@router.post("/admin/migrate-form-filling-time")
async def migrate_form_filling_time(current_user: dict = Depends(require_admin)):
    """Migration endpoint to estimate form filling time for historical call logs."""
    # Use bulk update for better performance
    result = await db.call_logs.update_many(
        {"$or": [{"form_filling_seconds": {"$exists": False}}, {"form_filling_seconds": None}, {"form_filling_seconds": 0}], "duration": {"$gt": 60}},
        {"$set": {"form_filling_seconds": 30}}
    )
    
    result2 = await db.call_logs.update_many(
        {"$or": [{"form_filling_seconds": {"$exists": False}}, {"form_filling_seconds": None}, {"form_filling_seconds": 0}], "duration": {"$lte": 60}},
        {"$set": {"form_filling_seconds": 15}}
    )
    
    return {
        "message": "Migration completed",
        "call_logs_updated": result.modified_count + result2.modified_count
    }


# ===================== MANAGER TEAM STATS =====================

@router.get("/reports/manager-team-stats")
async def get_manager_team_stats(
    period: str = "today",
    from_date: str = None,
    to_date: str = None,
    current_user: dict = Depends(get_current_user)
):
    """
    Comprehensive team stats for Manager role.
    Returns: calls, connected, leads, files metrics + GP performance breakdown.
    Manager sees their full hierarchy (direct GPs + TLs + GPs under those TLs).
    """
    from utils.auth import get_user_team_ids, normalize_role, is_gp_role
    
    user_role = normalize_role(current_user.get("role", ""))
    user_id = current_user.get("id")
    
    # Only managers and admin can use this endpoint
    if user_role not in ["manager", "admin", "ops"]:
        return {"error": "Unauthorized", "message": "This endpoint is for managers only"}
    
    # Get date range (supports a custom from_date/to_date range)
    start_date, end_date, period = get_date_range(period, from_date, to_date)
    
    index = await load_user_index(db)
    
    # Get team IDs for this manager
    if user_role == "manager":
        # Shared resolver (utils.hierarchy) - identical to Admin User Management and the Files
        # scope: full recursive subtree, all identity aliases, one row per person.
        team_users = index.subtree_members(user_id, include_self=False)
        team_ids = sorted(index.descendants(user_id))  # subtree aliases + the manager's own
    else:
        # Admin/Ops see all
        team_users = await db.users.find(
            {"is_active": True, "role": {"$nin": ["admin", "ops", "hr"]}},
            {"_id": 0, "id": 1, "name": 1, "full_name": 1, "email": 1, "is_tl": 1, "tl_id": 1}
        ).to_list(500)
        team_ids = [u["id"] for u in team_users if u.get("id")]
    
    # Keyed by EVERY alias so historical activity recorded under a legacy identifier
    # still resolves to the current team member.
    user_map = {}
    for u in team_users:
        uid = u.get("id") or str(u.get("_id") or "")
        if not uid:
            continue
        entry = {
            "name": u.get("full_name") or u.get("name") or u.get("email", "").split("@")[0],
            "is_tl": u.get("is_tl", False),
            "tl_id": u.get("tl_id")
        }
        for alias in (index.aliases(uid) or {uid}):
            user_map[alias] = entry
    
    # Build time filter for calls
    calls_time_filter = {}
    # Files by file_created_at, Leads by lead_created_at (never last-edit updated_at)
    files_time_filter = file_created_match(start_date, end_date)
    leads_time_filter = lead_created_match(start_date, end_date)
    if start_date and end_date:
        calls_time_filter = {"created_at": {"$gte": start_date, "$lt": end_date}}
    
    # Aggregation: Calls by user
    call_pipeline = [
        {"$match": {"user_id": {"$in": team_ids}, **calls_time_filter}},
        {"$group": {
            "_id": "$user_id",
            "calls": {"$sum": 1},
            "connected": {"$sum": {"$cond": [{"$eq": ["$outcome", "connected"]}, 1, 0]}}
        }}
    ]
    
    # Aggregation: Leads by user
    lead_pipeline = [
        {"$match": {"assigned_to": {"$in": team_ids}, **leads_time_filter}},
        {"$group": {
            "_id": {"user_id": "$assigned_to", "status": "$status"},
            "count": {"$sum": 1}
        }}
    ]
    
    # Aggregation: Files by user (status=file) - same time window as the other metrics
    files_pipeline = [
        {"$match": {"source_id": {"$in": team_ids}, "status": "file", **files_time_filter}},
        {"$group": {
            "_id": {"user_id": "$source_id", "file_status": "$file_status"},
            "count": {"$sum": 1}
        }}
    ]
    
    # Aggregation: Disbursement amounts
    disbursement_pipeline = [
        {"$match": {"source_id": {"$in": team_ids}, "status": "file", "eligibilities": {"$exists": True, "$ne": []}, **files_time_filter}},
        {"$unwind": "$eligibilities"},
        {"$match": {"eligibilities.disbursed": True}},
        {"$group": {
            "_id": "$source_id",
            "disbursed_amount": {"$sum": {"$toDouble": {"$ifNull": ["$eligibilities.disbursed_amount", 0]}}}
        }}
    ]
    
    # Run all aggregations in parallel
    call_stats, lead_stats, files_stats, disbursement_stats = await asyncio.gather(
        db.call_logs.aggregate(call_pipeline).to_list(500),
        db.leads.aggregate(lead_pipeline).to_list(1000),
        db.leads.aggregate(files_pipeline).to_list(1000),
        db.leads.aggregate(disbursement_pipeline).to_list(500)
    )
    
    # Process call stats
    call_map = {c["_id"]: {"calls": c["calls"], "connected": c["connected"]} for c in call_stats}
    
    # Process lead stats
    lead_map = {}
    for ls in lead_stats:
        uid = ls["_id"]["user_id"]
        status = ls["_id"]["status"]
        if uid not in lead_map:
            lead_map[uid] = {"leads": 0, "files": 0}
        if status in ["leads", "converted"]:
            lead_map[uid]["leads"] += ls["count"]
        elif status == "file":
            lead_map[uid]["files"] += ls["count"]
    
    # Process files stats
    files_map = {}
    for fs in files_stats:
        uid = fs["_id"]["user_id"]
        file_status = fs["_id"]["file_status"]
        if uid not in files_map:
            files_map[uid] = {"total_files": 0, "login": 0, "approved": 0, "disbursed": 0}
        files_map[uid]["total_files"] += fs["count"]
        if file_status == "login":
            files_map[uid]["login"] += fs["count"]
        elif file_status in ["approved", "sanctioned"]:
            files_map[uid]["approved"] += fs["count"]
        elif file_status == "disbursed":
            files_map[uid]["disbursed"] += fs["count"]
    
    # Process disbursement stats
    disbursement_map = {d["_id"]: d["disbursed_amount"] for d in disbursement_stats}
    
    # Build GP performance list
    gp_performance = []
    gp_call_stats = []
    
    total_calls = 0
    total_connected = 0
    total_leads = 0
    total_files = 0
    total_login = 0
    total_approved = 0
    total_disbursed = 0
    total_disbursed_amount = 0
    
    for uid, info in user_map.items():
        calls_data = call_map.get(uid, {"calls": 0, "connected": 0})
        leads_data = lead_map.get(uid, {"leads": 0, "files": 0})
        files_data = files_map.get(uid, {"total_files": 0, "login": 0, "approved": 0, "disbursed": 0})
        disb_amt = disbursement_map.get(uid, 0)
        
        # Aggregate totals
        total_calls += calls_data["calls"]
        total_connected += calls_data["connected"]
        total_leads += leads_data["leads"]
        total_files += files_data["total_files"]
        total_login += files_data["login"]
        total_approved += files_data["approved"]
        total_disbursed += files_data["disbursed"]
        total_disbursed_amount += disb_amt
        
        # GP Performance (files metrics)
        gp_performance.append({
            "id": uid,
            "name": info["name"],
            "is_tl": info["is_tl"],
            "total_files": files_data["total_files"],
            "login": files_data["login"],
            "approved": files_data["approved"],
            "disbursed": files_data["disbursed"],
            "disbursed_amount": disb_amt
        })
        
        # GP Call Stats
        gp_call_stats.append({
            "id": uid,
            "name": info["name"],
            "is_tl": info["is_tl"],
            "calls": calls_data["calls"],
            "connected": calls_data["connected"],
            "leads": leads_data["leads"],
            "files": leads_data["files"]
        })
    
    # Sort by total_files descending
    def merge_by_person(rows, numeric_fields):
        """Collapse alias rows into one row per person - legacy duplicates must not appear twice."""
        merged = {}
        for row in rows:
            key = index.root_for(row["id"]) or row["id"]
            if key not in merged:
                row = dict(row)
                row["id"] = index.canonical_id(row["id"]) or row["id"]
                merged[key] = row
            else:
                for field in numeric_fields:
                    merged[key][field] = merged[key].get(field, 0) + row.get(field, 0)
        return list(merged.values())
    
    gp_performance = merge_by_person(
        gp_performance, ["total_files", "login", "approved", "disbursed", "disbursed_amount"])
    gp_call_stats = merge_by_person(gp_call_stats, ["calls", "connected", "leads", "files"])
    
    gp_performance.sort(key=lambda x: -x["total_files"])
    gp_call_stats.sort(key=lambda x: -x["calls"])
    
    # Count TLs and active users today
    tls_count = sum(1 for u in team_users if u.get("is_tl"))
    
    # Check who made calls today
    today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    active_today_pipeline = [
        {"$match": {"user_id": {"$in": team_ids}, "created_at": {"$gte": today_start}}},
        {"$group": {"_id": "$user_id"}},
        {"$count": "count"}
    ]
    active_result = await db.call_logs.aggregate(active_today_pipeline).to_list(1)
    active_today = active_result[0]["count"] if active_result else 0
    
    return {
        "period": period,
        "total_team": len(team_users),
        "tls_count": tls_count,
        "active_today": active_today,
        "calls": total_calls,
        "connected": total_connected,
        "leads": total_leads,
        "files": total_files,
        "total_files": total_files,
        "files_login": total_login,
        "files_approved": total_approved,
        "files_disbursed": total_disbursed,
        "disbursed_amount": total_disbursed_amount,
        "gp_performance": gp_performance[:20],
        "gp_call_stats": gp_call_stats[:20]
    }



# Health check
@router.get("/health")
async def health_check():
    return {"status": "healthy", "service": "BANKEZEE Connect API"}
