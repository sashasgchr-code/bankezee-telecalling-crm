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

*Last Updated: September 3, 2026*
*Status: PRODUCTION LIVE*
