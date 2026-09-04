# BankEzee Connect CRM - Product Requirements Document

## Overview
BankEzee Connect is a comprehensive CRM platform for loan processing, integrating legacy OLD CRM data with modern Connect functionality.

## Production Deployment Status: ✅ COMPLETE
**Production URL**: https://connect.bankezee.com
**Deployment Date**: December 2, 2025

---

## Production Metrics (Verified September 2, 2026)

| Metric | Value |
|--------|-------|
| Total Files | 514 |
| New | 5 |
| In Progress | 28 |
| Login | 317 |
| Approved | 116 |
| Total Approved | ₹16.25 Cr |
| Disbursed | 96 |
| Total Disbursed | ₹13.84 Cr |
| Interim Rejects | 97 |
| Final Rejections | 280 |
| Amt in Pipeline | ₹1.84 Cr |
| Bank Policies | 27 |
| Users | 126 |
| Commissions | 65 |
| Activity Logs | 605 |

---

## Implemented Features

### CRM Core
1. **Files Dashboard** - Complete OLD CRM metrics with backend filters (search, date range, status)
2. **File Detail Page** - Full CRM workspace with 4 sections
3. **24 CRM Statuses** - Complete workflow from new → disbursed/rejected
4. **Bank Eligibilities** - Per-file tracking for 27 banks (Admin/Ops only)
5. **Star Rating** - Data completeness + CIBIL + FOIR algorithm
6. **Admin File Delete** - Hard delete with cascade (commissions, activities)
7. **GP "My Files"** - Growth Partners only see their assigned files
8. **Role-based Permissions** - GPs cannot modify eligibilities or delete files

### Reports (September 2026 Update - OLD CRM Parity)
All reports now open as SEPARATE PAGES (not toggle panels) matching OLD CRM format:

9. **Sales & Operations Report** (/admin/files/reports/sales-ops)
   - Business Volume Metrics (Total Files, In Progress, Login C/S, Approved, Disbursed C/S)
   - Financial Metrics (Disbursal Value, Avg Loan, Pipeline)
   - Team Productivity (GPs, Files per GP, Disbursals per GP)
   - Bank Performance Table
   - Rejection Analysis with top reasons
   - Export PDF / Print

10. **Rejected Cases Report** (/admin/files/reports/rejected)
    - Time Period + Manager filters
    - Summary Cards: Total, Not Eligible, Not Login, FI Negative, Declined, Not Disbursed
    - Expandable case list with bank-level details
    - Export PDF / CSV

11. **GP Performance Report** (/admin/files/reports/growth-partner)
    - Date range + Manager filters
    - Current (C) vs Spillover (S) breakdown
    - Login, Approved, Disbursed, Interim/Final Rejections
    - Disbursed Amount per GP
    - Export PDF / Print

12. **Quality Report** (/admin/files/reports/quality)
    - Date range + Manager + Loan Type filters
    - Star Distribution (5-1 stars)
    - GP Quality Breakdown table
    - Average Score calculation
    - Export PDF / Print

13. **Bank Performance Report** - Login → Disbursed funnel
13. **TAT Report** - Turnaround time metrics
14. **Quality Report** - Data quality scoring
15. **GP File Mapping Audit** - Admin view of GP vs File count matrix

### Policy & Eligibility (OLD CRM Parity - September 3, 2026)
16. **Bank Policy Master** (/admin/files/bank-policies) - 35 bank policies with complete criteria
    - Min Salary, Min CIBIL, Max FOIR, ROI range, Max Loan, Tenure
    - BT allowed/count, App Loan BT, CC BT, Top-up allowed
    - Bachelor/Hostel accommodation restrictions
    - Company categories, Employment requirements
    - CRUD operations for Admins
17. **Advanced Eligibility Check** (/files/:leadId/check-eligibility) - OLD CRM parity
    - Customer Profile Summary: CIBIL, Net Salary, Current EMI, FOIR, Requested Amount
    - Profile Strength calculation (Strong/Moderate/Fair/Weak/Not Eligible)
    - Bank categorization: Eligible / Possibly Eligible / Not Eligible
    - Bank Comparison table with top matches and ranking (BEST MATCH, 2ND BEST, 3RD BEST)
    - Detailed pass/fail/warning reasons per criterion per bank
    - Historical case data (approval rates, disbursed amounts)
    - Print functionality for eligibility reports
    - Eligibility history tracking
    - Missing Data warnings for incomplete profiles
18. **Document AI Parser** (Placeholder) - AI-powered document extraction
    - CRIF/Credit Bureau report parsing
    - Salary slip extraction
    - Bank statement analysis
    - Auto-fill capability
19. **Multi-bank Processing** - Login/Approval/Decline/Disbursal per bank

### Documents & Activities
19. **Document Workflow** - 19 document types (Required/Pending/Uploaded)
20. **Activity Log** - Color-coded with icons, full audit trail

### Data Integration
21. **Data → File Conversion** - Idempotent with prefill
22. **Legacy User Mapping** - 65 legacy users mapped
23. **Commission Module** - CRUD + aggregations + source_name snapshot

### Exports
24. **CSV Exports** - Dashboard, Rejected, GP Performance, Commission

### Connect Features (Preserved)
25. Data management and calling
26. Attendance tracking with Monthly Matrix UI
27. Leave management
28. User/GP management
29. Real-time dashboard

### Mobile Navigation (September 2026 Update)
30. **5-Item Bottom Nav** - Dashboard, Data, Files, Follow-ups, More
31. **More Bottom Sheet** - Attendance, Leave, Profile (Reports removed for GPs - shown inline on Dashboard)
32. **GP Attendance Page** - Monthly matrix with check-in/out
33. **GP Dashboard Hourly Report** - Vertical hourly report shown directly on Dashboard (C, Co, L, F metrics per hour) with date picker

### Manager Role Enhancement (September 3, 2026)
34. **Manager Dashboard** (/manager) - Dedicated manager layout with team-scoped stats
    - Metric tiles: Calls, Connected, Leads, Files with period filters (Today/This Week/This Month)
    - Team Overview: Total team members, TLs count, Active today
    - Files Performance table with GP breakdown: Files, Login, Approved, Disbursed, Amount
    - Call Activity by GP table
    - Full hierarchy visibility: Direct GPs + TLs under them + GPs under those TLs
35. **Manager Files Dashboard** - Admin-like access but team-scoped
    - "Team Dashboard" header with "Manager" badge
    - All report buttons available: Sales & Ops, Rejected Cases, GP Performance, Quality, Commission
    - Stats tiles show team-scoped data (not system-wide)
    - Files list shows GP Name badge next to customer name for easy ownership identification
    - Delete file capability (like Admin)
36. **Manager Team Page** (/manager/team)
    - Team Leads section with member count and stats (Calls, Leads, Files, Disbursed)
    - Growth Partners section with per-GP stats
    - Filter by TL (e.g., "Nagulapally's Team")
    - Search by name or email
37. **Manager More Menu** - Team Management section with: My Team, Team Data, Team Files, Team Calls

---

## September 2026 Update - DATA → FILE WORKFLOW & RBAC

### Completed (September 2, 2026)

**1. Canonical Data → File Conversion**
- New endpoint: `POST /api/leads/{id}/convert-to-file`
- Idempotent: Returns existing File if already converted
- Prefills customer info from Data record
- Preserves originating GP (source_id)
- Creates activity log entry
- Used by both CallModal (post-call) and manual status edit

**2. File Detail Section Split & RBAC**
- **Section 1**: Customer & Application Information
  - Editable by: GP, Ops, Admin
  - Includes: customer details, employment, income, obligations, loan requirements
- **Section 2**: Bank Processing & Eligibility
  - Editable by: Ops and Admin ONLY
  - GPs see "View Only" badge
  - GPs cannot add/edit bank eligibilities (403 error)

**3. Progressive Bank Eligibility UI**
- Conditional field reveal: Bank → Eligible? → Login? → Approved? → Disbursed?
- Historical files display all existing data

**4. GP Role Expansion**
- Roles recognized as GP: telecaller, sales_agent, team_leader, partner, growth_partner
- Manager role has dedicated routes with team-scoped access (not GP-level filtering)
- Route protection updated in frontend and backend

**5. Anusha Acceptance Test: PASSED**
- 15 files visible (14 migrated + 1 converted)
- Can edit Section 1 (Customer Info)
- Cannot edit Section 2 (Bank Processing)
- View Only badge correctly displayed

**6. RBAC Phase 1: User Roles & Hierarchy (September 2, 2026)**

New Role System Implemented:
| Role | Label | Description |
|------|-------|-------------|
| admin | Admin | Full system access - all features |
| hr | HR | Attendance, Leave, HR reports only - NO CRM data |
| manager | Manager | Team management, Admin-like access but scoped to their team hierarchy |
| ops | Operations | Cross-team CRM operational access |
| growth_partner | Growth Partner | Own records only (can have TL capability) |

