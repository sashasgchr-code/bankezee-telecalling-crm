"""
Meta legacy-binary migration over HTTPS (chunked). Bridges the two ISOLATED deployments: the OLD
Meta job streams the exported GridFS dump to Connect, and Connect writes the binaries into its own
`meta_fs` bucket (no cross-cluster Mongo networking needed).

Upload parts are staged in MongoDB (collection `meta_upload_parts`) so the flow is pod-independent
behind a load balancer (no reliance on pod-local disk).

Auth mirrors /api/meta/admin/seed-production: EITHER X-Seed-Secret == WEBHOOK_CRON_SECRET, OR an
admin bearer token. Idempotent. Never touches non-Meta Connect collections. Never touches the source.

Endpoints (all under /api/meta/admin/legacy-binaries):
  POST /upload-part   multipart: upload_id, part_index, file   -> stages a dump chunk in Mongo
  POST /import        json: {upload_id}                        -> assembles + imports + verifies
  GET  /verify                                                 -> destination verification report
"""
import os
import gzip
import json
import base64
import hashlib
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Header
from bson import Binary, ObjectId

from utils.database import db

router = APIRouter(prefix="/api/meta/admin/legacy-binaries", tags=["Meta Legacy Migration"])

CHUNK_SIZE = 261120  # GridFS default chunk size


async def require_migrate_auth(x_seed_secret: Optional[str] = Header(None),
                               authorization: Optional[str] = Header(None)):
    import jwt as _jwt
    from utils.auth import SECRET_KEY, ALGORITHM
    secret = os.environ.get("WEBHOOK_CRON_SECRET")
    if secret and x_seed_secret and x_seed_secret == secret:
        return {"via": "seed-secret"}
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Provide X-Seed-Secret header or an admin bearer token")
    try:
        payload = _jwt.decode(authorization.split(" ", 1)[1], SECRET_KEY, algorithms=[ALGORITHM])
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")
    uid = payload.get("user_id")
    u = None
    if uid:
        try:
            u = await db.users.find_one({"_id": ObjectId(uid)})
        except Exception:
            u = await db.users.find_one({"id": uid})
    if not u or (u.get("role") or "").strip().lower() != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    return {"via": "admin-jwt"}


def _load_expected() -> list:
    seed = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "meta_seed.json.gz")
    if not os.path.exists(seed):
        raise HTTPException(status_code=500, detail="Seed bundle not found in deployment")
    d = json.loads(gzip.open(seed, "rt", encoding="utf-8").read())
    out = []
    for f in d.get("meta_fs.files", []):
        meta = f.get("metadata")
        if isinstance(meta, str):
            try:
                meta = eval(meta, {"__builtins__": {}}, {})
            except Exception:
                meta = {}
        out.append({"id": str(f.get("_id")), "filename": f.get("filename"),
                    "content_type": (meta or {}).get("content_type"), "length": int(f.get("length") or 0)})
    return out


def _safe_id(upload_id: str) -> str:
    if not upload_id or not all(c.isalnum() or c in "-_" for c in upload_id):
        raise HTTPException(status_code=400, detail="Invalid upload_id")
    return upload_id


@router.post("/upload-part")
async def upload_part(upload_id: str = Form(...), part_index: int = Form(...),
                      file: UploadFile = File(...), _auth=Depends(require_migrate_auth)):
    upload_id = _safe_id(upload_id)
    data = await file.read()
    await db.meta_upload_parts.replace_one(
        {"upload_id": upload_id, "part_index": int(part_index)},
        {"upload_id": upload_id, "part_index": int(part_index), "data": Binary(data), "size": len(data)},
        upsert=True,
    )
    parts = await db.meta_upload_parts.count_documents({"upload_id": upload_id})
    return {"ok": True, "upload_id": upload_id, "part_index": part_index, "bytes": len(data), "parts_received": parts}


async def _assemble(upload_id: str) -> bytes:
    parts = await db.meta_upload_parts.find({"upload_id": upload_id}).sort("part_index", 1).to_list(100000)
    if not parts:
        raise HTTPException(status_code=404, detail="No uploaded parts for this upload_id")
    return b"".join(bytes(p["data"]) for p in parts)


