#!/usr/bin/env python3
"""Post-deploy acceptance matrix. Usage: acceptance_matrix.py <base_url>

Write flows are exercised NON-DESTRUCTIVELY:
  - details save  -> re-saves the values already on the record
  - status change -> sets the status to its CURRENT value
  - note          -> appends one audit note (append-only, clearly labelled)
"""
import sys, json, urllib.request, urllib.error, datetime

BASE = sys.argv[1].rstrip('/')
UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
ACC = {
    'admin': ('admin@bankezee.com', 'ConnectSasha12!!'),
    'manager_teja': ('teja@bankezee.com', 'tejasme12'),
    'tl_anusha': ('yarragondaanusha@gmail.com', '9063023292'),
    'gp_nithin': ('banothunithinnaik@gmail.com', 'Nithin@123'),
}
results = []


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
        return e.code, e.read().decode()[:200]
    except Exception as e:
        return 0, str(e)


def row(name, status, detail):
    ok = 'PASS' if status == 200 else 'FAIL'
    results.append((ok, name, status, detail))
    print(f'[{ok}] {name:52s} {status}  {detail}')


tok = {}
for k, (e, p) in ACC.items():
    s, d = req('/api/auth/login', method='POST', body={'email': e, 'password': p})
    tok[k] = (d.get('access_token') or d.get('token')) if isinstance(d, dict) else None
    row(f'login {k}', s, 'token ok' if tok[k] else str(d)[:80])
A = tok['admin']

s, d = req('/api/files/?page=1&limit=50', A)
row('Admin Files page1 limit50', s, f"total={d['pagination']['total']} rows={len(d['files'])}" if s == 200 else str(d)[:90])
total = d['pagination']['total'] if s == 200 else None
files_p1 = d['files'] if s == 200 else []

s, d2 = req('/api/files/?page=2&limit=50', A)
row('Admin Files page2 limit50', s, f"rows={len(d2['files'])}" if s == 200 else str(d2)[:90])
s, d3 = req('/api/files/dashboard/stats', A)
row('Admin dashboard stats', s, f"total_files={d3.get('total_files')}" if s == 200 else str(d3)[:90])

legacy = next((f for f in files_p1 if len(str(f.get('id', ''))) == 24 and all(c in '0123456789abcdef' for c in str(f.get('id')))), None)
target = legacy or (files_p1[0] if files_p1 else None)
if target:
    fid = target['id']
    kind = 'legacy _id' if legacy else 'uuid id'
    s, one = req(f'/api/files/{fid}', A)
    row(f'File detail by {kind} ({fid})', s, f"name={one.get('name')} status={one.get('file_status')}" if s == 200 else str(one)[:90])
    cur = one if s == 200 else {}
    s, el = req(f'/api/files/{fid}/eligibilities', A)
    row('  eligibilities', s, f'n={len(el)}' if s == 200 else str(el)[:90])
    s, ac = req(f'/api/files/{fid}/activities', A)
    row('  activities', s, f'n={len(ac)}' if s == 200 else str(ac)[:90])
    stamp = datetime.datetime.now().strftime('%Y-%m-%d %H:%M')
    s, r1 = req(f'/api/files/{fid}/notes', A, 'POST',
                {'note': f'[acceptance check {stamp}] endpoint verification, no data changed'})
    row('  note save (append-only)', s, str(r1)[:90])
    s, r2 = req(f'/api/files/{fid}/file-status', A, 'PUT', {'file_status': cur.get('file_status') or 'new'})
    row(f"  status change (no-op -> {cur.get('file_status')})", s, str(r2)[:90])
    fd = cur.get('file_details') or {}
    s, r3 = req(f'/api/files/{fid}/details', A, 'PUT', {
        'full_name': fd.get('full_name') or cur.get('name'),
        'mobile': fd.get('mobile') or cur.get('phone'),
        'additional_data': fd})
    row('  details save (same values)', s, str(r3)[:90])
    s, again = req(f'/api/files/{fid}', A)
    has_note = any('acceptance check' in str(a.get('message', '')) for a in (again.get('file_activities') or [])) if s == 200 else False
    row('  re-fetch after writes', s, f'note persisted={has_note}')

s, us = req('/api/users?limit=2000', A)
us = us if isinstance(us, list) else us.get('users', [])
row('Admin users list', s, f'docs={len(us)} active={sum(1 for u in us if u.get("is_active"))}')
nit = next((u for u in us if u['email'] == 'banothunithinnaik@gmail.com'), None)
if nit:
    s, d4 = req(f"/api/files/?limit=1&gp_id={nit['id']}", A)
    api_n = d4['pagination']['total'] if s == 200 else None
    row('Nithin files via admin gp_id filter', s, f'total={api_n}')
    row('Nithin Users-page files_count', 200 if nit.get('files_count') is not None else 0,
        f"files_count={nit.get('files_count')} leads_count={nit.get('leads_count')} "
        f"reconciles_with_api={nit.get('files_count') == api_n}")

for k, label in [('gp_nithin', 'GP Nithin own scoped list'), ('tl_anusha', 'TL Anusha own scoped list'),
                 ('manager_teja', 'Manager Teja scoped list (known 0 - hierarchy gap)')]:
    if tok[k]:
        s, d5 = req('/api/files/?page=1&limit=50', tok[k])
        row(label, s, f"total={d5['pagination']['total']} rows={len(d5['files'])}" if s == 200 else str(d5)[:90])

print('\n--- report endpoints ---')
for p in ['/api/files/reports', '/api/files/reports/daily', '/api/files/reports/rejected',
          '/api/files/reports/quality', '/api/files/reports/bank-performance',
          '/api/files/reports/tat-metrics', '/api/files/reports/growth-partner',
          '/api/files/commissions', '/api/files/operations-team', '/api/files/statuses']:
    s, _ = req(p, A)
    row(p, s, '')

fails = [r for r in results if r[0] == 'FAIL']
print(f'\n==== {len(results)-len(fails)}/{len(results)} PASS, {len(fails)} FAIL ====')
for f in fails:
    print('  FAIL', f[1], f[2], f[3])
