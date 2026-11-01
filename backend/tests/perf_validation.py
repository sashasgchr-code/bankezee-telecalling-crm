"""Validation for Meta Ad Performance + Processor Performance metric definitions (preview DB, read-mostly)."""
import asyncio
import dotenv
from datetime import datetime

dotenv.load_dotenv("/app/backend/.env")

from utils.database import db  # noqa: E402
from routes import meta_metrics as mm  # noqa: E402
from routes import meta_sync  # noqa: E402
from routes.meta import _working_ms  # noqa: E402


async def main():
    # 1. Sunday excluded: Sat 10:00 IST -> Mon 10:00 IST = 24 working hours (Sunday skipped)
    sat = datetime(2026, 10, 31, 4, 30)  # 10:00 IST Saturday
    mon = datetime(2026, 11, 2, 4, 30)
    print("1 Sunday excluded:", _working_ms(sat, mon) / 3600000 == 24.0, _working_ms(sat, mon) / 3600000)
    dl = mm._working_cutoff_forward(sat)
    print("  deadline from Sat 10:00 IST (+96 working h):", (dl + mm.IST).strftime("%a %Y-%m-%d %H:%M"))
    # 2. Approved-then-disbursed counted as approved milestone and disbursed; current stage Disbursed only
    lead = {"lead_id": "x", "status": "FILE", "processing_status": "Disbursed", "file_created_at": "2026-10-01T05:00:00+00:00",
            "file": {"banks": [{"approval_status": "approved", "approved_amount": 500000, "disbursed": "yes", "disbursed_amount": 480000,
                                "disbursal_date": "2026-10-05"}]},
            "activities": [{"type": "processing", "detail": "Processing status set to 'Approved' by A", "at": "2026-10-03T05:00:00+00:00"},
                           {"type": "processing", "detail": "Processing status set to 'Disbursed' by A", "at": "2026-10-05T05:00:00+00:00"}]}
    f = mm.lead_facts(lead)
    print("2 approved+disbursed:", f["approved"], f["disbursed"], f["approved_amount"], f["disbursed_amount"], "stage", f["stage"])
    # 3. Attribution retained on a converted file
    fl = await db.meta_leads.find_one({"status": "FILE", "meta_attr.ad_id": {"$ne": None}}, {"lead_id": 1, "meta_attr.ad_name": 1, "processing_status": 1})
    print("3 file keeps attribution:", fl["lead_id"], fl["meta_attr"]["ad_name"], fl.get("processing_status"))
    # 4. Duplicate import skipped: feed the sheet sync one EXISTING row twice -> 0 inserts
    ex = await db.meta_leads.find_one({"sheet_id": {"$regex": "^l:"}}, {"sheet_id": 1})
    before = await db.meta_leads.count_documents({})
    orig = (meta_sync.fetch_sheet_rows, meta_sync.fetch_website_rows)
    row = next(r for r in await orig[0]() if r.get("id") == ex["sheet_id"])  # real sheet row => same data a normal sync writes
    meta_sync.fetch_sheet_rows = lambda: _ret([row, row])
    meta_sync.fetch_website_rows = lambda: _ret([])
    res = await meta_sync.sync_leads_from_sheet()
    meta_sync.fetch_sheet_rows, meta_sync.fetch_website_rows = orig
    run = await db.meta_import_runs.find_one({}, sort=[("started_at", -1)])
    print("4 duplicate skipped:", res, "docs unchanged:", before == await db.meta_leads.count_documents({}), "run dup:", run["duplicates_skipped"])
    await db.meta_import_runs.delete_one({"_id": run["_id"]})


async def _ret(v):
    return v


asyncio.run(main())
