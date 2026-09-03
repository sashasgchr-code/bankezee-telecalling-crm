#!/usr/bin/env python3
"""READ-ONLY: role vs Daily Tracking Sheet result for every dropdown Growth Partner."""
import json, urllib.request, urllib.error, sys
BASE = sys.argv[1].rstrip('/') if len(sys.argv) > 1 else 'https://connect.bankezee.com'
UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'


def req(p, t=None, m='GET', b=None):
    r = urllib.request.Request(BASE + p, method=m)
    r.add_header('Content-Type', 'application/json')
    r.add_header('User-Agent', UA)
    if t:
        r.add_header('Authorization', 'Bearer ' + t)
    try:
        with urllib.request.urlopen(r, json.dumps(b).encode() if b else None, timeout=180) as z:
            return z.status, json.loads(z.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:150]
    except Exception as e:
        return 0, str(e)


s, d = req('/api/auth/login', m='POST', b={'email': 'admin@bankezee.com', 'password': 'ConnectSasha12!!'})
A = d.get('access_token') or d.get('token')

s, gps = req('/api/users/growth-partners', A)
gps = gps if isinstance(gps, list) else gps.get('users', [])
s, allr = req('/api/reports/daily-tracking-sheet?month=9&year=2026', A)
in_report = {r['user_id'] for r in allr} if s == 200 else set()
print(f'dropdown entries={len(gps)}  telecallers returned by unfiltered report={len(in_report)}\n')

FOCUS = ['meghanaaaa.36@gmail.com', 'asma.sultana0r@gmail.com', 'banothunithinnaik@gmail.com']
hdr = f"{'Name':26s} | {'id (= _id used by query)':26s} | {'stored role':14s} | {'active':6s} | {'in query?':9s} | {'report works?':13s} | days/calls"
print(hdr)
print('-' * len(hdr))
rows = []
for g in gps:
    uid = g.get('id')
    st, rr = req(f'/api/reports/daily-tracking-sheet?user_id={uid}&month=9&year=2026', A)
    n = len(rr) if isinstance(rr, list) else -1
    works = 'YES' if n > 0 else ('HTTP ' + str(st) if st != 200 else 'NO (empty)')
    days = f"{len(rr[0]['daily_data'])}d / {rr[0]['totals']['calls']} calls" if n > 0 else '-'
    rows.append({'name': g.get('name') or g.get('full_name'), 'email': g.get('email'), 'id': uid,
                 'role': g.get('role'), 'active': g.get('is_active'), 'in_query': uid in in_report,
                 'works': works, 'days': days})

focus = [r for r in rows if r['email'] in FOCUS]
others_ok = [r for r in rows if r['works'] == 'YES' and r['email'] not in FOCUS][:4]
others_bad = [r for r in rows if r['works'] != 'YES' and r['email'] not in FOCUS][:6]
for r in focus + others_ok + others_bad:
    print(f"{str(r['name'])[:26]:26s} | {r['id']:26s} | {str(r['role']):14s} | "
          f"{str(r['active']):6s} | {str(r['in_query']):9s} | {r['works']:13s} | {r['days']}")

print('\n=== aggregate by stored role ===')
from collections import Counter
c = Counter((r['role'], r['works'] == 'YES') for r in rows)
for (role, ok), n in sorted(c.items()):
    print(f"  role={role:16s} report_works={ok}  users={n}")
print('\nusers whose report works but role != telecaller:',
      [(r['name'], r['role']) for r in rows if r['works'] == 'YES' and r['role'] != 'telecaller'])
print('users with role == telecaller whose report is empty:',
      len([r for r in rows if r['role'] == 'telecaller' and r['works'] != 'YES']))
print('non-200 responses:', [(r['name'], r['id'], r['works']) for r in rows if r['works'].startswith('HTTP')])
