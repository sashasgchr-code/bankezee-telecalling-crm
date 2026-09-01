"""
Optimized Reports and dashboard routes
Using MongoDB aggregation pipelines for better performance
"""
from fastapi import APIRouter, Depends
from datetime import datetime, timedelta, timezone
from typing import Optional
from bson import ObjectId
import asyncio

from utils.database import db
from utils.auth import get_current_user, require_admin
from utils.helpers import serialize_doc, serialize_docs, format_duration, convert_to_ist, IST_OFFSET

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
    now = datetime.now(timezone.utc)
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    
    if from_date and to_date:
        start_date = datetime.fromisoformat(from_date.replace('Z', '+00:00')).replace(tzinfo=timezone.utc)
        end_date = datetime.fromisoformat(to_date.replace('Z', '+00:00')).replace(tzinfo=timezone.utc) + timedelta(days=1)
        return start_date, end_date, "custom"
    elif period == "today":
        return today, today + timedelta(days=1), period
    elif period == "this_week":
        start = today - timedelta(days=today.weekday())
        return start, now + timedelta(days=1), period
    elif period == "this_month":
        return today.replace(day=1), now + timedelta(days=1), period
    elif period == "last_month":
        first_of_this_month = today.replace(day=1)
        last_month = first_of_this_month - timedelta(days=1)
        return last_month.replace(day=1), first_of_this_month, period
    elif period == "three_months":
        start = now - timedelta(days=90)
        return start.replace(hour=0, minute=0, second=0, microsecond=0), now + timedelta(days=1), period
    elif period in ["all_time", "lifetime"]:
        return None, None, period
    else:
        return today, today + timedelta(days=1), "today"

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
    
    if current_user["role"] == "admin":
        # Build filters
        leads_filter = {}
        calls_filter = {}
        
        if telecaller_id and telecaller_id != "all":
            leads_filter["assigned_to"] = telecaller_id
            calls_filter["user_id"] = telecaller_id
        
        # Build time filters
        if start_date and end_date:
            leads_time_filter = {"updated_at": {"$gte": start_date, "$lt": end_date}}
            leads_created_filter = {"created_at": {"$gte": start_date, "$lt": end_date}}
            calls_time_query = {"created_at": {"$gte": start_date, "$lt": end_date}}
        elif start_date:
            leads_time_filter = {"updated_at": {"$gte": start_date}}
            leads_created_filter = {"created_at": {"$gte": start_date}}
            calls_time_query = {"created_at": {"$gte": start_date}}
        else:
            leads_time_filter = {}
            leads_created_filter = {}
            calls_time_query = {}
        
        # Run all queries in parallel
        queries = [
            db.leads.count_documents({**leads_filter, "status": "new", "created_at": {"$lt": today_naive}}),
            db.leads.count_documents({**leads_filter, **leads_created_filter}) if leads_created_filter else db.leads.count_documents(leads_filter),
            db.call_logs.count_documents({**calls_filter, **calls_time_query}),
            db.leads.count_documents({**leads_filter, **leads_time_filter, "status": {"$in": ["leads", "converted"]}}),
            db.leads.count_documents({**leads_filter, **leads_time_filter, "status": "file"}),
        ]
        
        results = await asyncio.gather(*queries)
        unused_data, total_data, connected, total_leads_generated, total_file = results
        
        # Status counts aggregation
        status_match = {**leads_filter, **leads_time_filter} if leads_time_filter else leads_filter
        status_pipeline = [{"$match": status_match}, {"$group": {"_id": "$status", "count": {"$sum": 1}}}] if status_match else [{"$group": {"_id": "$status", "count": {"$sum": 1}}}]
        
        # Calls per user aggregation
        calls_match = {**calls_filter, **calls_time_query} if calls_time_query else calls_filter
        user_pipeline = [{"$match": calls_match}, {"$group": {"_id": "$user_name", "count": {"$sum": 1}}}] if calls_match else [{"$group": {"_id": "$user_name", "count": {"$sum": 1}}}]
        
        # Active telecallers
        active_pipeline = [{"$match": calls_match}, {"$group": {"_id": "$user_id"}}, {"$count": "count"}] if calls_match else [{"$group": {"_id": "$user_id"}}, {"$count": "count"}]
        
        agg_results = await asyncio.gather(
            db.leads.aggregate(status_pipeline).to_list(20),
            db.call_logs.aggregate(user_pipeline).to_list(100),
            db.call_logs.aggregate(active_pipeline).to_list(1)
        )
        
        status_counts, calls_per_user, active_result = agg_results
        active_telecallers = active_result[0]["count"] if active_result else 0
        
        return {
            "total_data": total_data,
            "unused_data": unused_data,
            "connected": connected,
            "total_leads_generated": total_leads_generated,
            "total_file": total_file,
            "leads_by_status": {s["_id"]: s["count"] for s in status_counts},
            "calls_per_user": {c["_id"]: c["count"] for c in calls_per_user},
            "active_telecallers": active_telecallers,
            "period": period,
            "telecaller_id": telecaller_id
        }
    else:
        # Telecaller view - optimized with parallel queries
        user_id = current_user["id"]
        
        if start_date and end_date:
            leads_time_filter = {"updated_at": {"$gte": start_date, "$lt": end_date}}
            leads_created_filter = {"created_at": {"$gte": start_date, "$lt": end_date}}
            calls_time_filter = {"created_at": {"$gte": start_date, "$lt": end_date}}
        elif start_date:
            leads_time_filter = {"updated_at": {"$gte": start_date}}
            leads_created_filter = {"created_at": {"$gte": start_date}}
            calls_time_filter = {"created_at": {"$gte": start_date}}
        else:
            leads_time_filter = {}
            leads_created_filter = {}
            calls_time_filter = {}
        
        # Run all queries in parallel
        queries = [
            db.leads.count_documents({"assigned_to": user_id, "status": "new", "created_at": {"$lt": today_naive}}),
            db.leads.count_documents({"assigned_to": user_id, **leads_created_filter}) if leads_created_filter else db.leads.count_documents({"assigned_to": user_id}),
            db.leads.count_documents({"assigned_to": user_id, "status": "file", **leads_time_filter}),
            db.leads.count_documents({"assigned_to": user_id, "status": {"$in": ["leads", "converted"]}, **leads_time_filter}),
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
            db.daily_sessions.find_one({"user_id": user_id, "date": today})
        ]
        
        results = await asyncio.gather(*queries)
        my_unused_data, my_data, my_file, my_leads_generated, status_counts, call_stats, session = results
        
        call_outcomes = call_stats[0] if call_stats else {"total": 0, "connected": 0, "not_connecting": 0, "no_answer": 0, "wrong_number": 0, "busy": 0, "voicemail": 0}
        
        # Get verified incoming call stats from daily session
        verified_incoming_calls = session.get("verified_incoming_calls", 0) if session else 0
        verified_incoming_time = session.get("verified_incoming_time_seconds", 0) if session else 0
        verified_talk_time = session.get("verified_talk_time_seconds", 0) if session else 0
        
        return {
            "my_data": my_data,
            "my_unused_data": my_unused_data,
            "my_connected": call_outcomes.get("total", 0),
            "my_file": my_file,
            "my_leads_generated": my_leads_generated,
            "leads_by_status": {s["_id"]: s["count"] for s in status_counts if s["_id"]},
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
        {"$addFields": {"lead_oid": {"$toObjectId": "$lead_id"}}},
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
    
    calls = await db.call_logs.aggregate(pipeline).to_list(limit)
    return serialize_docs(calls)

# ===================== DETAILED REPORTS =====================

@router.get("/reports/detailed-calls")
async def get_detailed_call_report(
    from_date: str = None,
    to_date: str = None,
    telecaller_id: str = None,
    limit: int = 500,
    current_user: dict = Depends(require_admin)
):
    """Get detailed call report - includes both manual call logs and verified mobile call logs"""
    start_date, end_date, _ = get_date_range("today", from_date, to_date)
    
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
        {"$addFields": {"lead_oid": {"$toObjectId": "$lead_id"}}},
        {"$lookup": {
            "from": "leads",
            "localField": "lead_oid",
            "foreignField": "_id",
            "as": "lead"
        }},
        {"$unwind": {"path": "$lead", "preserveNullAndEmptyArrays": True}},
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
    call_logs = await db.call_logs.aggregate(pipeline).to_list(limit)
    
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
        {"$addFields": {"lead_oid": {"$toObjectId": "$lead_id"}}},
        {"$lookup": {
            "from": "leads",
            "localField": "lead_oid",
            "foreignField": "_id",
            "as": "lead"
        }},
        {"$unwind": {"path": "$lead", "preserveNullAndEmptyArrays": True}},
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
    
    verified_logs = await db.verified_call_logs.aggregate(verified_pipeline).to_list(limit)
    
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
    
    # Limit total results and remove internal sort field
    detailed_calls = detailed_calls[:limit]
    for call in detailed_calls:
        call.pop("_sort_datetime", None)
    
    return {
        "calls": detailed_calls,
        "total_count": len(detailed_calls),
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
    
    # Get all telecallers
    telecallers = await db.users.find({"role": "telecaller"}).to_list(100)
    telecaller_ids = [str(tc["_id"]) for tc in telecallers]
    telecaller_map = {str(tc["_id"]): tc for tc in telecallers}
    
    # Build time filters
    if start_date and end_date:
        call_time_filter = {"created_at": {"$gte": start_date, "$lt": end_date}}
        lead_time_filter = {"updated_at": {"$gte": start_date, "$lt": end_date}}
        lead_created_filter = {"created_at": {"$gte": start_date, "$lt": end_date}}
        session_time_filter = {"date": {"$gte": start_date, "$lt": end_date}}
    elif start_date:
        call_time_filter = {"created_at": {"$gte": start_date}}
        lead_time_filter = {"updated_at": {"$gte": start_date}}
        lead_created_filter = {"created_at": {"$gte": start_date}}
        session_time_filter = {"date": {"$gte": start_date}}
    else:
        call_time_filter = {}
        lead_time_filter = {}
        lead_created_filter = {}
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
    
    # Aggregation for lead stats per user
    lead_pipeline = [
        {"$match": {"assigned_to": {"$in": telecaller_ids}, **lead_time_filter}},
        {"$group": {
            "_id": {"user_id": "$assigned_to", "status": "$status"},
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
        db.daily_sessions.aggregate(session_pipeline).to_list(100)
    )
    
    call_stats, lead_stats, lead_created_stats, followup_stats, session_stats = results
    
    # Build lookup maps
    call_map = {c["_id"]: c for c in call_stats}
    lead_created_map = {c["_id"]: c["count"] for c in lead_created_stats}
    session_map = {s["_id"]: s for s in session_stats}
    
    # Build lead status map per user
    lead_status_map = {}
    for ls in lead_stats:
        user_id = ls["_id"]["user_id"]
        status = ls["_id"]["status"]
        if user_id not in lead_status_map:
            lead_status_map[user_id] = {}
        lead_status_map[user_id][status] = ls["count"]
    
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
        
        user_file = leads.get("file", 0)
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
            "status_counts": leads
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
    current_user: dict = Depends(require_admin)
):
    """Optimized hourly report using aggregation"""
    now = datetime.now(timezone.utc)
    
    if date:
        target_date = datetime.fromisoformat(date).replace(tzinfo=timezone.utc)
    else:
        target_date = now
    
    start_of_day = target_date.replace(hour=0, minute=0, second=0, microsecond=0)
    end_of_day = start_of_day + timedelta(days=1)
    
    # Get telecallers
    telecallers = await db.users.find({"role": "telecaller"}).to_list(100)
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
    
    # Aggregation for lead status updates by hour per user
    lead_pipeline = [
        {"$match": {"assigned_to": {"$in": telecaller_ids}, "updated_at": {"$gte": start_of_day, "$lt": end_of_day}}},
        {"$addFields": {
            "hour": {"$hour": {"$add": ["$updated_at", 19800000]}}
        }},
        {"$group": {
            "_id": {"user_id": "$assigned_to", "hour": "$hour", "status": "$status"},
            "count": {"$sum": 1}
        }}
    ]
    
    call_stats, lead_stats = await asyncio.gather(
        db.call_logs.aggregate(call_pipeline).to_list(2400),
        db.leads.aggregate(lead_pipeline).to_list(2400)
    )
    
    # Build hourly data per user
    hourly_data = []
    overall_hours = {h: {"calls": 0, "connected": 0, "presentations": 0, "leads": 0, "file": 0} for h in range(24)}
    
    for tc in telecallers:
        user_id = str(tc["_id"])
        user_name = tc.get("name", tc.get("email", "Unknown"))
        
        hours = {h: {"calls": 0, "connected": 0, "presentations": 0, "leads": 0, "file": 0} for h in range(24)}
        
        # Fill call data
        for cs in call_stats:
            if cs["_id"]["user_id"] == user_id:
                hour = cs["_id"]["hour"]
                hours[hour]["calls"] = cs["calls"]
                hours[hour]["connected"] = cs["connected"]
        
        # Fill lead data
        for ls in lead_stats:
            if ls["_id"]["user_id"] == user_id:
                hour = ls["_id"]["hour"]
                status = ls["_id"]["status"]
                if status == "presentation":
                    hours[hour]["presentations"] = ls["count"]
                elif status in ["leads", "converted"]:
                    hours[hour]["leads"] += ls["count"]
                elif status == "file":
                    hours[hour]["file"] = ls["count"]
        
        # Build hourly breakdown
        hourly_breakdown = []
        for hour in range(24):
            h = hours[hour]
            if h["calls"] > 0 or h["presentations"] > 0 or h["leads"] > 0 or h["file"] > 0:
                hourly_breakdown.append({"hour": hour, "hour_label": f"{hour:02d}:00", **h})
                # Update overall
                for key in ["calls", "connected", "presentations", "leads", "file"]:
                    overall_hours[hour][key] += h[key]
        
        hourly_data.append({
            "user_id": user_id,
            "user_name": user_name,
            "total_calls": sum(h["calls"] for h in hours.values()),
            "total_connected": sum(h["connected"] for h in hours.values()),
            "total_presentations": sum(h["presentations"] for h in hours.values()),
            "total_leads": sum(h["leads"] for h in hours.values()),
            "total_file": sum(h["file"] for h in hours.values()),
            "hourly_breakdown": hourly_breakdown
        })
    
    hourly_data.sort(key=lambda x: x["total_calls"], reverse=True)
    
    overall_hourly = [
        {"hour": h, "hour_label": f"{h:02d}:00", **overall_hours[h]}
        for h in range(24) if overall_hours[h]["calls"] > 0 or overall_hours[h]["presentations"] > 0 or overall_hours[h]["leads"] > 0
    ]
    
    return {
        "date": target_date.strftime("%Y-%m-%d"),
        "telecallers": hourly_data,
        "overall_hourly": overall_hourly
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
    
    telecallers = await db.users.find({"role": "telecaller", "is_active": True}).to_list(100)
    telecaller_ids = [str(tc["_id"]) for tc in telecallers]
    
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
    current_user: dict = Depends(require_admin)
):
    """Optimized daily tracking sheet using aggregation"""
    now = datetime.now(timezone.utc)
    
    if not year:
        year = now.year
    if not month:
        month = now.month
    
    if start_date and end_date:
        range_start = datetime.fromisoformat(start_date).replace(tzinfo=timezone.utc)
        range_end = datetime.fromisoformat(end_date).replace(tzinfo=timezone.utc) + timedelta(days=1)
    else:
        range_start = datetime(year, month, 1, tzinfo=timezone.utc)
        if month == 12:
            range_end = datetime(year + 1, 1, 1, tzinfo=timezone.utc)
        else:
            range_end = datetime(year, month + 1, 1, tzinfo=timezone.utc)
    
    query = {"role": "telecaller", "is_active": True}
    if user_id:
        query["_id"] = ObjectId(user_id)
    
    telecallers = await db.users.find(query).to_list(100)
    telecaller_ids = [str(tc["_id"]) for tc in telecallers]
    
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
        {"$addFields": {"date_str": {"$dateToString": {"format": "%Y-%m-%d", "date": "$created_at"}}}},
        {"$group": {
            "_id": {"user_id": "$user_id", "date": "$date_str"},
            "calls": {"$sum": 1},
            "connected": {"$sum": {"$cond": [{"$eq": ["$outcome", "connected"]}, 1, 0]}},
            "talk_time": {"$sum": {"$ifNull": ["$duration", 0]}}
        }}
    ]
    
    # Aggregation for leads by date
    lead_pipeline = [
        {"$match": {"assigned_to": {"$in": telecaller_ids}, "updated_at": {"$gte": range_start, "$lt": range_end}, "status": {"$in": ["leads", "file"]}}},
        {"$addFields": {"date_str": {"$dateToString": {"format": "%Y-%m-%d", "date": "$updated_at"}}}},
        {"$group": {
            "_id": {"user_id": "$assigned_to", "date": "$date_str", "status": "$status"},
            "count": {"$sum": 1}
        }}
    ]
    
    activity_stats, call_stats, lead_stats = await asyncio.gather(
        db.activity_logs.aggregate(activity_pipeline).to_list(3100),
        db.call_logs.aggregate(call_pipeline).to_list(3100),
        db.leads.aggregate(lead_pipeline).to_list(3100)
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
        if l["_id"]["status"] == "leads":
            lead_map[key]["leads"] = l["count"]
        elif l["_id"]["status"] == "file":
            lead_map[key]["files"] = l["count"]
    
    results = []
    
    for tc in telecallers:
        tc_id = str(tc["_id"])
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
            key = (tc_id, date_str)
            
            # Get activity times
            activities = activity_map.get(key, [])
            start_time = None
            end_time = None
            for act in activities:
                if act["action"] == "login" and not start_time:
                    start_time = act["time"]
                elif act["action"] == "logout":
                    end_time = act["time"]
            
            # Get call stats
            calls = call_map.get(key, {"calls": 0, "connected": 0, "talk_time": 0})
            
            # Get lead stats
            leads = lead_map.get(key, {"leads": 0, "files": 0})
            
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

# Health check
@router.get("/health")
async def health_check():
    return {"status": "healthy", "service": "BANKEZEE Connect API"}
