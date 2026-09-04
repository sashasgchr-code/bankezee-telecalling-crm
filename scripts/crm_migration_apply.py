#!/usr/bin/env python3
"""OLD CRM -> Connect File migration.

Default mode is DRY RUN (read-only). Pass --apply to write.

Rules (approved by the user):
  * in-place $set on existing matched leads only; 0 new files, 0 deletes
  * match order: old CRM id / legacy id -> mobile+name -> mobile -> email  (never name-only)
  * ambiguous / unmatched are skipped and listed, never guessed
  * export blanks never overwrite non-blank Connect values
  * file status is BACKFILL ONLY (never downgrades a populated Connect status; conflicts flagged)
  * eligibilities merged by bank name; duplicate bank names on either side are left untouched and
    the file is flagged for review
  * star_rating / star_score / star_manual are never imported
  * historical timestamps imported exactly as stored; no new timestamps, no commission recompute,
    no wallet/commission side effects
  * safe to re-run: identical values produce no write
"""
import argparse, asyncio, collections, json, os, re, sys
from datetime import datetime, timezone
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv
load_dotenv('/app/backend/.env')

EXPORT = '/app/memory/crm_migration_export.json'
AUDIT = '/app/memory/crm_migration_audit.json'
TOP_LEVEL_FIELDS = ['employment_type']
DETAIL_FIELDS = ['net_salary', 'cibil_score', 'cibil_issues', 'foir', 'company_name',
                 'company_type', 'loan_amount_required', 'obligations_emi', 'type_of_loan',
                 'existing_loan_1', 'existing_loan_2', 'existing_loan_3']
ELIG_FIELDS = ['bank_name', 'is_eligible', 'eligible_amount', 'eligible_tenure', 'eligible_roi',
               'not_eligible_reason', 'login_done', 'login_bank', 'application_id',
               'login_rejection_reason', 'approval_status', 'approved_bank', 'approved_amount',
               'approved_tenure', 'approved_roi', 'declined_bank', 'declined_reason', 'disbursed',
               'disbursed_bank', 'disbursed_amount', 'disbursed_tenure', 'disbursed_roi',
               'disbursement_rejection_reason', 'commission_percentage', 'commission_amount',
               'sm_name', 'sm_number', 'login_done_at', 'approved_at', 'rejected_at',
               'disbursed_at']
NEVER_IMPORT = ('star_rating', 'star_score', 'star_manual')


def digits(v):
    return re.sub(r'\D', '', str(v or ''))[-10:]


def norm(v):
    return re.sub(r'\s+', ' ', str(v or '').strip()).lower()


def blank(v):
    return v is None or (isinstance(v, str) and not v.strip())


def same(a, b):
    """Equal ignoring case/spacing, numeric formatting and yes/true equivalence."""
    if blank(a) and blank(b):
        return True
    try:
        return float(str(a).replace(',', '').strip()) == float(str(b).replace(',', '').strip())
    except (ValueError, TypeError, AttributeError):
        pass
    if isinstance(a, bool) or isinstance(b, bool):
        return (norm(a) == norm(b) or {norm(a), norm(b)} <= {'true', 'yes'}
                or {norm(a), norm(b)} <= {'false', 'no'})
    return norm(a) == norm(b)


def amounts(rows):
    """(approved, disbursed) for one file - one approval and one disbursal per file."""
    approved = disbursed = 0.0
    for row in rows or []:
        if norm(row.get('approval_status')) == 'approved' and not blank(row.get('approved_amount')):
            approved = max(approved, float(row['approved_amount']))
        if norm(row.get('disbursed')) in ('yes', 'true') and not blank(row.get('disbursed_amount')):
            disbursed = max(disbursed, float(row['disbursed_amount']))
    return approved, disbursed


def dupe_banks(rows):
    counter = collections.Counter(norm(r.get('bank_name')) for r in rows or [] if r.get('bank_name'))
    return {bank for bank, n in counter.items() if n > 1}


