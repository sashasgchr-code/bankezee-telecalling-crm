#!/usr/bin/env python3
"""READ-ONLY trace of the Daily Tracking Sheet for Meghana vs Asma."""
import sys, json, urllib.request, urllib.error
BASE = sys.argv[1].rstrip('/')
UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'


def req(path, token=None, method='GET', body=None):
    r = urllib.request.Request(BASE + path, method=method)
    r.add_header('Content-Type', 'application/json')
    r.add_header('User-Agent', UA)
    if token:
        r.add_header('Authorization', 'Bearer ' + token)
    data = json.dumps(body).encode() if body else None
    try:
        with urllib.request.urlopen(r, data, timeout=180) as resp:
            return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:300]
    except Exception as e:
        return 0, str(e)


s, d = req('/api/auth/login', method='POST', body={'email': 'admin@bankezee.com', 'password': 'ConnectSasha12!!'})
A = d.get('access_token') or d.get('token')
print('admin login', s)

TARGETS = ['meghana', 'asma']

s, gps = req('/api/users/growth-partners', A)
gps = gps if isinstance(gps, list) else gps.get('users', [])
print(f'\n/api/users/growth-partners -> {s}, {len(gps)} entries (this populates the dropdown)')
for g in gps:
    if any(t in (g.get('email', '') + str(g.get('name', '')) + str(g.get('full_name', ''))).lower() for t in TARGETS):
        print(f"  DROPDOWN VALUE id={g.get('id')} name={g.get('name') or g.get('full_name')} email={g.get('email')} "
              f"role={g.get('role')} is_active={g.get('is_active')}")

s, us = req('/api/users?limit=2000', A)
us = us if isinstance(us, list) else us.get('users', [])
print(f'\nall matching user docs in /api/users ({len(us)} docs total):')
for u in us:
    if any(t in (u.get('email', '') + str(u.get('name', '')) + str(u.get('full_name', ''))).lower() for t in TARGETS):
        print(f"  id={u.get('id')} name={u.get('name') or u.get('full_name'):24s} email={u.get('email'):34s} "
              f"role={u.get('role'):14s} is_active={u.get('is_active')} legacy_user_id={u.get('legacy_user_id')} "
              f"connect_id={u.get('connect_id')} files_count={u.get('files_count')}")

print('\n/api/reports/daily-tracking-sheet WITHOUT user_id (returns every active telecaller keyed by str(_id)):')
s, allr = req('/api/reports/daily-tracking-sheet?month=9&year=2026', A)
if s == 200:
    print(f'  -> {s}, {len(allr)} telecallers returned')
    ids_in_report = {r['user_id']: r for r in allr}
    for r in allr:
        if any(t in str(r.get('user_name', '')).lower() for t in TARGETS):
            print(f"  IN REPORT user_id(_id)={r['user_id']} name={r['user_name']} "
                  f"days={len(r['daily_data'])} totals={r['totals']}")
else:
    print('  ->', s, allr)
    ids_in_report = {}

print('\nper-user request exactly as the dropdown sends it:')
for g in gps:
    if any(t in (g.get('email', '') + str(g.get('name', '')) + str(g.get('full_name', ''))).lower() for t in TARGETS):
        uid = g.get('id')
        st, rr = req(f'/api/reports/daily-tracking-sheet?user_id={uid}&month=9&year=2026', A)
        n = len(rr) if isinstance(rr, list) else rr
        print(f"  GET /api/reports/daily-tracking-sheet?user_id={uid} -> {st} records={n}")
        if isinstance(rr, list) and rr:
            print(f"     user_id returned={rr[0]['user_id']}  matches dropdown value={rr[0]['user_id'] == uid}  "
                  f"days={len(rr[0]['daily_data'])} totals={rr[0]['totals']}")
        print(f"     is dropdown id present as an _id in the no-filter report? {uid in ids_in_report}")

print('\nSept 1-3 custom range, same call:')
for g in gps:
    if any(t in (g.get('email', '') + str(g.get('name', '')) + str(g.get('full_name', ''))).lower() for t in TARGETS):
        uid = g.get('id')
        st, rr = req(f'/api/reports/daily-tracking-sheet?user_id={uid}&start_date=2026-09-01&end_date=2026-09-03', A)
        print(f"  {g.get('name') or g.get('full_name')}: {st} records={len(rr) if isinstance(rr,list) else rr}"
              + (f" days={len(rr[0]['daily_data'])} totals={rr[0]['totals']}" if isinstance(rr, list) and rr else ''))
