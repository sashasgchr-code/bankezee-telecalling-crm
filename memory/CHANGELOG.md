
## 2026-09-04 — Unified File & Lead counting rule across all reports
- Rule: A File is counted ONLY by `file_created_at` (fallback `created_at`); a Lead ONLY by `lead_created_at` (fallback `updated_at`). Counted by the day it BECAME that status, never last-edit/import date.
- Applied consistently to: Dashboard status-breakdown + KPIs (reports.py get_dashboard_stats, admin+GP branches), Reports Summary (/reports/telecallers overall), Hourly (/reports/hourly), My-Hourly, Daily Tracking (/reports/daily-tracking-sheet), Manager Team Stats.
- File attribution is now ALIAS-AWARE (utils.hierarchy UserIndex): owners referenced by legacy/duplicate ids resolve to the canonical person, so no file is dropped. Counts include files owned by any user (admin/legacy) so totals match the global Summary. Empty rows suppressed.
- leads.py update_lead now stamps `lead_created_at` when status first becomes leads/converted (mirrors file_created_at stamping at leads.py:739/994).
- Fallback design => today's numbers unchanged; fix only freezes dates against future edits + makes all reports consistent.
- Call Log (/api/reports/detailed-calls) confirmed working (dual lead_oid + lead_uuid $lookup).
- Verified in preview: Dashboard == Summary == Hourly == Daily Tracking File totals for a given date.
- NOTE: preview DB != production DB; production carries today's live data. Deployed to production for real verification.

