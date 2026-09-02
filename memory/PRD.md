# BankEzee Connect CRM - Product Requirements Document

## Project Overview
BankEzee Connect is a comprehensive CRM system for managing loan applications from lead generation through disbursal. The OLD CRM operational structure has been completely ported into the Connect platform.

## Original Problem Statement
Port the complete OLD CRM → Connect Files, making Connect → Files a complete replacement for the old CRM using the old CRM's actual code, data structures, calculations, and workflows.

## User Personas
1. **Admin**: Full access to all features, reports, user management
2. **Growth Partner (Agent)**: Lead generation, file creation, customer interaction
3. **Operations Team**: File processing, eligibility checks, bank submissions

## Architecture

### Tech Stack
- Frontend: React + TailwindCSS + Shadcn/UI
- Backend: FastAPI (Python)
- Database: MongoDB
- Mobile: Expo (React Native) - EAS Build pending

### Key Files
- `/app/backend/routes/files_crm.py` - Files CRM endpoints (3300+ lines)
- `/app/backend/routes/leads.py` - Leads + Data→File conversion
- `/app/frontend/src/pages/files/FilesDashboard.js` - Files dashboard with reports
- `/app/frontend/src/pages/files/PolicyMaster.js` - Complete Policy Master UI
- `/app/frontend/src/pages/files/FileDetailsPage.js` - File detail workspace

---

## Completed Features (December 2025)

### 1. Files Dashboard (100% Complete)
- [x] 10 metric cards matching OLD CRM
- [x] Historical status calculation
- [x] File Status Distribution chart
- [x] Loans by Type breakdown
- [x] Monthly Performance chart

### 2. Reports (100% Complete)
- [x] Daily Report
- [x] Rejected Cases Report with bank-level breakdown
- [x] Growth Partner Performance with Current/Spillover logic
- [x] Bank Performance Report
- [x] TAT Report
- [x] Quality Report

### 3. File Status Workflow (100% Complete)
24 statuses organized into 9 categories

### 4. File Detail Workspace (100% Complete)
4 sections: Customer Details, Employment & Income, Existing Obligations, Loan Requirements

### 5. Data → File Conversion with Prefill (100% Complete) ✅
Auto-prefills: full_name, mobile, email, city, source, type_of_loan, employment_type

### 6. Policy Master (100% Complete) ✅
27 bank policies with ALL 40+ OLD CRM fields, 7-tab Add/Edit modal

### 7. Document Workflow (100% Complete) ✅
19 document types with required/pending/uploaded tracking

### 8. Commission Module (100% Complete) ✅
- [x] GET /api/files/commissions - Full commission listing with filters
- [x] GET /api/files/commissions/summary - Dashboard summary
- [x] POST /api/files/commissions - Create commission (Admin only)
- [x] PUT/DELETE commission management
- [x] Aggregation by Growth Partner (26 GPs tracked)
- [x] Aggregation by Bank
- [x] UI panel with KPI cards and tables
- [x] 76 commission records totaling ₹8.7L

### 9. Eligibility Calculation (100% Complete) ✅
- [x] POST /api/files/{id}/check-eligibility
- [x] Evaluates against ALL 27 active bank policies
- [x] Checks: CIBIL, salary, FOIR, age, employment duration, loan type
- [x] Returns eligible banks with estimated amounts
- [x] Auto-adds eligible banks to file eligibilities
- [x] Logs activity with eligible/not-eligible counts
- [x] UI button in FileDetailsPage header

### 10. Export Reports (100% Complete) ✅
- [x] GET /api/files/export/dashboard - All files CSV
- [x] GET /api/files/export/rejected - Bank-level rejection summary CSV
- [x] GET /api/files/export/growth-partner - GP performance with Current/Spillover CSV
- [x] GET /api/files/export/commissions - Commission detail CSV
- [x] UI dropdown menu with 5 export options

