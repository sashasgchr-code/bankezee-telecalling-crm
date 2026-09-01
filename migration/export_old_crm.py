"""
=================================================================
OLD CRM DATA EXPORT SCRIPT
=================================================================
Run this script on any machine that can connect to the old CRM database.
It will export all data to a JSON file that you can then import into Connect.

INSTRUCTIONS:
1. Make sure Python 3.7+ is installed
2. Install required package: pip install pymongo
3. Run: python export_old_crm.py
4. Upload the generated 'crm_export_YYYYMMDD_HHMMSS.json' file
=================================================================
"""

import json
from datetime import datetime
from pymongo import MongoClient
from bson import ObjectId

# ============================================
# CONFIGURATION - UPDATE THESE VALUES
# ============================================

# Your old CRM MongoDB connection string
OLD_CRM_URL = "mongodb+srv://finance-dash-166:d64p1c4lqs2c73a525pg@customer-apps.j2s0aq.mongodb.net/?appName=lead-gen-platform-13&maxPoolSize=5&retryWrites=true&w=majority"

# Database name (update if different)
# Common names: 'test', 'production', 'crm', 'lead-gen-platform', 'bankezee'
DATABASE_NAME = "test"  # <-- UPDATE THIS if needed

# Collection name where leads/files are stored
# Common names: 'data', 'leads', 'files', 'customers'
COLLECTION_NAME = "data"  # <-- UPDATE THIS if needed

# ============================================
# DO NOT MODIFY BELOW THIS LINE
# ============================================

class JSONEncoder(json.JSONEncoder):
    """Custom JSON encoder to handle MongoDB types"""
    def default(self, obj):
        if isinstance(obj, ObjectId):
            return str(obj)
        if isinstance(obj, datetime):
            return obj.isoformat()
        if hasattr(obj, '__dict__'):
            return obj.__dict__
        return super().default(obj)


def export_data():
    print("=" * 60)
    print("OLD CRM DATA EXPORT SCRIPT")
    print("=" * 60)
    
    try:
        print(f"\n[1/4] Connecting to database...")
        client = MongoClient(OLD_CRM_URL, serverSelectionTimeoutMS=30000)
        
        # Test connection
        client.admin.command('ping')
        print("      ✓ Connected successfully!")
        
        # List available databases
        print(f"\n[2/4] Exploring database structure...")
        dbs = client.list_database_names()
        print(f"      Available databases: {[d for d in dbs if d not in ['admin', 'local', 'config']]}")
        
        # Connect to specified database
        db = client[DATABASE_NAME]
        collections = db.list_collection_names()
        print(f"      Collections in '{DATABASE_NAME}': {collections}")
        
        # Get data from collection
        print(f"\n[3/4] Exporting data from '{COLLECTION_NAME}'...")
        collection = db[COLLECTION_NAME]
        total_count = collection.count_documents({})
        print(f"      Found {total_count} documents to export")
        
        if total_count == 0:
            print("\n      ⚠ No documents found! Check DATABASE_NAME and COLLECTION_NAME settings.")
            print(f"      Try these collections: {collections}")
            return
        
        # Export all documents
        documents = list(collection.find({}))
        
        # Convert to JSON-serializable format
        export_data = []
        for doc in documents:
            # Remove MongoDB _id or convert to string
            if '_id' in doc:
                doc['_id'] = str(doc['_id'])
            export_data.append(doc)
        
        # Generate filename with timestamp
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"crm_export_{timestamp}.json"
        
        print(f"\n[4/4] Saving to {filename}...")
        with open(filename, 'w', encoding='utf-8') as f:
            json.dump({
                "export_info": {
                    "source_database": DATABASE_NAME,
                    "source_collection": COLLECTION_NAME,
                    "export_date": datetime.now().isoformat(),
                    "total_records": len(export_data)
                },
                "files": export_data
            }, f, cls=JSONEncoder, indent=2, ensure_ascii=False)
        
        print(f"      ✓ Exported {len(export_data)} records to {filename}")
        print("\n" + "=" * 60)
        print("EXPORT COMPLETE!")
        print("=" * 60)
        print(f"\nNext steps:")
        print(f"1. Upload '{filename}' to the Connect app")
        print(f"2. The migration will import all {len(export_data)} files")
        print("=" * 60)
        
        # Show sample of first record
        if export_data:
            print("\nSample record fields:")
            sample = export_data[0]
            for key in list(sample.keys())[:10]:
                value = sample[key]
                if isinstance(value, str) and len(value) > 50:
                    value = value[:50] + "..."
                print(f"  - {key}: {value}")
            if len(sample.keys()) > 10:
                print(f"  ... and {len(sample.keys()) - 10} more fields")
        
        client.close()
        
    except Exception as e:
        print(f"\n❌ ERROR: {e}")
        print("\nTroubleshooting:")
        print("1. Check if the connection string is correct")
        print("2. Verify DATABASE_NAME and COLLECTION_NAME are correct")
        print("3. Make sure your IP is whitelisted in MongoDB Atlas")
        print("4. Try running: pip install pymongo[srv]")


if __name__ == "__main__":
    export_data()
