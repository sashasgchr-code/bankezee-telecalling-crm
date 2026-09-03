#!/usr/bin/env python3
"""C DRY-RUN: proposed production hierarchy link repair + duplicate report. WRITES NOTHING.

Evidence sources:
  - CURRENT state: connect.bankezee.com /api/users (read-only API)
  - INTENDED links: the preview database, which was configured from the user's @users
    spreadsheet and has manager_id / tl_id populated for the 19 active GPs.
Matching between the two is by normalized email only.
"""
import asyncio, json, os, urllib.request, urllib.error
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
PROD = 'https://connect.bankezee.com'
load_dotenv('/app/backend/.env')


def req(p, t=None, m='GET', b=None):
    r = urllib.request.Request(PROD + p, method=m)
    r.add_header('Content-Type', 'application/json')
    r.add_header('User-Agent', UA)
    if t:
        r.add_header('Authorization', 'Bearer ' + t)
    with urllib.request.urlopen(r, json.dumps(b).encode() if b else None, timeout=180) as z:
        return json.loads(z.read().decode())


def norm(e):
    return (e or '').strip().lower()


async def main():
    tok = req('/api/auth/login', m='POST', b={'email': 'admin@bankezee.com', 'password': 'ConnectSasha12!!'})
    A = tok.get('access_token') or tok.get('token')
    prod_users = req('/api/users?limit=2000', A)

    db = AsyncIOMotorClient(os.environ['MONGO_URL'])[os.environ['DB_NAME']]
    intended = {}
    prev_by_id = {}
    async for u in db.users.find({}, {'_id': 0, 'id': 1, 'email': 1, 'name': 1, 'manager_id': 1,
                                      'tl_id': 1, 'is_tl': 1, 'is_active': 1, 'role': 1}):
        prev_by_id[u.get('id')] = u
        if u.get('is_active'):
            intended[norm(u.get('email'))] = u

    # group production docs by email (the identity key)
    people = {}
    for u in prod_users:
        people.setdefault(norm(u['email']), []).append(u)

    prod_id_by_email = {}
    for em, docs in people.items():
        primary = next((d for d in docs if d.get('is_active')), docs[0])
        prod_id_by_email[em] = primary['id']

    def file_count(uid):
        try:
            return req(f'/api/files/?limit=1&gp_id={uid}', A)['pagination']['total']
        except Exception:
            return None

    link_changes, dup_rows, unresolved = [], [], []
    for em, docs in sorted(people.items()):
        want = intended.get(em)
        primary = next((d for d in docs if d.get('is_active')), docs[0])
        cur_mgr, cur_tl = primary.get('manager_id'), primary.get('tl_id')

        if want:
            want_mgr_email = norm(prev_by_id.get(want.get('manager_id'), {}).get('email')) if want.get('manager_id') else None
            want_tl_email = norm(prev_by_id.get(want.get('tl_id'), {}).get('email')) if want.get('tl_id') else None
            new_mgr = prod_id_by_email.get(want_mgr_email) if want_mgr_email else None
            new_tl = prod_id_by_email.get(want_tl_email) if want_tl_email else None
            if want_mgr_email and not new_mgr:
                unresolved.append((em, 'manager not present in production', want_mgr_email))
            if want_tl_email and not new_tl:
                unresolved.append((em, 'TL not present in production', want_tl_email))
            if (new_mgr and new_mgr != cur_mgr) or (new_tl and new_tl != cur_tl):
                link_changes.append({
                    'email': em, 'name': primary.get('name'), 'prod_id': primary['id'],
                    'role': primary.get('role'), 'is_tl': bool(primary.get('is_tl')),
                    'current_manager_id': cur_mgr, 'proposed_manager_id': new_mgr,
                    'proposed_manager': want_mgr_email,
                    'current_tl_id': cur_tl, 'proposed_tl_id': new_tl, 'proposed_tl': want_tl_email,
                    'files': file_count(primary['id']),
                })

        if len(docs) > 1:
            scored = []
            for d in docs:
                score = (1 if d.get('is_active') else 0, 1 if d.get('can_login') else 0)
                scored.append((score, d))
            scored.sort(key=lambda x: x[0], reverse=True)
            keep = scored[0][1]
            dup_rows.append({
                'email': em,
                'documents': [{'id': d['id'], 'role': d.get('role'), 'is_active': d.get('is_active'),
                               'legacy_user_id': d.get('legacy_user_id'), 'connect_id': d.get('connect_id'),
                               'same_id_as_keep': d['id'] == keep['id']} for d in docs],
                'would_keep_id': keep['id'], 'would_keep_role': keep.get('role'),
                'distinct_ids': len({d['id'] for d in docs}),
                'files': file_count(keep['id']),
            })

    report = {
        'generated_against': PROD,
        'writes_performed': 0,
        'production_user_docs': len(prod_users),
        'unique_people': len(people),
        'duplicate_people': len(dup_rows),
        'duplicate_people_with_DIFFERENT_ids': len([d for d in dup_rows if d['distinct_ids'] > 1]),
        'proposed_link_changes': len(link_changes),
        'unresolved_targets': unresolved,
        'link_changes': link_changes,
        'duplicates': dup_rows,
    }
    out = '/app/memory/C_dryrun_hierarchy_repair.json'
    with open(out, 'w') as f:
        json.dump(report, f, indent=1)

    print(f"production docs={len(prod_users)}  unique people={len(people)}")
    print(f"duplicate people={len(dup_rows)}  of which DIFFERENT ids={report['duplicate_people_with_DIFFERENT_ids']}")
    print(f"proposed link changes={len(link_changes)}  unresolved targets={len(unresolved)}")
    print(f"\nwritten: {out}\n")
    print(f"{'email':36s} | {'cur mgr':10s} -> {'new mgr':10s} | {'cur tl':10s} -> {'new tl':10s} | files")
    for c in link_changes:
        print(f"{c['email'][:36]:36s} | {str(c['current_manager_id'])[:10]:10s} -> {str(c['proposed_manager_id'])[:10]:10s} | "
              f"{str(c['current_tl_id'])[:10]:10s} -> {str(c['proposed_tl_id'])[:10]:10s} | {c['files']}")
    print('\nduplicate people with DIFFERENT ids (these are the ones that break scoping):')
    for d in dup_rows:
        if d['distinct_ids'] > 1:
            print(f"  {d['email']:34s} keep={d['would_keep_id']} ({d['would_keep_role']}) "
                  f"others={[x['id'] for x in d['documents'] if not x['same_id_as_keep']]} files={d['files']}")
    if unresolved:
        print('\nunresolved targets:', unresolved[:10])


asyncio.run(main())
