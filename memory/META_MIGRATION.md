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
- Connect WEB Meta UI (nav gated by meta_access + Dashboard/Leads/LeadDetail/Files/Reports/UserMgmt extension).
- Meta write workflows (status/disposition updates, assignment, notes) under /api/meta/*.
- Google Sheet CSV sync port (routes + dedupe on sheet_id) — keep OLD Meta sync running; single sync only at cutover.
- Email notifications port (use meta_email).
- Mobile Meta GP workflow + Meta call flow (embedded call_logs/activities on meta_leads; one-call-one-record).
- GridFS binary backfill (149 files / fs.chunks) from live Meta MONGO_URL.

## Isolation guarantees
- Only meta_* collections touched. Connect leads/users/files untouched. Old Meta prod DB never contacted.
- SAFE TO SHUT DOWN OLD META = NO (binaries + sync + email + mobile pending).
