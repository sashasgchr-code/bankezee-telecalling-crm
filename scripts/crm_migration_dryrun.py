#!/usr/bin/env python3
"""OLD CRM -> Connect File migration DRY RUN. Reads only; never writes.

Matches each exported old-CRM File to the existing Connect File and reports what WOULD change.
No file is created, no value is calculated, blanks in the export are never written over Connect data.
"""
import asyncio, json, os, re, sys, collections
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv
load_dotenv('/app/backend/.env')

EXPORT = '/app/memory/crm_migration_export.json'
FILE_FIELDS = ['status', 'star_rating', 'star_score', 'star_manual']
DETAIL_FIELDS = ['net_salary', 'cibil_score', 'cibil_issues', 'foir', 'company_name',
                 'company_type', 'employment_type', 'loan_amount_required', 'obligations_emi',
                 'type_of_loan', 'existing_loan_1', 'existing_loan_2', 'existing_loan_3']
ELIG_FIELDS = ['bank_name', 'is_eligible', 'eligible_amount', 'eligible_tenure',
               'not_eligible_reason', 'login_done', 'login_bank', 'login_rejection_reason',
               'approval_status', 'approved_bank', 'approved_amount', 'approved_tenure',
               'approved_roi', 'declined_bank', 'declined_reason', 'disbursed', 'disbursed_bank',
               'disbursed_amount', 'disbursed_tenure', 'disbursed_roi',
               'disbursement_rejection_reason', 'commission_percentage', 'commission_amount',
               'eligible_roi', 'application_id', 'sm_name', 'sm_number',
               'login_done_at', 'approved_at', 'rejected_at', 'disbursed_at']
TIMESTAMP_FIELDS = ['login_done_at', 'approved_at', 'rejected_at', 'disbursed_at']
EXTRA_CONNECT_ONLY = ['disbursal_date', 'rc_submitted', 'noc_submitted', 'hypothecation',
                      'pf', 'emi', 'first_emi_date']


def digits(v):
    return re.sub(r'\D', '', str(v or ''))[-10:]


def norm(v):
    return re.sub(r'\s+', ' ', str(v or '').strip()).lower()


def same(a, b):
    """Equal ignoring case/spacing and numeric formatting ("1200000" == 1200000.0)."""
    try:
        return float(str(a).replace(',', '').strip()) == float(str(b).replace(',', '').strip())
    except (ValueError, TypeError, AttributeError):
        pass
    if isinstance(a, bool) or isinstance(b, bool):
        return norm(a) == norm(b) or {norm(a), norm(b)} <= {'true', 'yes'} or {norm(a), norm(b)} <= {'false', 'no'}
    return norm(a) == norm(b)


def blank(v):
    return v is None or (isinstance(v, str) and not v.strip())


