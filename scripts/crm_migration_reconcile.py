#!/usr/bin/env python3
"""Post-migration reconciliation: OLD CRM export vs Connect BEFORE (backup) vs Connect AFTER.

Read-only. Recomputes the expected merge result for every matched file from the pre-migration
backup + the export, using the same approved rules, and asserts the DB matches it exactly.
"""
import asyncio, collections, json, os, sys
from bson import json_util
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv
sys.path.insert(0, '/app/scripts')
from crm_migration_apply import (EXPORT, ELIG_FIELDS, amounts, blank, dupe_banks, norm, same)
load_dotenv('/app/backend/.env')
BACKUP = '/app/memory/leads_backup_pre_migration.json'
AUDIT = '/app/memory/crm_migration_audit.json'


def measure(rows_per_file):
    m = collections.Counter()
    money = {'approved': 0.0, 'disbursed': 0.0}
    for rows in rows_per_file:
        rows = rows or []
        m['files'] += 1
        m['rows'] += len(rows)
        m['with_elig'] += 1 if rows else 0
        m['with_login'] += 1 if any(norm(r.get('login_done')) in ('yes', 'true') for r in rows) else 0
        a, d = amounts(rows)
        m['with_appr'] += 1 if a else 0
        m['with_disb'] += 1 if d else 0
        money['approved'] += a
        money['disbursed'] += d
    return dict(m, **money)


