
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
