"""OLD CRM -> Connect File migration core. Shared by the CLI script and the temporary
Admin-only migration endpoint, so preview and production run byte-identical logic.

Rules (approved): in-place $set on existing matched leads only, 0 new files, 0 deletes;
match on the file's OWN id/_id, then exact mobile+name, then unique mobile, then email
(never name-only, legacy_crm_id is NEVER a match key); export blanks never overwrite Connect
values; file status is backfill-only (newer Connect status wins, conflicts reported); rows merged
by bank name and duplicate bank names are left untouched; star fields never imported; historical
timestamps copied as-is with no new timestamps and no commission/wallet recalculation;
file_activities untouched; re-running is a no-op.
"""
import collections
import json
import os
import re
from datetime import datetime, timezone

EXPORT_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                           'data', 'crm_migration_export.json')
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

# Merge policies
POLICY_EXPORT_WINS = 'export_wins'      # used on preview: any non-blank export value wins
POLICY_CONNECT_WINS = 'connect_wins'    # production: Connect non-blank wins, export fills blanks
                                        # only, except a missing later operational milestone
ELIG_GROUPS = {
    'eligibility': ('is_eligible', ['is_eligible', 'eligible_amount', 'eligible_tenure',
                                    'eligible_roi', 'not_eligible_reason']),
    'login': ('login_done', ['login_done', 'login_bank', 'application_id',
                             'login_rejection_reason', 'login_done_at', 'sm_name', 'sm_number']),
    'approval': ('approval_status', ['approval_status', 'approved_bank', 'approved_amount',
                                     'approved_tenure', 'approved_roi', 'declined_bank',
                                     'declined_reason', 'approved_at', 'rejected_at']),
    'disbursal': ('disbursed', ['disbursed', 'disbursed_bank', 'disbursed_amount',
                                'disbursed_tenure', 'disbursed_roi',
                                'disbursement_rejection_reason', 'commission_percentage',
                                'commission_amount', 'disbursed_at']),
}
# Only these later milestones may be restored over a stale Connect value.
MILESTONE_GROUPS = ('login', 'approval', 'disbursal')
GROUP_OF_FIELD = {f: g for g, (_, fields) in ELIG_GROUPS.items() for f in fields}


def reached(field, value):
    """Has this milestone gate been reached?"""
    if blank(value):
        return False
    if field == 'approval_status':
        return norm(value) in ('approved', 'declined')
    return norm(value) in ('yes', 'true')


# Preview run of 2026-09-04 (446 matched / 8 ambiguous), used to diff production against.
PREVIEW_BASELINE = {
    'processed': 446, 'updated': 146, 'already_identical': 300, 'ambiguous': 8, 'unmatched': 0,
    'rows_added': 224, 'status_conflicts': 11, 'duplicate_bank_files': 7,
    'ambiguous_ids': [
        '65d46f59-c538-4c5d-aaf4-086829005563', 'f3159fa6-6f78-43eb-ab97-f3638e8c636c',
        'e92178e7-7887-423b-a508-cce3392c432c', '47b5eea6-3b31-4403-9d33-345d9b760598',
        'cda68b80-eae7-4f08-8656-d01cc1fb77a5', 'a7e87aaa-f917-4d3d-a01d-f94b35a68954',
        '257c0003-4c99-42e1-bbd5-9738ecdf3599', 'f1b9a149-3d5c-4adf-af46-98789ba4c6aa'],
    'duplicate_bank_ids': [
        'ab6fefbd-5547-43b8-aabd-9112d252a58d', '8a4f96a5-ec58-456e-95c5-3979dfe73562',
        '4f6e7648-ec24-447f-a704-098ccccdd046', 'f06424d3-37f9-4f2c-9c8a-763841f2adaa',
        '795bc1ec-67e9-4eaf-9326-7c92f1a2e09a', 'dcc2e45e-3e0a-406a-98d9-bb88dd2a61f9',
        '54b8ebfe-74fa-4b10-b266-9904193364c2'],
    'status_conflict_ids': [
        'dcd5a636-4895-4278-a237-5d46d6787dbd', '7417abac-08ee-4318-bd7c-cc46aa4831b3',
        '11810738-5f1a-4e97-86f6-ec880e321621', '4f6e7648-ec24-447f-a704-098ccccdd046',
        '05bb37a6-351d-42d3-873d-a7e7cda6020c', 'fec6d91a-986f-4252-a073-20729abddc7c',
        '70bc728b-4afa-41d9-ab65-c4708d06c52f', '3780343a-3321-404c-95d5-d0c7cc2a7101',
        '209897c0-d11e-4fa7-a1fd-38b7f3e52fba', '7217c29e-9f4c-47ce-8e73-2f73203a57f6',
        '0d8133f3-2f35-40ae-8d08-71c0766b3170'],
}


