"""
Legacy CRM Data Import Script

Imports historical CRM data from Google Sheet export into Connect Files module.
This script:
- Fetches files data from Google Sheet CSV export
- Properly deserializes nested arrays (activities, eligibilities, documents)
- Preserves original IDs as legacy_crm_id
- Makes migration idempotent (no duplicates based on legacy_crm_id or phone)
- Imports only into Files module (status='file'), NOT Connect Data
"""

import os
import sys
import csv
import json
import uuid
import requests
from io import StringIO
from datetime import datetime, timezone
from pymongo import MongoClient
from dotenv import load_dotenv

# Load environment
ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
load_dotenv(os.path.join(ROOT_DIR, '.env'))

MONGO_URL = os.environ.get('MONGO_URL', 'mongodb://localhost:27017')
DB_NAME = os.environ.get('DB_NAME', 'test_database')

# Google Sheet ID
SHEET_ID = '1JCtlaMepl_ubXKyAAzaeg0_PT6pIoPQXMIdJqeE0QhA'


def parse_json_field(value):
    """
    Parse a JSON string field back into a Python object.
    Handles various formats including escaped JSON, arrays, and objects.
    Also handles Python repr format (single quotes, None, True, False).
    """
    import ast
    
    if not value or value.strip() == '' or value.strip() == '[]' or value.strip() == '{}':
        return [] if value and value.strip().startswith('[') else {}
    
    # Method 1: Try ast.literal_eval for Python repr format
    try:
        result = ast.literal_eval(value)
        return result
    except (ValueError, SyntaxError, TypeError):
        pass
    
    # Method 2: Try direct JSON parse
    try:
        return json.loads(value)
    except (json.JSONDecodeError, TypeError):
        pass
    
    # Method 3: Replace Python literals with JSON equivalents
    try:
        fixed = value.replace("'", '"').replace('None', 'null').replace('True', 'true').replace('False', 'false')
        return json.loads(fixed)
    except (json.JSONDecodeError, TypeError):
        pass
    
    # If it looks like a list but failed, return empty list
    if value.strip().startswith('['):
        return []
    
    # If it looks like a dict but failed, return empty dict
    if value.strip().startswith('{'):
        return {}
    
    # Return as-is for strings
    return value


def transform_file_record(row: dict) -> dict:
    """
    Transform a CSV row from the Google Sheet into the Connect Files format.
    
    Maps fields and properly handles nested data structures.
    """
    # Build additional_data/file_details from flattened columns
    file_details = {}
    additional_data_fields = [
        'mother_name', 'current_address', 'company_name', 'net_salary',
        'office_address', 'obligations_emi', 'existing_loan_1', 'existing_loan_2',
        'existing_loan_3', 'type_of_loan', 'cibil_score', 'loan_amount_required',
        'tenure_required', 'documents_note', 'tvr_done', 'emi_ok',
        'tvr_not_done_reason', 'emi_not_ok_reason', 'cibil_issues', 'foir',
        'company_type', 'has_password_files', 'file_passwords'
    ]
    
    for field in additional_data_fields:
        key = f'additional_data.{field}'
        if key in row and row[key]:
            file_details[field] = row[key]
    
    # Parse nested JSON fields
    activities = parse_json_field(row.get('activities', '[]'))
    if not isinstance(activities, list):
        activities = []
    
    eligibilities = parse_json_field(row.get('eligibilities', '[]'))
    if not isinstance(eligibilities, list):
        eligibilities = []
    
    documents = parse_json_field(row.get('documents', '[]'))
    if not isinstance(documents, list):
        documents = []
    
    # Build the transformed record
    transformed = {
        'legacy_crm_id': row.get('id', ''),  # Preserve original ID
        'id': str(uuid.uuid4()),  # New Connect ID
        'name': row.get('full_name', '') or '',
        'phone': str(row.get('mobile', '') or '').replace(' ', '').replace('-', ''),
        'email': row.get('email', '') or '',
        'city': row.get('city', '') or '',
        'employment_type': row.get('employment_type', '') or '',
        'requirement': row.get('requirement', '') or '',
        'status': 'file',  # All records go to Files module
        'file_status': map_status(row.get('status', 'new')),
        'source': row.get('source', '') or 'legacy_crm',
        'source_id': row.get('source_id', '') or '',
        'assigned_to': row.get('assigned_to', '') or None,
        'file_assigned_to': row.get('assigned_to', '') or None,  # Same as assigned_to in legacy
        'file_details': file_details,
        'eligibilities': eligibilities,
        'file_activities': activities,
        'documents': documents,
        'star_rating': safe_int(row.get('star_rating', 0)),
        'star_score': safe_float(row.get('star_score', 0)),
        'star_manual': row.get('star_manual', '') == 'True' or row.get('star_manual', '') == 'true',
        'pending_documents': row.get('pending_documents', '') or '',
        'query_hold_reason': row.get('query_hold_reason', '') or '',
        'created_at': row.get('created_at', '') or datetime.now(timezone.utc).isoformat(),
        'updated_at': row.get('updated_at', '') or datetime.now(timezone.utc).isoformat(),
        'import_source': 'legacy_crm_google_sheet',
        'import_timestamp': datetime.now(timezone.utc).isoformat()
    }
    
    return transformed


