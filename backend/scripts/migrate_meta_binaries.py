#!/usr/bin/env python3
"""
Migrate the 149 legacy Meta document BINARIES from the OLD Meta app's GridFS into Connect's
isolated `meta_fs` bucket. Preserves file IDs + metadata. NEVER modifies the source.

The 149 expected records (ids/filenames/lengths/content-types) are read from the bundled seed
`backend/data/meta_seed.json.gz`, so this script is fully self-contained and can run inside EITHER
deployment without needing to reach the other app's database.

The OLD Meta app (source) and Connect (dest) are ISOLATED deployments that cannot see each other's
DB. Bridge the copy with a portable dump file:

  # --- On the OLD META job (source; its backend/.env MONGO_URL is the source GridFS) ---
  python3 scripts/migrate_meta_binaries.py --verify --source-local
  python3 scripts/migrate_meta_binaries.py --export-dump /tmp/meta_binaries.jsonl.gz --source-local

  # --- On the CONNECT job (dest) ---
  python3 scripts/migrate_meta_binaries.py --import-dump /tmp/meta_binaries.jsonl.gz

If both DBs happen to be reachable from one place, a direct copy is also supported:
  SOURCE_MONGO_URL=... SOURCE_DB=... python3 scripts/migrate_meta_binaries.py --verify
  SOURCE_MONGO_URL=... SOURCE_DB=... python3 scripts/migrate_meta_binaries.py --copy

Source bucket prefix defaults to `fs`; override with SOURCE_BUCKET. Join key: expected `_id`
(hex string) == source `{bucket}.files._id`, matched as ObjectId(hex) first then raw string.
Copy/import verify byte length (and md5 when available) before flipping binary_pending -> False.
"""
import os
import re
import sys
import gzip
import json
import base64
import asyncio
import hashlib
from bson import ObjectId, Binary
from motor.motor_asyncio import AsyncIOMotorClient

HERE = os.path.dirname(__file__)
BACKEND_ENV = os.path.join(HERE, "..", ".env")
SEED_PATH = os.path.join(HERE, "..", "data", "meta_seed.json.gz")


def _local_conn():
    env = open(BACKEND_ENV).read()
    url = re.search(r'MONGO_URL="?([^"\n]+)"?', env).group(1).strip()
    dbn = re.search(r'DB_NAME="?([^"\n]+)"?', env).group(1).strip()
    return AsyncIOMotorClient(url)[dbn], dbn


def _dest_conn():
    """Destination = Connect. Prefer DEST_MONGO_URL/DEST_DB env (for a direct copy launched from the
    OLD Meta job into Connect production); otherwise fall back to this pod's backend/.env."""
    url = os.environ.get("DEST_MONGO_URL")
    dbn = os.environ.get("DEST_DB")
    if url and dbn:
        return AsyncIOMotorClient(url)[dbn], dbn
    return _local_conn()


def _load_expected():
    """The 149 expected legacy docs from the bundled seed: [{id, filename, content_type, length}]."""
    d = json.loads(gzip.open(SEED_PATH).read())
    out = []
    for f in d.get("meta_fs.files", []):
        meta = f.get("metadata")
        if isinstance(meta, str):
            try:
                meta = eval(meta, {"__builtins__": {}}, {})
            except Exception:
                meta = {}
        out.append({
            "id": str(f.get("_id")),
            "filename": f.get("filename"),
            "content_type": (meta or {}).get("content_type"),
            "length": int(f.get("length") or 0),
        })
    return out


def _src_ids(doc_id: str):
    ids = [doc_id]
    try:
        ids.insert(0, ObjectId(doc_id))
    except Exception:
        pass
    return ids


async def _load_source_file(src, bucket, doc_id):
    for sid in _src_ids(doc_id):
        f = await src[f"{bucket}.files"].find_one({"_id": sid})
        if f:
            return sid, f
    return None, None


async def _read_source_chunks(src, bucket, files_id):
    chunks = await src[f"{bucket}.chunks"].find({"files_id": files_id}).sort("n", 1).to_list(100000)
    return b"".join(bytes(c["data"]) for c in chunks), len(chunks)


def _get_source(args):
    """Return (client_db, db_name, label). --source-local uses backend/.env; else SOURCE_* env."""
    if "--source-local" in args:
        db, dbn = _local_conn()
        return db, dbn, "backend/.env (source-local)"
    url = os.environ.get("SOURCE_MONGO_URL")
    dbn = os.environ.get("SOURCE_DB")
    if not url or not dbn:
        print("ABORT: provide SOURCE_MONGO_URL + SOURCE_DB, or pass --source-local to use backend/.env.")
        sys.exit(2)
    return AsyncIOMotorClient(url)[dbn], dbn, "SOURCE_MONGO_URL"


