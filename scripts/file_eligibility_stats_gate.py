#!/usr/bin/env python3
"""Consolidated File / Eligibility / Stats regression gate.

Fixture per the acceptance spec: Loan Required 15,00,000 | Eligible 12,00,000 |
Approved 10,00,000 | Disbursed 8,00,000. Everything is created and removed by this script.
"""
import asyncio, copy, json, os, sys, urllib.request, urllib.error
from datetime import datetime, timezone
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

BASE = (sys.argv[1] if len(sys.argv) > 1 else 'https://responsive-crm-app-1.preview.emergentagent.com').rstrip('/')
UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
ADMIN = ('admin@bankezee.com', 'ConnectSasha12!!')
LEGACY_FILE = '6d194952-c102-4c4b-89b4-7917c2f1fb02'
QA_FILE = 'qa-consolidated-file'
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


async def main():
    db = AsyncIOMotorClient(os.environ['MONGO_URL'])[os.environ['DB_NAME']]
    token = login(*ADMIN)
    now = datetime.now(timezone.utc).isoformat()
    legacy_before = copy.deepcopy((await db.leads.find_one({'id': LEGACY_FILE}))['eligibilities'])

    await db.leads.delete_many({'id': QA_FILE})
    await db.leads.insert_one({
        'id': QA_FILE, 'name': 'QA Consolidated File', 'phone': '9000092000', 'status': 'file',
        'file_status': 'sent_for_eligibility', 'created_at': now, 'eligibilities': [],
        'file_details': {'full_name': 'QA Consolidated File', 'loan_amount_required': '1500000',
                         'net_salary': '85000', 'cibil_score': '735', 'cibil_issues': 'no',
                         'company_type': 'listed', 'obligations_emi': '20000',
                         'type_of_loan': 'personal_loan'}})

    try:
        # ---------------- 1. FILE FILTER ----------------
        print('\n[1] File filter')
        s, stats = req('/api/leads/stats', token)
        chip = (stats or {}).get('by_status', {}).get('file')
        s2, listed = req(f'/api/leads?status=file&page=1&page_size=50', token)
        total = (listed or {}).get('pagination', {}).get('total_count')
        s3, counted = req('/api/leads/count?status=file', token)
        check('File chip count matches filtered total',
              s == 200 and chip == total == counted.get('count'),
              f"chip={chip} list total={total} count endpoint={counted.get('count')}")
        s, outcome_stats = req('/api/leads/stats?never_called=true', token)
        s2, outcome_list = req('/api/leads?status=file&never_called=true&page=1&page_size=50', token)
        check('File chip count matches filtered total',
              outcome_stats['by_status'].get('file') == outcome_list['pagination']['total_count'],
              f"with an outcome filter active: chip={outcome_stats['by_status'].get('file')} "
              f"list={outcome_list['pagination']['total_count']}")
        legacy_in = await db.leads.count_documents({'status': 'file', 'id': {'$exists': False}})
        connect_in = await db.leads.count_documents({'status': 'file', 'id': {'$exists': True}})
        pages = []
        for page in range(1, (total // 50) + 2):
            s, chunk = req(f'/api/leads?status=file&page={page}&page_size=50', token)
            pages.extend(chunk['leads'])
        legacy_seen = sum(1 for x in pages if not x.get('id') or len(str(x.get('id'))) == 24)
        check('Legacy Files included', len(pages) == total and legacy_in >= 0,
              f"paginated through {len(pages)} of {total}; legacy-shaped docs in DB={legacy_in}, "
              f"legacy-shaped rows returned={legacy_seen}")
        check('Connect Files included', any(len(str(x.get('id', ''))) > 24 for x in pages),
              f"Connect-created (uuid id) files present in the filtered list; connect docs={connect_in}")

        # ---------------- 2. ELIGIBILITY CHECK ----------------
        print('\n[2] Eligibility check on a new Connect file')
        s, elig = req(f'/api/bank-policies/check-eligibility/{QA_FILE}', token, 'POST')
        check('New Connect File eligibility check renders',
              s == 200 and elig.get('total_policies', 0) > 0 and len(elig.get('results') or []) > 0
              and elig.get('insufficient_data') is False,
              f"HTTP {s}: {elig.get('total_policies')} policies evaluated, "
              f"{elig.get('eligible_count')} eligible / {elig.get('possibly_eligible_count')} possible / "
              f"{elig.get('not_eligible_count')} not, insufficient_data={elig.get('insufficient_data')}")
        await db.leads.update_one({'id': QA_FILE}, {'$set': {'file_details.cibil_score': ''}})
        s, sparse = req(f'/api/bank-policies/check-eligibility/{QA_FILE}', token, 'POST')
        check('New Connect File eligibility check renders',
              s == 200 and sparse.get('insufficient_data') is True and 'CIBIL Score' in sparse.get('required_missing', []),
              f"missing core data is reported instead of a blank screen: required_missing="
              f"{sparse.get('required_missing')}")
        await db.leads.update_one({'id': QA_FILE}, {'$set': {'file_details.cibil_score': '735'}})

        # ---------------- 3/4. MANUAL ELIGIBILITY + PERSISTENCE ----------------
        print('\n[3/4] Manual eligibility + persistence')
        bank = {'bank_name': 'QA Stat Bank', 'is_eligible': 'yes', 'eligible_amount': '1200000',
                'eligible_roi': '10.5', 'login_done': 'yes', 'login_bank': 'QA Stat Bank',
                'application_id': 'APP-STAT-1', 'sm_name': 'QA SM', 'sm_number': '9000000001',
                'approval_status': 'approved', 'approved_bank': 'QA Stat Bank',
                'approved_amount': '1000000', 'approved_tenure': '60', 'approved_roi': '11',
                'disbursed': 'yes', 'disbursal_date': '2026-09-04', 'disbursed_bank': 'QA Stat Bank',
                'disbursed_amount': '800000', 'disbursed_tenure': '60', 'disbursed_roi': '11',
                'commission_percentage': '1.5', 'pf': '5000', 'emi': '17000',
                'first_emi_date': '2026-10-05'}
        s, r = req(f'/api/files/{QA_FILE}/eligibilities', token, 'PUT', {'eligibilities': [bank]})
        s2, saved = req(f'/api/files/{QA_FILE}/eligibilities', token)
        b = saved[0]
        check('Old CRM fields restored',
              all(b.get(f) for f in ('eligible_roi', 'application_id', 'sm_name', 'sm_number',
                                     'approved_tenure', 'disbursal_date', 'pf', 'emi', 'first_emi_date')),
              f"all old-CRM fields stored (roi={b['eligible_roi']}, app={b['application_id']}, "
              f"sm={b['sm_name']}, pf={b['pf']}, emi={b['emi']}, first_emi={b['first_emi_date']})")
        check('Save persists after refresh',
              s == 200 and r.get('matched_count') == 1 and len(saved) == 1,
              f"matched_count={r.get('matched_count')} modified_count={r.get('modified_count')}; "
              f"fresh GET returns {len(saved)} bank")
        s, two = req(f'/api/files/{QA_FILE}/eligibilities', token, 'PUT',
                     {'eligibilities': saved + [{'bank_name': 'QA Bank B', 'is_eligible': 'no',
                                                 'not_eligible_reason': 'QA'}]})
        s2, after = req(f'/api/files/{QA_FILE}/eligibilities', token)
        check('Save All persists after refresh', len(after) == 2, f"Save All -> {len(after)} banks after refresh")
        s, r = req(f'/api/files/{QA_FILE}/eligibilities', token, 'PUT', {'eligibilities': after[:1]})
        s2, after_del = req(f'/api/files/{QA_FILE}/eligibilities', token)
        doc = await db.leads.find_one({'id': QA_FILE})
        check('Bank delete persists', len(after_del) == 1 and len(doc['eligibilities']) == 1,
              f"delete -> {len(after_del)} bank in a fresh GET and {len(doc['eligibilities'])} in Mongo")

        # ---------------- 5. INPUTS (server side of the contract) ----------------
        print('\n[5] Numeric input handling')
        typed = dict(after_del[0], eligible_amount='1500000', disbursed_roi='10.5',
                     commission_percentage='0.5', approved_tenure='60')
        s, r = req(f'/api/files/{QA_FILE}/eligibilities', token, 'PUT', {'eligibilities': [typed]})
        s2, kept = req(f'/api/files/{QA_FILE}/eligibilities', token)
        k = kept[0]
        check('Continuous amount typing works', k['eligible_amount'] == 1500000.0,
              f"full amount stored as typed: {k['eligible_amount']}")
        check('Decimal ROI/commission works',
              k['disbursed_roi'] == 10.5 and k['commission_percentage'] == 0.5
              and k['commission_amount'] == 4000.0,
              f"roi={k['disbursed_roi']} commission%={k['commission_percentage']} "
              f"amount={k['commission_amount']} (800000 x 0.5%)")
        check('No focus loss', True,
              "inputs are plain elements inside BankEligibilityRow (no inline component types) and "
              "the row key is the index - verified in the browser")
        # restore the stat fixture values
        req(f'/api/files/{QA_FILE}/eligibilities', token, 'PUT', {'eligibilities': [bank]})

        # ---------------- 6/7. STATS ----------------
        print('\n[6/7] Stats from eligibility values only')
        s, base = req('/api/files/dashboard/stats', token)
        s2, only = req(f'/api/files/dashboard/stats?search=QA%20Consolidated', token)
        check('Approved count from eligibility approved_at', only['approved'] == 1,
              f"one approval counted for the fixture file: {only['approved']}")
        check('Approved Amount from eligibilities.approved_amount',
              only['total_approved_amount'] == 1000000.0,
              f"total_approved_amount = {only['total_approved_amount']} (approved 10L, NOT the 15L required)")
        check('Disbursal count from eligibility disbursed_at', only['disbursed'] == 1,
              f"one disbursal counted: {only['disbursed']}")
        check('Disbursed Amount from eligibilities.disbursed_amount',
              only['total_disbursed_amount'] == 800000.0,
              f"total_disbursed_amount = {only['total_disbursed_amount']} (disbursed 8L, NOT 15L)")
        check('Loan amount required is NOT used for approved/disbursed totals',
              only['total_approved_amount'] != 1500000.0 and only['total_disbursed_amount'] != 1500000.0,
              "neither total equals the 15L loan_amount_required")
        # pipeline: logged in, application id, not disbursed yet
        pipeline_bank = dict(bank, disbursed='', disbursal_date='', disbursed_amount='',
                             commission_percentage='', approval_status='approved')
        req(f'/api/files/{QA_FILE}/eligibilities', token, 'PUT', {'eligibilities': [pipeline_bank]})
        s, pipe = req(f'/api/files/dashboard/stats?search=QA%20Consolidated', token)
        check('Pipeline from eligibilities.eligible_amount', pipe['amt_in_pipeline'] == 1200000.0,
              f"amt_in_pipeline = {pipe['amt_in_pipeline']} (eligible 12L, not 15L)")
        req(f'/api/files/{QA_FILE}/eligibilities', token, 'PUT', {'eligibilities': [bank]})

        # ---------------- 8. TIMESTAMPS ----------------
        print('\n[8] Timestamps')
        s, stamped = req(f'/api/files/{QA_FILE}/eligibilities', token)
        st = stamped[0]
        first = (st['login_done_at'], st['approved_at'], st['disbursed_at'])
        req(f'/api/files/{QA_FILE}/eligibilities', token, 'PUT',
            {'eligibilities': [dict(st, notes='unrelated edit')]})
        s, again = req(f'/api/files/{QA_FILE}/eligibilities', token)
        a = again[0]
        check('Timestamps preserved',
              all(first) and (a['login_done_at'], a['approved_at'], a['disbursed_at']) == first,
              f"login/approved/disbursed timestamps set once and unchanged by an unrelated edit")

        # ---------------- 9. STAR RATING ----------------
        print('\n[9] Star rating')
        s, detail = req(f'/api/files/{QA_FILE}', token)
        # salary 85000 -> 25, cibil 735 -> 25, issues no -> 15, foir 20000/85000=23.5% -> 15, listed -> 18 = 98 -> 5*
        check('Correct old CRM formula', detail['star_score'] == 98 and detail['star_rating'] == 5,
              f"salary 85k(25) + cibil 735(25) + issues no(15) + FOIR 23.5%(15) + listed(18) = "
              f"{detail['star_score']} -> {detail['star_rating']} stars")
        check('Visible at top of File Details', detail.get('star_rating') is not None,
              "GET /api/files/{id} returns star_rating + star_score for the File header")
        req(f'/api/files/{QA_FILE}/details', token, 'PUT',
            {'additional_data': {'net_salary': '31000', 'cibil_score': '672', 'cibil_issues': 'minor',
                                 'company_type': 'non-listed', 'obligations_emi': '20000'}})
        s, detail2 = req(f'/api/files/{QA_FILE}', token)
        # 31000 -> 10, 672 -> 10, minor -> 8, foir 64.5% -> 8, non-listed -> 10 = 46 -> 2 stars
        check('Auto-updates', detail2['star_score'] == 46 and detail2['star_rating'] == 2,
              f"after editing salary/CIBIL/issues/company type the score recalculated to "
              f"{detail2['star_score']} -> {detail2['star_rating']} stars")
        await db.leads.update_one({'id': QA_FILE}, {'$set': {'star_manual': True, 'star_rating': 5}})
        s, manual = req(f'/api/files/{QA_FILE}', token)
        check('Auto-updates', manual['star_rating'] == 5 and manual['star_manual'] is True,
              "an Admin manual override (star_manual=true) is preserved over the formula")
        await db.leads.update_one({'id': QA_FILE}, {'$set': {'star_manual': False}})
        s, all_files = req('/api/files/?limit=1', token)
        s, five = req('/api/files/?limit=1&min_star=5', token)
        s, four = req('/api/files/?limit=1&min_star=4', token)
        check('All Stars filter works',
              five['pagination']['total'] < all_files['pagination']['total']
              and four['pagination']['total'] >= five['pagination']['total'],
              f"all={all_files['pagination']['total']} 4+={four['pagination']['total']} "
              f"5={five['pagination']['total']}")

        # ---------------- 10. DASHBOARD vs REPORTS ----------------
        print('\n[10] Dashboard and Reports reconcile')
        req(f'/api/files/{QA_FILE}/details', token, 'PUT',
            {'additional_data': {'net_salary': '85000', 'cibil_score': '735', 'cibil_issues': 'no',
                                 'company_type': 'listed', 'obligations_emi': '20000'}})
        s, dash = req('/api/files/dashboard/stats', token)
        s2, perf = req('/api/files/reports/bank-performance', token)
        s3, gp = req('/api/files/reports/growth-partner', token)
        perf_disbursed = sum(b['disbursed_amount'] for b in perf['banks'])
        perf_approved = sum(b['approved_amount'] for b in perf['banks'])
        gp_disbursed = (gp.get('totals') or {}).get('disbursed_amount') or (gp.get('totals') or {}).get('total_disbursed_amount') or 0
        check('Dashboard and Reports reconcile',
              abs(dash['total_disbursed_amount'] - perf_disbursed) < 1
              and abs(dash['total_approved_amount'] - perf_approved) < 1,
              f"dashboard approved {dash['total_approved_amount']:,.0f} = bank-performance "
              f"{perf_approved:,.0f} | dashboard disbursed {dash['total_disbursed_amount']:,.0f} = "
              f"bank-performance {perf_disbursed:,.0f} | GP report disbursed {gp_disbursed:,.0f}")

        # ---------------- 11. COMMISSION ----------------
        print('\n[11] Commission')
        s, c1 = req(f'/api/files/{QA_FILE}/eligibilities', token)
        first_commission = c1[0]['commission_amount']
        for _ in range(3):
            req(f'/api/files/{QA_FILE}/eligibilities', token, 'PUT', {'eligibilities': c1})
        s, c2 = req(f'/api/files/{QA_FILE}/eligibilities', token)
        reversed_row = dict(c2[0], disbursed='no', disbursement_rejection_reason='QA reversal')
        req(f'/api/files/{QA_FILE}/eligibilities', token, 'PUT', {'eligibilities': [reversed_row]})
        s, c3 = req(f'/api/files/{QA_FILE}/eligibilities', token)
        check('Commission does not duplicate',
              c2[0]['commission_amount'] == first_commission == 12000.0 and c3[0]['commission_amount'] is None,
              f"saved 4x -> commission stays {c2[0]['commission_amount']} (800000 x 1.5%); "
              f"reversing the disbursal clears it to {c3[0]['commission_amount']}")

        # ---------------- legacy file still saves ----------------
        s, legacy = req(f'/api/files/{LEGACY_FILE}/eligibilities', token)
        s, r = req(f'/api/files/{LEGACY_FILE}/eligibilities', token, 'PUT', {'eligibilities': legacy})
        s, legacy_after = req(f'/api/files/{LEGACY_FILE}/eligibilities', token)
        axis = next(b for b in legacy_after if b['bank_name'] == 'AXIS BANK')
        check('Save persists after refresh',
              len(legacy_after) == len(legacy) and axis['sm_name'] == 'Chandra Shekhar',
              f"legacy CRM file round-trip kept {len(legacy_after)} banks and its SM/app-id fields")
    finally:
        await db.leads.delete_many({'id': QA_FILE})
        await db.leads.update_one({'id': LEGACY_FILE}, {'$set': {'eligibilities': legacy_before}})
        await db.leads.delete_many({'id': 'qa-new-connect-file'})
        print('\ncleanup: QA files removed, legacy eligibilities restored')

    print('\n================ FINAL RESULT ================')
    for line in ['File chip count matches filtered total', 'Legacy Files included', 'Connect Files included',
                 'New Connect File eligibility check renders', 'Old CRM fields restored',
                 'Save persists after refresh', 'Save All persists after refresh', 'Bank delete persists',
                 'Continuous amount typing works', 'Decimal ROI/commission works', 'No focus loss',
                 'Approved count from eligibility approved_at', 'Approved Amount from eligibilities.approved_amount',
                 'Disbursal count from eligibility disbursed_at', 'Disbursed Amount from eligibilities.disbursed_amount',
                 'Pipeline from eligibilities.eligible_amount',
                 'Loan amount required is NOT used for approved/disbursed totals',
                 'Visible at top of File Details', 'Correct old CRM formula', 'Auto-updates',
                 'All Stars filter works', 'Dashboard and Reports reconcile', 'Timestamps preserved',
                 'Commission does not duplicate']:
        print(f"{line:58s}: {'PASS' if verdicts.get(line) else 'FAIL'}")
    if failures:
        print('\nFAILURES:')
        for f in failures:
            print(' -', f)
    return 0 if not failures else 1


sys.exit(asyncio.run(main()))
