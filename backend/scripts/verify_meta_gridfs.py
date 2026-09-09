#!/usr/bin/env python3
"""OLD Meta production GridFS verification - READ ONLY. No writes, no exports, no config changes."""
import os, re, gzip, json, base64, hashlib
try:
    from bson import ObjectId
    from pymongo import MongoClient
except Exception as e:
    raise SystemExit("pymongo/bson missing: run this in the Meta backend venv (it ships with motor/pymongo). "+str(e))

# --- embedded 149 expected records from the Connect migration seed ---
EXPECTED = json.loads(gzip.decompress(base64.b64decode("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")))

def load_conn():
    url = os.environ.get("MONGO_URL"); dbn = os.environ.get("DB_NAME")
    if not url or not dbn:
        for p in ("/app/backend/.env", "backend/.env", ".env"):
            if os.path.exists(p):
                env = open(p).read()
                if not url:
                    m = re.search(r'MONGO_URL="?([^"\n]+)"?', env); url = m.group(1).strip() if m else url
                if not dbn:
                    m = re.search(r'DB_NAME="?([^"\n]+)"?', env); dbn = m.group(1).strip() if m else dbn
                break
    if not url or not dbn:
        raise SystemExit("Could not resolve MONGO_URL/DB_NAME from env or backend/.env")
    return MongoClient(url), dbn

def detect_buckets(db):
    cols = db.list_collection_names()
    return sorted({c[:-6] for c in cols if c.endswith(".files") and (c[:-6]+".chunks") in cols})

def main():
    client, dbn = load_conn()
    db = client[dbn]
    print("="*60)
    print("SOURCE DB NAME:", dbn)
    buckets = detect_buckets(db)
    print("GridFS buckets found:", buckets or "(none)")
    # pick the bucket that holds the most files (or SOURCE_BUCKET override)
    bucket = os.environ.get("SOURCE_BUCKET") or (max(buckets, key=lambda b: db[b+".files"].estimated_document_count()) if buckets else "fs")
    fcol, ccol = db[bucket+".files"], db[bucket+".chunks"]
    nfiles = fcol.count_documents({}); nchunks = ccol.count_documents({})
    total = sum((x.get("length") or 0) for x in fcol.find({}, {"length": 1}))
    print("IDENTIFIED BUCKET:", bucket)
    print("fs.files count :", nfiles)
    print("fs.chunks count:", nchunks)
    print("total binary size: %d bytes (%.2f MB)" % (total, total/1048576.0))
    print("-"*60)
    matched=missing=align=corrupt=0; missing_ids=[]
    file_ids_seen=set()
    for e in EXPECTED:
        doc=None; fid=None
        for cand in ([ObjectId(e["id"])] if len(e["id"])==24 and re.fullmatch(r"[0-9a-fA-F]{24}", e["id"]) else []) + [e["id"]]:
            doc = fcol.find_one({"_id": cand})
            if doc: fid=cand; break
        if not doc:
            missing+=1; missing_ids.append(e["id"]); continue
        matched+=1; file_ids_seen.add(fid)
        smeta = doc.get("metadata") or {}
        sct = (smeta.get("content_type") if isinstance(smeta,dict) else None) or doc.get("contentType")
        slen = doc.get("length") or 0
        if (e["filename"] and doc.get("filename") and e["filename"]!=doc.get("filename")) or \
           (e["length"] and slen and e["length"]!=slen) or (e["content_type"] and sct and e["content_type"]!=sct):
            align+=1
        chunks = list(ccol.find({"files_id": fid}).sort("n",1))
        blen = sum(len(bytes(c["data"])) for c in chunks)
        if len(chunks)==0 or (slen and blen!=slen):
            corrupt+=1
    # orphaned chunks: chunks whose files_id has no files doc (sample check on distinct files_id)
    orphan=0
    for f_id in ccol.distinct("files_id"):
        if fcol.count_documents({"_id": f_id}, limit=1)==0:
            orphan+=1
    print("EXPECTED 149 match:")
    print("  matched         :", matched)
    print("  MISSING         :", missing, ("-> "+", ".join(missing_ids[:10])+(" ..." if len(missing_ids)>10 else "")) if missing_ids else "")
    print("  filename/ctype/len mismatches:", align)
    print("  corrupt/no-chunks:", corrupt)
    print("  orphaned chunk groups (files_id w/o file):", orphan)
    confirmed = (nfiles>0 and nchunks>0 and missing==0 and corrupt==0)
    print("-"*60)
    print("SOURCE BUCKET POSITIVELY CONFIRMED:", "YES" if confirmed else "NO")
    print("(READ ONLY - nothing was written, exported, or changed.)")

if __name__=="__main__":
    main()
