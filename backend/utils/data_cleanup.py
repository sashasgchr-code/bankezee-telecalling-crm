"""
Data Cleanup Utilities for BankEzee Connect
Run periodically to archive/delete old data and maintain performance

Usage:
  python -m utils.data_cleanup --dry-run  # Preview what would be deleted
  python -m utils.data_cleanup --execute  # Actually delete old data
"""
import asyncio
from datetime import datetime, timedelta, timezone
from motor.motor_asyncio import AsyncIOMotorClient
import os
import argparse

# Retention policies (in days)
RETENTION_POLICIES = {
    "activity_logs": 7,           # Keep only 7 days of activity pings
    "call_sessions": 30,          # Keep completed call sessions for 30 days
    "verified_call_logs": 365,    # Keep verified calls for 1 year
    "call_logs": 365,             # Keep call logs for 1 year
    "daily_sessions": 365,        # Keep daily stats for 1 year
    "attendance": 730,            # Keep attendance for 2 years
    "wfh_requests": 180,          # Keep WFH requests for 6 months
    "wfh_approvals": 180,         # Keep WFH approvals for 6 months
    "leave_approvals": 365,       # Keep leave records for 1 year
    "call_recordings": 180,       # Keep recording metadata for 6 months
}

async def get_collection_stats(db):
    """Get document counts and oldest records for each collection"""
    stats = {}
    collections = await db.list_collection_names()
    
    for coll_name in collections:
        coll = db[coll_name]
        count = await coll.count_documents({})
        
        # Find oldest record
        oldest = None
        for date_field in ["created_at", "timestamp", "attendance_date", "recorded_at", "call_timestamp"]:
            try:
                doc = await coll.find_one(
                    {date_field: {"$exists": True}},
                    sort=[(date_field, 1)]
                )
                if doc and doc.get(date_field):
                    oldest = doc[date_field]
                    break
            except Exception:
                continue
        
        stats[coll_name] = {
            "count": count,
            "oldest": oldest.isoformat() if oldest else "N/A"
        }
    
    return stats

async def cleanup_collection(db, collection_name, days_to_keep, date_field, dry_run=True):
    """Delete documents older than specified days"""
    coll = db[collection_name]
    cutoff_date = datetime.now(timezone.utc) - timedelta(days=days_to_keep)
    
    # Count documents to delete
    query = {date_field: {"$lt": cutoff_date}}
    count_to_delete = await coll.count_documents(query)
    
    if count_to_delete == 0:
        return {"collection": collection_name, "deleted": 0, "message": "No old documents found"}
    
    if dry_run:
        return {
            "collection": collection_name,
            "would_delete": count_to_delete,
            "cutoff_date": cutoff_date.isoformat(),
            "dry_run": True
        }
    
    # Actually delete
    result = await coll.delete_many(query)
    return {
        "collection": collection_name,
        "deleted": result.deleted_count,
        "cutoff_date": cutoff_date.isoformat()
    }

async def run_cleanup(dry_run=True):
    """Run cleanup on all collections based on retention policies"""
    client = AsyncIOMotorClient(os.environ.get('MONGO_URL'))
    db = client[os.environ.get('DB_NAME', 'responsive_crm')]
    
    print("=" * 60)
    print(f"DATA CLEANUP {'(DRY RUN)' if dry_run else '(EXECUTING)'}")
    print(f"Timestamp: {datetime.now(timezone.utc).isoformat()}")
    print("=" * 60)
    
    # Get current stats
    print("\n📊 Current Collection Stats:")
    stats = await get_collection_stats(db)
    for name, info in sorted(stats.items(), key=lambda x: x[1]["count"], reverse=True):
        print(f"  {name}: {info['count']:,} documents (oldest: {info['oldest']})")
    
    # Collection to date field mapping
    date_fields = {
        "activity_logs": "timestamp",
        "call_sessions": "start_time",
        "verified_call_logs": "call_timestamp",
        "call_logs": "created_at",
        "daily_sessions": "date",
        "attendance": "attendance_date",
        "wfh_requests": "created_at",
        "wfh_approvals": "created_at",
        "leave_approvals": "created_at",
        "call_recordings": "recorded_at",
    }
    
    print("\n🧹 Cleanup Results:")
    results = []
    for collection_name, days in RETENTION_POLICIES.items():
        if collection_name in date_fields:
            result = await cleanup_collection(
                db, 
                collection_name, 
                days, 
                date_fields[collection_name],
                dry_run
            )
            results.append(result)
            
            if dry_run and result.get("would_delete", 0) > 0:
                print(f"  ⚠️  {collection_name}: Would delete {result['would_delete']:,} documents older than {days} days")
            elif not dry_run and result.get("deleted", 0) > 0:
                print(f"  ✅ {collection_name}: Deleted {result['deleted']:,} documents")
            else:
                print(f"  ✓  {collection_name}: No cleanup needed")
    
    print("\n" + "=" * 60)
    if dry_run:
        print("This was a DRY RUN. No data was deleted.")
        print("Run with --execute to actually delete old data.")
    else:
        print("Cleanup completed successfully.")
    print("=" * 60)
    
    return results

async def create_indexes(db):
    """Create indexes for better query performance"""
    indexes_to_create = [
        ("leads", [("assigned_to", 1), ("status", 1)]),
        ("leads", [("created_at", -1)]),
        ("leads", [("phone", 1)]),
        ("leads", [("name", "text"), ("email", "text")]),
        ("call_logs", [("user_id", 1), ("created_at", -1)]),
        ("call_logs", [("lead_id", 1)]),
        ("verified_call_logs", [("user_id", 1), ("call_timestamp", -1)]),
        ("verified_call_logs", [("phone_number", 1)]),
        ("daily_sessions", [("user_id", 1), ("date", -1)]),
        ("attendance", [("user_id", 1), ("attendance_date", -1)]),
        ("attendance", [("attendance_date", -1)]),
        ("activity_logs", [("user_id", 1), ("timestamp", -1)]),
        ("activity_logs", [("timestamp", -1)]),
    ]
    
    print("\n📑 Creating Indexes for Performance:")
    for collection_name, index_fields in indexes_to_create:
        try:
            coll = db[collection_name]
            index_name = await coll.create_index(index_fields)
            print(f"  ✅ {collection_name}: {index_name}")
        except Exception as e:
            print(f"  ⚠️  {collection_name}: {str(e)}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="BankEzee Connect Data Cleanup")
    parser.add_argument("--dry-run", action="store_true", help="Preview changes without deleting")
    parser.add_argument("--execute", action="store_true", help="Actually delete old data")
    parser.add_argument("--create-indexes", action="store_true", help="Create database indexes")
    args = parser.parse_args()
    
    if args.create_indexes:
        async def run():
            client = AsyncIOMotorClient(os.environ.get('MONGO_URL'))
            db = client[os.environ.get('DB_NAME', 'responsive_crm')]
            await create_indexes(db)
        asyncio.run(run())
    elif args.execute:
        asyncio.run(run_cleanup(dry_run=False))
    else:
        asyncio.run(run_cleanup(dry_run=True))