def map_status(status: str) -> str:
    """Map legacy CRM status to Connect file_status"""
    if not status:
        return 'new'
    
    status_lower = status.lower().strip()
    
    status_mapping = {
        'new': 'new',
        'contacted': 'contacted',
        'in progress': 'contacted',
        'inprogress': 'contacted',
        'documents pending': 'documents_pending',
        'documents_pending': 'documents_pending',
        'sent for eligibility': 'sent_for_eligibility',
        'sent_for_eligibility': 'sent_for_eligibility',
        'sent for login': 'sent_for_login',
        'sent_for_login': 'sent_for_login',
        'query hold': 'query_hold',
        'query_hold': 'query_hold',
        'query': 'query_hold',
        'hold': 'query_hold',
        'documents collected': 'documents_collected',
        'documents_collected': 'documents_collected',
        'not eligible': 'not_eligible',
        'not_eligible': 'not_eligible',
        'noteligible': 'not_eligible',
        'sent to bank': 'sent_to_bank',
        'sent_to_bank': 'sent_to_bank',
        'login': 'login',
        'logged in': 'login',
        'not login': 'not_login',
        'not_login': 'not_login',
        'underwriting': 'underwriting',
        'fi': 'fi',
        'fi reinitiated': 'fi_reinitiated',
        'fi_reinitiated': 'fi_reinitiated',
        'fi negative': 'fi_negative',
        'fi_negative': 'fi_negative',
        'approved': 'approved',
        'sanctioned': 'approved',
        'declined': 'declined',
        'rejected': 'rejected',
        'disbursed': 'disbursed',
        'disbursement': 'disbursed',
        'not disbursed': 'not_disbursed',
        'not_disbursed': 'not_disbursed',
        'customer not interested': 'customer_not_interested',
        'customer_not_interested': 'customer_not_interested',
        'not interested': 'customer_not_interested',
        'customer not supporting': 'customer_not_supporting',
        'customer_not_supporting': 'customer_not_supporting',
        'not supporting': 'customer_not_supporting',
        'supporting': 'supporting',
    }
    
    return status_mapping.get(status_lower, status_lower)


def safe_int(value):
    """Safely convert to int"""
    try:
        if value is None or value == '':
            return 0
        return int(float(value))
    except (ValueError, TypeError):
        return 0


def safe_float(value):
    """Safely convert to float"""
    try:
        if value is None or value == '':
            return 0.0
        return float(value)
    except (ValueError, TypeError):
        return 0.0


def fetch_google_sheet_csv(sheet_name: str) -> list:
    """Fetch data from Google Sheet as CSV and parse it"""
    url = f'https://docs.google.com/spreadsheets/d/{SHEET_ID}/gviz/tq?tqx=out:csv&sheet={sheet_name}'
    
    print(f"Fetching {sheet_name} from Google Sheets...")
    response = requests.get(url, timeout=60)
    
    if response.status_code != 200:
        print(f"Error fetching {sheet_name}: HTTP {response.status_code}")
        return []
    
    reader = csv.DictReader(StringIO(response.text))
    rows = list(reader)
    print(f"  Fetched {len(rows)} rows from {sheet_name}")
    return rows


