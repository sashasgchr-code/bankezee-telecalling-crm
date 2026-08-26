"""
Reports and dashboard routes
"""
from fastapi import APIRouter, Depends
from datetime import datetime, timedelta, timezone
from typing import Optional
from bson import ObjectId

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
        {"id": "presentation", "name": "Presentation", "color": "#673AB7"},
        {"id": "leads", "name": "Lead", "color": "#00C853"},
        {"id": "file", "name": "File", "color": "#FF9800"}
    ]

# ===================== DASHBOARD =====================

@router.get("/dashboard/stats")
async def get_dashboard_stats(
    period: str = "today",
    telecaller_id: str = None,
    from_date: str = None,
    to_date: str = None,
    current_user: dict = Depends(get_current_user)
):
    now = datetime.now(timezone.utc)
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    today_naive = today.replace(tzinfo=None)
    
    if from_date and to_date:
        start_date = datetime.fromisoformat(from_date.replace('Z', '+00:00')).replace(tzinfo=timezone.utc)
        end_date = datetime.fromisoformat(to_date.replace('Z', '+00:00')).replace(tzinfo=timezone.utc) + timedelta(days=1)
        period = "custom"
    elif period == "today":
        start_date = today
        end_date = None
    elif period == "this_week":
        start_date = today - timedelta(days=today.weekday())
        end_date = None
    elif period == "this_month":
        start_date = today.replace(day=1)
        end_date = None
    elif period == "last_month":
        first_of_this_month = today.replace(day=1)
        last_month = first_of_this_month - timedelta(days=1)
        start_date = last_month.replace(day=1)
        end_date = first_of_this_month
    elif period == "all_time":
        start_date = None
        end_date = None
    else:
        start_date = today
        end_date = None
    
    if current_user["role"] == "admin":
        leads_filter = {}
        calls_filter = {}
        
        if telecaller_id and telecaller_id != "all":
            leads_filter["assigned_to"] = telecaller_id
            calls_filter["user_id"] = telecaller_id
        
        if period == "all_time":
            leads_time_filter = {}
            calls_time_query = {}
        elif end_date:
            leads_time_filter = {"updated_at": {"$gte": start_date, "$lt": end_date}}
            leads_created_filter = {"created_at": {"$gte": start_date, "$lt": end_date}}
            calls_time_query = {"created_at": {"$gte": start_date, "$lt": end_date}}
        else:
            leads_time_filter = {"updated_at": {"$gte": start_date}}
            leads_created_filter = {"created_at": {"$gte": start_date}}
            calls_time_query = {"created_at": {"$gte": start_date}}
        
        unused_data = await db.leads.count_documents({
            **leads_filter, 
            "status": "new",
            "created_at": {"$lt": today_naive}
        })
        
        if period == "all_time":
            total_data = await db.leads.count_documents(leads_filter)
        else:
            total_data = await db.leads.count_documents({**leads_filter, **leads_created_filter})
        
        connected = await db.call_logs.count_documents({**calls_filter, **calls_time_query})
        
        if period == "all_time":
            total_leads_generated = await db.leads.count_documents({
                **leads_filter, 
                "status": {"$in": ["leads", "converted"]}
            })
        else:
            total_leads_generated = await db.leads.count_documents({
                **leads_filter, 
                **leads_time_filter,
                "status": {"$in": ["leads", "converted"]}
            })
        
        if period == "all_time":
            total_file = await db.leads.count_documents({**leads_filter, "status": "file"})
        else:
            total_file = await db.leads.count_documents({
                **leads_filter, 
                **leads_time_filter,
                "status": "file"
            })
        
        if period == "all_time":
            status_match = leads_filter if leads_filter else {}
        else:
            status_match = {**leads_filter, **leads_time_filter} if leads_filter else leads_time_filter
        
        if status_match:
            pipeline = [
                {"$match": status_match},
                {"$group": {"_id": "$status", "count": {"$sum": 1}}}
            ]
        else:
            pipeline = [{"$group": {"_id": "$status", "count": {"$sum": 1}}}]
        status_counts = await db.leads.aggregate(pipeline).to_list(20)
        
        if period == "all_time":
            if telecaller_id and telecaller_id != "all":
                user_pipeline = [
                    {"$match": {"user_id": telecaller_id}},
                    {"$group": {"_id": "$user_name", "count": {"$sum": 1}}}
                ]
            else:
                user_pipeline = [
                    {"$group": {"_id": "$user_name", "count": {"$sum": 1}}}
                ]
        else:
            if telecaller_id and telecaller_id != "all":
                user_pipeline = [
                    {"$match": {**calls_time_query, "user_id": telecaller_id}},
                    {"$group": {"_id": "$user_name", "count": {"$sum": 1}}}
                ]
            else:
                user_pipeline = [
                    {"$match": calls_time_query},
                    {"$group": {"_id": "$user_name", "count": {"$sum": 1}}}
                ]
        calls_per_user = await db.call_logs.aggregate(user_pipeline).to_list(100)
        
        if period == "all_time":
            active_telecallers_pipeline = [
                {"$group": {"_id": "$user_id"}},
                {"$count": "count"}
            ]
        else:
            active_telecallers_pipeline = [
                {"$match": calls_time_query},
                {"$group": {"_id": "$user_id"}},
                {"$count": "count"}
            ]
        active_result = await db.call_logs.aggregate(active_telecallers_pipeline).to_list(1)
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
        user_id = current_user["id"]
        
        if period == "all_time":
            leads_time_filter = {}
            leads_created_filter = {}
            calls_time_filter = {}
        elif end_date:
            leads_time_filter = {"updated_at": {"$gte": start_date, "$lt": end_date}}
            leads_created_filter = {"created_at": {"$gte": start_date, "$lt": end_date}}
            calls_time_filter = {"created_at": {"$gte": start_date, "$lt": end_date}}
        else:
            leads_time_filter = {"updated_at": {"$gte": start_date}}
            leads_created_filter = {"created_at": {"$gte": start_date}}
            calls_time_filter = {"created_at": {"$gte": start_date}}
        
        my_unused_data = await db.leads.count_documents({
            "assigned_to": user_id, 
            "status": "new",
            "created_at": {"$lt": today_naive}
        })
        
        if period == "all_time":
            my_data = await db.leads.count_documents({"assigned_to": user_id})
        else:
            my_data = await db.leads.count_documents({"assigned_to": user_id, **leads_created_filter})
        
        if period == "all_time":
            my_file = await db.leads.count_documents({"assigned_to": user_id, "status": "file"})
        else:
            my_file = await db.leads.count_documents({
                "assigned_to": user_id, 
                "status": "file",
                **leads_time_filter
            })
        
        if period == "all_time":
            my_leads_generated = await db.leads.count_documents({
                "assigned_to": user_id, 
                "status": {"$in": ["leads", "converted"]}
            })
        else:
            my_leads_generated = await db.leads.count_documents({
                "assigned_to": user_id, 
                "status": {"$in": ["leads", "converted"]},
                **leads_time_filter
            })
        
        if period == "all_time":
            status_match = {"assigned_to": user_id}
        else:
            status_match = {"assigned_to": user_id, **leads_time_filter}
        
        pipeline = [
            {"$match": status_match},
            {"$group": {"_id": "$status", "count": {"$sum": 1}}}
        ]
        status_counts = await db.leads.aggregate(pipeline).to_list(20)
        
        call_logs = await db.call_logs.find({"user_id": user_id, **calls_time_filter}).to_list(10000)
        my_calls_connected = sum(1 for log in call_logs if log.get("outcome") == "connected")
        my_calls_not_connecting = sum(1 for log in call_logs if log.get("outcome") == "not_connecting")
        my_calls_no_answer = sum(1 for log in call_logs if log.get("outcome") == "no_answer")
        my_calls_wrong_number = sum(1 for log in call_logs if log.get("outcome") == "wrong_number")
        my_calls_busy = sum(1 for log in call_logs if log.get("outcome") == "busy")
        my_calls_voicemail = sum(1 for log in call_logs if log.get("outcome") == "voicemail")
        
        session = await db.daily_sessions.find_one({
            "user_id": user_id,
            "date": today
        })
        
        return {
            "my_data": my_data,
            "my_unused_data": my_unused_data,
            "my_connected": len(call_logs),
            "my_file": my_file,
            "my_leads_generated": my_leads_generated,
            "leads_by_status": {s["_id"]: s["count"] for s in status_counts if s["_id"]},
            "call_outcomes": {
                "connected": my_calls_connected,
                "not_connecting": my_calls_not_connecting,
                "no_answer": my_calls_no_answer,
                "wrong_number": my_calls_wrong_number,
                "busy": my_calls_busy,
                "voicemail": my_calls_voicemail
            },
            "daily_session": serialize_doc(session) if session else None,
            "period": period
        }

