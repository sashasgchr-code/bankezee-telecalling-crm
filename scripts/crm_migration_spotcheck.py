#!/usr/bin/env python3
"""Spot-check 10 migrated files in Mongo against the OLD CRM export. Read-only."""
import asyncio, json, os, sys
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv
sys.path.insert(0, '/app/scripts')
from crm_migration_apply import EXPORT, ELIG_FIELDS, blank, norm, same
load_dotenv('/app/backend/.env')


def category(rec):
    rows = rec.get('eligibilities') or []
    if not rows:
        return None
    if len(rows) > 2:
        cats = ['multi-bank']
    else:
        cats = []
    if any(norm(r.get('disbursed')) in ('yes', 'true') for r in rows):
        cats.append('disbursed')
    if any(norm(r.get('approval_status')) == 'approved' for r in rows):
        cats.append('approved')
    if any(norm(r.get('approval_status')) == 'declined' for r in rows):
        cats.append('declined')
    if any(norm(r.get('login_done')) in ('yes', 'true') for r in rows):
        cats.append('login')
    cats.append('eligibility-only')
    return cats


async def main():
    db = AsyncIOMotorClient(os.environ['MONGO_URL'])[os.environ['DB_NAME']]
    audit = json.load(open('/app/memory/crm_migration_audit.json'))
    skip = {a[0] for a in audit['ambiguous']}
    flagged = {r[0] for r in audit['review']}
    records = [r for r in json.load(open(EXPORT))['data']
               if str(r['old_crm_id']) not in skip and str(r['old_crm_id']) not in flagged]

    wanted = ['disbursed', 'disbursed', 'approved', 'approved', 'declined', 'declined',
              'login', 'login', 'eligibility-only', 'multi-bank']
    chosen, used = [], set()
    for want in wanted:
        for rec in records:
            oid = str(rec['old_crm_id'])
            cats = category(rec)
            if oid in used or not cats or want not in cats:
                continue
            chosen.append((want, rec))
            used.add(oid)
            break

    failures = 0
    for want, rec in chosen:
        oid = str(rec['old_crm_id'])
        doc = await db.leads.find_one({'id': oid})
        print(f'\n=== [{want}] {rec["name"]} | {rec["mobile"]} | old_crm_id {oid}')
        if not doc:
            print('  FAIL: no Connect file')
            failures += 1
            continue
        c_status = doc.get('file_status') if doc.get('status') == 'file' else doc.get('status')
        print(f'  status: export={rec.get("status")!r} connect={c_status!r} '
              f'({"same" if same(rec.get("status"), c_status) else "Connect kept (documented conflict)"})')
        rows = {norm(r.get('bank_name')): r for r in (doc.get('eligibilities') or [])}
        print(f'  banks: export {len(rec.get("eligibilities") or [])} -> connect {len(rows)}')
        for exp_row in rec.get('eligibilities') or []:
            bank = norm(exp_row.get('bank_name'))
            if not bank:
                continue
            got = rows.get(bank)
            if got is None:
                print(f'  FAIL missing bank {bank}')
                failures += 1
                continue
            bad = [f for f in ELIG_FIELDS
                   if not blank(exp_row.get(f)) and not same(exp_row.get(f), got.get(f))]
            shown = {f: got.get(f) for f in ('is_eligible', 'eligible_amount', 'login_done',
                                             'application_id', 'approval_status', 'approved_amount',
                                             'declined_reason', 'disbursed', 'disbursed_amount',
                                             'commission_amount', 'login_done_at', 'approved_at',
                                             'disbursed_at', 'rejected_at') if got.get(f) not in (None, '')}
            print(f'    {exp_row.get("bank_name"):18s} {"OK " if not bad else "FAIL " + str(bad)} {shown}')
            failures += len(bad)
    print(f'\nSPOT CHECK: {"PASS" if not failures else f"FAIL ({failures})"} over {len(chosen)} files')
    return 0 if not failures else 1


sys.exit(asyncio.run(main()))