def digits(value):
    return re.sub(r'\D', '', str(value or ''))[-10:]


def norm(value):
    return re.sub(r'\s+', ' ', str(value or '').strip()).lower()


def blank(value):
    return value is None or (isinstance(value, str) and not value.strip())


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


def measure(rows_per_file):
    metrics = collections.Counter()
    money = {'approved': 0.0, 'disbursed': 0.0}
    for rows in rows_per_file:
        rows = rows or []
        metrics['files'] += 1
        metrics['rows'] += len(rows)
        metrics['with_elig'] += 1 if rows else 0
        if any(norm(r.get('login_done')) in ('yes', 'true') for r in rows):
            metrics['with_login'] += 1
        approved, disbursed = amounts(rows)
        metrics['with_appr'] += 1 if approved else 0
        metrics['with_disb'] += 1 if disbursed else 0
        money['approved'] += approved
        money['disbursed'] += disbursed
    return dict(metrics, **money)


def load_export(path=None):
    return json.load(open(path or EXPORT_PATH))['data']


def resolve_matches(records, connect):
    """Two-pass matcher. Returns (matches, unmatched, ambiguous).

    Pass 1 uses the file's OWN id/_id only. legacy_crm_id is deliberately not a match key: Connect
    files can carry a legacy_crm_id belonging to a DIFFERENT export record.
    Pass 2 uses exact mobile+name, then a unique mobile, then email; a candidate already claimed by
    another export record makes the record ambiguous (two old-CRM attempts are never collapsed).
    """
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

    matches, claimed, unmatched, ambiguous = {}, {}, [], []
    for i, rec in enumerate(records):
        doc = by_own_id.get(str(rec.get('old_crm_id') or ''))
        if doc is not None and str(doc['_id']) not in claimed:
            matches[i] = (doc, 'own_id')
            claimed[str(doc['_id'])] = i

    for i, rec in enumerate(records):
        if i in matches:
            continue
        phone = digits(rec.get('mobile'))
        cands = by_mobile.get(phone, []) if len(phone) == 10 else []
        named = [c for c in cands if norm(c.get('name')) == norm(rec.get('name'))]
        pool, how = (named, 'mobile_name') if named else (cands, 'mobile')
        if not pool:
            pool, how = by_email.get(norm(rec.get('email')), []), 'email'
        free = [c for c in pool if str(c['_id']) not in claimed]
        if not pool:
            unmatched.append({'old_crm_id': rec.get('old_crm_id'), 'name': rec.get('name'),
                              'mobile': rec.get('mobile'), 'status': rec.get('status'),
                              'reason': 'no Connect file matches id, mobile+name, mobile or email'})
        elif len(pool) > 1 and len(free) != 1:
            ambiguous.append({'old_crm_id': rec.get('old_crm_id'), 'name': rec.get('name'),
                              'mobile': rec.get('mobile'),
                              'reason': f'{len(pool)} Connect files match on {how} - skipped, never guessed',
                              'kind': 'multiple_connect_files'})
        elif not free:
            other = records[claimed[str(pool[0]['_id'])]]
            ambiguous.append({'old_crm_id': rec.get('old_crm_id'), 'name': rec.get('name'),
                              'mobile': rec.get('mobile'),
                              'connect_file': str(pool[0]['_id']),
                              'already_matched_by': other.get('old_crm_id'),
                              'reason': 'DUPLICATE OLD-CRM RECORD: the only matching Connect file is '
                                        'already matched by another export record - skipped so two '
                                        'separate old-CRM attempts are not collapsed into one file',
                              'kind': 'duplicate_old_crm_record'})
        else:
            matches[i] = (free[0], how)
            claimed[str(free[0]['_id'])] = i
    return matches, unmatched, ambiguous


