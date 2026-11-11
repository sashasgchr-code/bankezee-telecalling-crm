"""Seed a preview Meta file mirroring Swamy Naidu's production extraction (values from the production RCA) — no LLM calls."""
import asyncio
import sys
from datetime import datetime, timezone
sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv  # noqa: E402
load_dotenv("/app/backend/.env")
from utils.database import db  # noqa: E402
from routes.doc_extract import validate  # noqa: E402

LID = "lead_swamytest01"
now = datetime.now(timezone.utc).isoformat()
slips = [("2026-07", 114278, 101210, "15.50.25"), ("2026-08", 9528, 7718, "15.54.29"), ("2026-09", 114628, 100309, "15.49.39"), ("2026-10", 113228, 98845, "15.49.00")]
accts = [
    {"lender": "AXIO", "account_type": "Consumer Loan", "account_ref": "XXXX9367", "sanctioned_amount": 6000, "outstanding": 6000, "status": "active", "page": 4},
    {"lender": "FDPLFINPL", "account_type": "Personal Loan", "account_ref": "XXXX6224", "sanctioned_amount": 8000, "outstanding": 8000, "status": "active", "page": 4},
    {"lender": "EARLYSALARY", "account_type": "Personal Loan", "account_ref": "XXXX4469", "sanctioned_amount": 25200, "outstanding": 19300, "status": "active", "page": 5,
     "dpd_months": ["2026-03", "2026-04"], "open_date": "2025-09-10"},
    {"lender": "KISETSU", "account_type": "Personal Loan", "account_ref": "XXXX7781", "sanctioned_amount": 400000, "outstanding": 310000, "emi": 21777, "status": "active", "page": 5,
     "disbursal_date": "2025-02-15", "dpd_months": ["2026-05"]},
    {"lender": "KOTAK", "account_type": "Personal Loan", "account_ref": "XXXX3321", "sanctioned_amount": 500000, "outstanding": 402000, "emi": 12074, "status": "active", "page": 6, "disbursal_date": "2024-11-01"},
    {"lender": "BAJAJHOUSE", "account_type": "Housing Loan", "account_ref": "XXXX1010", "sanctioned_amount": 2800000, "outstanding": 2566354, "emi": 24478, "status": "active", "page": 6, "disbursal_date": "2023-06-01"},
    {"lender": "HDFC BANK", "account_type": "Credit Card", "account_ref": "XXXX5555", "credit_limit": 150000, "outstanding": 62000, "status": "active", "page": 7},
    {"lender": "SOUTH INDIAN BK", "account_type": "Personal Loan", "account_ref": "XXXX0909", "sanctioned_amount": 100000, "outstanding": 0, "status": "closed", "page": 8},
]
cr = validate({"doc_type": "credit_report", "customer_name": "SURLA SWAMINAIDU", "credit_report": {"bureau": "CIBIL", "report_date": "2026-10-22", "cibil_score": 766, "score_page": 1,
               "history_period": "11 years 4 months", "accounts": accts,
               "enquiries": [{"date": f"2026-09-{d:02d}", "lender": f"L{d}"} for d in (2, 5, 9)]}})


async def main():
    await db.meta_leads.delete_many({"lead_id": LID})
    await db.doc_extractions.delete_many({"ref_id": LID})
    await db.doc_extraction_state.delete_many({"ref_id": LID})
    docs = [{"doc_id": "d_cibil", "filename": "c423d887_22102026_en0_paid_unlocked.pdf", "content_type": "application/pdf"}]
    docs += [{"doc_id": f"d_slip{i}", "filename": f"WhatsApp Image 2026-11-03 at {s[3]}.jpeg", "content_type": "image/jpeg"} for i, s in enumerate(slips)]
    docs += [{"doc_id": "d_f16", "filename": "Form 16_TUV_SWAM8104.PDF", "content_type": "application/pdf"}]
    await db.meta_leads.insert_one({"lead_id": LID, "full_name": "Swamy Naidu", "phone": "919999900001", "status": "File Created", "created_at": now, "documents": docs,
                                    "file": {"employment_type": "salaried", "loan_type": "Personal Loan", "loan_amount": 800000, "cibil_issues": "minor_issues",
                                             "existing_loans": [{"bank": "Kotak Mahindra Bank", "loan_type": "Personal Loan", "outstanding": 400000, "emi": 12000}]}})
    recs = [{"doc_id": "d_cibil", "doc_name": docs[0]["filename"], "status": "Extracted", "data": cr, "doc_type": "credit_report"}]
    for i, (m, g, n, _) in enumerate(slips):
        recs.append({"doc_id": f"d_slip{i}", "doc_name": docs[i + 1]["filename"], "status": "Extracted", "doc_type": "payslip",
                     "data": validate({"doc_type": "payslip", "customer_name": "S SWAMINAIDU", "payslip": {"employer_name": "TUV INDIA PRIVATE LIMITED", "salary_month": m, "gross_salary": g, "net_salary": n}})})
    recs.append({"doc_id": "d_f16", "doc_name": "Form 16_TUV_SWAM8104.PDF", "status": "Failed", "message": "Extraction failed: ChatError. Use Reprocess.", "data": None})
    for r in recs:
        await db.doc_extractions.insert_one({**r, "scope": "meta", "ref_id": LID, "at": now})
    print("seeded", LID)

asyncio.run(main())