Team Lead (TL) Capability:
- NOT a separate role - it's a GP with `is_tl=true`
- TL sees their own records + GPs assigned to them
- Manager → TL → GP hierarchy

Backend Changes:
- New user fields: `role`, `is_tl`, `manager_id`, `tl_id`, `is_active`
- Database indexes for performance: role, manager_id, tl_id, is_active
- New endpoints:
  - `GET /api/users/hierarchy-stats` - Role counts and GP statistics
  - `GET /api/users/managers` - List of manager users
  - `GET /api/users/team-leads?manager_id=x` - TLs filtered by manager
  - `PUT /api/users/{id}/role-hierarchy` - Update role and hierarchy
- Helper function `find_user_by_id()` handles both ObjectId and custom ID lookup
- Role-based account seeding on startup (admin, hr, manager×2, ops×2)

Frontend Changes:
- Users page with new columns: Role | TL? | Manager | Team Lead | Status
- User Hierarchy Overview dashboard with role counts
- Edit Role & Hierarchy modal:
  - Role selection (Admin, HR, Manager, Ops, Growth Partner)
  - TL capability toggle (for GPs only)
  - Manager dropdown
  - Team Lead dropdown (filtered by selected manager)
- Status column handles legacy users (is_active vs status field)
- Smart payload building - only sends changed fields

Seeded Accounts:
- admin@bankezee.com (admin)
- hr@neosales.in (hr)
- teja@bankezee.com (manager)
- saikiran@bankezee.com (manager)
- rama@bankezee.com (ops)
- ops@bankezee.com (ops)

---

## Authentication
- Admin: admin@bankezee.com / ConnectSasha12!!
- HR: hr@neosales.in / HrNeo12!!
- Manager: teja@bankezee.com / tejasme12
- Manager: saikiran@bankezee.com / saikiran12
- Ops: rama@bankezee.com / rama@bzc12
- Ops: ops@bankezee.com / ops@bzc12
- GP Test: yarragondaanusha@gmail.com / AnushaGP123!

## Technical Stack
- Frontend: React with Shadcn/UI
- Backend: FastAPI
- Database: MongoDB
- Mobile: Expo React Native (EAS build pending)

---

## Migration Summary
- 514 legacy CRM files migrated
- All eligibilities, activities, documents preserved
- User mappings and commissions migrated

---

## Deferred Items
- Android EAS/Gradle build fix
- Mobile app APK generation
- RBAC Phase 4: Role-adaptive navigation (hide menus based on role)
- HR-specific views: Attendance/Leave only, no CRM access

---

## Recently Completed (September 2, 2026)

### RBAC Phase 3: TL Team Tabs ✅
Team Lead users (GPs with `is_tl=true`) now have a dedicated "Team Lead View" section in the More menu:

**New Pages:**
1. **My Team** (`/agent/team`) - List of GPs assigned to this TL with stats (data, files, calls)
2. **Team Data** (`/agent/team/data`) - View-only access to team's leads
3. **Team Files** (`/agent/team/files`) - View-only access to team's loan files
4. **Team Calls** (`/agent/team/calls`) - View-only access to team's call logs

**Features:**
- All team views show "View Only Mode" badge
- Team members determined by `tl_id` field matching TL's user ID
- Stats for each team member: total data, files, calls
- Search functionality on Team Data/Files/Calls
- Pagination for large datasets
- Backend endpoints enforce TL-only access (403 for non-TLs)

**New Backend Endpoints:**
- `GET /api/users/my-team` - Returns team members with stats (TL only)
- `GET /api/leads?team_view=true` - Returns team's leads (TL only)
- `GET /api/files?team_view=true` - Returns team's files (TL only)
- `GET /api/call-logs/team` - Returns team's call logs (TL only)

**Test Accounts:**
- TL: anusha@bankezee.com / TLAnusha123! (is_tl=true, 1 team member)
- GP: yarragondaanusha@gmail.com / AnushaGP123! (assigned to TL above)

---

### Enhanced Monthly Attendance Matrix ✅ (September 3, 2026)
Added comprehensive monthly attendance summary view for both Admin and GP roles.

**Features:**
1. **Month/Year Dropdowns** - Quick selection with navigation arrows
2. **Dynamic Year Selector** - Shows current year and 2 previous years
3. **Working Days (WD) Column** - Shows total working days in month
4. **Attendance Codes:**
   - P = Present
   - L = Late (with login time in tooltip, e.g., "Late - Check-in: 10:24")
   - W = Work From Home
   - A = Approved Leave
   - U = Uninformed Absence (only for past working days)
   - `-` = Weekend/Non-working day
5. **Summary Totals** - P, L, W, A, U counts per row
6. **Attendance Percentage** - (Present / Working Days) × 100

**Mobile Optimization:**
- Sticky Growth Partner name column
- Horizontally scrollable day columns
- Compact day cells
- Touch-friendly filters and selectors

**Admin View:** All Growth Partners with full matrix
**GP View:** Personal attendance with calendar grid

---

### File Details Page RBAC Complete ✅ (September 3, 2026)
Rebuilt `FileDetailsPage.js` with exact OLD CRM layout and strict RBAC:

**Page Layout:**
- Complete Lead Information (Customer, Employment, Loans, Requirements, Source & Status)
- Profile Analysis (CIBIL Issues, FOIR %, Company Type)
- Bank Eligibilities (0-7 banks with expandable details: Eligibility, Login, Approval, Disbursement, Commission)
- Update Status dropdown
- Documents panel (upload, download ZIP, password protection)
- Activity Log with notes

**RBAC Implementation:**
| Section | Admin | Ops | Manager | GP |
|---------|-------|-----|---------|-----|
| Complete Lead Info | ✅ Edit | ✅ Edit | ✅ Edit | ✅ Edit |
| Profile Analysis | ✅ Edit | ✅ Edit | ✅ Edit | ❌ Hidden |
| Bank Eligibilities | ✅ Edit | ✅ Edit | ✅ Edit | ❌ Hidden |
| Update Status | ✅ Edit | ✅ Edit | ✅ Edit | ❌ Hidden |
| Documents | ✅ Full | ✅ Full | ✅ Full | ✅ Upload/Delete |
| Activity Log | ✅ Full | ✅ Full | ✅ Full | ✅ Add Notes |

**Key Features:**
- Check Eligibility button navigates to separate page (role-aware: `/admin/` or `/agent/`)
- Manual bank eligibilities drive approval stats (NOT AI check results)
- Masked phone/email with reveal toggles
- Password-protected document downloads

---

### Navigation Reorganization ✅ (September 3, 2026)
Moved "Approvals" and "Users" tabs from Files Dashboard to Admin menu for cleaner separation:

**Changes:**
1. **Files Dashboard** - Now shows only file metrics/dashboard (no tabs)
   - Removed: Approvals tab, Users tab
   - Keeps: All file statistics, filters, GP/Manager dropdowns, file list

2. **New "Approvals" Page** (`/admin/approvals`)
   - Dedicated page for user signup approvals
   - Accessible via More menu in navigation
   - Features: Search, Select All, Bulk Approve, Individual Approve/Reject
   - Shows pending count badge

3. **Users Page** (`/admin/users`)
   - Unchanged functionality
   - Now primary location for all user management
   - Includes: User list, bulk tools, Legacy CRM Mapping button
   - Has internal tabs: Dashboard, Approvals (quick access), Users

**Navigation Menu Update:**
- More menu now shows: Approvals, Users, Reports, Attendance, Leave, Logout
- "Approvals" added as first item for quick access

**Rationale:**
- Files Dashboard focuses purely on loan file operations
- User management (approvals, settings) separated into dedicated admin area
- Cleaner mental model: Files = CRM work, Admin = people management

---

### Hourly Report with Role-Based Filtering ✅ (September 3, 2026)
Enhanced hourly report with "Connected" column and role-based data access:

**New Features:**
1. **Connected Column (Co)** - Added to hourly report alongside C (Calls), L (Leads), F (Files)
2. **Role-Based Filtering:**
   - Admin/Ops: See all growth partners
   - Manager: See GPs under their management (direct + via TLs)
   - TL: See their team members only
   - GP: See only their own hourly stats
3. **Reports Page Access for All Roles:**
   - Added `/agent/reports` route for GPs, TLs, Managers
   - "Reports" added to the More menu in agent navigation
   - Same Reports page works for all roles with filtered data

**UI Changes:**
- Column headers: C (blue), Co (purple), L (teal), F (orange)
- Totals row shows aggregated counts per column
- Legend updated: "C = Calls, Co = Connected, L = Leads, F = File"

**Navigation:**
- Admin: More menu → Reports
- GP/TL/Manager: More menu → Reports (first option)

---

### GP View-Only Access to Bank Eligibilities ✅ (September 3, 2026)
Growth Partners can now VIEW (but not edit) administrative sections on file details:

**Visible Sections for GPs (Read-Only):**
1. **Profile Analysis** - CIBIL Issues, FOIR %, Company Type
2. **Bank Eligibilities** - All bank processing data (0-7 banks)
3. **Update Status** - Current status visible but dropdown disabled

