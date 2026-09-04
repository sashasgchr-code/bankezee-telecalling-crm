#!/usr/bin/env python3
"""Production-shaped fixture gate.

Preview data is uniform (every user has an `id`, every lead is legacy). Production is not,
and twice now that difference hid a real bug from a green Preview gate. This script plants
production-shaped documents in the PREVIEW database, exercises the API against them, then
removes them.

Fixtures created (all tagged so cleanup is exact):
  U1  user with NO `id` field            -> only referencable by str(_id)   (broke the TL dropdown)
  U2  user with a UUID `id`              -> ObjectId() crashes on it        (broke /leads/assign)
  U3  legacy user whose `id` != str(_id) -> the assign 404 case
  L1  lead with a UUID `id`              -> ObjectId() crashes on it        (broke call start)
  L2  legacy file with no `id`, NaN floats and a nested ObjectId            (broke the Files list)

Usage: python3 fixture_gate.py            (preview only - refuses any other host)
"""
import asyncio, json, os, sys, urllib.request, urllib.error, uuid
from datetime import datetime, timezone
from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv('/app/backend/.env')
BASE = 'https://responsive-crm-app-1.preview.emergentagent.com'
UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
TAG = '__fixture_gate__'
rows = []


def req(p, t=None, m='GET', b=None):
    r = urllib.request.Request(BASE + p, method=m)
    r.add_header('Content-Type', 'application/json')
    r.add_header('User-Agent', UA)
    if t:
        r.add_header('Authorization', 'Bearer ' + t)
    try:
        with urllib.request.urlopen(r, json.dumps(b).encode() if b else None, timeout=120) as z:
            return z.status, json.loads(z.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:160]
    except Exception as e:
        return 0, str(e)


def check(name, ok, detail=''):
    rows.append((bool(ok), name, detail))
    print(f"[{'PASS' if ok else 'FAIL'}] {name:56s} {detail}")


async def seed(db):
    await purge(db)
    mgr = await db.users.find_one({'email': 'teja@bankezee.com'})
    mgr_id = mgr.get('id') or str(mgr['_id'])
    now = datetime.now(timezone.utc)
    base = {'fixture_tag': TAG, 'is_active': True, 'role': 'growth_partner',
            'password': '$2b$12$fixtureonlynotarealhashvaluexxxxxxxxxxxxxxxxxxxxxxxxx',
            'created_at': now}

    u1 = await db.users.insert_one({**base, 'name': 'FixtureNoIdTL', 'email': f'{TAG}.noid@x.test',
                                    'is_tl': True, 'manager_id': mgr_id})            # no `id` field
    u2 = await db.users.insert_one({**base, 'id': str(uuid.uuid4()), 'name': 'FixtureUuidGP',
                                    'email': f'{TAG}.uuid@x.test', 'manager_id': mgr_id})
    u3 = await db.users.insert_one({**base, 'id': str(ObjectId()), 'name': 'FixtureLegacyGP',
                                    'email': f'{TAG}.legacy@x.test', 'manager_id': mgr_id})
    l1 = await db.leads.insert_one({'fixture_tag': TAG, 'id': str(uuid.uuid4()), 'name': 'FixtureUuidLead',
                                    'phone': '9000000101', 'status': 'new', 'created_at': now})
    l2 = await db.leads.insert_one({'fixture_tag': TAG, 'name': 'FixtureLegacyFile', 'status': 'file',
                                    'file_status': 'disbursed', 'phone': float('nan'),
                                    'file_details': {'ref': ObjectId(), 'net_salary': float('inf')},
                                    'eligibilities': [{'bank_name': 'HDFC', 'ref': ObjectId()}],
                                    'updated_at': datetime(2099, 1, 1)})               # no `id` field
    return {
        'u1_no_id': str(u1.inserted_id),
        'u2_uuid': (await db.users.find_one({'_id': u2.inserted_id}))['id'],
        'u3_legacy_id': (await db.users.find_one({'_id': u3.inserted_id}))['id'],
        'u3_real_id': str(u3.inserted_id),
        'l1_uuid': (await db.leads.find_one({'_id': l1.inserted_id}))['id'],
        'l2_no_id': str(l2.inserted_id),
        'mgr_id': mgr_id,
    }


async def purge(db):
    a = (await db.users.delete_many({'fixture_tag': TAG})).deleted_count
    b = (await db.leads.delete_many({'fixture_tag': TAG})).deleted_count
    c = (await db.call_sessions.delete_many({'lead_name': 'FixtureUuidLead'})).deleted_count
    return a, b, c


