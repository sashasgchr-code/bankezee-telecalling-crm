#!/usr/bin/env python3
"""Read-only metrics over the 454 migrated files: OLD CRM export vs Connect DB.

Usage: python3 crm_migration_metrics.py <label> [out.json]
"""
import asyncio, json, os, sys
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv
sys.path.insert(0, '/app/scripts')
from crm_migration_apply import amounts, norm, blank, EXPORT  # noqa: E402
load_dotenv('/app/backend/.env')


def measure(files):
    m = dict(files=0, with_elig=0, elig_rows=0, with_login=0, with_appr=0, with_disb=0,
             approved=0.0, disbursed=0.0)
    for rows in files:
        m['files'] += 1
        rows = rows or []
        m['elig_rows'] += len(rows)
        m['with_elig'] += 1 if rows else 0
        if any(norm(r.get('login_done')) in ('yes', 'true') for r in rows):
            m['with_login'] += 1
        a, d = amounts(rows)
        m['approved'] += a
        m['disbursed'] += d
        m['with_appr'] += 1 if a else 0
        m['with_disb'] += 1 if d else 0
    return m


async def main(label, out):
    db = AsyncIOMotorClient(os.environ['MONGO_URL'])[os.environ['DB_NAME']]
    records = json.load(open(EXPORT))['data']
    ids = {str(r['old_crm_id']) for r in records}
    id_list = list(ids)
    docs = await db.leads.find({'$or': [{'id': {'$in': id_list}},
                                        {'legacy_crm_id': {'$in': id_list}},
                                        {'legacy_id': {'$in': id_list}},
                                        {'old_crm_id': {'$in': id_list}}]},
                               {'eligibilities': 1}).to_list(200000)
    result = {'label': label, 'export': measure([r.get('eligibilities') for r in records]),
              'connect': measure([d.get('eligibilities') for d in docs]),
              'connect_docs_found': len(docs),
              'total_leads': await db.leads.count_documents({})}
    print(json.dumps(result, indent=1))
    if out:
        json.dump(result, open(out, 'w'), indent=1)


asyncio.run(main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None))