async def _import_bytes(gz_bytes: bytes) -> dict:
    try:
        text = gzip.decompress(gz_bytes).decode("utf-8")
    except (OSError, EOFError, gzip.BadGzipFile) as e:
        raise HTTPException(status_code=400, detail=f"Dump unreadable (upload incomplete/corrupt): {e}")
    counts = {"copied": 0, "skip": 0, "mismatch": 0}
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        rec = json.loads(line)
        doc_id = rec["id"]
        content = base64.b64decode(rec["data"])
        if rec.get("md5") and hashlib.md5(content).hexdigest() != rec["md5"]:
            counts["mismatch"] += 1
            continue
        if rec.get("length") and len(content) != int(rec["length"]):
            counts["mismatch"] += 1
            continue
        mf = await db["meta_fs.files"].find_one({"_id": doc_id})
        existing = await db["meta_fs.chunks"].count_documents({"files_id": doc_id})
        if existing and mf and not mf.get("binary_pending"):
            counts["skip"] += 1
            continue
        cs = int((mf or {}).get("chunkSize") or CHUNK_SIZE)
        await db["meta_fs.chunks"].delete_many({"files_id": doc_id})
        docs = [{"files_id": doc_id, "n": i // cs, "data": Binary(content[i:i + cs])}
                for i in range(0, max(len(content), 1), cs)] or [{"files_id": doc_id, "n": 0, "data": Binary(b"")}]
        await db["meta_fs.chunks"].insert_many(docs)
        await db["meta_fs.files"].update_one({"_id": doc_id}, {"$set": {
            "binary_pending": False, "length": len(content), "md5": hashlib.md5(content).hexdigest()}})
        counts["copied"] += 1
    return counts


async def _verify_report() -> dict:
    expected = _load_expected()
    exp_ids = {e["id"] for e in expected}
    fcol, ccol = db["meta_fs.files"], db["meta_fs.chunks"]
    nfiles = await fcol.count_documents({})
    nchunks = await ccol.count_documents({})
    matched = missing = corrupt = pending = 0
    total = 0
    miss = []
    for e in expected:
        f = await fcol.find_one({"_id": e["id"]})
        if not f:
            missing += 1
            miss.append(e["id"])
            continue
        matched += 1
        if f.get("binary_pending"):
            pending += 1
        chunks = await ccol.find({"files_id": e["id"]}).sort("n", 1).to_list(100000)
        blen = sum(len(bytes(c["data"])) for c in chunks)
        total += blen
        flen = int(f.get("length") or 0)
        if len(chunks) == 0 or (flen and blen != flen):
            corrupt += 1
    dest_ids = set(await fcol.distinct("_id"))
    extra = len(dest_ids - exp_ids)
    orphan = 0
    for fid in await ccol.distinct("files_id"):
        if await fcol.count_documents({"_id": fid}, limit=1) == 0:
            orphan += 1
    healthy = (matched == len(expected) and missing == 0 and corrupt == 0 and orphan == 0 and pending == 0)
    return {
        "meta_fs_files": nfiles, "meta_fs_chunks": nchunks, "total_bytes": total,
        "expected": len(expected), "matched": matched, "missing": missing, "missing_ids": miss[:20],
        "extra": extra, "corrupt_or_no_chunks": corrupt, "orphaned_chunk_groups": orphan,
        "binary_pending_remaining": pending,
        "id_diff_missing": len(exp_ids - dest_ids), "id_diff_extra": extra,
        "destination_healthy": healthy,
    }


@router.post("/import")
async def import_upload(payload: dict, _auth=Depends(require_migrate_auth)):
    upload_id = _safe_id((payload or {}).get("upload_id", ""))
    gz_bytes = await _assemble(upload_id)
    counts = await _import_bytes(gz_bytes)
    report = await _verify_report()
    await db.meta_upload_parts.delete_many({"upload_id": upload_id})
    return {"import": counts, "verification": report}


@router.get("/verify")
async def verify(_auth=Depends(require_migrate_auth)):
    return await _verify_report()
