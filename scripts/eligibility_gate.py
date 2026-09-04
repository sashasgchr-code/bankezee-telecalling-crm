#!/usr/bin/env python3
"""Bank Eligibility lifecycle acceptance test (old CRM workflow replicated in Connect).

Creates a Connect test file, runs the 5-bank lifecycle, verifies persistence in Mongo and via a
fresh GET, checks timestamps/commission, edit + delete persistence, repeats the save on a REAL
legacy CRM file (restoring it byte-for-byte afterwards) and re-checks the Reports numbers.
"""
import asyncio, copy, json, os, sys, urllib.request, urllib.error
from datetime import datetime, timezone
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

BASE = (sys.argv[1] if len(sys.argv) > 1 else 'https://responsive-crm-app-1.preview.emergentagent.com').rstrip('/')
UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
ADMIN = ('admin@bankezee.com', 'ConnectSasha12!!')
LEGACY_FILE = '6d194952-c102-4c4b-89b4-7917c2f1fb02'
load_dotenv('/app/backend/.env')
verdicts, failures = {}, []


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
        try:
            return e.code, json.loads(e.read().decode())
        except Exception:
            return e.code, None


def check(line, ok, note=''):
    verdicts[line] = verdicts.get(line, True) and ok
    if not ok:
        failures.append(f"{line}: {note}")
    print(('  PASS  ' if ok else '  FAIL  ') + f"[{line}] {note}")


def login(email, pwd):
    s, d = req('/api/auth/login', m='POST', b={'email': email, 'password': pwd})
    return (d or {}).get('access_token') or (d or {}).get('token')


BANKS = [
    {'bank_name': 'QA Bank 1', 'is_eligible': 'no', 'not_eligible_reason': 'Salary below cutoff'},
    {'bank_name': 'QA Bank 2', 'is_eligible': 'yes', 'eligible_amount': '400000', 'eligible_roi': '13.5',
     'login_done': 'no', 'login_rejection_reason': 'Customer declined login'},
    {'bank_name': 'QA Bank 3', 'is_eligible': 'yes', 'eligible_amount': '500000', 'eligible_roi': '14',
     'login_done': 'yes', 'login_bank': 'QA Bank 3', 'application_id': 'APP-3', 'sm_name': 'SM Three',
     'sm_number': '9000000003', 'approval_status': 'declined', 'declined_bank': 'QA Bank 3',
     'declined_reason': 'High obligations'},
    {'bank_name': 'QA Bank 4', 'is_eligible': 'yes', 'eligible_amount': '600000', 'eligible_roi': '12.75',
     'login_done': 'yes', 'login_bank': 'QA Bank 4', 'application_id': 'APP-4', 'sm_name': 'SM Four',
     'sm_number': '9000000004', 'approval_status': 'approved', 'approved_bank': 'QA Bank 4',
     'approved_amount': '550000', 'approved_tenure': '60', 'approved_roi': '12.99', 'disbursed': 'no',
     'disbursement_rejection_reason': 'Customer postponed'},
    {'bank_name': 'QA Bank 5', 'is_eligible': 'yes', 'eligible_amount': '900000', 'eligible_roi': '11.5',
     'login_done': 'yes', 'login_bank': 'QA Bank 5', 'application_id': 'APP-5', 'sm_name': 'SM Five',
     'sm_number': '9000000005', 'approval_status': 'approved', 'approved_bank': 'QA Bank 5',
     'approved_amount': '850000', 'approved_tenure': '72', 'approved_roi': '11.75', 'disbursed': 'yes',
     'disbursal_date': '2026-09-03', 'disbursed_bank': 'QA Bank 5', 'disbursed_amount': '850000',
     'disbursed_tenure': '72', 'disbursed_roi': '11.75', 'commission_percentage': '1.25'},
]
VEHICLE_BANK = {
    'bank_name': 'QA Vehicle Bank', 'is_eligible': 'yes', 'eligible_amount': '700000', 'eligible_roi': '10.5',
    'login_done': 'yes', 'login_bank': 'QA Vehicle Bank', 'application_id': 'APP-V', 'sm_name': 'SM V',
    'sm_number': '9000000006', 'approval_status': 'approved', 'approved_bank': 'QA Vehicle Bank',
    'approved_amount': '650000', 'approved_tenure': '48', 'approved_roi': '10.75',
    'rc_submitted': 'no', 'rc_not_submitted_reason': 'RC with previous financier',
    'noc_submitted': 'no', 'noc_not_submitted_reason': 'NOC awaited',
    'hypothecation': 'no', 'hypothecation_not_done_reason': 'Pending RTO',
}


