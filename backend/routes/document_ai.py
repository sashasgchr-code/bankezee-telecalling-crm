"""
Document AI Routes - AI-powered document parsing for eligibility
Parses CRIF, salary slips, bank statements to extract financial data
"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv
from pathlib import Path
import os
import uuid
from datetime import datetime, timezone
from typing import Optional, List
import logging
import base64
import httpx

from utils.auth import get_current_user

ROOT_DIR = Path(__file__).parent.parent
load_dotenv(ROOT_DIR / '.env')

logger = logging.getLogger(__name__)

mongo_url = os.environ.get('MONGO_URL')
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ.get('DB_NAME', 'bankezee_connect')]

router = APIRouter(prefix="/api/document-ai", tags=["Document AI"])


# Pydantic models
class DocumentParseRequest(BaseModel):
    document_index: int
    document_type: str  # crif, salary_slip, bank_statement, form16


class AutoFillRequest(BaseModel):
    parsed_data: dict
    document_type: str


# ============ DOCUMENT PARSING ============

@router.post("/parse-document/{lead_id}")
async def parse_document(lead_id: str, request: DocumentParseRequest, current_user: dict = Depends(get_current_user)):
    """
    Parse a document using AI to extract financial data
    Supports: CRIF reports, salary slips, bank statements, Form 16
    """
    # Get lead and documents
    lead = await db.leads.find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    
    documents = lead.get("documents", [])
    if request.document_index >= len(documents):
        raise HTTPException(status_code=400, detail="Invalid document index")
    
    doc = documents[request.document_index]
    doc_url = doc.get("url") or doc.get("file_url")
    
    if not doc_url:
        raise HTTPException(status_code=400, detail="Document URL not available")
    
    # Get AI extraction prompts based on document type
    extraction_prompt = get_extraction_prompt(request.document_type)
    
    # For now, return a structured placeholder
    # In production, this would call an LLM (GPT-4 Vision, Gemini) to extract data
    parsed_data = await extract_document_data(doc_url, request.document_type, extraction_prompt)
    
    return {
        "success": True,
        "document_type": request.document_type,
        "parsed_data": parsed_data,
        "extracted_at": datetime.now(timezone.utc).isoformat(),
        "extracted_by": current_user.get("name", "System")
    }


@router.post("/auto-parse-all/{lead_id}")
async def auto_parse_all_documents(lead_id: str, current_user: dict = Depends(get_current_user)):
    """
    Automatically parse all uploaded documents for a lead
    Identifies document types and extracts relevant data
    """
    lead = await db.leads.find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    
    documents = lead.get("documents", [])
    if not documents:
        return {
            "success": True,
            "message": "No documents to parse",
            "parsed": [],
            "fields_updated": []
        }
    
    parsed_results = []
    fields_updated = []
    file_details = lead.get("file_details") or {}
    
    for i, doc in enumerate(documents):
        doc_type = doc.get("document_type") or detect_document_type(doc.get("original_name", ""))
        
        if doc_type in ["crif", "salary_slip", "bank_statement"]:
            try:
                doc_url = doc.get("url") or doc.get("file_url")
                if not doc_url:
                    continue
                
                extraction_prompt = get_extraction_prompt(doc_type)
                parsed_data = await extract_document_data(doc_url, doc_type, extraction_prompt)
                
                if parsed_data and not parsed_data.get("error"):
                    parsed_results.append({
                        "document_index": i,
                        "document_type": doc_type,
                        "parsed_data": parsed_data
                    })
                    
                    # Auto-fill fields
                    updated_fields = apply_parsed_data_to_lead(file_details, parsed_data, doc_type)
                    fields_updated.extend(updated_fields)
                    
            except Exception as e:
                logger.error(f"Error parsing document {i}: {str(e)}")
                continue
    
    # Update lead with extracted data if we found anything
    if fields_updated:
        await db.leads.update_one(
            {"id": lead_id},
            {
                "$set": {
                    "file_details": file_details,
                    "updated_at": datetime.now(timezone.utc)
                },
                "$push": {
                    "file_activities": {
                        "type": "document_ai",
                        "message": f"AI parsed {len(parsed_results)} document(s), updated {len(fields_updated)} fields",
                        "by": current_user.get("id"),
                        "by_name": current_user.get("name", "System"),
                        "timestamp": datetime.now(timezone.utc).isoformat()
                    }
                }
            }
        )
    
    return {
        "success": True,
        "parsed": parsed_results,
        "fields_updated": list(set(fields_updated))  # Dedupe
    }


@router.post("/auto-fill-from-parse/{lead_id}")
async def auto_fill_from_parse(lead_id: str, request: AutoFillRequest, current_user: dict = Depends(get_current_user)):
    """
    Apply parsed document data to lead fields
    """
    lead = await db.leads.find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    
    file_details = lead.get("file_details") or {}
    
    # Apply parsed data based on document type
    updated_fields = apply_parsed_data_to_lead(file_details, request.parsed_data, request.document_type)
    
    if updated_fields:
        await db.leads.update_one(
            {"id": lead_id},
            {
                "$set": {
                    "file_details": file_details,
                    "updated_at": datetime.now(timezone.utc)
                },
                "$push": {
                    "file_activities": {
                        "type": "document_ai_fill",
                        "message": f"Auto-filled {len(updated_fields)} fields from {request.document_type}",
                        "by": current_user.get("id"),
                        "by_name": current_user.get("name", "System"),
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                        "details": {"fields": updated_fields}
                    }
                }
            }
        )
    
    return {
        "success": True,
        "fields_updated": updated_fields
    }


# ============ HELPER FUNCTIONS ============

def detect_document_type(filename: str) -> str:
    """Detect document type from filename"""
    filename_lower = filename.lower()
    
    if any(x in filename_lower for x in ["crif", "cibil", "credit", "bureau"]):
        return "crif"
    elif any(x in filename_lower for x in ["salary", "payslip", "pay_slip", "wage"]):
        return "salary_slip"
    elif any(x in filename_lower for x in ["bank", "statement", "stmt"]):
        return "bank_statement"
    elif any(x in filename_lower for x in ["form16", "form 16", "tax"]):
        return "form16"
    elif any(x in filename_lower for x in ["pan"]):
        return "pan_card"
    elif any(x in filename_lower for x in ["aadhar", "aadhaar"]):
        return "aadhar"
    
    return "general"


def get_extraction_prompt(doc_type: str) -> str:
    """Get AI extraction prompt for document type"""
    prompts = {
        "crif": """Extract the following from this CRIF/Credit Bureau report:
