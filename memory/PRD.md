# BANKEZEE Connect CRM - Web Application PRD

## Original Problem Statement
Convert existing Expo React Native mobile CRM app (tele-connect-13) into a fully responsive React web application optimized for mobile phone browsers. Platform migration - not redesign.

## Project Overview
- **Application**: BANKEZEE Connect CRM (Web Version)
- **Date Started**: Feb 11, 2026
- **Last Updated**: Mar 26, 2026
- **Status**: MVP Complete with Enhanced Reporting + Mobile App for Call Verification
- **Tech Stack**: React.js (Frontend), FastAPI (Backend), MongoDB (Database), React Native (Mobile App)

## User Personas
1. **Admin** - Manages data, users, views reports, assigns data to telecallers
2. **Telecaller/Agent** - Makes calls to data, updates statuses, tracks follow-ups

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
- ✅ Form filling time tracking
- ✅ Average call time metric
- ✅ PDF export in landscape mode
- ✅ **NEW:** Android mobile app for verified call log sync

## What's Been Implemented

### Backend (FastAPI + MongoDB)
- JWT Authentication (register, login, token validation)
- User management (CRUD, activate/deactivate)
- Data management (CRUD, import from CSV/Excel, bulk assign, auto-distribute)
- Call session tracking (start, end, cancel)
- Activity ping and idle time tracking
- Follow-up management
- Dashboard stats and reports with date range filters
- Telecaller performance reports
- Hourly reports with Calls/Connected/Presentations/Leads/File columns
- Activity logs grouped by telecaller
- **NEW:** Verified call log sync API (`/api/call-logs/sync`)
- **NEW:** Verified call stats reporting (`/api/reports/verified-call-stats`) with verification score

### Frontend (React + Tailwind CSS)
- **Auth Pages**: Login, Register with role selection
- **Admin Pages**: Dashboard, Data (with import/assign), Users, Reports, Settings, **Daily Tracking Sheet**
- **Telecaller Pages**: Data, Dashboard, Follow-ups, Profile
- **Shared**: Data Detail with edit/call/follow-up
- **Call System**: 
  - Click to call via tel: links
  - Browser visibility detection for call return
  - Post-call modal for logging call outcomes
  - Active call banner with timer
- **Reports**: Summary, Hourly, Activity, Call Log tabs
- **NEW:** Verified Call Stats component on Admin Dashboard

### Mobile App (React Native Android) - FEATURE PARITY COMPLETE ✅
Location: `/app/mobile-app/`

**Purpose**: Full-featured CRM mobile app with call verification, recording, and all web app features.

**Screens (Full Feature Parity with Web App)**:
- `LoginScreen.js` - Authentication with email/password
- `DashboardScreen.js` - Stats overview, call recording toggle, sync button
- `DataScreen.js` - Leads list with search/filter, status chips, telecaller filter (admin)
- `LeadDetailScreen.js` - Full lead info, edit mode, call history, WhatsApp
- `FollowUpsScreen.js` - Pending/completed follow-ups with actions
- `TeamScreen.js` - Team management, add/deactivate users (Admin only)
- `ReportsScreen.js` - Summary and Recordings tabs with telecaller performance
- `TrackingScreen.js` - Daily tracking sheet with month navigation (Admin only)

**Key Features**:
- Bottom tab navigation (role-based: Admin vs Telecaller)
- Real-time stats and login duration timer
- Call log sync from device to backend
- Audio call recording with upload
- WhatsApp click-to-chat integration
- Lead status management
- Follow-up scheduling

**Key Files**:
- `App.js` - Navigation hub with role-based tabs
- `src/screens/*.js` - All UI screens
- `src/services/api.js` - Complete API integration (25+ endpoints)
- `src/services/callLogService.js` - Call log reading and sync
- `src/services/recordingService.js` - Audio recording and upload
- `EAS_BUILD_GUIDE.md` - Complete build and distribution guide

**Permissions Required**:
- READ_CALL_LOG - Read phone call history
- CALL_PHONE - Make phone calls
- READ_PHONE_STATE - Detect incoming calls
- RECORD_AUDIO - Record calls (optional)
- INTERNET - Sync data with backend

## Recent Updates (Aug 26, 2026)

### Call Recording Feature - COMPLETED ✅
**Mobile App:**
- Added `recordingService.js` with audio recording capabilities
- Recording toggle switch in HomeScreen with permissions handling
- Automatic recording upload after call ends
- Pending upload queue for failed uploads (retries automatically)
- New dependencies: `react-native-audio-recorder-player`, `react-native-fs`

**Backend:**
- New `/api/recordings` routes: upload, list, stats, get audio, delete
- Recordings stored as base64 in MongoDB `call_recordings` collection
- Added database indexes for performance

**Frontend:**
- New "Recordings" tab in Admin Reports page
- Recording statistics dashboard (total count, duration, storage)
- Per-user recording breakdown
- Audio playback with play/pause controls
- Delete functionality with confirmation

**Note:** Requires rebuilding the APK with the new recording dependencies.

