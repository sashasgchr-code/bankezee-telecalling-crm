# Meta → Connect Migration (Phase 2) — progress

## Source of truth
- Meta code: https://github.com/sashasgchr-code/META-APP.git (cloned read-only to /tmp/meta-source; NOT merged)
- Live dump: partner-leads-hub-test_database_dump_20260908_062501.zip (JSON; fs.chunks failed to serialize)

## DONE & VERIFIED (backend foundation, preview only)
- Isolated import script: backend/scripts/meta_import.py -> meta_leads(392), meta_users(33),
  meta_user_sessions(129), meta_meta(1), meta_fs.files(149, binary_pending=True). meta_fs.chunks=0 (pending).
  IDs/_id/lead_id/user_id preserved verbatim. Idempotent. Counts verified source==dest.
- Identity link script: backend/scripts/meta_link_identities.py — auto-maps Meta users to Connect users by
  case-insensitive email; sets on the Connect user: meta_access, meta_role, meta_email, meta_user_id.
  Result: 9 auto-mapped, 5 real manual-needed, 19 seed/test preserved.
- Auth gate: utils/auth.py require_meta_access (server-side; 403 if meta_access falsy).
- Backend router: routes/meta.py mounted at /api/meta/* (registered in server.py). Endpoints:
  /me, /dashboard, /leads (role-scoped), /leads/{lead_id}, /users (staff only), /files, /files/{id}/download (409 pending).
  Scoping matches Meta: admin/ops=all; growth_partner=assigned_partner_id; processor=assigned_processor_id.
- Verified via curl: access OFF=403; processor & GP scoping correct; files metadata + 409 pending; staff-only enforced.

## NOT YET DONE (next approved increments)
- GridFS binary backfill (149 files / fs.chunks) from live Meta MONGO_URL.
- Production sync cutover (OLD Meta sync OFF -> Connect sync ON) — pending; only ONE active at cutover.
- Final APK build (v bump) after Meta mobile approval.

## MOBILE GP + META CALLS INCREMENT — DONE (Sep 8, 2026)
- Backend: routes/meta.py + POST /api/meta/leads/{id}/call-log (dedupe on call_id; stores in
  meta_leads.call_logs + activities; optional status transition; FILE triggers staff+processor email)
  and GET /api/meta/my-call-stats (talk-time from call_logs). Verified via curl: save, dedupe, 95s stat.
- Mobile (ADDITIVE, Connect calling untouched): src/screens/MetaLeadsScreen.js (assigned Meta leads,
  search/status filter), src/screens/MetaLeadDetailScreen.js (detail + REUSES makePhoneCall +
  AppState + getRecentCallForNumber from callLogService, shared post-call modal, saves to Meta API
  with call_id=meta_<leadId>_<ts>). api.js Meta funcs. App.js: conditional 'Meta' tab in GpTabs when
  meta_access && meta_role==growth_partner + MetaLeadDetail stack screen.
- callLogService.js and LeadDetailScreen.js NOT modified -> ordinary Connect calls byte-for-byte unchanged.
- version 2.6.4 / versionCode 21 UNCHANGED (no bump this increment). No native deps / permissions / EAS changes.
- NOT runtime-tested on device (no emulator/APK in env) - requires an EAS build to validate the native
  call lifecycle on a handset.

## SHEET SYNC + EMAIL INCREMENT — DONE & VERIFIED (Sep 8, 2026)
- routes/meta_sync.py ported from META-APP: sync_leads_from_sheet -> meta_leads (dedupe sheet_id),
  email notify helpers (staff/processor/partner via meta_users.email == meta_email). Routes:
  /api/meta/leads/sync (staff), /api/meta/cron/sync-leads + /api/meta/webhook/sheet-sync (WEBHOOK_CRON_SECRET).
  NO scheduler started. Triggers wired into meta.py assign + status=FILE.
- PREVIEW SAFETY: META_EMAIL_ENABLED=false -> sends CAPTURED to meta_email_log (no real send).
- .env added: WEBHOOK_CRON_SECRET, META_EMAIL_ENABLED.
- Verified: sync x2 => 392 stays 392, cron 401/200, webhook 200, import=0 emails; assignment=1 to
  partner meta_email; FILE=staff(2)+processors, all suppressed; Connect 200; no sheet_id in Connect leads.

## WEB META UI INCREMENT — DONE & VERIFIED (Sep 8, 2026)
- Frontend: pages/meta/MetaApp.js (Dashboard, Leads, Lead Detail, Files, User Mgmt); routes 'meta' added under
  /admin,/manager,/agent in App.js; 'Meta CRM' nav gated by meta_access in AdminLayout/ManagerLayout/
  TelecallerLayout (admin also sees it for User Mgmt even without meta_access).
- Backend: routes/meta.py write endpoints (PATCH status, PATCH assign [staff only], POST notes, GET partners)
  + admin User Management (GET /admin/user-management, PATCH /admin/users/{id}) with duplicate-map rejection.
- testing_agent iteration_53: backend 23/23 + frontend role matrix PASS; Connect regression PASS. One HIGH UI
  bug (admin blocked from User Mgmt) fixed + re-verified.

## Isolation guarantees
- Only meta_* collections touched. Connect leads/users/files untouched. Old Meta prod DB never contacted.
- SAFE TO SHUT DOWN OLD META = NO (binaries + sync + email + mobile pending).
