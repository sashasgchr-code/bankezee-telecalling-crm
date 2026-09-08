"""
Phase 2 - Import LIVE Meta production JSON dump into ISOLATED meta_* collections
inside the Connect database. Non-destructive to all Connect data. Idempotent.

- Preserves original _id / user_id / lead_id and all relationships verbatim.
- fs.files metadata -> meta_fs.files with binary_pending=True (chunks are a separate backfill).
- Does NOT touch Connect collections (leads, users, files, etc.).
- Does NOT connect to the old Meta production DB.
"""
import asyncio, json, os, sys
from dotenv import load_dotenv
load_dotenv()
from motor.motor_asyncio import AsyncIOMotorClient

DUMP = "/tmp/meta-live/extracted"

# source json file -> destination collection
MAP = {
    "leads": "meta_leads",
    "users": "meta_users",
    "user_sessions": "meta_user_sessions",
    "meta": "meta_meta",
}


async def main():
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]

    results = {}
    for src, dest in MAP.items():
        path = os.path.join(DUMP, f"{src}.json")
        docs = json.load(open(path))
        if not isinstance(docs, list):
            docs = [docs]
        await db[dest].delete_many({})  # idempotent reload of ISOLATED meta collection only
        if docs:
            await db[dest].insert_many(docs, ordered=False)
        cnt = await db[dest].count_documents({})
        results[dest] = {"source": len(docs), "dest": cnt}

    # fs.files metadata -> meta_fs.files with binary_pending flag
    files = json.load(open(os.path.join(DUMP, "fs.files.json")))
    await db["meta_fs.files"].delete_many({})
    for f in files:
        f["binary_pending"] = True
    if files:
        await db["meta_fs.files"].insert_many(files, ordered=False)
    fcnt = await db["meta_fs.files"].count_documents({})
    results["meta_fs.files"] = {"source": len(files), "dest": fcnt}
    # chunks intentionally NOT created (pending binary backfill)
    results["meta_fs.chunks"] = {"source": 0, "dest": await db["meta_fs.chunks"].count_documents({})}

    print("=== IMPORT RESULTS (source -> dest) ===")
    ok = True
    for k, v in results.items():
        match = "OK" if v["source"] == v["dest"] else "MISMATCH"
        if v["source"] != v["dest"]:
            ok = False
        print(f"  {k:22} source={v['source']:<5} dest={v['dest']:<5} [{match}]")
    print("ALL_MATCH:", ok)


if __name__ == "__main__":
    asyncio.run(main())
