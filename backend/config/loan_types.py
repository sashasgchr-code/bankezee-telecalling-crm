"""
Canonical loan-type catalog — SINGLE SOURCE OF TRUTH for BankEzee Connect.

Web (Connect + Meta) and Mobile (Connect + Meta) must all consume this list via
GET /api/config/loan-types so the dropdowns can never drift again. Values are the
stable identifiers stored on files; labels are display-only. The set is the union of
the old-CRM historical values (recovered from legacy_crm_data) and the current Connect
web catalog, so every existing file's saved type keeps rendering correctly.
"""

# category order is preserved for grouped dropdowns
CATEGORY_LABELS = {
    "personal": "Personal Loans",
    "home": "Home Loans",
    "vehicle": "Vehicle Loans",
    "business": "Business Loans",
    "other": "Other Loans",
}

# vehicle=True triggers the old-CRM vehicle workflow (profile analysis, pre-verification,
# vehicle document verification, etc.) on every surface.
LOAN_TYPES = [
    # Personal
    {"value": "new_personal_loan", "label": "New Personal Loan", "category": "personal", "vehicle": False},
    {"value": "balance_transfer_pl", "label": "Balance Transfer PL", "category": "personal", "vehicle": False},
    {"value": "top_up_pl", "label": "Top Up PL", "category": "personal", "vehicle": False},
    {"value": "balance_transfer_topup_pl", "label": "Balance Transfer + Top Up PL", "category": "personal", "vehicle": False},
    {"value": "merge_multiple_loans", "label": "Merge Multiple Loans", "category": "personal", "vehicle": False},
    # Home
    {"value": "new_home_loan", "label": "New Home Loan", "category": "home", "vehicle": False},
    {"value": "balance_transfer_hl", "label": "Balance Transfer HL", "category": "home", "vehicle": False},
    {"value": "top_up_hl", "label": "Top Up HL", "category": "home", "vehicle": False},
    {"value": "balance_transfer_topup_hl", "label": "Balance Transfer + Top Up HL", "category": "home", "vehicle": False},
    {"value": "reduce_home_loan_emi", "label": "Reduce Home Loan EMI", "category": "home", "vehicle": False},
    # Vehicle (old-CRM vehicle workflow applies)
    {"value": "new_vehicle_loan", "label": "New Vehicle Loan", "category": "vehicle", "vehicle": True},
    {"value": "used_vehicle_loan_fresh", "label": "Used Vehicle Loan (Fresh)", "category": "vehicle", "vehicle": True},
    {"value": "used_vehicle_loan_bt", "label": "Used Vehicle Loan BT", "category": "vehicle", "vehicle": True},
    # Business
    {"value": "business_loan", "label": "Business Loan", "category": "business", "vehicle": False},
    {"value": "msme_loan", "label": "MSME Loan", "category": "business", "vehicle": False},
    # Other
    {"value": "lap", "label": "LAP (Loan Against Property)", "category": "other", "vehicle": False},
    {"value": "gold_loan", "label": "Gold Loan", "category": "other", "vehicle": False},
    {"value": "education_loan", "label": "Education Loan", "category": "other", "vehicle": False},
    {"value": "other", "label": "Other", "category": "other", "vehicle": False},
]

VEHICLE_LOAN_VALUES = {t["value"] for t in LOAN_TYPES if t["vehicle"]}


def is_vehicle_loan(loan_type: str) -> bool:
    return (loan_type or "") in VEHICLE_LOAN_VALUES


def catalog() -> dict:
    return {
        "loan_types": LOAN_TYPES,
        "category_labels": CATEGORY_LABELS,
        "vehicle_loan_values": sorted(VEHICLE_LOAN_VALUES),
    }
