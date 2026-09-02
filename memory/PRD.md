# BANKEZEE Connect CRM - Product Requirements Document

## Last Updated: Sep 02, 2026

## Overview
BankEzee Connect is a unified CRM platform that merges legacy CRM functionality into a single Connect app, providing lead management, file processing, attendance tracking, and leave management.

## Final Verification Status (Preview Environment)

| Requirement | Status | Notes |
|-------------|--------|-------|
| Legacy CRM Data Import | ✅ PASS | 454 historical files imported from Google Sheet |
| Total Files | ✅ PASS | 519 files (454 legacy + 65 new) |
| Total Approved | ✅ PASS | ₹8.26 Cr (63 eligibilities) |
| Total Disbursed | ✅ PASS | ₹7.31 Cr (51 eligibilities) |
| Bank Policies | ✅ PASS | 27 policies imported |
| Users | ✅ PASS | 126 users (79 from legacy + existing) |
| Commissions | ✅ PASS | 76 commission records imported |
| Activities Visible | ✅ PASS | Properly deserialized from Python repr format |
| Eligibilities Visible | ✅ PASS | 206 files with eligibilities |
| Status Filters | ✅ PASS | Counts from /api/leads/stats endpoint |
| File Reassignment Blocked | ✅ PASS | Server-side enforcement working |
| All Reports | ✅ PASS | Daily, Rejected, Growth Partner, Bank Perf, Quality, TAT |
| Auth Guards | ✅ PASS | All Files endpoints now require authentication |
| P.A.L.M.E Leave Policy | ✅ PASS | Full implementation with 2026 Sept accrual |

## What's Been Implemented

### Legacy CRM Data Import (NEW - Sep 02, 2026)

1. **Import Script**: `/app/backend/scripts/import_legacy_crm.py`
   - Fetches data from Google Sheet CSV export
   - Properly deserializes Python repr format (single quotes, None, True/False)
   - Idempotent - checks `legacy_crm_id` or `phone` to avoid duplicates
   - Imports into Files module only (status='file'), NOT Connect Data

2. **Imported Data Summary**:
   - Files: 519 total (454 legacy + 65 new)
   - Users: 126 total
   - Bank Policies: 27
   - Commissions: 76 records
   - Activities per file: Properly preserved as arrays
   - Eligibilities: 206 files with bank eligibility data

3. **Financial Totals**:
   - Total Logins: 311
   - Total Approved: 57 files, ₹8.26 Cr
   - Total Disbursed: 47 files, ₹7.31 Cr
   - Amount in Pipeline: ₹99 Lakh

4. **Security**: Auth guards added to all Files endpoints

### P.A.L.M.E Leave Policy (Sep 02, 2026)
**Present • Absent • Leave • Medical • Emergency**

1. **2026 Special Accrual Rule**
   - For year 2026, leave accrual starts from **September** only
   - Total allowance: 8 days (4 months × 2 days)
   - Other years: Normal January start (24 days/year)

2. **Rewards System**
   - Weekly On Time: ₹200
   - Monthly Perfect: ₹500
   - Quarterly Outstanding: ₹2,000 + Certificate

3. **Accountability (Penalties)**
   - Uninformed Leave: ₹100 per occurrence
   - Leave must be applied 3+ days in advance
   - Sick leave >3 days requires medical certificate

### Critical Business Logic
1. **File Reassignment Block** - Server-side enforcement
2. **Historical Report Preservation** - Activity ownership at event time
3. **Clean Slate Reassignment** - Pre-File leads reset
4. **Terminology Update** - "Growth Partner" throughout UI

## API Endpoints Summary

### Files CRM (All require auth)
- `GET /api/files` - List files with filters
- `GET /api/files/{id}` - File details
- `GET /api/files/dashboard/stats` - Dashboard statistics
- `GET /api/files/policies` - Bank policies list
- `GET /api/files/reports/daily` - Daily report
- `GET /api/files/reports/rejected` - Rejected cases
- `GET /api/files/reports/growth-partner` - GP performance
- `GET /api/files/reports/bank-performance` - Bank-wise stats
- `GET /api/files/reports/quality` - Quality metrics
- `GET /api/files/reports/tat-metrics` - TAT metrics
- `POST /api/files/import` - Import data (Admin only)
- `GET /api/files/export` - Export data (Admin only)

### Data/Leads
- `GET /api/leads` - List with filters
- `GET /api/leads/{id}` - Single lead
- `POST /api/leads/assign` - Assign (blocks Files)
- `GET /api/leads/stats` - Status counts

### Leave Management (P.A.L.M.E)
- `GET /api/leave/balance?year=YYYY` - Leave balance
- `GET /api/leave/palme/policy` - Policy details
- `GET /api/leave/palme/monthly-summary` - Team summary
- `POST /api/leave/palme/rewards` - Add reward
- `POST /api/leave/palme/penalty` - Add penalty

## Test Credentials
- Admin: `admin@bankezee.com` / `ConnectSasha12!!`

## Remaining Items

### P0 - Complete
- ✅ Legacy CRM data imported
- ✅ Auth guards added
- ✅ All reports working

### P1 - Pending
1. **EAS Android Build** - Fix Gradle error for APK generation
2. **"Switched Off" Outcome Normalization** - Map variations

### P2 - Future
1. **Performance Optimization** - Move dashboard stats to MongoDB aggregation
2. **Code Refactoring** - Split files_crm.py (2000+ lines) into modules
3. **File Splitting** - FilesDashboard.js is 1900+ lines

## Technical Notes

### Environment
- Preview: `test_database` (519 files)
- Backend: FastAPI with Motor (async MongoDB)
- Frontend: React with Shadcn/UI

### MongoDB Schema
```javascript
// leads collection (Files stored here with status='file')
{
  id: "uuid",
  legacy_crm_id: "original-crm-id",  // Preserved for mapping
  name: "string",
  phone: "string",
  status: "file",  // 'file' for Files module
  file_status: "disbursed|approved|login|rejected|...",
  eligibilities: [{ bank_name, approved_amount, disbursed, ... }],
  file_activities: [{ type, message, timestamp }],
  documents: [{ file_name, document_type }],
  created_at: "ISO date",
  updated_at: "ISO date"
}
```

### Import Script Usage
```bash
# Dry run (preview changes)
python3 scripts/import_legacy_crm.py --dry-run

# Full import
python3 scripts/import_legacy_crm.py

# Skip specific imports
python3 scripts/import_legacy_crm.py --skip-users --skip-policies

# Verify only
python3 scripts/import_legacy_crm.py --verify-only
```
