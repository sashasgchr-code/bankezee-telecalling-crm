"""TEMPORARY Admin-only OLD CRM -> Connect migration endpoint.

Runs inside the deployed app so it uses the deployment's own MONGO_URL. Dry run is the default;
`mode=apply` writes only after a verified full backup of the leads collection and a pre-flight
that refuses to write if anything is classified UNSAFE.
REMOVE THIS ROUTER once the production migration is signed off.
"""
from fastapi import APIRouter, Depends, HTTPException, Query

from utils.auth import require_admin
from utils.crm_migration import POLICY_CONNECT_WINS, POLICY_EXPORT_WINS, run_migration
from utils.database import db
from utils.json_safe import json_safe

router = APIRouter(prefix="/api/admin", tags=["admin-migration"])


@router.post("/crm-migration")
async def crm_migration(mode: str = Query("dry_run", pattern="^(dry_run|apply)$"),
                        policy: str = Query(POLICY_CONNECT_WINS,
                                            pattern=f"^({POLICY_CONNECT_WINS}|{POLICY_EXPORT_WINS})$"),
                        include_changes: bool = Query(False),
                        include_preserved: bool = Query(False),
                        current_user: dict = Depends(require_admin)):
    if mode == "apply":
        preflight = await run_migration(db, apply=False, policy=policy)
        unsafe = preflight.get("unsafe_differences") or []
        if unsafe:
            raise HTTPException(status_code=409, detail={
                "aborted": True, "reason": "UNSAFE differences detected - nothing written",
                "unsafe_differences": unsafe})
    report = await run_migration(db, apply=(mode == "apply"), policy=policy)
    if report.get("aborted"):
        raise HTTPException(status_code=409, detail=report)
    if not include_changes:
        report["changes_count"] = len(report.pop("changes", []))
    if not include_preserved:
        preserved = report.pop("preserved_connect_values", [])
        report["preserved_connect_values_files"] = len(preserved)
        report["preserved_connect_values_fields"] = sum(len(p["preserved"]) for p in preserved)
    return json_safe(report)
