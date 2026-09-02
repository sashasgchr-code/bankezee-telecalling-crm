# BankEzee Connect CRM - Product Requirements Document

## Project Overview
BankEzee Connect is a comprehensive CRM system for managing loan applications from lead generation through disbursal. The system has been enhanced to port the complete OLD CRM operational structure into the Connect platform.

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
- `/app/backend/routes/files_crm.py` - Files CRM endpoints (2500+ lines)
- `/app/frontend/src/pages/files/FilesDashboard.js` - Files dashboard UI
- `/app/frontend/src/pages/files/FileDetailsPage.js` - File detail workspace
- `/app/frontend/src/components/file-detail/` - Modular file detail components

---

## Completed Features (December 2025)

### 1. Files Dashboard (100% Complete)
- [x] 10 metric cards matching OLD CRM: Total Files, New, In Progress, Login, Approved, Total Approved, Disbursed, Total Disbursed, Interim Rejects, Final Rejections, Amt in Pipeline
- [x] Historical status calculation (counts files that REACHED status via activities, not just current status)
- [x] File Status Distribution donut chart
- [x] Loans by Type breakdown
- [x] Monthly Performance chart

### 2. Reports (100% Complete)
- [x] **Daily Report**: Files created today with status breakdown
- [x] **Rejected Cases Report**: Bank-level rejection summary with totals for Not Eligible, Not Login, FI Negative, Declined, Not Disbursed
- [x] **Growth Partner Performance**: Current/Spillover logic preserved, Files Generated, Logins, Approvals, Disbursals with amounts
- [x] **Bank Performance Report**: Per-bank metrics
- [x] **TAT Report**: Lead→Login, Login→Approval, Approval→Disbursal turnaround times
- [x] **Quality Report**: Data quality score, conversion funnel rates

### 3. File Status Workflow (100% Complete)
24 statuses organized into 9 categories:
- Initial: New, Contacted
- Documents: Documents Pending, Documents Collected
- Processing: Sent for Eligibility, Query/Hold
- Bank: Sent to Bank, Sent for Login, Login
- Underwriting: Underwriting, FI, FI Reinitiated
- Approval: Approved, Sanctioned
- Disbursal: Disbursed
- Rejection: Not Eligible, Not Login, FI Negative, Declined, Not Disbursed, Rejected, Customer Not Interested, Customer Not Supporting
- Other: Supporting

### 4. File Detail Workspace (100% Complete)
Complete CRM processing workspace with 4 sections:
- **Section 1: Customer Details** - Name, mobile, email, father/mother name, DOB, PAN, Aadhaar, current/permanent address, city, PIN, residence type
- **Section 2: Employment & Income** - Employment type, company name/category/designation, office address, employment duration, gross/net salary, additional income, self-employed fields
- **Section 3: Existing Obligations** - CIBIL score, FOIR, existing loans array, TVR/EMI status, credit card details
- **Section 4: Loan Requirements** - Loan type (18 types), amount, tenure, purpose, BT/topup fields, property/vehicle details

Additional features:
- Documents panel with upload
- Activity Log with note adding
- Star Rating display (0-100 score, 1-5 stars)
- Check Bank Eligibility action
- Edit Details functionality

### 5. Star Rating Calculation (100% Complete)
Algorithm based on:
- Data Completeness (20 points)
- CIBIL Score (25 points)
- Income vs Loan Amount ratio (20 points)
- Employment Stability (15 points)
- Document Status (10 points)
- Existing Obligations/FOIR (10 points)

### 6. Loan Types (18 Complete)
- Personal: New Personal Loan, Balance Transfer PL, Top Up PL, BT+Top Up PL, Merge Multiple Loans
- Home: New Home Loan, Balance Transfer HL, BT+Top Up HL, Reduce Home Loan EMI
- Vehicle: New Vehicle Loan, Used Vehicle Loan Fresh, Used Vehicle Loan BT
- Business: Business Loan, MSME Loan
- Other: LAP, Gold Loan, Education Loan, Other

### 7. Security (Updated Dec 2025)
All file mutation endpoints now have authentication guards:
- PUT /files/{id}/details
- PUT /files/{id}/file-status
- POST /files/{id}/notes
- PUT /files/{id}/assign
- PUT /bulk-assign (Admin only)
- PUT /files/{id}/eligibilities
- GET /files/{id}/eligibilities
- GET /files/{id}/activities
- POST /files/{id}/upload
- GET /download/{doc_id}
- DELETE /files/{id}/documents/{doc_id}

### 8. Data Migration (100% Complete)
- 454 legacy CRM files imported to MongoDB
- Nested arrays (activities, eligibilities, documents) properly deserialized
- Idempotent migration script at `/app/backend/scripts/import_legacy_crm.py`

---

## Pending/Backlog Features

### P0 (Critical)
- [ ] Policy Master UI - Create/edit bank policies (CRUD exists in backend, UI partially built)
- [ ] Data → File Conversion - Prefill known info when Data becomes File

### P1 (High)
- [ ] Mobile Android EAS Build - Fix Gradle build failure
- [ ] Commissions Module - Full commission tracking with GP mappings
- [ ] Document Management - Required/pending/uploaded document workflow

### P2 (Medium)
- [ ] "Switched Off" outcome normalization
- [ ] Historical Acceptance Test comparison table
- [ ] Refactor files_crm.py into smaller modules

---

## API Endpoints Reference

### Dashboard & Stats
- GET /api/files/dashboard/stats - Dashboard metrics
- GET /api/files/statuses - All 24 statuses with categories

### Reports
- GET /api/files/reports - Summary reports
- GET /api/files/reports/rejected - Bank-level rejection summary
- GET /api/files/reports/growth-partner - GP performance with Current/Spillover
- GET /api/files/reports/tat-metrics - Turnaround times
- GET /api/files/reports/quality - Quality metrics

### File Operations
- GET /api/files - List files with filters
- GET /api/files/{id} - File detail
- PUT /api/files/{id}/details - Update file details
- PUT /api/files/{id}/file-status - Update status
- POST /api/files/{id}/notes - Add note
- PUT /api/files/{id}/assign - Assign to ops team

### Eligibilities
- GET /api/files/{id}/eligibilities - Get bank eligibilities
- PUT /api/files/{id}/eligibilities - Update eligibilities

### Documents
- POST /api/files/{id}/upload - Upload document
- GET /api/download/{doc_id} - Download document
- DELETE /api/files/{id}/documents/{doc_id} - Delete document

### Rating
- GET /api/files/calculate-rating/{id} - Calculate star rating
- PUT /api/files/update-rating/{id} - Update and persist rating
- POST /api/files/recalculate-all-ratings - Batch recalculate (Admin)

---

## Testing
- Test credentials: admin@bankezee.com / ConnectSasha12!!
- Test reports: /app/test_reports/iteration_29.json
- Test suite: /app/backend/tests/test_iter29_crm_port.py (8 passing tests)

---

## Dashboard Reconciliation Reference
OLD CRM reference values (validation targets):
| Metric | OLD CRM |
|--------|---------|
| Total Files | 454 (imported) + 65 (new) = 519 |
| New | 2 |
| In Progress | 29 |
| Login | 323 |
| Approved | 116 |
| Total Approved | ₹13.26 Cr |
| Disbursed | 96 |
| Total Disbursed | ₹11.70 Cr |
| Interim Rejects | 100 |
| Final Rejections | 284 |
| Pipeline | ₹1.99 Cr |

---

*Last Updated: December 2, 2025*
