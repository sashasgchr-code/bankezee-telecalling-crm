"""
Data Cleanup Routes
Handles call log deduplication and data maintenance
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from datetime import datetime, timezone, timedelta
from typing import Optional
from bson import ObjectId

from utils.database import db
from utils.auth import require_admin
from utils.helpers import serialize_doc, serialize_docs

router = APIRouter(prefix="/api/data-cleanup", tags=["Data Cleanup"])


@router.get("/call-log-analysis")
async def analyze_call_logs(
    days: int = Query(30, ge=1, le=365),
    current_user: dict = Depends(require_admin)
):
    """
    Analyze call logs for potential duplicates.
    Returns statistics about web vs mobile logs and potential overlaps.
    """
    start_date = datetime.now(timezone.utc) - timedelta(days=days)
    
    # Get counts by source
    pipeline = [
        {"$match": {"created_at": {"$gte": start_date}}},
        {"$group": {
            "_id": "$source",
            "count": {"$sum": 1},
            "total_duration": {"$sum": "$duration"}
        }}
    ]
    
    source_stats = await db.call_logs.aggregate(pipeline).to_list(10)
    
    # Get verified call logs count
    verified_count = await db.verified_call_logs.count_documents({
        "synced_at": {"$gte": start_date}
    })
    
    # Find potential duplicates (same lead, same user, within 5 minutes)
    duplicate_pipeline = [
        {"$match": {"created_at": {"$gte": start_date}}},
        {"$group": {
            "_id": {
                "lead_id": "$lead_id",
                "user_id": "$user_id",
                "date_bucket": {
                    "$dateToString": {
                        "format": "%Y-%m-%d-%H",
                        "date": "$created_at"
                    }
                }
            },
            "count": {"$sum": 1},
            "logs": {"$push": {
                "id": {"$toString": "$_id"},
                "source": "$source",
                "duration": "$duration",
                "outcome": "$outcome",
                "created_at": "$created_at"
            }}
        }},
        {"$match": {"count": {"$gt": 1}}},
        {"$sort": {"count": -1}},
        {"$limit": 50}
    ]
    
    potential_duplicates = await db.call_logs.aggregate(duplicate_pipeline).to_list(50)
    
    # Format source stats
    stats_map = {item["_id"] or "legacy": item for item in source_stats}
    
    return {
        "period_days": days,
        "source_breakdown": {
            "web": stats_map.get("web", {"count": 0, "total_duration": 0}),
            "mobile": stats_map.get("mobile", {"count": 0, "total_duration": 0}),
            "legacy": stats_map.get("legacy", {"count": 0, "total_duration": 0}),
            "device_sync": stats_map.get("device_sync", {"count": 0, "total_duration": 0})
        },
        "verified_call_logs_count": verified_count,
        "potential_duplicate_groups": len(potential_duplicates),
        "duplicate_samples": potential_duplicates[:10]
    }


@router.post("/deduplicate-call-logs")
async def deduplicate_call_logs(
    dry_run: bool = Query(True, description="If true, only report what would be deleted"),
    days: int = Query(30, ge=1, le=365),
    current_user: dict = Depends(require_admin)
):
    """
    Deduplicate call logs by keeping the most complete record.
    Priority: Mobile (verified) > Web with duration > Web without duration
    """
    start_date = datetime.now(timezone.utc) - timedelta(days=days)
    
    # Find duplicate groups
    duplicate_pipeline = [
        {"$match": {"created_at": {"$gte": start_date}}},
        {"$group": {
            "_id": {
                "lead_id": "$lead_id",
                "user_id": "$user_id",
                # Group by 10-minute windows
                "time_bucket": {
                    "$dateTrunc": {
                        "date": "$created_at",
                        "unit": "minute",
                        "binSize": 10
                    }
                }
            },
            "count": {"$sum": 1},
            "logs": {"$push": {
                "id": "$_id",
                "source": "$source",
                "duration": "$duration",
                "outcome": "$outcome",
                "is_verified": "$is_verified",
                "created_at": "$created_at"
            }}
        }},
        {"$match": {"count": {"$gt": 1}}}
    ]
    
    duplicate_groups = await db.call_logs.aggregate(duplicate_pipeline).to_list(10000)
    
    ids_to_delete = []
    
    for group in duplicate_groups:
        logs = group["logs"]
        
        # Sort by priority: verified mobile > mobile > web with duration > web without
        def sort_key(log):
            score = 0
            if log.get("is_verified"):
                score += 1000
            if log.get("source") == "mobile":
                score += 100
            if log.get("duration") and log["duration"] > 0:
                score += 50
            return score
        
        logs.sort(key=sort_key, reverse=True)
        
        # Keep the first (highest priority), delete the rest
        for log in logs[1:]:
            ids_to_delete.append(log["id"])
    
    result = {
        "duplicate_groups_found": len(duplicate_groups),
        "records_to_delete": len(ids_to_delete),
        "dry_run": dry_run
    }
    
    if not dry_run and ids_to_delete:
        # Actually delete the duplicates
        delete_result = await db.call_logs.delete_many({
            "_id": {"$in": ids_to_delete}
        })
        result["deleted_count"] = delete_result.deleted_count
    
    return result


@router.post("/merge-verified-logs")
async def merge_verified_logs(
    dry_run: bool = Query(True, description="If true, only report what would be merged"),
    days: int = Query(30, ge=1, le=365),
    current_user: dict = Depends(require_admin)
):
    """
    Merge verified_call_logs into the main call_logs collection.
    Creates canonical call records with verified durations.
    """
    start_date = datetime.now(timezone.utc) - timedelta(days=days)
    
    # Get verified logs that haven't been merged
    verified_logs = await db.verified_call_logs.find({
        "synced_at": {"$gte": start_date},
        "merged_to_call_logs": {"$ne": True}
    }).to_list(10000)
    
    merged_count = 0
    updated_count = 0
    
    for vlog in verified_logs:
        # Check if a call log already exists for this lead/user/time
        existing = await db.call_logs.find_one({
            "lead_id": vlog["lead_id"],
            "user_id": vlog["user_id"],
            "created_at": {
                "$gte": datetime.fromisoformat(vlog["device_timestamp"]) - timedelta(minutes=10),
                "$lte": datetime.fromisoformat(vlog["device_timestamp"]) + timedelta(minutes=10)
            }
        })
        
        if existing:
            # Update existing log with verified data
            if not dry_run:
                await db.call_logs.update_one(
                    {"_id": existing["_id"]},
                    {"$set": {
                        "is_verified": True,
                        "verified_duration": vlog["duration_seconds"],
                        "device_timestamp": vlog["device_timestamp"],
                        "call_type": vlog.get("call_type", existing.get("call_type")),
                        "updated_at": datetime.now(timezone.utc)
                    }}
                )
                await db.verified_call_logs.update_one(
                    {"_id": vlog["_id"]},
                    {"$set": {"merged_to_call_logs": True}}
                )
            updated_count += 1
        else:
            # Create new call log from verified log
            if not dry_run:
                new_log = {
                    "lead_id": vlog["lead_id"],
                    "user_id": vlog["user_id"],
                    "user_name": vlog.get("user_name", ""),
                    "duration": vlog["duration_seconds"],
                    "outcome": "connected" if vlog["duration_seconds"] > 0 else "no_answer",
                    "call_type": vlog.get("call_type", "outgoing"),
                    "direction": vlog.get("call_type", "outgoing"),
                    "source": "device_sync",
                    "is_verified": True,
                    "device_timestamp": vlog["device_timestamp"],
                    "created_at": datetime.fromisoformat(vlog["device_timestamp"]),
                    "synced_from_verified": True
                }
                await db.call_logs.insert_one(new_log)
                await db.verified_call_logs.update_one(
                    {"_id": vlog["_id"]},
                    {"$set": {"merged_to_call_logs": True}}
                )
            merged_count += 1
    
    return {
        "verified_logs_processed": len(verified_logs),
        "new_logs_created": merged_count,
        "existing_logs_updated": updated_count,
        "dry_run": dry_run
    }


@router.get("/call-log-canonical/{lead_id}")
async def get_canonical_call_history(
    lead_id: str,
    current_user: dict = Depends(require_admin)
):
    """
    Get canonical (deduplicated) call history for a lead.
    Shows unified view of all calls with verification status.
    """
    # Get all call logs for this lead
    call_logs = await db.call_logs.find({"lead_id": lead_id}).sort("created_at", -1).to_list(100)
    
    # Enrich with verification info
    result = []
    for log in call_logs:
        log_data = serialize_doc(log)
        log_data["source"] = log.get("source", "web")
        log_data["is_verified"] = log.get("is_verified", False)
        log_data["verification_source"] = "mobile" if log.get("source") == "mobile" else "device_sync" if log.get("synced_from_verified") else None
        result.append(log_data)
    
    return {
        "lead_id": lead_id,
        "total_calls": len(result),
        "verified_calls": sum(1 for r in result if r.get("is_verified")),
        "calls": result
    }


@router.get("/stats")
async def get_data_cleanup_stats(current_user: dict = Depends(require_admin)):
    """Get overall data cleanup statistics"""
    now = datetime.now(timezone.utc)
    
    # Collection counts
    call_logs_count = await db.call_logs.count_documents({})
    verified_logs_count = await db.verified_call_logs.count_documents({})
    leads_count = await db.leads.count_documents({})
    
    # Recent activity (last 7 days)
    week_ago = now - timedelta(days=7)
    recent_calls = await db.call_logs.count_documents({"created_at": {"$gte": week_ago}})
    recent_verified = await db.verified_call_logs.count_documents({"synced_at": {"$gte": week_ago}})
    
    # Suppression list
    suppressed_count = await db.suppression_list.count_documents({})
    
    # Archived leads
    archived_count = await db.leads.count_documents({"archived": True})
    
    return {
        "collections": {
            "call_logs": call_logs_count,
            "verified_call_logs": verified_logs_count,
            "leads": leads_count,
            "suppression_list": suppressed_count,
            "archived_leads": archived_count
        },
        "recent_7_days": {
            "call_logs": recent_calls,
            "verified_logs": recent_verified
        },
        "recommendations": [
            "Run deduplication if call_logs > 10000" if call_logs_count > 10000 else None,
            "Merge verified logs" if verified_logs_count > 0 else None,
            "Review suppression list" if suppressed_count > 100 else None
        ]
    }
