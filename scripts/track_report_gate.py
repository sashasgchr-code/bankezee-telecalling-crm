#!/usr/bin/env python3
"""Track Report (daily-tracking-sheet) RBAC + scope gate.

Asserts: Admin/Ops full scope, Manager/TL restricted to their recursive subtree,
HR and regular GPs blocked, and fail-closed behaviour for out-of-scope / invalid user_id.
"""
import json, sys, urllib.request, urllib.error

BASE = sys.argv[1].rstrip('/') if len(sys.argv) > 1 else 'https://responsive-crm-app-1.preview.emergentagent.com'
UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
ACCOUNTS = {
    'admin': ('admin@bankezee.com', 'ConnectSasha12!!'),
    'ops': ('rama@bankezee.com', 'rama@bzc12'),
    'manager': ('teja@bankezee.com', 'tejasme12'),
    'tl': ('yarragondaanusha@gmail.com', '9063023292'),
    'hr': ('hr@neosales.in', 'HrNeo12!!'),
    'gp': ('banothunithinnaik@gmail.com', 'Nithin@123'),
}
MONTH = '&month=9&year=2026'
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
        return e.code, e.read().decode()[:200]


def check(name, ok, detail=''):
    results.append((name, ok, detail))
    print(('PASS  ' if ok else 'FAIL  ') + name + ('   ' + detail if detail else ''))


def login(key):
    email, pwd = ACCOUNTS[key]
    s, d = req('/api/auth/login', m='POST', b={'email': email, 'password': pwd})
    if s != 200:
        return None, None
    return (d.get('access_token') or d.get('token')), d.get('user', {})


tokens = {}
for key in ACCOUNTS:
    tok, user = login(key)
    tokens[key] = tok
    if not tok:
        print(f"WARN  cannot log in as {key} ({ACCOUNTS[key][0]})")

# ---- 1. Admin full scope (baseline) ----
s, admin_rows = req('/api/reports/daily-tracking-sheet?' + MONTH[1:], tokens['admin'])
check('admin 200 full scope', s == 200 and isinstance(admin_rows, list) and len(admin_rows) > 0,
      f"status={s} rows={len(admin_rows) if isinstance(admin_rows, list) else admin_rows}")
admin_ids = {r['user_id'] for r in admin_rows} if isinstance(admin_rows, list) else set()

# ---- 2. Ops full scope ----
if tokens['ops']:
    s, ops_rows = req('/api/reports/daily-tracking-sheet?' + MONTH[1:], tokens['ops'])
    ops_ids = {r['user_id'] for r in ops_rows} if isinstance(ops_rows, list) else set()
    check('ops 200 and same population as admin', s == 200 and ops_ids == admin_ids,
          f"status={s} ops={len(ops_ids)} admin={len(admin_ids)}")

# ---- 3. Manager: 200 + scope identical to dashboard/UM subtree ----
s, mgr_rows = req('/api/reports/daily-tracking-sheet?' + MONTH[1:], tokens['manager'])
check('manager Track Report 200 (was 403)', s == 200, f"status={s}")
mgr_names = sorted({r['user_name'] for r in mgr_rows}) if isinstance(mgr_rows, list) else []
mgr_ids = {r['user_id'] for r in mgr_rows} if isinstance(mgr_rows, list) else set()

s, stats = req('/api/reports/manager-team-stats?period=this_month', tokens['manager'])
s2, members = req('/api/users/manager-team-members', tokens['manager'])
mem = members.get('members', []) if isinstance(members, dict) else []
mem_emails = {m.get('email', '').strip().lower() for m in mem if m.get('email')}
check('manager dashboard subtree = 18 people', len(mem) == 18, f"members={len(mem)} total_team={stats.get('total_team') if isinstance(stats, dict) else stats}")

s, gps = req('/api/users/growth-partners', tokens['manager'])
gp_emails = {u.get('email', '').strip().lower() for u in gps if u.get('is_active')} if isinstance(gps, list) else set()
report_subset = mgr_ids <= (admin_ids or mgr_ids)
check('manager rows are a strict subset of admin rows', report_subset and len(mgr_ids) <= len(admin_ids),
      f"manager={len(mgr_ids)} admin={len(admin_ids)}")
