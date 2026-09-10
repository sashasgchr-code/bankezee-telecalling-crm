

## 2026-09-09 (c) — GP Web/Mobile platform access control (real, server-side)
- New per-GP fields web_access / mobile_access (default TRUE when missing = backward-compatible; no bulk lockout).
- Enforcement is server-side, NOT menu-hiding: login binds platform ('web'|'mobile') into the JWT (routes/auth.py); utils/auth.py get_current_user re-checks the live DB flags on EVERY request, so direct URLs, direct API calls and existing sessions are all gated. GP-only; Admin/Ops/Manager/TL/HR unaffected. Messages: web => "Web access is not enabled for your account. Please use the BankEzee Connect mobile app."; mobile => "Mobile app access is not enabled for your account."
- Admin/Ops API: PUT /api/users/{user_id}/app-access (require_ops_or_admin, GP-only target). GPs get 403 (cannot change own access).
- Web UI: Users.js Edit Role modal shows an 'Application Access' section (checkboxes data-testid web-access-checkbox / mobile-access-checkbox) for GP roles only; saves via the new endpoint. authStore login sends platform:'web'; api.js 403 interceptor force-logs-out on the web-denied message. Meta Access controls remain separate/independent.
- Mobile: api.js login sends platform:'mobile'; LoginScreen shows the backend deny message.
- Verified: backend curl all 4 combos (web/mobile on/off) + own-access 403 + live revocation on /me; web UI iteration_59 = 8/8 PASS; GP banothunithinnaik restored to web+mobile true.
- Mobile stays at version 2.7.1 / versionCode 28 (unbuilt release bundles call fixes + Files parity + platform login).


## 2026-09-09 (b) — Files loan-type canonical parity (single source of truth)
- Root cause: loan-type lists were hardcoded & DRIFTED per screen. Mobile FileDetailScreen had only 7 types with WRONG values (`balance_transfer`, `top_up_loan`) and NO vehicle types; web FileDetailsPage had its own 12-option list with a bogus `bt_topup_hl`; FilesDashboard had another 12-item list + a free-TEXT Add-New-File loan-type input.
- Fix: created ONE backend source of truth `backend/config/loan_types.py` (19 canonical types, recovered from legacy_crm_data + web catalog; incl vehicle new_vehicle_loan/used_vehicle_loan_fresh/used_vehicle_loan_bt and previously-missing top_up_hl/msme_loan/lap/gold_loan/education_loan/balance_transfer_topup_hl) served at `GET /api/config/loan-types` (routes/config.py).
- Web mirror `frontend/src/constants/loanTypes.js` (useLoanTypes hook: fetches endpoint, bundled canonical fallback). Wired: LoanRequirementsSection.js, FileDetailsPage.js (edit dropdown grouped + canonical read label, killed bt_topup_hl), FilesDashboard.js (filter list + Add-New-File now a canonical grouped <select>).
- Mobile mirror `mobile-app/src/constants/loanTypes.js` + api.getLoanTypes(); FileDetailScreen.js now uses canonical list (fixes drift + enables vehicle-type selection). Meta reuses FileDetailScreen/FileDetailsPage so inherits parity.
- Verified (iteration_58): backend 3/3; web shows 19 grouped types on Connect + Meta, save/reload persists used_vehicle_loan_bt & msme_loan with canonical labels, GP view-only enforced. Backward-compatible: existing saved types still render.
- Backend vehicle field model (tvr_done/emi_ok/login_bank/application_id/sm_name/sm_number/approved_bank/rc_submitted/noc_submitted/hypothecation/disbursed_bank + cibil_issues/foir/company_type) already present; web edits them; mobile displays them.
- Mobile version 2.7.0 -> 2.7.1, versionCode 27 -> 28. APK NOT built (no Expo/EXPO_TOKEN in env; keystore/EAS project must not change).


