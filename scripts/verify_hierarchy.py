#!/usr/bin/env python3
"""A+B / fail-closed / list-vs-stats parity matrix. Usage: verify_hierarchy.py <base_url>"""
import sys, json, urllib.request, urllib.error
BASE = sys.argv[1].rstrip('/')
UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
ACC = {
    'admin': ('admin@bankezee.com', 'ConnectSasha12!!'),
    'manager_teja': ('teja@bankezee.com', 'tejasme12'),
    'manager_saikiran': ('saikiran@bankezee.com', 'saikiran12'),
    'tl_anusha': ('yarragondaanusha@gmail.com', '9063023292'),
    'tl_pinky': ('pinkynagulapally@gmail.com', 'Pinky@1234'),
    'gp_nithin': ('banothunithinnaik@gmail.com', 'Nithin@123'),
}
rows = []


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
        return e.code, e.read().decode()[:120]
    except Exception as e:
        return 0, str(e)


def check(name, ok, detail):
    rows.append((bool(ok), name, detail))
    print(f"[{'PASS' if ok else 'FAIL'}] {name:52s} {detail}")


tok = {}
for k, (e, p) in ACC.items():
    s, d = req('/api/auth/login', m='POST', b={'email': e, 'password': p})
    tok[k] = (d.get('access_token') or d.get('token')) if isinstance(d, dict) else None
A = tok['admin']
print('logins:', {k: bool(v) for k, v in tok.items()}, '\n')

s, us = req('/api/users?limit=2000', A)
us = us if isinstance(us, list) else us.get('users', [])
by_email = {}
for u in us:
    by_email.setdefault(u['email'], []).append(u)


def pair(scope_params, token=A):
    """Return (list_total, list_rows, stats_total) for identical filters."""
    s1, d1 = req(f'/api/files/?page=1&limit=50&{scope_params}', token)
    s2, d2 = req(f'/api/files/dashboard/stats?{scope_params}', token)
    lt = d1['pagination']['total'] if s1 == 200 and isinstance(d1, dict) else f'ERR{s1}'
    lr = len(d1['files']) if s1 == 200 and isinstance(d1, dict) else 0
    st = d2.get('total_files') if s2 == 200 and isinstance(d2, dict) else f'ERR{s2}'
    return lt, lr, st


print('--- A: identity resolution / B: recursive hierarchy ---')
for label, key in [('Manager Teja', 'manager_teja'), ('Manager Saikiran', 'manager_saikiran'),
                   ('TL Anusha', 'tl_anusha'), ('TL Pinky', 'tl_pinky'), ('GP Nithin', 'gp_nithin')]:
    if not tok[key]:
        check(f'{label} own scope', False, 'login failed')
        continue
    lt, lr, st = pair('', tok[key])
    check(f'{label} own scope', lt == st and isinstance(lt, int),
          f'list={lt} rows={lr} stats={st}')
if tok['tl_anusha']:
    lt, lr, st = pair('team_view=true', tok['tl_anusha'])
    check('TL Anusha team_view subtree', lt == st, f'list={lt} rows={lr} stats={st}')

print('\n--- admin explicit filters: list vs stats parity ---')
teja = [u for u in by_email.get('teja@bankezee.com', [])]
anusha = by_email.get('yarragondaanusha@gmail.com', [])
nithin = by_email.get('banothunithinnaik@gmail.com', [])
pinky = by_email.get('pinkynagulapally@gmail.com', [])
lt, lr, st = pair('')
check('admin no filter (unrestricted)', lt == st and isinstance(lt, int) and lt > 0, f'list={lt} stats={st}')
for label, u in [('manager_id=Teja(id A)', teja[0] if teja else None),
                 ('manager_id=Teja(id B)', teja[1] if len(teja) > 1 else None),
                 ('tl_id=Anusha', anusha[0] if anusha else None),
                 ('tl_id=Pinky', pinky[0] if pinky else None),
                 ('gp_id=Nithin', nithin[0] if nithin else None)]:
    if not u:
        continue
    field = label.split('=')[0]
    lt, lr, st = pair(f'{field}={u["id"]}')
    check(f'admin {label}', lt == st, f'list={lt} rows={lr} stats={st}  id={u["id"]}')

print('\n--- identity resolution: both Teja ids must give the SAME scope ---')
if len(teja) > 1:
    a = pair(f'manager_id={teja[0]["id"]}')
    b = pair(f'manager_id={teja[1]["id"]}')
    check('Teja id A == Teja id B scope', a == b, f'{a} vs {b}')