@router.get("/dashboard/recent-calls")
async def get_recent_calls(limit: int = 10, current_user: dict = Depends(get_current_user)):
    query = {}
    if current_user["role"] == "telecaller":
        query["user_id"] = current_user["id"]
    
    calls = await db.call_logs.find(query).sort("created_at", -1).limit(limit).to_list(limit)
    
    enriched_calls = []
    for call in calls:
        lead = await db.leads.find_one({"_id": ObjectId(call["lead_id"])})
        call_data = serialize_doc(call)
        if lead:
            call_data["lead_name"] = lead.get("name", "Unknown")
            call_data["lead_phone"] = lead.get("phone", "")
        enriched_calls.append(call_data)
    
    return enriched_calls

# ===================== DETAILED REPORTS =====================

@router.get("/reports/detailed-calls")
async def get_detailed_call_report(
    from_date: str = None,
    to_date: str = None,
    telecaller_id: str = None,
    current_user: dict = Depends(require_admin)
):
    """Get detailed call report with customer info, call outcome, duration, and caller name"""
    now = datetime.now(timezone.utc)
    
    query = {}
    if from_date and to_date:
        start_date = datetime.fromisoformat(from_date.replace('Z', '+00:00')).replace(tzinfo=timezone.utc)
        end_date = datetime.fromisoformat(to_date.replace('Z', '+00:00')).replace(tzinfo=timezone.utc) + timedelta(days=1)
        query["created_at"] = {"$gte": start_date, "$lt": end_date}
    elif from_date:
        start_date = datetime.fromisoformat(from_date.replace('Z', '+00:00')).replace(tzinfo=timezone.utc)
        query["created_at"] = {"$gte": start_date}
    else:
        today = now.replace(hour=0, minute=0, second=0, microsecond=0)
        query["created_at"] = {"$gte": today}
    
    if telecaller_id and telecaller_id != "all":
        query["user_id"] = telecaller_id
    
    call_logs = await db.call_logs.find(query).sort("created_at", -1).to_list(10000)
    
    detailed_calls = []
    for log in call_logs:
        lead_id = log.get("lead_id")
        lead = None
        if lead_id:
            try:
                lead = await db.leads.find_one({"_id": ObjectId(lead_id)})
            except:
                pass
        
        call_time = log.get("created_at")
        if call_time:
            call_time_ist = convert_to_ist(call_time)
        else:
            call_time_ist = None
        
        detailed_calls.append({
            "id": str(log.get("_id", "")),
            "call_date": call_time_ist.strftime("%Y-%m-%d") if call_time_ist else "",
            "call_time": call_time_ist.strftime("%I:%M %p") if call_time_ist else "",
            "caller_name": log.get("user_name", "Unknown"),
            "caller_id": log.get("user_id", ""),
            "customer_name": lead.get("name", "Unknown") if lead else log.get("lead_name", "Unknown"),
            "customer_phone": lead.get("phone", "") if lead else log.get("lead_phone", ""),
            "customer_email": lead.get("email", "") if lead else "",
            "customer_city": lead.get("city", "") if lead else "",
            "customer_source": lead.get("source", "") if lead else "",
            "lead_status": lead.get("status", "") if lead else "",
            "call_outcome": log.get("outcome", ""),
            "call_duration_seconds": log.get("duration", 0) or 0,
            "call_duration_formatted": format_duration(log.get("duration", 0) or 0),
            "form_filling_seconds": log.get("form_filling_seconds", 0) or 0,
            "form_filling_formatted": format_duration(log.get("form_filling_seconds", 0) or 0),
            "notes": log.get("notes", ""),
        })
    
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
    now = datetime.now(timezone.utc)
    end_date = None
    
    if from_date and to_date:
        start_date = datetime.fromisoformat(from_date.replace('Z', '+00:00')).replace(tzinfo=timezone.utc)
        end_date = datetime.fromisoformat(to_date.replace('Z', '+00:00')).replace(tzinfo=timezone.utc) + timedelta(days=1)
        period = "custom"
    elif period == "today":
        start_date = now.replace(hour=0, minute=0, second=0, microsecond=0)
        end_date = start_date + timedelta(days=1)
    elif period == "week":
        start_date = now - timedelta(days=now.weekday())
        start_date = start_date.replace(hour=0, minute=0, second=0, microsecond=0)
        end_date = now + timedelta(days=1)
    elif period == "month":
        start_date = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        end_date = now + timedelta(days=1)
    elif period == "three_months":
        start_date = now - timedelta(days=90)
        start_date = start_date.replace(hour=0, minute=0, second=0, microsecond=0)
        end_date = now + timedelta(days=1)
    elif period == "lifetime":
        start_date = None
        end_date = None
    else:
        start_date = None
        end_date = None
    
    telecallers = await db.users.find({"role": "telecaller"}).to_list(100)
    
    telecaller_reports = []
    total_calls = 0
    total_leads_generated = 0
    total_file = 0
    total_presentations = 0
    total_call_seconds = 0
    total_idle_seconds = 0
    total_form_filling_seconds = 0
    
    for telecaller in telecallers:
        user_id = str(telecaller["_id"])
        
        lead_base_filter = {"assigned_to": user_id}
        if start_date and end_date:
            lead_time_filter = {"assigned_to": user_id, "updated_at": {"$gte": start_date, "$lt": end_date}}
            lead_created_filter = {"assigned_to": user_id, "created_at": {"$gte": start_date, "$lt": end_date}}
        elif start_date:
            lead_time_filter = {"assigned_to": user_id, "updated_at": {"$gte": start_date}}
            lead_created_filter = {"assigned_to": user_id, "created_at": {"$gte": start_date}}
        else:
            lead_time_filter = lead_base_filter
            lead_created_filter = lead_base_filter
        
        if start_date:
            total_leads = await db.leads.count_documents(lead_created_filter)
        else:
            total_leads = await db.leads.count_documents(lead_base_filter)
        
        user_leads_generated = await db.leads.count_documents({
            **lead_time_filter,
            "status": {"$in": ["leads", "converted"]}
        })
        
        user_file = await db.leads.count_documents({
            **lead_time_filter,
            "status": "file"
        })
        
        user_presentations = await db.leads.count_documents({
            **lead_time_filter,
            "status": "presentation"
        })
        
        call_query = {"user_id": user_id}
        if start_date and end_date:
            call_query["created_at"] = {"$gte": start_date, "$lt": end_date}
        elif start_date:
            call_query["created_at"] = {"$gte": start_date}
        
        user_call_logs = await db.call_logs.find(call_query).to_list(10000)
        user_total_calls = len(user_call_logs)
        
        user_call_seconds_from_logs = sum(log.get("duration", 0) or 0 for log in user_call_logs)
        user_form_filling_seconds = sum(log.get("form_filling_seconds", 0) or 0 for log in user_call_logs)
        
        calls_connected = sum(1 for log in user_call_logs if log.get("outcome") == "connected")
        calls_not_connecting = sum(1 for log in user_call_logs if log.get("outcome") == "not_connecting")
        calls_no_answer = sum(1 for log in user_call_logs if log.get("outcome") == "no_answer")
        calls_wrong_number = sum(1 for log in user_call_logs if log.get("outcome") == "wrong_number")
        calls_busy = sum(1 for log in user_call_logs if log.get("outcome") == "busy")
        calls_voicemail = sum(1 for log in user_call_logs if log.get("outcome") == "voicemail")
        
        follow_ups_pending = await db.follow_ups.count_documents({
            "user_id": user_id,
            "is_completed": False
        })
        
        follow_ups_completed = await db.follow_ups.count_documents({
            "user_id": user_id,
            "is_completed": True
        })
        
        session_query = {"user_id": user_id}
        if start_date and end_date:
            session_query["date"] = {"$gte": start_date, "$lt": end_date}
        elif start_date:
            session_query["date"] = {"$gte": start_date}
        
        sessions = await db.daily_sessions.find(session_query).to_list(100)
        user_break_seconds = sum(s.get("total_break_seconds", 0) for s in sessions)
        
        user_login_seconds = 0
        for s in sessions:
            if s.get("logout_time"):
                logout_time = s.get("logout_time")
                login_time = s.get("login_time")
                if logout_time and login_time:
                    if login_time.tzinfo is None:
                        login_time = login_time.replace(tzinfo=timezone.utc)
                    if logout_time.tzinfo is None:
                        logout_time = logout_time.replace(tzinfo=timezone.utc)
                    user_login_seconds += (logout_time - login_time).total_seconds()
                else:
                    user_login_seconds += s.get("total_login_seconds", 0)
            else:
                login_time = s.get("login_time")
                if login_time:
                    if login_time.tzinfo is None:
                        login_time = login_time.replace(tzinfo=timezone.utc)
                    user_login_seconds += (now - login_time).total_seconds()
        
        user_call_seconds = user_call_seconds_from_logs
        user_idle_seconds = max(0, user_login_seconds - user_call_seconds - user_break_seconds)
        
        status_pipeline = [
            {"$match": lead_time_filter},
            {"$group": {"_id": "$status", "count": {"$sum": 1}}}
        ]
        status_counts_raw = await db.leads.aggregate(status_pipeline).to_list(20)
        user_status_counts = {s["_id"]: s["count"] for s in status_counts_raw if s["_id"]}
        
        calls_to_file_ratio = (user_file / user_total_calls * 100) if user_total_calls > 0 else 0
        avg_call_time_seconds = (user_call_seconds / user_total_calls) if user_total_calls > 0 else 0
        avg_form_filling_seconds = (user_form_filling_seconds / user_total_calls) if user_total_calls > 0 else 0
        
        telecaller_reports.append({
            "user_id": user_id,
            "user_name": telecaller.get("name", "Unknown"),
            "user_email": telecaller.get("email", ""),
            "is_active": telecaller.get("is_active", True),
            "last_activity": telecaller.get("last_activity"),
            "total_leads": total_leads,
            "leads_generated": user_leads_generated,
            "file": user_file,
            "presentations": user_presentations,
            "total_calls": user_total_calls,
            "calls_connected": calls_connected,
            "calls_not_connecting": calls_not_connecting,
            "calls_no_answer": calls_no_answer,
            "calls_wrong_number": calls_wrong_number,
            "calls_busy": calls_busy,
            "calls_voicemail": calls_voicemail,
            "follow_ups_pending": follow_ups_pending,
            "follow_ups_completed": follow_ups_completed,
            "calls_to_file_ratio": calls_to_file_ratio,
            "total_call_seconds": user_call_seconds,
            "total_idle_seconds": user_idle_seconds,
            "total_login_seconds": user_login_seconds,
            "total_form_filling_seconds": user_form_filling_seconds,
            "avg_call_time_seconds": avg_call_time_seconds,
            "avg_form_filling_seconds": avg_form_filling_seconds,
            "status_counts": user_status_counts
        })
        
        total_calls += user_total_calls
        total_leads_generated += user_leads_generated
        total_file += user_file
        total_presentations += user_presentations
        total_call_seconds += user_call_seconds
        total_idle_seconds += user_idle_seconds
        total_form_filling_seconds += user_form_filling_seconds
    
    total_leads_in_period = sum(t["total_leads"] for t in telecaller_reports)
    
    telecaller_reports.sort(key=lambda x: x["total_calls"], reverse=True)
    
    overall_calls_to_file_ratio = (total_file / total_calls * 100) if total_calls > 0 else 0
    overall_avg_call_time_seconds = (total_call_seconds / total_calls) if total_calls > 0 else 0
    overall_avg_form_filling_seconds = (total_form_filling_seconds / total_calls) if total_calls > 0 else 0
    
    overall_stats = {
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
        "avg_call_time_seconds": overall_avg_call_time_seconds,
        "avg_form_filling_seconds": overall_avg_form_filling_seconds
    }
    
    return {
        "telecallers": telecaller_reports,
        "overall": overall_stats,
        "period": period
    }

