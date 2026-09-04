#!/usr/bin/env python3
"""Bank name cleanup - map legacy misspellings onto the canonical lender list.

DRY RUN by default (writes nothing). Pass --apply to rewrite the stored eligibility bank fields.

    python3 scripts/bank_name_cleanup.py                 # report only
    python3 scripts/bank_name_cleanup.py --apply         # rewrite this environment
    MONGO_URL=<prod> DB_NAME=<prod> python3 scripts/bank_name_cleanup.py   # production report
"""
import asyncio, os, sys, collections
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv
load_dotenv('/app/backend/.env')
sys.path.insert(0, '/app/backend')
from utils.bank_names import canonical_bank_name, NON_LENDER, normalize_key  # noqa: E402

BANK_FIELDS = ('bank_name', 'login_bank', 'approved_bank', 'declined_bank', 'disbursed_bank')
APPLY = '--apply' in sys.argv


async def main():
    db = AsyncIOMotorClient(os.environ['MONGO_URL'])[os.environ['DB_NAME']]
    master = {b for b in await db.bank_policies.distinct('bank_name') if b}

    files = await db.leads.find(
        {'status': 'file', 'eligibilities.0': {'$exists': True}},
        {'id': 1, 'eligibilities': 1}
    ).to_list(20000)

    mapped = collections.Counter()
    unchanged = collections.Counter()
    not_lender = collections.Counter()
    changes = []

    for doc in files:
        rows = doc.get('eligibilities') or []
        touched = False
        for row in rows:
            for field in BANK_FIELDS:
                raw = (row.get(field) or '').strip()
                if not raw:
                    continue
                canonical = canonical_bank_name(raw)
                if canonical != raw:
                    mapped[(raw, canonical)] += 1
                    row[field] = canonical
                    touched = True
                elif normalize_key(raw) in NON_LENDER:
                    not_lender[raw] += 1
                else:
                    unchanged[raw] += 1
        if touched:
            changes.append((doc['_id'], rows))

    print(f"files with eligibilities : {len(files)}")
    print(f"documents to update      : {len(changes)}")
    print(f"values to rewrite        : {sum(mapped.values())}")
    print(f"values already canonical : {sum(unchanged.values())}")
    print(f"non-lender values kept   : {sum(not_lender.values())} {sorted(not_lender)}\n")

    print("PROPOSED MAPPING (count | stored -> canonical | in policy master?)")
    for (raw, canonical), count in sorted(mapped.items(), key=lambda kv: -kv[1]):
        print(f"  {count:4d} | {raw:22s} -> {canonical:26s} | {'yes' if canonical in master else 'NOT in master'}")

    leftovers = {name: c for name, c in unchanged.items() if name not in master}
    if leftovers:
        print("\nLEFT AS TYPED (already canonical spelling but not in the policy master):")
        for name, count in sorted(leftovers.items(), key=lambda kv: -kv[1]):
            print(f"  {count:4d} | {name}")

    if not APPLY:
        print("\nDRY RUN - nothing was written. Re-run with --apply to persist these mappings.")
        return 0

    updated = 0
    for _id, rows in changes:
        res = await db.leads.update_one({'_id': _id}, {'$set': {'eligibilities': rows}})
        updated += res.modified_count
    print(f"\nAPPLIED: {updated} documents updated.")
    return 0


sys.exit(asyncio.run(main()))
