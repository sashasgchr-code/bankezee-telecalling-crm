#!/usr/bin/env python3
"""User Management audit: 10-load stability + Manager/TL persistence. Usage: <base_url>"""
import json, sys, time, urllib.request, urllib.error
BASE = sys.argv[1].rstrip('/')
UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'


def restore_links_direct(email, before):
    """Write manager_id/tl_id straight back to Mongo (the API rejects non-manager manager_ids)."""
    import asyncio, os
    from motor.motor_asyncio import AsyncIOMotorClient
    from dotenv import load_dotenv
    load_dotenv('/app/backend/.env')

    async def run():
        client = AsyncIOMotorClient(os.environ['MONGO_URL'])
        db = client[os.environ['DB_NAME']]
        res = await db.users.update_many({'email': email}, {'$set': before})
        return res.modified_count
    return asyncio.run(run()) > 0


def req(p, t=None, m='GET', b=None):
    r = urllib.request.Request(BASE + p, method=m)
    r.add_header('Content-Type', 'application/json')
    r.add_header('User-Agent', UA)
    if t:
        r.add_header('Authorization', 'Bearer ' + t)
    t0 = time.time()
    try:
        with urllib.request.urlopen(r, json.dumps(b).encode() if b else None, timeout=200) as z:
            return z.status, json.loads(z.read().decode()), time.time() - t0
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:200], time.time() - t0
    except Exception as e:
        return 0, str(e), time.time() - t0


def login():
    s, d, _ = req('/api/auth/login', m='POST',
                  b={'email': 'admin@bankezee.com', 'password': 'ConnectSasha12!!'})
    return d.get('access_token') or d.get('token')


A = login()
print('=== 10-LOAD STABILITY (Admin, no filters) ===')
zeros, times, counts = 0, [], []
for i in range(1, 11):
    s, d, el = req('/api/users', A)
    n = len(d) if isinstance(d, list) else -1
    counts.append(n); times.append(el)
    if n <= 0:
        zeros += 1
    print(f'  load {i:2d}: HTTP {s}  users={n:4d}  {el:6.2f}s')
print(f'  -> min={min(counts)} max={max(counts)} zero_results={zeros} '
      f'avg={sum(times)/len(times):.2f}s worst={max(times):.2f}s')
stability = 'PASS' if zeros == 0 and len(set(counts)) == 1 else 'FAIL'
print(f'  10-load stability: {stability}')

print('\n=== MANAGER/TL PERSISTENCE ===')
s, users, _ = req('/api/users', A)
by_email = {}
for u in users:
    by_email.setdefault(u['email'], []).append(u)
s, mgrs, _ = req('/api/users/managers', A)
mgr = next((m for m in mgrs if m.get('email') == 'saikiran@bankezee.com'), None) if isinstance(mgrs, list) else None
if not mgr:
    mgr = next((m for m in mgrs if m.get('id')), None)
s, tls, _ = req(f"/api/users/team-leads?manager_id={mgr['id']}", A)
tl = next((t for t in tls if t.get('id')), None) if isinstance(tls, list) else None
print(f"  manager={mgr.get('email')} ({mgr['id']})  tl={tl and tl.get('name')} ({tl and tl.get('id')})")

TARGETS = ['banothunithinnaik@gmail.com', 'meghanaaaa.36@gmail.com']
ok = True
for email in TARGETS:
    docs = by_email.get(email, [])
    if not docs:
        print(f'  {email}: not found'); ok = False; continue
    row = docs[0]
    print(f"\n  --- {email} ---")
    print(f"    documents in list      : {len(docs)}  ids={[d['id'] for d in docs]}")
    print(f"    canonical_id           : {row.get('canonical_id')} (is_canonical={row.get('is_canonical')})")
    print(f"    BEFORE manager_id/tl_id: {row.get('manager_id')} / {row.get('tl_id')}")
    payload = {'manager_id': mgr['id'], 'tl_id': tl['id']}
    s, res, _ = req(f"/api/users/{row['id']}/role-hierarchy", A, 'PUT', payload)
    print(f"    PUT payload            : {json.dumps(payload)}")
    print(f"    PUT response           : HTTP {s} manager_id={res.get('manager_id') if isinstance(res,dict) else res} "
          f"tl_id={res.get('tl_id') if isinstance(res,dict) else ''}")
    # reopen: what /api/users returns now (this is what initialises the modal)
    s, users2, _ = req('/api/users', A)
    rows2 = [u for u in users2 if u['email'] == email]
    for r2 in rows2:
        print(f"    AFTER  row id={r2['id']} manager_id={r2.get('manager_id')} tl_id={r2.get('tl_id')} "
              f"manager_name={r2.get('manager_name')} tl_name={r2.get('tl_name')}")
    persisted = all(r2.get('manager_id') == mgr['id'] and r2.get('tl_id') == tl['id'] for r2 in rows2)
    # fresh login = new token, new request cycle
    A2 = login()
    s, users3, _ = req('/api/users', A2)
    rows3 = [u for u in users3 if u['email'] == email]
    after_relogin = all(r2.get('manager_id') == mgr['id'] and r2.get('tl_id') == tl['id'] for r2 in rows3)
    print(f"    persisted on reopen    : {persisted}")
    print(f"    persisted after re-login: {after_relogin}")
    ok = ok and persisted and after_relogin

    # restore the original links so the preview hierarchy is left exactly as it was
    before = {'manager_id': row.get('manager_id'), 'tl_id': row.get('tl_id')}
    s, res, _ = req(f"/api/users/{row['id']}/role-hierarchy", A2, 'PUT', before)
    s, users4, _ = req('/api/users', A2)
    rows4 = [u for u in users4 if u['email'] == email]
    restored = all(r.get('manager_id') == before['manager_id'] and r.get('tl_id') == before['tl_id'] for r in rows4)
    print(f"    restored to BEFORE     : {restored} (HTTP {s} on PUT {json.dumps(before)})")
    if not restored:
        # role-hierarchy PUT drops a manager_id whose document is not role=manager
        # (G Saikiran is a telecaller acting as sub-manager), so restore directly.
        restored = restore_links_direct(email, before)
        print(f"    restored directly in DB: {restored}")
    ok = ok and restored

print(f"\n  Manager/TL persistence: {'PASS' if ok else 'FAIL'}")
print(f"\n10-load stability: {stability}   Manager/TL persistence: {'PASS' if ok else 'FAIL'}")
