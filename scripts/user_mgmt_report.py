#!/usr/bin/env python3
"""Before/after User Management report + dry-run cleanup proposal. READ-ONLY (no writes).

Run against any environment:
    MONGO_URL=<uri> DB_NAME=<db> python3 scripts/user_mgmt_report.py > report.md
"""
import asyncio, os, sys
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv
load_dotenv('/app/backend/.env')
sys.path.insert(0, '/app/backend')
from utils.hierarchy import UserIndex  # noqa: E402

WATCH = ['asma', 'karuna', 'nithin', 'praveen', 'sharanya', 'saikiran', 'masula']


def cred(d):
    return 'password' if d.get('password') else ('password_hash' if d.get('password_hash') else 'none')


def primary(docs):
    ordered = sorted(docs, key=lambda d: str(d.get('_id')))
    for d in ordered:
        if d.get('is_active') and cred(d) != 'none':
            return d
    for d in ordered:
        if d.get('is_active'):
            return d
    for d in ordered:
        if d.get('connect_id'):
            return d
    return ordered[0]


async def main():
    db = AsyncIOMotorClient(os.environ['MONGO_URL'])[os.environ['DB_NAME']]
    docs = await db.users.find({}).to_list(10000)
    index = UserIndex([{**d, 'has_login': cred(d) != 'none'} for d in docs])

    persons = {}
    for d in docs:
        persons.setdefault(index.root_for(str(d['_id'])) or str(d['_id']), []).append(d)
    multi = {r: g for r, g in persons.items() if len(g) > 1}

    print(f"# User Management duplicates - {os.environ['DB_NAME']}\n")
    print(f"- user documents: **{len(docs)}**")
    print(f"- distinct people: **{len(persons)}**")
    print(f"- people with more than one document: **{len(multi)}** "
          f"(documents involved: {sum(len(g) for g in multi.values())})")
    print(f"- rows BEFORE (one per document): **{len(docs)}** -> rows AFTER (one per person): **{len(persons)}**\n")

    print("## Before / after per duplicated person\n")
    print("| Person | rows before | rows after | account _id | id | connect_id | legacy_user_id | credential | active | role | treated as |")
    print("|---|---|---|---|---|---|---|---|---|---|---|")
    for root, group in sorted(multi.items(), key=lambda kv: str(kv[1][0].get('name'))):
        p = primary(group)
        for d in sorted(group, key=lambda x: str(x.get('_id'))):
            print(f"| {d.get('name')} | {len(group)} | 1 | `{d['_id']}` | `{d.get('id')}` | "
                  f"`{d.get('connect_id')}` | `{d.get('legacy_user_id')}` | {cred(d)} | "
                  f"{bool(d.get('is_active'))} | {d.get('role')} | "
                  f"{'**CURRENT (row + writes target this row)**' if d['_id'] == p['_id'] else 'linked account (administer explicitly)'} |")

    print("\n## Watch-list names (reported in production)\n")
    for term in WATCH:
        hits = [d for d in docs if term in str(d.get('name', '')).lower() or term in str(d.get('email', '')).lower()]
        if not hits:
            print(f"- **{term}**: no document in this database")
            continue
        roots = {index.root_for(str(d['_id'])) for d in hits}
        print(f"- **{term}**: {len(hits)} document(s), {len(roots)} person(s) -> "
              f"{len(roots)} row(s) in User Management")
        for d in sorted(hits, key=lambda x: str(x.get('_id'))):
            grp = persons[index.root_for(str(d['_id']))]
            is_primary = primary(grp)['_id'] == d['_id']
            print(f"    - `{d['_id']}` id=`{d.get('id')}` {d.get('email')} cred={cred(d)} "
                  f"active={bool(d.get('is_active'))} role={d.get('role')} "
                  f"{'<= CURRENT' if is_primary else '<= linked'}")

    print("\n## Same name, different email - NOT auto-merged\n")
    by_name = {}
    for root, group in persons.items():
        name = str(primary(group).get('name') or '').strip().lower()
        if name:
            by_name.setdefault(name, []).append(root)
    collisions = {n: rs for n, rs in by_name.items() if len(rs) > 1}
    if not collisions:
        print("None.")
    else:
        print("These are separate people to the resolver (no shared email/id/connect_id/legacy_user_id), "
              "so they stay separately administrable. Link them deliberately with the legacy->Connect "
              "mapping tool if they really are one person; the app never merges accounts on name alone.\n")
        for name, roots in sorted(collisions.items()):
            print(f"- **{name}**")
            for r in roots:
                p = primary(persons[r])
                print(f"    - `{p['_id']}` {p.get('email')} role={p.get('role')} "
                      f"active={bool(p.get('is_active'))} cred={cred(p)}")

    print("\n## Proposed cleanup - DRY RUN ONLY (nothing was written)\n")
    if not multi:
        print("No duplicate documents in this database; no cleanup needed.")
        return
    print("For every person below the application already behaves correctly without any data change "
          "(one row, writes hit the exact document). Cleanup is therefore OPTIONAL and only removes "
          "dormant legacy documents that own no records.\n")
    for root, group in sorted(multi.items(), key=lambda kv: str(kv[1][0].get('name'))):
        p = primary(group)
        for d in group:
            if d['_id'] == p['_id']:
                continue
            keys = {str(d['_id'])} | {str(d[f]) for f in ('id', 'connect_id', 'legacy_user_id') if d.get(f)}
            owned = await db.leads.count_documents({'$or': [{'source_id': {'$in': list(keys)}},
                                                            {'assigned_to': {'$in': list(keys)}}]})
            calls = await db.call_logs.count_documents({'user_id': {'$in': list(keys)}})
            action = ('KEEP (owns historical records - needed for alias resolution)'
                      if owned or calls else 'SAFE TO DELETE (owns no leads/files/calls)')
            print(f"- {d.get('name')} legacy doc `{d['_id']}` (email {d.get('email')}, cred={cred(d)}, "
                  f"active={bool(d.get('is_active'))}): leads/files={owned}, calls={calls} -> **{action}**")
    print("\nNo delete/merge was executed. Await explicit approval before running any cleanup.")

asyncio.run(main())
