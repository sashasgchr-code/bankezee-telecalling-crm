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

### Policy & Eligibility
16. **Policy Master** - 27 banks with 40+ fields each
17. **Eligibility Check** - Auto-check against bank policies
18. **Multi-bank Processing** - Login/Approval/Decline/Disbursal per bank

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
31. **More Bottom Sheet** - Reports, Users, Attendance, Leave, Logout
32. **GP Attendance Page** - Monthly matrix with check-in/out

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
- Roles now recognized as GP: telecaller, sales_agent, team_leader, partner, manager
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
| manager | Manager | Team management, sees only their team's records |
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
- RBAC Phase 2: Server-side endpoint enforcement (Manager/TL scoped queries)
- RBAC Phase 3: TL Team tabs (My Team, Team Data, Team Files, Team Calls)
- RBAC Phase 4: Role-adaptive navigation (hide menus based on role)
- HR-specific views: Attendance/Leave only, no CRM access

---

*Last Updated: September 2, 2026*
*Status: PRODUCTION LIVE*
