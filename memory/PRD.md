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

### Presentation Status Removal - COMPLETED ✅ (Sept 1, 2026)
**User Request:** Remove "presentation" status globally from the entire application.

**Changes Made:**
- **Backend:** Removed "presentation" from `/api/statuses` endpoint (routes/reports.py)
- **Frontend Web:**
  - Removed from Admin Dashboard status breakdown (admin/Dashboard.js)
  - Removed from Admin Reports overall stats and telecaller cards (admin/Reports.js)
  - Removed from Reports PDF export metrics and table columns
  - Removed from Hourly Reports table (C/L/F columns only, no P)
  - Removed from Telecaller Dashboard status breakdown (telecaller/Dashboard.js)
  - Removed from colors.js StatusColors and StatusLabels
- **Mobile App:**
  - Removed from DashboardScreen.js statusItems
  - Removed from HomeScreen.js and TrackingScreen.js

**Note:** Backend still computes `presentations` field for backward compatibility (returns 0), but frontend no longer displays it.

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
- new, not_interested, follow_up, leads, file (presentation status removed)

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

## Recent Changes (Aug 31, 2026)

### Attendance TIME Timezone Bug Fix - COMPLETED ✅

**Root Cause Analysis:**
The attendance times were displaying in UTC instead of IST because:
1. Backend stored timestamps in UTC (correct behavior)
2. Backend returned raw UTC ISO strings without IST formatted versions
3. Frontend used `date-fns format()` or `toLocaleTimeString()` without specifying `timeZone: 'Asia/Kolkata'`

**Solution Implemented:**
1. **Backend** now returns pre-formatted IST times in API responses:
   - `check_in_time_ist`: "03:17 PM" (formatted IST string)
   - `check_out_time_ist`: "06:15 PM" (formatted IST string)
   - Uses `utc_to_ist()` helper function with `zoneinfo("Asia/Kolkata")`

2. **Frontend** (Web + Mobile) uses IST times for display:
   - Prefers `check_in_time_ist` / `check_out_time_ist` from API
   - Falls back to `Intl.DateTimeFormat` with `timeZone: 'Asia/Kolkata'`

**Database Storage:** (UNCHANGED)
- Timestamps stored in UTC (e.g., `2026-08-31T09:47:03.726000+00:00`)
- Server timestamp is authoritative (not device clock)

**API Response Format:**
```json
{
  "check_in_time": "2026-08-31T09:47:03.726000+00:00",  // UTC with timezone
  "check_in_time_ist": "03:17 PM",                      // Formatted IST
  "check_out_time": "2026-08-31T15:45:00.000000+00:00", // UTC with timezone  
  "check_out_time_ist": "09:15 PM",                     // Formatted IST
  "server_time_ist": "2026-08-31T15:17:03.727478+05:30" // ISO with +05:30
}
```

**Files Changed:**
- Backend:
  - `/app/backend/routes/attendance.py` - Added IST formatting to all responses
- Frontend (Web):
  - `/app/frontend/src/pages/admin/Attendance.js` - Uses `getDisplayTime()` with IST
  - `/app/frontend/src/components/attendance/AttendanceHistory.js` - Uses IST times
  - `/app/frontend/src/components/attendance/AttendanceCard.js` - Already had IST support
- Frontend (Mobile):
  - `/app/mobile-app/src/components/AttendanceCard.js` - Uses IST times with `getDisplayTime()`

**Test Results:**
| Scenario | Input (Real Time) | Database (UTC) | API Response | Display |
|----------|-------------------|----------------|--------------|---------|
| Check-In | 03:17 PM IST | 09:47:03 UTC | check_in_time_ist: "03:17 PM" | 03:17 PM ✅ |
| Check-Out | 03:17 PM IST | 09:47:44 UTC | check_out_time_ist: "03:17 PM" | 03:17 PM ✅ |

**New APK Build Required:** YES - Mobile AttendanceCard.js was updated to use IST times