async def main(apply_mode):
    db = AsyncIOMotorClient(os.environ['MONGO_URL'])[os.environ['DB_NAME']]
    records = json.load(open(EXPORT))['data']

    connect = await db.leads.find({}, {
        'id': 1, 'name': 1, 'phone': 1, 'mobile': 1, 'email': 1, 'status': 1, 'file_status': 1,
        'eligibilities': 1, 'file_details': 1, 'employment_type': 1, 'old_crm_id': 1,
        'legacy_id': 1, 'legacy_crm_id': 1}).to_list(200000)

    by_own_id, by_mobile, by_email = {}, collections.defaultdict(list), collections.defaultdict(list)
    for doc in connect:
        for key in (doc.get('id'), str(doc.get('_id'))):
            if key:
                by_own_id.setdefault(str(key), doc)
        phone = digits(doc.get('phone') or doc.get('mobile'))
        if len(phone) == 10:
            by_mobile[phone].append(doc)
        if norm(doc.get('email')):
            by_email[norm(doc.get('email'))].append(doc)

    counts = collections.Counter()
    unmatched, ambiguous, review, conflicts, audit = [], [], [], [], []
    field_changes = collections.Counter()
    export_totals = {'approved': 0.0, 'disbursed': 0.0, 'with_elig': 0, 'with_appr': 0, 'with_disb': 0}

    # ---- PASS 1: own identifier only. legacy_crm_id is NOT used as a match key: 73 Connect docs
    # carry a legacy_crm_id belonging to a DIFFERENT export record, so it would write to the
    # wrong file. ----
    matches, claimed = {}, {}
    for i, rec in enumerate(records):
        doc = by_own_id.get(str(rec.get('old_crm_id') or ''))
        if doc is not None:
            matches[i] = (doc, 'old CRM id')
            claimed[str(doc['_id'])] = i

    # ---- PASS 2: mobile+name -> mobile -> email, for records with no id match ----
    for i, rec in enumerate(records):
        if i in matches:
            continue
        phone = digits(rec.get('mobile'))
        cands = by_mobile.get(phone, []) if len(phone) == 10 else []
        named = [c for c in cands if norm(c.get('name')) == norm(rec.get('name'))]
        pool, how = (named, 'mobile+name') if named else (cands, 'mobile')
        if not pool:
            pool, how = by_email.get(norm(rec.get('email')), []), 'email'
        free = [c for c in pool if str(c['_id']) not in claimed]
        if len(pool) > 1 and len(free) != 1:
            ambiguous.append((rec.get('old_crm_id'), rec.get('name'), rec.get('mobile'),
                              f'{len(pool)} Connect files match on {how} - skipped, never guessed'))
        elif not pool:
            unmatched.append((rec.get('old_crm_id'), rec.get('name'), rec.get('mobile'),
                              rec.get('status')))
        elif not free:
            other = records[claimed[str(pool[0]['_id'])]]
            ambiguous.append((rec.get('old_crm_id'), rec.get('name'), rec.get('mobile'),
                              'DUPLICATE OLD-CRM RECORD: the only Connect file that matches '
                              f'({pool[0].get("name")}) is already matched by export record '
                              f'{other.get("old_crm_id")} - skipped so two separate old-CRM '
                              'attempts are not collapsed into one file'))
        else:
            matches[i] = (free[0], how)
            claimed[str(free[0]['_id'])] = i
    counts['unmatched'] = len(unmatched)
    counts['ambiguous'] = len(ambiguous)

    for i, rec in enumerate(records):
        old_id = str(rec.get('old_crm_id') or '')
        rec_rows = rec.get('eligibilities') or []
        e_appr, e_disb = amounts(rec_rows)
        export_totals['approved'] += e_appr
        export_totals['disbursed'] += e_disb
        export_totals['with_elig'] += 1 if rec_rows else 0
        export_totals['with_appr'] += 1 if e_appr else 0
        export_totals['with_disb'] += 1 if e_disb else 0
        if i not in matches:
            continue
        match, how = matches[i]

        counts['processed'] += 1
        counts['matched_by_' + how] += 1

        set_doc, before, after = {}, {}, {}
        details = dict(match.get('file_details') or {})

        # ---- status: BACKFILL ONLY ----
        is_file = match.get('status') == 'file'
        status_field = 'file_status' if is_file else 'status'
        connect_status = match.get(status_field)
        if not blank(rec.get('status')):
            if blank(connect_status):
                set_doc[status_field] = rec['status']
                before[status_field], after[status_field] = connect_status, rec['status']
                field_changes['status (backfilled)'] += 1
            elif not same(rec['status'], connect_status):
                conflicts.append((old_id, rec.get('name'), f"export status '{rec['status']}' vs "
                                                           f"Connect '{connect_status}' - kept Connect"))
                field_changes['status conflict (kept Connect)'] += 1

        # ---- top level + file_details ----
        for f in TOP_LEVEL_FIELDS:
            old_v = rec.get(f)
            if blank(old_v):
                continue
            cur = match.get(f) or details.get(f)
            if not same(old_v, cur):
                set_doc[f] = old_v
                before[f], after[f] = cur, old_v
                field_changes[f] += 1
        for f in DETAIL_FIELDS:
            old_v = rec.get(f)
            if blank(old_v) or same(old_v, details.get(f)):
                continue
            details[f] = old_v
            before['file_details.' + f], after['file_details.' + f] = (match.get('file_details') or {}).get(f), old_v
            field_changes[f] += 1
        if any(k.startswith('file_details.') for k in before):
            set_doc['file_details'] = details

        # ---- eligibilities merged by bank name ----
        cur_rows = [dict(r) for r in (match.get('eligibilities') or [])]
        exp_dupes = dupe_banks(rec_rows)
        cur_dupes = dupe_banks(cur_rows)
        skip_banks = exp_dupes | cur_dupes
        if skip_banks:
            review.append((old_id, rec.get('name'),
                           'duplicate bank name(s) left untouched: ' + ', '.join(sorted(skip_banks))))
        cur_index = {norm(r.get('bank_name')): i for i, r in enumerate(cur_rows) if r.get('bank_name')}
        rows_changed, rows_added = False, 0
        for exp_row in rec_rows:
            bank = norm(exp_row.get('bank_name'))
            if not bank or bank in skip_banks:
                continue
            if bank in cur_index:
                target = cur_rows[cur_index[bank]]
                for f in ELIG_FIELDS:
                    old_v = exp_row.get(f)
                    if blank(old_v) or same(old_v, target.get(f)):
                        continue
                    before[f'elig[{bank}].{f}'], after[f'elig[{bank}].{f}'] = target.get(f), old_v
                    target[f] = old_v
                    rows_changed = True
                    field_changes['elig.' + f] += 1
            else:
                new_row = {f: exp_row.get(f) for f in ELIG_FIELDS
                           if f in exp_row and not blank(exp_row.get(f))}
                if not new_row.get('bank_name'):
                    continue
                cur_rows.append(new_row)
                cur_index[bank] = len(cur_rows) - 1
                rows_added += 1
                rows_changed = True
                after[f'elig[{bank}]'] = 'ROW ADDED'
        if rows_added:
            field_changes['eligibility_rows_added'] += rows_added
        if rows_changed:
            set_doc['eligibilities'] = cur_rows

        for f in NEVER_IMPORT:
            assert f not in set_doc, f
        assert '_id' not in set_doc and 'id' not in set_doc

        if not set_doc:
            counts['already_identical'] += 1
            continue

        counts['to_update'] += 1
        audit.append({'old_crm_id': old_id, 'connect_id': str(match.get('_id')),
                      'name': rec.get('name'), 'matched_by': how,
                      'before': json.loads(json.dumps(before, default=str)),
                      'after': json.loads(json.dumps(after, default=str))})

        if apply_mode:
            try:
                res = await db.leads.update_one({'_id': match['_id']}, {'$set': set_doc})
                if res.matched_count != 1:
                    raise RuntimeError(f'matched_count={res.matched_count}')
                counts['updated'] += 1
                counts['modified'] += res.modified_count
            except Exception as exc:  # noqa: BLE001
                counts['failed'] += 1
                review.append((old_id, rec.get('name'), f'WRITE FAILED: {exc}'))

    # ---- Connect state AFTER (matched files only) ----
    matched_ids = [a['connect_id'] for a in audit]
    connect_after = {'approved': 0.0, 'disbursed': 0.0, 'with_elig': 0, 'with_appr': 0, 'with_disb': 0}
    fresh = await db.leads.find({}, {'id': 1, 'eligibilities': 1}).to_list(200000)
    export_ids = {str(r.get('old_crm_id')) for r in records}
    for doc in fresh:
        if str(doc.get('id')) not in export_ids and str(doc.get('_id')) not in matched_ids:
            continue
        rows = doc.get('eligibilities') or []
        a, d = amounts(rows)
        connect_after['approved'] += a
        connect_after['disbursed'] += d
        connect_after['with_elig'] += 1 if rows else 0
        connect_after['with_appr'] += 1 if a else 0
        connect_after['with_disb'] += 1 if d else 0

    mode = 'APPLY' if apply_mode else 'DRY RUN'
    print(f'================ OLD CRM -> CONNECT MIGRATION [{mode}] ================')
    print(f'environment                        : {os.environ["DB_NAME"]} ({len(connect)} lead docs)')
    print(f'Files processed                    : {counts["processed"]} of {len(records)}')
    print(f'  - matched by old CRM id          : {counts["matched_by_old CRM id"]}')
    print(f'  - matched by mobile + name       : {counts["matched_by_mobile+name"]}')
    print(f'  - matched by mobile              : {counts["matched_by_mobile"]}')
    print(f'  - matched by email               : {counts["matched_by_email"]}')
    print(f'Files {"updated" if apply_mode else "to update"}                      : '
          f'{counts["updated"] if apply_mode else counts["to_update"]}')
    print(f'Files failed                       : {counts["failed"]}')
    print(f'Files skipped (unmatched)          : {counts["unmatched"]}')
    print(f'Files skipped (ambiguous)          : {counts["ambiguous"]}')
    print(f'Files already identical            : {counts["already_identical"]}')
    print('New Files created                  : 0')
    print('Files deleted                      : 0')
    print(f'Files flagged for review           : {len(review)}')
    print(f'Status conflicts (Connect kept)    : {field_changes["status conflict (kept Connect)"]}')

    print('\n---- OLD CRM export vs CONNECT after ----')
    print(f'{"metric":28s} {"OLD CRM export":>18s} {"CONNECT now":>18s}  match')
    for label, key, money in [('Files with eligibilities', 'with_elig', False),
                              ('Files with approvals', 'with_appr', False),
                              ('Files with disbursals', 'with_disb', False),
                              ('Total approved amount', 'approved', True),
                              ('Total disbursed amount', 'disbursed', True)]:
        e, c = export_totals[key], connect_after[key]
        fmt = (lambda v: f'Rs {v:,.0f}') if money else (lambda v: f'{v:,.0f}')
        print(f'{label:28s} {fmt(e):>18s} {fmt(c):>18s}  {"YES" if abs(e - c) < 1 else "NO"}')

    print('\n---- field-level changes ----')
    for field, count in field_changes.most_common():
        print(f'  {count:5d}  {field}')

    if unmatched:
        print(f'\n---- UNMATCHED ({len(unmatched)}) ----')
        for row in unmatched:
            print('  ' + ' | '.join(str(x) for x in row))
    if ambiguous:
        print(f'\n---- AMBIGUOUS, skipped ({len(ambiguous)}) ----')
        for row in ambiguous:
            print('  ' + ' | '.join(str(x) for x in row))
    if review:
        print(f'\n---- FLAGGED FOR REVIEW ({len(review)}) ----')
        for row in review[:40]:
            print('  ' + ' | '.join(str(x) for x in row))
    if conflicts:
        print(f'\n---- STATUS CONFLICTS ({len(conflicts)}) ----')
        for row in conflicts:
            print('  ' + ' | '.join(str(x) for x in row))

    payload = {'mode': mode, 'run_at': datetime.now(timezone.utc).isoformat(),
               'db': os.environ['DB_NAME'], 'counts': dict(counts),
               'field_changes': dict(field_changes), 'export_totals': export_totals,
               'connect_after': connect_after, 'unmatched': unmatched, 'ambiguous': ambiguous,
               'review': review, 'status_conflicts': conflicts, 'changes': audit}
    path = AUDIT if apply_mode else AUDIT.replace('.json', '_dryrun.json')
    json.dump(payload, open(path, 'w'), indent=1, default=str)
    print(f'\naudit log: {path}')
    if not apply_mode:
        print('DRY RUN - nothing was written.')
    return 1 if counts['failed'] else 0


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply', action='store_true', help='write to MongoDB (default: dry run)')
    sys.exit(asyncio.run(main(parser.parse_args().apply)))
