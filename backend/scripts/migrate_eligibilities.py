"""
Migration script to populate Bank Eligibilities from Google Sheet export.
Reads the CSV export and updates the eligibilities field for all legacy files.
"""
import asyncio
import csv
import ast
import json
import re
import os
from datetime import datetime, timezone
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

# Load environment
load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

CSV_FILE = '/tmp/files_ad.csv'

def safe_parse_eligibilities(raw_str):
    """Try multiple methods to parse eligibilities."""
    if not raw_str or not raw_str.strip():
        return []
    
    raw_str = raw_str.strip()
    
    # Method 1: Try JSON
    try:
        return json.loads(raw_str)
    except Exception:
        pass
    
    # Method 2: Try ast.literal_eval
    try:
        result = ast.literal_eval(raw_str)
        return result if isinstance(result, list) else [result]
    except Exception:
        pass
    
    # Method 3: If truncated, try to fix common issues
    if not raw_str.endswith(']') and not raw_str.endswith('}'):
        last_complete = raw_str.rfind('},')
        if last_complete > 0:
            fixed = raw_str[:last_complete+1] + ']'
            try:
                result = ast.literal_eval(fixed)
                return result if isinstance(result, list) else [result]
            except Exception:
                pass
        
        fixed = raw_str + '}]'
        try:
            result = ast.literal_eval(fixed)
            return result if isinstance(result, list) else [result]
        except Exception:
            pass
    
    # Method 4: Extract bank names using regex
    bank_pattern = r"'bank_name':\s*'([^']+)'"
    banks = re.findall(bank_pattern, raw_str)
    if banks:
        return [{'bank_name': bank} for bank in banks]
    
    return []

async def migrate_eligibilities():
    """Main migration function."""
    client = AsyncIOMotorClient(os.environ.get('MONGO_URL'))
    db = client[os.environ.get('DB_NAME', 'bankezee_connect')]
    
    print("=" * 60)
    print("Bank Eligibilities Migration Script (CSV)")
    print("=" * 60)
    
    # Read CSV file
    if not os.path.exists(CSV_FILE):
        print(f"ERROR: CSV file not found at {CSV_FILE}")
        return
    
    with open(CSV_FILE, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        rows = list(reader)
    
    print(f"Loaded {len(rows)} records from CSV")
    
    # Count stats
    total_processed = 0
    updated_count = 0
    skipped_empty = 0
    skipped_already = 0
    not_found = 0
    
    for row in rows:
        file_id = row.get('id', '').strip()
        elig_raw = row.get('eligibilities', '').strip()
        
        if not file_id:
            continue
        
        total_processed += 1
        
        if not elig_raw or elig_raw == '[]':
            skipped_empty += 1
            continue
        
        # Parse eligibilities
        eligibilities = safe_parse_eligibilities(elig_raw)
        
        if not eligibilities:
            skipped_empty += 1
            continue
        
        # Filter out empty bank entries
        valid_eligibilities = [
            e for e in eligibilities 
            if e.get('bank_name') and str(e.get('bank_name')).strip()
        ]
        
        if not valid_eligibilities:
            skipped_empty += 1
            continue
        
        # Check if file exists in database
        existing = await db.leads.find_one({"id": file_id}, {"_id": 0, "id": 1, "eligibilities": 1})
        
        if not existing:
            not_found += 1
            continue
        
        # Check if already has eligibilities
        current_elig = existing.get('eligibilities') or []
        if current_elig and len(current_elig) > 0:
            current_banks = set(str(e.get('bank_name', '')).upper().strip() for e in current_elig if e.get('bank_name'))
            new_banks = set(str(e.get('bank_name', '')).upper().strip() for e in valid_eligibilities if e.get('bank_name'))
            
            if new_banks.issubset(current_banks):
                skipped_already += 1
                continue
            
            # Merge: keep existing + add new banks
            merged = list(current_elig)
            for new_elig in valid_eligibilities:
                bank_name = str(new_elig.get('bank_name', '')).upper().strip()
                if bank_name and bank_name not in current_banks:
                    merged.append(new_elig)
                    current_banks.add(bank_name)
            
            valid_eligibilities = merged
        
        # Update the file
        result = await db.leads.update_one(
            {"id": file_id},
            {
                "$set": {
                    "eligibilities": valid_eligibilities,
                    "updated_at": datetime.now(timezone.utc).isoformat()
                }
            }
        )
        
        if result.modified_count > 0:
            updated_count += 1
            if updated_count <= 30:
                print(f"  Updated: {file_id[:8]}... - {len(valid_eligibilities)} banks")
    
    print("\n" + "=" * 60)
    print("Migration Complete")
    print("=" * 60)
    print(f"Total processed: {total_processed}")
    print(f"Updated: {updated_count}")
    print(f"Skipped (empty eligibilities): {skipped_empty}")
    print(f"Skipped (already has data): {skipped_already}")
    print(f"Not found in database: {not_found}")
    
    # Final verification
    with_elig = await db.leads.count_documents({
        "status": "file", 
        "eligibilities": {"$exists": True},
        "$expr": {"$gt": [{"$size": {"$ifNull": ["$eligibilities", []]}}, 0]}
    })
    total_files = await db.leads.count_documents({"status": "file"})
    print(f"\nFinal state: {with_elig}/{total_files} files have eligibilities")
    
    client.close()


if __name__ == "__main__":
    asyncio.run(migrate_eligibilities())