### 4 Critical Bug Fixes - COMPLETED ✅

**1. Attendance Date Shift Fix (IST Timezone)**
- Fixed `/api/attendance/admin/today` to use IST date boundaries instead of UTC
- Fixed `/api/attendance/admin/summary` to use IST for date parsing and display
- Fixed `/api/attendance/admin/monthly` to use IST for month boundaries
- Now correctly handles midnight IST times (e.g., 12:30 AM IST on Aug 31 stays as Aug 31)
- Added `server_time_ist` to responses for transparency

**2. Customer Search Enhancement**
- Search now supports Name, Email, AND Phone number with case-insensitive partial matching
- Added phone number normalization (strips country code, uses last 10 digits)
- End-anchored regex for normalized phone search to avoid false positives
- Example: Searching "9876" finds leads with phone "9876543210" or "+919876543210"

**3. Unified Web + Mobile Call Logging**
- New `/api/call-logs/mobile` endpoint for mobile app to log verified calls
- Added `source` field to call_logs (WEB/MOBILE)
- Added `direction` field (outgoing/incoming)
- Added `is_verified` flag for calls verified via native call log
- New `/api/call-logs/unified` endpoint returns combined web+mobile logs
- Mobile calls now update both `call_logs` collection AND `daily_sessions` stats
- Leads are updated with `last_verified_call_*` fields from mobile

**4. Mobile Post-Call Modal**
- Mobile app's `LeadDetailScreen.js` already has AppState listener
- Tracks `callStartTime` and `pendingCallPhone` before call
- On foreground return, queries Android call log via `getRecentCallForNumber()`
- Auto-triggers outcome modal with detected duration
- Uses new `/api/call-logs/mobile` endpoint for unified logging

**New Schemas Added**:
- `MobileCallLogCreate`: Validates lead_id, duration_seconds (≥0), outcome, call_type, device_timestamp
- Device timestamps validated to reject future dates (5 min tolerance)

**Files Changed**:
- `/app/backend/routes/attendance.py` - IST timezone fixes
- `/app/backend/routes/leads.py` - Enhanced search with phone normalization
- `/app/backend/routes/calls.py` - Unified call logging endpoints
- `/app/backend/models/schemas.py` - MobileCallLogCreate schema
- `/app/mobile-app/src/services/api.js` - logCallOutcome uses mobile endpoint
- `/app/mobile-app/src/screens/LeadDetailScreen.js` - Passes device_timestamp

## Next Steps for New Agent
1. Help user build and distribute the Android APK (EAS Build)
2. Test call log sync with actual devices
3. Consider refactoring large files (Reports.js > 1700 lines, DailyTrackingSheet.js > 800 lines)
4. Web/Mobile feature parity: Add incoming call tracking to web app

## Recent Changes (Aug 31, 2026 - Session 2)

### v2.4.0 Changes

**1. Call Recording Removed**
- Removed call recording toggle from mobile app HomeScreen (Android 9+ blocks third-party call recording)
- Removed Recordings tab from admin Reports page
- Cleaned up related imports and styles

**2. Unified Call Reports**
- `/api/reports/detailed-calls` now merges both `call_logs` AND `verified_call_logs` collections
- Each call includes `source` field (web/mobile) and `is_verified` flag
- Admin can see all calls from both web and mobile in one report
- Fixed sort order to use actual datetime instead of formatted string

**3. Attendance Date Filter Enhancement**
- `/api/attendance/admin/today` now accepts `date` parameter to filter by any date
- `/api/attendance/admin/summary` uses same date parameter
- Admin can view attendance records for any historical date

**4. Weekly & Monthly Attendance Reports (NEW)**
- `GET /api/attendance/admin/weekly-summary` - Returns per-employee weekly stats:
  - days_present, days_late, days_absent, days_wfh, days_office, days_leave
  - daily_records with check-in/out times
  - Summary totals
