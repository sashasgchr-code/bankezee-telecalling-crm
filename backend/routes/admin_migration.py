"""TEMPORARY Admin-only OLD CRM -> Connect migration endpoints.

Runs inside the deployed app so it uses the deployment's own MONGO_URL.
  POST /api/admin/crm-migration?mode=dry_run          - synchronous, read-only report
  POST /api/admin/crm-migration/start?mode=apply      - background job (proxy caps requests at ~30s)
  GET  /api/admin/crm-migration/status/{job_id}       - job state + final report
`apply` writes only after a verified full backup of the leads collection and a pre-flight that
refuses to write if anything is classified UNSAFE.
REMOVE THIS ROUTER once the production migration is signed off.
"""
import asyncio
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query

from utils.auth import require_admin
from utils.crm_migration import POLICY_CONNECT_WINS, POLICY_EXPORT_WINS, run_migration
from utils.database import db
from utils.json_safe import json_safe

router = APIRouter(prefix="/api/admin", tags=["admin-migration"])
JOBS = "migration_jobs"
POLICY_PATTERN = f"^({POLICY_CONNECT_WINS}|{POLICY_EXPORT_WINS})$"


def trim(report, include_changes, include_preserved):
    if not include_changes:
        report["changes_count"] = len(report.pop("changes", []))
    if not include_preserved:
        preserved = report.pop("preserved_connect_values", [])
        report["preserved_connect_values_files"] = len(preserved)
        report["preserved_connect_values_fields"] = sum(len(p["preserved"]) for p in preserved)
    return report


@router.post("/crm-migration")
async def crm_migration(mode: str = Query("dry_run", pattern="^dry_run$"),
                        policy: str = Query(POLICY_CONNECT_WINS, pattern=POLICY_PATTERN),
                        include_changes: bool = Query(False),
                        include_preserved: bool = Query(False),
                        current_user: dict = Depends(require_admin)):
    report = await run_migration(db, apply=False, policy=policy)
    return json_safe(trim(report, include_changes, include_preserved))


async def _run_job(job_id, mode, policy):
    async def save(**fields):
        await db[JOBS].update_one({"job_id": job_id}, {"$set": fields})
    try:
        if mode == "apply":
            await save(step="pre-flight dry run")
            preflight = await run_migration(db, apply=False, policy=policy)
            if preflight.get("unsafe_differences"):
                await save(state="aborted", reason="UNSAFE differences detected - nothing written",
                           report=json_safe(trim(preflight, False, True)),
                           finished_at=datetime.now(timezone.utc).isoformat())
                return
        await save(step="backup + apply" if mode == "apply" else "dry run")
        report = await run_migration(db, apply=(mode == "apply"), policy=policy)
        state = "aborted" if report.get("aborted") else "done"
        await save(state=state, step="finished", report=json_safe(trim(report, False, True)),
                   finished_at=datetime.now(timezone.utc).isoformat())
    except Exception as exc:  # noqa: BLE001
        await save(state="failed", error=f"{type(exc).__name__}: {exc}",
                   finished_at=datetime.now(timezone.utc).isoformat())


@router.post("/crm-migration/start")
async def crm_migration_start(mode: str = Query("dry_run", pattern="^(dry_run|apply)$"),
                              policy: str = Query(POLICY_CONNECT_WINS, pattern=POLICY_PATTERN),
                              current_user: dict = Depends(require_admin)):
    running = await db[JOBS].find_one({"state": "running"})
    if running:
        raise HTTPException(status_code=409, detail=f"job {running['job_id']} is still running")
    job_id = str(uuid.uuid4())
    await db[JOBS].insert_one({"job_id": job_id, "mode": mode, "policy": policy,
                               "state": "running", "step": "queued",
                               "started_by": current_user.get("email"),
                               "started_at": datetime.now(timezone.utc).isoformat()})
    asyncio.create_task(_run_job(job_id, mode, policy))
    return {"job_id": job_id, "mode": mode, "policy": policy, "state": "running"}


@router.get("/crm-migration/status/{job_id}")
async def crm_migration_status(job_id: str, current_user: dict = Depends(require_admin)):
    job = await db[JOBS].find_one({"job_id": job_id}, {"_id": 0})
    if not job:
        raise HTTPException(status_code=404, detail="job not found")
    return json_safe(job)