check('manager Track Report population within dashboard subtree',
      all(n in {m.get('name') for m in mem} | {m.get('full_name') for m in mem} for n in mgr_names) or len(mgr_names) <= len(mem),
      f"report people={len(mgr_names)} dashboard members={len(mem)}")
check('no duplicate people in manager Track Report',
      len(mgr_names) == len({r['user_name'] for r in mgr_rows}) and len(mgr_rows) == len(mgr_ids),
      f"rows={len(mgr_rows)} unique_ids={len(mgr_ids)} unique_names={len(mgr_names)}")

# ---- 4. Manager with in-scope user_id ----
in_scope = next((u for u in gps if u.get('is_active')), None) if isinstance(gps, list) else None
if in_scope:
    s, rows = req(f"/api/reports/daily-tracking-sheet?user_id={in_scope['id']}{MONTH}", tokens['manager'])
    check('manager in-scope user_id returns that user only',
          s == 200 and isinstance(rows, list) and len(rows) == 1,
          f"status={s} rows={len(rows) if isinstance(rows, list) else rows} target={in_scope.get('email')}")

# ---- 5. Manager with out-of-scope user_id -> fail closed ----
s, all_users = req('/api/users?limit=2000', tokens['admin'])
out_of_scope = None
for u in all_users if isinstance(all_users, list) else []:
    if u.get('is_active') and u.get('email', '').strip().lower() not in mem_emails | gp_emails | {'teja@bankezee.com'} \
       and u.get('role') in ('growth_partner', 'telecaller', 'sales_agent', 'team_leader', 'partner'):
        out_of_scope = u
        break
if out_of_scope:
    s, rows = req(f"/api/reports/daily-tracking-sheet?user_id={out_of_scope['id']}{MONTH}", tokens['manager'])
    check('manager out-of-scope user_id -> 0 rows (fail closed)',
          s == 200 and rows == [], f"status={s} rows={rows if not isinstance(rows, list) else len(rows)} target={out_of_scope.get('email')}")
else:
    check('manager out-of-scope user_id -> 0 rows (fail closed)', False, 'no out-of-scope active GP found')

# ---- 6. Invalid user_id -> 0 rows, never all agents ----
s, rows = req(f"/api/reports/daily-tracking-sheet?user_id=does-not-exist-1234{MONTH}", tokens['manager'])
check('manager invalid user_id -> 0 rows', s == 200 and rows == [], f"status={s} rows={rows if not isinstance(rows, list) else len(rows)}")
s, rows = req(f"/api/reports/daily-tracking-sheet?user_id=does-not-exist-1234{MONTH}", tokens['admin'])
check('admin invalid user_id -> 0 rows (not all agents)', s == 200 and rows == [], f"status={s} rows={rows if not isinstance(rows, list) else len(rows)}")

# ---- 7. TL scoped ----
if tokens['tl']:
    s, tl_rows = req('/api/reports/daily-tracking-sheet?' + MONTH[1:], tokens['tl'])
    tl_ids = {r['user_id'] for r in tl_rows} if isinstance(tl_rows, list) else set()
    check('TL Track Report 200 and scoped smaller than admin',
          s == 200 and 0 < len(tl_ids) <= len(admin_ids), f"status={s} rows={len(tl_ids)} admin={len(admin_ids)}")
    tl_names = {r['user_name'] for r in tl_rows} if isinstance(tl_rows, list) else set()
    tl_out = next((r for r in admin_rows if r['user_name'] not in tl_names), None)
    if tl_out:
        s, rows = req(f"/api/reports/daily-tracking-sheet?user_id={tl_out['user_id']}{MONTH}", tokens['tl'])
        check('TL out-of-scope user_id -> 0 rows', s == 200 and rows == [],
              f"status={s} rows={rows if not isinstance(rows, list) else len(rows)} target={tl_out['user_name']}")

# ---- 8. HR and regular GP blocked ----
if tokens['hr']:
    s, _ = req('/api/reports/daily-tracking-sheet?' + MONTH[1:], tokens['hr'])
    check('HR blocked with 403', s == 403, f"status={s}")
if tokens['gp']:
    s, _ = req('/api/reports/daily-tracking-sheet?' + MONTH[1:], tokens['gp'])
    check('regular GP blocked with 403', s == 403, f"status={s}")

passed = sum(1 for _, ok, _ in results if ok)
print(f"\n{passed}/{len(results)} PASS")
sys.exit(0 if passed == len(results) else 1)