## 2026-09-09 — Meta email cutover to Resend + mobile call-flow bug fixes
### Meta email (backend)
- Root cause of prior suppression: `meta_sync.py` sent via a non-configured EMERGENT_EMAIL_KEY proxy; Connect prod uses Resend (`utils/email_service.py`). Rewired `_send_safe` to Connect's Resend transport (no EMERGENT_EMAIL_KEY dependency). meta_email_log + caller-side idempotency preserved.
- `utils/email_service.py`: Resend key now resolved AT SEND TIME (env RESEND_API_KEY → else DB `app_settings.resend_api_key`). Multi-replica + restart safe.
- `routes/meta_sync.py`: `_meta_email_enabled()` = env `META_EMAIL_ENABLED` truthy OR DB `app_settings.meta_email_enabled`. Added admin-only `POST /api/meta/email/selftest` (one controlled email, returns log row).
- `routes/settings.py`: admin settings now persist `resend_api_key` + `meta_email_enabled` to DB and set runtime env.
- PROD verified 2026-09-09: gate=true, resend_configured=true; self-test to owner sasha.sgchr@gmail.com => sent=true, suppressed=false, error=null. Deployer confirmed NO historical blast (collection-wide sent:true=1; historical new_leads all suppressed).
- BLOCKER (external, user action): Resend account (owner sasha.sgchr@gmail.com) has NO verified domain + send-restricted key => can ONLY deliver to the owner address. Sends to any other GP/ops recipient are REJECTED ("bankezee.com domain is not verified"). NOT safe to deactivate old Meta CRM until a domain is verified at resend.com/domains and SENDER_EMAIL is set to that domain. Do NOT emit "safe to deactivate" until then.
### Mobile call flow (2.7.0 / versionCode 27) — CODE DONE, APK build pending user Expo auth
- Bug 1 (post-call modal unscrollable / Save unreachable): LeadDetailScreen + MetaLeadDetailScreen modal bodies wrapped in KeyboardAvoidingView + ScrollView with a sticky always-visible Save/Cancel footer (maxHeight 90%, flexShrink scroll).
- Bug 2 (new call reopened previous lead): React Navigation reused the LeadDetail instance (params merged, no remount) so `lead`/refs stayed on Call A. Fix: rebind `lead` + hard-reset ALL call state (callStartTime, pendingCallPhone, modal, outcome, autoCallTriggered) whenever `route.params.lead.id` changes; auto-call effect keyed on lead id. Same reset added to MetaLeadDetailScreen on leadId change.
- APK: EAS production build NOT run — no Expo/EXPO_TOKEN in env and must not change keystore/EAS project. Needs user Save-to-Github or EXPO_TOKEN.

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

## 2026-06 — Mobile web-parity pass (2.6.1/vc18)
- LeaveScreen: replaced raw Object.entries dump (showed Accrual_start_month, yearly_allowance, Infinity) with clean 6-metric summary from /leave/balance: Accrued/Used/Available (days) + Rewards/Penalties/Net (₹, from total_rewards/total_penalties/net_amount). Number()-guarded (no Infinity/NaN). Requests/WFH tabs unchanged.
- FilesScreen: stats now use /files/dashboard/stats WITH the same filters as the list (file_status, loan_types, date preset -> start/end_date). Added loan-type + date-preset (All/Today/Yesterday/Week/Month) filter rows; both stats+list react to all filters. Added amount cards (Approved ₹, Disbursed ₹, Pipeline ₹). Web-matching keys: total_files/new/in_progress/login/approved/disbursed/interim_rejects/final_rejections/total_approved_amount/total_disbursed_amount/amt_in_pipeline. Verified filter changes stats (513 all -> 94 disbursed).
- FileDetailScreen: File Status is editable ONLY for admin/manager/ops (loads role from AsyncStorage user_data); GP/TL/HR see read-only "File Status" box. Assign File section hidden for non-managers.
- Backend: NEW require_file_manage (admin/manager/ops only) applied to PUT /files/{id}/file-status and PUT /files/{id}/assign (previously require_file_write which only blocked HR -> GP/TL could edit). Verified unauthorized -> 403. bulk-assign already admin-only.
- Hourly reports: HourlyReportScreen accepts route.params.scope ('self'|'team'). GP More has "My Hourly Report"; TL More has BOTH "My Hourly Report" (scope self) and "Team Hourly Report" (scope team); Manager has "Team Hourly Report". /reports/my-hourly (self) and /reports/hourly (team) unchanged.
- Version 2.6.1 / versionCode 18 in app.json + build.gradle + config.js.
- Preserved: call logging, post-call modal, 0s-no-Connected guard (UI+backend), Schedule Follow-up fix, Data filter counts, Manager/TL navigators, Team Attendance, session isolation, Admin/HR block, PDF export.