### 11. Enhanced Activity Log (100% Complete) ✅
- [x] Color-coded activities by type
- [x] Icon differentiation (status_change, bank_eligible, bank_disbursed, etc.)
- [x] Bank-specific details display
- [x] Relative timestamps (Just now, 5m ago, etc.)
- [x] POST /api/files/{id}/activities/eligibility - Add bank activity
- [x] GET /api/files/{id}/activities/timeline - Full timeline with milestones

### 12. Star Rating Calculation (100% Complete)
Algorithm: Data Completeness + CIBIL + Income Ratio + Employment + Documents + FOIR

### 13. Security (Updated Dec 2025)
All file mutation endpoints have authentication guards

### 14. Data Migration (100% Complete)
454 legacy CRM files + 65 new files = 519 total

---

## Pending/Backlog Features

### P1 (High)
- [ ] Mobile Android EAS Build - Fix Gradle build failure
- [ ] Backfill bank_name on commission records for proper by_bank breakdown
- [ ] Store source_name snapshot on commission creation to handle deleted users

### P2 (Medium)
- [ ] "Switched Off" outcome normalization
- [ ] Refactor files_crm.py into smaller modules (currently 3334 lines)
- [ ] Extract common CSV export helper

---

## API Endpoints Reference

### Commission Module
- GET /api/files/commissions - List with aggregations
- GET /api/files/commissions/summary - Dashboard summary
- POST /api/files/commissions - Create (Admin)
- PUT /api/files/commissions/{id} - Update (Admin)
- DELETE /api/files/commissions/{id} - Delete (Admin)

### Eligibility
- POST /api/files/{id}/check-eligibility - Auto-check against all policies

### Exports
- GET /api/files/export/dashboard - All files CSV
- GET /api/files/export/rejected - Rejected cases CSV
- GET /api/files/export/growth-partner - GP performance CSV
- GET /api/files/export/commissions - Commission CSV

### Activities
- POST /api/files/{id}/activities/eligibility - Add bank activity
- GET /api/files/{id}/activities/timeline - Full timeline

---

## Testing
- Test credentials: admin@bankezee.com / ConnectSasha12!!
- Test reports: /app/test_reports/iteration_31.json
- Backend tests: 11/11 passing
- Frontend: All features verified end-to-end

---

## Dashboard Reconciliation Reference
| Metric | Value |
|--------|-------|
| Total Files | 519 |
| Login | 323 |
| Approved | 116 |
| Disbursed | 96 |
| Total Disbursed | ₹11.70 Cr |
| Total Commissions | ₹8.7L (76 records) |
| Active Policies | 27 |

---

## File Reconciliation (December 2, 2025)

### Investigation Results
| Category | Count |
|----------|-------|
| Legacy CRM (Google Sheet Import) | 445 |
| Legacy CRM (CSV Import - unique) | 62 |
| Test/Development Files | 0 (removed) |
| Duplicate Files | 0 (removed) |
| Connect-originated Files | 0 |
| **TOTAL** | **507** |

### Cleanup Performed
- Removed 3 test/development records (TEST_Iter29, Test Prefill User, Test Prefill Fixed)
- Removed 11 duplicate records (same phone number across imports)
- Total records removed: 14

### Data → File Workflow Verification
All 16 acceptance tests PASS:
- Data → File creates exactly one File ✅
- Duplicate File protection (idempotent) ✅
- File counted on Files dashboard ✅
- Growth Partner attribution ✅
- Existing Data prefilled ✅
- Growth Partner application entry ✅
- Growth Partner document upload ✅
- Admin/Ops File access ✅
- Admin/Ops customer info edit ✅
- Multiple-bank eligibility editing ✅
- Status/Login/Application ID ✅
- Approval/Decline ✅
- Disbursal/Rejection ✅
- Activities/audit history ✅
- Dashboard calculations update ✅
- Reports update ✅

---

*Last Updated: December 2, 2025*
