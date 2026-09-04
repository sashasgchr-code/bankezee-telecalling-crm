#!/usr/bin/env python3
"""User Management gate - production-shaped duplicate fixtures.

Creates fixture accounts that mirror production (legacy CRM document + Connect login document
sharing one email, plus two managers whose teams must switch cleanly), proves the read model
collapses them into one row and that every Admin write touches exactly one document, then
removes every fixture. Nothing outside the `*@fixture.test` emails is modified.
"""
import asyncio, json, os, sys, urllib.request, urllib.error
from datetime import datetime, timezone
from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

BASE = (sys.argv[1] if len(sys.argv) > 1 else 'https://responsive-crm-app-1.preview.emergentagent.com').rstrip('/')
UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
ADMIN = ('admin@bankezee.com', 'ConnectSasha12!!')
FIXTURE_DOMAIN = '@fixture.test'
load_dotenv('/app/backend/.env')
results = []


def req(p, t=None, m='GET', b=None):
    r = urllib.request.Request(BASE + p, method=m)
    r.add_header('Content-Type', 'application/json')
    r.add_header('User-Agent', UA)
    if t:
        r.add_header('Authorization', 'Bearer ' + t)
    try:
        with urllib.request.urlopen(r, json.dumps(b).encode() if b else None, timeout=300) as z:
            return z.status, json.loads(z.read().decode())
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode())
        except Exception:
            return e.code, None


def check(name, ok, detail=''):
    results.append((name, ok, detail))
    print(('PASS  ' if ok else 'FAIL  ') + name + (('   ' + detail) if detail else ''))


def mongo():
    client = AsyncIOMotorClient(os.environ['MONGO_URL'])
    return client[os.environ['DB_NAME']]


async def insert(db, doc):
    oid = ObjectId()
    doc['_id'] = oid
    await db.users.insert_one(doc)
    return doc


async def build_fixtures(db):
    now = datetime.now(timezone.utc).isoformat()
    base = dict(is_approved=True, approval_status='approved', created_at=now, is_tl=False)

    mgr_a = await insert(db, {**base, 'name': 'QA Manager A', 'email': 'qa.mgr.a' + FIXTURE_DOMAIN,
                              'role': 'manager', 'is_active': True, 'password': 'x'})
    await db.users.update_one({'_id': mgr_a['_id']}, {'$set': {'id': str(mgr_a['_id'])}})
    mgr_a['id'] = str(mgr_a['_id'])

    # Manager B deliberately has id != _id (legacy CRM shape) so alias resolution is exercised
    mgr_b = await insert(db, {**base, 'name': 'QA Manager B', 'email': 'qa.mgr.b' + FIXTURE_DOMAIN,
                              'role': 'manager', 'is_active': True, 'password': 'x',
                              'id': 'qa-mgr-b-legacy-id', 'connect_id': 'qa-mgr-b-legacy-id'})

    gps = {}
    for key, name, mgr_ref in [
        ('a1', 'QA GP A1', mgr_a['id']),
        ('a2', 'QA GP A2', str(mgr_a['_id'])),          # points at the manager's _id alias
        ('b1', 'QA GP B1', 'qa-mgr-b-legacy-id'),
        ('b2', 'QA GP B2', str(mgr_b['_id'])),          # points at Manager B's _id alias
    ]:
        doc = await insert(db, {**base, 'name': name, 'email': f'qa.gp.{key}{FIXTURE_DOMAIN}',
                                'role': 'growth_partner', 'is_active': True, 'password': 'x',
                                'manager_id': mgr_ref})
        await db.users.update_one({'_id': doc['_id']}, {'$set': {'id': str(doc['_id'])}})
        doc['id'] = str(doc['_id'])
        gps[key] = doc

    # Production duplicate pattern: same person, one legacy CRM doc + one Connect login doc,
    # SAME email, both active.
    dupe_email = 'qa.saikiran.dupe' + FIXTURE_DOMAIN
    legacy = await insert(db, {**base, 'name': 'QA Saikiran Masula (CRM)', 'email': dupe_email.upper(),
                               'role': 'sales_agent', 'is_active': True,
                               'legacy_user_id': 'qa-legacy-saikiran', 'id': 'qa-legacy-saikiran'})
    connect = await insert(db, {**base, 'name': 'QA Saikiran Masula', 'email': dupe_email,
                                'role': 'sales_agent', 'is_active': True, 'password': 'x',
                                'connect_id': 'qa-connect-saikiran', 'id': 'qa-connect-saikiran'})

    # Two documents sharing the same `id` value - an ambiguous identifier must be rejected
    amb_a = await insert(db, {**base, 'name': 'QA Ambiguous 1', 'email': 'qa.amb1' + FIXTURE_DOMAIN,
                              'role': 'growth_partner', 'is_active': True, 'id': 'qa-ambiguous-id'})
    amb_b = await insert(db, {**base, 'name': 'QA Ambiguous 2', 'email': 'qa.amb2' + FIXTURE_DOMAIN,
                              'role': 'growth_partner', 'is_active': True, 'id': 'qa-ambiguous-id'})

    # Same NAME, different email and no shared identifier: separate people, must not be merged
    twin_a = await insert(db, {**base, 'name': 'QA Twin Person', 'email': 'qa.twin.a' + FIXTURE_DOMAIN,
                               'role': 'growth_partner', 'is_active': True, 'password': 'x',
                               'id': 'qa-twin-a'})
    twin_b = await insert(db, {**base, 'name': 'QA Twin Person', 'email': 'qa.twin.b' + FIXTURE_DOMAIN,
                               'role': 'growth_partner', 'is_active': True, 'id': 'qa-twin-b'})

    return {'mgr_a': mgr_a, 'mgr_b': mgr_b, 'gps': gps, 'legacy': legacy, 'connect': connect,
            'amb': (amb_a, amb_b), 'twins': (twin_a, twin_b), 'dupe_email': dupe_email}