async def main():
    db = AsyncIOMotorClient(os.environ['MONGO_URL'])[os.environ['DB_NAME']]
    token = login(*ADMIN)
    now = datetime.now(timezone.utc).isoformat()

    # Connect-created test file
    connect_id = 'qa-elig-connect-file'
    await db.leads.delete_many({'id': connect_id})
    await db.leads.insert_one({
        'id': connect_id, 'name': 'QA Eligibility Connect File', 'phone': '9000090000',
        'status': 'file', 'file_status': 'sent_for_eligibility', 'created_at': now,
        'file_details': {'full_name': 'QA Eligibility Connect File', 'type_of_loan': 'used_vehicle_loan_bt',
                         'net_salary': '80000', 'loan_amount_required': '900000'},
        'eligibilities': []})
    legacy_before = copy.deepcopy((await db.leads.find_one({'id': LEGACY_FILE}))['eligibilities'])

    try:
        # -------- Add bank / max 7 --------
        s, r = req(f'/api/files/{connect_id}/eligibilities', token, 'PUT', {'eligibilities': BANKS})
        check('Add Bank', s == 200 and r.get('count') == 5 and r.get('matched_count') == 1,
              f"Save All 5 banks -> HTTP {s} count={r.get('count')} matched={r.get('matched_count')} "
              f"modified={r.get('modified_count')}")
        s, r8 = req(f'/api/files/{connect_id}/eligibilities', token, 'PUT',
                    {'eligibilities': BANKS + [dict(b, bank_name=f"Extra {i}") for i, b in enumerate(BANKS[:3])]})
        check('Maximum 7 banks', s == 400, f"8 banks rejected -> HTTP {s} ({(r8 or {}).get('detail')})")

        # -------- Persistence: Mongo + fresh GET --------
        doc = await db.leads.find_one({'id': connect_id})
        stored = {b['bank_name']: b for b in doc['eligibilities']}
        s, fetched = req(f'/api/files/{connect_id}/eligibilities', token)
        got = {b['bank_name']: b for b in fetched}
        check('Save All persists after refresh',
              len(stored) == 5 and len(got) == 5 and all(k in got for k in stored),
              f"mongo={len(stored)} banks, fresh GET={len(got)} banks")
        s, detail = req(f'/api/files/{connect_id}', token)
        check('Save All persists after refresh',
              len((detail or {}).get('eligibilities') or []) == 5,
              f"file detail endpoint returns {len((detail or {}).get('eligibilities') or [])} banks")

        b1, b2, b3, b4, b5 = (got['QA Bank 1'], got['QA Bank 2'], got['QA Bank 3'],
                              got['QA Bank 4'], got['QA Bank 5'])
        check('Not Eligible flow',
              b1['is_eligible'] == 'no' and b1['not_eligible_reason'] == 'Salary below cutoff'
              and not b1.get('login_done'),
              f"bank1 is_eligible={b1['is_eligible']!r} reason={b1['not_eligible_reason']!r}")
        check('Login flow',
              b2['login_done'] == 'no' and b2['login_rejection_reason'] == 'Customer declined login'
              and b2['eligible_amount'] == 400000 and b2['eligible_roi'] == 13.5,
              f"bank2 login_done={b2['login_done']!r} reason kept, eligible {b2['eligible_amount']}@{b2['eligible_roi']}%")
        check('Login flow',
              b3['login_bank'] == 'QA Bank 3' and b3['application_id'] == 'APP-3'
              and b3['sm_name'] == 'SM Three' and b3['sm_number'] == '9000000003',
              f"bank3 login fields kept (app_id={b3['application_id']}, sm={b3['sm_name']}/{b3['sm_number']})")
        check('Decline flow',
              b3['approval_status'] == 'declined' and b3['declined_bank'] == 'QA Bank 3'
              and b3['declined_reason'] == 'High obligations',
              f"bank3 declined + reason={b3['declined_reason']!r}")
        check('Approval flow',
              b4['approval_status'] == 'approved' and b4['approved_amount'] == 550000
              and b4['approved_tenure'] == 60 and b4['approved_roi'] == 12.99,
              f"bank4 approved {b4['approved_amount']} / {b4['approved_tenure']}m @ {b4['approved_roi']}%")
        check('Disbursement flow',
              b4['disbursed'] == 'no' and b4['disbursement_rejection_reason'] == 'Customer postponed',
              f"bank4 not disbursed + reason kept")
        check('Disbursement flow',
              b5['disbursed'] == 'yes' and b5['disbursed_amount'] == 850000
              and b5['disbursed_tenure'] == 72 and b5['disbursed_roi'] == 11.75
              and b5['disbursal_date'] == '2026-09-03' and b5['disbursed_bank'] == 'QA Bank 5',
              f"bank5 disbursed {b5['disbursed_amount']} on {b5['disbursal_date']}")
        check('Commission calculation',
              b5['commission_amount'] == round(850000 * 1.25 / 100, 2) == 10625.0
              and b4.get('commission_amount') is None,
              f"bank5 commission={b5['commission_amount']} (850000 x 1.25%), bank4 commission={b4.get('commission_amount')}")

        # -------- Progressive fields: no orphan data below a 'no' answer --------
        check('Progressive fields',
              all(not b1.get(f) for f in ('eligible_amount', 'login_done', 'approval_status', 'disbursed'))
              and not b2.get('approval_status') and not b2.get('disbursed'),
              "bank1 stops at Not Eligible, bank2 stops at Login=No")

        # -------- Timestamps --------
        check('Timestamps correct',
              b3['login_done_at'] and b5['login_done_at'] and not b1.get('login_done_at'),
              f"login_done_at set only where login_done=yes (b3={bool(b3['login_done_at'])}, b1={bool(b1.get('login_done_at'))})")
        check('Timestamps correct',
              b4['approved_at'] and b5['approved_at'] and not b3.get('approved_at') and b3['rejected_at'],
              f"approved_at on approvals only; declined bank3 has rejected_at={bool(b3['rejected_at'])}")
        check('Timestamps correct',
              b5['disbursed_at'] and not b4.get('disbursed_at') and b1['rejected_at'],
              f"disbursed_at only on bank5; not-eligible bank1 rejected_at={bool(b1['rejected_at'])}")

        first_stamps = {k: (v.get('login_done_at'), v.get('approved_at'), v.get('disbursed_at')) for k, v in got.items()}

        # -------- Individual edit (unrelated field) must not rewrite timestamps --------
        edited = [dict(b) for b in fetched]
        for b in edited:
            if b['bank_name'] == 'QA Bank 5':
                b['notes'] = 'edited note'
                b['commission_percentage'] = 2
        s, r = req(f'/api/files/{connect_id}/eligibilities', token, 'PUT', {'eligibilities': edited})
        s, after_edit = req(f'/api/files/{connect_id}/eligibilities', token)
        e5 = {b['bank_name']: b for b in after_edit}['QA Bank 5']
        check('Individual Save persists after refresh',
              s == 200 and e5['notes'] == 'edited note' and e5['commission_percentage'] == 2.0
              and e5['commission_amount'] == 17000.0,
              f"edit saved: notes kept, commission recalculated to {e5['commission_amount']} (850000 x 2%)")
        check('Timestamps correct',
              (e5['login_done_at'], e5['approved_at'], e5['disbursed_at']) == first_stamps['QA Bank 5'],
              "editing an unrelated field did not rewrite login/approved/disbursed timestamps")

        # -------- Commission reversal on disbursal reversal --------
        reversed_rows = [dict(b) for b in after_edit]
        for b in reversed_rows:
            if b['bank_name'] == 'QA Bank 5':
                b['disbursed'] = 'no'
                b['disbursement_rejection_reason'] = 'Reversed by bank'
        req(f'/api/files/{connect_id}/eligibilities', token, 'PUT', {'eligibilities': reversed_rows})
        s, after_rev = req(f'/api/files/{connect_id}/eligibilities', token)
        r5 = {b['bank_name']: b for b in after_rev}['QA Bank 5']
        check('Commission calculation',
              r5['commission_amount'] is None and r5['disbursed'] == 'no',
              "reversing a disbursal removes its commission credit (no double credit on re-save)")
        req(f'/api/files/{connect_id}/eligibilities', token, 'PUT', {'eligibilities': after_edit})

        # -------- Vehicle loan conditions --------
        s, r = req(f'/api/files/{connect_id}/eligibilities', token, 'PUT',
                   {'eligibilities': after_edit + [VEHICLE_BANK]})
        s, veh = req(f'/api/files/{connect_id}/eligibilities', token)
        v = {b['bank_name']: b for b in veh}.get('QA Vehicle Bank', {})
        check('Vehicle-loan conditions',
              v.get('rc_submitted') == 'no' and v.get('rc_not_submitted_reason') == 'RC with previous financier'
              and v.get('noc_submitted') == 'no' and v.get('noc_not_submitted_reason') == 'NOC awaited'
              and v.get('hypothecation') == 'no' and v.get('hypothecation_not_done_reason') == 'Pending RTO',
              "RC/NOC/hypothecation answers and all three reasons persisted")
        vehicle_done = dict(VEHICLE_BANK, rc_submitted='yes', noc_submitted='yes', hypothecation='yes',
                            disbursed='yes', disbursed_amount='650000', disbursed_bank='QA Vehicle Bank',
                            disbursed_tenure='48', disbursed_roi='10.75', commission_percentage='1',
                            disbursal_date='2026-09-04')
        req(f'/api/files/{connect_id}/eligibilities', token, 'PUT',
            {'eligibilities': after_edit + [vehicle_done]})
        s, veh2 = req(f'/api/files/{connect_id}/eligibilities', token)
        v2 = {b['bank_name']: b for b in veh2}['QA Vehicle Bank']
        check('Vehicle-loan conditions',
              v2['rc_submitted'] == 'yes' and v2['noc_submitted'] == 'yes' and v2['hypothecation'] == 'yes'
              and v2['disbursed'] == 'yes' and v2['commission_amount'] == 6500.0,
              f"once RC+NOC+hypothecation are yes the disbursal saves with commission {v2['commission_amount']}")

        # -------- Delete one bank --------
        keep = [b for b in veh2 if b['bank_name'] != 'QA Vehicle Bank']
        s, r = req(f'/api/files/{connect_id}/eligibilities', token, 'PUT', {'eligibilities': keep})
        doc = await db.leads.find_one({'id': connect_id})
        s, after_del = req(f'/api/files/{connect_id}/eligibilities', token)
        check('Delete persists after refresh',
              len(doc['eligibilities']) == 5 and len(after_del) == 5
              and 'QA Vehicle Bank' not in [b['bank_name'] for b in after_del],
              f"removed bank is gone from Mongo ({len(doc['eligibilities'])} left) and from a fresh GET")

        # -------- Connect file verdict --------
        check('Connect File save', len(after_del) == 5, f"Connect-created file persisted {len(after_del)} banks")

        # -------- Legacy CRM file --------
        s, legacy = req(f'/api/files/{LEGACY_FILE}/eligibilities', token)
        legacy_rows = [dict(b) for b in legacy]
        axis = next(b for b in legacy_rows if b['bank_name'] == 'AXIS BANK')
        axis_login_at, axis_rejected_at = axis['login_done_at'], axis['rejected_at']
        axis['declined_reason'] = axis['declined_reason'] + ' [qa]'
        s, r = req(f'/api/files/{LEGACY_FILE}/eligibilities', token, 'PUT', {'eligibilities': legacy_rows})
        s, legacy_after = req(f'/api/files/{LEGACY_FILE}/eligibilities', token)
        a2 = next(b for b in legacy_after if b['bank_name'] == 'AXIS BANK')
        check('Legacy CRM File save',
              s == 200 and len(legacy_after) == len(legacy) and a2['declined_reason'].endswith('[qa]')
              and a2['login_done_at'] == axis_login_at and a2['rejected_at'] == axis_rejected_at
              and a2['sm_name'] == 'Chandra Shekhar' and a2['application_id'] == 'MLP000140418403'
              and a2['eligible_roi'] == 10.65,
              f"legacy file saved: {len(legacy_after)} banks kept, SM/application_id/eligible_roi/"
              f"timestamps all survived the round-trip")
        check('Timestamps correct', a2['login_done_at'] == axis_login_at,
              f"legacy login_done_at preserved ({axis_login_at})")

        # -------- Reports still calculate --------
        s, stats = req('/api/files/dashboard/stats', token)
        s2, bankperf = req('/api/files/reports/bank-performance', token)
        s3, tat = req('/api/files/reports/tat-metrics', token)
        banks = (bankperf or {}).get('banks', [])
        qa_bank5 = next((b for b in banks if b.get('bank_name') == 'QA Bank 5'), None)
        check('Reports still calculate correctly',
              s == 200 and s2 == 200 and s3 == 200 and (stats or {}).get('disbursed') is not None,
              f"dashboard stats HTTP {s} (login={stats.get('login')}, approved={stats.get('approved')}, "
              f"disbursed={stats.get('disbursed')}, disbursed_amount={stats.get('total_disbursed_amount')}) | "
              f"bank-performance HTTP {s2} ({len(banks)} banks) | tat-metrics HTTP {s3}")
        check('Reports still calculate correctly',
              qa_bank5 is not None and qa_bank5.get('disbursals') == 1 and qa_bank5.get('disbursed_amount') == 850000.0,
              f"the QA disbursed bank rolls into bank-performance: {qa_bank5}")
    finally:
        await db.leads.delete_many({'id': connect_id})
        await db.leads.update_one({'id': LEGACY_FILE}, {'$set': {'eligibilities': legacy_before}})
        restored = await db.leads.find_one({'id': LEGACY_FILE}, {'eligibilities': 1})
        print(f"\ncleanup: QA file removed, legacy file restored to "
              f"{[b['bank_name'] for b in restored['eligibilities']]}")

    print('\n================ FINAL RESULT ================')
    for line in ['Add Bank', 'Maximum 7 banks', 'Progressive fields', 'Not Eligible flow', 'Login flow',
                 'Approval flow', 'Decline flow', 'Disbursement flow', 'Vehicle-loan conditions',
                 'Commission calculation', 'Individual Save persists after refresh',
                 'Save All persists after refresh', 'Delete persists after refresh',
                 'Legacy CRM File save', 'Connect File save', 'Timestamps correct',
                 'Reports still calculate correctly']:
        print(f"{line:42s}: {'PASS' if verdicts.get(line) else 'FAIL'}")
    if failures:
        print('\nFAILURES:')
        for f in failures:
            print(' -', f)
    return 0 if not failures else 1


sys.exit(asyncio.run(main()))
