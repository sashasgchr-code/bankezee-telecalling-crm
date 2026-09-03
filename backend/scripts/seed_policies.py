"""
Seed Bank Policies - Initial policy data for OLD CRM parity
Run: python -m scripts.seed_policies
"""
import asyncio
import uuid
from datetime import datetime, timezone
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv
from pathlib import Path
import os

ROOT_DIR = Path(__file__).parent.parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ.get('MONGO_URL')
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ.get('DB_NAME', 'bankezee_connect')]

# Bank policies data - OLD CRM parity
BANK_POLICIES = [
    {
        "bank_name": "HDFC Bank",
        "is_active": True,
        "applicable_profiles": ["salaried"],
        "loan_types": ["personal_loan", "balance_transfer", "bt_topup"],
        "min_salary": 25000,
        "min_cibil": 700,
        "min_age": 23,
        "max_age": 58,
        "max_loan_amount": 4000000,
        "min_tenure": 12,
        "max_tenure": 60,
        "roi_min": 10.5,
        "roi_max": 15.0,
        "max_foir": 55,
        "company_categories": ["Govt", "Listed", "MNC", "Non-Listed"],
        "min_present_employment_months": 12,
        "min_total_employment_months": 24,
        "bachelor_accommodation": True,
        "hostel_accommodation": False,
        "bt_allowed": True,
        "max_bt_count": 3,
        "topup_allowed": True,
        "processing_fee": "Up to 2.5%",
        "salary_text": "₹25,000+",
        "cibil_text": "700+",
        "foir_text": "Max 55%",
        "roi_text": "10.5%-15.0%",
        "special_features": "Quick disbursal, Flexible tenure",
        "special_notes": "Salary account holders get preferential rates",
        "eligible_employees": "Govt, Listed, MNC, Non-Listed",
        "required_documents": ["Salary Slips (3 months)", "Bank Statement (6 months)", "PAN Card", "Aadhar", "Address Proof"]
    },
    {
        "bank_name": "ICICI Bank",
        "is_active": True,
        "applicable_profiles": ["salaried"],
        "loan_types": ["personal_loan", "balance_transfer", "bt_topup"],
        "min_salary": 20000,
        "min_cibil": 680,
        "min_age": 23,
        "max_age": 60,
        "max_loan_amount": 5000000,
        "min_tenure": 12,
        "max_tenure": 72,
        "roi_min": 10.75,
        "roi_max": 16.0,
        "max_foir": 60,
        "company_categories": ["Govt", "Listed", "MNC", "Non-Listed", "Proprietorship"],
        "min_present_employment_months": 6,
        "min_total_employment_months": 12,
        "bachelor_accommodation": True,
        "hostel_accommodation": True,
        "bt_allowed": True,
        "max_bt_count": 4,
        "topup_allowed": True,
        "app_loan_bt": True,
        "processing_fee": "Up to 2.25%",
        "salary_text": "₹20,000+",
        "cibil_text": "680+",
        "foir_text": "Max 60%",
        "roi_text": "10.75%-16.0%",
        "special_features": "App loan BT allowed, Higher max amount",
        "special_notes": "Salary account customers get faster processing",
        "eligible_employees": "Govt, Listed, MNC, Non-Listed, Proprietorship",
        "required_documents": ["Salary Slips (3 months)", "Bank Statement (6 months)", "PAN", "Aadhar", "Photo"]
    },
    {
        "bank_name": "Axis Bank",
        "is_active": True,
        "applicable_profiles": ["salaried"],
        "loan_types": ["personal_loan", "balance_transfer", "bt_topup"],
        "min_salary": 18000,
        "min_cibil": 675,
        "min_age": 22,
        "max_age": 60,
        "max_loan_amount": 4000000,
        "min_tenure": 12,
        "max_tenure": 60,
        "roi_min": 10.49,
        "roi_max": 18.0,
        "max_foir": 55,
        "company_categories": ["Govt", "Listed", "MNC", "Non-Listed"],
        "min_present_employment_months": 6,
        "min_total_employment_months": 12,
        "bachelor_accommodation": True,
        "hostel_accommodation": False,
        "bt_allowed": True,
        "max_bt_count": 3,
        "topup_allowed": True,
        "processing_fee": "Up to 2%",
        "salary_text": "₹18,000+",
        "cibil_text": "675+",
        "foir_text": "Max 55%",
        "roi_text": "10.49%-18.0%",
        "special_features": "Lower minimum salary requirement",
        "eligible_employees": "Govt, Listed, MNC, Non-Listed",
        "required_documents": ["Salary Slips (3 months)", "Bank Statement (6 months)", "KYC Documents"]
    },
    {
        "bank_name": "Kotak Mahindra Bank",
        "is_active": True,
        "applicable_profiles": ["salaried"],
        "loan_types": ["personal_loan", "balance_transfer", "bt_topup"],
        "min_salary": 25000,
        "min_cibil": 700,
        "min_age": 23,
        "max_age": 58,
        "max_loan_amount": 3500000,
        "min_tenure": 12,
        "max_tenure": 60,
        "roi_min": 10.99,
        "roi_max": 16.0,
        "max_foir": 50,
        "company_categories": ["Govt", "Listed", "MNC"],
        "min_present_employment_months": 12,
        "min_total_employment_months": 24,
        "bachelor_accommodation": False,
        "hostel_accommodation": False,
        "bt_allowed": True,
        "max_bt_count": 2,
        "topup_allowed": True,
        "processing_fee": "Up to 2.5%",
        "salary_text": "₹25,000+",
        "cibil_text": "700+",
        "foir_text": "Max 50%",
        "roi_text": "10.99%-16.0%",
        "special_features": "Strict FOIR criteria",
        "special_notes": "No bachelor/hostel accommodation",
        "eligible_employees": "Govt, Listed, MNC only",
        "required_documents": ["Salary Slips (3 months)", "Bank Statement (6 months)", "PAN", "Aadhar"]
    },
    {
        "bank_name": "IndusInd Bank",
        "is_active": True,
        "applicable_profiles": ["salaried"],
        "loan_types": ["personal_loan", "balance_transfer", "bt_topup"],
        "min_salary": 20000,
        "min_cibil": 650,
        "min_age": 23,
        "max_age": 60,
        "max_loan_amount": 3000000,
        "min_tenure": 12,
        "max_tenure": 60,
        "roi_min": 11.0,
        "roi_max": 18.0,
        "max_foir": 60,
        "company_categories": ["Govt", "Listed", "MNC", "Non-Listed", "Proprietorship"],
        "min_present_employment_months": 6,
        "min_total_employment_months": 12,
        "bachelor_accommodation": True,
        "hostel_accommodation": True,
        "bt_allowed": True,
        "max_bt_count": 4,
        "app_loan_bt": True,
        "cc_bt_allowed": True,
        "topup_allowed": True,
        "processing_fee": "Up to 2.5%",
        "salary_text": "₹20,000+",
        "cibil_text": "650+",
        "foir_text": "Max 60%",
        "roi_text": "11.0%-18.0%",
        "special_features": "Low CIBIL accepted, App loan + CC BT allowed",
        "special_notes": "Flexible with accommodation types",
        "eligible_employees": "All company types",
        "required_documents": ["Salary Slips (3 months)", "Bank Statement (6 months)", "PAN", "Aadhar"]
    },
    {
        "bank_name": "Bajaj Finserv",
        "is_active": True,
        "applicable_profiles": ["salaried"],
        "loan_types": ["personal_loan", "balance_transfer"],
        "min_salary": 22000,
        "min_cibil": 685,
        "min_age": 23,
        "max_age": 58,
        "max_loan_amount": 2500000,
        "min_tenure": 12,
        "max_tenure": 60,
        "roi_min": 11.0,
        "roi_max": 17.0,
        "max_foir": 55,
        "company_categories": ["Govt", "Listed", "MNC", "Non-Listed"],
        "min_present_employment_months": 6,
        "min_total_employment_months": 12,
        "bachelor_accommodation": True,
        "hostel_accommodation": False,
        "bt_allowed": True,
        "max_bt_count": 2,
        "topup_allowed": False,
        "processing_fee": "Up to 3%",
        "salary_text": "₹22,000+",
        "cibil_text": "685+",
        "foir_text": "Max 55%",
        "roi_text": "11.0%-17.0%",
        "special_features": "Quick disbursement within 24 hrs",
        "special_notes": "No topup allowed",
        "eligible_employees": "Govt, Listed, MNC, Non-Listed",
        "required_documents": ["Salary Slips (3 months)", "Bank Statement (3 months)", "PAN", "Aadhar"]
    },
    {
        "bank_name": "IDFC First Bank",
        "is_active": True,
        "applicable_profiles": ["salaried"],
        "loan_types": ["personal_loan", "balance_transfer", "bt_topup"],
        "min_salary": 18000,
        "min_cibil": 650,
        "min_age": 23,
        "max_age": 60,
        "max_loan_amount": 4000000,
        "min_tenure": 12,
        "max_tenure": 60,
        "roi_min": 10.49,
        "roi_max": 20.0,
        "max_foir": 65,
        "company_categories": ["Govt", "Listed", "MNC", "Non-Listed", "Proprietorship", "Partnership"],
        "min_present_employment_months": 3,
        "min_total_employment_months": 12,
        "bachelor_accommodation": True,
        "hostel_accommodation": True,
        "bt_allowed": True,
        "max_bt_count": 5,
        "app_loan_bt": True,
        "cc_bt_allowed": True,
        "topup_allowed": True,
        "merge_consolidation": True,
        "processing_fee": "Up to 2%",
        "salary_text": "₹18,000+",
        "cibil_text": "650+",
        "foir_text": "Max 65%",
        "roi_text": "10.49%-20.0%",
        "special_features": "Very flexible - Low CIBIL, High FOIR accepted, All BT types",
        "special_notes": "Most flexible bank for difficult cases",
        "eligible_employees": "All company types including Partnership",
        "required_documents": ["Salary Slips (2 months)", "Bank Statement (3 months)", "PAN", "Aadhar"]
    },
    {
        "bank_name": "Yes Bank",
        "is_active": True,
        "applicable_profiles": ["salaried"],
        "loan_types": ["personal_loan", "balance_transfer"],
        "min_salary": 25000,
        "min_cibil": 700,
        "min_age": 24,
        "max_age": 55,
        "max_loan_amount": 3000000,
        "min_tenure": 12,
        "max_tenure": 60,
        "roi_min": 11.5,
        "roi_max": 18.0,
        "max_foir": 50,
        "company_categories": ["Govt", "Listed", "MNC"],
        "min_present_employment_months": 12,
        "min_total_employment_months": 24,
        "bachelor_accommodation": False,
        "hostel_accommodation": False,
        "bt_allowed": True,
        "max_bt_count": 2,
        "topup_allowed": False,
        "processing_fee": "Up to 2.5%",
        "salary_text": "₹25,000+",
        "cibil_text": "700+",
        "foir_text": "Max 50%",
        "roi_text": "11.5%-18.0%",
        "special_features": "Conservative criteria",
        "special_notes": "Strict profile requirements",
        "eligible_employees": "Govt, Listed, MNC only",
        "required_documents": ["Salary Slips (3 months)", "Bank Statement (6 months)", "PAN", "Aadhar", "Photo"]
    },
    {
        "bank_name": "Tata Capital",
        "is_active": True,
        "applicable_profiles": ["salaried", "self_employed"],
        "loan_types": ["personal_loan", "business_loan", "balance_transfer"],
        "min_salary": 20000,
        "min_cibil": 680,
        "min_age": 22,
        "max_age": 60,
        "max_loan_amount": 3500000,
        "min_tenure": 12,
        "max_tenure": 72,
        "roi_min": 10.99,
        "roi_max": 18.0,
        "max_foir": 60,
        "company_categories": ["Govt", "Listed", "MNC", "Non-Listed", "Proprietorship"],
        "min_present_employment_months": 6,
        "min_total_employment_months": 12,
        "bachelor_accommodation": True,
        "hostel_accommodation": True,
        "bt_allowed": True,
        "max_bt_count": 3,
        "topup_allowed": True,
        "processing_fee": "Up to 2.5%",
        "salary_text": "₹20,000+",
        "cibil_text": "680+",
        "foir_text": "Max 60%",
        "roi_text": "10.99%-18.0%",
        "special_features": "Both salaried and self-employed accepted",
        "eligible_employees": "All categories",
        "required_documents": ["Salary Slips (3 months)", "Bank Statement (6 months)", "ITR (for SE)", "PAN", "Aadhar"]
    },
    {
        "bank_name": "L&T Finance",
        "is_active": True,
        "applicable_profiles": ["salaried"],
        "loan_types": ["personal_loan", "balance_transfer"],
        "min_salary": 18000,
        "min_cibil": 660,
        "min_age": 23,
        "max_age": 58,
        "max_loan_amount": 2000000,
        "min_tenure": 12,
        "max_tenure": 48,
        "roi_min": 12.0,
        "roi_max": 22.0,
        "max_foir": 65,
        "company_categories": ["Govt", "Listed", "MNC", "Non-Listed"],
        "min_present_employment_months": 6,
        "min_total_employment_months": 12,
        "bachelor_accommodation": True,
        "hostel_accommodation": True,
        "bt_allowed": True,
        "max_bt_count": 3,
        "topup_allowed": False,
        "processing_fee": "Up to 3%",
        "salary_text": "₹18,000+",
        "cibil_text": "660+",
        "foir_text": "Max 65%",
        "roi_text": "12.0%-22.0%",
        "special_features": "Low CIBIL accepted, High FOIR tolerance",
        "special_notes": "Good for difficult profiles",
        "eligible_employees": "Govt, Listed, MNC, Non-Listed",
        "required_documents": ["Salary Slips (3 months)", "Bank Statement (3 months)", "PAN", "Aadhar"]
    },
    {
        "bank_name": "Fullerton India",
        "is_active": True,
        "applicable_profiles": ["salaried", "self_employed"],
        "loan_types": ["personal_loan", "business_loan"],
        "min_salary": 15000,
        "min_cibil": 625,
        "min_age": 21,
        "max_age": 60,
        "max_loan_amount": 2500000,
        "min_tenure": 12,
        "max_tenure": 60,
        "roi_min": 14.0,
        "roi_max": 36.0,
        "max_foir": 70,
        "company_categories": ["All"],
        "min_present_employment_months": 3,
        "min_total_employment_months": 6,
        "bachelor_accommodation": True,
        "hostel_accommodation": True,
        "bt_allowed": False,
        "topup_allowed": False,
        "processing_fee": "Up to 4%",
        "salary_text": "₹15,000+",
        "cibil_text": "625+",
        "foir_text": "Max 70%",
        "roi_text": "14.0%-36.0%",
        "special_features": "Lowest entry criteria, High risk profiles accepted",
        "special_notes": "Higher rates but accepts most profiles",
        "eligible_employees": "All company types",
        "required_documents": ["Salary Slips (2 months)", "Bank Statement (3 months)", "PAN", "Aadhar"]
    },
    {
        "bank_name": "Poonawalla Fincorp",
        "is_active": True,
        "applicable_profiles": ["salaried"],
        "loan_types": ["personal_loan", "balance_transfer", "bt_topup"],
        "min_salary": 20000,
        "min_cibil": 675,
        "min_age": 23,
        "max_age": 58,
        "max_loan_amount": 3000000,
        "min_tenure": 12,
        "max_tenure": 60,
        "roi_min": 11.5,
        "roi_max": 24.0,
        "max_foir": 60,
        "company_categories": ["Govt", "Listed", "MNC", "Non-Listed"],
        "min_present_employment_months": 6,
        "min_total_employment_months": 12,
        "bachelor_accommodation": True,
        "hostel_accommodation": True,
        "bt_allowed": True,
        "max_bt_count": 4,
        "app_loan_bt": True,
        "topup_allowed": True,
        "processing_fee": "Up to 2.5%",
        "salary_text": "₹20,000+",
        "cibil_text": "675+",
        "foir_text": "Max 60%",
        "roi_text": "11.5%-24.0%",
        "special_features": "App loan BT allowed, Flexible",
        "eligible_employees": "Govt, Listed, MNC, Non-Listed",
        "required_documents": ["Salary Slips (3 months)", "Bank Statement (6 months)", "PAN", "Aadhar"]
    },
]


