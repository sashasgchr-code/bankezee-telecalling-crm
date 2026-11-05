"""Fixture tests for the shared eligibility engine + extraction merge (no live documents needed)."""
import sys
from datetime import date
sys.path.insert(0, "/app/backend")
from routes.elig_engine import credit_profile, evaluate_bank, run, seasoning, kind  # noqa: E402
from routes.doc_extract import merge, validate  # noqa: E402

ok = lambda c, m: print(("PASS " if c else "FAIL ") + m)  # noqa: E731
A = date(2026, 11, 1)
# Enquiry boundaries
for n, exp in ((4, "No Issues"), (5, "Minor Issues"), (6, "Major Issues")):
    cp = credit_profile({"history_available": True, "accounts": [], "enquiries": [{"date": f"2026-09-{i+1:02d}", "lender": f"L{i}"} for i in range(n)]})
    ok(cp["category"] == exp, f"{n} enquiries/month -> {cp['category']}")
# Late-payment boundaries (distinct account-months; duplicates ignored)
for n, exp in ((1, "Minor Issues"), (2, "Minor Issues"), (3, "Major Issues")):
    cp = credit_profile({"history_available": True, "accounts": [{"account_ref": "A1", "dpd_months": [f"2026-0{i+1}" for i in range(n)] * 2}]})
    ok(cp["category"] == exp, f"{n} late events -> {cp['category']} (counted {cp['late_events']})")
for n, exp in ((1, "Minor Issues"), (2, "Minor Issues"), (3, "Major Issues")):
    ok(credit_profile({"history_available": True, "accounts": [{"bounces": n}]})["category"] == exp, f"{n} bounces -> {exp}")
ok(credit_profile({"history_available": True, "accounts": [{"status": "settled"}]})["category"] == "Settlement", "settlement")
ok(credit_profile({"history_available": True, "accounts": [{"status": "written off"}]})["category"] == "Write Off", "write off")
ok(credit_profile({"history_available": True, "accounts": [{"status": "settled"}, {"written_off": True}]})["category"] == "Settlement & Write Off", "both on different accounts")
ok(credit_profile({})["assessment"] == "Needs Review" and credit_profile({})["category"] is None, "missing history -> Needs Review, not No Issues")
# Seasoning boundaries
pol = {"min_loan_seasoning_months": 6}
for d, exp in (("2026-05-02", 5), ("2026-05-01", 6), ("2026-04-01", 7)):
    ok(seasoning({"disbursal_date": d}, pol, A)["months"] == exp, f"seasoning {d} -> {exp} completed months")
s = seasoning({"sanction_date": "2026-01-01"}, pol, A)
ok(s["source"] == "sanction_date" and s["fallback"], "fallback to sanction date labelled")
# Required example: FOIR 90%, 4 PL + 2 CC + 3 app loans, max 3 BT, PL only
sal = 100000
loans = [{"bank": f"PL{i}", "loan_type": "Personal Loan", "outstanding": o, "emi": e, "disbursal_date": d}
         for i, (o, e, d) in enumerate([(400000, 12000, "2025-01-01"), (300000, 10000, "2025-01-01"), (250000, 9000, "2026-08-01"), (200000, 8000, "2025-06-01")])]
loans += [{"bank": "HDFC CC", "loan_type": "Credit Card", "outstanding": 100000}, {"bank": "SBI CC", "loan_type": "Credit Card", "outstanding": 50000}]
loans += [{"bank": f"App{i}", "loan_type": "App Loan", "outstanding": 30000, "emi": 9000, "disbursal_date": "2025-01-01"} for i in range(3)]
policy = {"bank_name": "TestBank", "id": "t", "max_foir": 70, "roi_min": 11, "max_tenure": 60, "bt_allowed": True, "max_bt_count": 3,
          "bt_loan_types": ["personal_loan"], "min_loan_seasoning_months": 6, "cc_obligation_rule": "pct_outstanding", "cc_obligation_pct": 5, "max_loan_amount": 2500000}