def plan_file(rec, match, policy=POLICY_EXPORT_WINS):
    """Return (set_doc, before, after, field_changes, review, conflict, overwrites, skipped).

    policy=export_wins   : any non-blank export value overwrites (preview behaviour)
    policy=connect_wins  : a non-blank Connect value is preserved; the export only fills blanks,
                           except that a MISSING later operational milestone (login / approval /
                           disbursal) is restored, together with the gates it implies. Every
                           preserved conflict is reported instead of being written.
    """
    set_doc, before, after = {}, {}, {}
    field_changes = collections.Counter()
    review = conflict = None
    overwrites, skipped = [], []
    connect_wins = policy == POLICY_CONNECT_WINS
    details = dict(match.get('file_details') or {})

    is_file = match.get('status') == 'file'
    status_field = 'file_status' if is_file else 'status'
    connect_status = match.get(status_field)
    if not blank(rec.get('status')):
        if blank(connect_status):
            set_doc[status_field] = rec['status']
            before[status_field], after[status_field] = connect_status, rec['status']
            field_changes['status (backfilled)'] += 1
        elif not same(rec['status'], connect_status):
            conflict = {'old_crm_id': rec.get('old_crm_id'), 'name': rec.get('name'),
                        'export_status': rec['status'], 'connect_status': connect_status,
                        'action': 'kept Connect status'}

    def note_skip(field, connect_value, export_value, reason):
        skipped.append({'field': field, 'connect_value': connect_value,
                        'export_value': export_value, 'reason': reason})
        field_changes[f'preserved Connect value ({field.split(".")[0]})'] += 1

    for field in TOP_LEVEL_FIELDS:
        value = rec.get(field)
        if blank(value):
            continue
        current = match.get(field) or details.get(field)
        if same(value, current):
            continue
        if connect_wins and not blank(current):
            note_skip(field, current, value, 'Connect value preserved (profile field)')
            continue
        set_doc[field] = value
        before[field], after[field] = current, value
        if not blank(current):
            overwrites.append({'field': field, 'connect_value': current, 'export_value': value})
        field_changes[field] += 1
    for field in DETAIL_FIELDS:
        value = rec.get(field)
        current = details.get(field)
        if blank(value) or same(value, current):
            continue
        if connect_wins and not blank(current):
            note_skip('file_details.' + field, current, value,
                      'Connect value preserved (profile field)')
            continue
        details[field] = value
        before['file_details.' + field] = current
        after['file_details.' + field] = value
        if not blank(current):
            overwrites.append({'field': 'file_details.' + field,
                               'connect_value': current, 'export_value': value})
        field_changes[field] += 1
    if any(k.startswith('file_details.') for k in before):
        set_doc['file_details'] = details

    exp_rows = rec.get('eligibilities') or []
    cur_rows = [dict(r) for r in (match.get('eligibilities') or [])]
    skip_banks = dupe_banks(exp_rows) | dupe_banks(cur_rows)
    if skip_banks:
        review = {'old_crm_id': rec.get('old_crm_id'), 'name': rec.get('name'),
                  'duplicate_banks': sorted(skip_banks),
                  'action': 'rows left untouched, never collapsed'}
    index = {norm(r.get('bank_name')): i for i, r in enumerate(cur_rows) if r.get('bank_name')}
    rows_changed = False
    rows_added = 0
    for exp_row in exp_rows:
        bank = norm(exp_row.get('bank_name'))
        if not bank or bank in skip_banks:
            continue
        if bank not in index:
            new_row = {f: exp_row.get(f) for f in ELIG_FIELDS
                       if f in exp_row and not blank(exp_row.get(f))}
            if not new_row.get('bank_name'):
                continue
            cur_rows.append(new_row)
            index[bank] = len(cur_rows) - 1
            rows_added += 1
            rows_changed = True
            after[f'elig[{bank}]'] = 'ROW ADDED'
            continue

        target = cur_rows[index[bank]]
        # which milestones does the export hold that Connect is missing?
        advanced = set()
        if connect_wins:
            for group in MILESTONE_GROUPS:
                gate, _ = ELIG_GROUPS[group]
                if reached(gate, exp_row.get(gate)) and not reached(gate, target.get(gate)):
                    advanced.add(group)
            if advanced:
                # a later milestone implies the earlier gates; only ever upgraded, never downgraded
                for gate in ('is_eligible', 'login_done'):
                    if not reached(gate, target.get(gate)):
                        gate_value = exp_row.get(gate) if reached(gate, exp_row.get(gate)) else 'yes'
                        before[f'elig[{bank}].{gate}'] = target.get(gate)
                        after[f'elig[{bank}].{gate}'] = gate_value
                        target[gate] = gate_value
                        rows_changed = True
                        field_changes[f'elig.{gate} (implied by restored milestone)'] += 1
        for field in ELIG_FIELDS:
            value = exp_row.get(field)
            current = target.get(field)
            if blank(value) or same(value, current):
                continue
            group = GROUP_OF_FIELD.get(field)
            allowed = (not connect_wins) or blank(current) or (group in advanced)
            if not allowed:
                note_skip(f'elig[{bank}].{field}', current, value,
                          'Connect value preserved (no missing milestone in this group)')
                continue
            before[f'elig[{bank}].{field}'] = current
            after[f'elig[{bank}].{field}'] = value
            if not blank(current):
                overwrites.append({'field': f'elig[{bank}].{field}', 'connect_value': current,
                                   'export_value': value,
                                   'restored_milestone': group if group in advanced else None})
            target[field] = value
            rows_changed = True
            field_changes['elig.' + field] += 1
    if rows_added:
        field_changes['eligibility_rows_added'] += rows_added
    if rows_changed:
        set_doc['eligibilities'] = cur_rows

    for field in NEVER_IMPORT:
        set_doc.pop(field, None)
    set_doc.pop('_id', None)
    set_doc.pop('id', None)
    return set_doc, before, after, field_changes, review, conflict, overwrites, skipped