async def seed_policies():
    """Seed bank policies into database"""
    print("Starting policy seeding...")
    
    # Check existing policies
    existing_count = await db.bank_policies.count_documents({})
    print(f"Existing policies: {existing_count}")
    
    if existing_count > 0:
        confirm = input("Policies already exist. Do you want to update/add? (yes/no): ")
        if confirm.lower() != 'yes':
            print("Aborted.")
            return
    
    inserted = 0
    updated = 0
    
    for policy in BANK_POLICIES:
        # Check if policy exists by bank name
        existing = await db.bank_policies.find_one({"bank_name": policy["bank_name"]})
        
        if existing:
            # Update existing
            policy["updated_at"] = datetime.now(timezone.utc).isoformat()
            policy["updated_by"] = "seed_script"
            await db.bank_policies.update_one(
                {"bank_name": policy["bank_name"]},
                {"$set": policy}
            )
            updated += 1
            print(f"Updated: {policy['bank_name']}")
        else:
            # Insert new
            policy["id"] = str(uuid.uuid4())
            policy["created_at"] = datetime.now(timezone.utc).isoformat()
            policy["updated_at"] = datetime.now(timezone.utc).isoformat()
            policy["created_by"] = "seed_script"
            policy["updated_by"] = "seed_script"
            await db.bank_policies.insert_one(policy)
            inserted += 1
            print(f"Inserted: {policy['bank_name']}")
    
    print(f"\nSeeding complete: {inserted} inserted, {updated} updated")
    print(f"Total policies: {await db.bank_policies.count_documents({})}")


async def seed_policies_auto():
    """Auto seed without confirmation (for deployment scripts)"""
    print("Auto-seeding bank policies...")
    
    for policy in BANK_POLICIES:
        existing = await db.bank_policies.find_one({"bank_name": policy["bank_name"]})
        
        if not existing:
            policy["id"] = str(uuid.uuid4())
            policy["created_at"] = datetime.now(timezone.utc).isoformat()
            policy["updated_at"] = datetime.now(timezone.utc).isoformat()
            policy["created_by"] = "seed_script"
            policy["updated_by"] = "seed_script"
            await db.bank_policies.insert_one(policy)
            print(f"Seeded: {policy['bank_name']}")
    
    total = await db.bank_policies.count_documents({})
    print(f"Total policies after seeding: {total}")


if __name__ == "__main__":
    asyncio.run(seed_policies())