async def do_verify(args):
    bucket = os.environ.get("SOURCE_BUCKET", "fs")
    src, src_dbn, label = _get_source(args)
    expected = _load_expected()
    print(f"SOURCE via {label}: db='{src_dbn}' bucket='{bucket}'")
    sfiles = await src[f"{bucket}.files"].count_documents({})
    schunks = await src[f"{bucket}.chunks"].count_documents({})
    print(f"  {bucket}.files={sfiles}  {bucket}.chunks={schunks}")
    if sfiles == 0 or schunks == 0:
        print(f"  !! bucket '{bucket}' has no files/chunks — NOT POSITIVELY CONFIRMED. Try SOURCE_BUCKET=<name>.")
    print(f"EXPECTED (bundled seed): {len(expected)} legacy docs")
    matched = missing = align_bad = corrupt = 0
    total_bytes = 0
    for e in expected:
        sid, sfile = await _load_source_file(src, bucket, e["id"])
        if not sfile:
            missing += 1
            continue
        matched += 1
        slen = int(sfile.get("length") or 0)
        total_bytes += slen
        # filename / content_type / length alignment
        smeta = sfile.get("metadata") or {}
        sct = (smeta.get("content_type") if isinstance(smeta, dict) else None) or sfile.get("contentType")
        if (e["filename"] and sfile.get("filename") and e["filename"] != sfile.get("filename")) \
           or (e["length"] and slen and e["length"] != slen) \
           or (e["content_type"] and sct and e["content_type"] != sct):
            align_bad += 1
        _, nchunks = await _read_source_chunks(src, bucket, sid)
        if nchunks == 0 or (slen and (await _read_source_chunks(src, bucket, sid))[0].__len__() != slen):
            corrupt += 1
    positively_confirmed = (missing == 0 and corrupt == 0 and sfiles > 0 and schunks > 0)
    print("\n=== VERIFY SUMMARY (read-only, nothing written) ===")
    print(f"  matched={matched}  missing={missing}  filename/ctype/len mismatches={align_bad}  corrupt/no-chunks={corrupt}")
    print(f"  total source binary bytes (matched)={total_bytes}")
    print(f"  SOURCE BUCKET POSITIVELY CONFIRMED: {'YES' if positively_confirmed else 'NO'}")
    if not positively_confirmed:
        print("  -> Do NOT run --export-dump/--copy until confirmed (check SOURCE_BUCKET / missing ids).")


async def do_export(args, path):
    bucket = os.environ.get("SOURCE_BUCKET", "fs")
    src, src_dbn, label = _get_source(args)
    expected = _load_expected()
    print(f"EXPORT from {label} db='{src_dbn}' bucket='{bucket}' -> {path}")
    n = 0
    with gzip.open(path, "wt") as fh:
        for e in expected:
            sid, sfile = await _load_source_file(src, bucket, e["id"])
            if not sfile:
                continue
            content, _ = await _read_source_chunks(src, bucket, sid)
            rec = {"id": e["id"], "filename": e["filename"], "content_type": e["content_type"],
                   "length": len(content), "md5": hashlib.md5(content).hexdigest(),
                   "data": base64.b64encode(content).decode()}
            fh.write(json.dumps(rec) + "\n")
            n += 1
    print(f"  wrote {n} records to {path}. Copy this file to the CONNECT job and run --import-dump.")