def import_files(db, dry_run=False):
    """
    Import files from Google Sheet into MongoDB.
    
    This is idempotent - it will:
    - Skip records that already exist (by legacy_crm_id or phone)
    - Update records if they have changed
    """
    files_data = fetch_google_sheet_csv('files')
    
    if not files_data:
        print("No files data to import")
        return {'imported': 0, 'updated': 0, 'skipped': 0, 'errors': []}
    
    imported = 0
    updated = 0
    skipped = 0
    errors = []
    
    for i, row in enumerate(files_data):
        try:
            transformed = transform_file_record(row)
            legacy_id = transformed.get('legacy_crm_id', '')
            phone = transformed.get('phone', '')
            
            if not phone and not legacy_id:
                skipped += 1
                continue
            
            # Check if record already exists
            existing = None
            if legacy_id:
                existing = db.leads.find_one({'legacy_crm_id': legacy_id})
            if not existing and phone:
                existing = db.leads.find_one({'phone': phone, 'status': 'file'})
            
            if existing:
                if dry_run:
                    print(f"  [DRY RUN] Would update: {transformed['name']} ({phone})")
                    updated += 1
                else:
                    # Update existing record, preserving Connect-specific fields
                    update_fields = {
                        'name': transformed['name'],
                        'email': transformed['email'],
                        'city': transformed['city'],
                        'employment_type': transformed['employment_type'],
                        'requirement': transformed['requirement'],
                        'file_status': transformed['file_status'],
                        'file_details': transformed['file_details'],
                        'eligibilities': transformed['eligibilities'],
                        'file_activities': transformed['file_activities'],
                        'documents': transformed['documents'],
                        'star_rating': transformed['star_rating'],
                        'star_score': transformed['star_score'],
                        'star_manual': transformed['star_manual'],
                        'pending_documents': transformed['pending_documents'],
                        'query_hold_reason': transformed['query_hold_reason'],
                        'legacy_crm_id': legacy_id,
                        'updated_at': datetime.now(timezone.utc).isoformat(),
                        'import_source': 'legacy_crm_google_sheet'
                    }
                    
                    # Only update created_at if it was previously empty
                    if not existing.get('created_at') and transformed.get('created_at'):
                        update_fields['created_at'] = transformed['created_at']
                    
                    # Preserve assigned_to if it exists
                    if transformed.get('assigned_to') and not existing.get('assigned_to'):
                        update_fields['assigned_to'] = transformed['assigned_to']
                    if transformed.get('file_assigned_to') and not existing.get('file_assigned_to'):
                        update_fields['file_assigned_to'] = transformed['file_assigned_to']
                    
                    db.leads.update_one(
                        {'_id': existing['_id']},
                        {'$set': update_fields}
                    )
                    updated += 1
            else:
                if dry_run:
                    print(f"  [DRY RUN] Would insert: {transformed['name']} ({phone})")
                    imported += 1
                else:
                    # Insert new record
                    db.leads.insert_one(transformed)
                    imported += 1
            
            # Progress indicator
            if (i + 1) % 100 == 0:
                print(f"  Processed {i + 1}/{len(files_data)} records...")
                
        except Exception as e:
            errors.append({'row': i, 'error': str(e), 'phone': row.get('mobile', 'unknown')})
            if len(errors) <= 5:
                print(f"  Error on row {i}: {e}")
    
    return {
        'imported': imported,
        'updated': updated,
        'skipped': skipped,
        'errors': errors[:20]
    }


def import_commissions(db, dry_run=False):
    """Import commissions data"""
    commissions_data = fetch_google_sheet_csv('commissions')
    
    if not commissions_data:
        print("No commissions data to import")
        return {'imported': 0, 'skipped': 0}
    
    imported = 0
    skipped = 0
    
    for row in commissions_data:
        lead_id = row.get('lead_id', '')
        if not lead_id:
            skipped += 1
            continue
        
        commission = {
            'lead_id': lead_id,
            'source_id': row.get('source_id', ''),
            'source_type': row.get('source_type', ''),
            'amount': safe_float(row.get('amount', 0)),
            'created_at': row.get('created_at', ''),
            'type': row.get('type', 'credit')
        }
        
        if dry_run:
            imported += 1
        else:
            # Check if this exact commission already exists
            existing = db.commissions.find_one({
                'lead_id': lead_id,
                'source_id': commission['source_id'],
                'created_at': commission['created_at']
            })
            
            if not existing:
                db.commissions.insert_one(commission)
                imported += 1
            else:
                skipped += 1
    
    return {'imported': imported, 'skipped': skipped}


