"""
Safe phone '.0' repair. READ-ONLY by default (dry-run). Pass --apply to write.
Only normalizes phone FIELDS whose value ends in a pure trailing '.0' artifact.
Never merges/deletes records, never touches ids/status/assignments/dates.

Usage:
  python scripts/fix_phone_dot_zero.py            # dry-run report
  python scripts/fix_phone_dot_zero.py --apply     # apply in-place
"""
import asyncio, os, sys, re
sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")
from motor.motor_asyncio import AsyncIOMotorClient
from utils.helpers import canonical_phone, normalize_phone

APPLY = "--apply" in sys.argv
DOT_ZERO = re.compile(r'\.0+$')

# (collection, [phone-like fields], optional recompute-normalized-field)
TARGETS = [
    ("leads", ["phone", "mobile"], "normalized_phone"),
    ("verified_call_logs", ["phone_number", "original_phone"], None),
    ("call_logs", ["phone", "phone_number"], None),
    ("meta_leads", ["phone", "mobile"], None),
]


async def main():
    c = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = c[os.environ["DB_NAME"]]
    print(f"DB={os.environ['DB_NAME']} MODE={'APPLY' if APPLY else 'DRY-RUN (read-only)'}")
    grand_scanned = grand_fixable = grand_skipped = grand_applied = 0
    for coll, fields, norm_field in TARGETS:
        if coll not in await db.list_collection_names():
            print(f"\n[{coll}] absent - skipped"); continue
        for field in fields:
            q = {field: {"$regex": r"\.0+$"}}
            total = await db[coll].count_documents(q)
            grand_scanned += total
            if total == 0:
                print(f"[{coll}.{field}] 0 with trailing .0"); continue
            cursor = db[coll].find(q, {field: 1, norm_field: 1} if norm_field else {field: 1})
            fixable = skipped = applied = 0
            samples = []
            canon_seen = {}  # canonical -> list of _ids (collision detection within scope)
            async for doc in cursor:
                raw = doc.get(field)
                s = str(raw).strip()
                if not DOT_ZERO.search(s):
                    skipped += 1; continue
                canon = canonical_phone(s)
                # safe only if canonical is a plausible phone (>=7 digits) and differs only by .0
                digits = re.sub(r"\D", "", canon)
                if len(digits) < 7:
                    skipped += 1; continue
                fixable += 1
                canon_seen.setdefault(canon, []).append(str(doc["_id"]))
                if len(samples) < 5:
                    samples.append((s, canon))
                if APPLY:
                    upd = {field: canon}
                    if norm_field:
                        upd[norm_field] = normalize_phone(canon)
                    await db[coll].update_one({"_id": doc["_id"]}, {"$set": upd})
                    applied += 1
            collisions = {k: v for k, v in canon_seen.items() if len(v) > 1}
            grand_fixable += fixable; grand_skipped += skipped; grand_applied += applied
            print(f"[{coll}.{field}] scanned={total} fixable={fixable} skipped={skipped} "
                  f"applied={applied} intra_scope_collisions={len(collisions)}")
            for a, b in samples:
                print(f"    e.g. {a!r} -> {b!r}")
            for k, ids in list(collisions.items())[:5]:
                print(f"    COLLISION canonical={k} ids={ids}")
    print(f"\nTOTAL scanned={grand_scanned} fixable={grand_fixable} "
          f"skipped={grand_skipped} applied={grand_applied}")

asyncio.run(main())
