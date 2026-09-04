#!/usr/bin/env python3
"""Diagnose why User Management shows the same person twice. Read-only."""
import asyncio, os, sys
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv
load_dotenv('/app/backend/.env')
sys.path.insert(0, '/app/backend')
from utils.hierarchy import UserIndex, _doc_keys  # noqa: E402

NAMES = ['Asma', 'Karuna', 'Nithin', 'Praveen', 'Sharanya', 'Saikiran', 'Meghana']
FIELDS = ['name', 'email', '_id', 'id', 'connect_id', 'legacy_user_id', 'source',
          'is_active', 'role', 'manager_id', 'tl_id', 'created_at']


async def main():
    client = AsyncIOMotorClient(os.environ['MONGO_URL'])
    db = client[os.environ['DB_NAME']]
    docs = await db.users.find({}).to_list(5000)
    print(f"total user documents: {len(docs)}")

    index = UserIndex([{**d, 'has_login': bool(d.get('password') or d.get('password_hash'))} for d in docs])

    # duplicate detection by person group and by email
    groups = {}
    for d in docs:
        root = index.root_for(str(d['_id']))
        groups.setdefault(root, []).append(d)
    multi = {r: g for r, g in groups.items() if len(g) > 1}
    print(f"persons with >1 document: {len(multi)}  (documents involved: {sum(len(g) for g in multi.values())})")

    emails = {}
    for d in docs:
        e = (d.get('email') or '').strip().lower()
        if e:
            emails.setdefault(e, []).append(d)
    dup_emails = {e: g for e, g in emails.items() if len(g) > 1}
    print(f"emails shared by >1 document: {len(dup_emails)}")

    dup_ids = {}
    for d in docs:
        if d.get('id'):
            dup_ids.setdefault(d['id'], []).append(d)
    print(f"`id` values shared by >1 document: {len([1 for g in dup_ids.values() if len(g) > 1])}")

    def show(group):
        for d in sorted(group, key=lambda x: str(x.get('created_at'))):
            row = {f: d.get(f) for f in FIELDS}
            row['_id'] = str(d['_id'])
            row['cred'] = 'password' if d.get('password') else ('password_hash' if d.get('password_hash') else 'NONE')
            row['keys'] = _doc_keys(d)
            print('   ', row)
        primary = index.canonical_doc(str(group[0]['_id']))
        print('    -> canonical/current:', str(primary['_id']), primary.get('email'), 'active=', primary.get('is_active'))

    print("\n==== reported duplicate examples ====")
    for name in NAMES:
        matched = [d for d in docs if name.lower() in str(d.get('name', '')).lower()]
        if not matched:
            continue
        print(f"\n{name}: {len(matched)} document(s)")
        show(matched)

    print("\n==== all persons currently rendering as >1 row ====")
    for root, g in list(multi.items()):
        names = sorted({str(d.get('name')) for d in g})
        actives = [bool(d.get('is_active')) for d in g]
        creds = [bool(d.get('password') or d.get('password_hash')) for d in g]
        print(f"  {names} docs={len(g)} active={actives} credential={creds} "
              f"emails={sorted({(d.get('email') or '').lower() for d in g})}")

asyncio.run(main())