async def cleanup(db):
    res = await db.users.delete_many({'email': {'$regex': FIXTURE_DOMAIN.replace('.', r'\.') + '$', '$options': 'i'}})
    return res.deleted_count


async def doc_state(db, oid):
    return await db.users.find_one({'_id': oid})


async def main():
    db = mongo()
    await cleanup(db)
    fx = await build_fixtures(db)
    s, d = req('/api/auth/login', m='POST', b={'email': ADMIN[0], 'password': ADMIN[1]})
    token = d.get('access_token') or d.get('token')

    legacy_key, connect_key = str(fx['legacy']['_id']), str(fx['connect']['_id'])

    try:
        # ---------- DISPLAY ----------
        s, rows = req('/api/users', token)
        by_email = [r for r in rows if (r.get('email') or '').lower() == fx['dupe_email']]
        check('duplicate person renders as ONE row', s == 200 and len(by_email) == 1,
              f"status={s} rows_for_email={len(by_email)}")
        row = by_email[0] if by_email else {}
        check('row is the current Connect/login account', row.get('account_key') == connect_key,
              f"account_key={row.get('account_key')} connect={connect_key} legacy={legacy_key}")
        check('both documents are exposed as linked accounts', row.get('account_count') == 2 and
              {a['account_key'] for a in row.get('accounts', [])} == {legacy_key, connect_key},
              f"account_count={row.get('account_count')}")

        keys = [r['account_key'] for r in rows]
        check('no duplicate rows anywhere in the roster', len(keys) == len(set(keys)), f"rows={len(keys)}")
        emails = [(r.get('email') or '').lower() for r in rows if r.get('email')]
        dupe_emails = {e for e in emails if emails.count(e) > 1}
        check('no person listed twice by email', not dupe_emails, f"repeats={sorted(dupe_emails)}")

        s, rows = req('/api/users', token)
        twin_a_key, twin_b_key = str(fx['twins'][0]['_id']), str(fx['twins'][1]['_id'])
        twins = [r for r in rows if r.get('name') == 'QA Twin Person']
        check('same name / different email stays as TWO separately administrable rows',
              len(twins) == 2, f"rows={len(twins)}")
        check('both are flagged as possible duplicates (never silently merged)',
              all(len(t.get('possible_duplicates') or []) == 1 for t in twins) and
              {t['possible_duplicates'][0]['account_key'] for t in twins} == {twin_a_key, twin_b_key},
              f"flags={[len(t.get('possible_duplicates') or []) for t in twins]}")
        s, r = req(f'/api/users/{twin_b_key}/toggle-active', token, 'PUT')
        ta, tb = await doc_state(db, fx['twins'][0]['_id']), await doc_state(db, fx['twins'][1]['_id'])
        check('deactivating one same-name account leaves the other active',
              s == 200 and tb['is_active'] is False and ta['is_active'] is True,
              f"a={ta['is_active']} b={tb['is_active']}")

        # ---------- FILTER SWITCHING ----------
        def team(manager_ref):
            s, r = req(f'/api/users?manager_id={manager_ref}', token)
            return s, sorted(u['name'] for u in r) if isinstance(r, list) else r

        s, all_rows = req('/api/users', token)
        full_roster = len(all_rows)
        s, a1 = team(fx['mgr_a']['id'])
        check('Manager A filter -> A team only', s == 200 and a1 == ['QA GP A1', 'QA GP A2'], f"{a1}")
        s, b1 = team('qa-mgr-b-legacy-id')
        check('switch A -> B replaces result set', s == 200 and b1 == ['QA GP B1', 'QA GP B2'], f"{b1}")
        s, a2 = team(str(fx['mgr_a']['_id']))
        check('switch B -> A by _id alias returns A team', s == 200 and a2 == ['QA GP A1', 'QA GP A2'], f"{a2}")
        s, b2 = team(str(fx['mgr_b']['_id']))
        check('Manager B by _id alias returns B team', s == 200 and b2 == ['QA GP B1', 'QA GP B2'], f"{b2}")
        s, unknown = team('no-such-manager-id')
        check('unknown manager filter -> 0 rows (fail closed)', s == 200 and unknown == [], f"{unknown}")
        s, cleared = req('/api/users', token)
        check('clearing the filter restores the full roster',
              s == 200 and len(cleared) == full_roster, f"cleared={len(cleared)} full={full_roster}")

        # ---------- CRUD ISOLATION ----------
        s, r = req(f'/api/users/{legacy_key}/toggle-active', token, 'PUT')
        legacy_doc, connect_doc = await doc_state(db, fx['legacy']['_id']), await doc_state(db, fx['connect']['_id'])
        check('deactivate OLD CRM account -> only OLD is inactive',
              s == 200 and legacy_doc['is_active'] is False and connect_doc['is_active'] is True,
              f"status={s} old={legacy_doc['is_active']} new={connect_doc['is_active']} matched={r.get('matched_count') if isinstance(r, dict) else r}")

        s, r = req(f'/api/users/{legacy_key}/toggle-active', token, 'PUT')
        legacy_doc, connect_doc = await doc_state(db, fx['legacy']['_id']), await doc_state(db, fx['connect']['_id'])
        check('reactivate OLD account -> NEW untouched',
              s == 200 and legacy_doc['is_active'] is True and connect_doc['is_active'] is True,
              f"old={legacy_doc['is_active']} new={connect_doc['is_active']}")

        s, r = req(f'/api/users/{connect_key}/toggle-active', token, 'PUT')
        legacy_doc, connect_doc = await doc_state(db, fx['legacy']['_id']), await doc_state(db, fx['connect']['_id'])
        check('deactivate NEW Connect account -> OLD untouched',
              s == 200 and connect_doc['is_active'] is False and legacy_doc['is_active'] is True,
              f"old={legacy_doc['is_active']} new={connect_doc['is_active']}")
        req(f'/api/users/{connect_key}/toggle-active', token, 'PUT')

        s, r = req(f'/api/users/{legacy_key}', token, 'PUT', {'name': 'QA Renamed CRM Only'})
        legacy_doc, connect_doc = await doc_state(db, fx['legacy']['_id']), await doc_state(db, fx['connect']['_id'])
        check('edit OLD account -> only OLD name changed',
              s == 200 and legacy_doc['name'] == 'QA Renamed CRM Only' and connect_doc['name'] == 'QA Saikiran Masula',
              f"old={legacy_doc['name']!r} new={connect_doc['name']!r}")

        s, r = req(f'/api/users/{legacy_key}/role-hierarchy', token, 'PUT',
                   {'manager_id': fx['mgr_a']['id']})
        legacy_doc, connect_doc = await doc_state(db, fx['legacy']['_id']), await doc_state(db, fx['connect']['_id'])
        check('manager assignment -> only selected account',
              s == 200 and legacy_doc.get('manager_id') == fx['mgr_a']['id'] and not connect_doc.get('manager_id'),
              f"status={s} old_mgr={legacy_doc.get('manager_id')} new_mgr={connect_doc.get('manager_id')}")

        s, r = req(f'/api/users/{connect_key}/role-hierarchy', token, 'PUT', {'is_tl': True})
        legacy_doc, connect_doc = await doc_state(db, fx['legacy']['_id']), await doc_state(db, fx['connect']['_id'])
        check('TL flag -> only selected account',
              s == 200 and connect_doc.get('is_tl') is True and not legacy_doc.get('is_tl'),
              f"old_is_tl={legacy_doc.get('is_tl')} new_is_tl={connect_doc.get('is_tl')}")
        req(f'/api/users/{connect_key}/role-hierarchy', token, 'PUT', {'is_tl': False})

        s, r = req(f'/api/users/{connect_key}/change-password', token, 'PUT', {'new_password': 'QaFixture123'})
        legacy_doc = await doc_state(db, fx['legacy']['_id'])
        check('password change -> only selected account',
              s == 200 and not legacy_doc.get('plain_password'), f"status={s}")

        # ---------- AMBIGUITY / MISSING ----------
        s, r = req('/api/users/qa-ambiguous-id/toggle-active', token, 'PUT')
        check('ambiguous identifier is rejected (409)', s == 409, f"status={s} detail={r}")
        s, r = req('/api/users/000000000000000000000000/toggle-active', token, 'PUT')
        check('unknown account -> 404 (no silent success)', s == 404, f"status={s}")
        s, r = req('/api/users/000000000000000000000000', token, 'DELETE')
        check('delete unknown account -> 404 (no silent success)', s == 404, f"status={s}")

        # ---------- DELETE ----------
        s, r = req(f'/api/users/{legacy_key}', token, 'DELETE')
        legacy_doc, connect_doc = await doc_state(db, fx['legacy']['_id']), await doc_state(db, fx['connect']['_id'])
        check('delete OLD account removes exactly that document',
              s == 200 and legacy_doc is None and connect_doc is not None and
              (r or {}).get('deleted_count') == 1,
              f"status={s} deleted={(r or {}).get('deleted_count')} old_gone={legacy_doc is None} new_present={connect_doc is not None}")

        s, rows = req('/api/users', token)
        after = [x for x in rows if (x.get('email') or '').lower() == fx['dupe_email']]
        check('after delete the person shows one account',
              len(after) == 1 and after[0]['account_count'] == 1,
              f"rows={len(after)} account_count={after[0]['account_count'] if after else None}")

        s, r = req(f"/api/users/{fx['gps']['b1']['id']}", token, 'DELETE')
        gone = await doc_state(db, fx['gps']['b1']['_id'])
        check('delete by row account key removes that user', s == 200 and gone is None, f"status={s}")
        s, rows = req(f"/api/users?manager_id=qa-mgr-b-legacy-id", token)
        check('deleted user disappears from the filtered view',
              s == 200 and sorted(u['name'] for u in rows) == ['QA GP B2'], f"{[u['name'] for u in rows]}")

    finally:
        removed = await cleanup(db)
        print(f"\nfixtures removed: {removed}")

    passed = sum(1 for _, ok, _ in results if ok)
    print(f"{passed}/{len(results)} PASS")
    return 0 if passed == len(results) else 1


sys.exit(asyncio.run(main()))