async def main():
    if 'preview.emergentagent.com' not in BASE:
        sys.exit('refusing to run against anything but preview')
    db = AsyncIOMotorClient(os.environ['MONGO_URL'])[os.environ['DB_NAME']]
    ids = await seed(db)
    print('fixtures:', json.dumps(ids, indent=1), '\n')
    try:
        s, d = req('/api/auth/login', m='POST', b={'email': 'admin@bankezee.com', 'password': 'ConnectSasha12!!'})
        A = d.get('access_token') or d.get('token')

        # U1 - a TL with no `id` field must still be selectable
        s, tls = req(f"/api/users/team-leads?manager_id={ids['mgr_id']}", A)
        fixture_tl = [t for t in tls if t.get('name') == 'FixtureNoIdTL'] if isinstance(tls, list) else []
        check('TL with no `id` field is returned', bool(fixture_tl), f'HTTP {s}')
        check('  ...and carries a usable option value',
              bool(fixture_tl and fixture_tl[0].get('id') == ids['u1_no_id']),
              fixture_tl[0].get('id') if fixture_tl else 'missing')
        check('  ...default "No Team Lead" option still present',
              any(t.get('id') is None for t in tls) if isinstance(tls, list) else False)

        # L1 - starting a call on a UUID lead
        s, r = req('/api/call-sessions/start', A, 'POST', {'lead_id': ids['l1_uuid'], 'source': 'mobile'})
        check('start call on UUID-id lead', s == 200, f'HTTP {s} {str(r)[:70]}')
        session_id = r.get('id') if isinstance(r, dict) else None
        if session_id:
            s, r2 = req('/api/call-sessions/end', A, 'POST',
                        {'session_id': session_id, 'outcome': 'connected', 'notes': 'fixture'})
            check('end that call session', s == 200, f'HTTP {s}')
        s, r = req('/api/call-sessions/start', A, 'POST', {'lead_id': 'totally-not-an-id', 'source': 'mobile'})
        check('bogus lead id -> 404 not 500', s == 404, f'HTTP {s} {str(r)[:60]}')
        req('/api/call-sessions/cancel', A, 'POST', {})
        s, r = req(f"/api/leads/{ids['l1_uuid']}/call-logs", A)
        check('lead call-logs by UUID id', s == 200, f'HTTP {s}')

        # U2 / U3 - assignment to UUID and legacy ids
        for label, uid in [('UUID-id user', ids['u2_uuid']), ('legacy id != _id user', ids['u3_legacy_id'])]:
            s, r = req('/api/leads/assign', A, 'POST', {'lead_ids': [ids['l1_uuid']], 'user_id': uid})
            check(f'assign lead to {label}', s == 200, f'HTTP {s} {str(r)[:70]}')

        # L2 - the legacy file with NaN + nested ObjectId must not break the list or detail
        s, d2 = req('/api/files/?page=1&limit=50', A)
        check('files list survives NaN/ObjectId legacy row', s == 200,
              f"HTTP {s} total={d2['pagination']['total'] if s == 200 else d2}")
        s, one = req(f"/api/files/{ids['l2_no_id']}", A)
        check('file detail by _id (no `id` field)', s == 200,
              f"HTTP {s} name={one.get('name') if isinstance(one, dict) else str(one)[:50]}")
        for suffix in ['eligibilities', 'activities']:
            s, _ = req(f"/api/files/{ids['l2_no_id']}/{suffix}", A)
            check(f'  file {suffix} by _id', s == 200, f'HTTP {s}')
        s, r = req(f"/api/files/{ids['l2_no_id']}/notes", A, 'POST', {'note': 'fixture note'})
        check('  add note to legacy file by _id', s == 200, f'HTTP {s}')

        # daily tracking must tolerate a UUID user id
        s, _ = req(f"/api/reports/daily-tracking-sheet?user_id={ids['u2_uuid']}&month=9&year=2026", A)
        check('tracking sheet with UUID user id', s == 200, f'HTTP {s}')
    finally:
        print('\ncleanup (users, leads, sessions):', await purge(db))
        print('users now:', await db.users.count_documents({}), '| leads now:', await db.leads.count_documents({}))

    fails = [r for r in rows if not r[0]]
    print(f'\n==== {len(rows) - len(fails)}/{len(rows)} PASS, {len(fails)} FAIL ====')
    for f in fails:
        print('  FAIL', f[1], '|', f[2])
    sys.exit(1 if fails else 0)


asyncio.run(main())