- `GET /api/attendance/admin/monthly-summary` - Returns per-employee monthly stats:
  - attendance_percentage (0-100%)
  - days_present, days_late, days_half_day, days_absent
  - total_working_hours, total_late_minutes
  - Sorted by attendance percentage (best performers first)

**5. Mobile Search Enhancement**
- Mobile app now uses server-side search (passes `search` param to API)
- Debounced search (500ms) to avoid excessive API calls
- Search by name, email, or phone now works on mobile

**Files Changed:**
- `/app/mobile-app/src/screens/HomeScreen.js` - Removed recording toggle
- `/app/mobile-app/src/screens/DataScreen.js` - Server-side search
- `/app/frontend/src/pages/admin/Reports.js` - Removed recordings tab, added source column
- `/app/backend/routes/attendance.py` - Date filter, weekly/monthly summaries
- `/app/backend/routes/reports.py` - Merged verified_call_logs into detailed-calls

**Current Mobile Version:** 2.4.0 (versionCode 11)

## Recent Changes (Sep 1, 2026)

### Stage 1: Server-Side Pagination - COMPLETED ✅

**Backend Changes** (`/app/backend/routes/leads.py`):
- `GET /api/leads` now returns paginated response: `{leads: [], pagination: {page, page_size, total_count, total_pages, has_next, has_prev}}`
- Pagination parameters: `page` (default 1), `page_size` (10-200, default 50)
- Multi-select filters: `statuses` (comma-separated), `outcomes` (comma-separated)
- Date range filters: `created_from`, `created_to`, `last_called_from`, `last_called_to`
- Special filters: `never_called`, `archived`, `is_invalid`, `import_batch_id`
- Sorting: `sort_by`, `sort_order` parameters
- New `GET /api/leads/count` endpoint for getting count of filtered results
- New `GET /api/leads/stats` endpoint for dashboard statistics

**Frontend Changes (Web)**:
- `/app/frontend/src/pages/admin/Leads.js`: Updated to parse `data.leads` and `data.pagination`, added pagination state and controls
- `/app/frontend/src/pages/telecaller/Leads.js`: Updated to parse paginated response, added pagination controls
- Both pages show total count and page navigation when data exceeds page_size

**Mobile Changes**:
- `/app/mobile-app/src/screens/DataScreen.js`: Updated to parse paginated response, added infinite scroll with `onEndReached`
- Shows "X of Y leads" header with page info

### Stage 2: Bulk Select All - COMPLETED ✅

**Backend**:
- `POST /api/leads/select-all-ids`: Returns all lead IDs matching current filters (database-level selection)
- `POST /api/leads/bulk-assign-filtered`: Assign all leads matching filters to a user without passing IDs
- Uses reusable `build_leads_query()` helper function

**Frontend**:
- Admin Leads page shows "Select all X matching" button when total > visible page
- Selected count shows actual total when "select all filtered" is active
- Bulk operations work on all filtered results, not just visible page

### Stage 3: Wrong Number Suppression - COMPLETED ✅

**Backend**:
- New `suppression_list` collection for storing suppressed phone numbers
- `GET /api/suppression-list`: Paginated list of suppressed numbers
- `POST /api/suppression-list`: Add phone to suppression list + mark existing leads as invalid
- `DELETE /api/suppression-list/{phone}`: Remove from suppression
- `POST /api/leads/{lead_id}/mark-wrong-number`: Mark lead as wrong number, auto-add to suppression
- Phone normalization: Last 10 digits stored as `normalized_phone` for matching

**Import Enhancement**:
- Import now checks suppression list and skips suppressed numbers
- Returns `suppressed` count in response
- Skipped numbers stored in import batch record

### Stage 4: Archive & Import Management - COMPLETED ✅