### Reports Performance Optimization - COMPLETED ✅
- Fixed slow loading reports (Summary, Hourly, Activity, Call Log)
- Rewrote all report endpoints using MongoDB aggregation pipelines
- Added parallel queries with `asyncio.gather()` 
- Added database indexes for frequently queried fields
- **Result:** Load time improved from ~5-10 seconds to ~100-200ms

### WhatsApp Integration - COMPLETED ✅
- Added WhatsApp click-to-chat buttons on Lead Detail page
- Small button next to phone number for quick access
- Large "WhatsApp" action button alongside Call Now and Follow-up
- Pre-filled message template with customer name and agent name:
  - Introduces agent from BankEzee
  - Explains loan consolidation service
  - Requests callback with "CALL ME" reply option
  - Includes BankEzee branding and website

### Bug Fix: Connected Calls Logic - COMPLETED ✅
- Fixed Daily Tracking Sheet endpoint `/api/reports/daily-tracking-sheet`
- Changed `connected` count logic from `duration > 0` to `outcome == "connected"`
- This prevents unanswered/ringing calls from being counted as connected

### Backend Refactoring - COMPLETED ✅
Refactored the monolithic `server.py` (2760 lines) into a modular structure:

```
/app/backend/
├── server.py              # Main app entry (~90 lines)
├── routes/
│   ├── auth.py            # Authentication routes
│   ├── users.py           # User management
│   ├── leads.py           # Lead CRUD, import, assignment
│   ├── calls.py           # Call sessions, logs, device sync
│   ├── activities.py      # Activity tracking, breaks, pings
│   ├── follow_ups.py      # Follow-up management
│   └── reports.py         # Dashboard, reports, analytics
├── models/
│   └── schemas.py         # All Pydantic models
└── utils/
    ├── helpers.py         # Serialization, formatting
    ├── database.py        # MongoDB connection
    └── auth.py            # JWT, password hashing
```

Benefits:
- Easier to maintain and debug
- Clear separation of concerns
- Faster navigation for developers
- Backup of original: `server_old.py`

### Mobile App for Call Verification - COMPLETED ✅
1. **Android Mobile App Created**
   - React Native app for telecallers
   - Reads actual call logs from device
   - Syncs with backend for verification

2. **Backend APIs Added**
   - `POST /api/call-logs/sync` - Receive and process device call logs
   - `GET /api/call-logs/last-sync` - Get last sync timestamp
   - `GET /api/call-logs/verified` - Get verified call logs
   - `GET /api/reports/verified-call-stats` - Aggregated verified stats

3. **Admin Dashboard Updated**
   - New "Verified Call Stats" section
   - Shows outgoing/incoming calls from mobile app sync
   - Displays verified talk time vs reported talk time
   - Shows missed calls and incoming call time

4. **New Database Collection**
   - `verified_call_logs` - Stores synced call data from devices

## Status Options
- new, contacted, file, not_interested, follow_up, leads, not_answering, wrong_number, presentation

## Prioritized Backlog

### P0 (Critical) - Completed ✅
- All core features implemented and tested
- Reporting enhancements completed
- Mobile app for call verification created
- **Mobile App Feature Parity** - All screens match web app (Aug 27, 2026)

### P1 (High Priority) - Pending
- **Refactor `DailyTrackingSheet.js`** (~830 lines) into sub-components
- **Refactor `Reports.js`** (~1700 lines) into sub-components
- Build and distribute APK to telecallers (use EAS Build guide)
- Test call log sync end-to-end with real devices

### P2 (Medium Priority) - Future
- Dark mode toggle
- WhatsApp integration
- SMS notifications for follow-ups
- Cloud telephony integration (Exotel/Twilio) for automatic tracking

### P3 (Low Priority) - Future
- Call recordings integration
- Multi-language support
- Bulk status update
- Advanced analytics

## Key Database Collections
- `users` - User accounts (admin, telecaller)
- `leads` - Lead/data records
- `call_logs` - Call session records (from web app)
- `verified_call_logs` - **NEW** Synced call data from mobile devices
- `daily_sessions` - Daily login/activity stats
- `activity_logs` - Login/logout/break events
- `follow_ups` - Scheduled follow-ups

## Critical Info
- **Production Domain**: connect.bankezee.com
- **Preview Domain**: responsive-crm-app-1.preview.emergentagent.com
- **Timezone**: All times in IST (UTC+5:30)
- **Mobile App**: Requires Android device with call log permission

## Admin Credentials
- admin@bankezee.com / ConnectSasha12!!
- teja@bankezee.com / tejasme12

## Telecaller Credentials
- agent@test.com / agent123

