#!/usr/bin/env python3
"""RBAC + pagination matrix for the Files list endpoint. Usage: matrix.py <base_url>"""
import sys, json, urllib.request, urllib.error

BASE = sys.argv[1].rstrip('/')
ACCOUNTS = {
    'admin': ('admin@bankezee.com', 'ConnectSasha12!!'),
    'manager_teja': ('teja@bankezee.com', 'tejasme12'),
    'tl_anusha': ('yarragondaanusha@gmail.com', '9063023292'),
    'gp_nithin': ('banothunithinnaik@gmail.com', 'Nithin@123'),
}


def req(path, token=None, method='GET', body=None):
    r = urllib.request.Request(BASE + path, method=method)
    r.add_header('Content-Type', 'application/json')
    r.add_header('User-Agent', 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36')
    if token:
        r.add_header('Authorization', 'Bearer ' + token)
    data = json.dumps(body).encode() if body else None
    try:
        with urllib.request.urlopen(r, data, timeout=60) as resp:
            return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:200]
    except Exception as e:
        return 0, str(e)


tokens = {}
for k, (em, pw) in ACCOUNTS.items():
    s, d = req('/api/auth/login', method='POST', body={'email': em, 'password': pw})
    tokens[k] = d.get('access_token') or d.get('token') if isinstance(d, dict) else None
    print(f'login {k:14s} -> {s} token={"yes" if tokens[k] else "NO: "+str(d)[:120]}')

adm = tokens['admin']


def show(label, path, token):
    s, d = req(path, token)
    if s == 200 and isinstance(d, dict):
        print(f'{label:46s} {s}  total={d["pagination"]["total"]:6d} rows={len(d["files"])}')
        return d
    print(f'{label:46s} {s}  ERROR {str(d)[:120]}')
    return None


print('\n--- ADMIN ---')
show('A admin no filters page1 limit50', '/api/files/?page=1&limit=50', adm)
show('H admin page2 limit50', '/api/files/?page=2&limit=50', adm)
show('  admin limit=500', '/api/files/?page=1&limit=500', adm)

s, gps = req('/api/users/growth-partners', adm)
gp_list = gps if isinstance(gps, list) else (gps.get('users') or gps.get('growth_partners') or [])
s, mgrs = req('/api/users/managers', adm)
mgr_list = mgrs if isinstance(mgrs, list) else (mgrs.get('users') or mgrs.get('managers') or [])
s, tls = req('/api/users/team-leads', adm)
tl_list = tls if isinstance(tls, list) else (tls.get('users') or tls.get('team_leads') or [])
print(f'\ngps={len(gp_list)} managers={len(mgr_list)} tls={len(tl_list)}')

nithin = next((u for u in gp_list if u.get('email') == 'banothunithinnaik@gmail.com'), None)
if nithin:
    print(f'nithin id={nithin.get("id")} files_count={nithin.get("files_count")}')
    show('B admin gp_id=nithin', f'/api/files/?page=1&limit=50&gp_id={nithin["id"]}', adm)
for t in tl_list[:2]:
    if t.get('id'):
        show(f'C admin tl_id={t.get("name") or t.get("full_name")}', f'/api/files/?page=1&limit=50&tl_id={t["id"]}', adm)
for m in mgr_list[:2]:
    if m.get('id'):
        show(f'D admin manager_id={m.get("name") or m.get("full_name")}', f'/api/files/?page=1&limit=50&manager_id={m["id"]}', adm)

print('\n--- ROLE SCOPED ---')
for k, label in [('gp_nithin', 'E GP nithin'), ('tl_anusha', 'F TL anusha'), ('manager_teja', 'G manager teja')]:
    if tokens[k]:
        show(label, '/api/files/?page=1&limit=50', tokens[k])
if tokens['tl_anusha']:
    show('F2 TL anusha team_view=true', '/api/files/?page=1&limit=50&team_view=true', tokens['tl_anusha'])

print('\n--- SINGLE RECORD BY ID ---')
d = show('  admin fetch page1', '/api/files/?page=1&limit=3', adm)
if d and d['files']:
    fid = d['files'][0].get('id')
    s, one = req(f'/api/files/{fid}', adm)
    print(f'  GET /api/files/{fid} -> {s} name={one.get("name") if isinstance(one, dict) else str(one)[:80]}')
    s, el = req(f'/api/files/{fid}/eligibilities', adm)
    print(f'  eligibilities -> {s} n={len(el) if isinstance(el, list) else el}')
    s, ac = req(f'/api/files/{fid}/activities', adm)
    print(f'  activities    -> {s} n={len(ac) if isinstance(ac, list) else ac}')

print('\n--- J OTHER REPORTING ENDPOINTS (admin) ---')
for p in ['/api/files/dashboard/stats', '/api/files/reports', '/api/files/reports/daily',
          '/api/files/reports/rejected', '/api/files/reports/quality',
          '/api/files/reports/bank-performance', '/api/files/reports/tat-metrics',
          '/api/files/reports/growth-partner', '/api/files/operations-team',
          '/api/files/statuses', '/api/files/commissions']:
    s, d2 = req(p, adm)
    print(f'  {p:44s} {s}')