def import_bank_policies(db, dry_run=False):
    """Import bank policies data"""
    policies_data = fetch_google_sheet_csv('bank_policies')
    
    if not policies_data:
        print("No bank policies data to import")
        return {'imported': 0, 'updated': 0}
    
    imported = 0
    updated = 0
    
    for row in policies_data:
        bank_name = row.get('bank_name', '')
        if not bank_name:
            continue
        
        # Build policy from flattened columns
        policy = {
            'bank_name': bank_name,
            'applicable_profiles': row.get('applicable_profiles', ''),
            'min_salary': safe_float(row.get('min_salary', 0)),
            'min_cibil': safe_int(row.get('min_cibil', 0)),
            'cibil_text': row.get('cibil_text', ''),
            'min_age': safe_int(row.get('min_age', 0)),
            'max_age': safe_int(row.get('max_age', 0)),
            'age_text': row.get('age_text', ''),
            'min_loan_amount': safe_float(row.get('min_loan_amount', 0)),
            'max_loan_amount': safe_float(row.get('max_loan_amount', 0)),
            'loan_amount_text': row.get('loan_amount_text', ''),
            'min_tenure': safe_int(row.get('min_tenure', 0)),
            'max_tenure': safe_int(row.get('max_tenure', 0)),
            'tenure_text': row.get('tenure_text', ''),
            'roi_min': safe_float(row.get('roi_min', 0)),
            'roi_max': safe_float(row.get('roi_max', 0)),
            'roi_text': row.get('roi_text', ''),
            'max_foir': safe_float(row.get('max_foir', 0)),
            'foir_text': row.get('foir_text', ''),
            'eligible_employees': row.get('eligible_employees', ''),
            'company_categories': row.get('company_categories', ''),
            'is_active': True,
            'updated_at': datetime.now(timezone.utc).isoformat()
        }
        
        if dry_run:
            imported += 1
        else:
            # Upsert by bank_name
            result = db.bank_policies.update_one(
                {'bank_name': bank_name},
                {'$set': policy},
                upsert=True
            )
            if result.upserted_id:
                imported += 1
            else:
                updated += 1
    
    return {'imported': imported, 'updated': updated}


def import_users(db, dry_run=False):
    """Import/update users data - preserves existing credentials"""
    users_data = fetch_google_sheet_csv('users')
    
    if not users_data:
        print("No users data to import")
        return {'imported': 0, 'updated': 0, 'skipped': 0}
    
    imported = 0
    updated = 0
    skipped = 0
    
    for row in users_data:
        user_id = row.get('id', '')
        email = row.get('email', '')
        
        if not email:
            skipped += 1
            continue
        
        # Check if user already exists
        existing = None
        if user_id:
            existing = db.users.find_one({'id': user_id})
        if not existing:
            existing = db.users.find_one({'email': email})
        
        user_data = {
            'legacy_user_id': user_id,
            'full_name': row.get('full_name', ''),
            'name': row.get('full_name', ''),  # Alias
            'phone': row.get('phone', ''),
            'role': row.get('role', 'telecaller'),
            'city': row.get('city', ''),
            'is_active': row.get('is_active', 'True') == 'True',
            'is_approved': row.get('is_approved', 'True') == 'True',
            'pan_number': row.get('pan_number', ''),
            'agent_id': row.get('agent_id', ''),
            'manager_id': row.get('manager_id', ''),
            'partner_id': row.get('partner_id', ''),
            'updated_at': datetime.now(timezone.utc).isoformat()
        }
        
        # Build bank_details
        bank_details = {}
        for field in ['bank_name', 'account_number', 'ifsc_code', 'account_holder_name']:
            key = f'bank_details.{field}'
            if key in row and row[key]:
                bank_details[field] = row[key]
        if bank_details:
            user_data['bank_details'] = bank_details
        
        if dry_run:
            if existing:
                updated += 1
            else:
                imported += 1
        else:
            if existing:
                # Update but PRESERVE password hash
                db.users.update_one(
                    {'_id': existing['_id']},
                    {'$set': user_data}
                )
                updated += 1
            else:
                # New user - will need password set separately
                user_data['id'] = user_id or str(uuid.uuid4())
                user_data['email'] = email
                user_data['created_at'] = row.get('created_at', '') or datetime.now(timezone.utc).isoformat()
                db.users.insert_one(user_data)
                imported += 1
    
    return {'imported': imported, 'updated': updated, 'skipped': skipped}