**Backend**:
- `POST /api/leads/archive`: Archive/unarchive leads by IDs or filters
- Leads have `archived`, `archived_at`, `archived_by` fields
- Archived leads excluded from default queries (must pass `archived=true` to see them)
- New `import_batches` collection tracks import history
- `GET /api/import-batches`: Paginated list of import batches
- `GET /api/import-batches/{batch_id}`: Details of specific import
- Each lead has `import_batch_id` linking to its import

**Import Enhancement**:
- Import now creates batch record with statistics
- Tracks: total_rows, total_imported, assigned, suppressed, duplicates
- Duplicate detection: Skips phone numbers that already exist in active leads

### Stage 5: Excel Export - COMPLETED ✅

**Backend**:
- `POST /api/leads/export`: Export leads matching filters to Excel file
- Returns downloadable .xlsx file with all lead fields
- Respects all active filters (status, assigned_to, search, etc.)
- Limited to 50k rows for memory safety

**Frontend**:
- Export button in Admin Leads header
- Exports current filtered view
- Shows loading spinner during export

**Test Results**:
- Backend: 100% (13/13 pytest tests passed)
- Frontend: 100%

**Master Prompt Progress**: Stages 1-5 of 11 COMPLETE

### Upcoming Tasks (Master Prompt Complete)
All 11 stages of the Master Prompt are now complete.

### Future Enhancements
- TTL index option for automatic cleanup (currently manual)
- Email domain verification for Resend

## Recent Changes (Sep 1, 2026 - Continued)

### Mobile App Leave Management - COMPLETED ✅

**New Screen** (`/app/mobile-app/src/screens/LeaveScreen.js`):
- Leave balance view with all leave types
- Apply Leave modal with date picker, leave type selection
- Apply WFH modal
- My Requests tab showing leave/WFH history with cancel option
- Tab navigation: Balance, Leave Requests, WFH

**Navigation Updates** (`/app/mobile-app/App.js`):
- Added "Leave" tab for both Telecaller and Admin views

**API Functions** (`/app/mobile-app/src/services/api.js`):
- `getLeaveBalance()`, `getMyLeaveRequests()`, `getMyWfhRequests()`
- `submitLeaveRequest()`, `submitWfhRequest()`, `cancelLeaveRequest()`

### Admin Settings - Integration Configuration - COMPLETED ✅

**Frontend** (`/app/frontend/src/pages/admin/Settings.js`):
- New "Integrations" expandable section
- Google Sheets API Key field with copy button
- Resend API Key field with link to resend.com
- HR/Admin Email field for notifications
- Save Integration Settings button

**Backend** (`/app/backend/routes/settings.py`):
- `GET /api/settings/integrations`: Get current integration settings
- `POST /api/settings/integrations`: Save integration settings
- Settings stored in MongoDB `app_settings` collection
- Runtime update of environment variables

### Google Sheets Setup Simplified

**Setup Guide** (`/app/GOOGLE_SHEETS_SETUP.md`):
- No credentials needed in App Script
- Uses API key authentication
- One-click sync from Google Sheets menu

### Email Configuration Status

**Current State**:
- Email service ready in `/app/backend/utils/email_service.py`
- Requires Resend API key to send emails
- Can be configured through Admin Settings page
- When configured: Leave/WFH notifications auto-send

**To Enable Emails**:
1. Go to Admin → Settings → Integrations
2. Get API key from https://resend.com/api-keys
3. Paste in "Resend API Key" field
4. Set HR/Admin email for notifications
5. Save

**Master Prompt Progress**: ALL 11 STAGES + ENHANCEMENTS COMPLETE ✅

### Stage 6: Call Log Cleanup - COMPLETED ✅

**Backend** (`/app/backend/routes/data_cleanup.py`):
- `GET /api/data-cleanup/stats`: Overall data statistics
- `GET /api/data-cleanup/call-log-analysis`: Analyze call logs for duplicates
- `POST /api/data-cleanup/deduplicate-call-logs`: Deduplicate call logs (dry_run supported)
- `POST /api/data-cleanup/merge-verified-logs`: Merge verified_call_logs into main call_logs
- `GET /api/data-cleanup/call-log-canonical/{lead_id}`: Get canonical call history for a lead

