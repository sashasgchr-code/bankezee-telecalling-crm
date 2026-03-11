# BANKEZEE Connect CRM - Web Application PRD

## Original Problem Statement
Convert existing Expo React Native mobile CRM app (tele-connect-13) into a fully responsive React web application optimized for mobile phone browsers. Platform migration - not redesign.

## Project Overview
- **Application**: BANKEZEE Connect CRM (Web Version)
- **Date Started**: Feb 11, 2026
- **Last Updated**: Mar 11, 2026
- **Status**: MVP Complete with Enhanced Reporting
- **Tech Stack**: React.js (Frontend), FastAPI (Backend), MongoDB (Database)

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
- **NEW:** Hourly reports with Calls/Connected/Presentations/Leads/File columns
- **NEW:** Activity logs grouped by telecaller

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

### Recent Updates (Mar 11, 2026)

#### Reporting Enhancements - COMPLETED ✅
1. **"File" Status Replaces "Interested"**
   - Updated `/api/statuses` endpoint
   - Updated Admin and Telecaller dashboards
   - Updated all status dropdowns (LeadDetail.js, Admin Leads.js, Telecaller Leads.js)
   - Updated constants/colors.js StatusColors and StatusLabels

2. **Hourly Report Columns Updated**
   - Now shows: Hour, Calls, Connected, Presentations, Leads, File
   - Both overall summary and per-telecaller breakdown have table format
   - Backend aggregates data by hour with new status fields

3. **Telecaller Card Layout Restructured**
   - Expanded telecaller cards in Summary tab now match Overall Performance layout
   - Shows 6 columns: Calls, Leads, File, Presentations, Talk Time, Conversion

4. **Activity Logs Grouped by Telecaller**
   - Activity tab now groups activities by user
   - Each telecaller has a card with their name and activity count
   - Activities shown chronologically within each group

#### Previous Updates
- Date range filters (from_date, to_date) on all dashboards and reports
- "Unused Data" metric (data in 'new' status created before today)
- "Active Telecallers" shows telecallers with calls in selected period
- Telecaller break/login/logout tracking
- Terminology changed from "Leads" to "Data"

## Status Options
- new, contacted, file, not_interested, follow_up, leads, not_answering, wrong_number, presentation

## Prioritized Backlog

### P0 (Critical) - Completed ✅
- All core features implemented and tested
- Reporting enhancements completed

### P1 (High Priority) - Future
- Call recordings integration (if needed)
- SMS notifications for follow-ups
- Export reports to PDF/Excel
- Multi-language support

### P2 (Medium Priority) - Future
- Dark mode toggle
- Custom fields for data
- Data scoring/qualification
- Email templates
- Refactor `backend/server.py` (1970+ lines) into modular structure using FastAPI's `APIRouter`
- Refactor `frontend/src/pages/admin/Reports.js` (700+ lines) into sub-components

### P3 (Low Priority) - Future
- WhatsApp integration
- Calendar sync
- Advanced analytics dashboard
- Bulk SMS campaigns

## API Endpoints Reference
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login and get JWT token
- `POST /api/auth/logout` - Record logout time
- `GET /api/auth/me` - Get current user
- `POST /api/activity/break` - Start/end break
- `GET /api/activity/logs` - Get activity logs (grouped by telecaller)
- `GET /api/leads` - List data (with filters)
- `POST /api/leads` - Create data
- `POST /api/leads/import` - Import data from file
- `POST /api/leads/assign` - Assign data to telecaller
- `POST /api/call-sessions/start` - Start call session
- `POST /api/call-sessions/end` - End call session
- `GET /api/dashboard/stats` - Get dashboard statistics (with date range)
- `GET /api/reports/telecallers` - Get telecaller reports (with date range)
- `GET /api/reports/hourly` - Get hourly breakdown report
- `GET /api/statuses` - Get available status options

## Testing Results (Mar 11, 2026)
- Backend: 100% pass rate
- Frontend: 100% pass rate
- All 4 reporting enhancements verified