## 2026-09-04 (b) — Central reporting date fix: IST bucketing + event-date rule + Call Log/Daily Tracking
- ROOT CAUSE 1: reports bucketed by UTC calendar day; this is an India (IST) business, so a File/Lead created in early IST hours (late-UTC previous day) fell on the wrong day (e.g., Gujjari's 04-Sep file showed on 03-Sep).
- ROOT CAUSE 2: Files/Leads still keyed off updated_at/import date in some report paths, and file owners under legacy/duplicate ids were dropped.
- FIX: get_date_range + Hourly + My-Hourly + Daily Tracking now compute all day/hour boundaries and date buckets in IST (+5:30). Files=file_created_at, Leads=lead_created_at (event date), never updated_at/import. Alias-aware canonical GP identity across Dashboard/Summary/Hourly/Daily/Manager/Call Log.
- FIX: Daily Tracking single-agent view always returns the selected GP's sheet (fixes "Select an agent" staying blank); all-agents view hides only empty rows. Corrected day-label bug where UTC loop labels didn't match IST-bucketed data.
- FIX: Call Log detailed-calls GP filter is alias-aware; server-side pagination (MAX_ROWS 25000), totals over full dataset.
- Preview verification (limited preview data, 1 file on 09-04): Dashboard=Summary=Hourly=Daily all show the file on 09-04 at IST hour 15; single-agent sheet loads; Call Log returns rows.
- Production (3 files: Gujjari/Vishnu/Pushpa) verification delegated to deployer (preview DB != prod DB). Watch: any prod file missing file_created_at will fall back to import created_at and show on the wrong day.

## 2026-09-04 (c) — REAL ROOT CAUSE: production Mongo aggregate timeouts (10s)
- Deployer RCA: latest build IS live/promoted (run fd636090), but backend logs show pymongo NetworkTimeout (10000ms) on aggregate() against Atlas. Prod has 171,062 call_logs. Reports returned empty/500 (Call Log blank, inconsistent files) NOT due to code logic but SLOW queries. Preview never showed this (tiny DB).
- FIX A (indexes, server.py background startup): added leads.id, leads.source_id, leads.file_created_at, leads.lead_created_at, leads.updated_at, (status,source_id); verified_call_logs (user_id,call_timestamp) + call_timestamp. Critical: leads.id (Call Log $lookup joined on it → collection scan per call).
- FIX B (Call Log /reports/detailed-calls rewrite): removed the per-row $lookup over up to 25000 rows. Now: totals via cheap count/sum aggregations over full dataset; fetch only page*page_size rows (no lookup); attach lead/customer fields with ONE batched leads query for the current page only. Server-side pagination preserved.
- Verified in preview: Call Log returns rows + correct totals; dashboard/telecallers/hourly/daily-tracking all 200.

## 2026-09-04 (d) — Daily Tracking dropdown = Call Log filter (final web fix)
- Issue: Daily Tracking "Select Growth Partner" applied a client-side dedup-by-email that picked a different (CRM-duplicate) user record for some GPs (e.g., Nagulapally Pinky -> akshaya03302023), whose id had no tracking data => "Select an agent" blank sheet.
- Fix (frontend only, DailyTrackingSheet.js): dropdown now uses the RAW /users/growth-partners list exactly like the Call Log filter (Reports.js), no client-side dedup. Selected GP id now matches a record with tracking data. Nothing else changed.
- Note: "Compiled with problems" preview overlay is an internal visual-edits dev babel plugin error on BankEligibilityRow.js (pre-existing, dev-only, not touched); production build compiles/deploys fine.
- Requires a Republish to take effect on connect.bankezee.com.

## 2026-09-04 (e) — Mobile APK: structured unlimited Existing Loans editor
- mobile-app FileDetailScreen.js: replaced the 3 fixed loan text fields with the web-parity structured existing_loans array editor (bank, loan_type, loan_amount, sanction_date, outstanding, roi, emi), unlimited Add/Remove, totals, legacy loans read-only. Wired into load + save (additional_data.existing_loans). Babel parse OK.
- app.json already at version 2.4.1 / versionCode 13 (APK profile, production backend) — folds this change in; no rebuild bump needed as no APK was built yet.

## 2026-09-04 (f) — Mobile web-parity fixes
- api.js getTelecallerReports: /reports/telecaller-summary (404, didn't exist) -> /reports/telecallers (web Summary endpoint).
- api.js getTelecallers: /users (role==telecaller only) -> /users/growth-partners (all GP roles), matching web dropdowns. Also used by DataScreen reassignment (reads id/name only - safe) and TrackingScreen dropdown.
- TrackingScreen: single-agent row now falls back to response[0] so the sheet always loads (alias-safe), matching web.
- app.json bumped to version 2.4.2 / versionCode 14. Babel parse OK on all edited files.

## 2026-06 — Mobile GP full parity: native screens for missing web features
- Goal: bring the Expo mobile app to feature parity with the web app for Growth Partners (fully NATIVE screens, no WebViews).
- New native screens (all use GP-accessible endpoints, no admin-only calls):
  - CallLogScreen.js — rewritten to use GET /call-logs/unified (auto-filters to own calls for telecaller/GP). Day nav, client-side totals (calls/connected/talk). NOTE: dropped /reports/detailed-calls which is admin-only.
  - HourlyReportScreen.js — GET /reports/my-hourly. Per-hour C/CO/L/F table + top-level totals (total_calls/total_connected/total_leads/total_file are TOP-LEVEL, not nested).
  - AttendanceScreen.js — GET /attendance/today + /attendance/my/monthly-matrix, POST check-in/check-out with expo-location. Calendar matrix + summary (P/L/W/A/U) + attendance %.
  - PolicyMasterScreen.js — GET /files/policies. Search + loan-type filter + expandable policy cards (view; add/edit is backlog).
  - EligibilityScreen.js — POST /bank-policies/check-eligibility/{fileId} + GET /bank-policies/eligibility-history/{fileId}. Profile summary, eligible/possible/not-eligible groups, per-bank expandable rule tables, history. Mirrors web EligibilityCheck.js.
  - MoreScreen.js — sidebar-style menu (web parity) linking Team, Reports, Call Log, Hourly Report, Attendance, Policy Master, Leave + Logout.
- Navigation (App.js) restructured: 5 bottom tabs (Dashboard, Data, Files, Follow-ups, More). Team/Reports/Leave + the 5 new screens registered as Stack screens reachable from More; Eligibility reached from a "Check Bank Eligibility" button added to FileDetailScreen (web parity — button on file detail).
- Version bumped app.json 2.5.0 / versionCode 16; config.js APP_VERSION 2.5.0.
- Verification: all 7 new/edited RN files compile under babel-preset-expo; all backend endpoints curl-verified (admin token, same get_current_user path as GP) returning the exact shapes the screens consume (policies have id; check-eligibility returns profile/results/counts; my-hourly top-level totals; unified call logs = flat array). On-device UI NOT visually tested (Expo app can't be rendered by the web screenshot tool) — needs user's Expo/EAS build to confirm visuals.

## 2026-06 — Mobile roles GP + TL + Manager, session isolation, post-call & filter fixes, web PDF
Mobile version 2.6.0 / versionCode 17.

ROLE MODEL: roles are admin/hr/manager/ops/growth_partner. TL = growth_partner with is_tl=true (a flag, not a role). Mobile getMobileRole(user): manager->manager; GP role + is_tl->tl; GP role->gp; everything else (admin/hr/ops)->blocked.

MOBILE (mobile-app):
- App.js rewritten: role-based navigators. GP & TL share GpTabs (Dashboard, Data, Files, Follow-ups, More). Manager gets ManagerTabs (Files, Team, Reports, More) — no Dashboard/Data/personal Attendance, starts on Files. Admin/HR/Ops -> WebOnlyScreen ("This role is supported on the BankEzee web application. Please use the web portal."). AppNavigator keyed by user.id => full remount on account switch.
- Session isolation (#14): handleLogin AsyncStorage.clear() before storing new; handleLogout AsyncStorage.clear() (wipes filters, last sync, auth). Nav remount clears in-memory state.
- MoreScreen role-aware: gp=[Attendance,PolicyMaster,Leave]; tl=[MyTeam,Reports,HourlyReport,Attendance,PolicyMaster,Leave]; manager=[HourlyReport,TeamAttendance,PolicyMaster,Leave]. No standalone Call Log tab/menu anywhere (TL Call Log removed per spec; call logging still works via post-call).
- New MyTeamScreen: TL -> GET /users/my-team, Manager -> GET /users/manager-team-members (same mapping/stats as web). New TeamAttendanceScreen: GET /attendance/team/today.
- ReportsScreen rewritten to use role-scoped GET /reports/hourly (old /reports/telecallers is admin-only -> 403 for TL/manager). HourlyReportScreen now role-aware: tl/manager -> /reports/hourly (team, per-member expandable), gp -> /reports/my-hourly (self).
- DataScreen filter-count fix (#11): badges now come from GET /leads/stats (full visible dataset, called WITHOUT the active status/outcome filter) so counts stay stable when a chip is tapped; 'All' uses totals.total. Removed calculateStatusCounts(page).
- api.js: added getMyTeam, getManagerTeam, getTeamHourly, getTeamAttendanceToday, getLeadsStats.

BACKEND:
- calls.py POST /call-logs/mobile (#10 fix): resolve lead by UUID `id` first then ObjectId `_id` (was ObjectId(log.lead_id) -> bson InvalidId 500 = "Failed to log call outcome" on legacy/imported leads). Role check now uses is_gp_role (was == "telecaller"); GP access + daily-session stats now apply to all GP roles. Verified: real UUID lead -> 200; non-ObjectId id -> 404 (never 500).
- attendance.py NEW GET /attendance/team/today: Manager/TL-scoped team attendance (HR/admin-only /attendance/admin/* can't be used by managers). Returns per-member rows (name, role, check-in/out IST, status, work_mode) + summary; absent members included.

WEB (frontend):
- admin/Attendance.js (used by Admin AND HR): added "Export PDF" button (jsPDF + jspdf-autotable) -> BankEzee heading, date, generated IST timestamp, total, columns Employee/Role/Work Mode/Check In/Check Out/Working/Status, A4 landscape, respects current filters (filteredRecords). Existing CSV Export untouched.

VERIFIED: all changed mobile files compile under babel-preset-expo; backend endpoints curl-tested 200 (team/today, reports/hourly, manager-team-members, leads/stats) with correct shapes; post-call fix tested across id types; web Attendance renders Export PDF (screenshot, no compile overlay).
NOT verified on-device: RN mobile UI (cannot render Expo here) and live TL/Manager-account nav (no TL/manager test creds).
KNOWN/BACKLOG: "no duplicate call records" (#10) — the crash is fixed but the dual-collection merge (call_logs mobile vs verified_call_logs sync) dedup was intentionally NOT changed to avoid regression; needs verification on device.

## 2026-06 — Fix: Assign Leave double-counted on Attendance summary
- Bug: admin/leave-assign writes ONE attendance doc with attendance_status=ON_LEAVE AND work_mode=LEAVE. /attendance/admin/summary counted on_leave (by status) + leave (by work_mode) then SUMMED them (line 757) -> every assigned leave showed as 2 On Leave.
- Fix (backend/routes/attendance.py admin_get_attendance_summary): on_leave now counts each record once via {$or:[status==ON_LEAVE, work_mode==LEAVE]}; removed redundant `leave` field and the `+ summary.get("leave")` addition. Verified: single leave doc -> on_leave=1 (was 2). Requires production redeploy to reach connect.bankezee.com.

## 2026-06 — Corrective pass (commit 2c443d8): call-outcome, follow-up, filters, role nav
MOBILE (mobile-app):
- LeadDetailScreen.js: REMOVED manual "Log Call Outcome" button (agents can no longer fabricate outcomes). Post-call modal now opens ONLY via the real-call AppState flow (initiateCall -> phone -> AppState 'active' -> Android call-log match -> setShowCallModal(true)). Preserved: device call match, talk time, UUID/legacy ids, outcome save, status update, follow-up, no dup/500.
- LeadDetailScreen.js: Schedule Follow-up rewritten from iOS-only Alert.prompt (dead on Android) to a real Modal with Day + Time(IST) chips + notes; buildIstScheduledAt() produces a timezone-independent UTC ISO for the chosen IST wall-clock; persists via same /follow-ups backend; sets lead status follow_up locally + reloads.
- Deleted obsolete src/screens/TeamScreen.js (generic +Add/telecaller CRUD) - no longer referenced; Manager/TL Team now MyTeamScreen only.
- (from role pass) App.js: ManagerTabs = Files, Team, Reports, More (NO Dashboard/Data/Follow-ups). GP & TL = GpTabs (Dashboard, Data, Files, Follow-ups, More); TL More adds MyTeam/Reports/HourlyReport. No Call Log anywhere. Admin/HR/Ops -> WebOnlyScreen. getMobileRole(user): manager->manager; GP role + is_tl->tl; GP role->gp; else blocked. AppNavigator keyed by user.id + AsyncStorage.clear() on login/logout.
- MyTeamScreen (/users/my-team TL, /users/manager-team-members mgr), TeamAttendanceScreen (/attendance/team/today), ReportsScreen & HourlyReportScreen role-scoped (/reports/hourly), DataScreen badges from /leads/stats (full-dataset facets, NOT recomputed on status/outcome tap).

BACKEND:
- routes/follow_ups.py POST /follow-ups: resolve lead by id-or-ObjectId (fix UUID 500), is_gp_role access check, set lead.status=follow_up + next_follow_up_at. Verified: UUID lead -> 200, status->follow_up.
- routes/calls.py /call-logs/mobile: UUID/ObjectId lead resolve + is_gp_role (prior).
- routes/attendance.py: /admin/summary on_leave counted ONCE (leave double-count fix); NEW /attendance/team/today (manager/TL scoped).

WEB: frontend/src/pages/admin/Attendance.js Export PDF (jsPDF) - Admin/HR.

VERSION: app.json 2.6.0/vc17 AND android/app/build.gradle versionCode 17 / versionName 2.6.0 (NOT reverted).

DELIVERY: no git remote in workspace -> user must click "Save to Github" to push commit to origin/main; backend needs Emergent Deploy to reach connect.bankezee.com.
