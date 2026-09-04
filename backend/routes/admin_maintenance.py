"""TEMPORARY Admin-only endpoints: File date repair + the CRM data migration runner.

  POST /api/admin/file-dates-backfill/start?mode=dry_run|apply   -> background job
  GET  /api/admin/jobs/{job_id}                                  -> job state + report

`apply` verifies a full backup of the leads collection first and aborts if the counts differ.
REMOVE THIS ROUTER once the production repair is signed off.
"""
import asyncio
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query

from utils.auth import require_admin
from utils.crm_migration import create_backup
from utils.database import db
from utils.file_dates_backfill import run_backfill
from utils.json_safe import json_safe

router = APIRouter(prefix="/api/admin", tags=["admin-maintenance"])
JOBS = "migration_jobs"


async def _run(job_id, mode):
    async def save(**fields):
        await db[JOBS].update_one({"job_id": job_id}, {"$set": fields})
    try:
        backup = None
        if mode == "apply":
            await save(step="backup")
            backup = await create_backup(db, await db.leads.count_documents({}))
            if not backup["verified"]:
                await save(state="aborted", reason="backup count does not match live leads count",
                           backup=backup, finished_at=datetime.now(timezone.utc).isoformat())
                return
        await save(step="running", backup=backup)
        report = await run_backfill(db, apply=(mode == "apply"))
        if mode == "apply":
            after_count = await db.leads.count_documents({})
            report["leads_count_before"] = backup["live_count"]
            report["leads_count_after"] = after_count
            report["lead_count_unchanged"] = after_count == backup["live_count"]
            if not report["lead_count_unchanged"]:
                await save(state="failed", step="finished", report=json_safe(report),
                           error=f"lead count changed: {backup['live_count']} -> {after_count}",
                           finished_at=datetime.now(timezone.utc).isoformat())
                return
        await save(state="done", step="finished", report=json_safe(report),
                   finished_at=datetime.now(timezone.utc).isoformat())
    except Exception as exc:  # noqa: BLE001
        await save(state="failed", error=f"{type(exc).__name__}: {exc}",
                   finished_at=datetime.now(timezone.utc).isoformat())


@router.post("/file-dates-backfill/start")
async def start_backfill(mode: str = Query("dry_run", pattern="^(dry_run|apply)$"),
                         current_user: dict = Depends(require_admin)):
    running = await db[JOBS].find_one({"state": "running"})
    if running:
        raise HTTPException(status_code=409, detail=f"job {running['job_id']} is still running")
    job_id = str(uuid.uuid4())
    await db[JOBS].insert_one({"job_id": job_id, "mode": mode, "task": "file_dates_backfill",
                               "state": "running", "step": "queued",
                               "started_by": current_user.get("email"),
                               "started_at": datetime.now(timezone.utc).isoformat()})
    asyncio.create_task(_run(job_id, mode))
    return {"job_id": job_id, "mode": mode, "state": "running"}


@router.get("/jobs/{job_id}")
async def job_status(job_id: str, current_user: dict = Depends(require_admin)):
    job = await db[JOBS].find_one({"job_id": job_id}, {"_id": 0})
    if not job:
        raise HTTPException(status_code=404, detail="job not found")
    return json_safe(job)
