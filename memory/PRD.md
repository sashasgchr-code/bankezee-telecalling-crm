# BANKEZEE Connect CRM - Web Application PRD

## Original Problem Statement
Convert existing Expo React Native mobile CRM app (tele-connect-13) into a fully responsive React web application optimized for mobile phone browsers. Platform migration - not redesign.

## Project Overview
- **Application**: BANKEZEE Connect CRM (Web Version)
- **Date Started**: Feb 11, 2026
- **Status**: MVP Complete
- **Tech Stack**: React.js (Frontend), FastAPI (Backend), MongoDB (Database)

## User Personas
1. **Admin** - Manages leads, users, views reports, assigns leads to telecallers
2. **Telecaller/Agent** - Makes calls to leads, updates statuses, tracks follow-ups

## Core Requirements (Static)
- ✅ Admin & Agent authentication (JWT-based)
- ✅ Admin dashboard with stats (Total Data, Connected, Leads Generated, Interested)
- ✅ Agent dashboard with personal stats (calls, talk time, idle time)
- ✅ Lead management (CRUD, import/export, bulk operations)
- ✅ User management for admins
- ✅ Call tracking system with browser-based call detection
- ✅ Follow-up scheduling and tracking
- ✅ Reports and analytics
- ✅ Status updates for leads
- ✅ Mobile-first responsive design

## What's Been Implemented (Feb 11, 2026)

### Backend (FastAPI + MongoDB)
- JWT Authentication (register, login, token validation)
- User management (CRUD, activate/deactivate)
- Lead management (CRUD, import from CSV/Excel, bulk assign, auto-distribute)
- Call session tracking (start, end, cancel)
- Activity ping and idle time tracking
- Follow-up management
- Dashboard stats and reports
- Telecaller performance reports

### Frontend (React + Tailwind CSS)
- **Auth Pages**: Login, Register with role selection
- **Admin Pages**: Dashboard, Leads (with import/assign), Users, Reports, Settings
- **Telecaller Pages**: Leads, Dashboard, Follow-ups, Profile
- **Shared**: Lead Detail with edit/call/follow-up
- **Call System**: 
  - Click to call via tel: links
  - Browser visibility detection for call return
  - Post-call modal for logging call outcomes
  - Active call banner with timer

### Call Tracking Flow (Web Implementation)
1. Agent clicks CALL → Backend creates call session → Opens tel: link
2. Agent returns to browser → Visibility API detects → Shows post-call modal
3. Agent logs outcome (Connected/No Answer/etc) → Updates status → Creates call log
4. Idle time calculated between call_end_time and next call_start_time

## Prioritized Backlog

### P0 (Critical) - Completed ✅
- All core features implemented and tested

### P1 (High Priority) - Future
- Call recordings integration (if needed)
- SMS notifications for follow-ups
- Export reports to PDF/Excel
- Multi-language support

### P2 (Medium Priority) - Future
- Dark mode toggle
- Custom fields for leads
- Lead scoring/qualification
- Email templates

### P3 (Low Priority) - Future
- WhatsApp integration
- Calendar sync
- Advanced analytics dashboard
- Bulk SMS campaigns

## API Endpoints Reference
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login and get JWT token
- `GET /api/auth/me` - Get current user
- `GET /api/leads` - List leads (with filters)
- `POST /api/leads` - Create lead
- `POST /api/leads/import` - Import leads from file
- `POST /api/leads/assign` - Assign leads to telecaller
- `POST /api/call-sessions/start` - Start call session
- `POST /api/call-sessions/end` - End call session
- `GET /api/dashboard/stats` - Get dashboard statistics
- `GET /api/reports/telecallers` - Get telecaller reports

## Testing Results
- Backend: 90.5% pass rate
- Frontend: 95% pass rate
- Overall: 92% success rate
