# BANKEZEE Connect CRM - Web Application PRD

## Original Problem Statement
Convert existing Expo React Native mobile CRM app (tele-connect-13) into a fully responsive React web application optimized for mobile phone browsers. Platform migration - not redesign.

## Project Overview
- **Application**: BANKEZEE Connect CRM (Web Version)
- **Date Started**: Feb 11, 2026
- **Last Updated**: Sep 02, 2026
- **Status**: MVP Complete with CRM Integration + Mobile App for Call Verification
- **Tech Stack**: React.js (Frontend), FastAPI (Backend), MongoDB (Database), React Native (Mobile App)

## User Personas
1. **Admin** - Manages data, users, views reports, assigns data to Growth Partners
2. **Growth Partner (formerly Telecaller)** - Makes calls to data, updates statuses, tracks follow-ups
3. **Ops** - Processes Files in the CRM workflow

## Core Requirements (Static)
- ✅ Admin & Agent authentication (JWT-based)
- ✅ Admin dashboard with stats (Total Data, Connected, Leads Generated, File)
- ✅ Agent dashboard with personal stats (calls, talk time, idle time)
- ✅ Data management (CRUD, import/export, bulk operations)
- ✅ User management for admins
- ✅ Call tracking system with browser-based call detection
- ✅ Follow-up scheduling and tracking
- ✅ Reports and analytics with hourly and activity tracking
- ✅ Status updates for data items
- ✅ Mobile-first responsive design
- ✅ Detailed call log report with CSV export
- ✅ Android mobile app for verified call log sync
- ✅ **NEW Sep 2026:** Complete CRM Files integration
- ✅ **NEW Sep 2026:** File Reassignment Block (server-side enforcement)
- ✅ **NEW Sep 2026:** Terminology update (Telecaller → Growth Partner)
- ✅ **NEW Sep 2026:** Call Outcome filters on Data page

## What's Been Implemented (Sep 02, 2026)

### Critical Business Logic
1. **File Reassignment Block** - COMPLETE
   - Files (status='file') CANNOT be reassigned via `/api/leads/assign` or auto-distribute
   - Server-side enforcement returns `skipped_files` array
   - Protects Growth Partner attribution for converted customers

2. **Reassignment Clean Slate** - COMPLETE
   - When pre-File data is reassigned, it resets to status='new'
   - Previous GP's call history preserved but marked as `is_previous_agent_history`
   - Assignment history recorded for audit trail

3. **Historical Report Preservation** - COMPLETE
   - Activity ownership snapshotted at event time (not current assigned_to)
   - Reassignment does NOT alter historical report counts
   - Daily/Growth Partner reports use activity performer attribution

### Terminology Update - COMPLETE
- ✅ Users page: "Growth Partners (X)" instead of "Telecallers"
- ✅ Dashboard: "All Growth Partners", "Active Growth Partners"
- ✅ Reports: "Growth Partner" in CSV headers and filters
- ✅ Leads page: "Assign to Growth Partner" modal
- ✅ Registration: "Growth Partner Registration"
- ✅ VerifiedCallStats: Updated empty-state text

### Files Dashboard Reports - COMPLETE (with Auth)
1. **Daily Report** - `/api/files/reports/daily` - Today's activities summary
2. **Rejected** - `/api/files/reports/rejected` - Rejected/declined Files list
3. **Growth Partner** - `/api/files/reports/growth-partner` - Per-GP performance
4. **Bank Performance** - `/api/files/reports/bank-performance` - Bank-wise stats
5. **TAT Metrics** - `/api/files/reports/tat-metrics` - Turnaround time analysis
6. **Quality** - `/api/files/reports/quality` - Data quality scores

### Data Page Enhancements
- ✅ Call Outcome filters (Connected, No Answer, Switched Off, etc.)
- ✅ "Never Called" filter for leads without any call activity
- ✅ "No Status" filter for leads with null status

### Android Mobile App
- ✅ EAS configuration with `cli.appVersionSource: local`
- ✅ Native call log tracking preserved
- ✅ Build guide at `/app/mobile-app/EAS_BUILD_GUIDE.md`

## Prioritized Backlog

### P0 - Critical (Before Production)
- [ ] Verify production database connection (published app should show 164k+ records)
- [ ] Complete EAS APK build and test
- [ ] End-to-end acceptance tests (Scenarios A-AK)

### P1 - High Priority
- [ ] Refactor FilesDashboard.js (currently ~1900 lines) into smaller components
- [ ] Import/Export functionality parity with old CRM

### P2 - Future Enhancements
- [ ] Policy Master configuration UI
- [ ] Document preview inline
- [ ] Mobile app Files workflow

## Test Credentials
- Admin: `admin@bankezee.com` / `ConnectSasha12!!`
- See `/app/memory/test_credentials.md` for additional accounts

## Code Architecture
```
/app/
├── backend/
│   ├── routes/
│   │   ├── auth.py          # JWT authentication
│   │   ├── leads.py         # Connect Data + File Reassignment Block
│   │   ├── files_crm.py     # Files CRM + All reports endpoints
│   │   ├── users.py         # User management
│   │   ├── reports.py       # Call reports and analytics
│   │   └── calls.py         # Call session management
│   ├── utils/
│   │   ├── auth.py          # Auth decorators (get_current_user, require_admin)
│   │   └── database.py      # MongoDB connection
├── frontend/
│   └── src/
│       ├── pages/
│       │   ├── admin/       # Dashboard, Leads, Users, Reports
│       │   ├── files/       # FilesDashboard, PolicyMaster
│       │   └── telecaller/  # Growth Partner views
│       ├── layouts/         # AdminLayout, TelecallerLayout
│       └── components/      # Shared components
├── mobile-app/
│   ├── android/             # Native Android code (DO NOT DELETE)
│   └── eas.json             # EAS build configuration
```

## API Endpoints Summary

### Data/Leads
- `GET /api/leads` - List leads with filters (status, outcome, assigned_to)
- `POST /api/leads/assign` - Assign leads (blocks Files)
- `POST /api/leads/auto-distribute` - Auto-distribute (excludes Files)
- `POST /api/leads/check-reassignment` - Check which leads can be reassigned
- `GET /api/leads/{id}/assignment-history` - Assignment audit trail

### Files Reports (All require authentication)
- `GET /api/files/reports` - Overview with disbursement analytics
- `GET /api/files/reports/daily` - Today's activity summary
- `GET /api/files/reports/rejected` - Rejected Files list
- `GET /api/files/reports/quality` - Data quality metrics
- `GET /api/files/reports/growth-partner` - Per-GP performance
- `GET /api/files/reports/bank-performance` - Bank-wise stats
- `GET /api/files/reports/tat-metrics` - Turnaround time analysis
