#!/usr/bin/env python3
"""PRODUCTION legacy Meta GridFS copy - self-contained. RUN INSIDE THE OLD META JOB.
Reads the 149 verified binaries from THIS pod's GridFS (source = backend/.env MONGO_URL) and copies
them into Connect production meta_fs (dest = DEST_MONGO_URL/DEST_DB). Idempotent. Preserves IDs.
NEVER touches the source. NEVER touches non-Meta Connect collections.

  export DEST_MONGO_URL="<connect-production-mongo-uri>"
  export DEST_DB="<connect-production-db-name>"      # e.g. teleconnect-web-test_database
  # optional: export SOURCE_BUCKET=fs
  python3 /tmp/meta_copy_prod.py --copy       # copy then auto-verify
  python3 /tmp/meta_copy_prod.py --verify-dest  # re-verify destination only
"""
import os, re, gzip, json, base64, hashlib, sys
from bson import ObjectId, Binary
from pymongo import MongoClient

EXPECTED = json.loads(gzip.decompress(base64.b64decode("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")))

def _src():
    url=os.environ.get("MONGO_URL"); dbn=os.environ.get("DB_NAME")
    if not url or not dbn:
        for p in ("/app/backend/.env","backend/.env",".env"):
            if os.path.exists(p):
                env=open(p).read()
                url=url or (re.search(r'MONGO_URL="?([^"\n]+)"?',env) or [None,None])[1]
                dbn=dbn or (re.search(r'DB_NAME="?([^"\n]+)"?',env) or [None,None])[1]
                break
    if not url or not dbn: raise SystemExit("source MONGO_URL/DB_NAME not found")
    return MongoClient(url)[dbn.strip()]

def _dest():
    url=os.environ.get("DEST_MONGO_URL"); dbn=os.environ.get("DEST_DB")
    if not url or not dbn: raise SystemExit("Set DEST_MONGO_URL and DEST_DB (Connect production).")
    return MongoClient(url)[dbn.strip()]

def _sid(h):
    out=[]
    if len(h)==24 and re.fullmatch(r"[0-9a-fA-F]{24}",h):
        out.append(ObjectId(h))
    out.append(h); return out

def _read(src,bucket,fid):
    ch=list(src[bucket+".chunks"].find({"files_id":fid}).sort("n",1))
    return b"".join(bytes(c["data"]) for c in ch)

def copy():
    src=_src(); dest=_dest(); bucket=os.environ.get("SOURCE_BUCKET","fs")
    fcol=src[bucket+".files"]; ccol=src[bucket+".chunks"]
    print("SOURCE bucket",bucket,"files",fcol.count_documents({}),"chunks",ccol.count_documents({}))
    counts={"copied":0,"skip":0,"missing":0,"mismatch":0}
    for e in EXPECTED:
        doc=None;fid=None
        for cand in _sid(e["id"]):
            doc=fcol.find_one({"_id":cand})
            if doc: fid=cand; break
        if not doc: counts["missing"]+=1; continue
        content=_read(src,bucket,fid)
        if e["length"] and len(content)!=e["length"]:
            counts["mismatch"]+=1; continue
        mf=dest["meta_fs.files"].find_one({"_id":e["id"]})
        if dest["meta_fs.chunks"].count_documents({"files_id":e["id"]}) and mf and not mf.get("binary_pending"):
            counts["skip"]+=1; continue
        cs=int((mf or {}).get("chunkSize") or 261120)
        dest["meta_fs.chunks"].delete_many({"files_id":e["id"]})
        docs=[{"files_id":e["id"],"n":i//cs,"data":Binary(content[i:i+cs])} for i in range(0,max(len(content),1),cs)] or [{"files_id":e["id"],"n":0,"data":Binary(b"")}]
        dest["meta_fs.chunks"].insert_many(docs)
        dest["meta_fs.files"].update_one({"_id":e["id"]},{"$set":{"binary_pending":False,"length":len(content),"md5":hashlib.md5(content).hexdigest()}})
        counts["copied"]+=1
    print("COPY SUMMARY",counts)
    verify_dest()

def verify_dest():
    dest=_dest(); exp_ids={e["id"] for e in EXPECTED}
    fcol=dest["meta_fs.files"]; ccol=dest["meta_fs.chunks"]
    nf=fcol.count_documents({}); nc=ccol.count_documents({})
    matched=missing=corrupt=pending=0; total=0; miss=[]
    for e in EXPECTED:
        f=fcol.find_one({"_id":e["id"]})
        if not f: missing+=1; miss.append(e["id"]); continue
        matched+=1
        if f.get("binary_pending"): pending+=1
        ch=list(ccol.find({"files_id":e["id"]}))
        bl=sum(len(bytes(c["data"])) for c in ch); total+=bl
        fl=int(f.get("length") or 0)
        if len(ch)==0 or (fl and bl!=fl): corrupt+=1
    dest_ids=set(fcol.distinct("_id")); extra=len(dest_ids-exp_ids)
    orphan=sum(1 for fid in ccol.distinct("files_id") if fcol.count_documents({"_id":fid},limit=1)==0)
    print("=== DESTINATION VERIFICATION ===")
    print(" meta_fs.files:",nf," meta_fs.chunks:",nc," total bytes:",total)
    print(" matched:",matched," missing:",missing,miss[:10]," extra:",extra)
    print(" corrupt/no-chunks:",corrupt," orphaned:",orphan," binary_pending remaining:",pending)
    print(" source-vs-dest ID diff:",len(exp_ids-dest_ids),"missing /",extra,"extra")
    ok=(matched==len(EXPECTED) and missing==0 and corrupt==0 and orphan==0 and pending==0)
    print(" DESTINATION HEALTHY:","YES" if ok else "NO")

if __name__=="__main__":
    if "--verify-dest" in sys.argv: verify_dest()
    else: copy()
