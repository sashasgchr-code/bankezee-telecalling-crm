#!/usr/bin/env python3
import sys, json, urllib.request, urllib.error
from collections import Counter
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
s, us = req('/api/users?limit=2000', A)
us = us if isinstance(us, list) else us.get('users', [])
c = Counter(u['email'] for u in us)
dups = {e: n for e, n in c.items() if n > 1}
print(f'total user docs={len(us)} unique emails={len(c)} duplicated emails={len(dups)} extra docs={sum(dups.values())-len(dups)}')
print('sample dups:', list(dups.items())[:8])
print('is_active values:', Counter(str(u.get("is_active")) for u in us))
print('role x is_active:', Counter((u.get('role'), str(u.get('is_active'))) for u in us).most_common(8))

for em, pw in [('banothunithinnaik@gmail.com', 'Nithin@123'),
               ('yarragondaanusha@gmail.com', '9063023292'),
               ('pinkynagulapally@gmail.com', 'Pinky@1234')]:
    tok, raw = login(em, pw)
    u = raw.get('user', {}) if isinstance(raw, dict) else {}
    docs = [x for x in us if x['email'] == em]
    print(f"\n{em}")
    print(f"  session id={u.get('id')} role={u.get('role')} is_tl={u.get('is_tl')} manager_id={u.get('manager_id')} tl_id={u.get('tl_id')}")
    for d in docs:
        st, f = req(f"/api/files/?limit=1&gp_id={d['id']}", A)
        tot = f['pagination']['total'] if st == 200 and isinstance(f, dict) else f'ERR{st}'
        print(f"  doc id={d['id']} role={d.get('role'):12s} active={d.get('is_active')} mgr={d.get('manager_id')} tl={d.get('tl_id')} legacy={d.get('legacy_user_id')} adminGpFilter={tot} files_count={d.get('files_count')}")
    if tok:
        st, f = req('/api/files/?limit=1', tok)
        print(f"  own list -> {st} total={f['pagination']['total'] if st==200 and isinstance(f,dict) else f}")
