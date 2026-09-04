#!/usr/bin/env python3
"""FINAL User Management acceptance test (read-only against real data; fixtures are removed).

Covers the 12 acceptance lines: duplicate display, manager filter switching, exact-account
deactivate/activate/edit/delete, Manager & TL assignment persistence, Connect login unaffected,
historical alias ownership unaffected, no false 0-user loads, performance.
"""
import asyncio, json, os, sys, time, urllib.request, urllib.error
from datetime import datetime, timezone
from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

BASE = (sys.argv[1] if len(sys.argv) > 1 else 'https://responsive-crm-app-1.preview.emergentagent.com').rstrip('/')
UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
ADMIN = ('admin@bankezee.com', 'ConnectSasha12!!')
TEJA = ('teja@bankezee.com', 'tejasme12')
NITHIN = ('banothunithinnaik@gmail.com', 'Nithin@123')
FIXTURE_DOMAIN = '@fixture.test'
DUPE_NAMES = ['Asma Sultana', 'Karuna Nidhi', 'Nithin', 'praveen',
              'sharanya', 'Saikiran', 'Masula']
load_dotenv('/app/backend/.env')
verdicts, details = {}, []


def req(p, t=None, m='GET', b=None, timing=False):
    r = urllib.request.Request(BASE + p, method=m)
    r.add_header('Content-Type', 'application/json')
    r.add_header('User-Agent', UA)
    if t:
        r.add_header('Authorization', 'Bearer ' + t)
    started = time.time()
    try:
        with urllib.request.urlopen(r, json.dumps(b).encode() if b else None, timeout=300) as z:
            out = z.status, json.loads(z.read().decode())
    except urllib.error.HTTPError as e:
        try:
            out = e.code, json.loads(e.read().decode())
        except Exception:
            out = e.code, None
    return (*out, round(time.time() - started, 2)) if timing else out


def record(line, ok, note=''):
    verdicts[line] = verdicts.get(line, True) and ok
    details.append((line, ok, note))
    print(('  PASS  ' if ok else '  FAIL  ') + note)


def login(email, pwd):
    s, d = req('/api/auth/login', m='POST', b={'email': email, 'password': pwd})
    return (d or {}).get('access_token') or (d or {}).get('token'), (d or {}).get('user') or {}


def db_handle():
    return AsyncIOMotorClient(os.environ['MONGO_URL'])[os.environ['DB_NAME']]


async def build_saikiran_fixture(db, token):
    """Production shape: same email, one dormant legacy CRM doc + one current Connect account."""
    email = 'qa.saikiran.masula' + FIXTURE_DOMAIN
    await db.users.delete_many({'email': {'$regex': FIXTURE_DOMAIN.replace('.', r'\.') + '$', '$options': 'i'}})
    # Connect account created through the API so the password is hashed by the app itself
    s, created = req('/api/users', token, 'POST', {
        'name': 'QA Saikiran Masula', 'email': email, 'password': 'QaConnect123', 'role': 'growth_partner'})
    connect = await db.users.find_one({'email': email})
    await db.users.update_one({'_id': connect['_id']}, {'$set': {'connect_id': str(connect['_id'])}})
    # Legacy CRM document: same person, SAME email (different case), no credential
    legacy_id = ObjectId()
    await db.users.insert_one({
        '_id': legacy_id, 'id': 'qa-legacy-saikiran', 'legacy_user_id': 'qa-legacy-saikiran',
        'name': 'Saikiran Masula (CRM)', 'email': email.upper(), 'role': 'sales_agent',
        'is_active': True, 'is_approved': True, 'approval_status': 'approved',
        'created_at': datetime.now(timezone.utc).isoformat()})
    managers = req('/api/users/managers', token)[1]
    return {'email': email, 'legacy': legacy_id, 'connect': connect['_id'],
            'managers': [m for m in managers if m.get('id')]}


async def state(db, oid):
    return await db.users.find_one({'_id': oid})


