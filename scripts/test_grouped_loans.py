import sys
sys.path.insert(0, "/app/backend")
from routes.chatbot_integration import _normalize_session, _build_loan_groups, _to_structured_loan, _normalize_loan

# Scenario A: NEW grouped chatbot payload (section 5 shape)
session_grouped = {
    "chatbot_status": "completed",
    "questions_completed": 6, "questions_total": 6,
    "customer": {"city": "Hyderabad", "company_name": "Neosales"},
    "answers": {"net_monthly_salary": 150000, "cibil_score": 760, "employment_type": "salaried"},
    "existing_loans": [
        {"loan_type": "Personal Loan", "number_of_loans": 5, "total_outstanding": 1200000, "total_emi": 42000},
        {"loan_type": "Home Loan", "number_of_loans": 1, "total_outstanding": 10000000, "total_emi": 70000},
        {"loan_type": "Car Loan", "number_of_loans": 2, "total_outstanding": 800000, "total_emi": 18000},
    ],
}
n = _normalize_session(session_grouped)
print("=== Scenario A: grouped ===")
print("city:", n["city"], "| company:", n["company_name"])
print("total_loans:", n["total_loans"], "total_outstanding:", n["total_outstanding"], "total_monthly_emi:", n["total_monthly_emi"])
print("total_monthly_obligations(EMI):", n["total_monthly_obligations"])
print("emi_to_salary_ratio:", n["emi_to_salary_ratio"])
print("groups:", [(g["label"], g["count"], g["total_outstanding"], g["total_emi"]) for g in n["loan_groups"]])
assert n["total_loans"] == 8, n["total_loans"]
assert n["total_outstanding"] == 12000000
assert n["total_monthly_emi"] == 130000
assert n["total_monthly_obligations"] == 130000
assert n["city"] == "Hyderabad"
assert len(n["loan_groups"]) == 3

# Scenario B: city == company (must not leak company into city)
session_leak = {"customer": {"city": "Neosales", "company_name": "Neosales"}, "existing_loans": []}
nb = _normalize_session(session_leak)
print("\n=== Scenario B: city==company guard ===")
print("city:", nb["city"], "company:", nb["company_name"])
assert nb["city"] is None

# Scenario C: individual loans derive groups + EMI total (not outstanding)
session_individual = {
    "answers": {"net_monthly_salary": 60000},
    "existing_loans": [
        {"lender": "KreditBee", "loan_type": "Personal Loan", "outstanding": 60000, "emi": 5000},
        {"lender": "HDFC", "loan_type": "Personal Loan", "outstanding": 300000, "emi": 12000},
    ],
}
nc = _normalize_session(session_individual)
print("\n=== Scenario C: individual -> grouped ===")
print("total_loans:", nc["total_loans"], "total_outstanding:", nc["total_outstanding"], "total_monthly_emi:", nc["total_monthly_emi"])
print("groups:", [(g["label"], g["count"], g["total_outstanding"], g["total_emi"]) for g in nc["loan_groups"]])
assert nc["total_monthly_emi"] == 17000
assert nc["total_outstanding"] == 360000
assert nc["total_loans"] == 2
assert len(nc["loan_groups"]) == 1  # both personal_loan -> one group, count 2

# Scenario D: credit report uploaded, loans skipped -> pending flag
session_cr = {
    "documents": [{"doc_id": "d1", "type": "credit_report", "name": "cibil.pdf", "status": "uploaded"}],
    "existing_loans": [],
}
nd = _normalize_session(session_cr)
print("\n=== Scenario D: credit uploaded, loans skipped ===")
print("credit_report_status:", nd["credit_report_status"], "pending:", nd["loans_pending_credit_report"])
assert nd["loans_pending_credit_report"] is True

# Scenario E: structured loan carries count
sl = _to_structured_loan(_normalize_loan({"loan_type": "Personal Loan", "number_of_loans": 5, "total_outstanding": 1200000, "total_emi": 42000}))
print("\n=== Scenario E: structured loan ===")
print(sl["loan_type"], "count:", sl["count"], "outstanding:", sl["outstanding"], "emi:", sl["emi"])
assert sl["count"] == 5
assert sl["loan_type"] == "personal_loan"

print("\nALL ASSERTIONS PASSED")