async def _write_dest(dest, rec):
    doc_id = rec["id"]
    content = base64.b64decode(rec["data"])
    if rec.get("md5") and hashlib.md5(content).hexdigest() != rec["md5"]:
        return "md5-mismatch"
    if rec.get("length") and len(content) != int(rec["length"]):
        return "len-mismatch"
    existing = await dest["meta_fs.chunks"].count_documents({"files_id": doc_id})
    meta_file = await dest["meta_fs.files"].find_one({"_id": doc_id})
    if existing and meta_file and not meta_file.get("binary_pending"):
        return "skip"
    chunk_size = int((meta_file or {}).get("chunkSize") or 261120)
    await dest["meta_fs.chunks"].delete_many({"files_id": doc_id})
    docs = [{"files_id": doc_id, "n": i // chunk_size, "data": Binary(content[i:i + chunk_size])}
            for i in range(0, max(len(content), 1), chunk_size)] or \
           [{"files_id": doc_id, "n": 0, "data": Binary(b"")}]
    await dest["meta_fs.chunks"].insert_many(docs)
    await dest["meta_fs.files"].update_one({"_id": doc_id}, {"$set": {
        "binary_pending": False, "length": len(content),
        "md5": hashlib.md5(content).hexdigest()}})
    return "copied"


async def do_import(path):
    dest, dest_dbn = _dest_conn()
    print(f"IMPORT into CONNECT dest db='{dest_dbn}' meta_fs from {path}")
    counts = {}
    with gzip.open(path, "rt") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            r = await _write_dest(dest, json.loads(line))
            counts[r] = counts.get(r, 0) + 1
    print("=== IMPORT SUMMARY ===", counts)
    remaining = await dest["meta_fs.files"].count_documents({"binary_pending": True})
    print(f"  meta_fs.files still binary_pending=True: {remaining}")


async def do_direct_copy(args):
    """Direct source->dest when BOTH are reachable from one place (source env vars + local dest)."""
    bucket = os.environ.get("SOURCE_BUCKET", "fs")
    src, src_dbn, label = _get_source(args)
    dest, dest_dbn = _dest_conn()
    expected = _load_expected()
    print(f"DIRECT COPY {label} db='{src_dbn}' bucket='{bucket}' -> {dest_dbn}.meta_fs")
    counts = {}
    for e in expected:
        sid, sfile = await _load_source_file(src, bucket, e["id"])
        if not sfile:
            counts["missing"] = counts.get("missing", 0) + 1
            continue
        content, _ = await _read_source_chunks(src, bucket, sid)
        rec = {"id": e["id"], "filename": e["filename"], "content_type": e["content_type"],
               "length": len(content), "md5": hashlib.md5(content).hexdigest(),
               "data": base64.b64encode(content).decode()}
        counts_r = await _write_dest(dest, rec)
        counts[counts_r] = counts.get(counts_r, 0) + 1
    print("=== COPY SUMMARY ===", counts)


async def do_verify_dest(args):
    """Full destination proof against the expected 149 (Connect meta_fs)."""
    dest, dest_dbn = _dest_conn()
    expected = _load_expected()
    exp_ids = {e["id"] for e in expected}
    fcol, ccol = dest["meta_fs.files"], dest["meta_fs.chunks"]
    nfiles = await fcol.count_documents({})
    nchunks = await ccol.count_documents({})
    print(f"DEST db='{dest_dbn}'  meta_fs.files={nfiles}  meta_fs.chunks={nchunks}")
    matched = missing = corrupt = 0
    total_bytes = 0
    pending_remaining = 0
    missing_ids = []
    for e in expected:
        f = await fcol.find_one({"_id": e["id"]})
        if not f:
            missing += 1
            missing_ids.append(e["id"])
            continue
        matched += 1
        if f.get("binary_pending"):
            pending_remaining += 1
        chunks = await ccol.find({"files_id": e["id"]}).sort("n", 1).to_list(100000)
        blen = sum(len(bytes(c["data"])) for c in chunks)
        total_bytes += blen
        flen = int(f.get("length") or 0)
        if len(chunks) == 0 or (flen and blen != flen):
            corrupt += 1
    # extra = dest meta_fs.files not in the expected 149
    dest_ids = set(await fcol.distinct("_id"))
    extra = len(dest_ids - exp_ids)
    # orphaned chunk groups (files_id with no meta_fs.files doc)
    orphan = 0
    for fid in await ccol.distinct("files_id"):
        if await fcol.count_documents({"_id": fid}, limit=1) == 0:
            orphan += 1
    diff_missing = len(exp_ids - dest_ids)
    diff_extra = extra
    print("=== DESTINATION VERIFICATION ===")
    print(f"  meta_fs.files (total)      : {nfiles}")
    print(f"  expected matched           : {matched}")
    print(f"  missing                    : {missing} {missing_ids[:10]}")
    print(f"  extra (non-expected files) : {extra}")
    print(f"  corrupt/no-chunks          : {corrupt}")
    print(f"  orphaned chunk groups      : {orphan}")
    print(f"  binary_pending remaining   : {pending_remaining}")
    print(f"  total migrated bytes       : {total_bytes}")
    print(f"  source-vs-dest ID diff     : {diff_missing} missing / {diff_extra} extra")
    ok = (matched == len(expected) and missing == 0 and corrupt == 0 and orphan == 0 and pending_remaining == 0)
    print(f"  DESTINATION HEALTHY        : {'YES' if ok else 'NO'}")


if __name__ == "__main__":
    a = sys.argv[1:]
    if "--export-dump" in a:
        asyncio.run(do_export(a, a[a.index("--export-dump") + 1]))
    elif "--import-dump" in a:
        asyncio.run(do_import(a[a.index("--import-dump") + 1]))
    elif "--verify-dest" in a:
        asyncio.run(do_verify_dest(a))
    elif "--copy" in a:
        asyncio.run(do_direct_copy(a))
    else:
        asyncio.run(do_verify(a))