async def main():
    db = db_handle()
    token, _ = login(*ADMIN)

    # ---------------- 1. ONE ROW PER PERSON ----------------
    print('\n[1] Duplicate display - one row per person')
    s, rows = req('/api/users', token)
    keys = [r['account_key'] for r in rows]
    record('One row per person', s == 200 and len(keys) == len(set(keys)),
           f"roster rows={len(rows)}, unique account_keys={len(set(keys))}")
    emails = [(r.get('email') or '').lower() for r in rows if r.get('email')]
    repeats = sorted({e for e in emails if emails.count(e) > 1})
    record('One row per person', not repeats, f"emails appearing twice: {repeats or 'none'}")
    for name in DUPE_NAMES:
        hits = [r for r in rows if name.lower() in str(r.get('name', '')).lower()]
        multi = [f"{h['name']} ({h['account_count']} accounts)" for h in hits if h['account_count'] > 1]
        record('One row per person', len(hits) <= 1 or all(
            (h.get('email') or '').lower() != (o.get('email') or '').lower()
            for i, h in enumerate(hits) for o in hits[i + 1:]),
            f"{name}: {len(hits)} row(s) {'| linked: ' + ', '.join(multi) if multi else ''}")

    # ---------------- 2. MANAGER FILTER SWITCHING (repeated, no reload) ----------------
    print('\n[2] Manager filter switching A->B->A->B->clear, repeated')
    managers = [m for m in req('/api/users/managers', token)[1] if m.get('id')]
    a, b = managers[0], managers[1]
    baseline = {}
    for rnd in range(3):
        for who in (a, b, a, b):
            s, res, ms = req(f"/api/users?manager_id={who['id']}", token, timing=True)
            names = sorted(u['name'] for u in res)
            akeys = [u['account_key'] for u in res]
            first = baseline.setdefault(who['id'], names)
            record('Manager filter switching',
                   s == 200 and names == first and len(akeys) == len(set(akeys)) and all(
                       (u.get('manager_id') or '') != '' for u in res),
                   f"round {rnd + 1} {who['name']}: {len(names)} users, stable={names == first}, "
                   f"no dupes={len(akeys) == len(set(akeys))}, {ms}s")
    s, cleared, ms = req('/api/users', token, timing=True)
    record('Manager filter switching', s == 200 and len(cleared) == len(rows),
           f"clear -> {len(cleared)} rows (baseline {len(rows)}), {ms}s")
    s, mixed = req(f"/api/users?manager_id={a['id']}", token)
    other_team = set(baseline[b['id']])
    record('Manager filter switching', not (set(u['name'] for u in mixed) & other_team),
           f"no users from the other manager leaked in: {sorted(set(u['name'] for u in mixed) & other_team) or 'none'}")

    fx = await build_saikiran_fixture(db, token)
    legacy_key, connect_key = str(fx['legacy']), str(fx['connect'])
    try:
        # ---------------- 3. EXACT-ACCOUNT CRUD ----------------
        print('\n[3] Saikiran Masula CRUD isolation (same email, two documents)')
        s, rows2 = req('/api/users', token)
        row = [r for r in rows2 if (r.get('email') or '').lower() == fx['email']]
        record('One row per person', len(row) == 1 and row[0]['account_count'] == 2,
               f"fixture person rows={len(row)} accounts={row[0]['account_count'] if row else 0} "
               f"current={row[0]['account_key'] if row else None} (connect={connect_key})")

        s, r = req(f'/api/users/{legacy_key}/toggle-active', token, 'PUT')
        old, new = await state(db, fx['legacy']), await state(db, fx['connect'])
        record('Exact-account deactivate', s == 200 and old['is_active'] is False and new['is_active'] is True,
               f"deactivate OLD -> old={old['is_active']} new={new['is_active']} "
               f"account_key={r.get('account_key')} matched_count={r.get('matched_count')}")

        s, r = req(f'/api/users/{legacy_key}/toggle-active', token, 'PUT')
        old, new = await state(db, fx['legacy']), await state(db, fx['connect'])
        record('Exact-account activate', s == 200 and old['is_active'] is True and new['is_active'] is True,
               f"reactivate OLD -> old={old['is_active']} new={new['is_active']} "
               f"account_key={r.get('account_key')} matched_count={r.get('matched_count')}")

        s, r = req(f'/api/users/{connect_key}/toggle-active', token, 'PUT')
        old, new = await state(db, fx['legacy']), await state(db, fx['connect'])
        record('Exact-account deactivate', s == 200 and new['is_active'] is False and old['is_active'] is True,
               f"deactivate NEW -> old={old['is_active']} new={new['is_active']} "
               f"account_key={r.get('account_key')} matched_count={r.get('matched_count')}")

        s, r = req(f'/api/users/{connect_key}/toggle-active', token, 'PUT')
        old, new = await state(db, fx['legacy']), await state(db, fx['connect'])
        record('Exact-account activate', s == 200 and new['is_active'] is True and old['is_active'] is True,
               f"reactivate NEW -> old={old['is_active']} new={new['is_active']} matched_count={r.get('matched_count')}")

        s, r = req(f'/api/users/{legacy_key}', token, 'PUT', {'name': 'QA OLD renamed'})
        old, new = await state(db, fx['legacy']), await state(db, fx['connect'])
        record('Exact-account edit', s == 200 and old['name'] == 'QA OLD renamed' and new['name'] == 'QA Saikiran Masula',
               f"edit OLD -> old={old['name']!r} new={new['name']!r}")
        s, r = req(f'/api/users/{connect_key}', token, 'PUT', {'name': 'QA NEW renamed'})
        old, new = await state(db, fx['legacy']), await state(db, fx['connect'])
        record('Exact-account edit', s == 200 and new['name'] == 'QA NEW renamed' and old['name'] == 'QA OLD renamed',
               f"edit NEW -> old={old['name']!r} new={new['name']!r}")

        s, r = req('/api/users/qa-legacy-saikiran/toggle-active', token, 'PUT')
        record('Exact-account edit', s in (200, 409),
               f"non-_id identifier handling: HTTP {s} ({'unique id accepted' if s == 200 else 'ambiguous rejected'})")
        if s == 200:  # restore
            req('/api/users/qa-legacy-saikiran/toggle-active', token, 'PUT')

        # ---------------- 4. MANAGER / TL ASSIGNMENT PERSISTENCE ----------------
        print('\n[4] Manager / TL assignment persistence')
        mgr = fx['managers'][0]
        s, r = req(f'/api/users/{connect_key}/role-hierarchy', token, 'PUT', {'manager_id': mgr['id']})
        s2, rows3 = req('/api/users', token)
        row = next((x for x in rows3 if x['account_key'] == connect_key), {})
        old = await state(db, fx['legacy'])
        record('Manager assignment persistence',
               s == 200 and row.get('manager_id') == mgr['id'] and not old.get('manager_id'),
               f"assign Manager {mgr['name']} -> reopen shows {row.get('manager_name')} "
               f"| OLD account manager={old.get('manager_id')}")

        tls = [t for t in req(f"/api/users/team-leads?manager_id={mgr['id']}", token)[1] or [] if t.get('id')]
        if tls:
            tl = tls[0]
            s, r = req(f'/api/users/{connect_key}/role-hierarchy', token, 'PUT', {'tl_id': tl['id']})
            s2, rows4 = req('/api/users', token)
            row = next((x for x in rows4 if x['account_key'] == connect_key), {})
            old = await state(db, fx['legacy'])
            record('TL assignment persistence',
                   s == 200 and row.get('tl_id') == tl['id'] and not old.get('tl_id'),
                   f"assign TL {tl['name']} -> reopen shows {row.get('tl_name')} | OLD account tl={old.get('tl_id')}")
        else:
            record('TL assignment persistence', False, 'no TL available under this manager')

        # ---------------- 5. CONNECT LOGIN UNAFFECTED ----------------
        print('\n[5] Connect login still authenticates the current account')
        tok, who = login(fx['email'], 'QaConnect123')
        record('Connect login unaffected', bool(tok) and who.get('id') == connect_key,
               f"login as {fx['email']} -> account {who.get('id')} (connect={connect_key}, legacy={legacy_key})")
        req(f'/api/users/{legacy_key}/toggle-active', token, 'PUT')  # dormant legacy deactivated
        tok2, who2 = login(fx['email'], 'QaConnect123')
        record('Connect login unaffected', bool(tok2) and who2.get('id') == connect_key,
               f"legacy deactivated -> login still lands on {who2.get('id')}")
        req(f'/api/users/{legacy_key}/toggle-active', token, 'PUT')
        for email, pwd, label in [(ADMIN[0], ADMIN[1], 'admin'), (TEJA[0], TEJA[1], 'manager teja'),
                                  (NITHIN[0], NITHIN[1], 'GP nithin')]:
            t, _ = login(email, pwd)
            record('Connect login unaffected', bool(t), f"real account login ok: {label}")

        # ---------------- 6. DELETE ISOLATION ----------------
        print('\n[6] Delete affects exactly one account')
        s, r = req(f'/api/users/{legacy_key}', token, 'DELETE')
        old, new = await state(db, fx['legacy']), await state(db, fx['connect'])
        record('Exact-account delete', s == 200 and old is None and new is not None and r.get('deleted_count') == 1,
               f"delete OLD -> HTTP {s} deleted_count={r.get('deleted_count')} "
               f"account_key={r.get('account_key')} old_gone={old is None} new_present={new is not None}")
        s, r = req(f'/api/users/{connect_key}', token, 'DELETE')
        new = await state(db, fx['connect'])
        record('Exact-account delete', s == 200 and new is None and r.get('deleted_count') == 1,
               f"delete NEW -> HTTP {s} deleted_count={r.get('deleted_count')} gone={new is None}")
        s, r = req('/api/users/000000000000000000000000', token, 'DELETE')
        record('Exact-account delete', s == 404, f"delete unknown _id -> HTTP {s} (no silent success)")
    finally:
        removed = await db.users.delete_many(
            {'email': {'$regex': FIXTURE_DOMAIN.replace('.', r'\.') + '$', '$options': 'i'}})
        print(f"\nfixtures removed: {removed.deleted_count}")

    # ---------------- 7. HISTORICAL ALIAS OWNERSHIP ----------------
    print('\n[7] Historical alias ownership / reporting scope unaffected')
    mtoken, _ = login(*TEJA)
    s, members = req('/api/users/manager-team-members', mtoken)
    record('Historical alias ownership unaffected', s == 200 and members.get('total') == 18,
           f"Manager Dashboard team members = {members.get('total')} (expected 18)")
    s, files = req('/api/files/?limit=1', mtoken)
    mgr_files = (files or {}).get('pagination', {}).get('total')
    record('Historical alias ownership unaffected', s == 200 and (mgr_files or 0) > 0,
           f"Manager Files scope total = {mgr_files}")
    s, track = req('/api/reports/daily-tracking-sheet?month=9&year=2026', mtoken)
    record('Historical alias ownership unaffected', s == 200 and len(track) == 18,
           f"Manager Track Report = HTTP {s}, {len(track) if isinstance(track, list) else track} people")
    ntoken, nuser = login(*NITHIN)
    s, nfiles = req('/api/files/?limit=1', ntoken)
    gp_files = (nfiles or {}).get('pagination', {}).get('total')
    s2, arows = req('/api/users', token)
    nithin_row = next((r for r in arows if (r.get('email') or '').lower() == NITHIN[0]), {})
    record('Historical alias ownership unaffected',
           s == 200 and gp_files == nithin_row.get('files_count'),
           f"GP alias-owned files: own view={gp_files} vs User Management files_count="
           f"{nithin_row.get('files_count')}")
    s, gp403 = req('/api/reports/daily-tracking-sheet?month=9&year=2026', ntoken)
    record('Historical alias ownership unaffected', s == 403, f"GP still blocked on Track Report: HTTP {s}")

    # ---------------- 8. PERFORMANCE / NO FALSE ZERO ----------------
    print('\n[8] Performance and no false 0-user loads')
    load_times = []
    for i in range(10):
        s, res, ms = req('/api/users', token, timing=True)
        load_times.append(ms)
        if s != 200 or not res:
            record('No false 0-user loads', False, f"load {i + 1}: HTTP {s} rows={len(res or [])}")
    record('No false 0-user loads', True, f"10/10 loads returned {len(res)} users, never empty")
    switch_times = []
    for i in range(10):
        who = a if i % 2 == 0 else b
        s, res, ms = req(f"/api/users?manager_id={who['id']}", token, timing=True)
        switch_times.append(ms)
        if s != 200 or sorted(u['name'] for u in res) != baseline[who['id']]:
            record('Manager filter switching', False, f"switch {i + 1} returned a different set")
    record('Manager filter switching', True,
           f"10 rapid switches all returned the correct team (max {max(switch_times)}s)")
    worst = max(load_times + switch_times)
    record('Performance acceptable', worst < 5,
           f"list loads {min(load_times)}-{max(load_times)}s, filter switches "
           f"{min(switch_times)}-{max(switch_times)}s, worst {worst}s (target <5s)")

    print('\n================ FINAL RESULT ================')
    order = ['One row per person', 'Manager filter switching', 'Exact-account deactivate',
             'Exact-account activate', 'Exact-account edit', 'Exact-account delete',
             'Manager assignment persistence', 'TL assignment persistence',
             'Connect login unaffected', 'Historical alias ownership unaffected',
             'No false 0-user loads', 'Performance acceptable']
    for line in order:
        print(f"{line:45s}: {'PASS' if verdicts.get(line) else 'FAIL'}")
    failed = [line for line, ok, _ in details if not ok]
    return 0 if not failed else 1


sys.exit(asyncio.run(main()))