## Connect: HR filters, Policy route, Commission report, GP Earnings (Sep 8, 2026)
- FIX A: /users/growth-partners no longer 403s for HR — HR now loads the canonical active GP list (fixes "All Growth Partners (0)" in HR Attendance + Leave). backend/routes/users.py.
- FIX B: Added HR route /hr/files/policies -> PolicyMaster (was falling through to files/:fileId => blank). frontend/src/App.js.
- FIX C (mobile): Added "Sent for Eligibility" (canonical key sent_for_eligibility) to mobile Files status filter. mobile-app/src/screens/FilesScreen.js.
- Commission report rebuilt (disbursement-date period): backend GET /api/files/commission-report (+/export CSV), /api/files/my-earnings (self-scoped GP). Groups by canonical GP, sums STORED eligibility.commission_amount (fallback amount*pct/100 only when missing), only disbursed=yes, per-GP subtotals + grand totals + GP bank_details; filters month/year/all_time/source_id/disbursed_bank. Admin/ops/hr only; GP gets 403. backend/routes/files_crm.py. FilesDashboard commission panel rebuilt.
- GP Earnings: web components/EarningsCard.js on telecaller Dashboard; mobile earnings card+modal in DashboardScreen.js (getMyEarnings). Trophy card, month/all-time, lifetime, tap for own breakdown. GP isolation enforced server-side.
- Verified: HR sees 19 GPs; commission grand ₹9,23,178.31 (stored amounts, decimals preserved); GP self sum ₹21,650.12 == direct DB sum (2 files/3 disbursals, no double count); GP 403 on full report; names resolve (0 Unassigned); source_id filter returns single GP.

## 2026-09-09 (d) — Meta Lead Detail: direct status change (no call) [pass 1 of Meta parity program]
- Mobile MetaLeadDetailScreen: added an "Update Status" chip row that calls existing PATCH /api/meta/leads/{id}/status directly (no call required), reuses updateMetaStatus API, reloads lead. Backend already logs a status_change activity + auto-assigns processor / fires file notifications on FILE.
- Verified via curl: NEW -> CALL_BACK, activity appended, 200. Files: mobile-app/src/screens/MetaLeadDetailScreen.js.
- REMAINING (not yet done) large program: old-Meta parity for Meta Leads/Files cards (web+mobile), Meta Files filter UX + responsiveness, web responsiveness 360/390/430/tablet, reuse the EXACT Connect post-call modal component for Meta, combined+separate Meta reporting (dashboard/hourly/summary), access-control gating verification. Tracked for subsequent passes.

## 2026-09-09 (e) — Meta parity pass 2 (web cards + responsiveness)
- Meta Files web (frontend/src/pages/meta/Files.js): FileRow rebuilt into rich old-Meta card (Loan Type, Loan Amount, Assigned GP, Processor, Bank/Lender, Created, Docs, Assignment, status badge, phone reveal); filters full-width/stack on mobile. Verified 390px: no horizontal overflow, 21 cards.
- Meta Leads web (frontend/src/pages/meta/Leads.js): added md:hidden mobile card list (name, campaign, status pill, tap-to-call, City/Employment/Salary/Outstanding/Assigned GP/Date); desktop table now hidden md:block and otherwise UNCHANGED. Verified 390px: no horizontal overflow, 25 cards, table display:none.
- Connect untouched. NOT YET DONE (session capacity): Meta-specific post-call modal copied from Connect (web+mobile), Meta call timer/logging parity, combined+separate Meta reporting (Dashboard/Hourly/Summary) with access control + no double-count, mobile card parity.

