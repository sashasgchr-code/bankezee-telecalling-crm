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
- `/app/backend/routes/leads.py` - Leads + Data→File conversion
- `/app/frontend/src/pages/files/PolicyMaster.js` - Complete Policy Master UI
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
- [x] **Rejected Cases Report**: Bank-level rejection summary (IDFC, HDFC, ICICI, etc.) with totals for Not Eligible, Not Login, FI Negative, Declined, Not Disbursed
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

### 5. Data → File Conversion with Prefill (100% Complete) ✅
When Connect Data record status changes to "file":
- [x] Automatically prefills ALL known fields into file_details:
  - full_name (from lead.name)
  - mobile (from lead.phone)
  - email (from lead.email)
  - city (from lead.city)
  - source (from lead.source)
  - type_of_loan (from lead.requirement)
  - employment_type (from lead.employment_type)
- [x] Opens complete application form for remaining field entry
- [x] Creates activity log with prefilled fields list
- [x] Sets source_system = "connect" for new files
- [x] Preserves connect_customer_id for tracking

### 6. Policy Master (100% Complete) ✅
Complete OLD CRM Policy Master with ALL 40+ fields:
- [x] 27 bank policies configured
- [x] Expandable cards showing all policy details
- [x] 7-tab Add/Edit modal:
  - Basic Info (bank name, status, loan types, applicable profiles)
  - Eligibility (salary, CIBIL, FOIR)
  - Loan Params (amount range, tenure, ROI, processing fee)
  - Employment (company categories, employment duration requirements)
  - Age & Location (age limits, accommodation rules, serviceable locations)
  - BT & Top-up (balance transfer, topup, consolidation rules)
  - Documents (required documents list, special notes)
- [x] Search and filter by loan type
- [x] CRUD operations (Create, Read, Update, Delete)

### 7. Document Workflow (100% Complete) ✅
Required/Pending/Uploaded document tracking:
- [x] 19 document types defined (PAN, Aadhaar, Salary Slips, Bank Statement, etc.)
- [x] Document status bar (X/Y required docs)
- [x] Required Documents section with individual upload buttons
- [x] All Uploaded Documents section with download/delete
- [x] Upload Additional Documents with document type selection
- [x] Progress indicator for required documents completion

### 8. Star Rating Calculation (100% Complete)
Algorithm based on:
- Data Completeness (20 points)
- CIBIL Score (25 points)
- Income vs Loan Amount ratio (20 points)
- Employment Stability (15 points)
- Document Status (10 points)
- Existing Obligations/FOIR (10 points)

### 9. Security (Updated Dec 2025)
All file mutation endpoints have authentication guards:
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

### 10. Data Migration (100% Complete)
- 454 legacy CRM files imported to MongoDB
- Nested arrays (activities, eligibilities, documents) properly deserialized
- Idempotent migration script at `/app/backend/scripts/import_legacy_crm.py`

---

## Pending/Backlog Features

### P0 (Critical)
- [ ] Commission Module - Port commission tracking (historical data preservation, Admin/Ops reporting)

### P1 (High)
- [ ] Mobile Android EAS Build - Fix Gradle build failure
- [ ] Commission calculations with GP mappings

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

### Policies
- GET /api/files/policies - List all policies
- POST /api/files/policies - Create policy
- PUT /api/files/policies/{id} - Update policy
- DELETE /api/files/policies/{id} - Delete policy

### Documents
- POST /api/files/{id}/upload - Upload document
- GET /api/download/{doc_id} - Download document
- DELETE /api/files/{id}/documents/{doc_id} - Delete document

### Rating
- GET /api/files/calculate-rating/{id} - Calculate star rating
- PUT /api/files/update-rating/{id} - Update and persist rating
- POST /api/files/recalculate-all-ratings - Batch recalculate (Admin)

### Data → File
- PUT /api/leads/{id} with status="file" - Converts data to file with prefill

---

## Testing
- Test credentials: admin@bankezee.com / ConnectSasha12!!
- Test reports: /app/test_reports/iteration_30.json
- Backend tests: /app/backend/tests/test_iter30_policy_docs_prefill.py (4/5 passing)

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