- Credit Score (3 digit number)
- Total Active Accounts
- Total Outstanding Balance
- Total Monthly EMI payments
- Credit Card Total Balance
- Credit Card Limit
- Credit Utilization Percentage
- Number of Defaults/DPD 90+
- Number of Write-offs
- List of Active Loans (lender, type, balance, EMI)
- Key observations about credit health""",
        
        "salary_slip": """Extract from this salary slip:
- Employee Name
- Employer Name
- Month/Year
- Gross Salary
- Net Salary (take-home)
- Basic Salary
- HRA
- Total Deductions
- PF Deduction
- Professional Tax""",
        
        "bank_statement": """Extract from this bank statement:
- Account Holder Name
- Bank Name
- Account Number (last 4 digits)
- Statement Period
- Average Monthly Balance
- Identified Salary Credit Amount
- Total EMI Debits identified
- Number of Bounced Transactions
- Key observations about banking behavior""",
        
        "form16": """Extract from this Form 16:
- Employee Name
- Employer Name
- PAN Number
- Assessment Year
- Gross Salary
- Total Deductions under Chapter VI-A
- Net Taxable Income
- Total Tax Paid"""
    }
    
    return prompts.get(doc_type, "Extract all relevant financial information from this document.")


async def extract_document_data(doc_url: str, doc_type: str, prompt: str) -> dict:
    """
    Extract data from document using AI
    This is a placeholder - in production would use GPT-4V or similar
    """
    # For now, return structured placeholder data
    # In a real implementation, this would:
    # 1. Download the document
    # 2. Convert to image if PDF
    # 3. Send to vision LLM for extraction
    # 4. Parse and validate the response
    
    if doc_type == "crif":
        return {
            "credit_score": None,
            "active_accounts": None,
            "total_outstanding_balance": None,
            "total_monthly_emi": None,
            "credit_card_total_balance": None,
            "credit_card_limit": None,
            "credit_utilization_pct": None,
            "defaults_count": None,
            "writeoffs_count": None,
            "active_loans": [],
            "cibil_issues_summary": None,
            "key_observations": "AI document parsing not configured. Please manually enter CRIF data.",
            "error": "AI_NOT_CONFIGURED"
        }
    
    elif doc_type == "salary_slip":
        return {
            "employee_name": None,
            "employer_name": None,
            "month_year": None,
            "gross_salary": None,
            "net_salary": None,
            "basic_salary": None,
            "hra": None,
            "total_deductions": None,
            "pf_deduction": None,
            "professional_tax": None,
            "error": "AI_NOT_CONFIGURED"
        }
    
    elif doc_type == "bank_statement":
        return {
            "account_holder": None,
            "bank_name": None,
            "account_last_4": None,
            "statement_period": None,
            "average_monthly_balance": None,
            "identified_salary_credit": None,
            "total_identified_emi": None,
            "bounce_count": None,
            "key_observations": None,
            "error": "AI_NOT_CONFIGURED"
        }
    
    return {"error": "Unsupported document type"}


def apply_parsed_data_to_lead(file_details: dict, parsed_data: dict, doc_type: str) -> List[str]:
    """Apply parsed data to file_details and return list of updated field names"""
    updated = []
    
    if parsed_data.get("error"):
        return updated
    
    if doc_type == "crif":
        if parsed_data.get("credit_score") and not file_details.get("cibil_score"):
            file_details["cibil_score"] = parsed_data["credit_score"]
            updated.append("cibil_score")
        
        if parsed_data.get("total_monthly_emi") and not file_details.get("obligations_emi"):
            file_details["obligations_emi"] = parsed_data["total_monthly_emi"]
            updated.append("obligations_emi")
        
        if parsed_data.get("cibil_issues_summary"):
            file_details["cibil_issues"] = parsed_data["cibil_issues_summary"]
            updated.append("cibil_issues")
        
        if parsed_data.get("active_loans"):
            file_details["crif_active_loans"] = parsed_data["active_loans"]
            updated.append("crif_active_loans")
    
    elif doc_type == "salary_slip":
        if parsed_data.get("net_salary") and not file_details.get("net_salary"):
            file_details["net_salary"] = parsed_data["net_salary"]
            updated.append("net_salary")
        
        if parsed_data.get("gross_salary") and not file_details.get("gross_salary"):
            file_details["gross_salary"] = parsed_data["gross_salary"]
            updated.append("gross_salary")
        
        if parsed_data.get("employer_name") and not file_details.get("company_name"):
            file_details["company_name"] = parsed_data["employer_name"]
            updated.append("company_name")
    
    elif doc_type == "bank_statement":
        if parsed_data.get("identified_salary_credit") and not file_details.get("net_salary"):
            file_details["net_salary"] = parsed_data["identified_salary_credit"]
            file_details["salary_source"] = "bank_statement"
            updated.append("net_salary")
        
        if parsed_data.get("total_identified_emi") and not file_details.get("obligations_emi"):
            file_details["obligations_emi"] = parsed_data["total_identified_emi"]
            file_details["emi_source"] = "bank_statement"
            updated.append("obligations_emi")
        
        if parsed_data.get("bounce_count"):
            file_details["bounce_count"] = parsed_data["bounce_count"]
            updated.append("bounce_count")
    
    return updated