async def main():
    db = AsyncIOMotorClient(os.environ['MONGO_URL'])[os.environ['DB_NAME']]
    export = json.load(open(EXPORT))
    records = export['data']

    connect = await db.leads.find({}, {
        'id': 1, 'name': 1, 'phone': 1, 'mobile': 1, 'email': 1, 'status': 1, 'file_status': 1,
        'eligibilities': 1, 'file_details': 1, 'old_crm_id': 1, 'legacy_id': 1, 'source_id': 1,
        'star_rating': 1, 'star_score': 1, 'star_manual': 1}).to_list(200000)

    by_id, by_mobile, by_name = {}, collections.defaultdict(list), collections.defaultdict(list)
    for doc in connect:
        for key in (doc.get('id'), str(doc.get('_id')), doc.get('old_crm_id'), doc.get('legacy_id')):
            if key:
                by_id.setdefault(str(key), doc)
        phone = digits(doc.get('phone') or doc.get('mobile'))
        if len(phone) == 10:
            by_mobile[phone].append(doc)
        if norm(doc.get('name')):
            by_name[norm(doc.get('name'))].append(doc)

    counts = collections.Counter()
    unmatched, ambiguous, updates = [], [], []
    field_diffs = collections.Counter()

    for rec in records:
        old_id = str(rec.get('old_crm_id') or '')
        match, how = by_id.get(old_id), 'legacy_id'
        if not match:
            phone = digits(rec.get('mobile'))
            candidates = by_mobile.get(phone, []) if len(phone) == 10 else []
            if len(candidates) == 1:
                match, how = candidates[0], 'mobile'
            elif len(candidates) > 1:
                same_name = [c for c in candidates if norm(c.get('name')) == norm(rec.get('name'))]
                if len(same_name) == 1:
                    match, how = same_name[0], 'mobile+name'
                else:
                    ambiguous.append((old_id, rec.get('name'), rec.get('mobile'),
                                      f"{len(candidates)} Connect files share this mobile"))
                    counts['ambiguous'] += 1
                    continue
            else:
                named = by_name.get(norm(rec.get('name')), [])
                if len(named) == 1:
                    match, how = named[0], 'name'
                elif len(named) > 1:
                    ambiguous.append((old_id, rec.get('name'), rec.get('mobile'),
                                      f"{len(named)} Connect files share this name, no mobile match"))
                    counts['ambiguous'] += 1
                    continue
        if not match:
            unmatched.append((old_id, rec.get('name'), rec.get('mobile'), rec.get('status')))
            counts['unmatched'] += 1
            continue

        counts['matched'] += 1
        counts['matched_by_' + how] += 1

        # ---- what would change (export blanks never overwrite Connect values) ----
        diffs = []
        details = match.get('file_details') or {}
        connect_status = match.get('file_status') if match.get('status') == 'file' else match.get('status')
        if not blank(rec.get('status')) and not same(rec.get('status'), connect_status):
            diffs.append('file status')
            field_diffs['status'] += 1
        for f in DETAIL_FIELDS:
            old_v = rec.get(f)
            if blank(old_v):
                continue
            if not same(old_v, details.get(f)):
                diffs.append(f)
                field_diffs[f] += 1
        # Star values are recalculated by Connect with the same old-CRM formula, so they are
        # reported separately and NOT proposed as an update.
        for f in ['star_rating', 'star_score', 'star_manual']:
            if rec.get(f) not in (None, '') and not same(rec.get(f), match.get(f)):
                field_diffs['(informational) ' + f] += 1

        old_rows = rec.get('eligibilities') or []
        new_rows = match.get('eligibilities') or []
        old_by_bank = {norm(r.get('bank_name')): r for r in old_rows if r.get('bank_name')}
        new_by_bank = {norm(r.get('bank_name')): r for r in new_rows if r.get('bank_name')}
        added_banks = [b for b in old_by_bank if b not in new_by_bank]
        if added_banks:
            diffs.append(f"{len(added_banks)} bank row(s) to add")
            field_diffs['eligibility_rows_added'] += len(added_banks)
        for bank, old_row in old_by_bank.items():
            new_row = new_by_bank.get(bank)
            if not new_row:
                continue
            for f in ELIG_FIELDS:
                old_v = old_row.get(f)
                if blank(old_v):
                    continue
                if not same(old_v, new_row.get(f)):
                    diffs.append(f"{bank}.{f}")
                    field_diffs['elig.' + f] += 1
        if diffs:
            counts['would_update'] += 1
            updates.append((old_id, rec.get('name'), how, diffs[:6], len(diffs)))
        else:
            counts['already_identical'] += 1

    print("================ OLD CRM -> CONNECT MIGRATION DRY RUN ================")
    print(f"environment                        : {os.environ['DB_NAME']} "
          f"({len(connect)} lead/file documents)")
    print(f"Old CRM Files                      : {len(records)}")
    print(f"Matched exactly (total)            : {counts['matched']}")
    print(f"  - by legacy / old CRM ID         : {counts['matched_by_legacy_id']}")
    print(f"  - by mobile                      : {counts['matched_by_mobile']}")
    print(f"  - by mobile + name               : {counts['matched_by_mobile+name']}")
    print(f"  - by name only                   : {counts['matched_by_name']}")
    print(f"Unmatched                          : {counts['unmatched']}")
    print(f"Ambiguous (skipped, never guessed) : {counts['ambiguous']}")
    print(f"Already identical                  : {counts['already_identical']}")
    print(f"Would update                       : {counts['would_update']}")
    print("Would create new Files             : 0")

    print("\n---- field-level changes that WOULD be applied ----")
    for field, count in field_diffs.most_common():
        print(f"  {count:5d}  {field}")

    print("\n---- fields present in the export (would be preserved) ----")
    print("  file: " + ", ".join(['status'] + DETAIL_FIELDS + ['star_rating', 'star_score', 'star_manual']))
    print("  eligibilities[]: " + ", ".join(ELIG_FIELDS))
    print("\n---- fields NOT present in this export (cannot be restored, nothing invented) ----")
    print("  eligibility timestamps: " + ", ".join(TIMESTAMP_FIELDS))
    print("  eligibility extras    : " + ", ".join(EXTRA_CONNECT_ONLY))
    have_ts = sum(1 for r in records for e in (r.get('eligibilities') or [])
                  if any(e.get(f) for f in TIMESTAMP_FIELDS))
    print(f"  export rows carrying any timestamp: {have_ts} of {export['validation']['eligibility_rows_total']}")

    if unmatched:
        print(f"\n---- UNMATCHED ({len(unmatched)}) old_crm_id | name | mobile | status ----")
        for row in unmatched:
            print("  " + " | ".join(str(x) for x in row))
    if ambiguous:
        print(f"\n---- AMBIGUOUS ({len(ambiguous)}) old_crm_id | name | mobile | why ----")
        for row in ambiguous:
            print("  " + " | ".join(str(x) for x in row))

    print(f"\n---- sample of files that WOULD change (first 15 of {len(updates)}) ----")
    for old_id, name, how, sample, total in updates[:15]:
        print(f"  {name} [{how}] {total} change(s): {sample}")

    print("\nDRY RUN ONLY - nothing was written, no File was created.")
    return 0


sys.exit(asyncio.run(main()))
