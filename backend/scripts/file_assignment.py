"""
File Assignment Script
Assign historical files to their correct GP owners based on source_id
"""
import os
import sys
from datetime import datetime, timezone
from pymongo import MongoClient
from bson import ObjectId

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from dotenv import load_dotenv
load_dotenv()

client = MongoClient(os.environ.get('MONGO_URL'))
db = client[os.environ.get('DB_NAME')]

# Active GPs from @users spreadsheet
ACTIVE_GP_EMAILS = [
    'yarragondaanusha@gmail.com',
    'mohammadwameez607@gmail.com',
    'regurivijayendra@gmail.com',
    'pinkynagulapally@gmail.com',
    'jkavithabhai@gmail.com',
    'gujjarisaikiran13@gmail.com',
    'pushparajbha911@gmail.com',
    'gosangideevenadevaswamy@gmail.com',
    'srivallisiri537@gmail.com',
    'lellachandana24@gmail.com',
    'nani9346480@gmail.com',
    'banothunithinnaik@gmail.com',
    'nalavonilakshmipriya@gmail.com',
    'kemidiraju134@gmail.com',
    'meghanaaaa.36@gmail.com',
    'mivimivi51@gmail.com',
    'masoommd7472@gmai.com',
    'pillalamarrishivasai@gmail.com',
    'asma.sultana0r@gmail.com',
]

def get_user_id(user):
    """Get the canonical user ID"""
    return str(user.get('id') or user.get('_id'))

def run_file_assignment():
    print("=" * 60)
    print("FILE ASSIGNMENT TO GP OWNERS")
    print("=" * 60)
    print()
    
    # Build map of active GP IDs
    active_gp_map = {}
    for email in ACTIVE_GP_EMAILS:
        user = db.users.find_one({'email': email})
        if user:
            user_id = get_user_id(user)
            active_gp_map[user_id] = {
                'email': email,
                'name': user.get('full_name') or user.get('name', 'N/A'),
                '_id': user['_id']
            }
    
    print(f"Active GPs in @users: {len(active_gp_map)}")
    
    # Get all files
    files = list(db.leads.find({'status': 'file'}, {
        '_id': 1, 
        'id': 1, 
        'name': 1, 
        'source_id': 1, 
        'file_assigned_to': 1,
        'assigned_to': 1
    }))
    
    print(f"Total files: {len(files)}")
    print()
    
    # Track assignments
    assignments = {
        'to_active_gp': [],
        'to_ops': [],
        'already_correct': [],
        'errors': []
    }
    
    # Get Ops user ID for files without a valid GP
    ops_user = db.users.find_one({'email': 'ops@bankezee.com'})
    ops_id = get_user_id(ops_user) if ops_user else None
    
    print("Processing files...")
    print("-" * 40)
    
    for file in files:
        file_id = file['_id']
        file_name = file.get('name', 'Unknown')
        source_id = file.get('source_id', '')
        current_assigned = file.get('file_assigned_to', '')
        
        # Determine the correct owner
        correct_owner_id = None
        owner_info = None
        
        # Check if source_id is an active GP
        if source_id in active_gp_map:
            correct_owner_id = source_id
            owner_info = active_gp_map[source_id]
        else:
            # Check if there's a user_mapping for this source_id
            mapping = db.user_mappings.find_one({
                'legacy_user_id': source_id,
                'status': 'mapped'
            })
            if mapping:
                connect_id = mapping.get('connect_user_id')
                if connect_id in active_gp_map:
                    correct_owner_id = connect_id
                    owner_info = active_gp_map[connect_id]
            
            # If no mapping found, check if source_id corresponds to a deactivated user
            # who had files - we'll assign to Ops
            if not correct_owner_id:
                source_user = db.users.find_one({'$or': [
                    {'id': source_id},
                    {'_id': ObjectId(source_id) if len(str(source_id)) == 24 else None}
                ]})
                if source_user:
                    # User exists but is deactivated - keep with Ops
                    correct_owner_id = ops_id
                    owner_info = {'name': 'Operations (deactivated GP)', 'email': 'ops@bankezee.com'}
                else:
                    # Unknown source - assign to Ops
                    correct_owner_id = ops_id
                    owner_info = {'name': 'Operations (unknown source)', 'email': 'ops@bankezee.com'}
        
        # Check if already correctly assigned
        if current_assigned == correct_owner_id:
            assignments['already_correct'].append(file_name)
            continue
        
        # Update the file assignment
        try:
            update_result = db.leads.update_one(
                {'_id': file_id},
                {
                    '$set': {
                        'file_assigned_to': correct_owner_id,
                        'assigned_to': correct_owner_id,
                        'assignment_updated_at': datetime.now(timezone.utc)
                    }
                }
            )
            
            if correct_owner_id in active_gp_map:
                assignments['to_active_gp'].append({
                    'file': file_name,
                    'gp': owner_info['name'],
                    'email': owner_info['email']
                })
            else:
                assignments['to_ops'].append({
                    'file': file_name,
                    'reason': owner_info['name'] if owner_info else 'Unknown'
                })
                
        except Exception as e:
            assignments['errors'].append({
                'file': file_name,
                'error': str(e)
            })
    
    # Print summary
    print()
    print("=" * 60)
    print("ASSIGNMENT SUMMARY")
    print("=" * 60)
    print()
    
    print(f"Files assigned to active GPs: {len(assignments['to_active_gp'])}")
    # Group by GP
    gp_counts = {}
    for a in assignments['to_active_gp']:
        gp = a['gp']
        gp_counts[gp] = gp_counts.get(gp, 0) + 1
    
    for gp, count in sorted(gp_counts.items(), key=lambda x: x[1], reverse=True):
        print(f"  {gp}: {count} files")
    
    print()
    print(f"Files kept with Operations (deactivated GPs): {len(assignments['to_ops'])}")
    print(f"Files already correctly assigned: {len(assignments['already_correct'])}")
    print(f"Errors: {len(assignments['errors'])}")
    
    if assignments['errors']:
        print()
        print("Errors:")
        for e in assignments['errors'][:5]:
            print(f"  {e['file']}: {e['error']}")
    
    print()
    print("=" * 60)
    print("FILE ASSIGNMENT COMPLETE")
    print("=" * 60)
    
    return assignments

if __name__ == "__main__":
    run_file_assignment()
