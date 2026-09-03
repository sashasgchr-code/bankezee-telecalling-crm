#!/usr/bin/env python3
"""READ-ONLY production hierarchy audit for a manager. Usage: audit.py <base_url> <manager_email>"""
import sys, json, urllib.request, urllib.error

BASE = sys.argv[1].rstrip('/')
MGR_EMAIL = sys.argv[2] if len(sys.argv) > 2 else 'teja@bankezee.com'
UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'


def req(path, token=None, method='GET', body=None):
    r = urllib.request.Request(BASE + path, method=method)
    r.add_header('Content-Type', 'application/json')
    r.add_header('User-Agent', UA)
    if token:
        r.add_header('Authorization', 'Bearer ' + token)
    data = json.dumps(body).encode() if body else None
    try:
        with urllib.request.urlopen(r, data, timeout=120) as resp:
            return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:120]
    except Exception as e:
        return 0, str(e)


s, d = req('/api/auth/login', method='POST', body={'email': 'admin@bankezee.com', 'password': 'ConnectSasha12!!'})
TOK = d.get('access_token') or d.get('token')
print(f'admin login -> {s}')

s, users = req('/api/users?limit=2000', TOK)
users = users if isinstance(users, list) else users.get('users', [])
print(f'GET /api/users -> {s}  users={len(users)}')
print('sample keys:', sorted(users[0].keys()) if users else 'none')

s, audit = req('/api/files/audit/gp-file-mapping', TOK)
owner_files = {}
if s == 200:
    owner_files = {g['gp_id']: g['file_count'] for g in audit['gp_file_matrix']}
    print(f"audit matrix -> total_files={audit['total_files']} owners={audit['total_gps_with_files']} unassigned={audit['unassigned_files']}")
else:
    print('audit matrix ->', s, audit)

by_id = {u['id']: u for u in users if u.get('id')}
mgr = next((u for u in users if u.get('email') == MGR_EMAIL), None)
if not mgr:
    print('manager not found'); sys.exit(1)
MID = mgr['id']
print(f"\nMANAGER {MGR_EMAIL}  id={MID}  role={mgr.get('role')}  is_active={mgr.get('is_active')}")


def api_total(params):
    st, dd = req(f'/api/files/?limit=1&{params}', TOK)
    if st == 200:
        return dd['pagination']['total']
    return f'ERR{st}'


def desc(u):
    return (f"    {(u.get('name') or u.get('full_name') or u.get('email','?'))[:26]:28s} "
            f"{u.get('email','')[:34]:36s} role={u.get('role','?'):14s} "
            f"is_tl={str(bool(u.get('is_tl'))):5s} active={str(bool(u.get('is_active'))):5s} "
            f"mgr={str(u.get('manager_id'))[:8]:8s} tl={str(u.get('tl_id'))[:8]:8s} "
            f"auditFiles={owner_files.get(u['id'], 0):5d} apiFiles={api_total('gp_id=' + u['id'])}")


def group(label, members):
    tot_audit = sum(owner_files.get(u['id'], 0) for u in members)
    print(f"\n{label}: {len(members)} users, audit file total={tot_audit}")
    for u in members:
        print(desc(u))
    return tot_audit


direct = [u for u in users if u.get('manager_id') == MID and u['id'] != MID]
direct_tls = [u for u in direct if u.get('is_tl')]
direct_submgr = [u for u in direct if u.get('role') == 'manager']
direct_gps = [u for u in direct if not u.get('is_tl') and u.get('role') != 'manager']

t_direct_gp = group('DIRECT GPs (manager_id=Teja, not TL, not manager)', direct_gps)
t_direct_tl = group('DIRECT TLs (manager_id=Teja, is_tl=true)', direct_tls)

gps_under_tls = [u for u in users if u.get('tl_id') in {t['id'] for t in direct_tls} and u['id'] != MID]
t_under_tls = group("GPs under Teja's direct TLs", gps_under_tls)