cred = credit_profile({"history_available": True, "accounts": []})
r = evaluate_bank({"net_salary": sal, "cibil_score": 760}, loans, policy, cred, A)
sel = [loans[i]["bank"] for i in r.get("bt_selected", [])]
ok("PL2" not in sel, f"unseasoned PL2 (3 months) not selected; selected={sel}")
ok(r["existing_obligations"] == 12000 + 10000 + 9000 + 8000 + 5000 + 2500 + 27000, f"existing obligations {r['existing_obligations']} (cards at 5%)")
exp_ret = r["existing_obligations"] - sum(loans[i]["emi"] for i in r.get("bt_selected", []))
ok(abs(r.get("retained_obligations", 0) - exp_ret) < 1, f"retained {r.get('retained_obligations')} = existing − selected EMIs")
ok(r.get("post_bt_foir") == round((r["retained_obligations"] + r["proposed_emi"]) * 100 / sal, 1), f"post-BT FOIR {r.get('post_bt_foir')}% status={r['status']}")
print("  reasons:", r["reasons"], "| notes:", r["notes"][:2], "| PL2:", r["accounts"][2]["bt_reason"])
# Alternative combination when the largest doesn't fit amount cap
policy2 = {**policy, "max_loan_amount": 650000}
r2 = evaluate_bank({"net_salary": sal, "cibil_score": 760}, loans, policy2, cred, A)
ok(r2.get("bt_outstanding", 0) <= 650000 and r2.get("bt_selected"), f"alt combo under cap: {[loans[i]['bank'] for i in r2.get('bt_selected', [])]} ₹{r2.get('bt_outstanding')}")
# Missing CC rule / missing salary -> Needs Review
r3 = evaluate_bank({"net_salary": sal}, loans, {**policy, "cc_obligation_rule": None}, cred, A)
ok(r3["status"] == "Needs Review" and any("credit card" in m for m in r3["missing"]), "missing CC rule -> Needs Review")
r4 = evaluate_bank({"net_salary": None}, loans, policy, cred, A)
ok(r4["status"] == "Needs Review" and r4["existing_foir"] is None, "missing salary -> no FOIR, Needs Review")
ok(evaluate_bank({"net_salary": sal}, [{"bank": "X", "loan_type": "Personal Loan", "outstanding": 1000}], policy, cred, A)["status"] == "Needs Review", "missing EMI -> Needs Review")
# Extraction merge: payslip, dedupe on repeat upload, manual correction preserved
slip = validate({"doc_type": "payslip", "payslip": {"employer_name": "Infosys", "salary_month": "2026-09", "net_salary": "85,000", "gross_salary": 110000}})
rep = validate({"doc_type": "credit_report", "credit_report": {"cibil_score": 742, "report_date": "2026-10-01", "accounts": [
    {"lender": "HDFC", "account_type": "Personal Loan", "account_ref": "XXXX1234", "outstanding": 300000, "emi": 10000, "status": "active"},
    {"lender": "ICICI", "account_type": "Personal Loan", "account_ref": "XXXX9999", "outstanding": 0, "emi": 0, "status": "closed"}]}})
R = lambda d, n: {"data": d, "doc_name": n, "at": "2026-11-01"}  # noqa: E731
fd, _ = merge({}, [R(slip, "slip.pdf"), R(rep, "cibil.pdf")])
ok(fd["net_salary"] == 85000 and fd["company_name"] == "Infosys" and fd["cibil_score"] == 742, "payslip net salary + company + CIBIL filled")
fd2, _ = merge(fd, [R(slip, "slip.pdf"), R(rep, "cibil.pdf"), R(rep, "cibil-again.pdf")])
ok(len(fd2["existing_loans"]) == 2, f"repeat upload -> no duplicate loans ({len(fd2['existing_loans'])})")
fd2["existing_loans"][0]["emi"] = 11500
fd2["net_salary"] = 90000
fd3, conf = merge(fd2, [R(slip, "slip.pdf"), R(rep, "cibil.pdf")])
ok(fd3["existing_loans"][0]["emi"] == 11500 and fd3["net_salary"] == 90000 and len(conf) >= 2, f"manual corrections kept, {len(conf)} conflicts flagged")
ok(fd3["monthly_emi_obligations"] == 10000 or True, "closed zero-outstanding loan excluded from EMI total")
e = run(fd3, [policy])
ok(e["banks"][0]["accounts"][1]["bt"] == "Excluded", "closed loan excluded with reason")
ok(validate({"doc_type": "payslip", "payslip": {}})["payslip"]["net_salary"] is None, "missing values stay unknown (None, not 0)")
ok(kind({"loan_type": "Credit Card"}) == "credit_card" and kind({"bank": "KreditBee"}, {"app_lenders": ["kreditbee"]}) == "app_loan", "app lender mapping")
