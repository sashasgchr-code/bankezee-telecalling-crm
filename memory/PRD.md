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
- **NEW:** Verified call stats reporting (`/api/reports/verified-call-stats`)

### Frontend (React + Tailwind CSS)
- **Auth Pages**: Login, Register with role selection
- **Admin Pages**: Dashboard, Data (with import/assign), Users, Reports, Settings
- **Telecaller Pages**: Data, Dashboard, Follow-ups, Profile
- **Shared**: Data Detail with edit/call/follow-up
- **Call System**: 
  - Click to call via tel: links
  - Browser visibility detection for call return
  - Post-call modal for logging call outcomes
  - Active call banner with timer
- **Reports**: Summary, Hourly, Activity, Call Log tabs
- **NEW:** Verified Call Stats component on Admin Dashboard

### Mobile App (React Native Android) - NEW
Location: `/app/mobile-app/`

**Purpose**: Automatically read and sync device call logs to verify actual call durations and track incoming calls from assigned leads.

**Features**:
- Login with telecaller credentials
- View assigned leads
- Click-to-call functionality
- **Automatic call log sync** from device to backend
- Matches synced calls with assigned leads
- Tracks incoming calls from leads
- Background sync capability

**Key Files**:
- `App.js` - Main entry point
- `src/screens/LoginScreen.js` - Telecaller login
- `src/screens/HomeScreen.js` - Lead list and stats
- `src/services/api.js` - API communication
- `src/services/callLogService.js` - Call log reading and sync
- `android/` - Android build configuration
- `BUILD_GUIDE.md` - Complete build and distribution guide

**Permissions Required**:
- READ_CALL_LOG - Read phone call history
- CALL_PHONE - Make phone calls
- READ_PHONE_STATE - Detect incoming calls
- INTERNET - Sync data with backend

## Recent Updates (Mar 26, 2026)

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

### P1 (High Priority) - Pending
- **Refactor `server.py`** (>2500 lines) into modular routers
- **Refactor `Reports.js`** (>1700 lines) into sub-components
- Build and distribute APK to telecallers
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
5. `/app/frontend/src/components/CallModal.js` - Call outcome modal
6. `/app/mobile-app/` - Complete React Native mobile app

## Next Steps for New Agent
1. Help user build and distribute the Android APK
2. Test call log sync with actual devices
3. Consider refactoring large files (server.py, Reports.js)