t_submgr = group('SUB-MANAGERS (manager_id=Teja, role=manager)', direct_submgr)
sub_ids = {m['id'] for m in direct_submgr}
sub_direct = [u for u in users if u.get('manager_id') in sub_ids]
sub_tls = [u for u in sub_direct if u.get('is_tl')]
sub_gps = [u for u in sub_direct if not u.get('is_tl')]
t_sub_gps = group("GPs directly under sub-managers", sub_gps)
t_sub_tls = group("TLs under sub-managers", sub_tls)
gps_under_sub_tls = [u for u in users if u.get('tl_id') in {t['id'] for t in sub_tls}]
t_under_sub_tls = group("GPs under sub-managers' TLs", gps_under_sub_tls)

everyone = {u['id']: u for u in (direct_gps + direct_tls + gps_under_tls + direct_submgr +
                                 sub_gps + sub_tls + gps_under_sub_tls)}
everyone[MID] = mgr
active_ids = [uid for uid, u in everyone.items() if u.get('is_active')]

print('\n================ TOTALS ================')
print(f'Direct GPs                    : {len(direct_gps):3d} users, files {t_direct_gp}')
print(f"Direct TLs                    : {len(direct_tls):3d} users, files {t_direct_tl}")
print(f"GPs under Teja's TLs          : {len(gps_under_tls):3d} users, files {t_under_tls}")
print(f'Sub-managers                  : {len(direct_submgr):3d} users, files {t_submgr}')
print(f'GPs under sub-managers        : {len(sub_gps):3d} users, files {t_sub_gps}')
print(f"TLs under sub-managers        : {len(sub_tls):3d} users, files {t_sub_tls}")
print(f"GPs under sub-managers' TLs   : {len(gps_under_sub_tls):3d} users, files {t_under_sub_tls}")
print(f'TOTAL downward hierarchy      : {len(everyone):3d} users ({len(active_ids)} active)')
print(f"  audit file sum (all)        : {sum(owner_files.get(i,0) for i in everyone)}")
print(f"  audit file sum (active only): {sum(owner_files.get(i,0) for i in active_ids)}")

s, mt = req('/api/auth/login', method='POST', body={'email': MGR_EMAIL, 'password': 'tejasme12'})
mtok = mt.get('access_token') or mt.get('token') if isinstance(mt, dict) else None
if mtok:
    st, dd = req('/api/files/?page=1&limit=1', mtok)
    print(f"CURRENT API RESULT (manager login) : {st} total={dd['pagination']['total'] if st==200 else dd}")
else:
    print('CURRENT API RESULT: manager login failed', s, mt)

print('\n--- ROOT-CAUSE CLASSIFICATION ---')
no_mgr = [u for u in users if u.get('is_active') and u.get('tl_id') and not u.get('manager_id')]
print(f'active users with tl_id but NO manager_id (broken linkage): {len(no_mgr)}')
for u in no_mgr[:15]:
    print(desc(u))
tl_mismatch = [u for u in users if u.get('is_active') and u.get('tl_id') and u.get('manager_id')
               and by_id.get(u['tl_id']) and by_id[u['tl_id']].get('manager_id') != u.get('manager_id')]
print(f"active users whose manager_id != their TL's manager_id: {len(tl_mismatch)}")
for u in tl_mismatch[:15]:
    print(desc(u))
orphan_tl = [u for u in users if u.get('is_active') and u.get('tl_id') and u['tl_id'] not in by_id]
print(f'active users whose tl_id points at a NON-EXISTENT user (legacy id): {len(orphan_tl)}')
for u in orphan_tl[:15]:
    print(desc(u))
orphan_mgr = [u for u in users if u.get('is_active') and u.get('manager_id') and u['manager_id'] not in by_id]
print(f'active users whose manager_id points at a NON-EXISTENT user (legacy id): {len(orphan_mgr)}')
for u in orphan_mgr[:15]:
    print(desc(u))
inactive_in_tree = [u for uid, u in everyone.items() if not u.get('is_active')]
print(f'users in Teja tree excluded because is_active=False: {len(inactive_in_tree)}, '
      f'their files={sum(owner_files.get(u["id"],0) for u in inactive_in_tree)}')
for u in inactive_in_tree[:15]:
    print(desc(u))
