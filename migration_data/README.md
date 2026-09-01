# BankEzee CRM Database Export
## Database: test_database
## Export Date: 2026-09-01

## Collections Included:
| Collection | Documents | Description |
|---|---|---|
| agents | 14 | Growth partner/agent profiles |
| bank_policies | 27 | Bank loan policy rules (27 banks) |
| commissions | 12 | Commission tracking records |
| document_parses | 2 | AI-parsed document results |
| eligibility_snapshots | 66 | Eligibility check history |
| files | 1 | Uploaded file metadata & content |
| leads | 30 | Lead/customer records |
| partners | 11 | Retail partner profiles |
| users | 28 | System user accounts |
| **TOTAL** | **191** | |

## Files Included:
- `mongodump/` — Native MongoDB binary dump (BSON format). Best for restore.
- `json/` — JSON array exports per collection. Human-readable backup.
- `README.md` — This file.

## How to Import (mongorestore — Recommended):
```bash
# Restore into a new database called "bankezee_crm"
mongorestore --uri="mongodb://YOUR_MONGO_URI" --db=bankezee_crm /path/to/mongodump/test_database/

# Or restore with the same database name
mongorestore --uri="mongodb://YOUR_MONGO_URI" --db=test_database /path/to/mongodump/test_database/

# To drop existing data before restore:
mongorestore --uri="mongodb://YOUR_MONGO_URI" --db=bankezee_crm --drop /path/to/mongodump/test_database/
```

## How to Import (JSON — Alternative):
```bash
# Import each collection
for file in json/*.json; do
    collection=$(basename "$file" .json)
    mongoimport --uri="mongodb://YOUR_MONGO_URI" --db=bankezee_crm --collection=$collection --file=$file --jsonArray --drop
done
```

## How to Import into Another Emergent Application:
1. Upload this ZIP to your new Emergent app
2. In the backend, run:
```bash
# Unzip the export
unzip bankezee_db_export.zip -d /tmp/db_import

# Get the MONGO_URL from .env
source /app/backend/.env

# Restore using mongorestore
mongorestore --uri="$MONGO_URL" --db=$DB_NAME --drop /tmp/db_import/mongodump/test_database/
```
3. Restart the backend: `sudo supervisorctl restart backend`

## Notes:
- files.content field: Preserved (base64-encoded file data included)
- All ObjectIds, timestamps, relationships preserved in BSON format
- JSON exports use MongoDB Extended JSON for type preservation
- No credentials, API keys or connection strings included in export