print('\n--- fail closed ---')
lt, lr, st = pair('gp_id=00000000-0000-0000-0000-000000000000')
check('unknown gp_id -> 0 (not all files)', lt == 0 and lr == 0 and st == 0, f'list={lt} rows={lr} stats={st}')
lt, lr, st = pair('tl_id=00000000-0000-0000-0000-000000000000')
check('unknown tl_id -> 0', lt == 0 and lr == 0 and st == 0, f'list={lt} rows={lr} stats={st}')
lt, lr, st = pair('manager_id=00000000-0000-0000-0000-000000000000')
check('unknown manager_id -> 0', lt == 0 and lr == 0 and st == 0, f'list={lt} rows={lr} stats={st}')
zero_tl = next((u for u in us if u.get('is_tl') and u.get('is_active')), None)
non_tl = next((u for u in us if not u.get('is_tl') and u.get('is_active') and (u.get('files_count') or 0) == 0), None)
if non_tl:
    lt, lr, st = pair(f'tl_id={non_tl["id"]}')
    check('tl_id of a non-TL (empty team) -> 0', lt == 0 and st == 0, f'list={lt} stats={st} {non_tl["email"]}')
    lt, lr, st = pair(f'gp_id={non_tl["id"]}')
    check('gp_id of a GP with zero files -> 0', lt == 0 and st == 0, f'list={lt} stats={st}')

print('\n--- combined filters: same population in list and stats ---')
if nithin:
    for extra in ['file_status=disbursed', 'loan_types=new_personal_loan',
                  'start_date=2026-01-01&end_date=2026-12-31',
                  'activity_start_date=2026-09-01&activity_end_date=2026-09-30']:
        lt, lr, st = pair(f'gp_id={nithin[0]["id"]}&{extra}')
        check(f'gp_id + {extra[:34]}', lt == st, f'list={lt} stats={st}')
for extra in ['file_status=new', 'loan_types=business_loan', 'search=a',
              'activity_start_date=2026-09-01&activity_end_date=2026-09-30']:
    lt, lr, st = pair(extra)
    check(f'admin {extra[:40]}', lt == st, f'list={lt} stats={st}')

print('\n--- UUID ids must not 500 (tracking sheet) ---')
s, gps = req('/api/users/growth-partners', A)
gps = gps if isinstance(gps, list) else []
uuidish = [g for g in gps if g.get('id') and '-' in str(g['id'])][:3]
for g in uuidish:
    s, d = req(f"/api/reports/daily-tracking-sheet?user_id={g['id']}&month=9&year=2026", A)
    check(f"tracking UUID id {g.get('name')}", s == 200, f'HTTP {s}')
gp_roles_empty = []
for g in gps:
    s, d = req(f"/api/reports/daily-tracking-sheet?user_id={g['id']}&month=9&year=2026", A)
    if s != 200:
        gp_roles_empty.append((g.get('name'), g.get('role'), s))
check('no non-200 tracking responses for any dropdown GP', not gp_roles_empty, str(gp_roles_empty[:4]))
s, allr = req('/api/reports/daily-tracking-sheet?month=9&year=2026', A)
if s == 200:
    names = [r['user_name'] for r in allr]
    check('tracking includes growth_partner-role agents', len(allr) > 0,
          f'agents={len(allr)} unique={len(set(names))} dupes={len(names)-len(set(names))}')
    for target in ['Meghana', 'Asma', 'Nithin', 'pinky', 'Anusha']:
        hit = [r for r in allr if target.lower() in str(r['user_name']).lower()]
        check(f'  {target} present in tracking', bool(hit),
              f"{[(h['user_name'], h['totals']['calls'], len(h['daily_data'])) for h in hit]}")

print('\n--- TL dropdown scoped by manager subtree ---')
for u in (teja[:1] + by_email.get('saikiran@bankezee.com', [])[:1]):
    s, d = req(f"/api/users/team-leads?manager_id={u['id']}", A)
    names = [t.get('name') for t in d if isinstance(d, list) and t.get('id')]
    check(f"team-leads under {u['email']}", s == 200, f'{names}')

fails = [r for r in rows if not r[0]]
print(f'\n==== {len(rows)-len(fails)}/{len(rows)} PASS, {len(fails)} FAIL ====')
for f in fails:
    print('  FAIL', f[1], '|', f[2])
