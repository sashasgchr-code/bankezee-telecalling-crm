#!/usr/bin/env python3
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
        with urllib.request.urlopen(r, data, timeout=120) as resp:
            return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:200]
    except Exception as e:
        return 0, str(e)


def login(e, p):
    s, d = req('/api/auth/login', method='POST', body={'email': e, 'password': p})
    return (d.get('access_token') or d.get('token')) if isinstance(d, dict) else None, d


A, _ = login('admin@bankezee.com', 'ConnectSasha12!!')
M, mraw = login('teja@bankezee.com', 'tejasme12')
print('teja login payload keys:', list(mraw.keys()) if isinstance(mraw, dict) else mraw)
print('teja user in payload:', json.dumps(mraw.get('user', {}), indent=1)[:600] if isinstance(mraw, dict) else '')

s, us = req('/api/users?limit=2000', A)
us = us if isinstance(us, list) else us.get('users', [])
pinky = next(u for u in us if u['email'] == 'pinkynagulapally@gmail.com')
teja = next(u for u in us if u['email'] == 'teja@bankezee.com')
print('\npinky id', pinky['id'], 'is_active', pinky.get('is_active'), 'role', pinky.get('role'), 'is_tl', pinky.get('is_tl'), 'manager_id', pinky.get('manager_id'))
print('teja  id', teja['id'], 'is_active', teja.get('is_active'), 'role', teja.get('role'))

for label, path, tok in [
    ('admin manager_id=teja', f"/api/files/?limit=1&manager_id={teja['id']}", A),
    ('admin gp_id=pinky', f"/api/files/?limit=1&gp_id={pinky['id']}", A),
    ('admin tl_id=pinky', f"/api/files/?limit=1&tl_id={pinky['id']}", A),
    ('teja own list', '/api/files/?limit=1', M),
    ('teja dashboard stats', '/api/files/dashboard/stats', M),
]:
    st, d = req(path, tok)
    if st == 200 and isinstance(d, dict):
        print(f'{label:26s} {st} {d.get("pagination") or {k: d[k] for k in list(d)[:2]}}')
    else:
        print(f'{label:26s} {st} {str(d)[:120]}')

print('\nlinkage stats:')
print(' users with tl_id set        :', sum(1 for u in us if u.get('tl_id')))
print(' users with manager_id set   :', sum(1 for u in us if u.get('manager_id')))
print(' users with tl_id == pinky   :', [u['email'] for u in us if u.get('tl_id') == pinky['id']])
print(' managers                    :', [(u['email'], u['id'], u.get('is_active')) for u in us if u.get('role') == 'manager'])
print(' is_tl users                 :', [(u['email'], u.get('manager_id'), u.get('is_active')) for u in us if u.get('is_tl')])
print(' active/total                :', sum(1 for u in us if u.get('is_active')), '/', len(us))
print(' roles                       :', json.dumps({r: sum(1 for u in us if u.get('role') == r) for r in {u.get('role') for u in us}}))
print(' can_login active users      :', sum(1 for u in us if u.get('is_active') and u.get('can_login')))
top = sorted(us, key=lambda u: -(u.get('files_count') or 0))[:12]
print('\n top files_count (OLD deployed definition = all leads):')
for u in top:
    print(f"   {u['email'][:38]:40s} role={u.get('role','?'):14s} active={str(bool(u.get('is_active'))):5s} files_count={u.get('files_count')}")