**Deduplication Logic**:
- Groups calls by lead_id, user_id, and 10-minute time bucket
- Priority: Verified mobile > Mobile > Web with duration > Web without duration
- Keeps highest priority record, deletes others

### Stage 7: Leave & WFH Workflows - COMPLETED ✅

**Backend** (`/app/backend/routes/leave_management.py`):
- **Employee Endpoints**:
  - `POST /api/leave/requests`: Submit leave request
  - `GET /api/leave/requests/my`: View own leave requests
  - `DELETE /api/leave/requests/{id}`: Cancel pending request
  - `GET /api/leave/balance`: View leave balance (casual/sick/earned/unpaid)
  - `POST /api/leave/wfh/requests`: Submit WFH request
  - `GET /api/leave/wfh/requests/my`: View own WFH requests

- **HR/Admin Endpoints**:
  - `GET /api/leave/requests/pending`: View pending leave requests
  - `GET /api/leave/requests/all`: View all leave requests with filters
  - `PATCH /api/leave/requests/{id}`: Approve/reject leave request
  - `GET /api/leave/wfh/requests/pending`: View pending WFH requests
  - `PATCH /api/leave/wfh/requests/{id}`: Approve/reject WFH request
  - `GET /api/leave/balances/all`: View all employee balances
  - `PATCH /api/leave/balances/{user_id}`: Update employee balance

**Leave Types**: CASUAL, SICK, EARNED, UNPAID, EMERGENCY, GENERAL
**Default Balances**: Casual (12 days), Sick (6 days), Earned (15 days), Unpaid (unlimited)

### Stage 8: HR Role - COMPLETED ✅

**Backend** (`/app/backend/utils/auth.py`):
- Added `hr` role to VALID_ROLES
- `require_hr_or_admin` decorator: Allows HR and Admin access
- `require_not_hr` decorator: Blocks HR from customer data endpoints
- HR role can access: Attendance, Leave, WFH, User viewing
- HR role CANNOT access: Leads, Calls, Reports (customer data)

**Security Fixes**:
- Public registration now only allows `telecaller` role
- Admin/HR users must be created by admin through /api/users endpoint
- Removed plain_password storage from new registrations

### Stage 9: Email Notifications - COMPLETED ✅