**UI Indicators:**
- "View Only" badge in blue shown next to section headers
- All form fields disabled with gray background (`bg-gray-50 cursor-not-allowed`)
- No Save/Add Bank buttons visible for GPs
- No delete icons on bank entries for GPs

**Rationale:**
- GPs need visibility into file progress for customer conversations
- Prevents accidental modifications to bank processing data
- Maintains data integrity while improving transparency

---

### User Consolidation & Legacy CRM Migration ✅ (September 3, 2026)
Complete user identity consolidation from @users spreadsheet as source of truth.

**Migration Summary:**
- **19 Active GP accounts** consolidated from @users spreadsheet
- **2 Team Leaders**: Anusha (11 members), Pinky (5 members)
- **97 users deactivated** (not in @users list)
- **2 CRM-to-Connect mappings** created (Pinky, Masoom with different emails)

**What Changed:**
1. All GP passwords updated to match Connect column in @users
2. Manager/TL hierarchy established from spreadsheet
3. CRM accounts with different emails mapped to Connect accounts
4. Non-@users GP accounts deactivated (is_active=false)
5. Historical data preserved (no files/activities deleted)

**Hierarchy Structure:**
```
Teja (Manager)
├── Pinky (TL) - 5 GPs: Wamiz, Vijayendra, Vishnu, Shiva, Chandana
└── G Saikiran (Manager role)
    └── Anusha (TL) - 11 GPs: Pushpa, Deevena, Shanthi, Anil, Nithin, Priya, Raju, Meghana, Rishikesh, Masoom, Asma
```

**Special Cases Handled:**
- **Pinky**: CRM email (akshaya03302023@gmail.com) different from Connect email (pinkynagulapally@gmail.com) - properly mapped
- **Masoom**: Typo in Connect email (masoommd7472@gmai.com) - kept as-is per spreadsheet
- **G Saikiran**: No CRM account - uses Connect only

**Connect is now the ONLY operational login system.**

---

### Advanced Bank Eligibility Check - OLD CRM Parity ✅ (September 3, 2026)

Implemented comprehensive bank eligibility checking with full feature parity from the OLD CRM system.

**New Files Created:**
- `/app/backend/routes/bank_policies.py` - Bank policy CRUD + advanced eligibility engine
- `/app/backend/routes/document_ai.py` - AI document parsing (placeholder for LLM integration)
- `/app/backend/scripts/seed_policies.py` - Seeds 12 major bank policies
- `/app/frontend/src/pages/admin/BankPolicyMaster.js` - Admin policy management page
- `/app/frontend/src/pages/files/EligibilityCheck.js` - Advanced eligibility check UI

**Features:**
1. **Bank Policy Master** (/admin/files/bank-policies)
   - 35 bank policies with 30+ criteria fields each
   - CRUD operations for Admins
   - Active/Inactive status toggling
   - Profile type badges (Salaried, Self-employed)

2. **Advanced Eligibility Check** (/files/:leadId/check-eligibility)
   - Customer Profile Summary with CIBIL, Net Salary, EMI, FOIR, Loan Amount
   - Profile Strength calculation algorithm
   - Categorization: Eligible / Possibly Eligible / Not Eligible
   - Bank Comparison table with ranking (BEST MATCH, 2ND BEST, 3RD BEST)
   - Detailed pass/fail/warning reasons per criterion
   - Historical case data aggregation
   - Print functionality
   - Eligibility history tracking
   - Missing Data warnings

3. **API Endpoints:**
   - `GET /api/bank-policies/policies` - List all policies
   - `POST /api/bank-policies/policies` - Create policy (Admin only)
   - `PUT /api/bank-policies/policies/{id}` - Update policy (Admin only)
   - `DELETE /api/bank-policies/policies/{id}` - Delete policy (Admin only)
   - `POST /api/bank-policies/check-eligibility/{lead_id}` - Run eligibility analysis
   - `GET /api/bank-policies/eligibility-history/{lead_id}` - Get check history

**Test Results:** Backend 100% (9/9 tests), Frontend 100% (all criteria met)

---

### GP Data Isolation Bug Fix (September 3, 2026)

**Issue**: GPs were seeing all users' data instead of only their own assigned data.

**Root Cause**: The `leads.py` routes were checking only for `role == "telecaller"` but the system now has multiple GP roles: `telecaller`, `sales_agent`, `growth_partner`, `partner`, `team_leader`.

**Fix Applied**:
- Added `GP_ROLES` constant and `is_gp_role()` function to `/app/backend/routes/leads.py`
- Updated all role checks from `current_user["role"] == "telecaller"` to `is_gp_role(current_user.get("role", ""))`
- Fixed 7 locations: `build_leads_query()`, `get_leads_count()`, `get_lead()`, `update_lead()`, `convert_lead_to_file()`, CSV import, and auto-distribute

**Verification**: SHIVASAI (sales_agent) now correctly sees only his 6 files/leads, not all 600+ in the system.

---

### TL Dropdown State Reset Bug Fix (September 3, 2026)

**Issue**: In Admin User Management (/admin/users), when editing a user's role and hierarchy, selecting a Manager (e.g., Saikiran) would immediately reset the dropdown back to "Unassigned", preventing Team Lead assignment.

**Root Cause**: The `useEffect` hook in `Users.js` that fetched Team Leads based on `roleEditData.manager_id` was triggering on initial page load (not just when modal was open), causing a race condition that overwrote the manager-filtered TLs with all TLs.

**Fix Applied** (`/app/frontend/src/pages/admin/Users.js`):
1. Added `showEditRoleModal` as a dependency to the useEffect, gating the fetch behind modal-open state
2. Restructured TL dropdown to have an explicit default option "No Team Lead (Direct to Manager)"
3. Filter out null IDs from TL options to prevent key conflicts
4. Added helpful message when no TLs are available under selected manager

**Verification**: 
- Admin can now select Manager "Saikiran" and the dropdown stays selected
- TL dropdown correctly populates with "Yarragonda Anusha (yarragondaanusha)"
- TL can be selected and saved successfully

**Test Results**: Frontend 100% - All 3 scenarios passed

---

*Last Updated: September 3, 2026*
*Status: PRODUCTION LIVE*

---

## PRODUCTION 500 ON ADMIN FILES LIST — ROOT CAUSE & FIX (September 3, 2026) — DEPLOYED & VERIFIED

### Reported symptom
Published app (connect.bankezee.com): Admin Files dashboard loaded statistics but the list showed
"Files (0) / No files found". Preview showed 514 files. User (correctly) demanded a full
preview-vs-production trace instead of further frontend edits.

### Environment finding (not a bug)
Emergent preview pods and deployed pods have SEPARATE MongoDB instances.
- Preview: mongodb://localhost:27017, DB_NAME=test_database -> 128 users (31 active), 514 status:"file"
- Published: its own deployed Mongo -> 201 user docs (84 active), 530 status:"file"
Never assume production data is missing because preview counts differ.

### Root cause 1 - response serialization (the 500)
Legacy CRM imports contain NaN/Infinity floats (Excel/pandas) and nested BSON ObjectId inside
file_details / eligibilities / file_activities. Starlette's JSONResponse uses
json.dumps(..., allow_nan=False) and FastAPI's jsonable_encoder cannot encode ObjectId, so
returning the raw document raised ValueError -> 500. Exactly 2 of 530 documents poisoned page 1.
Stats/report endpoints survived because they use count_documents/aggregate.
Reproduced deterministically: limit=1 -> 200, page=20&limit=1 -> 500, file_status=disbursed -> 500.

### Root cause 2 - legacy records have no `id` field (silent 404s)
Production CRM documents have no `id`; the list endpoint exposes str(_id). All 33 per-file
queries used {"id": file_id}, so File Detail, eligibilities, activities, status change, notes,
documents and uploads returned 404 for EVERY old CRM record in production.

### Fixes shipped
- NEW `/app/backend/utils/json_safe.py` - `json_safe()` recursive sanitiser
  (NaN/Inf -> None, ObjectId -> str, Decimal128 -> float, bytes/datetime normalised).
  Applied to files list, detail, eligibilities, activities, reports/rejected, export.
- NEW `lead_filter(file_id, **extra)` in `routes/files_crm.py` - matches {"id": id} OR
  {"_id": ObjectId(id)}; applied to all 33 per-file sites. get_file_details now always returns `id`.
- `FileDetailsPage.js`: 3 calls pointed at non-existent routes (PUT /files/{id} -> 405,
  PUT /files/{id}/status -> 404, POST /files/{id}/note -> 404). Repointed to
  /details, /file-status, /notes. Activity log now renders newest-first.
- `routes/users.py`: `files_count` now counts status:"file" only; new `leads_count` = all records.