def verify_import(db):
    """Verify the import results"""
    print("\n=== Import Verification ===")
    
    # Files count
    total_files = db.leads.count_documents({'status': 'file'})
    legacy_files = db.leads.count_documents({'status': 'file', 'legacy_crm_id': {'$exists': True, '$ne': ''}})
    print(f"Total Files: {total_files}")
    print(f"Legacy CRM Files: {legacy_files}")
    
    # Status breakdown
    pipeline = [
        {'$match': {'status': 'file'}},
        {'$group': {'_id': '$file_status', 'count': {'$sum': 1}}}
    ]
    status_counts = list(db.leads.aggregate(pipeline))
    print("\nFile Status Breakdown:")
    for sc in sorted(status_counts, key=lambda x: x['count'], reverse=True):
        print(f"  {sc['_id']}: {sc['count']}")
    
    # Financial summary
    total_approved = 0.0
    total_disbursed = 0.0
    login_count = 0
    approved_count = 0
    disbursed_count = 0
    
    for f in db.leads.find({'status': 'file'}):
        for elig in (f.get('eligibilities') or []):
            login_done = elig.get('login_done')
            if login_done == True or login_done == 'yes' or login_done == 'Yes':
                login_count += 1
            
            if elig.get('approval_status') == 'approved':
                approved_count += 1
                try:
                    total_approved += float(elig.get('approved_amount') or 0)
                except (ValueError, TypeError):
                    pass
            
            disbursed = elig.get('disbursed')
            if disbursed == True or disbursed == 'yes' or disbursed == 'Yes':
                disbursed_count += 1
                try:
                    total_disbursed += float(elig.get('disbursed_amount') or 0)
                except (ValueError, TypeError):
                    pass
    
    print(f"\nFinancial Summary:")
    print(f"  Total Logins: {login_count}")
    print(f"  Total Approved: {approved_count} files, Amount: ₹{total_approved:,.2f} ({total_approved/10000000:.2f} Cr)")
    print(f"  Total Disbursed: {disbursed_count} files, Amount: ₹{total_disbursed:,.2f} ({total_disbursed/10000000:.2f} Cr)")
    
    # Activities check
    files_with_activities = db.leads.count_documents({
        'status': 'file',
        '$or': [
            {'file_activities': {'$exists': True, '$ne': []}},
            {'activities': {'$exists': True, '$ne': []}}
        ]
    })
    print(f"\nFiles with Activities: {files_with_activities}")
    
    # Eligibilities check
    files_with_elig = db.leads.count_documents({
        'status': 'file',
        'eligibilities': {'$exists': True, '$ne': []}
    })
    print(f"Files with Eligibilities: {files_with_elig}")
    
    # Bank policies
    policies_count = db.bank_policies.count_documents({})
    print(f"\nBank Policies: {policies_count}")
    
    # Users
    users_count = db.users.count_documents({})
    print(f"Users: {users_count}")


def main():
    """Main import function"""
    import argparse
    
    parser = argparse.ArgumentParser(description='Import Legacy CRM data from Google Sheet')
    parser.add_argument('--dry-run', action='store_true', help='Preview import without making changes')
    parser.add_argument('--verify-only', action='store_true', help='Only verify existing data')
    parser.add_argument('--skip-files', action='store_true', help='Skip files import')
    parser.add_argument('--skip-users', action='store_true', help='Skip users import')
    parser.add_argument('--skip-policies', action='store_true', help='Skip bank policies import')
    parser.add_argument('--skip-commissions', action='store_true', help='Skip commissions import')
    
    args = parser.parse_args()
    
    print("=" * 60)
    print("Legacy CRM Data Import")
    print("=" * 60)
    print(f"MongoDB: {MONGO_URL}")
    print(f"Database: {DB_NAME}")
    print(f"Google Sheet: {SHEET_ID}")
    if args.dry_run:
        print("MODE: DRY RUN (no changes will be made)")
    print("=" * 60)
    
    # Connect to MongoDB
    client = MongoClient(MONGO_URL)
    db = client[DB_NAME]
    
    if args.verify_only:
        verify_import(db)
        return
    
    # Import data
    results = {}
    
    if not args.skip_files:
        print("\n--- Importing Files ---")
        results['files'] = import_files(db, args.dry_run)
        print(f"Files: {results['files']}")
    
    if not args.skip_users:
        print("\n--- Importing Users ---")
        results['users'] = import_users(db, args.dry_run)
        print(f"Users: {results['users']}")
    
    if not args.skip_policies:
        print("\n--- Importing Bank Policies ---")
        results['policies'] = import_bank_policies(db, args.dry_run)
        print(f"Policies: {results['policies']}")
    
    if not args.skip_commissions:
        print("\n--- Importing Commissions ---")
        results['commissions'] = import_commissions(db, args.dry_run)
        print(f"Commissions: {results['commissions']}")
    
    # Verify
    if not args.dry_run:
        verify_import(db)
    
    print("\n" + "=" * 60)
    print("Import Complete!")
    print("=" * 60)


if __name__ == '__main__':
    main()