PREVIEW_CHANGED_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                                    'data', 'crm_migration_preview_baseline.json')


def preview_changed_files():
    try:
        return json.load(open(PREVIEW_CHANGED_PATH))['changed']
    except (OSError, KeyError, ValueError):
        return {}


def classify_differences(records, matches, changes, unmatched, ambiguous, review, conflicts):
    """Per-record production-only differences vs the approved Preview run.

    SAFE DIFFERENCE  - expected: production holds newer/current data and it is preserved
    REVIEW REQUIRED  - cannot be decided automatically; nothing is written for it
    UNSAFE           - would overwrite/collapse/misassign data (must be empty by construction)
    """
    preview = preview_changed_files()
    by_id = {str(r.get('old_crm_id')): r for r in records}
    matched_ids = {str(records[i].get('old_crm_id')): matches[i] for i in matches}
    changed_here = {c['old_crm_id']: c for c in changes}
    out = []

    def entry(old_id, difference, reason, action, classification, extra=None):
        rec = by_id.get(str(old_id)) or {}
        doc = matched_ids.get(str(old_id), (None, None))[0]
        row = {'customer': (rec.get('name') or '').strip(), 'old_crm_id': old_id,
               'connect_file_id': str(doc['_id']) if doc is not None else None,
               'mobile': rec.get('mobile'), 'difference': difference, 'reason': reason,
               'proposed_migration_action': action, 'classification': classification}
        row.update(extra or {})
        out.append(row)

    for row in unmatched:
        entry(row['old_crm_id'], 'no Connect file found in production',
              row['reason'], 'skip - nothing written', 'REVIEW REQUIRED',
              {'preview_result': 'matched in preview' if str(row['old_crm_id']) not in
               PREVIEW_BASELINE['ambiguous_ids'] else 'ambiguous in preview',
               'production_result': 'unmatched'})
    for row in ambiguous:
        was = str(row['old_crm_id']) in PREVIEW_BASELINE['ambiguous_ids']
        entry(row['old_crm_id'], 'ambiguous in production' + ('' if was else ' (NEW vs preview)'),
              row['reason'], 'skip - nothing written',
              'REVIEW REQUIRED', {'preview_result': 'ambiguous' if was else 'matched',
                                  'production_result': 'ambiguous - skipped',
                                  'connect_file_id': row.get('connect_file')})
    for row in review:
        was = str(row['old_crm_id']) in PREVIEW_BASELINE['duplicate_bank_ids']
        entry(row['old_crm_id'],
              'duplicate bank name(s): ' + ', '.join(row['duplicate_banks']) +
              ('' if was else ' (NEW vs preview)'),
              'the same bank appears more than once, so the rows cannot be merged by bank name',
              'leave those rows untouched, migrate the other banks on the file', 'REVIEW REQUIRED',
              {'preview_result': 'duplicate-bank' if was else 'no duplicate banks',
               'production_result': 'duplicate-bank rows skipped'})
    for row in conflicts:
        was = str(row['old_crm_id']) in PREVIEW_BASELINE['status_conflict_ids']
        entry(row['old_crm_id'],
              f'status export={row["export_status"]!r} vs Connect={row["connect_status"]!r}' +
              ('' if was else ' (NEW vs preview)'),
              'production Connect status is populated and newer',
              'keep the Connect status, still restore the historical bank data', 'SAFE DIFFERENCE',
              {'preview_result': 'status conflict' if was else 'no status conflict',
               'production_result': 'Connect status kept'})

    for old_id, change in changed_here.items():
        pv = preview.get(str(old_id))
        pv_fields = pv['fields'] if pv else []
        if sorted(pv_fields) == sorted(change['fields']):
            continue
        only_prod = [f for f in change['fields'] if f not in pv_fields]
        only_prev = [f for f in pv_fields if f not in change['fields']]
        entry(old_id, f'different fields to write than in preview: +{only_prod} -{only_prev}',
              'production and preview held different current values for this file',
              'apply the approved blank-safe merge (export blanks never overwrite Connect data)',
              'SAFE DIFFERENCE',
              {'preview_result': pv_fields or 'no change needed in preview',
               'production_result': change['fields']})
    for old_id, pv in preview.items():
        if old_id in changed_here or old_id not in matched_ids:
            continue
        entry(old_id, 'changed in preview, already correct in production',
              'production already holds these values', 'no write needed', 'SAFE DIFFERENCE',
              {'preview_result': pv['fields'], 'production_result': 'already identical'})
    return out