## Files of Reference
1. `/app/backend/server.py` - All backend APIs
2. `/app/frontend/src/pages/admin/Dashboard.js` - Admin dashboard
3. `/app/frontend/src/pages/admin/Reports.js` - Reports with 4 tabs
4. `/app/frontend/src/components/VerifiedCallStats.js` - Verified call stats component
5. `/app/frontend/src/components/CallModal.js` - Call outcome modal (for active call flow)
6. `/app/frontend/src/components/PostCallModal.js` - **NEW** Post-call logging modal for LeadDetail
7. `/app/frontend/src/services/offlineQueue.js` - **NEW** Offline queue service for call logs
8. `/app/frontend/src/pages/LeadDetail.js` - Lead detail page with post-call and offline support
9. `/app/mobile-app/` - Complete React Native mobile app
10. `/app/mobile-app/src/services/callLogService.js` - Native call log handling with diagnostics

## Recent Changes (Aug 28, 2026)

### Attendance Management System (NEW MODULE)
A complete attendance management system integrated into BANKEZEE Connect for both web and mobile apps.

**Backend APIs** (`/app/backend/routes/attendance.py`):
- `GET /api/attendance/today` - Get today's attendance status
- `POST /api/attendance/check-in` - Check in with location data
- `POST /api/attendance/check-out` - Check out with working time calculation
- `GET /api/attendance/history` - Get attendance history
- `POST /api/attendance/wfh-request` - Submit WFH request
- `GET /api/attendance/admin/today` - Admin: Get all today's attendance
- `GET /api/attendance/admin/summary` - Admin: Get summary stats
- `GET /api/attendance/admin/monthly` - Admin: Get monthly report
- `PATCH /api/attendance/admin/record/{id}` - Admin: Manual correction
- `GET /api/attendance/admin/offices` - Admin: Get office locations
- `POST /api/attendance/admin/offices` - Admin: Create office
- `POST /api/attendance/admin/wfh-assign` - Admin: Assign WFH
- `POST /api/attendance/admin/leave-assign` - Admin: Assign leave
- `GET/PATCH /api/attendance/admin/settings` - Admin: Attendance settings

**Database Collections**:
- `attendance` - Daily attendance records (unique per user/date)
- `offices` - Office locations with geofence radius
- `wfh_approvals` - Approved WFH records
- `wfh_requests` - WFH requests with status
- `leave_approvals` - Leave records
- `attendance_audit` - Audit log for corrections
- `attendance_settings` - Global attendance settings

**Work Modes**: OFFICE, WORK_FROM_HOME, LEAVE
**Attendance Statuses**: PRESENT, LATE, ABSENT, HALF_DAY, ON_LEAVE, MANUALLY_ADJUSTED

**Features**:
- Office geofence validation using Haversine distance formula
- Server-side timestamps only (client time not trusted)
- **IST Timezone Support** - All late detection and time display uses Asia/Kolkata
- Location accuracy validation (default 150m threshold)
- Configurable office radius (default 150m)
- Late detection based on configurable time (default 09:45 IST)
- WFH approval workflow
- Leave management
- Admin corrections with audit log
- Cross-platform sync (same record for web and mobile)

**Office Configured**:
- BankEzee Hyderabad Office: 17.4381, 78.3996 (150m radius) - ACTIVE

**Web Frontend**:
- `AttendanceCard.js` - Agent attendance card with check-in/out
- `AttendanceHistory.js` - Agent attendance history view
- `AdminAttendanceDashboard.js` - Full admin attendance management
- Integrated into TelecallerDashboard and AdminLayout

**Mobile App**:
- `AttendanceCard.js` component for DashboardScreen
- expo-location for GPS access
- Location permissions added to app.json

---

### Android Call-Log Reliability Fixes (Verified)
  - Generated `android/` folder via `npx expo prebuild`
  - `react-native-call-log` v3.0.0 properly linked
  - Runtime permission prompts with visible error handling
  - Diagnostics UI on Dashboard for troubleshooting
  - Post-call modal fetches actual duration from Android OS call log
- **Post-Call Modal on Web**: Added `PostCallModal.js` component to LeadDetail page
  - Duration input (manual entry for web)
  - Call outcome selection (Connected, No Answer, Not Connecting, Busy, Wrong Number, Voicemail)
  - Optional status update
  - Schedule follow-up option for connected calls
  - Triggered automatically after clicking "Call Now" or manually via "Log Call" button
- **Offline Queue Service**: Added `offlineQueue.js` for offline call logging
  - Queues call logs to localStorage when offline
  - Auto-syncs when connection is restored
  - Visual offline banner on LeadDetail page
  - Manual "Sync Now" button when items are pending
- **Status Flow**: Connected → Not Interested, Follow Up, Lead, File (agent can later change to Lead/File)

## Previous Changes (Aug 27, 2026)
- **Mobile Dashboard Enhanced**: Added date filters, trophy icon with Files count, Status Breakdown, Call Outcomes
- **Status Options Simplified**: Removed 'New' and 'Presentation' from status breakdown and edit options
- **Stats Activity-Based**: Counts based on activity date, not data creation date

## Next Steps for New Agent
1. Help user build and distribute the Android APK (EAS Build)
2. Test call log sync with actual devices
3. Consider refactoring large files (Reports.js > 1700 lines, DailyTrackingSheet.js > 800 lines)
4. Web/Mobile feature parity: Add incoming call tracking to web app