async def main():
    db = AsyncIOMotorClient(os.environ['MONGO_URL'])[os.environ['DB_NAME']]
    records = json.load(open(EXPORT))['data']
    audit = json.load(open(AUDIT))
    before_docs = {str(d['_id']): d for d in json_util.loads(open(BACKUP).read())}
    matched = {}          # export old_crm_id -> connect _id
    for row in audit['changes']:
        matched[row['old_crm_id']] = row['connect_id']
    ambiguous_ids = {a[0] for a in audit['ambiguous']}

    by_own = {}
    for doc in before_docs.values():
        for key in (doc.get('id'), str(doc['_id'])):
            if key:
                by_own.setdefault(str(key), doc)
    claimed = set()
    pairs = []            # (export record, before doc)
    for rec in records:
        if str(rec['old_crm_id']) in ambiguous_ids:
            continue
        doc = by_own.get(str(rec['old_crm_id']))
        if doc is None or str(doc['_id']) in claimed:
            continue
        claimed.add(str(doc['_id']))
        pairs.append((rec, doc))

    after = {str(d['_id']): d for d in await db.leads.find(
        {'_id': {'$in': [p[1]['_id'] for p in pairs]}}).to_list(200000)}

    mismatches, excl_dupe_bank = [], collections.Counter()
    excl_money = {'approved': 0.0, 'disbursed': 0.0}
    expected_rows_all, actual_rows_all, export_rows_all, before_rows_all = [], [], [], []

    for rec, before in pairs:
        exp_rows = rec.get('eligibilities') or []
        cur_rows = [dict(r) for r in (before.get('eligibilities') or [])]
        skip = dupe_banks(exp_rows) | dupe_banks(cur_rows)
        index = {norm(r.get('bank_name')): i for i, r in enumerate(cur_rows) if r.get('bank_name')}
        for exp_row in exp_rows:
            bank = norm(exp_row.get('bank_name'))
            if not bank:
                continue
            if bank in skip:
                excl_dupe_bank['rows'] += 1
                a, d = amounts([exp_row])
                excl_money['approved'] += a
                excl_money['disbursed'] += d
                continue
            if bank in index:
                target = cur_rows[index[bank]]
                for f in ELIG_FIELDS:
                    if not blank(exp_row.get(f)):
                        if not same(exp_row.get(f), target.get(f)):
                            target[f] = exp_row.get(f)
            else:
                cur_rows.append({f: exp_row.get(f) for f in ELIG_FIELDS
                                 if f in exp_row and not blank(exp_row.get(f))})
                index[bank] = len(cur_rows) - 1

        actual = (after[str(before['_id'])].get('eligibilities') or [])
        if len(actual) != len(cur_rows):
            mismatches.append((rec['old_crm_id'], rec.get('name'),
                               f'row count expected {len(cur_rows)} got {len(actual)}'))
        else:
            for want, got in zip(cur_rows, actual):
                for f in set(want) | set(got):
                    if not same(want.get(f), got.get(f)):
                        mismatches.append((rec['old_crm_id'], rec.get('name'),
                                           f"{want.get('bank_name')}.{f}: expected "
                                           f"{want.get(f)!r} got {got.get(f)!r}"))
        expected_rows_all.append(cur_rows)
        actual_rows_all.append(actual)
        export_rows_all.append(exp_rows)
        before_rows_all.append(before.get('eligibilities') or [])

    exp_all = measure([r.get('eligibilities') for r in records])
    exp_matched = measure(export_rows_all)
    m_before = measure(before_rows_all)
    m_expected = measure(expected_rows_all)
    m_after = measure(actual_rows_all)

    def line(label, key, money=False):
        fmt = (lambda v: f'{v:,.0f}') if not money else (lambda v: f'Rs {v:,.0f}')
        e, b, x, a = exp_all[key], m_before[key], m_expected[key], m_after[key]
        flag = 'YES' if abs(x - a) < 1 else 'NO'
        print(f'{label:26s} {fmt(e):>16s} {fmt(b):>16s} {fmt(x):>16s} {fmt(a):>16s}   {flag}')

    print('================ POST-MIGRATION RECONCILIATION ================')
    print(f'{"metric":26s} {"OLD CRM export":>16s} {"Connect BEFORE":>16s} '
          f'{"EXPECTED after":>16s} {"Connect AFTER":>16s}   match')
    for label, key, money in [('Files', 'files', False),
                              ('Files with eligibilities', 'with_elig', False),
                              ('Eligibility rows', 'rows', False),
                              ('Files with logins', 'with_login', False),
                              ('Files with approvals', 'with_appr', False),
                              ('Total approved amount', 'approved', True),
                              ('Files with disbursals', 'with_disb', False),
                              ('Total disbursed amount', 'disbursed', True)]:
        line(label, key, money)

    print('\n---- intentional exclusions (never written) ----')
    excl_records = [r for r in records if str(r['old_crm_id']) in ambiguous_ids]
    e8 = measure([r.get('eligibilities') for r in excl_records])
    print(f'8 ambiguous duplicate old-CRM records: files 8 | rows {e8["rows"]} | '
          f'approvals {e8["with_appr"]} | approved Rs {e8["approved"]:,.0f} | '
          f'disbursals {e8["with_disb"]} | disbursed Rs {e8["disbursed"]:,.0f}')
    print(f'duplicate-bank rows on flagged files  : rows {excl_dupe_bank["rows"]} | '
          f'approved Rs {excl_money["approved"]:,.0f} | disbursed Rs {excl_money["disbursed"]:,.0f}')

    print('\n---- export coverage of the 446 migrated files ----')
    print(f'export rows for those files {exp_matched["rows"]} | '
          f'excluded duplicate-bank rows {excl_dupe_bank["rows"]} | '
          f'rows present in Connect after {m_after["rows"]} '
          f'(Connect also keeps {m_before["rows"]} pre-existing rows, merged by bank)')

    print(f'\nper-field mismatches vs expected merge: {len(mismatches)}')
    for row in mismatches[:30]:
        print('  ' + ' | '.join(str(x) for x in row))
    verdict = 'PASS WITH DOCUMENTED EXCLUSIONS' if not mismatches else 'FAIL'
    print(f'\nRECONCILIATION: {verdict}')
    return 0 if not mismatches else 1


sys.exit(asyncio.run(main()))