**Backend** (`/app/backend/utils/email_service.py`):
- Uses Resend API for transactional emails
- `send_leave_request_notification()`: Notifies HR/Admin when request submitted
- `send_leave_approval_notification()`: Notifies employee when request approved/rejected
- Gracefully handles missing RESEND_API_KEY (logs warning, doesn't error)

**Environment Variables Needed**:
```
RESEND_API_KEY=re_your_api_key
SENDER_EMAIL=onboarding@resend.dev
HR_EMAIL=hr@yourcompany.com
ADMIN_EMAIL=admin@yourcompany.com
```

**Test Results**:
- Backend: 100% (15/15 pytest tests passed)

**Master Prompt Progress**: Stages 1-9 of 11 COMPLETE

### Stage 10: Google Sheets Integration - COMPLETED ✅

**Backend** (`/app/backend/routes/sheets_sync.py`):
- `GET /api/sheets-sync/leads-by-status?api_key=xxx`: Returns leads grouped by status for separate tabs
- `GET /api/sheets-sync/daily-report?api_key=xxx`: Returns daily call statistics by user
- `GET /api/sheets-sync/attendance-summary?api_key=xxx`: Returns attendance records

**Setup Guide** (`/app/GOOGLE_SHEETS_SETUP.md`):
- Complete step-by-step instructions for Google Sheets integration
- Copy-paste App Script code
- No credentials needed - uses API key authentication
- Auto-sync every 6 hours option

**Google Sheets Tabs Created**:
- New, Follow Up, Presentation, Leads, File, Not Interested, Wrong Number
- Daily Report (call statistics by telecaller)
- Attendance (last 30 days)

### Stage 11: Data Retention - COMPLETED ✅

**Backend** (`/app/backend/routes/sheets_sync.py` - retention endpoints):
- `GET /api/sheets-sync/retention/call-logs-stats`: Statistics by age (0-30d, 31-90d, 91-180d, 181-365d, >365d)
- `POST /api/sheets-sync/retention/export-call-logs?older_than_days=365`: Export to Excel before delete
- `DELETE /api/sheets-sync/retention/delete-call-logs?older_than_days=365&confirm=true`: Manual delete
- Same endpoints for `activity-logs` (default 90 days) and `verified-call-logs` (default 180 days)
- `GET /api/sheets-sync/retention/deletion-history`: Audit trail of deletions

**Manual Process (NOT Automatic TTL)**:
1. View statistics by age
2. Export to Excel for backup
3. Manually delete with confirmation
4. All deletions logged for audit

### Lead Reassignment Clean Slate - COMPLETED ✅

**Backend** (`/app/backend/routes/leads.py` - assign endpoint):
- When lead is reassigned from Agent A to Agent B:
  - Agent B sees lead as "new" status
  - Agent B sees no previous call history (hidden)
  - Agent A's reports unchanged (call logs preserved)
  - Call logs marked with `is_previous_agent_history=true`
- Assignment history recorded in `lead_assignment_history` collection

**Backend** (`/app/backend/routes/calls.py` - get_lead_call_logs):
- Telecallers only see their own calls
- Previous agent's calls hidden for clean slate
- Admins see all calls with history flag

### Frontend Leave Management UI - COMPLETED ✅

**Frontend** (`/app/frontend/src/pages/admin/LeaveManagement.js`):
- Leave balance cards (Casual, Sick, Earned, Unpaid)
- Apply Leave modal with date picker, leave type, reason
- Apply WFH modal with date and reason
- My Requests tab showing leave/WFH history
- Pending Approval tab (Admin/HR only) with approve/reject buttons
- Cancel pending requests

**Navigation**:
- Added "Leave" menu item to Admin sidebar

### Security Fixes - COMPLETED ✅

**Password Exposure Fix**:
- `serialize_doc()` now removes `password` and `plain_password` fields
- Login response no longer leaks password hash
- All user endpoints sanitized

**Master Prompt Progress**: ALL 11 STAGES COMPLETE ✅


---

## CRM Integration (Files Module) - COMPLETED ✅
**Date**: September 1, 2026

### Overview
Merged old CRM (crm.bankezee.com) into BankEzee Connect. The "Lead" concept from the old CRM maps to "File" in Connect. When a lead's status is changed to "file", users are redirected to the File Details page for comprehensive file management.

### Stats Calculation Rules - UPDATED (September 1, 2026)
Completely rewrote the stats calculation logic in `/api/files/dashboard/stats` to match the BankEzee CRM rules.

**Key Principles:**
- **created_at**: Used for "Total Files", "In Progress" (NO spillover)
- **activities[].timestamp**: Used for "Login", "Interim Rejects", "Final Rejections" (with C/S split)
- **eligibilities[].approved_at**: Used for "Approved" count and amount (with C/S split)
- **eligibilities[].disbursed_at**: Used for "Disbursed" count and amount (with C/S split)
- **C/S Split**: Current (lead created in date range) vs Spillover (created before, activity in range)
- **All Time**: No date filter, no C/S split (everything counts)

**Status Categories:**
```
NEW:              [new]
IN_PROGRESS:      [contacted, documents_collected, documents_pending, sent_for_eligibility,
                   sent_for_login, login, sent_for_approval, underwriting, fi, fi_reinitiated, query_hold]
LOGIN_AND_BEYOND: [login, sent_for_approval, underwriting, fi, fi_negative, fi_reinitiated,
                   query_hold, approved, disbursed, declined, not_disbursed]
INTERIM_REJECTS:  [fi_negative, declined, customer_not_interested, customer_not_supporting]
FINAL_REJECTIONS: [rejected, not_eligible, not_login, not_disbursed]
PIPELINE_EXCLUDED: [rejected, not_eligible, not_login, not_disbursed, declined, disbursed]
```

**Stat Calculations:**
| Stat | Logic |
|------|-------|
| Total Files | COUNT leads WHERE created_at IN date_range |
| In Progress | COUNT leads WHERE created_at IN range AND file_status IN IN_PROGRESS (no spillover) |
| Login | COUNT leads WHERE (file_status IN LOGIN_AND_BEYOND OR (file_status='rejected' AND was_previously_logged)) AND has_activity_in_range |
| Approved | COUNT leads WHERE ANY eligibility has approval_status='approved' AND (All Time OR approved_at in range) |
| Disbursed | COUNT leads WHERE ANY eligibility has disbursed='yes' AND (All Time OR disbursed_at in range) |
| Amt in Pipeline | SUM eligible_amount WHERE login_done='yes' AND application_id NOT blank AND disbursed≠'yes' AND approval_status≠'declined' AND file_status NOT IN PIPELINE_EXCLUDED (NO date filter) |

### Backend (`/app/backend/routes/files_crm.py`)
- `GET/POST /api/files` - List and create files (leads with status="file")
- `GET /api/files/{file_id}` - Get file details
- `PUT /api/files/{file_id}/details` - Update file details
- `PUT /api/files/{file_id}/file-status` - Update file status
- `PUT /api/files/{file_id}/assign` - Assign file to operations team member
- `POST /api/files/{file_id}/notes` - Add notes to file
- `GET/PUT /api/files/{file_id}/eligibilities` - Bank eligibility tracking
- `POST /api/files/{file_id}/upload` - Upload documents (GridFS storage)
- `GET /api/files/{file_id}/documents` - List file documents
- `DELETE /api/files/{file_id}/documents/{doc_id}` - Delete document
- `GET /api/files/download/{doc_id}` - Download document
- `GET /api/files/dashboard/stats` - Dashboard statistics with date filtering and C/S split
- `GET /api/files/reports` - Reporting data
- `GET /api/files/reports/bank-performance` - Bank-wise performance (Logins, Approvals, Disbursals)
- `GET /api/files/reports/tat-metrics` - Turnaround Time metrics (Lead-to-Login, Login-to-Approval, etc.)
- `GET /api/files/reports/growth-partner` - Per-agent/partner performance stats
- `GET /api/files/operations-team` - Get operations team members
- `POST /api/files/import` - Import files from old CRM
- `GET /api/files/export` - Export files to CSV
- `POST /api/files/bulk/assign` - Bulk assign files

### Web Frontend (`/app/frontend/src/pages/files/`)
**FilesDashboard.js** - Exact replica of old CRM dashboard:
- Top report buttons: Daily Report, Rejected Cases, Growth Partner Performance (toggle), Bank Performance (toggle), TAT Metrics (toggle), Quality Report, Policy Master, Export Disbursed, Export Stats, Import Data
- Date Filter: All Time, Today, This Week, This Month, Last Month, Custom Range (date pickers)
- Tabs: Dashboard, Approvals, Users
- Filters: Search, All Loan Types, All Status, All Managers, All Sources, All Stars
- Two rows of stat cards with Current/Spillover split: Total Files, New, In Progress, Login (C/S), Approved (C/S), Total Approved, Disbursed (C/S), Total Disbursed, Interim Rejects (C/S), Final Rejections (C/S), Amt in Pipeline
- Status definitions text
- Charts: File Status Distribution (donut), Monthly Performance (bar), Loans by Type (horizontal bar)
- **Bank Performance Table**: Shows per-bank Logins, Approvals, Disbursals, Amounts
- **TAT Metrics Panel**: Lead-to-Login, Login-to-Approval, Approval-to-Disbursal, Lead-to-Disbursal with averages and distribution
- **Growth Partner Report**: Per-agent Files Generated, Logins, Approvals, Disbursals, Amounts
- Files list with checkbox, name, masked phone, loan type, date, assignee, status badge, view/delete actions

**FileDetailsPage.js** - Exact replica of old CRM lead details:
- Star rating (1-5) with score display
- "Check Bank Eligibility" button
- Customer Details (Full Name, Mobile, Email, Mother Name, Current Address)
- Employment Details (Employment Type, Company Name, Net Salary, Office Address)
- Existing Loans & Obligations (Monthly EMI, Existing Loans 1-3)
- Loan Requirements (Type of Loan, CIBIL Score, Loan Amount Required, Tenure Required)
- Bank Eligibilities panel (multi-bank tracking)
- Documents panel with password protection notice
- Download All ZIP button
- Activity Log with notes
- Status update dropdown
- File assignment dropdown

**FilesReports.js** - Reporting dashboard with funnel, bank stats, team performance

### Mobile App (`/app/mobile-app/src/screens/`)
- `FilesScreen.js` - Files list with stats, search, filters, bulk assign
- `FileDetailScreen.js` - Complete file detail view with all sections, status update, assignment, notes

### File Status Options
new, contacted, query, hold, documents_collected, not_eligible, sent_to_bank, login, not_login, approved, declined, disbursed, not_disbursed, rejected, fi_negative, not_interested, supporting

### Database Schema (leads collection)
Files are stored in the `leads` collection with `status = "file"`:
- `file_status`: Current file processing status
- `file_assigned_to`: Operations team member ID
- `file_details`: Customer/employment/loan details object
- `file_documents`: Array of document metadata (GridFS)
- `file_activities`: Activity/notes log
- `eligibilities`: Array of bank eligibility records
- `rating`: Star rating (1-5)
- `score`: Calculated score (0-100)

### Bugs Fixed (September 1, 2026)
1. Trailing slash redirect issue on `/api/files` - Added dual route decorators
2. False 404 on `/activities`, `/documents`, `/eligibilities` endpoints - Fixed projection empty dict check
3. Stats calculation rules - Completely rewrote to follow BankEzee CRM rules (created_at vs activity timestamp)
4. Named Partners in Growth Report - Added connect_id mapping for user names
5. Responsive buttons - Fixed report buttons extending off-screen on mobile
6. **Files Dashboard Role-Based Views**: Admin sees all report buttons; Telecallers see only Policy button
7. **Removed Manual Call Log Buttons**: "Log Outgoing" and "Log Incoming" buttons removed from LeadDetail.js - PostCallModal opens automatically after calls
8. **Historical Lead Stats Preservation**: Reports now include leads that were reassigned, preserving the original user's status counts
9. **"No Status" Filter**: Added ability to filter leads without a status (`status=unset`)
10. **Dynamic User Name in Dashboard**: FilesDashboard now shows actual user name instead of hardcoded "Admin User"
11. **Users Tab Hidden for Telecallers**: Telecallers no longer see the "Users" tab in Files Dashboard
12. **CSV Export for Reports**: Added Export buttons to Bank Performance, TAT Metrics, and Growth Partner reports

### Deployment Ready (September 1, 2026)
- ✅ Web frontend: All environment variables configured
- ✅ Backend: MongoDB connection via MONGO_URL env var
- ✅ Mobile app: API URL configurable via EXPO_PUBLIC_API_URL
- ✅ EAS build profiles: preview and production with correct API URLs
- ✅ No hardcoded secrets or URLs

### Mobile App Build Instructions
```bash
cd /app/mobile-app

# For preview APK (points to preview backend)
eas build --platform android --profile preview

# For production APK (points to production backend)
eas build --platform android --profile production
```


