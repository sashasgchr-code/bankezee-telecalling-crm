#!/usr/bin/env python3
"""Manager hierarchy trace: User Management vs Manager Dashboard for one manager."""
import json, sys, urllib.request, urllib.error
BASE = sys.argv[1].rstrip('/') if len(sys.argv) > 1 else 'https://responsive-crm-app-1.preview.emergentagent.com'
MGR = ('teja@bankezee.com', 'tejasme12')
UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'


def req(p, t=None, m='GET', b=None):
    r = urllib.request.Request(BASE + p, method=m)
    r.add_header('Content-Type', 'application/json')
    r.add_header('User-Agent', UA)
    if t:
        r.add_header('Authorization', 'Bearer ' + t)
    try:
        with urllib.request.urlopen(r, json.dumps(b).encode() if b else None, timeout=200) as z:
            return z.status, json.loads(z.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:200]


A = req('/api/auth/login', m='POST', b={'email': 'admin@bankezee.com', 'password': 'ConnectSasha12!!'})[1]
A = A.get('access_token') or A.get('token')
Mp = req('/api/auth/login', m='POST', b={'email': MGR[0], 'password': MGR[1]})[1]
M = Mp.get('access_token') or Mp.get('token')
session = Mp.get('user', {})

s, us = req('/api/users?limit=2000', A)
tejas = [u for u in us if u['email'] == MGR[0]]
by_id = {u['id']: u for u in us}
print(f"session id                : {session.get('id')}  role={session.get('role')}")
print(f"canonical Teja            : {tejas[0].get('canonical_id')} ({tejas[0].get('email')})")
print(f"all Teja documents in list: {[t['id'] for t in tejas]}")

# --- User Management view: transitive closure over the saved manager_id / tl_id links ---
teja_ids = {t['id'] for t in tejas} | {tejas[0].get('canonical_id')}
children = {}
for u in us:
    for field in ('manager_id', 'tl_id'):
        parent = u.get(field)
        if parent:
            children.setdefault(parent, set()).add(u['email'].strip().lower())
by_email_all = {}
for u in us:
    by_email_all.setdefault(u['email'].strip().lower(), []).append(u)

frontier = set(teja_ids)
people, visited = {}, set(teja_ids)
level = 0
while frontier and level < 25:
    level += 1
    nxt = set()
    for pid in frontier:
        for email in children.get(pid, set()):
            if email in people or email == MGR[0]:
                continue
            docs = by_email_all[email]
            people[email] = docs[0]
            for d in docs:
                if d['id'] not in visited:
                    visited.add(d['id'])
                    nxt.add(d['id'])
    frontier = nxt
active_people = {e: u for e, u in people.items() if any(d.get('is_active') for d in by_email_all[e])}
direct = [u for u in us if u.get('manager_id') in teja_ids]
print(f"\ndirect reports (manager_id=Teja) : {len(direct)} {[u['email'] for u in direct]}")
print(f"direct TLs                      : {[u['email'] for u in direct if u.get('is_tl')]}")
print(f"recursive descendants (people)   : {len(people)}  active {len(active_people)}")
um_tls = [e for e, u in active_people.items() if u.get('is_tl')]
print(f"active TLs in subtree            : {len(um_tls)} {um_tls}")

# --- Manager Dashboard view ---
s, stats = req('/api/reports/manager-team-stats?period=this_month', M)
s2, members = req('/api/users/manager-team-members', M)
mem = members.get('members', []) if isinstance(members, dict) else []
print(f"\nMANAGER DASHBOARD: total_team={stats.get('total_team')} tls_count={stats.get('tls_count')} "
      f"calls={stats.get('calls')} connected={stats.get('connected')} leads={stats.get('leads')} files={stats.get('files')}")
print(f"MANAGER DASHBOARD: /manager-team-members returned {len(mem)} members")
dash_emails = sorted({m.get('email').strip().lower() for m in mem if m.get('email')})
print(f"  {dash_emails}")

um_emails = sorted(active_people.keys())
missing = [e for e in um_emails if e not in dash_emails]
extra = [e for e in dash_emails if e not in um_emails]
print(f"\nDIFFERENCE  missing from dashboard: {missing}")
print(f"DIFFERENCE  extra in dashboard    : {extra}")
print(f"\nMATCH: {'YES' if not missing and not extra else 'NO'}  "
      f"(UM active people={len(um_emails)}, dashboard members={len(dash_emails)}, "
      f"total_team={stats.get('total_team')})")