async def create_backup(db, live_count):
    stamp = datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')
    name = f'leads_backup_pre_migration_{stamp}'
    docs = await db.leads.find({}).to_list(500000)
    if docs:
        await db[name].insert_many(docs, ordered=False)
    backup_count = await db[name].count_documents({})
    return {'collection': name, 'live_count': live_count, 'backup_count': backup_count,
            'verified': backup_count == live_count}


async def run_migration(db, apply=False, export_path=None, policy=POLICY_CONNECT_WINS):
    """Dry run by default. Returns a JSON-safe report."""
    records = load_export(export_path)
    total_leads = await db.leads.count_documents({})
    total_files = await db.leads.count_documents({'status': 'file'})
    connect = await db.leads.find({}, {
        'id': 1, 'name': 1, 'phone': 1, 'mobile': 1, 'email': 1, 'status': 1, 'file_status': 1,
        'eligibilities': 1, 'file_details': 1, 'employment_type': 1}).to_list(500000)

    matches, unmatched, ambiguous = resolve_matches(records, connect)

    backup = None
    if apply:
        backup = await create_backup(db, total_leads)
        if not backup['verified']:
            return {'aborted': True, 'reason': 'backup count does not match live leads count',
                    'backup': backup, 'writes': 0}

    counts = collections.Counter({'matched_own_id': 0, 'matched_mobile_name': 0,
                                  'matched_mobile': 0, 'matched_email': 0})
    field_changes = collections.Counter()
    review, conflicts, changes, failures = [], [], [], []
    overwrite_report, preserved_report = [], []
    before_rows, expected_rows = [], []

    for i, rec in enumerate(records):
        if i not in matches:
            continue
        match, how = matches[i]
        counts['processed'] += 1
        counts['matched_' + how] += 1
        set_doc, before, after, changed, flag, conflict, overwrites, preserved = plan_file(
            rec, match, policy=policy)
        field_changes.update(changed)
        if flag:
            review.append(flag)
        if conflict:
            conflicts.append(conflict)
        if overwrites:
            overwrite_report.append({'old_crm_id': rec.get('old_crm_id'), 'name': rec.get('name'),
                                     'connect_id': str(match['_id']), 'overwrites': overwrites})
        if preserved:
            preserved_report.append({'old_crm_id': rec.get('old_crm_id'), 'name': rec.get('name'),
                                     'connect_id': str(match['_id']), 'preserved': preserved})
        before_rows.append(match.get('eligibilities') or [])
        expected_rows.append(set_doc.get('eligibilities', match.get('eligibilities') or []))
        if not set_doc:
            counts['already_identical'] += 1
            continue
        counts['to_update'] += 1
        changes.append({'old_crm_id': rec.get('old_crm_id'), 'connect_id': str(match['_id']),
                        'name': rec.get('name'), 'matched_by': how,
                        'fields': sorted(after.keys()),
                        'before': json.loads(json.dumps(before, default=str)),
                        'after': json.loads(json.dumps(after, default=str))})
        if apply:
            try:
                result = await db.leads.update_one({'_id': match['_id']}, {'$set': set_doc})
                if result.matched_count != 1:
                    raise RuntimeError(f'matched_count={result.matched_count}')
                counts['updated'] += 1
                counts['modified'] += result.modified_count
            except Exception as exc:  # noqa: BLE001
                counts['failed'] += 1
                failures.append({'old_crm_id': rec.get('old_crm_id'), 'name': rec.get('name'),
                                 'error': str(exc)})

    export_all = measure([r.get('eligibilities') for r in records])
    matched_export = measure([records[i].get('eligibilities') for i in matches])
    reconciliation = {'export_all_454': export_all, 'export_matched_files': matched_export,
                      'connect_before': measure(before_rows),
                      'connect_expected_after': measure(expected_rows)}
    if apply:
        after_docs = await db.leads.find(
            {'_id': {'$in': [matches[i][0]['_id'] for i in matches]}},
            {'eligibilities': 1}).to_list(500000)
        reconciliation['connect_actual_after'] = measure([d.get('eligibilities') for d in after_docs])

    diff_vs_preview = {
        'processed': counts['processed'] - PREVIEW_BASELINE['processed'],
        'ambiguous': len(ambiguous) - PREVIEW_BASELINE['ambiguous'],
        'unmatched': len(unmatched) - PREVIEW_BASELINE['unmatched'],
        'rows_added': field_changes['eligibility_rows_added'] - PREVIEW_BASELINE['rows_added'],
        'status_conflicts': len(conflicts) - PREVIEW_BASELINE['status_conflicts'],
        'duplicate_bank_files': len(review) - PREVIEW_BASELINE['duplicate_bank_files'],
        'ambiguous_only_here': [a for a in ambiguous
                                if a['old_crm_id'] not in PREVIEW_BASELINE['ambiguous_ids']],
        'ambiguous_only_in_preview': [i for i in PREVIEW_BASELINE['ambiguous_ids']
                                      if i not in {a['old_crm_id'] for a in ambiguous}],
        'duplicate_bank_only_here': [r for r in review
                                     if r['old_crm_id'] not in PREVIEW_BASELINE['duplicate_bank_ids']],
        'duplicate_bank_only_in_preview': [i for i in PREVIEW_BASELINE['duplicate_bank_ids']
                                           if i not in {r['old_crm_id'] for r in review}],
        'status_conflict_only_here': [c for c in conflicts
                                      if c['old_crm_id'] not in PREVIEW_BASELINE['status_conflict_ids']],
        'status_conflict_only_in_preview': [i for i in PREVIEW_BASELINE['status_conflict_ids']
                                            if i not in {c['old_crm_id'] for c in conflicts}],
        'per_record': classify_differences(records, matches, changes, unmatched, ambiguous,
                                           review, conflicts),
    }
    unsafe = [d for d in diff_vs_preview['per_record'] if d['classification'] == 'UNSAFE']

    return {
        'mode': 'apply' if apply else 'dry_run',
        'policy': policy,
        'run_at': datetime.now(timezone.utc).isoformat(),
        'db': db.name,
        'environment': {'total_leads': total_leads, 'total_files': total_files,
                        'old_crm_records': len(records)},
        'matching': {'safely_matched': counts['processed'],
                     'by_own_id': counts['matched_own_id'],
                     'by_mobile_name': counts['matched_mobile_name'],
                     'by_unique_mobile': counts['matched_mobile'],
                     'by_email': counts['matched_email'],
                     'unmatched': len(unmatched), 'ambiguous': len(ambiguous)},
        'plan': {'would_update' if not apply else 'updated':
                 counts['to_update'] if not apply else counts['updated'],
                 'already_identical': counts['already_identical'],
                 'would_skip': len(unmatched) + len(ambiguous),
                 'failed': counts['failed'],
                 'eligibility_rows_added': field_changes['eligibility_rows_added'],
                 'duplicate_bank_files': len(review),
                 'status_conflicts': len(conflicts),
                 'new_files_created': 0, 'files_deleted': 0},
        'field_changes': dict(field_changes),
        'reconciliation': reconciliation,
        'diff_vs_preview': diff_vs_preview,
        'unmatched': unmatched,
        'ambiguous': ambiguous,
        'duplicate_bank_files': review,
        'status_conflicts': conflicts,
        'overwrites_of_existing_connect_values': overwrite_report,
        'preserved_connect_values': preserved_report,
        'unsafe_differences': unsafe,
        'failures': failures,
        'backup': backup,
        'changes': changes,
    }
