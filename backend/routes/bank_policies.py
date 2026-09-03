"""
Bank Policies Routes - OLD CRM Parity
Comprehensive bank policy management and eligibility checking
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

from utils.auth import get_current_user, require_admin

ROOT_DIR = Path(__file__).parent.parent
load_dotenv(ROOT_DIR / '.env')

logger = logging.getLogger(__name__)

mongo_url = os.environ.get('MONGO_URL')
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ.get('DB_NAME', 'bankezee_connect')]

router = APIRouter(prefix="/api/bank-policies", tags=["Bank Policies"])


# Pydantic models
class BankPolicyCreate(BaseModel):
    bank_name: str
    is_active: bool = True
    applicable_profiles: List[str] = ["salaried"]
    loan_types: List[str] = ["personal_loan"]
    min_salary: Optional[float] = None
    max_salary: Optional[float] = None
    min_cibil: Optional[int] = None
    min_age: int = 21
    max_age: int = 60
    min_loan_amount: Optional[float] = None
    max_loan_amount: Optional[float] = None
    min_tenure: Optional[int] = None
    max_tenure: Optional[int] = None
    roi_min: Optional[float] = None
    roi_max: Optional[float] = None
    max_foir: Optional[float] = None
    company_categories: List[str] = []
    min_present_employment_months: Optional[int] = None
    min_total_employment_months: Optional[int] = None
    bachelor_accommodation: Optional[bool] = None
    hostel_accommodation: Optional[bool] = None
    bt_allowed: bool = False
    max_bt_count: Optional[int] = None
    app_loan_bt: bool = False
    cc_bt_allowed: bool = False
    topup_allowed: bool = False
    merge_consolidation: bool = False
    min_loan_seasoning_months: Optional[int] = None
    processing_fee: Optional[str] = None
    special_notes: Optional[str] = None
    special_features: Optional[str] = None
    required_documents: List[str] = []
    serviceable_locations: List[str] = []
    # Text fields for display (from OLD CRM)
    salary_text: Optional[str] = None
    cibil_text: Optional[str] = None
    foir_text: Optional[str] = None
    roi_text: Optional[str] = None
    loan_amount_text: Optional[str] = None
    tenure_text: Optional[str] = None
    bt_text: Optional[str] = None
    topup_text: Optional[str] = None
    eligible_employees: Optional[str] = None


# ============ POLICY CRUD ============

@router.get("/policies")
async def get_policies(
    loan_type: Optional[str] = None,
    bank_name: Optional[str] = None,
    is_active: Optional[bool] = True,
    current_user: dict = Depends(get_current_user)
):
    """Get all bank policies with optional filtering"""
    query = {}
    if loan_type:
        query["loan_types"] = loan_type
    if bank_name:
        query["bank_name"] = {"$regex": bank_name, "$options": "i"}
    if is_active is not None:
        query["is_active"] = is_active
    
    policies = await db.bank_policies.find(query, {"_id": 0}).sort("bank_name", 1).to_list(200)
    return policies


@router.get("/policies/{policy_id}")
async def get_policy(policy_id: str, current_user: dict = Depends(get_current_user)):
    """Get a single policy by ID"""
    policy = await db.bank_policies.find_one({"id": policy_id}, {"_id": 0})
    if not policy:
        raise HTTPException(status_code=404, detail="Policy not found")
    return policy


@router.post("/policies")
async def create_policy(policy: BankPolicyCreate, current_user: dict = Depends(require_admin)):
    """Create a new bank policy"""
    policy_dict = policy.dict()
    policy_dict["id"] = str(uuid.uuid4())
    policy_dict["created_at"] = datetime.now(timezone.utc).isoformat()
    policy_dict["updated_at"] = datetime.now(timezone.utc).isoformat()
    policy_dict["created_by"] = current_user.get("id")
    policy_dict["updated_by"] = current_user.get("name", "Admin")
    
    await db.bank_policies.insert_one(policy_dict)
    policy_dict.pop("_id", None)
    return policy_dict


@router.put("/policies/{policy_id}")
async def update_policy(policy_id: str, policy_data: dict, current_user: dict = Depends(require_admin)):
    """Update an existing bank policy"""
    existing = await db.bank_policies.find_one({"id": policy_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Policy not found")
    
    policy_data["updated_at"] = datetime.now(timezone.utc).isoformat()
    policy_data["updated_by"] = current_user.get("name", "Admin")
    policy_data.pop("id", None)
    policy_data.pop("_id", None)
    
    await db.bank_policies.update_one({"id": policy_id}, {"$set": policy_data})
    
    updated = await db.bank_policies.find_one({"id": policy_id}, {"_id": 0})
    return updated


@router.delete("/policies/{policy_id}")
async def delete_policy(policy_id: str, current_user: dict = Depends(require_admin)):
    """Delete a bank policy"""
    result = await db.bank_policies.delete_one({"id": policy_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Policy not found")
    return {"message": "Policy deleted successfully"}


# ============ ADVANCED ELIGIBILITY CHECK - OLD CRM PARITY ============

def calculate_profile_strength(cibil, foir, net_salary, loan_amount):
    """Calculate profile strength based on customer data"""
    score = 0
    
    # CIBIL contribution (0-40 points)
    if cibil:
        if cibil >= 750:
            score += 40
        elif cibil >= 700:
            score += 30
        elif cibil >= 650:
            score += 20
        elif cibil >= 600:
            score += 10
    
    # FOIR contribution (0-30 points)
    if foir is not None:
        if foir <= 40:
            score += 30
        elif foir <= 50:
            score += 25
        elif foir <= 60:
            score += 15
        elif foir <= 70:
            score += 5
    
    # Salary vs Loan ratio (0-30 points)
    if net_salary and loan_amount and net_salary > 0:
        ratio = loan_amount / (net_salary * 60)  # 5 year tenure
        if ratio <= 0.5:
            score += 30
        elif ratio <= 0.75:
            score += 20
        elif ratio <= 1.0:
            score += 10
    
    # Determine strength label
    if score >= 70:
        return "Strong"
    elif score >= 50:
        return "Moderate"
    elif score >= 30:
        return "Fair"
    elif score >= 10:
        return "Weak"
    return "Not Eligible"


def calculate_foir(net_salary, existing_emi):
    """Calculate FOIR percentage"""
    if not net_salary or net_salary <= 0:
        return None
    emi = existing_emi or 0
    return round((emi / net_salary) * 100, 1)


@router.post("/check-eligibility/{lead_id}")
async def check_eligibility(lead_id: str, current_user: dict = Depends(get_current_user)):
    """
    Advanced eligibility check against all bank policies - OLD CRM PARITY
    Returns detailed analysis with pass/fail reasons per criterion
    """
    # Get lead/file data
    lead = await db.leads.find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead/File not found")
    
    file_details = lead.get("file_details") or lead.get("additional_data") or {}
    
    # Extract customer profile data
    full_name = file_details.get("full_name") or lead.get("full_name") or lead.get("name", "")
    requirement = file_details.get("type_of_loan") or lead.get("requirement", "Personal Loan")
    
    # Parse numeric values safely
    def safe_float(val, default=None):
        try:
            return float(val) if val else default
        except (ValueError, TypeError):
            return default
    
    def safe_int(val, default=None):
        try:
            return int(val) if val else default
        except (ValueError, TypeError):
            return default
    
    cibil_score = safe_int(file_details.get("cibil_score"))
    net_salary = safe_float(file_details.get("net_salary"))
    gross_salary = safe_float(file_details.get("gross_salary"))
    existing_emi = safe_float(file_details.get("obligations_emi") or file_details.get("existing_emi"))
    loan_amount_required = safe_float(file_details.get("loan_amount_required"))
    
    # Calculate FOIR
    foir = calculate_foir(net_salary, existing_emi) if net_salary else None
    
    # Age calculation
    age = None
    dob = file_details.get("date_of_birth") or file_details.get("dob")
    if dob:
        try:
            from datetime import date
            birth = datetime.strptime(str(dob)[:10], "%Y-%m-%d").date()
            today = date.today()
            age = today.year - birth.year - ((today.month, today.day) < (birth.month, birth.day))
        except (ValueError, TypeError, AttributeError):
            pass
    
    employment_type = (file_details.get("employment_type") or lead.get("employment_type") or "salaried").lower()
    company_type = file_details.get("company_type") or file_details.get("company_category") or ""
    company_name = file_details.get("company_name") or ""
    
    present_emp_months = safe_int(file_details.get("present_employment_months"))
    total_emp_months = safe_int(file_details.get("total_employment_months"))
    
    accommodation = file_details.get("accommodation_type") or file_details.get("residence_type") or ""
    is_bachelor = "bachelor" in accommodation.lower() if accommodation else False
    is_hostel = "hostel" in accommodation.lower() if accommodation else False
    
    # Get all active policies
    policies = await db.bank_policies.find({"is_active": True}, {"_id": 0}).to_list(200)
    
    # Determine profile strength
    profile_strength = calculate_profile_strength(cibil_score, foir, net_salary, loan_amount_required)
    
    # Missing info tracking
    missing_info = []
    if not cibil_score:
        missing_info.append("CIBIL Score")
    if not net_salary:
        missing_info.append("Net Salary")
    if not loan_amount_required:
        missing_info.append("Loan Amount Required")
    if foir is None and net_salary:
        missing_info.append("Existing EMI/Obligations")
    if not age:
        missing_info.append("Date of Birth")
    if not present_emp_months:
        missing_info.append("Present Employment Duration")
    if not company_type:
        missing_info.append("Company Type/Category")
    
    # EMI source tracking
    emi_source = "CRM Data" if existing_emi else "Not Available"
    
    # Check eligibility against each policy
    results = []
    
    for policy in policies:
        bank_name = policy.get("bank_name", "Unknown Bank")
        reasons_pass = []
        reasons_fail = []
        reasons_warning = []
        
        # Helper to add rule check
        def check_rule(rule_name, customer_val, required_val, condition, pass_msg, fail_msg, source="Policy"):
            if condition is None:
                return True  # Skip if no data
            if condition:
                reasons_pass.append({
                    "rule": rule_name,
                    "customer": str(customer_val) if customer_val else "N/A",
                    "required": str(required_val) if required_val else "N/A",
                    "result": "PASS",
                    "source": source
                })
                return True
            else:
                reasons_fail.append({
                    "rule": rule_name,
                    "customer": str(customer_val) if customer_val else "N/A",
                    "required": str(required_val) if required_val else "N/A",
                    "result": "FAIL",
                    "source": source
                })
                return False
        
        is_eligible = True
        
        # 1. Profile Type Check
        applicable = policy.get("applicable_profiles", ["salaried"])
        if isinstance(applicable, str):
            applicable = [applicable]
        if applicable and "both" not in applicable:
            profile_match = employment_type in [p.lower() for p in applicable]
            if not profile_match and employment_type not in ["salaried", "self_employed"]:
                profile_match = "salaried" in [p.lower() for p in applicable]  # Default to salaried
            if not check_rule("Profile Type", employment_type.title(), ", ".join(applicable), profile_match, 
                             f"{employment_type.title()} accepted", f"Only {', '.join(applicable)} accepted"):
                is_eligible = False
        
        # 2. CIBIL Check
        min_cibil = policy.get("min_cibil")
        if min_cibil and cibil_score:
            if not check_rule("CIBIL Score", cibil_score, f"Min {min_cibil}", cibil_score >= min_cibil,
                             "CIBIL meets requirement", f"CIBIL {cibil_score} below min {min_cibil}"):
                is_eligible = False
        elif min_cibil and not cibil_score:
            reasons_warning.append({
                "rule": "CIBIL Score",
                "customer": "Not available",
                "required": f"Min {min_cibil}",
                "result": "WARN",
                "source": "Missing Data"
            })
        
        # 3. Salary Check
        min_salary = policy.get("min_salary")
        if min_salary and net_salary:
            if not check_rule("Net Salary", f"₹{net_salary:,.0f}", f"Min ₹{min_salary:,.0f}", 
                             net_salary >= min_salary, "Salary meets requirement", 
                             f"Salary ₹{net_salary:,.0f} below min ₹{min_salary:,.0f}"):
                is_eligible = False
        elif min_salary and not net_salary:
            reasons_warning.append({
                "rule": "Net Salary",
                "customer": "Not available",
                "required": f"Min ₹{min_salary:,.0f}",
                "result": "WARN",
                "source": "Missing Data"
            })
        
        # 4. FOIR Check
        max_foir = policy.get("max_foir")
        if max_foir and foir is not None:
            if not check_rule("FOIR", f"{foir}%", f"Max {max_foir}%", foir <= max_foir,
                             "FOIR within limit", f"FOIR {foir}% exceeds max {max_foir}%"):
                is_eligible = False
        
        # 5. Age Check
        min_age = policy.get("min_age", 21)
        max_age = policy.get("max_age", 60)
        if age:
            age_ok = (age >= min_age) and (age <= max_age)
            if not check_rule("Age", age, f"{min_age}-{max_age} years", age_ok,
                             "Age within range", f"Age {age} not in range {min_age}-{max_age}"):
                is_eligible = False
        
        # 6. Employment Duration
        min_present = policy.get("min_present_employment_months")
        if min_present and present_emp_months:
            if not check_rule("Present Employment", f"{present_emp_months} months", f"Min {min_present} months",
                             present_emp_months >= min_present, "Employment duration OK",
                             f"Present emp {present_emp_months}m < min {min_present}m"):
                is_eligible = False
        
        min_total = policy.get("min_total_employment_months")
        if min_total and total_emp_months:
            if not check_rule("Total Employment", f"{total_emp_months} months", f"Min {min_total} months",
                             total_emp_months >= min_total, "Total employment OK",
                             f"Total emp {total_emp_months}m < min {min_total}m"):
                is_eligible = False
        
        # 7. Company Category
        company_categories = policy.get("company_categories", [])
        if company_categories and company_type:
            cat_lower = [c.lower() for c in company_categories]
            if "all" not in cat_lower:
                company_ok = company_type.lower() in cat_lower
                if not check_rule("Company Type", company_type, ", ".join(company_categories), company_ok,
                                 "Company type accepted", f"Company '{company_type}' not in allowed list"):
                    is_eligible = False
        
        # 8. Loan Amount Check
        min_loan = policy.get("min_loan_amount")
        max_loan = policy.get("max_loan_amount")
        if loan_amount_required:
            if min_loan and loan_amount_required < min_loan:
                if not check_rule("Loan Amount", f"₹{loan_amount_required:,.0f}", f"Min ₹{min_loan:,.0f}",
                                 False, "", f"Loan ₹{loan_amount_required:,.0f} below min ₹{min_loan:,.0f}"):
                    is_eligible = False
            elif max_loan and loan_amount_required > max_loan:
                reasons_warning.append({
                    "rule": "Loan Amount",
                    "customer": f"₹{loan_amount_required:,.0f}",
                    "required": f"Max ₹{max_loan:,.0f}",
                    "result": "WARN",
                    "source": "May be capped"
                })
        
        # 9. Accommodation (Bachelor/Hostel)
        if is_bachelor and policy.get("bachelor_accommodation") is False:
            if not check_rule("Bachelor Accommodation", "Bachelor", "Not Allowed", False,
                             "", "Bachelor accommodation not allowed"):
                is_eligible = False
        if is_hostel and policy.get("hostel_accommodation") is False:
            if not check_rule("Hostel Accommodation", "Hostel", "Not Allowed", False,
                             "", "Hostel accommodation not allowed"):
                is_eligible = False
        
        # Calculate eligible amount
        eligible_amount = None
        if is_eligible and net_salary and net_salary > 0:
            available_foir = (max_foir or 60) - (foir or 0)
            if available_foir > 0:
                monthly_capacity = net_salary * (available_foir / 100)
                # Estimate: multiplier based on 12% ROI and max tenure
                max_tenure = policy.get("max_tenure", 60)
                multiplier = max_tenure * 0.75  # Rough EMI-to-principal conversion
                eligible_amount = min(
                    monthly_capacity * multiplier,
                    max_loan or 50000000,
                    loan_amount_required or 50000000
                )
                eligible_amount = round(eligible_amount, -3)  # Round to nearest 1000
        
        # Determine eligibility status
        if is_eligible and len(reasons_fail) == 0:
            eligibility = "eligible"
            confidence = "high" if len(reasons_warning) == 0 else "medium"
        elif len(reasons_fail) <= 1 and len(reasons_warning) > 0:
            eligibility = "possibly_eligible"
            confidence = "medium" if len(reasons_fail) == 0 else "low"
        else:
            eligibility = "not_eligible"
            confidence = "low"
        
        # Estimated EMI
        estimated_emi = None
        if eligible_amount and eligible_amount > 0:
            roi = (policy.get("roi_min") or 12) / 100 / 12
            tenure = policy.get("max_tenure", 60)
            if roi > 0:
                estimated_emi = eligible_amount * roi * ((1 + roi) ** tenure) / (((1 + roi) ** tenure) - 1)
                estimated_emi = round(estimated_emi)
        
        # Build result
        result = {
            "policy_id": policy.get("id"),
            "bank_name": bank_name,
            "eligibility": eligibility,
            "confidence": confidence,
            "eligible_amount": eligible_amount,
            "estimated_emi": estimated_emi,
            "reasons_pass": reasons_pass,
            "reasons_fail": reasons_fail,
            "reasons_warning": reasons_warning,
            # Policy display fields
            "salary_text": policy.get("salary_text") or (f"₹{policy.get('min_salary'):,.0f}+" if policy.get("min_salary") else None),
            "cibil_text": policy.get("cibil_text") or (f"{policy.get('min_cibil')}+" if policy.get("min_cibil") else None),
            "foir_text": policy.get("foir_text") or (f"Max {policy.get('max_foir')}%" if policy.get("max_foir") else None),
            "roi_range": policy.get("roi_text") or (f"{policy.get('roi_min')}-{policy.get('roi_max')}%" if policy.get("roi_min") else None),
            "tenure_text": policy.get("tenure_text") or (f"Up to {policy.get('max_tenure')} months" if policy.get("max_tenure") else None),
            "loan_amount_text": policy.get("loan_amount_text"),
            "age_text": f"{policy.get('min_age', 21)}-{policy.get('max_age', 60)} years",
            "present_employment_text": f"Min {policy.get('min_present_employment_months')} months" if policy.get("min_present_employment_months") else None,
            "total_employment_text": f"Min {policy.get('min_total_employment_months')} months" if policy.get("min_total_employment_months") else None,
            "company_requirement_text": ", ".join(policy.get("company_categories", [])) if policy.get("company_categories") else "All",
            "eligible_employees": policy.get("eligible_employees"),
            "applicable_profiles": policy.get("applicable_profiles"),
            # BT/Topup info
            "bt_info": {
                "bt_allowed": policy.get("bt_allowed", False),
                "bt_text": policy.get("bt_text") or ("Yes" if policy.get("bt_allowed") else "No"),
                "max_bt_count": policy.get("max_bt_count"),
                "bt_app_loans_text": "Yes" if policy.get("app_loan_bt") else "No",
                "cc_bt_allowed": policy.get("cc_bt_allowed", False),
                "topup_allowed": policy.get("topup_allowed", False),
                "topup_text": policy.get("topup_text") or ("Yes" if policy.get("topup_allowed") else "No"),
            },
            "bachelor_accommodation": policy.get("bachelor_accommodation"),
            "hostel_accommodation": policy.get("hostel_accommodation"),
            "special_features": policy.get("special_features"),
            "special_notes": policy.get("special_notes"),
            "processing_fee": policy.get("processing_fee"),
            "required_documents": policy.get("required_documents", []),
        }
        
        results.append(result)
    
    # Sort: eligible first, then by eligible amount
    results.sort(key=lambda x: (
        0 if x["eligibility"] == "eligible" else (1 if x["eligibility"] == "possibly_eligible" else 2),
        -(x.get("eligible_amount") or 0)
    ))
    
    # Add rank to top results
    for i, r in enumerate(results):
        if r["eligibility"] in ["eligible", "possibly_eligible"] and i < 10:
            r["rank"] = i + 1
    
    # Get historical data for banks
    for result in results[:20]:  # Top 20 only for performance
        bank_name = result["bank_name"]
        hist_data = await get_bank_historical_data(bank_name, cibil_score, net_salary, company_type)
        result["historical"] = hist_data
    
    # Count by status
    eligible_count = sum(1 for r in results if r["eligibility"] == "eligible")
    possibly_count = sum(1 for r in results if r["eligibility"] == "possibly_eligible")
    not_eligible_count = sum(1 for r in results if r["eligibility"] == "not_eligible")
    
    # Store check result
    check_result = {
        "id": str(uuid.uuid4()),
        "lead_id": lead_id,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "generated_by": current_user.get("name", "System"),
        "profile": {
            "full_name": full_name,
            "requirement": requirement,
            "cibil_score": cibil_score,
            "net_salary": net_salary,
            "existing_emi": existing_emi,
            "foir": foir,
            "emi_source": emi_source,
            "loan_amount_required": loan_amount_required,
            "company_type": company_type,
            "company_name": company_name,
            "employment_type": employment_type,
            "age": age,
        },
        "profile_strength": profile_strength,
        "results": results,
        "eligible_count": eligible_count,
        "possibly_eligible_count": possibly_count,
        "not_eligible_count": not_eligible_count,
        "total_policies": len(results),
        "missing_info": missing_info,
    }
    
    # Store in history
    await db.eligibility_checks.insert_one({**check_result})
    
    # Update lead with reference
    await db.leads.update_one(
        {"id": lead_id},
        {
            "$set": {
                "last_eligibility_check": {
                    "id": check_result["id"],
                    "generated_at": check_result["generated_at"],
                    "eligible_count": eligible_count,
                    "total_policies": len(results),
                    "profile_strength": profile_strength
                },
                "updated_at": datetime.now(timezone.utc).isoformat()
            }
        }
    )
    
    return check_result


async def get_bank_historical_data(bank_name: str, cibil: int = None, salary: float = None, company_type: str = None):
    """Get historical approval data for a bank"""
    # Query historical files with this bank in eligibilities
    pipeline = [
        {"$match": {"status": "file", "eligibilities.bank_name": {"$regex": bank_name, "$options": "i"}}},
        {"$unwind": "$eligibilities"},
        {"$match": {"eligibilities.bank_name": {"$regex": bank_name, "$options": "i"}}},
        {"$group": {
            "_id": None,
            "total_cases": {"$sum": 1},
            "total_logins": {"$sum": {"$cond": [{"$eq": ["$eligibilities.login_done", True]}, 1, 0]}},
            "total_approved": {"$sum": {"$cond": [{"$eq": ["$eligibilities.approval_status", "approved"]}, 1, 0]}},
            "total_disbursed": {"$sum": {"$cond": [{"$eq": ["$eligibilities.disbursed", True]}, 1, 0]}},
            "total_disbursed_amount": {"$sum": {"$cond": [
                {"$eq": ["$eligibilities.disbursed", True]},
                {"$toDouble": {"$ifNull": ["$eligibilities.disbursed_amount", 0]}},
                0
            ]}}
        }}
    ]
    
    result = await db.leads.aggregate(pipeline).to_list(1)
    
    if not result:
        return {
            "total_cases": 0,
            "total_logins": 0,
            "total_approved": 0,
            "total_disbursed": 0,
            "approval_rate": None,
            "avg_approved_amount": 0,
            "similar_approved": 0
        }
    
    data = result[0]
    approval_rate = None
    if data.get("total_logins", 0) > 0:
        approval_rate = round((data.get("total_approved", 0) / data["total_logins"]) * 100, 1)
    
    avg_amount = 0
    if data.get("total_disbursed", 0) > 0:
        avg_amount = round(data.get("total_disbursed_amount", 0) / data["total_disbursed"])
    
    # Similar profile approved (simplified - just return 0 for now, can enhance later)
    similar_approved = 0
    
    return {
        "total_cases": data.get("total_cases", 0),
        "total_logins": data.get("total_logins", 0),
        "total_approved": data.get("total_approved", 0),
        "total_disbursed": data.get("total_disbursed", 0),
        "approval_rate": approval_rate,
        "avg_approved_amount": avg_amount,
        "similar_approved": similar_approved
    }


@router.get("/eligibility-history/{lead_id}")
async def get_eligibility_history(lead_id: str, current_user: dict = Depends(get_current_user)):
    """Get history of eligibility checks for a lead"""
    history = await db.eligibility_checks.find(
        {"lead_id": lead_id},
        {"_id": 0, "results": 0, "profile": 0}  # Exclude large fields
    ).sort("generated_at", -1).limit(20).to_list(20)
    
    return history