## 2026-09-09 (f) — Meta post-call modal (web) mirrors Connect + Meta-only logging
- Backend routes/meta.py: MetaCallInput + POST /meta/leads/{id}/calls now accept & persist notes, follow_up_date, follow_up_time (stored on call_logs entry AND lead; note pushed to notes[]). Writes ONLY to meta_leads. Verified curl: dur95/CALL_BACK/notes/follow-up saved, 1 call_log, 1 note, owner=auth user, no Connect call_log.
- Web MetaCallModal.js: added Notes + conditional Follow-up date/time (for CALL_BACK/NOT_ANSWERING/SWITCHED_OFF), responsive max-h-[92vh] overflow-y-auto so it fits mobile widths. Duration from actual call timing. Mirrors Connect post-call UX; separate component (Connect modal untouched).
- Direct status chips retained (two independent workflows). PART B (combined+separate Meta reporting on Dashboard/Hourly/Summary) NOT implemented this session — deferred to avoid half-done edits to Connect report surfaces.

## 2026-09-09 (g) — Mobile Meta CRM screens redesigned to match web look; APK 2.7.3 (31)
- mobile-app/src/screens/MetaHomeScreen.js rewritten for web parity (design tokens from frontend/src/pages/meta/metaCommon.js + Files.js):
  - Adopted web Meta brand blue (#0F52BA / navy #0A192F) replacing the old purple #7c3aed accents (tabs, chips, header dot, spinners, buttons).
  - Colored status pills identical to web STATUS_STYLES (lead status) and Files.js STATUS_COLOR (processing status) — rounded, bg+border+text per status.
  - Lead cards now match web mobile card: name + campaign, colored StatusPill, green Call (#16a34a) + WhatsApp (#25D366) action buttons, 2-col detail grid (City, Employment, Salary, Outstanding, Assigned GP, Date). Call routes to MetaLeadDetail w/ autoStartCall (native call lifecycle); WhatsApp opens wa.me with the SAME Meta message template + phone normalization as web utils/whatsapp.js.
  - Files tab: added 3 stat cards (Total Files / Docs Received / Docs Pending via getMetaFilesStats) + enriched file cards with colored ProcPill and rich grid (Loan Type, Loan Amount, Assigned GP, Processor, Bank/Lender, Created, Docs, Assignment).
  - File Reports tab: metric cards restyled with colored accent bars matching web Card accents; Overall + This Month sections retained.
  - Friendly status labels (underscores -> spaces), horizontal-scroll chip rows, "Date:" prefixed wrapping date bar.
  - MetaLeadsScreen.js confirmed dead code (not referenced in App.js) — left untouched.
- app.json bumped: version 2.7.2 -> 2.7.3, android.versionCode 30 -> 31.
- Validated: babel-preset-expo (@babel/core 7) transformSync OK. No web/backend files changed. Native app not emulator-testable here (per project policy: babel + web cross-check).

## 2026-09-10 — Controlled fix pass: Manager menu, TL filters, Meta UI parity, mobile assign; APK 2.7.4 (32)
STEP 1 — Manager + Team Leads:
- ManagerLayout.js: Team Management now exposes ONLY "Team Leads" (removed My Team + Team Calls). Grid changed cols-4 -> cols-3. Verified: team-nav testids = ['team-nav-team-leads'] only.
- TeamLeads.js filters restructured into clean responsive groups: "Date:" labelled pill row (Today/Yesterday/This Week/This Month as rounded chips, selected = solid emerald) + From/To labelled date inputs; dropdown row uses grid-cols-2 sm:flex-wrap with w-full sm:w-auto min-w so nothing clips/overflows. All stat metrics unchanged.
- GP filter now scopes under selected Team Leader: backend GET /tl/meta adds tl_id to each gp; frontend scopedGps filters gps by selected TL with safe fallback to all when no tl_id match (Anusha's GPs have empty tl_id -> fallback; Pinky's 5 GPs scope correctly). GP resets to ALL when TL changes and current gp not in scope.
STEP 2 — Meta UI parity:
- Web Meta Leads card (Leads.js, md:hidden): customer name text-sm/semibold -> text-base/bold text-slate-900; card separation strengthened via border-b-4 border-slate-200 (removed light divide). Desktop table + GP assign dropdown unchanged.
- Mobile MetaHomeScreen.js: added permission-gated AssignGP control on each lead card (Admin/Ops only via meta_role) — shows current GP, opens a native bottom-sheet Modal partner picker, saving spinner, blocks rapid duplicate taps, updates card ONLY after backend 200, Alert on failure. partners loaded via new api getMetaPartners; assign via assignMetaLead (PATCH /meta/leads/{id}/assign). Long processing statuses constrained (pill flexShrink + maxWidth 52%, centered wrap). Added paddingBottom 96 to Leads/Files FlatLists and Reports ScrollView so content clears bottom nav; keyboardShouldPersistTaps on lists.
STEP 3 — Mobile regression (code-verified, no emulator):
- Call safety: MetaLeadDetailScreen resets ALL call state on leadId change and binds callLeadRef to leadId; startCall uses the freshly-loaded lead.phone; submitCall refuses if bound.id !== leadId. Connect LeadDetailScreen initiateCall likewise uses current lead.phone (per-tap navigation). No stale selectedLead/route-param/session reliance.
- Backend permission verified by curl: admin assign/unassign = HTTP 200 (reverted); Meta growth_partner assign = HTTP 403. Backend STAFF_ROLES remains final authority.
- Validated babel-preset-expo (@babel/core 7) OK for MetaHomeScreen.js + api.js. Frontend webpack compiled with no errors.
- app.json: version 2.7.3 -> 2.7.4, versionCode 31 -> 32. package com.bankezee.connect, production API https://connect.bankezee.com/api, signing/keystore untouched.
- NOT deployed / NOT built — held at release gate pending user confirmation.

## 2026-09-10 (b) — Meta statistics correction (single source of truth) + Dashboard Calls/Connected
ROOT CAUSE: Meta /reports/summary & /reports/hourly counted a "lead" from the meta_leads document's CURRENT status being in {LEAD,FILE} dated by file_created_at/updated_at/created_at/created_time — so imported/NEW/assigned records inflated Meta Leads, and hourly placed leads by last-edit not the call event. Connect /dashboard/stats "connected" field was actually total call_logs (Calls), had no genuine connected, and the status breakdown grouped current lead.status filtered by updated_at (bumped by imports/edits) → e.g. Not Interested 19 > Calls 13.
FIX (backend):
- meta.py /reports/summary + /reports/hourly: CALLS/CONNECTED/LEAD now derived ONLY from call_log events in range. Meta Lead = call_log with disposition==LEAD, dated by call `at` (hour = IST). Connected = duration_seconds>0. Files = distinct lead by file_created_at in range (conversion event date). Added overall.outcomes breakdown. Guarantees sum(outcomes)==calls and connected<=calls.
- reports.py /dashboard/stats (admin): added connected_calls = call_logs outcome=='connected'; kept existing value as both `connected` (compat) and new `calls`; status breakdown time-basis updated_at -> created_at so it's bounded to data added (removes >calls artifact). leads/file remain event-based per spec.
FIX (frontend admin/Dashboard.js): renamed the old Connected card -> "Calls" (same value), added a genuine "Connected" card (connected_calls); stats row grid-cols-3 -> grid-cols-2 sm:grid-cols-4. Combined Totals & Mobile Dashboard auto-corrected (consume /meta/reports/summary; contract unchanged, only added outcomes) — NO APK rebuild required.
DATA LIMITATION (reported): Connect call_logs store only outcome+duration (no lead link, no per-call disposition), so a Connect per-call status breakdown is impossible from existing data; breakdown now reflects data-added-in-period by current status.
RECONCILE (preview, IST): Meta TODAY imported=3 calls=0 LEAD=0 -> Meta Leads=0. Meta THIS WEEK imported=26 calls=5 connected=3 files=3 dispositions{NOT_INTERESTED1,CALL_BACK2,NOT_QUALIFIED1,FILE1} LEAD=0 -> sum=5==calls, connected3<=5. Connect this_month calls=7 connected=6; all_time calls=59 connected=35 (invariant holds). Endpoints match raw DB exactly.
Not deployed; held for user DEPLOY confirmation. No workflow/import/assign/call/post-call/file-conversion code touched.

## 2026-09-10 (c) — WEB Team Leads (TL) page: client-side filtering correction (frontend only)
FILE: frontend/src/pages/telecaller/team/TeamLeads.js ONLY. No backend/mobile/other files changed.
ROOT CAUSE: KPI cards came from /tl/stats which computes today/week/month/range over the WHOLE scope (never narrows GPs by the selected TL) -> selecting a TL didn't change them. The card list came from /tl/leads?tl=X which the backend restricts to TL-CONTACTED leads, and it included FILE-status records.
FIX (all client-side, no backend change): fetch the full assigned set once via /tl/leads?period=lifetime (backend then applies NO date filter and NO tl-contacted filter). Derive list + all 8 KPIs client-side with useMemo:
- TL scope via GP->tl_id map from /tl/meta; then GP filter; then IST date range (new istBounds mirrors backend _period_bounds); exclude status==='file'; then explicit outcome/converted filters.
- Leads(range)=visible non-file count; Today/Week/Month=scope non-file in fixed IST periods; TL Contacted=visible with tl_calls_count>0 (subset); Converted=in-range converted_by_tl (includes file); Pending=range-contacted; Conv%=converted/(range+converted).
- Card list now = ALL assigned leads in scope+range (FILE excluded), regardless of TL contact; Last TL Call = — still visible.
VERIFIED (preview, admin): TL scoping reacts -> assigned totals ALL=52, Anusha(69b24...)=32, Pinky=6. All 52 preview leads are status=file so non-file counts=0 after exclusion (old behaviour counted files). Frontend compiled successfully; page renders, cards react. NOTE: duplicate TL identity "Y Anusha" (f259e847) maps to 0 GPs; the populated "Yarragonda Anusha "(69b24) is correct. Production has real non-file leads that will now display/react.
Not deployed.

## 2026-09-10 (d) — TL page fix: join leads to TL by gp_name (id variant mismatch)
BUG (frontend, TeamLeads.js): my client-side TL/GP scope joined lead.gp_id to /tl/meta gp.id, but the SAME GP has DIFFERENT id variants in lead.assigned_to vs /tl/meta -> 12 of 52 leads unmapped; Pinky undercounted (8 vs actual 14), Anusha (32 vs 38). That's why "Pinky's leads not showing".
FIX: join on normalized gp_name instead of gp_id. nameToTl={norm(name):tl_id}; gpIdToName maps the GP-dropdown value(id) back to a name for the GP filter. Verified name-join maps all 52 (ALL=52, Anusha=38, Pinky=14). Compiled OK; UI select works.
NOTE: on preview every TL lead is status=file, so the FILE-exclusion (per prior spec) still yields 0 visible cards there; on production Pinky's non-file leads will now appear.
CLARIFICATION (Dashboard): "Connected(664) < Not Interested(900)" is expected, NOT a bug — Connect call_logs have no per-call disposition, so the Status Breakdown shows lead statuses of data ADDED in the period (not call outcomes). Invariants hold: connected<=calls (664<=1776), not_interested<=total_data (900<=4481).
Not deployed.

## 2026-09-10 (e) — TL page: canonicalize GP->TL id in /tl/meta (fixes "leads under All but not under TL")
ROOT CAUSE: user.tl_id frequently stores a NON-canonical variant of the TL (e.g. Mongo _id 6a96f82aaf...b0) while /tl/meta.tls exposes the canonical id (6a86994835...0d). _tl_scope.gp_map_for matches ANY variant so the GP's leads DID appear under "All Team Leaders", but the frontend name-join (gp_name -> gp.tl_id === selectedTL canonical id) failed because gp.tl_id was the raw _id variant -> leads never appeared under the specific TL (e.g. Gujjari Sai Kiran not under Nagulapally pinky).
FIX (backend, /tl/meta ONLY — smallest targeted change): resolve each GP's TL from tl_id / team_lead_id / team_lead and CANONICALIZE it via a resolver built from every allowed-TL identifier (id, _id, email, username, name, full_name) -> canonical id. gp.tl_id now always equals a tls[].id (or ''). Frontend already name-joins (prev turn), so it now scopes correctly. No frontend/mobile change.
VERIFIED (preview, admin): /tl/meta returns 16 GPs, 0 non-canonical tl_ids; Pinky=5 GPs, Anusha=11, overlap=0 (no cross-TL leakage). Resolver proof: Pinky _id/email/name/canonical-id all resolve -> 6a86994835a1d0070f83970d; simulated production Gujjari(tl_id=Pinky._id) -> Pinky canonical (PASS). Name-join places Pinky scope = 14 leads (was 8 pre-name-join). backend 200, frontend 200.
LIMITATION: preview Gujjari.tl_id='' (no stored edge) and his exact leads (Gandrothula Sriram/Dasari Srikanth, status LEADS, dated today) exist only on PRODUCTION, so that exact card list can't be rendered on preview; the fix resolves the production root cause (variant mismatch) as proven by the resolver simulation.
Not deployed.

## 2026-09-10 (f) — Manager Team view: canonicalize GP->TL grouping in /users/manager-team-members
FILE: backend/routes/users.py (get_manager_team_members) ONLY. Read/render mapping fix — NO user records mutated. No frontend/mobile change.
ROOT CAUSE: tl_map was keyed by raw member.id and member_data.tl_id/tl_name/team_count used the RAW stored tl_id. When a GP's tl_id was a non-canonical variant (e.g. Mongo _id) of the TL, tl_map.get() missed -> GP not grouped/labeled under the TL; grouping/labels were inconsistent.
FIX: use the shared index.canonical_id() to canonicalize each member's id and tl_id. tl_map keyed by canonical TL id; member.tl_id/tl_name set ONLY when the canonical tl_id maps to an actual TL in this team (else null => shown directly under the manager). No inference from manager_id. team_count keyed by canonical tl id.
VERIFIED (preview, manager Teja e37774a4-8b44-4f6f-a282-faeaa5ab6800): 7 members = 1 TL (Nagulapally pinky, id 6a86994835a1d0070f83970d) + 6 GPs. Pinky team=5 (SHIVASAI/J Vishnu Vardhan/Wameezuddin/Vijayendra/Lellamarychandana) all labeled correctly; Gujjari Sai kiran shows DIRECT (his tl_id='' on preview -> not inferred as Pinky). 0 GPs with tl_id not matching a listed TL; 0 duplicates. Backend 200.
LIMITATION: preview lacks Mathangi Nikitha & Monisha Satya (not in Teja subtree here) and Gujjari's stored TL edge (empty on preview). On production, where their tl_id points to a Pinky variant, canonicalization groups all 7 under Pinky. Fix verified for the variant-resolution mechanism.
Not deployed.