### Production acceptance (post-deploy, 30/30 PASS)
Admin list 200 total=530 rows=50, page2 200, stats 530, file detail by legacy _id 6a827c...1785 200,
eligibilities/activities 200, note+status+details writes 200 and persisted, users 201/84 active,
Nithin files 15 reconciled 3 ways (files_count=15, leads_count=7656, /api/files?gp_id=15),
GP 15, TL Anusha 17, all 10 report endpoints 200. UI verified: "Files (530), Page 1 of 11".
Harness: `/app/scripts/acceptance_matrix.py`, `/app/scripts/files_rbac_matrix.py`.

---

## OPEN ISSUES MEASURED IN PRODUCTION (authorised, NOT yet implemented)

### A+B  Manager/TL scoping (authorised by user, pending implementation)
Teja audit: he exists as TWO user docs with DIFFERENT ids -
  e37774a4-8b44-4f6f-a282-faeaa5ab6800 (the id Pinky's manager_id points to)
  698c346470f2678cbac393c5 (the id his LOGIN session receives)  -> team lookup returns 0.
Hierarchy totals: direct GPs 0, direct TLs 1 (Pinky, 32 files), GPs under TLs 0,
sub-managers 0, total tree = 2 users / 32 files, current API result 0.
Production linkage: tl_id set on 0 of 201 docs, manager_id on 7 of 201; 201 docs / 129 unique
emails = 72 duplicates; is_active is true 84 / false 79 / MISSING 38.
- A: resolve logged-in user to the SET of docs sharing email/connect_id/legacy_user_id and use
  that id-set for traversal + ownership matching.
- B: full recursive downward hierarchy for managers (GPs + TLs + GPs under TLs + sub-manager subtrees).
- C: data repair of manager_id/tl_id + dedupe of 72 duplicate docs - DRY-RUN REPORT FIRST, user approval required.

### Fail-closed admin filters (authorised, not implemented)
`/api/files/?manager_id=<teja>` and `?tl_id=<pinky>` return 530 = ALL files, because an empty
team list causes the filter to be skipped. Must return 0 rows instead.

### Connect/CRM badge (authorised, not implemented)
`users.py` checks `password_hash` but `auth.py` verifies `user["password"]`. Production accounts
store `password`, so can_login=false for all 84 active users and every row shows the CRM badge.
Accept either field for classification only; do not touch auth data.

### Meghana Daily Tracking Sheet (traced, fix NOT implemented)
`routes/reports.py:1137` hardcodes {"role": "telecaller", "is_active": True} while the dropdown is
fed by /api/users/growth-partners (all GP_ROLES). Evidence across all 66 dropdown GPs:
  61 users role=telecaller -> report works; the ONLY 3 empty ones are role=growth_partner
  (Meghana 6a4de559..., Pinky 6a869948..., Anusha 69b24904...); 2 UUID-id users (Sasha,
  Test Agent) return HTTP 500 from ObjectId(user_id) InvalidId.
Meghana's call_logs exist (78 rows in a 1000-row sample) under user_id=6a4de55969071f897aef1baa.
Same hardcode at reports.py:472 (/reports/telecallers) and :1013 (verified-call-stats);
reports.py:742/760/770 already use the 4-role list. `.to_list(100)` also truncates 106 telecaller docs.
Minimal fix: use GP_ROLES, match `id` OR `_id` with ObjectId.is_valid guard, raise the list cap.

*Last Updated: September 3, 2026 (post-deploy acceptance passed)*

---

## A + B + FAIL-CLOSED + SHARED FILES QUERY + MEGHANA TRACKING (September 3, 2026)
### Implemented on Preview, 34/34 own matrix + 73/73 testing-agent backend PASS. AWAITING PUBLISH.

### New shared modules (single source of truth)
- `/app/backend/utils/hierarchy.py` — `UserIndex` union-find over `_id` / `id` / `connect_id` /
  `legacy_user_id` / normalized email. `aliases()`, `descendants()` (recursive, cycle-safe,
  depth-capped, person-level `is_active`), `subtree_members()`, `team_leads_under()`,
  `belongs_under()`, `load_user_index()`. Never writes; never rewrites ownership ids.
  Validated against real production metadata: 129 groups for 129 emails, ZERO wrong merges.
- `/app/backend/utils/files_query.py` — `build_files_query()` is THE definition of the Files
  population, used by the list, `dashboard/stats` and `export/dashboard`.
  Returns `None` to signal FAIL CLOSED; callers must render 0 rows / 0 stats.
- `/app/backend/utils/helpers.py` — `classify_source()` / `has_login_credential()`.

### Wired into
- `files_crm.get_all_files`, `get_files_dashboard_stats` (+ new params: file_status, gp_id, tl_id,
  manager_id, loan_types, activity dates, team_view), `export_dashboard_csv`
  (previously unscoped AND unauthenticated — a GP could export every file).
- `utils/auth.get_user_team_ids`, `get_manager_hierarchy_ids`, `validate_tl_manager_match`.
- `users.py`: `/users/team-leads` (TLs anywhere under the selected manager),
  `/users/growth-partners` (manager/TL branches use the subtree), `list_users` source badge.
- `reports.py`: `AGENT_ROLE_FILTER` + `resolve_agent_query()`; daily-tracking-sheet,
  `/reports/telecallers`, `/reports/verified-call-stats` no longer hardcode `role="telecaller"`,
  match `str(_id)` OR `id`, dedupe per person, list cap 100 -> 2000.
- Frontend: `FilesDashboard.buildFileFilterParams()` shared by list/stats/export (stats had been
  sending `created_start_date`, which the backend never read); authenticated blob CSV download;
  `Users.js` clears a stale `tl_id` when the Manager changes and no longer re-filters TLs by
  `manager_id` on the client (which would hide sub-managers' TLs).

### Preview before -> after
| Scope | Before | After |
|---|---|---|
| Admin no filter | 514 | 514 |
| Manager Teja | 46 | 94 |
| Manager Saikiran | n/a | 56 |
| TL Anusha own / team_view | 14 / 38 | 14 / 42 |
| TL Pinky own | 32 | 32 |
| GP Nithin | 15 | 15 |
| admin tl_id=Anusha / Pinky | 38 / - | 42 / 20 |
| Manager GP dropdown | 7 | 18 |
| Unknown manager_id/tl_id/gp_id | 514 (fail OPEN) | 0 (fail closed) |
| Daily tracking agents | 61 of 66, 3 always empty, 2x HTTP 500 | all, 0 empty, 0 500s, no dupes |

### Still pending
- PUBLISH: source-classification fix + everything above is Preview-only.
- Verify on production: Meghana/Asma/Nithin/Pinky = Connect, placeholders = CRM, Files counts,
  and the production-only assertion that BOTH Teja ids resolve to the same scope.
- C dry-run written to `/app/memory/C_dryrun_hierarchy_repair.md` + `.json` — 16 proposed link
  writes, 5 genuinely-divergent duplicate pairs. AWAITING USER APPROVAL, zero writes so far.
- Known unfixed: 3 other CSV exports (rejected / growth-partner / commissions) still use
  `window.open` without a token, so they 401.

*Last Updated: September 3, 2026*

---

## UUID / MISSING-`id` DEFECT FAMILY (September 3, 2026) — fixed on Preview, 15/15 fixture gate

Two user-reported production bugs, same root cause family: code assumed every identifier is a
Mongo ObjectId, but records created inside Connect carry a UUID `id` while legacy CRM records
carry no `id` at all.

1. **"Assigning TL still doesn't work"** — `/api/users/team-leads` projected `{"_id": 0, "id": 1}`.
   Production TL documents have NO `id` field, so the response contained no `id` key at all and
   the dropdown rendered `<option value={undefined}>`. Proven with the raw production response.
   NOTE: the A+B version filtered on `tl.get("id")`, which would have made the dropdown come back
   EMPTY on production. Preview could not catch it - all 128 preview users have an `id`.
   Fix: keep `_id` in the projection, emit `id = doc.get("id") or str(doc["_id"])`, and scope by
   `index.root_for()` instead of the raw `id`.
2. **"Failed to start call"** — `calls.py:47` `ObjectId(data.lead_id)` where the frontend sends
   `lead.id`; for Connect-created leads that is a UUID -> `InvalidId` -> 500 -> the alert falls
   back to the generic message. EVERY Connect-created lead was uncallable; legacy leads worked.
   Nothing to do with the new user account.
   Fix: `doc_ref_filter()` + real 404.

New shared helper `utils/helpers.doc_ref_filter()` / `object_id_or_none()` - matches a document by
`id` OR `_id`, never raises InvalidId. Applied to `calls.py` (start / end / log / cancel /
lead call-logs), `/leads/assign` (now resolves the assignee through `index.aliases()`, fixing the
500 for the 54 UUID-id production users and the 404 for legacy ids), and `files_crm.lead_filter`
now delegates to it.

### New permanent gate: `/app/scripts/fixture_gate.py`
Plants PRODUCTION-SHAPED documents in the preview DB, runs the API against them, then deletes them
(verified: preview back to exactly 128 users / 518 leads):
  U1 user with no `id` · U2 user with UUID `id` · U3 user whose `id` != `_id`
  L1 lead with UUID `id` · L2 legacy file with no `id` + NaN floats + nested ObjectId
15/15 PASS after the fixes; it reproduces both of today's bugs on the pre-fix code.
Run this alongside `verify_hierarchy.py` (34/34) and `acceptance_matrix.py` before every publish.

### Still not published
Everything from the A+B release plus these fixes is Preview-only. Production continues to run the
build from earlier today (Files 500 + legacy `_id` fixes only).

*Last Updated: September 3, 2026*

---

## MANAGER UI / NAVIGATION CHANGES (September 4, 2026) — Preview, all gates green

Scope-limited to the Manager experience as requested. No hierarchy/scoping, calling, file
ownership, assignment or Connect/CRM logic touched.

1. **Custom From/To date range on the Manager Team Dashboard** (`ManagerDashboard.js`)
   - Kept Today / This Week / This Month; added From Date -> To Date + Clear.
   - `resolveRange()` mirrors the backend `get_date_range()` so ONE range drives every section:
     metric cards, Team Overview, Files Performance and Call Activity by GP.
   - Guard: From cannot be after To (inline error + native min/max on the inputs).
   - Backend (minimum necessary): `/api/reports/manager-team-stats` now accepts
     `from_date`/`to_date` and passes them to the existing `get_date_range()`.
   - The files + disbursement aggregations in that endpoint had NO time filter (Files read 46 for
     every period). They now use the same window, with a `$or` on datetime AND ISO-string
     `updated_at` because legacy CRM rows store it as a string.
     VISIBLE CHANGE: Files on "Today" is now the period figure, not the lifetime figure.
   - `/files/reports` is now called with `start_date`/`end_date` for every period (it ignored the
     `period` param entirely, so Files Performance was previously unfiltered).
   - Verified: today 0 · this_week/this_month/2026 46 · 2026-09-03 only 27 (Pinky 20, Shivasai 4,
     Vishnu 3) · 2020 0.

2. **Manager navigation**: `Dashboard | Files | Track Report | Reports | More` (Data removed).
   Reports promoted from More to primary nav (same `AdminReports` page, no duplicate logic).

3. **Manager More menu**: Attendance, Leave, Team Management (My Team, Team Calls), Logout.
   Removed Team Data, Team Files, Reports.

4. **Manager access path**: removed the `/manager/leads`, `/manager/leads/:id`,
   `/manager/team/data`, `/manager/team/files` routes from `App.js`. The `TeamData`/`TeamFiles`
   components and their APIs are untouched and still routed for TL/GP at lines 189-190.

Regression: `verify_hierarchy.py` 34/34 · `fixture_gate.py` 15/15 (preview restored to 128 users /
518 leads) · only `ManagerLayout.js` changed among layouts · Admin `leads` and Telecaller `leads`
routes intact.

### Known, unchanged, flagged
`/api/reports/manager-team-stats` still resolves the team with a direct `{"manager_id": user_id}`
query, so the Manager DASHBOARD shows direct reports only (Teja: 8 members / 46 files) while the
Files list uses the recursive identity-resolved subtree (94 files). Left as-is per the explicit
"do not modify hierarchy/scoping" instruction - needs a decision.

*Last Updated: September 4, 2026*

---

## USER MANAGEMENT AUDIT (September 4, 2026) — Preview: 10/10 stable, persistence PASS

### Issue 1 - intermittent "All Users (0)"
ROOT CAUSE: `/api/users` ran 4 queries PER USER (2 `count_documents` for files/leads + 2 name
lookups) = 400+ sequential queries on production. Measured on connect.bankezee.com: **46.0s** and
**27.4s** on consecutive calls. The axios client timeout was **30s** (`services/api.js`), so the
request aborted on the slow runs, `fetchUsers` hit `catch`, `setUsers` was never called and the
page rendered its empty state - "All Users (0) / 0 active, 0 inactive / No users found".
Intermittent purely because the runtime straddled the 30s timeout.
NOT caused by: fail-closed logic (never applied to /api/users), an empty UserIndex, request
cancellation, or duplicate fetches.

FIX
- One `$group` aggregation over `leads` replaces all per-user counting, grouped by the owner SET
  (`$setUnion` of source_id/assigned_to) so a lead is counted once per PERSON even when the two
  fields hold two different aliases of the same person.
- Manager/TL names resolved from the in-memory index; `load_user_index()` built once per request.
- Frontend: `loadError` state + Retry button; a failed load can never render as 0 users; header
  shows "All Users (unavailable)"; stale responses discarded via a request-sequence ref.
- axios timeout 30s -> 120s as a safety net.
- Preview: 0.14-0.27s, 10/10 loads = 128 users, 0 zero-results.

### Issue 2 - Manager/TL not persisting on reopen
ROOT CAUSE: `find_user_by_id()` tried `{"_id": ObjectId(user_id)}` FIRST and fell back to
`{"id": user_id}`. With 72 duplicate people in production (67 pairs sharing the same `id`), both
lookups are non-deterministic: the save could land on the telecaller duplicate while `/api/users`
rendered the growth_partner duplicate, so the reopened modal read a document that was never
written. The modal also initialises from the row object, so it displayed that stale document.

FIX - CANONICAL USER RULE (deterministic, in `utils/hierarchy._primary_doc`):
  active + login credential > active > has connect_id > lowest `_id`
- `find_user_by_id()` now resolves through the index and returns the canonical document, so every
  Admin edit (role, active, manager, TL) reads and writes the same document.
- `list_users` overlays `role`, `is_active`, `is_tl`, `manager_id`, `tl_id` from the canonical
  document onto EVERY duplicate row, and exposes `canonical_id` / `is_canonical`. Two rows for the
  same person can no longer disagree.
- `role-hierarchy` PUT stores the manager's/TL's CANONICAL id, not the raw id posted.
- Canonical manager field = `manager_id`. Canonical TL field = `tl_id`. `team_lead_id` does not
  exist anywhere in the codebase - nothing to normalise.
- Aliases remain read-only for historical ownership; no document is merged or deleted.

Bonus: Users-page `files_count` is now per-person and reconciles EXACTLY with
`/api/files?gp_id=` for all 31 active preview users (previously id-only, so alias-owned files
were missed).

Gates: `user_mgmt_audit.py` 10/10 + persistence PASS for 2 GPs (incl. after re-login) ·
`verify_hierarchy.py` 34/34 · `fixture_gate.py` 15/15 · preview restored to 128 users / 518 leads
and Nithin/Meghana hierarchy links restored after the write tests.

*Last Updated: September 4, 2026*

---

## MANAGER DASHBOARD HIERARCHY (September 4, 2026) — Preview: UM and Dashboard now MATCH exactly

ROOT CAUSE: the Manager dashboard was the last place still resolving the team on its own.
`/api/reports/manager-team-stats` and `/api/users/manager-team-members` both ran
`db.users.find({"manager_id": user_id, "is_active": True})`:
  - only ONE Teja id, not his alias set
  - only DIRECT reports - `tl_id` edges and sub-manager subtrees never traversed
  - activity maps keyed by a single `id`, so history recorded under a legacy alias was dropped
  - duplicate documents could yield the same person twice
No cache was involved; the values were wrong on every request, not stale.

FIX: both endpoints now use the shared resolver (`utils.hierarchy`) - the SAME one used by Admin
User Management, the Files list/stats, Track Report and Reports:
  - members  = `index.subtree_members(user_id, include_self=False)`  (recursive, cycle-safe,
    person-level active, one row per person, canonical document per person)
  - ownership = `index.descendants(user_id)`  (every alias of the whole subtree + the manager)
  - `user_map` keyed by EVERY alias, so historical activity under legacy identifiers resolves
  - Team Members = `len(team_users)` (unique active people below the manager, excluding himself)
    - previously `len(team_ids)`, which would have counted aliases
  - Team Leads = unique active TL-capable people in that subtree

TRACE (preview, Teja): session id e37774a4 · canonical e37774a4 · direct reports 8
(incl. TLs Pinky + inactive anusha@bankezee.com) · recursive descendants 18 active people ·
active TLs in subtree 1 (Pinky). Chain proven: Teja -> G Saikiran (a role=telecaller GP acting as
sub-manager) -> his 10 GPs. A role-based traversal would have stopped at him; edge-based traversal
does not.
User Management descendants 18 == Manager Dashboard members 18 == total_team 18. MATCH: YES.
Dashboard `files` (94) now equals the Manager Files list total (94).

MANDATORY TEST (preview writes only, restored afterwards): assigning TL Anusha under Teja moved
Team 18->19, Team Leads 1->2, Files 94->108 (+14, her own files), members 18->19; identical on
re-fetch (no caching); restored to 18/1/94. PASS.

Gates after the change: `verify_hierarchy.py` 34/34 · `user_mgmt_audit.py` 10/10 loads +
Manager/TL persistence PASS · preview restored to 128 users / 518 leads with Nithin/Meghana links
back under G Saikiran / Anusha.

*Last Updated: September 4, 2026*

---

## TEAM LEADERBOARD (September 4, 2026) — Preview, frontend-only + duplicate merge

- New "Team Leaderboard" section on the Manager dashboard, ranked by files converted in the
  selected period (ties broken by disbursed, then calls). Medal styling for top 3, TL badge,
  per-row "N calls · N connected · N disbursed", `data-testid="team-leaderboard"` /
  `leaderboard-row-{n}` / `leaderboard-files-{n}`.
- No new endpoint and no duplicate reporting logic: it reuses `gp_performance` + `gp_call_stats`
  already returned by `/api/reports/manager-team-stats`, so it follows the same period filter
  (verified: this_month vs 2026-09-03 give different rankings).
- Backend `merge_by_person()` added in that endpoint: `gp_performance` / `gp_call_stats` were
  emitted PER ALIAS, so people with a legacy duplicate appeared twice (Shivasai 6+3, Anil 8+2).
  Rows are now merged by person root and carry the canonical id.
  Result: 18 rows for 18 team members, no duplicate names, and the per-row files sum (92) equals
  the team total (92).
- Gates: `verify_hierarchy.py` 34/34 · UM vs dashboard MATCH: YES (18 = 18 = 18).

### Blocked on user input
C hierarchy link repair (16 production writes) - still needs the two confirmations in
`C_dryrun_hierarchy_repair.md`: G Saikiran's role, and whether saikiran@bankezee.com is still in
use. NOT applied. Note: `role-hierarchy` PUT validates `manager_id` belongs to a role=manager
user, so 10 of the 16 links cannot be written through the API while G Saikiran is a telecaller.

*Last Updated: September 4, 2026*

---

## TRACK REPORT (DAILY TRACKING SHEET) RBAC (September 4, 2026) — Preview, all gates green

ROOT CAUSE of the Manager 403: `/api/reports/daily-tracking-sheet` was `Depends(require_admin)`,
while "Track Report" is a primary Manager navigation tab.

FIX (backend only, no frontend change needed — the GP dropdown already uses the scoped
`/api/users/growth-partners`):
- Dependency swapped to `get_current_user` + new `resolve_report_scope(current_user)` in
  `routes/reports.py`, which delegates to `utils.auth.get_user_team_ids` -> `utils.hierarchy`
  (the SAME resolver behind Manager Dashboard, Files list/stats and Team Leaderboard).
  Admin/Ops -> full scope (None) · Manager/TL -> own recursive subtree · HR/regular GP -> 403.
- `resolve_agent_query(user_id, scope_ids=...)` now intersects any requested `user_id` with the
  caller's permitted identifier set and returns `None` to FAIL CLOSED; the endpoint then
  returns `[]`. Scope is never derived from a client-supplied id.
- No separate scoping logic inside the endpoint; alias dedupe / person-level active handling
  unchanged (one row per person).

GATES (preview)
- NEW `/app/scripts/track_report_gate.py` 15/15: admin 19 agents · ops == admin · manager 200
  with 18 people == dashboard members 18 == UM subtree 18 · strict subset of admin · no dupes ·
  in-scope user_id -> 1 row · out-of-scope user_id -> 0 rows · invalid id -> 0 rows (admin too) ·
  TL 12 rows and 0 for out-of-scope · HR 403 · GP 403.
- NEW `/app/scripts/track_report_dynamic_scope.py`: TL Anusha moved under Teja -> track 18->19
  and dashboard 18->19; restored -> 18/18. PASS.
- `verify_hierarchy.py` 34/34 · `fixture_gate.py` 15/15 (preview back to 128 users / 518 leads) ·
  `user_mgmt_audit.py` 10/10 loads + Manager/TL persistence PASS · `acceptance_matrix.py` 30/30 ·
  `files_rbac_matrix.py` green · `trace_manager_scope.py` MATCH: YES (18 = 18 = 18).
- `user_mgmt_audit.py` now RESTORES the original manager_id/tl_id after its write test (it used to
  leave Nithin/Meghana under saikiran@bankezee.com, which silently shrank Teja's subtree 18->16).
  The API drops a manager_id whose document is not role=manager, so the restore falls back to a
  direct Mongo write.
- UI smoke: Manager Teja -> /manager/tracking renders (no 403), GP dropdown scoped to his team.

STATUS: READY TO PUBLISH (everything above plus the earlier A+B / UUID / Manager UI /
User Management / Manager Dashboard hierarchy / Team Leaderboard work is still Preview-only).

### Still blocked on user input
C hierarchy link repair (16 production writes) — `/app/memory/C_dryrun_hierarchy_repair.md`,
to be applied only AFTER this build is published and verified in production.

*Last Updated: September 4, 2026*

## WHATSAPP ICON + DATA LIST WHATSAPP BUTTON (September 4, 2026) — Preview, verified

- NEW `components/icons/WhatsAppIcon.js` — the real WhatsApp brand glyph (SVG). Replaces the
  generic `MessageCircle` chat bubble in every place WhatsApp was offered (Lead detail phone row
  and the Call Now / WhatsApp action pair), brand colour `#25D366`.
- NEW `utils/whatsapp.js` — single `getWhatsAppLink` / `openWhatsApp` (message template + phone
  normalisation incl. legacy float phones like "9705296810.0"). LeadDetail no longer owns a
  private copy.
- Data list: `LeadCard` now shows a WhatsApp button beside the Call button
  (`data-testid="whatsapp-btn-{leadId}"`, both 14 wide). Used by GP Data (/agent/leads) and
  Admin Data (/admin/leads), so both lists get it from the one component.
- Verified in preview: GP Nithin /agent/leads -> 15 WhatsApp + 15 Call buttons; lead detail opens
  `https://api.whatsapp.com/send/?phone=919705380465&text=Hi+Domala+naveen+kumar...`.

## STRUCTURED EXISTING LOANS (up to 5) + ELIGIBILITY INPUT (September 4, 2026) — Preview, verified

Replaced the three free-text "Existing Loan 1/2/3" boxes in File Details with a structured,
repeatable loan block (max 5): **Bank/Lender · Type of Loan · Loan Amount · Sanction Date ·
Outstanding · ROI % · EMI**, with "Add Loan" (hidden at 5) and per-row delete.
- NEW `components/file-detail/ExistingLoansEditor.js` (`data-testid="existing-loans-editor"`,
  `add-existing-loan-btn`, `existing-loan-{n}-{field}`, `remove-existing-loan-{n}`).
  Shows live Total EMI / Total Outstanding; read-only view renders formatted values.
- Stored as `file_details.existing_loans` (array) via the existing
  `PUT /api/files/{id}/details` -> `additional_data` merge. Legacy `existing_loan_1..3` strings are
  never deleted - they render as "Legacy CRM notes (read-only)".
- NOTE: `components/file-detail/ExistingLoansSection.js` was dead code (never imported by the live
  page) - left untouched.

Eligibility calculator now consumes the loan book (`routes/bank_policies.py`):
- `summarize_existing_loans()` rolls up count, unsecured count, total EMI / outstanding /
  sanctioned, highest ROI, high-cost (ROI >= 20%) count.
- Obligations: `existing_emi = max(sum of loan EMIs, declared obligations_emi)`, so FOIR and
  profile strength follow the real loan book. `emi_source` reports "Existing Loans (N)".
- New per-bank rules (source = "Existing Loans"): BT count vs `max_bt_count` (FAIL when exceeded,
  PASS when within), WARN when `bt_allowed` is false, WARN on high-cost/app-loan takeover when
  `app_loan_bt` is false, WARN when total outstanding exceeds the requested amount.
- `profile` now returns `existing_loans_count/_emi/_outstanding/_max_roi/existing_loans`, rendered
  as a loan table in `EligibilityCheck.js` (`data-testid="eligibility-existing-loans"`).
- Verified on preview file 6d194952: 2 loans -> EMI 13,000 / outstanding 2,40,000 / max ROI 36%,
  51 existing-loan-driven rule hits; 5 loans with 4 unsecured -> `emi_source="Existing Loans (5)"`,
  FOIR 28.7, and 5 banks FAIL on BT count (HDFC max 2, IDFC max 3, Kotak max 2...).
  UI: add 2 loans -> save -> reload shows both rows, totals and legacy note. Test data removed.

## USER MANAGEMENT CRUD ARCHITECTURE FIX (September 4, 2026) — Preview, 28/28 + browser gate green

ROOT CAUSE (diagnosed on real data with `/app/scripts/diagnose_user_duplicates.py`, read-only):
duplicates are TWO GENUINE Mongo documents per person — a legacy CRM import (no credential,
`legacy_user_id`, email differing only in letter case) plus the Connect login account
(`password` + `connect_id`). Not aggregation/frontend duplication.
1. `/api/users` emitted every document -> the same employee rendered twice.
2. All Admin writes went through `find_user_by_id()` -> `hierarchy.canonical_doc()`, i.e. the
   PERSON's canonical document. Clicking deactivate/delete on the OLD row therefore wrote the NEW
   Connect document (exactly the Saikiran Masula report) and the clicked row never changed, which
   looked like "delete does nothing".
3. Manager filter was client-side `user.manager_id !== filterManager` on canonical-overridden
   rows, so any legacy document storing a different alias of the same Manager silently vanished;
   page never reset to 1 on filter change.

ARCHITECTURE NOW (person resolution and account CRUD are separate modules):
- `utils/hierarchy.py` (unchanged) = PERSON -> all historical aliases. Reporting/scope only.
- NEW `utils/accounts.py` = ACCOUNT -> exactly one document. `resolve_account()` takes the
  immutable `account_key` (`_id`), falls back to a UNIQUE `id`, returns 409 on an ambiguous `id`
  and 404 on unknown. `own_identifiers()` gives that one account's keys (no alias expansion).
- Reads (`list_users`): one row per PERSON. The row is the current account chosen by evidence
  (active + real credential > active > has connect_id > oldest `_id`), and every document of the
  person is returned in `accounts[]` with its own `account_key`, so a specific legacy account
  stays administrable. Same name + different email = SEPARATE people, never merged: both rows are
  returned and flagged via `possible_duplicates` (Admin decides).
- Filters are server-side: `manager_id` matched through the resolver (alias-aware) and FAIL
  CLOSED (unknown manager -> 0 rows); role/team_lead/is_active/search evaluated on the current
  account. Frontend refetches on every filter change with a request-sequence guard and resets to
  page 1; only search stays client-side.
- Writes (`update_user`, `update_user_role_hierarchy`, `change_user_password`, `toggle_user_active`,
  `delete_user`, `approve_user`, `reject_user`) all use `resolve_account` and assert
  matched/deleted_count == 1, returning `account_key` + counts. No silent success. Manager/TL
  *references* are still canonicalised so parent ids stay consistent for reads.
- UI: row carries `account_key` into every request; "N linked accounts" and "possible duplicate"
  links open panels in the detail modal with per-account Activate/Deactivate/Delete.

GATES
- NEW `/app/scripts/user_mgmt_gate.py` **28/28** with production-shaped fixtures (legacy+Connect
  documents sharing one email, two managers whose reports point at `id` vs `_id` aliases, two docs
  sharing an `id`, two same-name/different-email accounts; all fixtures deleted afterwards):
  one row per person, current account = Connect, both docs exposed, no duplicate rows/emails in
  the roster, A->B->A->clear filter switching incl. `_id`-alias managers, unknown manager -> 0,
  deactivate old -> new untouched (and reverse), edit/manager/TL/password isolation, 409 ambiguous,
  404 unknown, delete removes exactly one document and the row disappears from the filtered view.
- Browser gate (testing agent iteration_43): 11/11 PASS — single Asma row + linked-accounts panel,
  manager switching fires one fresh request per change and REPLACES the list (Teja 8 -> Manmith 0
  -> Teja 8 -> clear 125), status labels stay 31/94, CRUD isolation verified and restored, delete
  of a file-owning user returns 400 with the correct message, unknown `_id` returns 404.
- Existing regression all still green: verify_hierarchy 34/34, fixture_gate 15/15,
  track_report_gate 15/15, acceptance_matrix 30/30, user_mgmt_audit 10/10,
  trace_manager_scope MATCH (18=18=18), files_rbac_matrix green.

REPORTS
- `/app/memory/user_mgmt_duplicates_report.md` (generated by `/app/scripts/user_mgmt_report.py`,
  read-only): before/after table per duplicated person, watch-list names, same-name/different-email
  list, and a DRY-RUN cleanup proposal (only dormant legacy docs owning no leads/files/calls are
  marked safe to delete). Run against production with
  `MONGO_URL=<prod> DB_NAME=<prod> python3 scripts/user_mgmt_report.py`.
- NO production data was modified. No merge/delete executed anywhere.

## FINAL USER MANAGEMENT ACCEPTANCE (September 4, 2026) — 12/12 PASS on preview

New suite `/app/scripts/user_mgmt_acceptance.py` (fixtures created + deleted, no production data
touched) covers the user's exact 12 acceptance lines; all PASS:
one row per person · manager filter switching (A->B->A->B->clear x3 rounds + 10 rapid switches) ·
exact-account deactivate/activate/edit/delete (each reporting account_key + matched/deleted_count=1) ·
Manager & TL assignment persistence · Connect login unaffected · historical alias ownership
unaffected · no false 0-user loads (10/10) · performance (list 0.16-0.35s, filter 0.11-0.20s, UI
first render 2.1s - the old 1-2 minute load is gone).

Two extra fixes made during this acceptance run:
1. **Login hardening** (`routes/auth.py`) - `find_one({"email": ...})` could return the DORMANT
   legacy document when two documents share an email (KeyError on the missing `password`, or a
   bogus "Account is deactivated"). Login now fetches all case-insensitive email matches,
   authenticates against the document whose stored credential actually verifies the password and
   prefers the active one. Proven: fixture Connect login always lands on the Connect `_id`, even
   after the legacy sibling is deactivated; admin/manager/GP logins unaffected.
   (integration_expert consulted before touching auth, per policy.)
2. **Edit Role & Hierarchy modal** showed "Unassigned" / "No Team Lead" for anyone whose parent is
   an acting manager (e.g. Asma -> Gujjari Sai kiran, a telecaller acting as sub-manager) because
   the dropdown only listed role=manager accounts, and `fetchTeamLeads` cleared a valid tl_id on
   load. The modal now injects the current Manager/TL as an option ("- current (acting)") with an
   explanatory note, and no longer wipes tl_id on load. Verified: reopening Edit twice shows
   "Gujjari Sai kiran - current (acting)" and "Yarragonda Anusha - current".

Read-only duplicate report regenerated: `/app/memory/user_mgmt_duplicates_report.md`
(1 duplicated person in this dataset - Asma Sultana; her dormant legacy doc owns 0 leads/files/calls
and is marked SAFE TO DELETE in the DRY RUN only). Production run requires the prod connection:
`MONGO_URL=<prod-uri> DB_NAME=<prod-db> python3 scripts/user_mgmt_report.py`.

Regression after these fixes: user_mgmt_gate 28/28, verify_hierarchy 34/34, track_report_gate 15/15,
acceptance_matrix 30/30. NO cleanup, NO merge, NO production writes performed.

## OLD-CRM BANK ELIGIBILITY WORKFLOW RESTORED + SAVE FIXED (September 4, 2026) — 17/17 backend, browser verified

### TRACE - why Save appeared to do nothing
Endpoint/ID/filter were never the problem: `PUT /api/files/{file_id}/eligibilities` ->
`lead_filter(file_id)` matched 1 document and Mongo was written (HTTP 200). The data loss came from
the SCHEMA:
- `EligibilityEntry` was a subset model with BOOLEAN flags. Pydantic v2 ignores unknown fields, so
  `eligible_roi`, `application_id`, `sm_name`, `sm_number`, `disbursal_date`, `login_done_at`,
  `approved_at`, `rejected_at`, `disbursed_at`, `tvr_done`, `emi_ok`, `rc_submitted`,
  `noc_submitted`, `hypothecation` and every `*_reason` were DROPPED from the payload, and the
  endpoint `$set` the whole array - so a save on a legacy file also wiped the imported values.
- `"yes"` was coerced to `True`, but the UI only renders the next step when the value `=== 'yes'`,
  so after reopening a file everything below "Eligible?" disappeared -> "the information is missing".
Evidence captured: legacy file 6d194952 had 4 banks with the full old schema; one UI-shaped PUT
returned `{"count":1}` and the GET came back with booleans and 22 fields instead of 44 (the file was
restored immediately afterwards).

### FIX
Backend `routes/files_crm.py`:
- `EligibilityEntry` = full old-CRM schema with `extra='allow'` (nothing can ever be dropped again)
  and a `model_validator(mode='before')` that normalises yes/no (bool or string) and numerics
  (`""` -> None), so both legacy and new payloads round-trip unchanged.
- `update_eligibilities` keys existing rows by bank name and stamps `login_done_at`, `approved_at`,
  `rejected_at`, `disbursed_at` only on the transition, preserving them when an unrelated field is
  edited (Reports/TAT depend on them). Commission is computed server-side
  (`disbursed_amount x commission_percentage / 100`) and cleared when a disbursal is reversed, so a
  re-save can never double-credit. Response returns `matched_count`, `modified_count` and the
  persisted array; a non-matching filter now raises instead of reporting success.
Frontend:
- NEW `components/file-detail/BankEligibilityRow.js` - the old-CRM progressive card:
  Step 1 Bank Name + Eligible? (No -> reason only, stop | Yes -> Eligible Amount + Eligible ROI) ->
  Step 2 Login Done? (No -> rejection reason | Yes -> Login Bank, Application ID, SM Name, SM Number
  with SM fields Admin/Ops-only) -> Step 3 Approval (Declined -> Declined Bank + reason | Approved ->
  Approved Bank/Amount/Tenure/ROI) -> Step 3.5 vehicle loans (RC, NOC only for used_vehicle_loan_bt,
  Hypothecation, each with a not-done reason; disbursement stays closed until they are complete) ->
  Step 4 Disbursement (No -> rejection reason | Yes -> date, bank, amount, tenure, ROI, commission %
  and READ-ONLY commission amount). Transition timestamps are shown inline.
- `FileDetailsPage.js`: `normalizeEligibilities` maps legacy booleans to yes/no (and `roi` ->
  `eligible_roi`); Save/Save All persist FIRST and then adopt the backend response (no optimistic
  toast, values retained and an error shown on failure); per-bank Save; delete persists through a
  save; max 7 enforced on both ends.

### GATES
- NEW `/app/scripts/eligibility_gate.py` **17/17 PASS**: 5-bank lifecycle (not eligible / login no /
  declined / approved-not-disbursed / disbursed+commission), 8 banks rejected 400, progressive data,
  commission 850000 x 1.25% = 10625 then 2% = 17000 and cleared on reversal, vehicle RC+NOC+
  hypothecation with all three reasons, timestamps only on transitions, individual + Save All +
  delete persistence via fresh GET and Mongo, a REAL legacy CRM file round-trip that preserved SM /
  application_id / eligible_roi / login_done_at / rejected_at, and Reports (dashboard stats,
  bank-performance, tat-metrics) still calculating - the QA disbursal rolled into bank-performance.
- Browser (testing agent iteration_44 + follow-up): legacy banks render, every conditional branch
  reveals/hides correctly, per-bank Save survives a reload (SM fields, Application ID, ROI, disbursal
  date, commission 7500 read-only, timestamps), delete survives a reload, Add Bank disabled at 7,
  Manager sees SM fields disabled. One CRITICAL bug it found - `onClick={handleSaveEligibilities}`
  passed the click event as the rows argument so Save All threw `rows.filter is not a function` -
  is FIXED (`onClick={() => handleSaveEligibilities()}` + defensive `Array.isArray` guard) and
  re-verified: 2 banks saved with Save All survived a reload, then deleted and the 4 legacy banks
  restored exactly. GP `PUT` still 403, Manager `GET` 200.

## CONSOLIDATED FILE / ELIGIBILITY / STATS FIX (September 4, 2026) — 24/24 gate PASS

1. FILE FILTER - the chip count came from `/api/leads/stats` which ignored the active outcome
   filter and force-set `archived=False, is_invalid=False`, while the list applied the outcome and
   no archive filter -> chip and list described different populations. `/api/leads/stats` now takes
   the same non-status filters (outcome, never_called, dates, archived, is_invalid) and the Data
   page passes the active outcome to it. Verified: chip 515 = list 515 = /leads/count 515, and with
   an outcome filter active they still match; all 515 (legacy + Connect) paginate out.
2. ELIGIBILITY CHECK - file `6a98f51d3f236a1e2c7e7cd7` does not exist in preview (production-only
   record) and returned 404, which the UI rendered as a blank screen. Reproduced with an equivalent
   sparse Connect file: HTTP 200 but 21 banks reported "eligible" from an empty profile. The engine
   now returns `insufficient_data` + `required_missing` (CIBIL / Net Salary / Loan Amount) and the
   UI shows a clear amber "not enough information" banner listing the missing fields.
3/4. MANUAL ELIGIBILITY + SAVE - already restored in the previous task (full old-CRM progressive
   flow, 7 banks max, vehicle conditions, PF/EMI/First EMI kept); re-verified end to end here.
5. FOCUS BUG - `BankEligibilityRow` defined its `Text`/`Choice` inputs as components INSIDE the
   render, so every keystroke created a new component type and React remounted the input, stealing
   focus after one digit. They are now plain rendered elements (`text()` / `choice()` helpers) with
   the row key unchanged (index). Verified in the browser: "1500000" and "10.5" typed continuously,
   focus retained on the field.
6/7. STATS - `dashboard/stats` was adding `file_details.loan_amount_required` to
   total_approved_amount / total_disbursed_amount. It now counts ONE approval/disbursal per file
   from the eligibility rows (with `approved_at` / `disbursed_at` inside the activity window) and
   sums `eligibilities[].approved_amount` / `disbursed_amount`. Pipeline sums
   `eligibilities[].eligible_amount` for rows that are logged in with an application_id, not
   disbursed and not declined. Fixture 15L required / 12L eligible / 10L approved / 8L disbursed
   returns Approved 10,00,000, Disbursed 8,00,000, Pipeline 12,00,000 - never 15L.
8. TIMESTAMPS - unchanged transition-only stamping, re-verified (an unrelated edit does not rewrite
   login_done_at / approved_at / disbursed_at).
9. STAR RATING - replaced the ad-hoc scorer with the exact old CRM formula (salary 30/25/20/15/10/5,
   CIBIL 25/20/15/10/5, CIBIL issues 15/8/0, FOIR 15/12/10/8/5, company type 20/18/10; stars
   90/75/60/45). FOIR falls back to obligations/salary when not stored. `star_manual` overrides are
   preserved (including in the bulk recalculation). `GET /api/files/{id}` returns and self-heals the
   stored rating, details save recalculates it, and the File Details header now shows
   "★★★★★ 5 Star Profile · Score: 90/100". The previously dead "All Stars" dropdown is wired to a new
   `min_star` parameter on the shared Files query builder (all 515 -> 4+ 168 -> 5 51).
10. Dashboard and Reports reconcile from the same eligibility data: approved 12,47,81,130 and
    disbursed 10,59,03,952 identical in `dashboard/stats` and `reports/bank-performance`.
11. COMMISSION - unchanged server-side derivation; saving the same row 4x keeps 12,000 and reversing
    the disbursal clears it.

GATE: NEW `/app/scripts/file_eligibility_stats_gate.py` **24/24 PASS**. Regression: eligibility_gate
17/17, acceptance_matrix 30/30, files_rbac_matrix green, verify_hierarchy 34/34, user_mgmt_gate
28/28. All QA fixtures removed; the legacy file's 4 banks are byte-for-byte intact.

## ELIGIBILITY CHECK ON CONNECT FILES + STARS ON FILE CARDS (September 4, 2026) — verified

ROOT CAUSE of "Check Eligibility does nothing" on Connect-entered files:
`POST /api/bank-policies/check-eligibility/{lead_id}` looked the file up with
`db.leads.find_one({"id": lead_id})` while the Files list exposes `str(_id)` as the id for any
document without an `id` field (which is how several Connect-entered files are stored). The lookup
missed -> HTTP 404 -> the page rendered its empty "Run Eligibility Check" state forever. Fixed by
using the shared `doc_ref_filter()` ID-compatibility helper (same logic as `lead_filter`).
Reproduced with a document keyed only by `_id`: before = 404, after = HTTP 200 with 35 lenders
evaluated (8 eligible) and the full analysis rendering in the browser.

STAR ON THE FILE CARD: the list card read `file.rating`, a field the API never returns, so every
card showed 5 empty stars. The Files list now returns a live `star_rating` / `star_score` per row
(computed with the old-CRM formula, so brand-new Connect files get stars immediately) and the card
renders the filled stars plus the score. Verified: 179 filled stars across 50 rows, e.g. 90/100.

Gates re-run after the change: file_eligibility_stats_gate 24/24, eligibility_gate 17/17,
acceptance_matrix 30/30. QA fixture removed.

## STAR OVERRIDE + BANK NAME PICKER + FILE FILTER RE-VERIFICATION (September 4, 2026)

FILE FILTER: re-tested in the browser on PREVIEW - clicking the "File (514)" chip fires
`GET /leads?page=1&page_size=50&status=file` and the page shows "514 total data" with every row
FILE. The screenshot showing 171,305 with the File chip active is the PRODUCTION build, which does
not yet contain this fix (published build is older). No further code change was needed.

STAR OVERRIDE (new): `PUT /api/files/{file_id}/star-rating` (Admin only) sets
`star_manual`, `star_rating`, `star_override_reason`, `star_override_by/at`, or restores the
automatic score with `{"star_manual": false}`. A reason is mandatory (400 without it) and the rating
must be 1-5. The File header now has a "Set manually" link opening a star picker + reason modal that
also shows the calculated score and the current override author. Verified in the browser:
5 stars (auto, 90/100) -> manual 3 stars with reason -> header shows "3 Star Profile · manual" ->
"Use automatic score" -> back to 5 stars. The bulk recalculation and the details-save recalculation
both skip manual files.

BANK NAME PICKER (new): `GET /api/files/bank-names` returns the CLEAN bank-policy master list
(deliberately not the legacy free-text names, which contain misspellings like "AIDTYA BIRLA" and
"AXI SBANK"). All five bank fields in the eligibility card (Bank Name, Login Bank, Approved Bank,
Declined Bank, Disbursed Bank) are now pickers backed by that list while still accepting a typed
name. Verified: 35 options offered on each row.

Gates after the change: file_eligibility_stats_gate 24/24, eligibility_gate 17/17.