@router.get("/reports/hourly")
async def get_hourly_report(
    date: str = None,
    current_user: dict = Depends(require_admin)
):
    """Get hourly breakdown of calls and status updates for each telecaller"""
    now = datetime.now(timezone.utc)
    
    if date:
        target_date = datetime.fromisoformat(date).replace(tzinfo=timezone.utc)
    else:
        target_date = now
    
    start_of_day = target_date.replace(hour=0, minute=0, second=0, microsecond=0)
    end_of_day = start_of_day + timedelta(days=1)
    start_naive = start_of_day.replace(tzinfo=None)
    end_naive = end_of_day.replace(tzinfo=None)
    
    telecallers = await db.users.find({"role": "telecaller"}).to_list(100)
    
    hourly_data = []
    
    for telecaller in telecallers:
        user_id = str(telecaller["_id"])
        user_name = telecaller.get("name", telecaller.get("email", "Unknown"))
        
        user_calls = await db.call_logs.find({
            "user_id": user_id,
            "created_at": {"$gte": start_naive, "$lt": end_naive}
        }).to_list(10000)
        
        user_leads_updated = await db.leads.find({
            "assigned_to": user_id,
            "updated_at": {"$gte": start_naive, "$lt": end_naive}
        }).to_list(10000)
        
        hours = {}
        for hour in range(24):
            hours[hour] = {
                "calls": 0,
                "connected": 0,
                "presentations": 0,
                "leads": 0,
                "file": 0
            }
        
        for call in user_calls:
            call_time = call.get("created_at")
            if call_time:
                if call_time.tzinfo is None:
                    call_time = call_time.replace(tzinfo=timezone.utc)
                ist_time = call_time + IST_OFFSET
                hour = ist_time.hour
                hours[hour]["calls"] += 1
                outcome = call.get("outcome", "")
                if outcome == "connected":
                    hours[hour]["connected"] += 1
        
        for lead in user_leads_updated:
            update_time = lead.get("updated_at")
            if update_time:
                if update_time.tzinfo is None:
                    update_time = update_time.replace(tzinfo=timezone.utc)
                ist_time = update_time + IST_OFFSET
                hour = ist_time.hour
                status = lead.get("status", "")
                if status == "presentation":
                    hours[hour]["presentations"] += 1
                elif status in ["leads", "converted"]:
                    hours[hour]["leads"] += 1
                elif status == "file":
                    hours[hour]["file"] += 1
        
        hourly_breakdown = []
        for hour in range(24):
            if hours[hour]["calls"] > 0 or hours[hour]["presentations"] > 0 or hours[hour]["leads"] > 0 or hours[hour]["file"] > 0:
                hourly_breakdown.append({
                    "hour": hour,
                    "hour_label": f"{hour:02d}:00",
                    **hours[hour]
                })
        
        total_calls = sum(h["calls"] for h in hours.values())
        total_connected = sum(h["connected"] for h in hours.values())
        total_presentations = sum(h["presentations"] for h in hours.values())
        total_leads = sum(h["leads"] for h in hours.values())
        total_file = sum(h["file"] for h in hours.values())
        
        hourly_data.append({
            "user_id": user_id,
            "user_name": user_name,
            "total_calls": total_calls,
            "total_connected": total_connected,
            "total_presentations": total_presentations,
            "total_leads": total_leads,
            "total_file": total_file,
            "hourly_breakdown": hourly_breakdown
        })
    
    hourly_data.sort(key=lambda x: x["total_calls"], reverse=True)
    
    overall_hours = {}
    for hour in range(24):
        overall_hours[hour] = {"calls": 0, "connected": 0, "presentations": 0, "leads": 0, "file": 0}
    
    for tc in hourly_data:
        for hb in tc["hourly_breakdown"]:
            hour = hb["hour"]
            overall_hours[hour]["calls"] += hb["calls"]
            overall_hours[hour]["connected"] += hb["connected"]
            overall_hours[hour]["presentations"] += hb["presentations"]
            overall_hours[hour]["leads"] += hb["leads"]
            overall_hours[hour]["file"] += hb["file"]
    
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
    """Get aggregated verified call stats for admin reports with verification score"""
    now = datetime.now(timezone.utc)
    
    if date:
        target_date = datetime.fromisoformat(date).replace(tzinfo=timezone.utc)
    else:
        target_date = now
    
    start_of_day = target_date.replace(hour=0, minute=0, second=0, microsecond=0)
    end_of_day = start_of_day + timedelta(days=1)
    
    telecallers = await db.users.find({"role": "telecaller", "is_active": True}).to_list(100)
    
    stats = []
    for tc in telecallers:
        tc_id = str(tc["_id"])
        
        verified_logs = await db.verified_call_logs.find({
            "user_id": tc_id,
            "synced_at": {"$gte": start_of_day, "$lt": end_of_day}
        }).to_list(500)
        
        manual_logs = await db.call_logs.find({
            "user_id": tc_id,
            "created_at": {"$gte": start_of_day, "$lt": end_of_day}
        }).to_list(500)
        
        total_outgoing = [l for l in verified_logs if l.get("call_type") == "outgoing"]
        total_incoming = [l for l in verified_logs if l.get("call_type") == "incoming"]
        connected_outgoing = [l for l in total_outgoing if l.get("duration_seconds", 0) > 0]
        connected_incoming = [l for l in total_incoming if l.get("duration_seconds", 0) > 0]
        
        outgoing_talk_time = sum(l.get("duration_seconds", 0) for l in connected_outgoing)
        incoming_talk_time = sum(l.get("duration_seconds", 0) for l in connected_incoming)
        
        total_verified_calls = len(verified_logs)
        total_manual_calls = len(manual_logs)
        total_all_calls = max(total_verified_calls, total_manual_calls)
        
        if total_all_calls == 0:
            verification_score = 0
            sync_status = "no_calls"
        elif total_verified_calls >= total_manual_calls and total_verified_calls > 0:
            verification_score = 100
            sync_status = "synced"
        elif total_verified_calls > 0:
            verification_score = round((total_verified_calls / total_all_calls) * 100)
            sync_status = "partial"
        else:
            verification_score = 0
            sync_status = "not_synced"
        
        daily_session = await db.daily_sessions.find_one({
            "user_id": tc_id,
            "date": start_of_day
        })
        last_sync = daily_session.get("last_call_sync") if daily_session else None
        
        stats.append({
            "user_id": tc_id,
            "user_name": tc.get("name", "Unknown"),
            "total_outgoing_calls": len(total_outgoing),
            "connected_outgoing_calls": len(connected_outgoing),
            "outgoing_talk_time_seconds": outgoing_talk_time,
            "total_incoming_calls": len(total_incoming),
            "connected_incoming_calls": len(connected_incoming),
            "incoming_talk_time_seconds": incoming_talk_time,
            "total_verified_talk_time_seconds": outgoing_talk_time + incoming_talk_time,
            "missed_calls": len([l for l in verified_logs if l.get("call_type") == "missed"]),
            "manual_calls_logged": total_manual_calls,
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
    """
    Get daily tracking sheet data for a telecaller.
    Shows: Date, Day, Start Time, End Time, Calls, Connected, Leads, Files, Talk Time
    """
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
    
    results = []
    
    for tc in telecallers:
        tc_id = str(tc["_id"])
        tc_name = tc.get("name", "Unknown")
        
        activity_logs = await db.activity_logs.find({
            "user_id": tc_id,
            "timestamp": {"$gte": range_start, "$lt": range_end}
        }).sort("timestamp", 1).to_list(5000)
        
        call_logs = await db.call_logs.find({
            "user_id": tc_id,
            "created_at": {"$gte": range_start, "$lt": range_end}
        }).to_list(5000)
        
        daily_sessions = await db.daily_sessions.find({
            "user_id": tc_id,
            "date": {"$gte": range_start, "$lt": range_end}
        }).to_list(100)
        
        session_map = {}
        for session in daily_sessions:
            date_key = session["date"].strftime("%Y-%m-%d")
            session_map[date_key] = session
        
        activities_by_date = {}
        for log in activity_logs:
            date_key = log["timestamp"].strftime("%Y-%m-%d")
            if date_key not in activities_by_date:
                activities_by_date[date_key] = []
            activities_by_date[date_key].append(log)
        
        calls_by_date = {}
        for call in call_logs:
            date_key = call["created_at"].strftime("%Y-%m-%d")
            if date_key not in calls_by_date:
                calls_by_date[date_key] = []
            calls_by_date[date_key].append(call)
        
        leads_by_date = {}
        leads = await db.leads.find({
            "assigned_to": tc_id,
            "updated_at": {"$gte": range_start, "$lt": range_end}
        }).to_list(5000)
        
        for lead in leads:
            date_key = lead["updated_at"].strftime("%Y-%m-%d")
            if date_key not in leads_by_date:
                leads_by_date[date_key] = {"leads": 0, "files": 0}
            if lead.get("status") == "leads":
                leads_by_date[date_key]["leads"] += 1
            if lead.get("status") == "file":
                leads_by_date[date_key]["files"] += 1
        
        file_goal = tc.get("file_goal", 5)
        
        daily_data = []
        total_leads = 0
        total_files = 0
        total_calls = 0
        total_connected = 0
        total_talk_time = 0
        
        current_date = range_start
        while current_date < range_end:
            date_str = current_date.strftime("%Y-%m-%d")
            day_name = current_date.strftime("%A")[:3]
            
            day_activities = activities_by_date.get(date_str, [])
            start_time = None
            end_time = None
            
            for activity in day_activities:
                if activity.get("action") == "login" and not start_time:
                    start_time = activity["timestamp"].strftime("%H:%M")
                elif activity.get("action") == "logout":
                    end_time = activity["timestamp"].strftime("%H:%M")
            
            day_calls = calls_by_date.get(date_str, [])
            calls_count = len(day_calls)
            # Connected = calls where outcome is 'connected' (customer actually answered)
            connected_count = len([c for c in day_calls if c.get("outcome") == "connected"])
            talk_time_seconds = sum(c.get("duration", 0) or 0 for c in day_calls)
            
            day_lead_stats = leads_by_date.get(date_str, {"leads": 0, "files": 0})
            
            if start_time or calls_count > 0 or day_lead_stats["leads"] > 0 or day_lead_stats["files"] > 0:
                daily_data.append({
                    "date": date_str,
                    "day": day_name,
                    "start_time": start_time or "-",
                    "end_time": end_time or "-",
                    "calls": calls_count,
                    "connected": connected_count,
                    "leads": day_lead_stats["leads"],
                    "files": day_lead_stats["files"],
                    "talk_time_seconds": talk_time_seconds,
                    "talk_time_formatted": f"{talk_time_seconds // 60}m {talk_time_seconds % 60}s" if talk_time_seconds else "0m"
                })
                
                total_calls += calls_count
                total_connected += connected_count
                total_leads += day_lead_stats["leads"]
                total_files += day_lead_stats["files"]
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
    """
    Migration endpoint to estimate form filling time for historical call logs.
    """
    logs_without_form_time = await db.call_logs.find({
        "$or": [
            {"form_filling_seconds": {"$exists": False}},
            {"form_filling_seconds": None},
            {"form_filling_seconds": 0}
        ]
    }).to_list(50000)
    
    updated_count = 0
    for log in logs_without_form_time:
        duration = log.get("duration", 0) or 0
        if duration > 60:
            estimated_form_time = 30
        else:
            estimated_form_time = 15
        
        await db.call_logs.update_one(
            {"_id": log["_id"]},
            {"$set": {"form_filling_seconds": estimated_form_time}}
        )
        updated_count += 1
    
    sessions_updated = 0
    all_sessions = await db.daily_sessions.find({}).to_list(10000)
    for session in all_sessions:
        user_id = session.get("user_id")
        session_date = session.get("date")
        
        if user_id and session_date:
            end_date = session_date + timedelta(days=1)
            user_logs = await db.call_logs.find({
                "user_id": user_id,
                "created_at": {"$gte": session_date, "$lt": end_date}
            }).to_list(1000)
            
            total_form_filling = sum(log.get("form_filling_seconds", 0) or 0 for log in user_logs)
            
            await db.daily_sessions.update_one(
                {"_id": session["_id"]},
                {"$set": {"total_form_filling_seconds": total_form_filling}}
            )
            sessions_updated += 1
    
    return {
        "message": "Migration completed",
        "call_logs_updated": updated_count,
        "daily_sessions_updated": sessions_updated
    }

# Health check
@router.get("/health")
async def health_check():
    return {"status": "healthy", "service": "BANKEZEE Connect API"}
