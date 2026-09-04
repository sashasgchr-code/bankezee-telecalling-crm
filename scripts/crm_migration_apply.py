#!/usr/bin/env python3
"""OLD CRM -> Connect File migration CLI. Dry run by default; --apply writes.

All logic lives in /app/backend/utils/crm_migration.py so this CLI and the Admin-only
production endpoint run byte-identical code.
"""
import argparse, asyncio, json, os, sys
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv
sys.path.insert(0, '/app/backend')
load_dotenv('/app/backend/.env')
from utils.crm_migration import (  # noqa: E402
    ELIG_FIELDS, DETAIL_FIELDS, POLICY_CONNECT_WINS, POLICY_EXPORT_WINS, TOP_LEVEL_FIELDS,
    NEVER_IMPORT, amounts, blank, digits, dupe_banks, measure, norm, run_migration, same)

EXPORT = '/app/backend/data/crm_migration_export.json'
AUDIT = '/app/memory/crm_migration_audit.json'


def money(value):
    return f'Rs {value:,.0f}'


async def main(apply_mode, policy):
    db = AsyncIOMotorClient(os.environ['MONGO_URL'])[os.environ['DB_NAME']]
    report = await run_migration(db, apply=apply_mode, export_path=EXPORT, policy=policy)
    if report.get('aborted'):
        print('ABORTED:', report['reason'], report['backup'])
        return 1

    env, mt, plan = report['environment'], report['matching'], report['plan']
    print(f'================ OLD CRM -> CONNECT MIGRATION [{report["mode"].upper()}] ================')
    print(f'merge policy                       : {report["policy"]}')
    print(f'database                           : {report["db"]}')
    print(f'leads / files in this environment  : {env["total_leads"]} / {env["total_files"]}')
    print(f'Old CRM records                    : {env["old_crm_records"]}')
    print(f'Safely matched                     : {mt["safely_matched"]}')
    print(f'  - by own id/_id                  : {mt["by_own_id"]}')
    print(f'  - by mobile + name               : {mt["by_mobile_name"]}')
    print(f'  - by unique mobile               : {mt["by_unique_mobile"]}')
    print(f'  - by email                       : {mt["by_email"]}')
    print(f'Unmatched                          : {mt["unmatched"]}')
    print(f'Ambiguous                          : {mt["ambiguous"]}')
    key = 'updated' if apply_mode else 'would_update'
    print(f'{key:34s} : {plan[key]}')
    print(f'Already identical                  : {plan["already_identical"]}')
    print(f'Would skip                         : {plan["would_skip"]}')
    print(f'Failed                             : {plan["failed"]}')
    print(f'Eligibility rows added             : {plan["eligibility_rows_added"]}')
    print(f'Duplicate-bank files               : {plan["duplicate_bank_files"]}')
    print(f'Status conflicts (Connect kept)    : {plan["status_conflicts"]}')
    print('New Files created                  : 0')
    print('Files deleted                      : 0')
    if report.get('backup'):
        print(f'Backup                             : {report["backup"]}')

    rec = report['reconciliation']
    print('\n---- reconciliation ----')
    cols = ['export_all_454', 'connect_before', 'connect_expected_after']
    if 'connect_actual_after' in rec:
        cols.append('connect_actual_after')
    print(f'{"metric":26s}' + ''.join(f'{c:>24s}' for c in cols))
    for label, mkey, is_money in [('Files with eligibilities', 'with_elig', False),
                                  ('Eligibility rows', 'rows', False),
                                  ('Files with logins', 'with_login', False),
                                  ('Files with approvals', 'with_appr', False),
                                  ('Total approved amount', 'approved', True),
                                  ('Files with disbursals', 'with_disb', False),
                                  ('Total disbursed amount', 'disbursed', True)]:
        fmt = money if is_money else (lambda v: f'{v:,.0f}')
        print(f'{label:26s}' + ''.join(f'{fmt(rec[c][mkey]):>24s}' for c in cols))

    print('\n---- field-level changes ----')
    for field, count in sorted(report['field_changes'].items(), key=lambda kv: -kv[1]):
        print(f'  {count:5d}  {field}')

    for title, rows in [('UNMATCHED', report['unmatched']), ('AMBIGUOUS', report['ambiguous']),
                        ('DUPLICATE-BANK FILES', report['duplicate_bank_files']),
                        ('STATUS CONFLICTS', report['status_conflicts']),
                        ('FAILURES', report['failures'])]:
        if rows:
            print(f'\n---- {title} ({len(rows)}) ----')
            for row in rows:
                print('  ' + json.dumps(row, default=str))

    print('\n---- difference vs the approved Preview run ----')
    print(json.dumps(report['diff_vs_preview'], indent=1, default=str))

    path = AUDIT if apply_mode else AUDIT.replace('.json', '_dryrun.json')
    json.dump(report, open(path, 'w'), indent=1, default=str)
    print(f'\naudit log: {path}')
    if not apply_mode:
        print('DRY RUN - nothing was written.')
    return 1 if plan['failed'] else 0


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply', action='store_true', help='write to MongoDB (default: dry run)')
    parser.add_argument('--policy', default=POLICY_CONNECT_WINS,
                        choices=[POLICY_CONNECT_WINS, POLICY_EXPORT_WINS])
    args = parser.parse_args()
    sys.exit(asyncio.run(main(args.apply, args.policy)))
