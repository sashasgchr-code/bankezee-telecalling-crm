"""
Google Sheets Sync & Data Retention Routes
- Provides API endpoints for Google Apps Script to fetch data
- Manual data retention with export-before-delete functionality
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from datetime import datetime, timezone, timedelta
from typing import Optional, List
from bson import ObjectId
import pandas as pd
import io

from utils.database import db
from utils.auth import require_admin
from utils.helpers import serialize_doc, serialize_docs

router = APIRouter(prefix="/api/sheets-sync", tags=["Google Sheets Sync"])


# ===================== GOOGLE SHEETS SYNC ENDPOINTS =====================

# API Key for Google Sheets access (alternative to JWT)
import os
SHEETS_API_KEY = os.environ.get("SHEETS_API_KEY", "bankezee_sheets_sync_2026")


@router.get("/leads-by-status")
async def get_leads_by_status_for_sheets(
    api_key: str = Query(None, description="API key for authentication (alternative to JWT)")
):
    """
    Get all leads grouped by status for Google Sheets sync.
    Returns data formatted for easy import into separate tabs.
    Accepts either JWT token OR api_key query param for App Script access.
    """
    # Validate API key if no JWT provided
    if api_key != SHEETS_API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")
    
    # Fetch all non-archived, non-invalid leads
    leads = await db.leads.find({
        "$or": [{"archived": {"$exists": False}}, {"archived": False}],
        "$and": [{"$or": [{"is_invalid": {"$exists": False}}, {"is_invalid": False}]}]
    }).to_list(50000)
    
    # Group by status
    grouped = {}
    status_list = ["new", "not_interested", "follow_up", "leads", "file"]
    
    for status in status_list:
        grouped[status] = []
    grouped["wrong_number"] = []  # Special tab for invalid/wrong numbers
    grouped["other"] = []
    
    for lead in leads:
        status = lead.get("status", "new")
        outcome = lead.get("last_call_outcome", "")
        
        lead_data = {
            "id": str(lead["_id"]),
            "name": lead.get("name", ""),
            "phone": lead.get("phone", ""),
            "email": lead.get("email", ""),
            "city": lead.get("city", ""),
            "source": lead.get("source", ""),
            "status": status,
            "last_call_outcome": outcome,
            "telecaller": lead.get("telecaller_name", "Unassigned"),
            "notes": lead.get("notes", ""),
            "created_at": lead.get("created_at", "").isoformat() if lead.get("created_at") else "",
            "last_call_at": lead.get("last_call_at", "").isoformat() if lead.get("last_call_at") else ""
        }
        
        if outcome == "wrong_number" or lead.get("is_invalid"):
            grouped["wrong_number"].append(lead_data)
        elif status in grouped:
            grouped[status].append(lead_data)
        else:
            grouped["other"].append(lead_data)
    
    # Add summary
    summary = {tab: len(leads) for tab, leads in grouped.items()}
    
    return {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "summary": summary,
        "data": grouped
    }


@router.get("/daily-report")
async def get_daily_report_for_sheets(
    date: Optional[str] = None,
    api_key: str = Query(None, description="API key for authentication")
):
    """
    Get daily call report for Google Sheets.
    Accepts either JWT token OR api_key query param for App Script access.
    """
    if api_key != SHEETS_API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")
    if date:
        report_date = datetime.fromisoformat(date.replace('Z', '+00:00'))
    else:
        report_date = datetime.now(timezone.utc)
    
    start_of_day = report_date.replace(hour=0, minute=0, second=0, microsecond=0)
    end_of_day = start_of_day + timedelta(days=1)
    
    # Get call stats by user
    pipeline = [
        {"$match": {"created_at": {"$gte": start_of_day, "$lt": end_of_day}}},
        {"$group": {
            "_id": "$user_id",
            "user_name": {"$first": "$user_name"},
            "total_calls": {"$sum": 1},
            "total_duration": {"$sum": "$duration"},
            "connected": {"$sum": {"$cond": [{"$eq": ["$outcome", "connected"]}, 1, 0]}},
            "no_answer": {"$sum": {"$cond": [{"$eq": ["$outcome", "no_answer"]}, 1, 0]}},
            "busy": {"$sum": {"$cond": [{"$eq": ["$outcome", "busy"]}, 1, 0]}},
            "wrong_number": {"$sum": {"$cond": [{"$eq": ["$outcome", "wrong_number"]}, 1, 0]}}
        }},
        {"$sort": {"total_calls": -1}}
    ]
    
    user_stats = await db.call_logs.aggregate(pipeline).to_list(100)
    
    return {
        "date": start_of_day.strftime("%Y-%m-%d"),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "user_stats": user_stats
    }


@router.get("/attendance-summary")
async def get_attendance_summary_for_sheets(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    api_key: str = Query(None, description="API key for authentication")
):
    """
    Get attendance summary for Google Sheets.
    Accepts either JWT token OR api_key query param for App Script access.
    """
    if api_key != SHEETS_API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")
    now = datetime.now(timezone.utc)
    
    if start_date:
        start = datetime.fromisoformat(start_date.replace('Z', '+00:00'))
    else:
        start = now - timedelta(days=30)
    
    if end_date:
        end = datetime.fromisoformat(end_date.replace('Z', '+00:00'))
    else:
        end = now
    
    # Get attendance records
    records = await db.attendance.find({
        "attendance_date": {"$gte": start, "$lte": end}
    }).sort([("attendance_date", -1), ("user_name", 1)]).to_list(5000)
    
    # Format for sheets
    formatted = []
    for rec in records:
        formatted.append({
            "date": rec.get("attendance_date", "").strftime("%Y-%m-%d") if rec.get("attendance_date") else "",
            "user": rec.get("user_name", "Unknown"),
            "status": rec.get("attendance_status", ""),
            "work_mode": rec.get("work_mode", ""),
            "check_in": rec.get("check_in_time", "").strftime("%H:%M") if rec.get("check_in_time") else "",
            "check_out": rec.get("check_out_time", "").strftime("%H:%M") if rec.get("check_out_time") else "",
            "duration_hrs": round((rec.get("total_duration", 0) or 0) / 3600, 2)
        })
    
    return {
        "period": f"{start.strftime('%Y-%m-%d')} to {end.strftime('%Y-%m-%d')}",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "records": formatted
    }


# ===================== DATA RETENTION ENDPOINTS =====================

@router.get("/retention/call-logs-stats")
async def get_call_logs_retention_stats(current_user: dict = Depends(require_admin)):
    """
    Get statistics about call logs by age for retention decisions.
    """
    now = datetime.now(timezone.utc)
    
    age_buckets = [
        ("0-30 days", now - timedelta(days=30), now),
        ("31-90 days", now - timedelta(days=90), now - timedelta(days=30)),
        ("91-180 days", now - timedelta(days=180), now - timedelta(days=90)),
        ("181-365 days", now - timedelta(days=365), now - timedelta(days=180)),
        ("Over 365 days", datetime.min.replace(tzinfo=timezone.utc), now - timedelta(days=365))
    ]
    
    stats = []
    for label, start, end in age_buckets:
        count = await db.call_logs.count_documents({
            "created_at": {"$gte": start, "$lt": end}
        })
        stats.append({"period": label, "count": count})
    
    total = await db.call_logs.count_documents({})
    
    return {
        "total_call_logs": total,
        "by_age": stats
    }


@router.post("/retention/export-call-logs")
async def export_call_logs_for_retention(
    older_than_days: int = Query(365, ge=30, le=1000),
    current_user: dict = Depends(require_admin)
):
    """
    Export call logs older than specified days to Excel before deletion.
    """
    cutoff_date = datetime.now(timezone.utc) - timedelta(days=older_than_days)
    
    logs = await db.call_logs.find({
        "created_at": {"$lt": cutoff_date}
    }).sort("created_at", -1).to_list(100000)
    
    if not logs:
        raise HTTPException(status_code=404, detail="No call logs found older than specified date")
    
    # Prepare data for export
    export_data = []
    for log in logs:
        export_data.append({
            "ID": str(log["_id"]),
            "Lead ID": log.get("lead_id", ""),
            "User ID": log.get("user_id", ""),
            "User Name": log.get("user_name", ""),
            "Duration (sec)": log.get("duration", 0),
            "Outcome": log.get("outcome", ""),
            "Call Type": log.get("call_type", ""),
            "Source": log.get("source", ""),
            "Notes": log.get("notes", ""),
            "Created At": log.get("created_at", "").isoformat() if log.get("created_at") else ""
        })
    
    df = pd.DataFrame(export_data)
    output = io.BytesIO()
    
    with pd.ExcelWriter(output, engine='openpyxl') as writer:
        df.to_excel(writer, index=False, sheet_name='Call Logs')
    
    output.seek(0)
    
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    filename = f"call_logs_backup_older_than_{older_than_days}d_{timestamp}.xlsx"
    
    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


@router.delete("/retention/delete-call-logs")
async def delete_old_call_logs(
    older_than_days: int = Query(365, ge=30, le=1000),
    confirm: bool = Query(False, description="Set to true to confirm deletion"),
    current_user: dict = Depends(require_admin)
):
    """
    Delete call logs older than specified days.
    Requires explicit confirmation.
    """
    cutoff_date = datetime.now(timezone.utc) - timedelta(days=older_than_days)
    
    count = await db.call_logs.count_documents({"created_at": {"$lt": cutoff_date}})
    
    if not confirm:
        return {
            "warning": f"This will DELETE {count} call logs older than {older_than_days} days",
            "cutoff_date": cutoff_date.isoformat(),
            "count_to_delete": count,
            "action_required": "Set confirm=true to proceed with deletion",
            "recommendation": "Export data first using /retention/export-call-logs"
        }
    
    result = await db.call_logs.delete_many({"created_at": {"$lt": cutoff_date}})
    
    # Log the deletion
    await db.data_deletion_log.insert_one({
        "collection": "call_logs",
        "older_than_days": older_than_days,
        "cutoff_date": cutoff_date,
        "deleted_count": result.deleted_count,
        "deleted_by": current_user["id"],
        "deleted_at": datetime.now(timezone.utc)
    })
    
    return {
        "success": True,
        "deleted_count": result.deleted_count,
        "cutoff_date": cutoff_date.isoformat()
    }


@router.get("/retention/activity-logs-stats")
async def get_activity_logs_retention_stats(current_user: dict = Depends(require_admin)):
    """Get statistics about activity logs by age."""
    now = datetime.now(timezone.utc)
    
    age_buckets = [
        ("0-30 days", now - timedelta(days=30), now),
        ("31-90 days", now - timedelta(days=90), now - timedelta(days=30)),
        ("Over 90 days", datetime.min.replace(tzinfo=timezone.utc), now - timedelta(days=90))
    ]
    
    stats = []
    for label, start, end in age_buckets:
        count = await db.activities.count_documents({
            "created_at": {"$gte": start, "$lt": end}
        })
        stats.append({"period": label, "count": count})
    
    total = await db.activities.count_documents({})
    
    return {
        "total_activity_logs": total,
        "by_age": stats
    }


@router.post("/retention/export-activity-logs")
async def export_activity_logs_for_retention(
    older_than_days: int = Query(90, ge=30, le=365),
    current_user: dict = Depends(require_admin)
):
    """Export activity logs older than specified days to Excel."""
    cutoff_date = datetime.now(timezone.utc) - timedelta(days=older_than_days)
    
    logs = await db.activities.find({
        "created_at": {"$lt": cutoff_date}
    }).sort("created_at", -1).to_list(100000)
    
    if not logs:
        raise HTTPException(status_code=404, detail="No activity logs found older than specified date")
    
    export_data = []
    for log in logs:
        export_data.append({
            "ID": str(log["_id"]),
            "User ID": log.get("user_id", ""),
            "User Name": log.get("user_name", ""),
            "Action": log.get("action", ""),
            "Lead ID": log.get("lead_id", ""),
            "Details": str(log.get("details", "")),
            "Created At": log.get("created_at", "").isoformat() if log.get("created_at") else ""
        })
    
    df = pd.DataFrame(export_data)
    output = io.BytesIO()
    
    with pd.ExcelWriter(output, engine='openpyxl') as writer:
        df.to_excel(writer, index=False, sheet_name='Activity Logs')
    
    output.seek(0)
    
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    filename = f"activity_logs_backup_older_than_{older_than_days}d_{timestamp}.xlsx"
    
    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


@router.delete("/retention/delete-activity-logs")
async def delete_old_activity_logs(
    older_than_days: int = Query(90, ge=30, le=365),
    confirm: bool = Query(False),
    current_user: dict = Depends(require_admin)
):
    """Delete activity logs older than specified days."""
    cutoff_date = datetime.now(timezone.utc) - timedelta(days=older_than_days)
    
    count = await db.activities.count_documents({"created_at": {"$lt": cutoff_date}})
    
    if not confirm:
        return {
            "warning": f"This will DELETE {count} activity logs older than {older_than_days} days",
            "cutoff_date": cutoff_date.isoformat(),
            "count_to_delete": count,
            "action_required": "Set confirm=true to proceed with deletion"
        }
    
    result = await db.activities.delete_many({"created_at": {"$lt": cutoff_date}})
    
    await db.data_deletion_log.insert_one({
        "collection": "activities",
        "older_than_days": older_than_days,
        "cutoff_date": cutoff_date,
        "deleted_count": result.deleted_count,
        "deleted_by": current_user["id"],
        "deleted_at": datetime.now(timezone.utc)
    })
    
    return {
        "success": True,
        "deleted_count": result.deleted_count,
        "cutoff_date": cutoff_date.isoformat()
    }


@router.post("/retention/export-verified-call-logs")
async def export_verified_call_logs_for_retention(
    older_than_days: int = Query(180, ge=30, le=365),
    current_user: dict = Depends(require_admin)
):
    """Export verified call logs older than specified days to Excel."""
    cutoff_date = datetime.now(timezone.utc) - timedelta(days=older_than_days)
    
    logs = await db.verified_call_logs.find({
        "synced_at": {"$lt": cutoff_date}
    }).sort("synced_at", -1).to_list(100000)
    
    if not logs:
        raise HTTPException(status_code=404, detail="No verified call logs found older than specified date")
    
    export_data = []
    for log in logs:
        export_data.append({
            "ID": str(log["_id"]),
            "Lead ID": log.get("lead_id", ""),
            "User ID": log.get("user_id", ""),
            "Duration (sec)": log.get("duration_seconds", 0),
            "Call Type": log.get("call_type", ""),
            "Device Timestamp": log.get("device_timestamp", ""),
            "Phone Number": log.get("phone_number", ""),
            "Synced At": log.get("synced_at", "").isoformat() if log.get("synced_at") else ""
        })
    
    df = pd.DataFrame(export_data)
    output = io.BytesIO()
    
    with pd.ExcelWriter(output, engine='openpyxl') as writer:
        df.to_excel(writer, index=False, sheet_name='Verified Call Logs')
    
    output.seek(0)
    
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    filename = f"verified_call_logs_backup_older_than_{older_than_days}d_{timestamp}.xlsx"
    
    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


@router.delete("/retention/delete-verified-call-logs")
async def delete_old_verified_call_logs(
    older_than_days: int = Query(180, ge=30, le=365),
    confirm: bool = Query(False),
    current_user: dict = Depends(require_admin)
):
    """Delete verified call logs older than specified days."""
    cutoff_date = datetime.now(timezone.utc) - timedelta(days=older_than_days)
    
    count = await db.verified_call_logs.count_documents({"synced_at": {"$lt": cutoff_date}})
    
    if not confirm:
        return {
            "warning": f"This will DELETE {count} verified call logs older than {older_than_days} days",
            "cutoff_date": cutoff_date.isoformat(),
            "count_to_delete": count,
            "action_required": "Set confirm=true to proceed with deletion"
        }
    
    result = await db.verified_call_logs.delete_many({"synced_at": {"$lt": cutoff_date}})
    
    await db.data_deletion_log.insert_one({
        "collection": "verified_call_logs",
        "older_than_days": older_than_days,
        "cutoff_date": cutoff_date,
        "deleted_count": result.deleted_count,
        "deleted_by": current_user["id"],
        "deleted_at": datetime.now(timezone.utc)
    })
    
    return {
        "success": True,
        "deleted_count": result.deleted_count,
        "cutoff_date": cutoff_date.isoformat()
    }


@router.get("/retention/deletion-history")
async def get_deletion_history(current_user: dict = Depends(require_admin)):
    """Get history of manual data deletions."""
    history = await db.data_deletion_log.find({}).sort("deleted_at", -1).to_list(100)
    return serialize_docs(history)
