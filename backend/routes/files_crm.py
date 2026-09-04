"""
Files CRM Routes - Integrated from BankEzee CRM
Handles file details, eligibilities, document management for leads with status='file'
"""
from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from pydantic import BaseModel
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorGridFSBucket
from bson import ObjectId
from dotenv import load_dotenv
from pathlib import Path
import os
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional, List
import logging
from utils.auth import get_current_user, require_admin
from utils.json_safe import json_safe
from utils.helpers import doc_ref_filter
from utils.files_query import build_files_query

ROOT_DIR = Path(__file__).parent.parent
load_dotenv(ROOT_DIR / '.env')

logger = logging.getLogger(__name__)

mongo_url = os.environ.get('MONGO_URL')
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ.get('DB_NAME', 'bankezee_connect')]

router = APIRouter(prefix="/api/files", tags=["Files CRM"])

# Growth Partner roles - these roles can edit customer info but NOT bank processing
# Note: 'manager' is NOT in GP_ROLES - managers have elevated access like admin but scoped to their team
GP_ROLES = ['telecaller', 'sales_agent', 'team_leader', 'partner', 'growth_partner']

# Ops roles - these can edit bank processing
OPS_ROLES = ['operations', 'ops']

# Helper function to check if user is GP
def is_gp(role: str) -> bool:
    return role in GP_ROLES

# Helper function to check if user can edit bank processing
def can_edit_bank_processing(role: str) -> bool:
    return role == 'admin' or role in OPS_ROLES


def EMPTY_DASHBOARD_STATS():
    """Zeroed dashboard payload - used when an explicit scope filter resolves to nobody."""
    keys = [
        "total_files", "new", "in_progress", "login", "login_current", "login_spillover",
        "approved", "approved_current", "approved_spillover", "total_approved_amount",
        "disbursed", "disbursed_current", "disbursed_spillover", "total_disbursed_amount",
        "interim_rejects", "interim_rejects_current", "interim_rejects_spillover",
        "final_rejections", "final_rejections_current", "final_rejections_spillover",
        "amt_in_pipeline", "contacted", "documents_collected", "sent_to_bank", "rejected",
    ]
    payload = {k: 0 for k in keys}
    payload["by_status"] = {}
    payload["loans_by_type"] = {}
    return payload


def lead_filter(file_id: str, **extra) -> dict:
    """Match a lead by its 'id' field, or by _id for legacy CRM records that have no 'id'.

    The files list exposes str(_id) as the id for imported CRM records, so every
    per-file endpoint must accept that value too.
    """
    return doc_ref_filter(file_id, **extra)

# File storage - using MongoDB GridFS for persistence across deployments

ALLOWED_EXTENSIONS = {'.pdf', '.jpg', '.jpeg', '.png', '.gif', '.doc', '.docx', '.xls', '.xlsx'}
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB

# GridFS bucket for file storage
async def get_gridfs_bucket():
    return AsyncIOMotorGridFSBucket(db, bucket_name="file_documents")

# Helper to get current user from JWT (legacy - prefer utils.auth.get_current_user)
async def get_current_user_from_token_legacy(token: str):
    from routes.auth import get_current_user as auth_get_current_user
    return await auth_get_current_user(token)


class FileDetailsUpdate(BaseModel):
    full_name: Optional[str] = None
    mobile: Optional[str] = None
    email: Optional[str] = None
    city: Optional[str] = None
    employment_type: Optional[str] = None
    requirement: Optional[str] = None
    additional_data: Optional[dict] = None


class FileStatusUpdate(BaseModel):
    file_status: str


class NoteAdd(BaseModel):
    note: str


class EligibilityEntry(BaseModel):
    bank_name: str
    is_eligible: bool
    eligible_amount: Optional[float] = None
    eligible_tenure: Optional[int] = None
    not_eligible_reason: Optional[str] = None
    login_done: Optional[bool] = None
    login_bank: Optional[str] = None
    login_rejection_reason: Optional[str] = None
    approval_status: Optional[str] = None
    approved_bank: Optional[str] = None
    approved_amount: Optional[float] = None
    approved_tenure: Optional[int] = None
    approved_roi: Optional[float] = None
    declined_bank: Optional[str] = None
    declined_reason: Optional[str] = None
    disbursed: Optional[bool] = None
    disbursed_bank: Optional[str] = None
    disbursed_amount: Optional[float] = None
    disbursed_tenure: Optional[int] = None
    disbursed_roi: Optional[float] = None
    disbursement_rejection_reason: Optional[str] = None
    commission_percentage: Optional[float] = None
    commission_amount: Optional[float] = None


class EligibilityUpdate(BaseModel):
    eligibilities: List[EligibilityEntry]


class FileAssignment(BaseModel):
    assigned_to: str


class BulkFileAssignment(BaseModel):
    file_ids: List[str]
    assigned_to: str


# File statuses for CRM processing - Complete OLD CRM workflow preserved
# All 24 statuses from old CRM mapped here
FILE_STATUSES = [
    # Initial Stages
    "new", "contacted",
    # Document Collection
    "documents_pending", "documents_collected",
    # Eligibility & Processing
    "sent_for_eligibility", "not_eligible", "query_hold",
    # Bank Submission
    "sent_to_bank", "sent_for_login", "login", "not_login",
    # Underwriting & FI
    "underwriting", "fi", "fi_reinitiated", "fi_negative",
    # Approval/Decline
    "approved", "sanctioned", "declined",
    # Disbursal
    "disbursed", "not_disbursed",
    # Final States
    "rejected", "customer_not_interested", "customer_not_supporting", "supporting"
]


@router.get("/statuses")
async def get_file_statuses():
    """Get list of available file statuses for CRM processing - Complete OLD CRM workflow"""
    return [
        # Initial Stages
        {"id": "new", "label": "New", "category": "initial"},
        {"id": "contacted", "label": "Contacted", "category": "initial"},
        # Document Collection
        {"id": "documents_pending", "label": "Documents Pending", "category": "documents"},
        {"id": "documents_collected", "label": "Documents Collected", "category": "documents"},
        # Eligibility & Processing
        {"id": "sent_for_eligibility", "label": "Sent for Eligibility", "category": "processing"},
        {"id": "not_eligible", "label": "Not Eligible", "category": "rejection"},
        {"id": "query_hold", "label": "Query/Hold", "category": "processing"},
        # Bank Submission
        {"id": "sent_to_bank", "label": "Sent to Bank", "category": "bank"},
        {"id": "sent_for_login", "label": "Sent for Login", "category": "bank"},
        {"id": "login", "label": "Login", "category": "bank"},
        {"id": "not_login", "label": "Not Login", "category": "rejection"},
        # Underwriting & FI
        {"id": "underwriting", "label": "Underwriting", "category": "underwriting"},
        {"id": "fi", "label": "FI", "category": "underwriting"},
        {"id": "fi_reinitiated", "label": "FI Reinitiated", "category": "underwriting"},
        {"id": "fi_negative", "label": "FI Negative", "category": "rejection"},
        # Approval/Decline
        {"id": "approved", "label": "Approved", "category": "approval"},
        {"id": "sanctioned", "label": "Sanctioned", "category": "approval"},
        {"id": "declined", "label": "Declined", "category": "rejection"},
        # Disbursal
        {"id": "disbursed", "label": "Disbursed", "category": "disbursal"},
        {"id": "not_disbursed", "label": "Not Disbursed", "category": "rejection"},
        # Final States
        {"id": "rejected", "label": "Rejected", "category": "rejection"},
        {"id": "customer_not_interested", "label": "Customer Not Interested", "category": "rejection"},
        {"id": "customer_not_supporting", "label": "Customer Not Supporting", "category": "rejection"},
        {"id": "supporting", "label": "Supporting", "category": "other"}
    ]


@router.get("/operations-team")
async def get_operations_team():
    """Get list of operations team members for assignment"""
    # Include all GP roles plus admin and operations
    ops_team = await db.users.find(
        {"role": {"$in": GP_ROLES + ["admin"] + OPS_ROLES}},
        {"_id": 0, "id": 1, "full_name": 1, "name": 1, "email": 1, "role": 1}
    ).to_list(200)
    # Normalize name field
    for member in ops_team:
        if not member.get('full_name') and member.get('name'):
            member['full_name'] = member['name']
        elif not member.get('full_name'):
            member['full_name'] = member.get('email', '').split('@')[0]
    return ops_team


@router.get("")
@router.get("/")
async def get_all_files(
    file_status: Optional[str] = None,
    assigned_to: Optional[str] = None,
    manager_id: Optional[str] = None,
    gp_id: Optional[str] = None,
    tl_id: Optional[str] = None,
    loan_types: Optional[str] = None,  # Comma-separated list
    search: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    activity_start_date: Optional[str] = None,
    activity_end_date: Optional[str] = None,
    page: int = 1,
    limit: int = 50,
    team_view: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """Get all leads with status='file' (Files Dashboard)
    
    Supports:
    - file_status: Filter by file processing status
    - manager_id: Filter by manager
    - gp_id: Filter by Growth Partner
    - tl_id: Filter by Team Lead's team
    - loan_types: Comma-separated loan types
    - search: Search by name, mobile, or email
    - start_date/end_date: Date range filter on created_at (for Total, New, In Progress)
    - activity_start_date/activity_end_date: Date range for status change (for Login, Approved, etc.)
    - team_view: If 'true' and user is TL, shows team's files (read-only)
    - Role-based filtering: GPs only see their own files
    """
    query = await build_files_query(
        db, current_user,
        file_status=file_status,
        gp_id=gp_id,
        tl_id=tl_id,
        manager_id=manager_id,
        assigned_to=assigned_to,
        loan_types=loan_types,
        search=search,
        start_date=start_date,
        end_date=end_date,
        activity_start_date=activity_start_date,
        activity_end_date=activity_end_date,
        team_view=(team_view == 'true'),
    )
    if query is None:
        # Fail closed: an explicitly selected scope resolved to nobody
        return {
            "files": [],
            "pagination": {"page": page, "limit": limit, "total": 0, "pages": 0}
        }
    
    skip = (page - 1) * limit
    
    # Fetch files - include _id to ensure we can always provide an id
    files_cursor = db.leads.find(query).sort("updated_at", -1).skip(skip).limit(limit)
    files_raw = await files_cursor.to_list(limit)
    total = await db.leads.count_documents(query)
    
    # Process files to ensure each has an id field
    files = []
    for f in files_raw:
        # Convert _id to string id if id field is missing
        if not f.get('id') and f.get('_id'):
            f['id'] = str(f['_id'])
        # Remove _id from response
        f.pop('_id', None)
        files.append(json_safe(f))
    
    return {
        "files": files,
        "pagination": {
            "page": page,
            "limit": limit,
            "total": total,
            "pages": (total + limit - 1) // limit
        }
    }


# ============ FILES REPORTS ============
# Must be before /{file_id} to avoid route shadowing

@router.get("/reports")
async def get_files_reports(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    assigned_to: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """Get files reports with disbursement analytics"""
    query = {"status": "file"}
    
    # Role-based restriction
    user_role = current_user.get('role')
    user_id = current_user.get('id')
    
    # Manager role - see team's files (similar to admin but scoped)
    if user_role == 'manager':
        team_members = await db.users.find(
            {"manager_id": user_id, "is_active": True},
            {"_id": 0, "id": 1}
        ).to_list(200)
        team_ids = [m["id"] for m in team_members if m.get("id")]
        team_ids.append(user_id)  # Include manager's own files
        
        if team_ids:
            query["$or"] = [
                {"assigned_to": {"$in": team_ids}},
                {"file_assigned_to": {"$in": team_ids}},
                {"source_id": {"$in": team_ids}}
            ]
    # GP role restriction - GPs only see their own files
    elif is_gp(user_role):
        gp_id = user_id
        query["$or"] = [
            {"assigned_to": gp_id},
            {"file_assigned_to": gp_id},
            {"source_id": gp_id}
        ]
    elif assigned_to:
        query["file_assigned_to"] = assigned_to
    
    if start_date:
        if "$or" in query:
            query["$and"] = query.get("$and", [])
            query["$and"].append({"created_at": {"$gte": start_date}})
        else:
            query["created_at"] = {"$gte": start_date}
    if end_date:
        if "$and" in query:
            for cond in query["$and"]:
                if "created_at" in cond:
                    cond["created_at"]["$lte"] = end_date
                    break
            else:
                query["$and"].append({"created_at": {"$lte": end_date}})
        elif "created_at" in query:
            query["created_at"]["$lte"] = end_date
        else:
            query["created_at"] = {"$lte": end_date}
    
    # Status breakdown
    status_pipeline = [
        {"$match": query},
        {"$group": {"_id": "$file_status", "count": {"$sum": 1}}}
    ]
    status_counts = await db.leads.aggregate(status_pipeline).to_list(100)
    
    # Disbursement stats
    disbursement_pipeline = [
        {"$match": {**query, "eligibilities": {"$exists": True, "$ne": []}}},
        {"$unwind": "$eligibilities"},
        {"$match": {"eligibilities.disbursed": True}},
        {"$group": {
            "_id": None,
            "total_disbursed_count": {"$sum": 1},
            "total_disbursed_amount": {"$sum": {"$toDouble": {"$ifNull": ["$eligibilities.disbursed_amount", 0]}}},
            "total_commission": {"$sum": {"$toDouble": {"$ifNull": ["$eligibilities.commission_amount", 0]}}}
        }}
    ]
    disbursement_stats = await db.leads.aggregate(disbursement_pipeline).to_list(1)
    
    # Bank-wise breakdown
    bank_pipeline = [
        {"$match": {**query, "eligibilities": {"$exists": True, "$ne": []}}},
        {"$unwind": "$eligibilities"},
        {"$match": {"eligibilities.bank_name": {"$exists": True, "$ne": ""}}},
        {"$group": {
            "_id": "$eligibilities.bank_name",
            "total": {"$sum": 1},
            "eligible": {"$sum": {"$cond": [{"$eq": ["$eligibilities.is_eligible", True]}, 1, 0]}},
            "login": {"$sum": {"$cond": [{"$eq": ["$eligibilities.login_done", True]}, 1, 0]}},
            "approved": {"$sum": {"$cond": [{"$eq": ["$eligibilities.approval_status", "approved"]}, 1, 0]}},
            "disbursed": {"$sum": {"$cond": [{"$eq": ["$eligibilities.disbursed", True]}, 1, 0]}},
            "disbursed_amount": {"$sum": {"$cond": [
                {"$eq": ["$eligibilities.disbursed", True]},
                {"$toDouble": {"$ifNull": ["$eligibilities.disbursed_amount", 0]}},
                0
            ]}},
            "commission_amount": {"$sum": {"$toDouble": {"$ifNull": ["$eligibilities.commission_amount", 0]}}}
        }},
        {"$sort": {"disbursed_amount": -1}}
    ]
    bank_stats = await db.leads.aggregate(bank_pipeline).to_list(50)
    
    # Team member performance
    team_pipeline = [
        {"$match": query},
        {"$group": {
            "_id": "$file_assigned_to",
            "total_files": {"$sum": 1},
            "disbursed": {"$sum": {"$cond": [{"$eq": ["$file_status", "disbursed"]}, 1, 0]}},
            "approved": {"$sum": {"$cond": [{"$eq": ["$file_status", "approved"]}, 1, 0]}},
            "rejected": {"$sum": {"$cond": [{"$in": ["$file_status", ["rejected", "declined", "not_eligible"]]}, 1, 0]}}
        }}
    ]
    team_stats_raw = await db.leads.aggregate(team_pipeline).to_list(100)
    
    # Enrich team stats with names
    team_stats = []
    for ts in team_stats_raw:
        if ts["_id"]:
            user = await db.users.find_one({"id": ts["_id"]}, {"_id": 0, "full_name": 1, "name": 1})
            ts["name"] = user.get("full_name") or user.get("name") if user else "Unknown"
        else:
            ts["name"] = "Unassigned"
        team_stats.append(ts)
    
    # Conversion funnel
    total_files = await db.leads.count_documents(query)
    docs_collected = await db.leads.count_documents({**query, "file_status": "documents_collected"})
    sent_to_bank = await db.leads.count_documents({**query, "file_status": {"$in": ["sent_to_bank", "login", "approved", "disbursed"]}})
    login_done = await db.leads.count_documents({**query, "file_status": {"$in": ["login", "approved", "disbursed"]}})
    approved = await db.leads.count_documents({**query, "file_status": {"$in": ["approved", "disbursed"]}})
    disbursed = await db.leads.count_documents({**query, "file_status": "disbursed"})
    
    disb = disbursement_stats[0] if disbursement_stats else {}
    
    # Loan type stats (using file_details.type_of_loan - OLD CRM calculation)
    loan_type_pipeline = [
        {"$match": query},
        {"$match": {"file_details.type_of_loan": {"$exists": True, "$ne": ""}}},
        {"$group": {
            "_id": "$file_details.type_of_loan",
            "count": {"$sum": 1}
        }},
        {"$sort": {"count": -1}},
        {"$limit": 10}
    ]
    loan_type_raw = await db.leads.aggregate(loan_type_pipeline).to_list(10)
    
    # Format loan type names for display
    loan_type_display = {
        'new_personal_loan': 'New Personal Loan',
        'balance_transfer_topup_pl': 'Balance Transfer Topup PL',
        'used_vehicle_loan_bt': 'Used Vehicle Loan BT',
        'merge_multiple_loans': 'Merge Multiple Loans',
        'balance_transfer_pl': 'Balance Transfer PL',
        'top_up_pl': 'Top Up PL',
        'business_loan': 'Business Loan',
        'new_vehicle_loan': 'New Vehicle Loan',
        'used_vehicle_loan_fresh': 'Used Vehicle Loan Fresh',
        'balance_transfer_topup_hl': 'BT Topup HL',
        'new_home_loan': 'New Home Loan'
    }
    
    loan_type_stats = [
        {
            "type": loan_type_display.get(lt["_id"], lt["_id"].replace('_', ' ').title()),
            "count": lt["count"]
        }
        for lt in loan_type_raw
    ]
    
    return {
        "summary": {
            "total_files": total_files,
            "by_status": {s["_id"]: s["count"] for s in status_counts if s["_id"]},
            "total_disbursed_count": disb.get("total_disbursed_count", 0),
            "total_disbursed_amount": disb.get("total_disbursed_amount", 0),
            "total_commission": disb.get("total_commission", 0)
        },
        "funnel": {
            "total_files": total_files,
            "docs_collected": docs_collected,
            "sent_to_bank": sent_to_bank,
            "login_done": login_done,
            "approved": approved,
            "disbursed": disbursed
        },
        "bank_stats": bank_stats,
        "team_stats": team_stats,
        "loan_type_stats": loan_type_stats
    }


# ============ DAILY REPORT ============

@router.get("/reports/daily")
async def get_daily_report(
    report_date: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """
    Daily Report - Summary of today's/selected date's activities.
    
    Shows:
    - Total Files
    - Files Updated Today
    - New Files Today
    - Logins Today
    - Approvals Today
    - Disbursals Today
    - Rejections Today
    """
    from datetime import datetime, timezone
    
    # Build base query with role-based filtering
    base_query = {"status": "file"}
    user_role = current_user.get('role')
    user_id = current_user.get('id')
    
    # Manager role - see team's files
    if user_role == 'manager':
        team_members = await db.users.find(
            {"manager_id": user_id, "is_active": True},
            {"_id": 0, "id": 1}
        ).to_list(200)
        team_ids = [m["id"] for m in team_members if m.get("id")]
        team_ids.append(user_id)
        
        if team_ids:
            base_query["$or"] = [
                {"assigned_to": {"$in": team_ids}},
                {"file_assigned_to": {"$in": team_ids}},
                {"source_id": {"$in": team_ids}}
            ]
    elif is_gp(user_role):
        gp_id = user_id
        base_query["$or"] = [
            {"assigned_to": gp_id},
            {"file_assigned_to": gp_id},
            {"source_id": gp_id}
        ]
    
    # Use today if no date specified
    if report_date:
        try:
            target_date = datetime.strptime(report_date, '%Y-%m-%d').replace(tzinfo=timezone.utc)
        except ValueError:
            target_date = datetime.now(timezone.utc)
    else:
        target_date = datetime.now(timezone.utc)
    
    # Start and end of the target day
    day_start = target_date.replace(hour=0, minute=0, second=0, microsecond=0)
    day_end = target_date.replace(hour=23, minute=59, second=59, microsecond=999999)
    
    def parse_timestamp(ts):
        if not ts:
            return None
        if isinstance(ts, datetime):
            if ts.tzinfo is None:
                return ts.replace(tzinfo=timezone.utc)
            return ts
        try:
            dt = datetime.fromisoformat(ts.replace('Z', '+00:00'))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt
        except (ValueError, TypeError, AttributeError):
            return None
    
    def is_in_day(ts):
        dt = parse_timestamp(ts)
        if not dt:
            return False
        return day_start <= dt <= day_end
    
    # Get all files (with GP filtering)
    total_files = await db.leads.count_documents(base_query)
    
    # New files created today
    new_files_today = 0
    files_updated_today = 0
    logins_today = 0
    approvals_today = 0
    disbursals_today = 0
    rejections_today = 0
    
    all_files = await db.leads.find(base_query).to_list(10000)
    
    for f in all_files:
        created_at = f.get('created_at')
        updated_at = f.get('updated_at')
        file_status = f.get('file_status', 'new')
        
        if is_in_day(created_at):
            new_files_today += 1
        
        if is_in_day(updated_at):
            files_updated_today += 1
        
        # Check eligibilities for activities today
        for elig in (f.get('eligibilities') or []):
            if is_in_day(elig.get('login_done_at')):
                logins_today += 1
            if is_in_day(elig.get('approved_at')):
                approvals_today += 1
            if is_in_day(elig.get('disbursed_at')):
                disbursals_today += 1
        
        # Check activities for status changes today
        for act in (f.get('file_activities') or f.get('activities') or []):
            ts = act.get('timestamp')
            if is_in_day(ts):
                msg = str(act.get('message', '')).lower()
                if 'reject' in msg or 'declined' in msg or 'not eligible' in msg:
                    rejections_today += 1
                    break
    
    return {
        "report_date": target_date.strftime('%Y-%m-%d'),
        "total_files": total_files,
        "new_files_today": new_files_today,
        "files_updated_today": files_updated_today,
        "logins_today": logins_today,
        "approvals_today": approvals_today,
        "disbursals_today": disbursals_today,
        "rejections_today": rejections_today
    }


# ============ REJECTED FILES REPORT ============

@router.get("/reports/rejected")
async def get_rejected_files(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    assigned_to: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """
    Rejected Cases Report - OLD CRM Format
    
    Returns:
    - summary: Total Cases, Not Eligible, Not Login, FI Negative, Declined, Not Disbursed
    - cases: List of rejected files with bank-level breakdown
    """
    from datetime import datetime, timezone
    
    rejected_statuses = ['rejected', 'declined', 'not_eligible', 'not_login', 'not_disbursed', 
                         'fi_negative', 'customer_not_interested', 'customer_not_supporting']
    
    # Build query
    query = {"status": "file", "file_status": {"$in": rejected_statuses}}
    
    # Date filter
    if start_date or end_date:
        date_query = {}
        if start_date:
            try:
                ds = datetime.fromisoformat(start_date.replace('Z', '+00:00'))
                if ds.tzinfo is None:
                    ds = ds.replace(tzinfo=timezone.utc)
                date_query["$gte"] = ds
            except (ValueError, TypeError):
                pass
        if end_date:
            try:
                de = datetime.fromisoformat(end_date.replace('Z', '+00:00'))
                if de.tzinfo is None:
                    de = de.replace(hour=23, minute=59, second=59, tzinfo=timezone.utc)
                date_query["$lte"] = de
            except (ValueError, TypeError):
                pass
        if date_query:
            query["created_at"] = date_query
    
    # Assigned to filter
    if assigned_to:
        query["$or"] = [
            {"assigned_to": assigned_to},
            {"file_assigned_to": assigned_to},
            {"source_id": assigned_to}
        ]
    
    # Get all users for name lookup
    users_list = await db.users.find({}, {"_id": 0, "id": 1, "full_name": 1, "name": 1, "connect_id": 1}).to_list(500)
    user_map = {}
    for u in users_list:
        uid = u.get('id') or u.get('connect_id')
        if uid:
            user_map[uid] = u.get('full_name') or u.get('name', 'Unknown')
    
    # Get rejected files
    rejected_files = await db.leads.find(query, {"_id": 0}).to_list(10000)
    
    # Build summary counts
    summary = {
        "total": len(rejected_files),
        "not_eligible": 0,
        "not_login": 0,
        "fi_negative": 0,
        "declined": 0,
        "not_disbursed": 0
    }
    
    cases = []
    for f in rejected_files:
        file_status = f.get('file_status', 'new')
        
        # Count by status
        if file_status == 'not_eligible':
            summary["not_eligible"] += 1
        elif file_status == 'not_login':
            summary["not_login"] += 1
        elif file_status == 'fi_negative':
            summary["fi_negative"] += 1
        elif file_status == 'declined':
            summary["declined"] += 1
        elif file_status == 'not_disbursed':
            summary["not_disbursed"] += 1
        elif file_status == 'rejected':
            summary["not_eligible"] += 1  # General rejection goes to not_eligible
        
        # Get agent name
        agent_id = f.get('source_id') or f.get('assigned_to') or f.get('file_assigned_to')
        agent_name = user_map.get(agent_id, 'Unknown') if agent_id else 'Unassigned'
        
        # Build case record
        fd = f.get('file_details', {})
        cases.append({
            "id": f.get('id'),
            "name": fd.get('full_name') or f.get('full_name') or f.get('name', 'Unknown'),
            "mobile": fd.get('mobile') or f.get('mobile', ''),
            "file_status": file_status,
            "city": fd.get('city') or f.get('city', ''),
            "employment_type": fd.get('employment_type') or f.get('employment_type', ''),
            "source": f.get('source', ''),
            "agent_name": agent_name,
            "eligibilities": f.get('eligibilities', []),
            "created_at": f.get('created_at')
        })
    
    return {
        "summary": summary,
        "cases": json_safe(cases[:500])  # Limit for performance
    }


# ============ QUALITY REPORT ============

@router.get("/reports/quality")
async def get_quality_report(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    assigned_to: Optional[str] = None,
    loan_type: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """
    Quality Report - File quality metrics with star distribution and GP breakdown.
    Matches OLD CRM format.
    """
    from datetime import datetime, timezone
    from collections import defaultdict
    
    # Build query
    query = {"status": "file"}
    
    # Date filter
    if start_date or end_date:
        date_query = {}
        if start_date:
            try:
                ds = datetime.fromisoformat(start_date.replace('Z', '+00:00'))
                if ds.tzinfo is None:
                    ds = ds.replace(tzinfo=timezone.utc)
                date_query["$gte"] = ds
            except (ValueError, TypeError):
                pass
        if end_date:
            try:
                de = datetime.fromisoformat(end_date.replace('Z', '+00:00'))
                if de.tzinfo is None:
                    de = de.replace(hour=23, minute=59, second=59, tzinfo=timezone.utc)
                date_query["$lte"] = de
            except (ValueError, TypeError):
                pass
        if date_query:
            query["created_at"] = date_query
    
    # Assigned to filter
    if assigned_to:
        query["$or"] = [
            {"assigned_to": assigned_to},
            {"file_assigned_to": assigned_to},
            {"source_id": assigned_to}
        ]
    
    # Loan type filter
    if loan_type:
        query["file_details.type_of_loan"] = loan_type
    
    # Get users for name lookup
    users_list = await db.users.find({}, {"_id": 0, "id": 1, "full_name": 1, "name": 1, "connect_id": 1}).to_list(500)
    user_map = {}
    for u in users_list:
        uid = u.get('id') or u.get('connect_id')
        if uid:
            user_map[uid] = u.get('full_name') or u.get('name', 'Unknown')
    
    all_files = await db.leads.find(query).to_list(10000)
    
    total_files = len(all_files)
    if total_files == 0:
        return {
            "total_files": 0,
            "star_distribution": {"5": 0, "4": 0, "3": 0, "2": 0, "1": 0},
            "avg_score": 0,
            "by_growth_partner": []
        }
    
    # Star distribution and GP breakdown
    star_distribution = {"5": 0, "4": 0, "3": 0, "2": 0, "1": 0}
    gp_stats = defaultdict(lambda: {
        "id": None, "name": "Unknown", "total_files": 0,
        "star_5": 0, "star_4": 0, "star_3": 0, "star_2": 0, "star_1": 0,
        "total_score": 0
    })
    
    total_score = 0
    
    for f in all_files:
        # Calculate star rating
        rating_result = calculate_star_rating(f)
        stars = rating_result.get('stars', 1)
        score = rating_result.get('score', 0)
        
        # Update distribution
        star_distribution[str(stars)] += 1
        total_score += score
        
        # Update GP stats
        gp_id = f.get('source_id') or f.get('assigned_to') or f.get('file_assigned_to')
        if gp_id:
            gp_stats[gp_id]["id"] = gp_id
            gp_stats[gp_id]["name"] = user_map.get(gp_id, f"Unknown ({gp_id[:8]})")
            gp_stats[gp_id]["total_files"] += 1
            gp_stats[gp_id][f"star_{stars}"] += 1
            gp_stats[gp_id]["total_score"] += score
    
    # Calculate avg scores per GP
    gp_list = []
    for gp_id, stats in gp_stats.items():
        if stats["total_files"] > 0:
            stats["avg_score"] = stats["total_score"] / stats["total_files"]
        else:
            stats["avg_score"] = 0
        gp_list.append(stats)
    
    # Sort by total files descending
    gp_list = sorted(gp_list, key=lambda x: -x["total_files"])
    
    return {
        "total_files": total_files,
        "star_distribution": star_distribution,
        "avg_score": total_score / total_files if total_files > 0 else 0,
        "by_growth_partner": gp_list
    }


# ============ STAR RATING CALCULATION - OLD CRM PORT ============

def calculate_star_rating(file_data: dict) -> dict:
    """
    Calculate Star Rating and Score for a file - OLD CRM CALCULATION LOGIC
    
    Star Rating (1-5 stars) based on:
    - Data Completeness (20 points)
    - CIBIL Score (25 points)
    - Income vs Loan Amount ratio (20 points)
    - Employment Stability (15 points)
    - Document Status (10 points)
    - Existing Obligations (10 points)
    
    Total Score: 0-100
    Stars: 1 (0-20), 2 (21-40), 3 (41-60), 4 (61-80), 5 (81-100)
    """
    score = 0
    file_details = file_data.get('file_details') or file_data.get('additional_data') or {}
    
    # 1. Data Completeness (25 points) - be more lenient
    # Check both top-level and file_details for fields
    def has_field(f_name, fd_name=None):
        if file_data.get(f_name):
            return True
        if fd_name and file_details.get(fd_name):
            return True
        if file_details.get(f_name):
            return True
        return False
    
    basic_fields = [
        ('name', 'full_name'),
        ('phone', 'mobile'),
        ('email', 'email'),
        ('city', 'city')
    ]
    detail_fields = ['company_name', 'net_salary', 'cibil_score', 'loan_amount_required', 'type_of_loan']
    
    basic_filled = sum(1 for f, fd in basic_fields if has_field(f, fd))
    detail_filled = sum(1 for f in detail_fields if file_details.get(f))
    
    completeness_score = (basic_filled / 4) * 12.5 + (detail_filled / 5) * 12.5
    score += completeness_score
    
    # 2. CIBIL Score (25 points)
    try:
        cibil = int(file_details.get('cibil_score') or 0)
        if cibil >= 750:
            score += 25
        elif cibil >= 700:
            score += 20
        elif cibil >= 650:
            score += 15
        elif cibil >= 600:
            score += 10
        elif cibil > 0:
            score += 5
    except (ValueError, TypeError):
        pass
    
    # 3. Income vs Loan Amount Ratio (20 points)
    try:
        net_salary = float(str(file_details.get('net_salary', 0)).replace(',', ''))
        loan_amount = float(str(file_details.get('loan_amount_required', 0)).replace(',', ''))
        if net_salary > 0 and loan_amount > 0:
            ratio = loan_amount / (net_salary * 60)
            if ratio <= 0.5:
                score += 20
            elif ratio <= 0.75:
                score += 15
            elif ratio <= 1.0:
                score += 10
            elif ratio <= 1.5:
                score += 5
        elif net_salary > 0:
            # Has salary but no loan amount - give partial credit
            score += 8
    except (ValueError, TypeError):
        pass
    
    # 4. Employment Stability (15 points)
    try:
        present_emp = int(file_details.get('present_employment_months') or 0)
        total_emp = int(file_details.get('total_employment_months') or 0)
        
        if present_emp >= 24 and total_emp >= 36:
            score += 15
        elif present_emp >= 12 and total_emp >= 24:
            score += 12
        elif present_emp >= 6 and total_emp >= 12:
            score += 8
        elif present_emp >= 3:
            score += 5
        elif file_details.get('company_name'):
            # Has company name - give partial credit
            score += 5
    except (ValueError, TypeError):
        if file_details.get('company_name'):
            score += 5
    
    # 5. Document Status (10 points) - based on file_status progression
    file_status = file_data.get('file_status', 'new')
    if file_status in ['disbursed']:
        score += 10
    elif file_status in ['approved', 'sanctioned']:
        score += 9
    elif file_status in ['login', 'underwriting', 'fi']:
        score += 7
    elif file_status in ['sent_to_bank', 'sent_for_login']:
        score += 5
    elif file_status in ['documents_collected', 'sent_for_eligibility']:
        score += 3
    elif file_status in ['documents_pending', 'contacted']:
        score += 1
    
    # 6. Existing Obligations / FOIR (5 points) - reduced weight
    try:
        foir = float(file_details.get('foir') or 0)
        if foir > 0:
            if foir <= 40:
                score += 5
            elif foir <= 50:
                score += 4
            elif foir <= 60:
                score += 2
        else:
            # If FOIR not available, give benefit of doubt
            score += 2
    except (ValueError, TypeError):
        score += 2  # Give partial credit if FOIR not available
    
    # Calculate star rating
    score = min(100, max(0, round(score)))
    if score >= 81:
        stars = 5
    elif score >= 61:
        stars = 4
    elif score >= 41:
        stars = 3
    elif score >= 21:
        stars = 2
    else:
        stars = 1
    
    return {
        'star_rating': stars,
        'star_score': score,
        'stars': stars,  # Alias for compatibility
        'score': score   # Alias for compatibility
    }


@router.get("/calculate-rating/{file_id}")
async def calculate_file_rating(file_id: str, current_user: dict = Depends(get_current_user)):
    """Calculate and optionally update the star rating for a file"""
    file_doc = await db.leads.find_one(lead_filter(file_id), {"_id": 0})
    if not file_doc:
        raise HTTPException(status_code=404, detail="File not found")
    
    rating = calculate_star_rating(file_doc)
    return rating


@router.put("/update-rating/{file_id}")
async def update_file_rating(file_id: str, current_user: dict = Depends(get_current_user)):
    """Calculate and update the star rating for a file"""
    file_doc = await db.leads.find_one(lead_filter(file_id), {"_id": 0})
    if not file_doc:
        raise HTTPException(status_code=404, detail="File not found")
    
    rating = calculate_star_rating(file_doc)
    
    await db.leads.update_one(
        lead_filter(file_id),
        {
            "$set": {
                "star_rating": rating['star_rating'],
                "star_score": rating['star_score'],
                "updated_at": datetime.now(timezone.utc).isoformat()
            }
        }
    )
    
    return {
        "message": "Rating updated",
        **rating
    }


@router.post("/recalculate-all-ratings")
async def recalculate_all_ratings(current_user: dict = Depends(require_admin)):
    """Recalculate star ratings for all files (admin only)"""
    all_files = await db.leads.find({"status": "file"}).to_list(10000)
    
    updated = 0
    for f in all_files:
        rating = calculate_star_rating(f)
        await db.leads.update_one(
            {"_id": f["_id"]},
            {
                "$set": {
                    "star_rating": rating['star_rating'],
                    "star_score": rating['star_score']
                }
            }
        )
        updated += 1
    
    return {
        "message": f"Recalculated ratings for {updated} files",
        "updated": updated
    }


# ============ DATA MIGRATION ============

class MigrationData(BaseModel):
    leads: Optional[List[dict]] = None
    files: Optional[List[dict]] = None  # Support both 'leads' and 'files' keys
    source: str = "crm_import"


def transform_old_crm_record(record: dict) -> dict:
    """
    Transform old CRM record to Connect format.
    Maps fields from old schema to new schema.
    """
    # Handle different field names from old CRM
    transformed = {
        "name": record.get("name") or record.get("fullName") or record.get("full_name") or "",
        "phone": str(record.get("phone") or record.get("mobile") or record.get("mobileNumber") or "").replace(" ", "").replace("-", ""),
        "email": record.get("email") or record.get("emailId") or "",
        "city": record.get("city") or record.get("location") or "",
        "requirement": record.get("requirement") or record.get("loanType") or record.get("type_of_loan") or "",
        "source": record.get("source") or record.get("leadSource") or "crm_import",
        "employment_type": record.get("employment_type") or record.get("employmentType") or "",
    }
    
    # Map file status - handle various old CRM status names
    old_status = str(record.get("status") or record.get("fileStatus") or record.get("file_status") or "new").lower()
    status_mapping = {
        "new": "new",
        "contacted": "contacted",
        "in progress": "contacted",
        "inprogress": "contacted",
        "query": "query",
        "hold": "hold",
        "on hold": "hold",
        "documents collected": "documents_collected",
        "docs collected": "documents_collected",
        "documents_collected": "documents_collected",
        "not eligible": "not_eligible",
        "noteligible": "not_eligible",
        "not_eligible": "not_eligible",
        "sent to bank": "sent_to_bank",
        "sent_to_bank": "sent_to_bank",
        "senttobank": "sent_to_bank",
        "login": "login",
        "logged in": "login",
        "not login": "not_login",
        "not_login": "not_login",
        "notlogin": "not_login",
        "approved": "approved",
        "sanctioned": "approved",
        "declined": "declined",
        "rejected": "rejected",
        "disbursed": "disbursed",
        "disbursement": "disbursed",
        "not disbursed": "not_disbursed",
        "not_disbursed": "not_disbursed",
        "fi negative": "fi_negative",
        "fi_negative": "fi_negative",
        "not interested": "not_interested",
        "not_interested": "not_interested",
        "supporting": "supporting",
    }
    transformed["file_status"] = status_mapping.get(old_status, "new")
    
    # Build file_details from various possible fields
    file_details = record.get("file_details") or record.get("fileDetails") or {}
    if not file_details:
        file_details = {
            "mother_name": record.get("motherName") or record.get("mother_name") or "",
            "current_address": record.get("currentAddress") or record.get("current_address") or record.get("address") or "",
            "company_name": record.get("companyName") or record.get("company_name") or record.get("company") or "",
            "net_salary": record.get("netSalary") or record.get("net_salary") or record.get("salary") or "",
            "office_address": record.get("officeAddress") or record.get("office_address") or "",
            "obligations_emi": record.get("obligationsEmi") or record.get("obligations_emi") or record.get("emi") or "",
            "existing_loan_1": record.get("existingLoan1") or record.get("existing_loan_1") or "",
            "existing_loan_2": record.get("existingLoan2") or record.get("existing_loan_2") or "",
            "existing_loan_3": record.get("existingLoan3") or record.get("existing_loan_3") or "",
            "type_of_loan": record.get("typeOfLoan") or record.get("type_of_loan") or record.get("loanType") or transformed["requirement"],
            "cibil_score": record.get("cibilScore") or record.get("cibil_score") or record.get("cibil") or "",
            "loan_amount_required": record.get("loanAmountRequired") or record.get("loan_amount_required") or record.get("loanAmount") or "",
            "tenure_required": record.get("tenureRequired") or record.get("tenure_required") or record.get("tenure") or "",
        }
    transformed["file_details"] = file_details
    
    # Copy eligibilities if present
    transformed["eligibilities"] = record.get("eligibilities") or record.get("bankEligibilities") or []
    
    # Copy activities/notes if present
    old_activities = record.get("file_activities") or record.get("activities") or record.get("notes") or []
    if isinstance(old_activities, list):
        transformed["file_activities"] = old_activities
    else:
        transformed["file_activities"] = []
    
    # Copy other metadata
    transformed["rating"] = record.get("rating") or record.get("stars") or 0
    transformed["score"] = record.get("score") or 0
    transformed["created_at"] = record.get("created_at") or record.get("createdAt") or record.get("dateCreated") or datetime.now(timezone.utc).isoformat()
    transformed["assigned_to"] = record.get("assigned_to") or record.get("assignedTo") or record.get("telecaller") or None
    transformed["file_assigned_to"] = record.get("file_assigned_to") or record.get("opsAssignedTo") or None
    
    return transformed


@router.post("/import")
async def import_crm_data(migration_data: MigrationData, current_user: dict = Depends(require_admin)):
    """
    Import leads/files from external CRM system.
    Accepts both 'leads' and 'files' keys in the JSON payload.
    Automatically transforms old CRM field names to Connect format.
    """
    # Support both 'leads' and 'files' keys
    records = migration_data.files or migration_data.leads or []
    
    if not records:
        raise HTTPException(status_code=400, detail="No data to import. Provide 'leads' or 'files' array.")
    
    imported_count = 0
    updated_count = 0
    skipped_count = 0
    errors = []
    
    for record in records:
        try:
            # Transform old CRM format to Connect format
            transformed = transform_old_crm_record(record)
            
            phone = transformed["phone"]
            if not phone:
                skipped_count += 1
                continue
            
            existing = await db.leads.find_one({"phone": phone})
            if existing:
                # Update existing lead with CRM data (merge, don't overwrite)
                update_data = {
                    "status": "file",
                    "file_status": transformed["file_status"],
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                    "import_source": migration_data.source
                }
                
                # Only update fields that have values
                if transformed["name"]:
                    update_data["name"] = transformed["name"]
                if transformed["email"]:
                    update_data["email"] = transformed["email"]
                if transformed["city"]:
                    update_data["city"] = transformed["city"]
                if transformed["requirement"]:
                    update_data["requirement"] = transformed["requirement"]
                if transformed["employment_type"]:
                    update_data["employment_type"] = transformed["employment_type"]
                if transformed["file_details"]:
                    # Merge file_details instead of replacing
                    existing_details = existing.get("file_details") or {}
                    merged_details = {**existing_details, **{k: v for k, v in transformed["file_details"].items() if v}}
                    update_data["file_details"] = merged_details
                if transformed["eligibilities"]:
                    update_data["eligibilities"] = transformed["eligibilities"]
                if transformed["rating"]:
                    update_data["rating"] = transformed["rating"]
                if transformed["score"]:
                    update_data["score"] = transformed["score"]
                if transformed["file_assigned_to"]:
                    update_data["file_assigned_to"] = transformed["file_assigned_to"]
                
                await db.leads.update_one({"phone": phone}, {"$set": update_data})
                updated_count += 1
            else:
                # Create new lead/file
                new_lead = {
                    "id": str(uuid.uuid4()),
                    "name": transformed["name"],
                    "phone": phone,
                    "email": transformed["email"],
                    "city": transformed["city"],
                    "requirement": transformed["requirement"],
                    "employment_type": transformed["employment_type"],
                    "source": transformed["source"],
                    "status": "file",
                    "file_status": transformed["file_status"],
                    "file_details": transformed["file_details"],
                    "eligibilities": transformed["eligibilities"],
                    "rating": transformed["rating"],
                    "score": transformed["score"],
                    "assigned_to": transformed["assigned_to"],
                    "file_assigned_to": transformed["file_assigned_to"],
                    "file_activities": transformed["file_activities"] + [{
                        "type": "import",
                        "message": f"Imported from {migration_data.source}",
                        "timestamp": datetime.now(timezone.utc).isoformat()
                    }],
                    "created_at": transformed["created_at"],
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                    "import_source": migration_data.source
                }
                await db.leads.insert_one(new_lead)
                imported_count += 1
                
        except Exception as e:
            errors.append({"phone": record.get("phone"), "error": str(e)})
            skipped_count += 1
    
    return {
        "success": True,
        "total_processed": len(records),
        "new_records": imported_count,
        "updated_records": updated_count,
        "skipped": skipped_count,
        "errors": errors[:20]  # Return first 20 errors
    }


@router.post("/import/upload")
async def import_crm_file(file: UploadFile = File(...), current_user: dict = Depends(require_admin)):
    """
    Import from uploaded JSON file (from export script).
    Accepts the JSON file generated by export_old_crm.py
    """
    import json
    
    if not file.filename.endswith('.json'):
        raise HTTPException(status_code=400, detail="Only JSON files are supported")
    
    try:
        content = await file.read()
        data = json.loads(content.decode('utf-8'))
        
        # Handle both direct array and wrapped format
        if isinstance(data, list):
            records = data
            source = "file_upload"
        elif isinstance(data, dict):
            records = data.get("files") or data.get("leads") or data.get("data") or []
            source = data.get("export_info", {}).get("source_database", "file_upload")
        else:
            raise HTTPException(status_code=400, detail="Invalid JSON format")
        
        if not records:
            raise HTTPException(status_code=400, detail="No records found in the file")
        
        # Use the import function
        migration_data = MigrationData(files=records, source=source)
        return await import_crm_data(migration_data, current_user)
        
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=400, detail=f"Invalid JSON: {str(e)}")


@router.get("/export")
async def export_files_data(file_status: Optional[str] = None, current_user: dict = Depends(require_admin)):
    """Export all files data for backup or migration"""
    query = {"status": "file"}
    if file_status:
        query["file_status"] = file_status
    
    files = await db.leads.find(query, {"_id": 0}).to_list(10000)
    
    return {
        "count": len(files),
        "files": json_safe(files),
        "exported_at": datetime.now(timezone.utc).isoformat()
    }


# ============ BANK POLICIES API ============
# Must be before /{file_id} routes

@router.get("/policies")
async def get_bank_policies(
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
    
    policies = await db.bank_policies.find(query, {"_id": 0}).sort("bank_name", 1).to_list(100)
    return {"policies": policies, "total": len(policies)}


@router.get("/policies/{policy_id}")
async def get_policy_by_id(policy_id: str, current_user: dict = Depends(get_current_user)):
    """Get a single policy by ID"""
    policy = await db.bank_policies.find_one({"id": policy_id}, {"_id": 0})
    if not policy:
        raise HTTPException(status_code=404, detail="Policy not found")
    return policy


@router.post("/policies")
async def create_policy(policy_data: dict, current_user: dict = Depends(require_admin)):
    """Create a new bank policy"""
    import uuid
    
    policy_data["id"] = str(uuid.uuid4())
    policy_data["created_at"] = datetime.now(timezone.utc).isoformat()
    policy_data["updated_at"] = datetime.now(timezone.utc).isoformat()
    policy_data["is_active"] = policy_data.get("is_active", True)
    
    await db.bank_policies.insert_one(policy_data)
    policy_data.pop("_id", None)
    return policy_data


@router.put("/policies/{policy_id}")
async def update_policy(policy_id: str, policy_data: dict, current_user: dict = Depends(require_admin)):
    """Update an existing bank policy"""
    existing = await db.bank_policies.find_one({"id": policy_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Policy not found")
    
    policy_data["updated_at"] = datetime.now(timezone.utc).isoformat()
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


@router.post("/check-eligibility")
async def check_eligibility(lead_data: dict, current_user: dict = Depends(get_current_user)):
    """
    Check eligibility against all active bank policies.
    Returns matching banks with eligibility details.
    """
    salary = float(lead_data.get("net_salary") or lead_data.get("additional_data", {}).get("net_salary") or 0)
    cibil = int(lead_data.get("cibil_score") or lead_data.get("additional_data", {}).get("cibil_score") or 0)
    company_type = lead_data.get("company_type") or lead_data.get("additional_data", {}).get("company_type") or ""
    loan_type = lead_data.get("requirement") or lead_data.get("loan_type") or "personal_loan"
    loan_amount = float(lead_data.get("loan_amount_required") or lead_data.get("additional_data", {}).get("loan_amount_required") or 0)
    
    policies = await db.bank_policies.find({"is_active": True}, {"_id": 0}).to_list(100)
    
    results = []
    for policy in policies:
        is_eligible = True
        reasons = []
        
        if policy.get("loan_types") and loan_type not in policy.get("loan_types", []):
            is_eligible = False
            reasons.append(f"Loan type {loan_type} not supported")
        
        if policy.get("min_salary") and salary < policy["min_salary"]:
            is_eligible = False
            reasons.append(f"Salary ₹{salary:,.0f} below minimum ₹{policy['min_salary']:,.0f}")
        
        if policy.get("min_cibil") and cibil > 0 and cibil < policy["min_cibil"]:
            is_eligible = False
            reasons.append(f"CIBIL {cibil} below minimum {policy['min_cibil']}")
        
        if policy.get("company_categories") and company_type:
            company_type_lower = company_type.lower()
            categories_lower = [c.lower() for c in policy.get("company_categories", [])]
            if company_type_lower not in categories_lower and "all" not in categories_lower:
                is_eligible = False
                reasons.append(f"Company type '{company_type}' not in allowed categories")
        
        if policy.get("max_loan_amount") and loan_amount > policy["max_loan_amount"]:
            is_eligible = False
            reasons.append(f"Loan amount ₹{loan_amount:,.0f} exceeds maximum ₹{policy['max_loan_amount']:,.0f}")
        
        eligible_amount = 0
        if is_eligible and salary > 0:
            max_foir = policy.get("max_foir", 50) / 100
            max_tenure = policy.get("max_tenure", 60)
            eligible_amount = min(salary * max_foir * max_tenure, policy.get("max_loan_amount", 10000000))
        
        results.append({
            "bank_name": policy.get("bank_name"),
            "is_eligible": is_eligible,
            "reasons": reasons if not is_eligible else [],
            "eligible_amount": eligible_amount if is_eligible else 0,
            "max_tenure": policy.get("max_tenure"),
            "roi_text": policy.get("roi_text"),
            "special_notes": policy.get("special_notes"),
            "required_documents": policy.get("required_documents", [])
        })
    
    results.sort(key=lambda x: (-int(x["is_eligible"]), -x["eligible_amount"]))
    
    return {
        "lead_summary": {"salary": salary, "cibil": cibil, "company_type": company_type, "loan_type": loan_type, "loan_amount": loan_amount},
        "eligible_banks": [r for r in results if r["is_eligible"]],
        "ineligible_banks": [r for r in results if not r["is_eligible"]],
        "total_eligible": len([r for r in results if r["is_eligible"]])
    }


# ============ COMMISSION MODULE - OLD CRM PORT ============

class CommissionCreate(BaseModel):
    lead_id: str
    source_id: str  # Growth Partner ID
    source_type: str = "agent"
    amount: float
    commission_type: Optional[str] = None  # login, approval, disbursal
    bank_name: Optional[str] = None
    disbursal_amount: Optional[float] = None
    commission_percentage: Optional[float] = None
    notes: Optional[str] = None

class CommissionUpdate(BaseModel):
    amount: Optional[float] = None
    commission_type: Optional[str] = None
    bank_name: Optional[str] = None
    notes: Optional[str] = None
    status: Optional[str] = None  # pending, approved, paid


@router.get("/commissions")
async def get_commissions(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    source_id: Optional[str] = None,
    status: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """
    Get commission records with filters - Admin/Ops reporting
    
    Returns:
    - Individual commission records
    - Aggregated totals by Growth Partner
    - Aggregated totals by Bank
    """
    from datetime import datetime, timezone
    
    # Build filter
    query = {}
    
    if source_id:
        query["source_id"] = source_id
    
    if status:
        query["status"] = status
    
    # Date filter
    if start_date or end_date:
        date_filter = {}
        if start_date:
            try:
                date_start = datetime.fromisoformat(start_date.replace('Z', '+00:00'))
                date_filter["$gte"] = date_start.isoformat()
            except (ValueError, TypeError):
                pass
        if end_date:
            try:
                date_end = datetime.fromisoformat(end_date.replace('Z', '+00:00'))
                date_filter["$lte"] = date_end.isoformat()
            except (ValueError, TypeError):
                pass
        if date_filter:
            query["created_at"] = date_filter
    
    # Get commission records
    commissions = await db.commissions.find(query, {"_id": 0}).sort("created_at", -1).to_list(5000)
    
    # Get user names for source_id mapping
    users = await db.users.find({}, {"_id": 0, "id": 1, "full_name": 1, "name": 1, "email": 1}).to_list(1000)
    user_map = {u.get('id'): u.get('full_name') or u.get('name') or u.get('email', '').split('@')[0] for u in users}
    
    # Aggregate by Growth Partner
    gp_totals = {}
    bank_totals = {}
    
    for c in commissions:
        # By Growth Partner
        gp_id = c.get('source_id')
        if gp_id:
            if gp_id not in gp_totals:
                # Prefer persisted source_name, fallback to user lookup, then ID
                persisted_name = c.get('source_name')
                gp_totals[gp_id] = {
                    'source_id': gp_id,
                    'source_name': persisted_name or user_map.get(gp_id, gp_id),
                    'total_amount': 0,
                    'count': 0
                }
            gp_totals[gp_id]['total_amount'] += c.get('amount', 0)
            gp_totals[gp_id]['count'] += 1
        
        # By Bank
        bank = c.get('bank_name', 'Unknown')
        if bank not in bank_totals:
            bank_totals[bank] = {
                'bank_name': bank,
                'total_amount': 0,
                'count': 0
            }
        bank_totals[bank]['total_amount'] += c.get('amount', 0)
        bank_totals[bank]['count'] += 1
    
    # Add source names to commission records
    # Prefer persisted source_name, fallback to dynamic lookup
    for c in commissions:
        if not c.get('source_name'):
            c['source_name'] = user_map.get(c.get('source_id'), c.get('source_id'))
    
    return {
        "commissions": commissions,
        "total": len(commissions),
        "total_amount": sum(c.get('amount', 0) for c in commissions),
        "by_growth_partner": sorted(gp_totals.values(), key=lambda x: -x['total_amount']),
        "by_bank": sorted(bank_totals.values(), key=lambda x: -x['total_amount']),
        "date_range": {
            "start_date": start_date,
            "end_date": end_date
        }
    }


@router.get("/commissions/summary")
async def get_commission_summary(current_user: dict = Depends(get_current_user)):
    """Get commission summary for dashboard"""
    
    # Get all commissions
    commissions = await db.commissions.find({}, {"_id": 0}).to_list(10000)
    
    total_amount = sum(c.get('amount', 0) for c in commissions)
    total_count = len(commissions)
    
    # Get pending commissions (from eligibilities where disbursed but commission not recorded)
    pipeline = [
        {"$match": {"status": "file", "eligibilities.disbursed": True}},
        {"$unwind": "$eligibilities"},
        {"$match": {"eligibilities.disbursed": True}},
        {"$group": {
            "_id": None,
            "pending_count": {"$sum": 1},
            "pending_amount": {"$sum": {"$ifNull": ["$eligibilities.disbursed_amount", 0]}}
        }}
    ]
    
    pending_result = await db.leads.aggregate(pipeline).to_list(1)
    pending_data = pending_result[0] if pending_result else {"pending_count": 0, "pending_amount": 0}
    
    return {
        "total_paid": total_amount,
        "total_count": total_count,
        "pending_count": pending_data.get("pending_count", 0),
        "pending_estimated": pending_data.get("pending_amount", 0) * 0.02  # Estimate 2% commission
    }


@router.post("/commissions")
async def create_commission(commission: CommissionCreate, current_user: dict = Depends(require_admin)):
    """Create a new commission record - Admin only"""
    
    # Snapshot source_name at creation time to persist even if user is deleted later
    source_name = None
    if commission.source_id:
        user = await db.users.find_one({"id": commission.source_id}, {"_id": 0, "full_name": 1, "name": 1, "email": 1})
        if user:
            source_name = user.get('full_name') or user.get('name') or user.get('email', '').split('@')[0]
        else:
            source_name = commission.source_id  # Fallback to ID if user not found
    
    commission_doc = {
        "id": str(uuid.uuid4()),
        **commission.dict(),
        "source_name": source_name,  # Persisted snapshot
        "status": "pending",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "created_by": current_user["id"]
    }
    
    await db.commissions.insert_one(commission_doc)
    
    # Also update the eligibility record if lead_id and bank_name provided
    if commission.lead_id and commission.bank_name:
        await db.leads.update_one(
            {"id": commission.lead_id, "eligibilities.bank_name": commission.bank_name},
            {
                "$set": {
                    "eligibilities.$.commission_amount": commission.amount,
                    "eligibilities.$.commission_percentage": commission.commission_percentage
                }
            }
        )
    
    return {"message": "Commission created", "id": commission_doc["id"]}


@router.put("/commissions/{commission_id}")
async def update_commission(commission_id: str, update: CommissionUpdate, current_user: dict = Depends(require_admin)):
    """Update commission record - Admin only"""
    
    update_data = {k: v for k, v in update.dict().items() if v is not None}
    update_data["updated_at"] = datetime.now(timezone.utc).isoformat()
    update_data["updated_by"] = current_user["id"]
    
    result = await db.commissions.update_one(
        {"id": commission_id},
        {"$set": update_data}
    )
    
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Commission not found")
    
    return {"message": "Commission updated"}


@router.delete("/commissions/{commission_id}")
async def delete_commission(commission_id: str, current_user: dict = Depends(require_admin)):
    """Delete commission record - Admin only"""
    
    result = await db.commissions.delete_one({"id": commission_id})
    
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Commission not found")
    
    return {"message": "Commission deleted"}


# ============ FILE DELETE - ADMIN ONLY ============

@router.delete("/{file_id}")
async def delete_file(file_id: str, current_user: dict = Depends(require_admin)):
    """
    Delete a file/lead record - Admin only.
    Also cleans up related records (activities, documents, commissions).
    """
    # Verify file exists
    file_doc = await db.leads.find_one(lead_filter(file_id), {"_id": 0})
    if not file_doc:
        raise HTTPException(status_code=404, detail="File not found")
    
    # Delete the file
    result = await db.leads.delete_one(lead_filter(file_id))
    
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="File not found or already deleted")
    
    # Clean up related records
    # Delete related commissions
    await db.commissions.delete_many({"lead_id": file_id})
    
    # Delete related activity logs
    await db.activity_logs.delete_many({"lead_id": file_id})
    
    # Log the deletion
    await db.activity_logs.insert_one({
        "id": str(uuid.uuid4()),
        "type": "file_deleted",
        "message": f"File '{file_doc.get('name', 'Unknown')}' deleted by {current_user.get('full_name', current_user.get('email', 'Admin'))}",
        "deleted_file_id": file_id,
        "deleted_file_name": file_doc.get('name'),
        "user_id": current_user.get('id'),
        "user_name": current_user.get('full_name', current_user.get('email')),
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "created_at": datetime.now(timezone.utc).isoformat()
    })
    
    return {
        "success": True,
        "message": f"File '{file_doc.get('name', 'Unknown')}' deleted successfully",
        "deleted_id": file_id
    }


# ============ BULK FILE DELETE - ADMIN ONLY ============

class BulkDeleteRequest(BaseModel):
    file_ids: List[str]

@router.post("/bulk-delete")
async def bulk_delete_files(request: BulkDeleteRequest, current_user: dict = Depends(require_admin)):
    """
    Bulk delete multiple files - Admin only.
    """
    if not request.file_ids:
        raise HTTPException(status_code=400, detail="No file IDs provided")
    
    if len(request.file_ids) > 100:
        raise HTTPException(status_code=400, detail="Maximum 100 files can be deleted at once")
    
    deleted_count = 0
    errors = []
    
    for file_id in request.file_ids:
        try:
            result = await db.leads.delete_one(lead_filter(file_id))
            if result.deleted_count > 0:
                deleted_count += 1
                # Clean up related records
                await db.commissions.delete_many({"lead_id": file_id})
                await db.activity_logs.delete_many({"lead_id": file_id})
        except Exception as e:
            errors.append(f"{file_id}: {str(e)}")
    
    # Log bulk deletion
    await db.activity_logs.insert_one({
        "id": str(uuid.uuid4()),
        "type": "bulk_file_deleted",
        "message": f"{deleted_count} files deleted by {current_user.get('full_name', current_user.get('email', 'Admin'))}",
        "deleted_count": deleted_count,
        "user_id": current_user.get('id'),
        "user_name": current_user.get('full_name', current_user.get('email')),
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "created_at": datetime.now(timezone.utc).isoformat()
    })
    
    return {
        "success": True,
        "deleted_count": deleted_count,
        "errors": errors if errors else None
    }


# ============ FILE BY ID ROUTES ============
# These must be after literal routes like /reports, /import, /export, /policies

@router.get("/{file_id}")
async def get_file_details(file_id: str, current_user: dict = Depends(get_current_user)):
    """Get detailed file information with enriched GP data and documents"""
    file_doc = await db.leads.find_one(lead_filter(file_id))
    if not file_doc:
        raise HTTPException(status_code=404, detail="File not found")
    file_doc.pop("_id", None)
    file_doc["id"] = file_doc.get("id") or file_id
    
    # Enrich with GP (source) information
    source_id = file_doc.get("source_id") or file_doc.get("assigned_to")
    if source_id:
        source_user = await db.users.find_one(
            {"id": source_id},
            {"_id": 0, "full_name": 1, "name": 1, "email": 1, "phone": 1, "employee_code": 1}
        )
        if source_user:
            # Set source_name for display
            file_doc["source_name"] = source_user.get("full_name") or source_user.get("name") or source_user.get("email", "").split("@")[0]
            # Add GP details to file_details
            if "file_details" not in file_doc:
                file_doc["file_details"] = {}
            file_doc["file_details"]["growth_partner_name"] = file_doc["source_name"]
            file_doc["file_details"]["growth_partner_code"] = source_user.get("employee_code") or source_id[:8]
            file_doc["file_details"]["growth_partner_contact"] = source_user.get("phone") or source_user.get("email", "")
    
    # Map file_documents to documents with download URLs
    file_documents = file_doc.get("file_documents", [])
    documents = []
    for doc in file_documents:
        doc_data = {
            "id": doc.get("file_id"),
            "name": doc.get("original_name") or doc.get("file_name", "Document"),
            "filename": doc.get("file_name"),
            "category": doc.get("category", "general"),
            "size": doc.get("size"),
            "uploaded_at": doc.get("uploaded_at"),
            "url": f"/api/files/{file_id}/documents/{doc.get('file_id')}/download"
        }
        documents.append(doc_data)
    file_doc["documents"] = documents
    
    return json_safe(file_doc)


@router.put("/{file_id}/details")
async def update_file_details(file_id: str, update_data: FileDetailsUpdate, current_user: dict = Depends(get_current_user)):
    """Update file customer details"""
    file_doc = await db.leads.find_one(lead_filter(file_id), {"_id": 0})
    if not file_doc:
        raise HTTPException(status_code=404, detail="File not found")
    
    update_dict = {}
    if update_data.full_name is not None:
        update_dict["name"] = update_data.full_name
    if update_data.mobile is not None:
        update_dict["phone"] = update_data.mobile
    if update_data.email is not None:
        update_dict["email"] = update_data.email
    if update_data.city is not None:
        update_dict["city"] = update_data.city
    if update_data.employment_type is not None:
        update_dict["employment_type"] = update_data.employment_type
    if update_data.requirement is not None:
        update_dict["requirement"] = update_data.requirement
    if update_data.additional_data is not None:
        existing_additional = file_doc.get("file_details", {}) or {}
        merged_additional = {**existing_additional, **update_data.additional_data}
        update_dict["file_details"] = merged_additional
    
    if not update_dict:
        return {"message": "No changes to update"}
    
    update_dict["updated_at"] = datetime.now(timezone.utc).isoformat()
    
    await db.leads.update_one(
        lead_filter(file_id),
        {
            "$set": update_dict,
            "$push": {
                "file_activities": {
                    "type": "details_update",
                    "message": "File details updated",
                    "timestamp": datetime.now(timezone.utc).isoformat()
                }
            }
        }
    )
    
    return {"message": "File details updated successfully"}


@router.put("/{file_id}/file-status")
async def update_file_status(file_id: str, status_update: FileStatusUpdate, current_user: dict = Depends(get_current_user)):
    """Update file CRM status"""
    if status_update.file_status not in FILE_STATUSES:
        raise HTTPException(status_code=400, detail=f"Invalid status. Valid: {', '.join(FILE_STATUSES)}")
    
    file_doc = await db.leads.find_one(lead_filter(file_id), {"_id": 0})
    if not file_doc:
        raise HTTPException(status_code=404, detail="File not found")
    
    await db.leads.update_one(
        lead_filter(file_id),
        {
            "$set": {
                "file_status": status_update.file_status,
                "updated_at": datetime.now(timezone.utc).isoformat()
            },
            "$push": {
                "file_activities": {
                    "type": "status_change",
                    "message": f"Status changed to {status_update.file_status}",
                    "timestamp": datetime.now(timezone.utc).isoformat()
                }
            }
        }
    )
    
    return {"message": "File status updated successfully"}


@router.post("/{file_id}/notes")
async def add_file_note(file_id: str, note_data: NoteAdd, current_user: dict = Depends(get_current_user)):
    """Add a note to a file"""
    result = await db.leads.update_one(
        lead_filter(file_id),
        {
            "$push": {
                "file_activities": {
                    "type": "note",
                    "message": note_data.note,
                    "timestamp": datetime.now(timezone.utc).isoformat()
                }
            },
            "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}
        }
    )
    
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail="File not found")
    
    return {"message": "Note added successfully"}


@router.put("/{file_id}/assign")
async def assign_file(file_id: str, assignment: FileAssignment, current_user: dict = Depends(get_current_user)):
    """Assign a file to an operations team member"""
    assignee = await db.users.find_one({"id": assignment.assigned_to}, {"_id": 0})
    if not assignee:
        raise HTTPException(status_code=404, detail="Assignee not found")
    
    file_doc = await db.leads.find_one(lead_filter(file_id), {"_id": 0})
    if not file_doc:
        raise HTTPException(status_code=404, detail="File not found")
    
    await db.leads.update_one(
        lead_filter(file_id),
        {
            "$set": {
                "file_assigned_to": assignment.assigned_to,
                "updated_at": datetime.now(timezone.utc).isoformat()
            },
            "$push": {
                "file_activities": {
                    "type": "assignment",
                    "message": f"File assigned to {assignee.get('full_name', 'Team Member')}",
                    "timestamp": datetime.now(timezone.utc).isoformat()
                }
            }
        }
    )
    
    return {"message": f"File assigned to {assignee.get('full_name')}", "assigned_to": assignment.assigned_to}


@router.put("/bulk-assign")
async def bulk_assign_files(assignment: BulkFileAssignment, current_user: dict = Depends(require_admin)):
    """Bulk assign multiple files to an operations team member - Admin only"""
    if not assignment.file_ids:
        raise HTTPException(status_code=400, detail="No files selected")
    
    assignee = await db.users.find_one({"id": assignment.assigned_to}, {"_id": 0})
    if not assignee:
        raise HTTPException(status_code=404, detail="Assignee not found")
    
    assigned_count = 0
    for file_id in assignment.file_ids:
        result = await db.leads.update_one(
            lead_filter(file_id),
            {
                "$set": {
                    "file_assigned_to": assignment.assigned_to,
                    "updated_at": datetime.now(timezone.utc).isoformat()
                },
                "$push": {
                    "file_activities": {
                        "type": "assignment",
                        "message": f"File assigned to {assignee.get('full_name')} (bulk)",
                        "timestamp": datetime.now(timezone.utc).isoformat()
                    }
                }
            }
        )
        if result.modified_count > 0:
            assigned_count += 1
    
    return {
        "message": f"{assigned_count} files assigned to {assignee.get('full_name')}",
        "assigned_count": assigned_count,
        "assigned_to": assignment.assigned_to
    }


@router.put("/{file_id}/eligibilities")
async def update_eligibilities(file_id: str, eligibility_update: EligibilityUpdate, current_user: dict = Depends(get_current_user)):
    """Update file bank eligibilities (up to 7 banks) - Admin/Ops only, GPs cannot modify"""
    # GP role restriction - GPs cannot update eligibilities (bank processing is Admin/Ops only)
    user_role = current_user.get('role')
    if is_gp(user_role) and not can_edit_bank_processing(user_role):
        raise HTTPException(status_code=403, detail="Growth Partners cannot modify bank eligibilities. Contact Admin/Ops for bank processing.")
    
    if len(eligibility_update.eligibilities) > 7:
        raise HTTPException(status_code=400, detail="Maximum 7 eligibilities allowed")
    
    file_doc = await db.leads.find_one(lead_filter(file_id), {"_id": 0})
    if not file_doc:
        raise HTTPException(status_code=404, detail="File not found")
    
    eligibilities_data = []
    for e in eligibility_update.eligibilities:
        elig_dict = e.dict()
        if elig_dict.get('disbursed') and elig_dict.get('disbursed_amount') and elig_dict.get('commission_percentage'):
            calculated_commission = round(
                (elig_dict['disbursed_amount'] * elig_dict['commission_percentage']) / 100, 2
            )
            elig_dict['commission_amount'] = calculated_commission
        eligibilities_data.append(elig_dict)
    
    await db.leads.update_one(
        lead_filter(file_id),
        {
            "$set": {
                "eligibilities": eligibilities_data,
                "updated_at": datetime.now(timezone.utc).isoformat()
            },
            "$push": {
                "file_activities": {
                    "type": "eligibility_update",
                    "message": f"Eligibilities updated ({len(eligibilities_data)} bank(s))",
                    "timestamp": datetime.now(timezone.utc).isoformat()
                }
            }
        }
    )
    
    return {"message": "Eligibilities updated successfully", "count": len(eligibilities_data)}


@router.get("/{file_id}/eligibilities")
async def get_eligibilities(file_id: str, current_user: dict = Depends(get_current_user)):
    """Get file eligibilities"""
    # First check if file exists (without projection that may return empty dict)
    file_exists = await db.leads.count_documents(lead_filter(file_id))
    if not file_exists:
        raise HTTPException(status_code=404, detail="File not found")
    
    file_doc = await db.leads.find_one(lead_filter(file_id), {"_id": 0, "eligibilities": 1})
    return json_safe(file_doc.get("eligibilities", [])) if file_doc else []


@router.get("/{file_id}/activities")
async def get_file_activities(file_id: str, current_user: dict = Depends(get_current_user)):
    """Get file activity log"""
    # First check if file exists (without projection that may return empty dict)
    file_exists = await db.leads.count_documents(lead_filter(file_id))
    if not file_exists:
        raise HTTPException(status_code=404, detail="File not found")
    
    file_doc = await db.leads.find_one(lead_filter(file_id), {"_id": 0, "file_activities": 1})
    return json_safe(file_doc.get("file_activities", [])) if file_doc else []


# File Storage Routes - Using GridFS for persistent storage
@router.post("/{file_id}/upload")
async def upload_document(
    file_id: str,
    file: UploadFile = File(...),
    document_type: str = "general",
    current_user: dict = Depends(get_current_user)
):
    """Upload a document for a file - stored in MongoDB GridFS"""
    file_ext = Path(file.filename).suffix.lower()
    if file_ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"File type '{file_ext}' not allowed. Allowed: PDF, Images, DOC, XLS"
        )
    
    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="File too large. Maximum 10MB")
    
    try:
        doc_id = str(uuid.uuid4())
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        safe_name = f"{document_type}_{timestamp}_{doc_id}{file_ext}"
        
        # Store in GridFS
        fs_bucket = await get_gridfs_bucket()
        grid_id = await fs_bucket.upload_from_stream(
            safe_name,
            content,
            metadata={
                "file_id": file_id,
                "doc_id": doc_id,
                "original_name": file.filename,
                "document_type": document_type,
                "mime_type": file.content_type
            }
        )
        
        doc_data = {
            "file_id": doc_id,
            "grid_id": str(grid_id),
            "file_name": safe_name,
            "original_name": file.filename,
            "size": len(content),
            "mime_type": file.content_type,
            "document_type": document_type,
            "uploaded_at": datetime.now(timezone.utc).isoformat()
        }
        
        await db.leads.update_one(
            lead_filter(file_id),
            {
                "$push": {"file_documents": doc_data},
                "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}
            }
        )
        
        return {"success": True, **doc_data}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to upload: {str(e)}")



@router.post("/{file_id}/documents")
async def upload_documents(
    file_id: str,
    files: List[UploadFile] = File(...),
    category: str = "general",
    current_user: dict = Depends(get_current_user)
):
    """Upload multiple documents for a file - stored in MongoDB GridFS"""
    uploaded = []
    errors = []
    
    for file in files:
        file_ext = Path(file.filename).suffix.lower()
        if file_ext not in ALLOWED_EXTENSIONS:
            errors.append(f"'{file.filename}' - type not allowed")
            continue
        
        content = await file.read()
        if len(content) > MAX_FILE_SIZE:
            errors.append(f"'{file.filename}' - too large (max 10MB)")
            continue
        
        try:
            doc_id = str(uuid.uuid4())
            timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
            safe_name = f"{category}_{timestamp}_{doc_id}{file_ext}"
            
            # Store in GridFS
            fs_bucket = await get_gridfs_bucket()
            grid_id = await fs_bucket.upload_from_stream(
                safe_name,
                content,
                metadata={
                    "file_id": file_id,
                    "doc_id": doc_id,
                    "original_name": file.filename,
                    "category": category,
                    "mime_type": file.content_type
                }
            )
            
            doc_data = {
                "file_id": doc_id,
                "grid_id": str(grid_id),
                "file_name": safe_name,
                "original_name": file.filename,
                "size": len(content),
                "mime_type": file.content_type,
                "category": category,
                "uploaded_at": datetime.now(timezone.utc).isoformat()
            }
            
            await db.leads.update_one(
                lead_filter(file_id),
                {
                    "$push": {"file_documents": doc_data},
                    "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}
                }
            )
            
            uploaded.append(doc_data)
        except Exception as e:
            errors.append(f"'{file.filename}' - {str(e)}")
    
    return {
        "success": len(uploaded) > 0,
        "uploaded": uploaded,
        "errors": errors if errors else None
    }



@router.get("/{file_id}/documents")
async def list_file_documents(file_id: str):
    """List all documents for a file"""
    # First check if file exists (without projection that may return empty dict)
    file_exists = await db.leads.count_documents(lead_filter(file_id))
    if not file_exists:
        raise HTTPException(status_code=404, detail="File not found")
    
    file_doc = await db.leads.find_one(lead_filter(file_id), {"_id": 0, "file_documents": 1})
    return file_doc.get("file_documents", []) if file_doc else []


@router.get("/download/{doc_id}")
async def download_document(doc_id: str, current_user: dict = Depends(get_current_user)):
    """Download a document from GridFS"""
    from fastapi.responses import StreamingResponse
    import io
    
    # Find document metadata
    file_doc = await db.leads.find_one(
        {"file_documents.file_id": doc_id},
        {"_id": 0, "file_documents.$": 1}
    )
    
    if not file_doc or not file_doc.get("file_documents"):
        raise HTTPException(status_code=404, detail="Document not found")
    
    doc = file_doc["file_documents"][0]
    grid_id = doc.get("grid_id")
    
    if not grid_id:
        raise HTTPException(status_code=404, detail="Document file not found")
    
    try:
        fs_bucket = await get_gridfs_bucket()
        grid_out = await fs_bucket.open_download_stream(ObjectId(grid_id))
        content = await grid_out.read()
        
        return StreamingResponse(
            io.BytesIO(content),
            media_type=doc.get("mime_type", "application/octet-stream"),
            headers={"Content-Disposition": f"attachment; filename={doc.get('original_name', 'document')}"}
        )
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"Document not found: {str(e)}")


@router.get("/{file_id}/documents/{doc_id}/download")
async def download_file_document(file_id: str, doc_id: str, current_user: dict = Depends(get_current_user)):
    """Download a specific document for a file"""
    from fastapi.responses import StreamingResponse
    import io
    
    # Find document metadata within the file
    file_doc = await db.leads.find_one(
        lead_filter(file_id, **{"file_documents.file_id": doc_id}),
        {"_id": 0, "file_documents.$": 1}
    )
    
    if not file_doc or not file_doc.get("file_documents"):
        raise HTTPException(status_code=404, detail="Document not found")
    
    doc = file_doc["file_documents"][0]
    grid_id = doc.get("grid_id")
    
    if not grid_id:
        raise HTTPException(status_code=404, detail="Document file not found in storage")
    
    try:
        fs_bucket = await get_gridfs_bucket()
        grid_out = await fs_bucket.open_download_stream(ObjectId(grid_id))
        content = await grid_out.read()
        
        filename = doc.get("original_name") or doc.get("file_name", "document")
        
        return StreamingResponse(
            io.BytesIO(content),
            media_type=doc.get("mime_type", "application/octet-stream"),
            headers={"Content-Disposition": f"attachment; filename={filename}"}
        )
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"Failed to download document: {str(e)}")




@router.delete("/{file_id}/documents/{doc_id}")
async def delete_document(file_id: str, doc_id: str, current_user: dict = Depends(get_current_user)):
    """Delete a document"""
    
    file_doc = await db.leads.find_one(lead_filter(file_id), {"_id": 0, "file_documents": 1})
    if not file_doc:
        raise HTTPException(status_code=404, detail="File not found")
    
    documents = file_doc.get("file_documents", [])
    doc = next((d for d in documents if d.get("file_id") == doc_id), None)
    
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    
    # Delete from GridFS
    grid_id = doc.get("grid_id")
    if grid_id:
        try:
            fs_bucket = await get_gridfs_bucket()
            await fs_bucket.delete(ObjectId(grid_id))
        except Exception:
            pass  # File might already be deleted
    
    # Remove from database
    await db.leads.update_one(
        lead_filter(file_id),
        {
            "$pull": {"file_documents": {"file_id": doc_id}},
            "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}
        }
    )
    
    return {"success": True, "message": "Document deleted"}



@router.get("/{file_id}/documents/download-all")
async def download_all_documents(file_id: str, current_user: dict = Depends(get_current_user)):
    """Download all documents for a file as a ZIP archive"""
    from fastapi.responses import StreamingResponse
    import io
    import zipfile
    
    file_doc = await db.leads.find_one(lead_filter(file_id), {"_id": 0, "file_documents": 1, "name": 1})
    if not file_doc:
        raise HTTPException(status_code=404, detail="File not found")
    
    documents = file_doc.get("file_documents", [])
    if not documents:
        raise HTTPException(status_code=404, detail="No documents to download")
    
    # Create ZIP in memory
    zip_buffer = io.BytesIO()
    
    try:
        fs_bucket = await get_gridfs_bucket()
        
        with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zip_file:
            for doc in documents:
                grid_id = doc.get("grid_id")
                if not grid_id:
                    continue
                    
                try:
                    grid_out = await fs_bucket.open_download_stream(ObjectId(grid_id))
                    content = await grid_out.read()
                    filename = doc.get("original_name") or doc.get("file_name", f"document_{doc.get('file_id')}")
                    zip_file.writestr(filename, content)
                except Exception:
                    continue  # Skip files that can't be downloaded
        
        zip_buffer.seek(0)
        customer_name = file_doc.get("name", "documents").replace(" ", "_")
        
        return StreamingResponse(
            zip_buffer,
            media_type="application/zip",
            headers={"Content-Disposition": f"attachment; filename={customer_name}_documents.zip"}
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create ZIP: {str(e)}")



# Dashboard stats for Files - Following OLD CRM Exact Calculation Logic
# This logic applies to ALL files (both legacy imported and new Connect-originated files)
@router.get("/dashboard/stats")
async def get_files_dashboard_stats(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    assigned_to: Optional[str] = None,
    search: Optional[str] = None,
    file_status: Optional[str] = None,
    gp_id: Optional[str] = None,
    tl_id: Optional[str] = None,
    manager_id: Optional[str] = None,
    loan_types: Optional[str] = None,
    activity_start_date: Optional[str] = None,
    activity_end_date: Optional[str] = None,
    team_view: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """
    Get dashboard statistics for files following the OLD CRM exact calculation logic.
    This calculation applies to ALL files - both legacy CRM imports and new Connect files.
    
    Supports:
    - start_date/end_date: Date range filter on created_at
    - assigned_to: Filter by GP
    - search: Text search on name/mobile/email
    - Role-based filtering: GPs only see their own files
    
    KEY RULES (traced from legacy CRM):
    - Total Files: COUNT all files with status='file'
    - New: COUNT WHERE current file_status = 'new'
    - In Progress: COUNT WHERE current file_status IN [documents_pending, sent_for_eligibility, 
      sent_for_login, query_hold, underwriting, fi, sent_to_bank, fi_reinitiated, login, 
      contacted, documents_collected]
    - Login: COUNT files that EVER reached login-level status (via activities) OR have 
      login_done=yes in eligibilities (HISTORICAL count, not current status)
    - Approved: COUNT files that EVER reached approved status (via activities) OR have 
      approval_status=approved in eligibilities (HISTORICAL count)
    - Total Approved: SUM of file_details.loan_amount_required for all Approved files
    - Disbursed: COUNT files that EVER reached disbursed status (via activities) OR have 
      disbursed=yes in eligibilities (HISTORICAL count)
    - Total Disbursed: SUM of file_details.loan_amount_required for all Disbursed files
    - Interim Rejects: COUNT WHERE current status IN [fi_negative, declined, 
      customer_not_interested, customer_not_supporting]
    - Final Rejections: COUNT WHERE current status IN [rejected, not_eligible, not_login, 
      not_disbursed]
    - Pipeline: SUM of eligible_amount from eligibilities where login_done=yes AND 
      disbursed!=yes AND file not in final rejected state
    - Loans by Type: GROUP BY file_details.type_of_loan (NOT the requirement field)
    
    IMPORTANT: Login/Approved/Disbursed are HISTORICAL counts - they count files that 
    EVER reached those stages, even if the current status has changed (e.g., to rejected).
    """
    from datetime import datetime, timezone
    
    # Status category definitions (traced from OLD CRM - these apply to ALL files, legacy and new)
    # In Progress: Files actively being processed (includes 'login' status)
    IN_PROGRESS_STATUSES = ['documents_pending', 'sent_for_eligibility', 'sent_for_login', 
                            'query_hold', 'underwriting', 'fi', 'sent_to_bank', 'fi_reinitiated',
                            'login', 'contacted', 'documents_collected']
    # Login and Beyond: Statuses that indicate file reached login stage at some point
    LOGIN_AND_BEYOND = ['login', 'approved', 'disbursed', 'declined', 'not_disbursed', 
                        'fi_negative', 'sanctioned', 'underwriting', 'fi']
    # Approved statuses: File was approved (may or may not be disbursed yet)
    APPROVED_STATUSES = ['approved', 'disbursed', 'not_disbursed', 'sanctioned']
    # Interim Rejects: Temporary/soft rejections that can potentially be revived
    INTERIM_REJECTS = ['fi_negative', 'declined', 'customer_not_interested', 'customer_not_supporting']
    # Final Rejections: Terminal rejection states
    FINAL_REJECTIONS = ['rejected', 'not_eligible', 'not_login', 'not_disbursed']
    
    def ever_had_status_via_activities(activities, current_status, target_statuses):
        """Check if file ever reached any of the target statuses via activities or current status"""
        if current_status in target_statuses:
            return True
        for act in activities:
            if act.get('type') == 'status_change':
                msg = str(act.get('message', '')).lower()
                for ts in target_statuses:
                    if f'to {ts}' in msg:
                        return True
        return False
    
    def is_login_done(elig):
        """Check if eligibility has login_done=yes"""
        login_done = elig.get('login_done')
        return login_done == True or (isinstance(login_done, str) and login_done.lower() in ['yes', 'true'])
    
    def is_disbursed_elig(elig):
        """Check if eligibility has disbursed=yes"""
        disbursed = elig.get('disbursed')
        return disbursed == True or (isinstance(disbursed, str) and disbursed.lower() in ['yes', 'true'])
    
    # Same shared builder as the Files list, so identical filters = identical population
    query = await build_files_query(
        db, current_user,
        file_status=file_status,
        gp_id=gp_id,
        tl_id=tl_id,
        manager_id=manager_id,
        assigned_to=assigned_to,
        loan_types=loan_types,
        search=search,
        start_date=start_date,
        end_date=end_date,
        activity_start_date=activity_start_date,
        activity_end_date=activity_end_date,
        team_view=(team_view == 'true'),
    )
    if query is None:
        return EMPTY_DASHBOARD_STATS()
    
    all_files = await db.leads.find(query).to_list(10000)
    
    # Initialize metrics
    total_files = len(all_files)
    new_count = 0
    in_progress_count = 0
    login_count = 0
    approved_count = 0
    disbursed_count = 0
    interim_rejects = 0
    final_rejections = 0
    
    total_approved_amount = 0.0
    total_disbursed_amount = 0.0
    pipeline_amount = 0.0
    
    # Status counts for breakdown
    status_counts = {}
    
    # Loans by Type (using file_details.type_of_loan)
    loans_by_type = {}
    
    for f in all_files:
        file_status = (f.get('file_status') or 'new').lower()
        status_counts[file_status] = status_counts.get(file_status, 0) + 1
        
        # Get activities
        activities = f.get('file_activities', []) or f.get('activities', [])
        if not isinstance(activities, list):
            activities = []
        
        # Get eligibilities
        eligibilities = f.get('eligibilities', []) or []
        if not isinstance(eligibilities, list):
            eligibilities = []
        
        # Get file_details for amounts and loan type
        file_details = f.get('file_details', {}) or {}
        if not isinstance(file_details, dict):
            file_details = {}
        
        # Get loan_amount_required for approved/disbursed amounts
        loan_amount_required = 0.0
        try:
            loan_amount_required = float(file_details.get('loan_amount_required') or 0)
        except (ValueError, TypeError):
            pass
        
        # Loans by Type (using type_of_loan from file_details)
        type_of_loan = file_details.get('type_of_loan', '').strip()
        if type_of_loan:
            loans_by_type[type_of_loan] = loans_by_type.get(type_of_loan, 0) + 1
        
        # NEW: Current status is 'new'
        if file_status == 'new':
            new_count += 1
        
        # IN PROGRESS: Current status in IN_PROGRESS_STATUSES
        if file_status in IN_PROGRESS_STATUSES:
            in_progress_count += 1
        
        # LOGIN: File ever reached login-level status OR has login_done=yes in eligibilities
        file_logged = ever_had_status_via_activities(activities, file_status, LOGIN_AND_BEYOND)
        if not file_logged:
            for elig in eligibilities:
                if is_login_done(elig):
                    file_logged = True
                    break
        if file_logged:
            login_count += 1
        
        # APPROVED: File ever reached approved status OR has approval_status=approved in eligibilities
        file_approved = ever_had_status_via_activities(activities, file_status, APPROVED_STATUSES)
        if not file_approved:
            for elig in eligibilities:
                if elig.get('approval_status') == 'approved':
                    file_approved = True
                    break
        if file_approved:
            approved_count += 1
            total_approved_amount += loan_amount_required  # Use loan_amount_required, not eligibility amount
        
        # DISBURSED: File ever reached disbursed status OR has disbursed=yes in eligibilities
        file_disbursed = ever_had_status_via_activities(activities, file_status, ['disbursed'])
        if not file_disbursed:
            for elig in eligibilities:
                if is_disbursed_elig(elig):
                    file_disbursed = True
                    break
        if file_disbursed:
            disbursed_count += 1
            total_disbursed_amount += loan_amount_required  # Use loan_amount_required
        
        # INTERIM REJECTS: Current status in INTERIM_REJECTS
        if file_status in INTERIM_REJECTS:
            interim_rejects += 1
        
        # FINAL REJECTIONS: Current status in FINAL_REJECTIONS
        if file_status in FINAL_REJECTIONS:
            final_rejections += 1
        
        # PIPELINE: Files with login_done=yes in eligibilities but not yet disbursed and not final rejected
        if file_status not in FINAL_REJECTIONS + ['disbursed']:
            for elig in eligibilities:
                if is_login_done(elig) and not is_disbursed_elig(elig):
                    try:
                        pipeline_amount += float(elig.get('eligible_amount') or 0)
                    except (ValueError, TypeError):
                        pass
    
    return {
        "total_files": total_files,
        "by_status": status_counts,
        # Row 1 stats
        "new": new_count,
        "in_progress": in_progress_count,
        "login": login_count,
        "login_current": login_count,
        "login_spillover": 0,
        "approved": approved_count,
        "approved_current": approved_count,
        "approved_spillover": 0,
        "total_approved_amount": total_approved_amount,
        # Row 2 stats
        "disbursed": disbursed_count,
        "disbursed_current": disbursed_count,
        "disbursed_spillover": 0,
        "total_disbursed_amount": total_disbursed_amount,
        "interim_rejects": interim_rejects,
        "interim_rejects_current": interim_rejects,
        "interim_rejects_spillover": 0,
        "final_rejections": final_rejections,
        "final_rejections_current": final_rejections,
        "final_rejections_spillover": 0,
        "amt_in_pipeline": pipeline_amount,
        # Loans by Type (using type_of_loan)
        "loans_by_type": loans_by_type,
        # Legacy fields for backwards compatibility
        "contacted": status_counts.get("contacted", 0),
        "documents_collected": status_counts.get("documents_collected", 0),
        "sent_to_bank": status_counts.get("sent_to_bank", 0),
        "rejected": status_counts.get("rejected", 0)
    }


# Bank Performance Report
@router.get("/reports/bank-performance")
async def get_bank_performance(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """
    Get bank-wise performance breakdown from eligibilities.
    
    For each bank:
    - Logins: COUNT eligibilities where login_done='yes' (or has approval/disbursal)
    - Approvals: COUNT eligibilities where approval_status='approved' AND approved_at in range
    - Disbursals: COUNT eligibilities where disbursed='yes' AND disbursed_at in range
    - Disbursal Amount: SUM disbursed_amount for disbursed eligibilities
    """
    from datetime import datetime, timezone
    
    # Build base query with GP filtering
    base_query = {"status": "file"}
    user_role = current_user.get('role')
    if is_gp(user_role):
        gp_id = current_user.get('id')
        base_query["$or"] = [
            {"assigned_to": gp_id},
            {"file_assigned_to": gp_id},
            {"source_id": gp_id}
        ]
    
    # Parse date range
    is_all_time = not start_date and not end_date
    date_start = None
    date_end = None
    
    if start_date:
        try:
            date_start = datetime.fromisoformat(start_date.replace('Z', '+00:00'))
            if date_start.tzinfo is None:
                date_start = date_start.replace(tzinfo=timezone.utc)
        except (ValueError, TypeError):
            date_start = datetime.strptime(start_date, '%Y-%m-%d').replace(tzinfo=timezone.utc)
    
    if end_date:
        try:
            date_end = datetime.fromisoformat(end_date.replace('Z', '+00:00'))
            if date_end.tzinfo is None:
                date_end = date_end.replace(hour=23, minute=59, second=59, tzinfo=timezone.utc)
        except (ValueError, TypeError):
            date_end = datetime.strptime(end_date, '%Y-%m-%d').replace(hour=23, minute=59, second=59, tzinfo=timezone.utc)
    
    def parse_timestamp(ts):
        if not ts:
            return None
        if isinstance(ts, datetime):
            if ts.tzinfo is None:
                return ts.replace(tzinfo=timezone.utc)
            return ts
        try:
            dt = datetime.fromisoformat(ts.replace('Z', '+00:00'))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt
        except (ValueError, TypeError, AttributeError):
            return None
    
    def is_in_date_range(ts):
        if is_all_time:
            return True
        dt = parse_timestamp(ts)
        if not dt:
            return False
        if date_start and dt < date_start:
            return False
        if date_end and dt > date_end:
            return False
        return True
    
    def is_login_done(elig):
        login_done = elig.get('login_done')
        return login_done == True or (isinstance(login_done, str) and login_done.lower() in ['yes', 'true'])
    
    def is_disbursed(elig):
        disbursed = elig.get('disbursed')
        return disbursed == True or (isinstance(disbursed, str) and disbursed.lower() in ['yes', 'true'])
    
    # Bank stats aggregation
    bank_stats = {}
    
    all_files = await db.leads.find(base_query).to_list(10000)
    
    for f in all_files:
        for elig in (f.get('eligibilities') or []):
            bank_name = elig.get('bank_name')
            if not bank_name:
                continue
            
            if bank_name not in bank_stats:
                bank_stats[bank_name] = {
                    'bank_name': bank_name,
                    'logins': 0,
                    'approvals': 0,
                    'disbursals': 0,
                    'approved_amount': 0.0,
                    'disbursed_amount': 0.0
                }
            
            # Logins: login_done=yes OR has approval OR has disbursal
            if is_login_done(elig) or elig.get('approval_status') in ['approved', 'declined'] or is_disbursed(elig):
                bank_stats[bank_name]['logins'] += 1
            
            # Approvals: approval_status='approved' AND (All Time OR approved_at in range)
            approved_at = elig.get('approved_at')
            if elig.get('approval_status') == 'approved':
                if is_all_time or is_in_date_range(approved_at):
                    bank_stats[bank_name]['approvals'] += 1
                    try:
                        bank_stats[bank_name]['approved_amount'] += float(elig.get('approved_amount') or 0)
                    except (ValueError, TypeError):
                        pass
            
            # Disbursals: disbursed='yes' AND (All Time OR disbursed_at in range)
            disbursed_at = elig.get('disbursed_at')
            if is_disbursed(elig):
                if is_all_time or is_in_date_range(disbursed_at):
                    bank_stats[bank_name]['disbursals'] += 1
                    try:
                        bank_stats[bank_name]['disbursed_amount'] += float(elig.get('disbursed_amount') or 0)
                    except (ValueError, TypeError):
                        pass
    
    # Sort by disbursed amount descending
    banks = sorted(bank_stats.values(), key=lambda x: -x['disbursed_amount'])
    
    return {
        "banks": banks,
        "total_banks": len(banks),
        "date_range": {
            "start_date": start_date,
            "end_date": end_date,
            "is_all_time": is_all_time
        }
    }


# TAT (Turnaround Time) Metrics
@router.get("/reports/tat-metrics")
async def get_tat_metrics(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """
    Calculate Turnaround Time metrics:
    - Lead-to-Login: login_done_at - created_at
    - Login-to-Approval: approved_at - login_done_at
    - Approval-to-Disbursal: disbursed_at - approved_at
    - Lead-to-Disbursal: disbursed_at - created_at
    
    Returns: Average, Mode (most frequent bucket), Distribution buckets
    """
    from datetime import datetime, timezone
    from collections import Counter
    
    def parse_timestamp(ts):
        if not ts:
            return None
        if isinstance(ts, datetime):
            return ts
        try:
            return datetime.fromisoformat(ts.replace('Z', '+00:00'))
        except (ValueError, TypeError, AttributeError):
            return None
    
    def days_between(start, end):
        """Calculate days between two timestamps"""
        start_dt = parse_timestamp(start)
        end_dt = parse_timestamp(end)
        if not start_dt or not end_dt:
            return None
        diff = end_dt - start_dt
        return max(0, diff.days)
    
    def get_bucket(days):
        """Get bucket label for days"""
        if days is None:
            return None
        if days == 0:
            return "Same day"
        elif days == 1:
            return "1 day"
        elif days <= 3:
            return "2-3 days"
        elif days <= 7:
            return "4-7 days"
        elif days <= 14:
            return "1-2 weeks"
        elif days <= 30:
            return "2-4 weeks"
        else:
            return "30+ days"
    
    # Initialize TAT data
    lead_to_login = []
    login_to_approval = []
    approval_to_disbursal = []
    lead_to_disbursal = []
    
    all_files = await db.leads.find({"status": "file"}).to_list(10000)
    
    for f in all_files:
        created_at = f.get('created_at')
        
        for elig in (f.get('eligibilities') or []):
            login_done_at = elig.get('login_done_at')
            approved_at = elig.get('approved_at')
            disbursed_at = elig.get('disbursed_at')
            
            # Lead-to-Login
            if login_done_at and created_at:
                days = days_between(created_at, login_done_at)
                if days is not None:
                    lead_to_login.append(days)
            
            # Login-to-Approval
            if approved_at and login_done_at:
                days = days_between(login_done_at, approved_at)
                if days is not None:
                    login_to_approval.append(days)
            
            # Approval-to-Disbursal
            if disbursed_at and approved_at:
                days = days_between(approved_at, disbursed_at)
                if days is not None:
                    approval_to_disbursal.append(days)
            
            # Lead-to-Disbursal
            if disbursed_at and created_at:
                days = days_between(created_at, disbursed_at)
                if days is not None:
                    lead_to_disbursal.append(days)
    
    def calculate_stats(days_list):
        if not days_list:
            return {
                "count": 0,
                "average": None,
                "mode": None,
                "mode_bucket": None,
                "distribution": {}
            }
        
        avg = sum(days_list) / len(days_list)
        mode = Counter(days_list).most_common(1)[0][0] if days_list else None
        
        # Calculate bucket distribution
        buckets = Counter([get_bucket(d) for d in days_list])
        distribution = dict(buckets.most_common())
        
        return {
            "count": len(days_list),
            "average": round(avg, 1),
            "mode": mode,
            "mode_bucket": get_bucket(mode),
            "distribution": distribution
        }
    
    return {
        "lead_to_login": calculate_stats(lead_to_login),
        "login_to_approval": calculate_stats(login_to_approval),
        "approval_to_disbursal": calculate_stats(approval_to_disbursal),
        "lead_to_disbursal": calculate_stats(lead_to_disbursal)
    }


# Growth Partner Report - OLD CRM COMPLETE PORT
# Preserves: From/To Manager, Files Generated, In Progress, Login, Approved, Disbursed, Disbursed Amount, Current/Spillover logic
@router.get("/reports/growth-partner")
async def get_growth_partner_report(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    manager_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """
    Growth Partner Performance Report - COMPLETE OLD CRM PORT
    
    Preserves:
    - From/To Manager filter
    - Files Generated: COUNT WHERE source_id = GP AND created_at IN date_range (CURRENT)
                       + COUNT WHERE file was active with GP in date_range (SPILLOVER)
    - In Progress: Active files not yet at terminal status
    - Login: COUNT files that reached login-level status
    - Approved: COUNT files approved
    - Disbursed: COUNT files disbursed
    - Disbursed Amount: SUM disbursed_amount
    - Current vs Spillover: 
        * CURRENT = file created within date range
        * SPILLOVER = file created before date range but had activity/milestone within date range
    
    Historical performance uses ownership at EVENT TIME, not today's assignment.
    """
    from datetime import datetime, timezone
    
    # Parse date range
    is_all_time = not start_date and not end_date
    date_start = None
    date_end = None
    
    if start_date:
        try:
            date_start = datetime.fromisoformat(start_date.replace('Z', '+00:00'))
        except (ValueError, TypeError):
            date_start = datetime.strptime(start_date, '%Y-%m-%d').replace(tzinfo=timezone.utc)
        if date_start.tzinfo is None:
            date_start = date_start.replace(tzinfo=timezone.utc)
    
    if end_date:
        try:
            date_end = datetime.fromisoformat(end_date.replace('Z', '+00:00'))
        except (ValueError, TypeError):
            date_end = datetime.strptime(end_date, '%Y-%m-%d').replace(hour=23, minute=59, second=59, tzinfo=timezone.utc)
        if date_end.tzinfo is None:
            date_end = date_end.replace(hour=23, minute=59, second=59, tzinfo=timezone.utc)
    
    def parse_timestamp(ts):
        if not ts:
            return None
        if isinstance(ts, datetime):
            if ts.tzinfo is None:
                return ts.replace(tzinfo=timezone.utc)
            return ts
        try:
            dt = datetime.fromisoformat(ts.replace('Z', '+00:00'))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt
        except (ValueError, TypeError, AttributeError):
            return None
    
    def is_in_date_range(ts):
        if is_all_time:
            return True
        dt = parse_timestamp(ts)
        if not dt:
            return False
        if date_start and dt < date_start:
            return False
        if date_end and dt > date_end:
            return False
        return True
    
    def is_before_date_range(ts):
        """Check if timestamp is before the date range (for spillover calculation)"""
        if is_all_time:
            return False
        dt = parse_timestamp(ts)
        if not dt:
            return False
        if date_start and dt < date_start:
            return True
        return False
    
    def is_disbursed(elig):
        disbursed = elig.get('disbursed')
        return disbursed == True or (isinstance(disbursed, str) and disbursed.lower() in ['yes', 'true'])
    
    def is_login_done(elig):
        login_done = elig.get('login_done')
        return login_done == True or (isinstance(login_done, str) and login_done.lower() in ['yes', 'true'])
    
    # Get all users to map IDs to names (using connect_id for matching)
    users = await db.users.find({}, {"_id": 0, "id": 1, "connect_id": 1, "full_name": 1, "name": 1, "email": 1, "manager_id": 1}).to_list(1000)
    user_map = {}
    user_manager_map = {}
    for u in users:
        uid = u.get('id')
        if uid:
            user_map[uid] = u.get('full_name') or u.get('name') or u.get('email', '').split('@')[0]
            user_manager_map[uid] = u.get('manager_id')
        cid = u.get('connect_id')
        if cid and cid != uid:
            user_map[cid] = u.get('full_name') or u.get('name') or u.get('email', '').split('@')[0]
            user_manager_map[cid] = u.get('manager_id')
    
    # Filter by manager if specified
    gp_filter_ids = None
    if manager_id:
        gp_filter_ids = set()
        for uid, mgr_id in user_manager_map.items():
            if mgr_id == manager_id:
                gp_filter_ids.add(uid)
    
    # Growth Partner stats aggregation with Current/Spillover
    gp_stats = {}
    
    # Status categories
    IN_PROGRESS_STATUSES = ['documents_pending', 'sent_for_eligibility', 'sent_for_login', 
                           'query_hold', 'underwriting', 'fi', 'sent_to_bank', 'fi_reinitiated',
                           'login', 'contacted', 'documents_collected']
    LOGIN_AND_BEYOND = ['login', 'approved', 'disbursed', 'declined', 'not_disbursed', 
                        'fi_negative', 'sanctioned', 'underwriting', 'fi']
    APPROVED_STATUSES = ['approved', 'disbursed', 'not_disbursed', 'sanctioned']
    
    all_files = await db.leads.find({"status": "file"}).to_list(10000)
    
    for f in all_files:
        # Use source_id as the Growth Partner identifier (who generated the file)
        source_id = f.get('source_id')
        if not source_id:
            continue
        
        # Filter by manager's team if specified
        if gp_filter_ids is not None and source_id not in gp_filter_ids:
            continue
        
        if source_id not in gp_stats:
            gp_stats[source_id] = {
                'agent_id': source_id,
                'agent_name': user_map.get(source_id, source_id),
                'manager_id': user_manager_map.get(source_id),
                'manager_name': user_map.get(user_manager_map.get(source_id), 'Unassigned'),
                # Current counts (file created within date range)
                'files_generated_current': 0,
                'in_progress_current': 0,
                'logins_current': 0,
                'approvals_current': 0,
                'disbursals_current': 0,
                'approved_amount_current': 0.0,
                'disbursed_amount_current': 0.0,
                # Spillover counts (file created before date range but had activity within range)
                'files_generated_spillover': 0,
                'in_progress_spillover': 0,
                'logins_spillover': 0,
                'approvals_spillover': 0,
                'disbursals_spillover': 0,
                'approved_amount_spillover': 0.0,
                'disbursed_amount_spillover': 0.0
            }
        
        created_at = f.get('created_at')
        file_status = f.get('file_status') or 'new'
        activities = f.get('file_activities', []) or f.get('activities', []) or []
        eligibilities = f.get('eligibilities') or []
        
        # Determine if CURRENT or SPILLOVER
        file_created_in_range = is_in_date_range(created_at)
        file_created_before_range = is_before_date_range(created_at)
        
        # Check for any activity/milestone within date range
        had_activity_in_range = False
        for act in activities:
            if is_in_date_range(act.get('timestamp')):
                had_activity_in_range = True
                break
        
        # Check eligibilities for milestones in range
        has_login_in_range = False
        has_approval_in_range = False
        has_disbursal_in_range = False
        file_approved_amt = 0.0
        file_disbursed_amt = 0.0
        
        for elig in eligibilities:
            login_done_at = elig.get('login_done_at')
            approved_at = elig.get('approved_at')
            disbursed_at = elig.get('disbursed_at')
            
            if is_login_done(elig):
                if is_all_time or is_in_date_range(login_done_at):
                    has_login_in_range = True
                    had_activity_in_range = True
            
            if elig.get('approval_status') == 'approved':
                if is_all_time or is_in_date_range(approved_at):
                    has_approval_in_range = True
                    had_activity_in_range = True
                    try:
                        file_approved_amt += float(elig.get('approved_amount') or 0)
                    except (ValueError, TypeError):
                        pass
            
            if is_disbursed(elig):
                if is_all_time or is_in_date_range(disbursed_at):
                    has_disbursal_in_range = True
                    had_activity_in_range = True
                    try:
                        file_disbursed_amt += float(elig.get('disbursed_amount') or 0)
                    except (ValueError, TypeError):
                        pass
        
        # Fallback: check if current status indicates milestone reached (when dates not recorded)
        if file_status in LOGIN_AND_BEYOND and not has_login_in_range:
            if had_activity_in_range:
                has_login_in_range = True
        if file_status in APPROVED_STATUSES and not has_approval_in_range:
            if had_activity_in_range:
                has_approval_in_range = True
        if file_status == 'disbursed' and not has_disbursal_in_range:
            if had_activity_in_range:
                has_disbursal_in_range = True
        
        # Assign to CURRENT or SPILLOVER
        suffix = '_current' if file_created_in_range else '_spillover'
        
        # Only count spillover if there was activity within the date range
        if file_created_before_range and not had_activity_in_range:
            continue  # Skip files with no activity in range
        
        # Files Generated
        if file_created_in_range:
            gp_stats[source_id]['files_generated_current'] += 1
        elif file_created_before_range and had_activity_in_range:
            gp_stats[source_id]['files_generated_spillover'] += 1
        
        # In Progress
        if file_status in IN_PROGRESS_STATUSES:
            gp_stats[source_id][f'in_progress{suffix}'] += 1
        
        # Logins
        if has_login_in_range:
            gp_stats[source_id][f'logins{suffix}'] += 1
        
        # Approvals
        if has_approval_in_range:
            gp_stats[source_id][f'approvals{suffix}'] += 1
            gp_stats[source_id][f'approved_amount{suffix}'] += file_approved_amt
        
        # Disbursals
        if has_disbursal_in_range:
            gp_stats[source_id][f'disbursals{suffix}'] += 1
            gp_stats[source_id][f'disbursed_amount{suffix}'] += file_disbursed_amt
    
    # Build output with combined totals
    agents = []
    for source_id, stats in gp_stats.items():
        agent = {
            **stats,
            # Combined totals
            'files_generated': stats['files_generated_current'] + stats['files_generated_spillover'],
            'in_progress': stats['in_progress_current'] + stats['in_progress_spillover'],
            'logins': stats['logins_current'] + stats['logins_spillover'],
            'approvals': stats['approvals_current'] + stats['approvals_spillover'],
            'disbursals': stats['disbursals_current'] + stats['disbursals_spillover'],
            'approved_amount': stats['approved_amount_current'] + stats['approved_amount_spillover'],
            'disbursed_amount': stats['disbursed_amount_current'] + stats['disbursed_amount_spillover']
        }
        agents.append(agent)
    
    # Sort by disbursed amount descending
    agents = sorted(agents, key=lambda x: -x['disbursed_amount'])
    
    # Calculate totals
    totals = {
        'files_generated': sum(a['files_generated'] for a in agents),
        'files_generated_current': sum(a['files_generated_current'] for a in agents),
        'files_generated_spillover': sum(a['files_generated_spillover'] for a in agents),
        'in_progress': sum(a['in_progress'] for a in agents),
        'logins': sum(a['logins'] for a in agents),
        'logins_current': sum(a['logins_current'] for a in agents),
        'logins_spillover': sum(a['logins_spillover'] for a in agents),
        'approvals': sum(a['approvals'] for a in agents),
        'approvals_current': sum(a['approvals_current'] for a in agents),
        'approvals_spillover': sum(a['approvals_spillover'] for a in agents),
        'disbursals': sum(a['disbursals'] for a in agents),
        'disbursals_current': sum(a['disbursals_current'] for a in agents),
        'disbursals_spillover': sum(a['disbursals_spillover'] for a in agents),
        'approved_amount': sum(a['approved_amount'] for a in agents),
        'disbursed_amount': sum(a['disbursed_amount'] for a in agents)
    }
    
    return {
        "gps": [
            {
                "id": a.get('agent_id'),
                "name": a.get('agent_name'),
                "files_generated": a.get('files_generated', 0),
                "in_progress": a.get('in_progress', 0),
                "login_current": a.get('logins_current', 0),
                "login_spillover": a.get('logins_spillover', 0),
                "approved": a.get('approvals', 0),
                "disbursed_current": a.get('disbursals_current', 0),
                "disbursed_spillover": a.get('disbursals_spillover', 0),
                "interim_current": 0,  # Would need to calculate
                "interim_spillover": 0,
                "final_current": 0,
                "final_spillover": 0,
                "disbursed_amount": a.get('disbursed_amount', 0)
            }
            for a in agents
        ],
        "summary": {
            "total_gps": len(agents),
            "files_generated": totals.get('files_generated', 0),
            "in_progress": totals.get('in_progress', 0),
            "login": totals.get('logins', 0),
            "login_current": totals.get('logins_current', 0),
            "login_spillover": totals.get('logins_spillover', 0),
            "approved": totals.get('approvals', 0),
            "disbursed": totals.get('disbursals', 0),
            "disbursed_current": totals.get('disbursals_current', 0),
            "disbursed_spillover": totals.get('disbursals_spillover', 0),
            "interim_current": 0,
            "interim_spillover": 0,
            "final_current": 0,
            "final_spillover": 0,
            "total_disbursed_amount": totals.get('disbursed_amount', 0)
        },
        "date_range": {
            "start_date": start_date,
            "end_date": end_date,
            "is_all_time": is_all_time
        }
    }




# ============ ELIGIBILITY CALCULATION - POLICY MASTER INTEGRATION ============

@router.post("/{file_id}/check-eligibility")
async def check_bank_eligibility(file_id: str, current_user: dict = Depends(get_current_user)):
    """
    Automatically check eligibility against all bank policies
    Uses Policy Master rules to calculate eligibility per bank
    """
    
    # Get file details
    file_doc = await db.leads.find_one(lead_filter(file_id), {"_id": 0})
    if not file_doc:
        raise HTTPException(status_code=404, detail="File not found")
    
    file_details = file_doc.get("file_details") or file_doc.get("additional_data") or {}
    
    # Get all active policies
    policies = await db.bank_policies.find({"is_active": True}, {"_id": 0}).to_list(100)
    
    # Extract customer data
    cibil = None
    try:
        cibil = int(file_details.get("cibil_score") or 0)
    except (ValueError, TypeError):
        pass
    
    net_salary = None
    try:
        net_salary = float(file_details.get("net_salary") or 0)
    except (ValueError, TypeError):
        pass
    
    loan_amount = None
    try:
        loan_amount = float(file_details.get("loan_amount_required") or 0)
    except (ValueError, TypeError):
        pass
    
    foir = None
    try:
        foir = float(file_details.get("foir") or 0)
    except (ValueError, TypeError):
        pass
    
    employment_type = file_details.get("employment_type") or file_doc.get("employment_type") or "salaried"
    age = None
    try:
        dob = file_details.get("date_of_birth")
        if dob:
            from datetime import date
            birth_date = datetime.strptime(dob, "%Y-%m-%d").date()
            today = date.today()
            age = today.year - birth_date.year - ((today.month, today.day) < (birth_date.month, birth_date.day))
    except (ValueError, TypeError, AttributeError):
        pass
    
    present_emp_months = None
    try:
        present_emp_months = int(file_details.get("present_employment_months") or 0)
    except (ValueError, TypeError):
        pass
    
    total_emp_months = None
    try:
        total_emp_months = int(file_details.get("total_employment_months") or 0)
    except (ValueError, TypeError):
        pass
    
    loan_type = file_details.get("type_of_loan") or file_doc.get("requirement")
    
    # Check eligibility against each policy
    eligibility_results = []
    
    for policy in policies:
        bank_name = policy.get("bank_name")
        is_eligible = True
        reasons = []
        eligible_amount = loan_amount
        
        # Check applicable profiles
        applicable = policy.get("applicable_profiles", "salaried")
        if applicable == "salaried" and employment_type != "salaried":
            is_eligible = False
            reasons.append("Only salaried profiles accepted")
        elif applicable == "self_employed" and employment_type not in ["self_employed", "business"]:
            is_eligible = False
            reasons.append("Only self-employed profiles accepted")
        
        # Check CIBIL
        min_cibil = policy.get("min_cibil")
        if min_cibil and cibil:
            if cibil < min_cibil:
                is_eligible = False
                reasons.append(f"CIBIL {cibil} below minimum {min_cibil}")
        
        # Check Salary
        min_salary = policy.get("min_salary")
        if min_salary and net_salary:
            if net_salary < min_salary:
                is_eligible = False
                reasons.append(f"Salary ₹{net_salary} below minimum ₹{min_salary}")
        
        # Check FOIR
        max_foir = policy.get("max_foir")
        if max_foir and foir:
            if foir > max_foir:
                is_eligible = False
                reasons.append(f"FOIR {foir}% exceeds maximum {max_foir}%")
        
        # Check Age
        min_age = policy.get("min_age")
        max_age = policy.get("max_age")
        if age:
            if min_age and age < min_age:
                is_eligible = False
                reasons.append(f"Age {age} below minimum {min_age}")
            if max_age and age > max_age:
                is_eligible = False
                reasons.append(f"Age {age} exceeds maximum {max_age}")
        
        # Check Employment Duration
        min_present = policy.get("min_present_employment_months")
        min_total = policy.get("min_total_employment_months")
        if min_present and present_emp_months:
            if present_emp_months < min_present:
                is_eligible = False
                reasons.append(f"Present employment {present_emp_months} months below minimum {min_present}")
        if min_total and total_emp_months:
            if total_emp_months < min_total:
                is_eligible = False
                reasons.append(f"Total employment {total_emp_months} months below minimum {min_total}")
        
        # Check Loan Type
        policy_loan_types = policy.get("loan_types", [])
        if policy_loan_types and loan_type:
            if loan_type not in policy_loan_types:
                is_eligible = False
                reasons.append(f"Loan type {loan_type} not offered by this bank")
        
        # Check Loan Amount Range
        min_loan = policy.get("min_loan_amount")
        max_loan = policy.get("max_loan_amount")
        if loan_amount:
            if min_loan and loan_amount < min_loan:
                is_eligible = False
                reasons.append(f"Loan amount ₹{loan_amount} below minimum ₹{min_loan}")
            if max_loan and loan_amount > max_loan:
                eligible_amount = max_loan
                if is_eligible:
                    reasons.append(f"Capped at max ₹{max_loan}")
        
        # Calculate estimated eligible amount based on salary and FOIR
        if is_eligible and net_salary and net_salary > 0:
            available_foir = (max_foir or 50) - (foir or 0)
            if available_foir > 0:
                monthly_emi_capacity = (net_salary * available_foir / 100)
                # Rough estimate: 5 year tenure, 12% ROI
                estimated_amount = monthly_emi_capacity * 45  # Approximate multiplier
                if estimated_amount < eligible_amount:
                    eligible_amount = estimated_amount
        
        eligibility_results.append({
            "bank_name": bank_name,
            "is_eligible": is_eligible,
            "eligible_amount": round(eligible_amount) if eligible_amount else None,
            "not_eligible_reason": "; ".join(reasons) if reasons else None,
            "policy_notes": policy.get("special_notes"),
            "roi_range": policy.get("roi_text") or (f"{policy.get('roi_min')}-{policy.get('roi_max')}%" if policy.get("roi_min") else None)
        })
    
    # Sort: eligible first, then by eligible amount
    eligibility_results.sort(key=lambda x: (not x["is_eligible"], -(x.get("eligible_amount") or 0)))
    
    # Identify missing data that could improve results
    missing_data = []
    if not cibil:
        missing_data.append("CIBIL Score")
    if not net_salary:
        missing_data.append("Net Salary")
    if not loan_amount:
        missing_data.append("Loan Amount")
    if not foir and net_salary:
        missing_data.append("FOIR / EMI Details")
    if not age:
        missing_data.append("Date of Birth")
    if not present_emp_months:
        missing_data.append("Employment Duration")
    
    # Store eligibility check result in separate collection (NOT the manual eligibilities)
    eligibility_check_result = {
        "file_id": file_id,
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "checked_by": current_user["id"],
        "checked_by_name": current_user.get("name", "Unknown"),
        "results": eligibility_results,
        "eligible_count": sum(1 for r in eligibility_results if r["is_eligible"]),
        "total_checked": len(eligibility_results),
        "customer_data": {
            "cibil": cibil,
            "net_salary": net_salary,
            "loan_amount": loan_amount,
            "foir": foir,
            "employment_type": employment_type,
            "age": age
        },
        "missing_data": missing_data
    }
    
    # Store in eligibility_checks collection (for history)
    await db.eligibility_checks.insert_one(eligibility_check_result)
    
    # Update file with ONLY the last_eligibility_check reference (NOT modifying manual eligibilities)
    await db.leads.update_one(
        lead_filter(file_id),
        {
            "$set": {
                "last_eligibility_check": eligibility_check_result,
                "updated_at": datetime.now(timezone.utc).isoformat()
            },
            "$push": {
                "file_activities": {
                    "type": "eligibility_check",
                    "message": f"Eligibility checked against {len(policies)} banks. {sum(1 for r in eligibility_results if r['is_eligible'])} eligible.",
                    "by": current_user["id"],
                    "by_name": current_user.get("name", "Unknown"),
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "details": {
                        "eligible_count": sum(1 for r in eligibility_results if r["is_eligible"]),
                        "not_eligible_count": sum(1 for r in eligibility_results if not r["is_eligible"])
                    }
                }
            }
        }
    )
    
    return {
        "results": eligibility_results,
        "eligible_count": sum(1 for r in eligibility_results if r["is_eligible"]),
        "not_eligible_count": sum(1 for r in eligibility_results if not r["is_eligible"]),
        "total_lenders_checked": len(eligibility_results),
        "missing_data": missing_data,
        "customer_data": {
            "cibil": cibil,
            "net_salary": net_salary,
            "loan_amount": loan_amount,
            "foir": foir,
            "employment_type": employment_type,
            "age": age
        }
    }


@router.get("/{file_id}/eligibility-history")
async def get_eligibility_history(file_id: str, current_user: dict = Depends(get_current_user)):
    """Get history of eligibility checks for a file"""
    
    history = await db.eligibility_checks.find(
        {"file_id": file_id},
        {"_id": 0, "file_id": 0, "results": 0, "customer_data": 0}  # Exclude large fields
    ).sort("checked_at", -1).limit(10).to_list(10)
    
    return history


# ============ EXPORT REPORTS - PDF/CSV ============

@router.get("/export/dashboard")
async def export_dashboard_csv(
    file_status: Optional[str] = None,
    gp_id: Optional[str] = None,
    tl_id: Optional[str] = None,
    manager_id: Optional[str] = None,
    assigned_to: Optional[str] = None,
    loan_types: Optional[str] = None,
    search: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    activity_start_date: Optional[str] = None,
    activity_end_date: Optional[str] = None,
    team_view: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """Export dashboard data as CSV - same population as the Files list and stats"""
    from fastapi.responses import StreamingResponse
    import io
    import csv
    
    query = await build_files_query(
        db, current_user,
        file_status=file_status, gp_id=gp_id, tl_id=tl_id, manager_id=manager_id,
        assigned_to=assigned_to, loan_types=loan_types, search=search,
        start_date=start_date, end_date=end_date,
        activity_start_date=activity_start_date, activity_end_date=activity_end_date,
        team_view=(team_view == 'true'),
    )
    files = [] if query is None else await db.leads.find(
        query,
        {"_id": 0, "id": 1, "name": 1, "phone": 1, "email": 1, "city": 1, "file_status": 1, 
         "source_id": 1, "created_at": 1, "file_details": 1, "eligibilities": 1}
    ).to_list(10000)
    
    # Create CSV
    output = io.StringIO()
    writer = csv.writer(output)
    
    # Header
    writer.writerow([
        "File ID", "Name", "Phone", "Email", "City", "Status", "Loan Type", 
        "Loan Amount", "CIBIL", "Created Date", "Banks Applied", "Approved Amount", "Disbursed Amount"
    ])
    
    for f in files:
        fd = f.get("file_details") or {}
        eligibilities = f.get("eligibilities") or []
        banks = [e.get("bank_name") for e in eligibilities if e.get("bank_name")]
        approved_amt = sum(float(e.get("approved_amount") or 0) for e in eligibilities if e.get("approval_status") == "approved")
        disbursed_amt = sum(float(e.get("disbursed_amount") or 0) for e in eligibilities if e.get("disbursed") == True)
        
        writer.writerow([
            f.get("id", ""),
            f.get("name", ""),
            f.get("phone", ""),
            f.get("email", ""),
            f.get("city", ""),
            f.get("file_status", ""),
            fd.get("type_of_loan", ""),
            fd.get("loan_amount_required", ""),
            fd.get("cibil_score", ""),
            str(f.get("created_at", ""))[:10] if f.get("created_at") else "",
            "; ".join(banks),
            approved_amt if approved_amt else "",
            disbursed_amt if disbursed_amt else ""
        ])
    
    output.seek(0)
    
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=files_export_{datetime.now().strftime('%Y%m%d')}.csv"}
    )


@router.get("/export/rejected")
async def export_rejected_csv(current_user: dict = Depends(get_current_user)):
    """Export rejected cases report as CSV"""
    from fastapi.responses import StreamingResponse
    import io
    import csv
    
    # Get rejected report data
    report = await get_rejected_files(current_user)
    
    output = io.StringIO()
    writer = csv.writer(output)
    
    # Bank summary section
    writer.writerow(["=== BANK-LEVEL REJECTION SUMMARY ==="])
    writer.writerow(["Bank", "Total Cases", "Eligible", "Not Eligible", "Login", "Not Login", "FI Negative", "Declined", "Disbursed", "Not Disbursed"])
    
    for bank in report.get("bank_summary", []):
        writer.writerow([
            bank.get("bank_name", ""),
            bank.get("total_cases", 0),
            bank.get("eligible", 0),
            bank.get("not_eligible", 0),
            bank.get("login", 0),
            bank.get("not_login", 0),
            bank.get("fi_negative", 0),
            bank.get("declined", 0),
            bank.get("disbursed", 0),
            bank.get("not_disbursed", 0)
        ])
    
    writer.writerow([])
    writer.writerow(["=== REJECTED FILES DETAIL ==="])
    writer.writerow(["Name", "Phone", "Status", "Bank", "Reason", "Updated"])
    
    for f in report.get("files", []):
        writer.writerow([
            f.get("name", ""),
            f.get("phone", ""),
            f.get("file_status", ""),
            f.get("bank_name", ""),
            f.get("rejection_reason") or f.get("remarks", ""),
            str(f.get("updated_at", ""))[:10] if f.get("updated_at") else ""
        ])
    
    output.seek(0)
    
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=rejected_cases_{datetime.now().strftime('%Y%m%d')}.csv"}
    )


@router.get("/export/growth-partner")
async def export_growth_partner_csv(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """Export Growth Partner performance report as CSV"""
    from fastapi.responses import StreamingResponse
    import io
    import csv
    
    # Get GP report data
    report = await get_growth_partner_report(start_date, end_date, None, current_user)
    
    output = io.StringIO()
    writer = csv.writer(output)
    
    # Header
    writer.writerow([
        "Growth Partner", "Manager", "Files Generated", "Files (Current)", "Files (Spillover)",
        "In Progress", "Logins", "Logins (Current)", "Logins (Spillover)",
        "Approvals", "Approvals (Current)", "Approvals (Spillover)", "Approved Amount",
        "Disbursals", "Disbursals (Current)", "Disbursals (Spillover)", "Disbursed Amount"
    ])
    
    for agent in report.get("agents", []):
        writer.writerow([
            agent.get("agent_name", ""),
            agent.get("manager_name", ""),
            agent.get("files_generated", 0),
            agent.get("files_generated_current", 0),
            agent.get("files_generated_spillover", 0),
            agent.get("in_progress", 0),
            agent.get("logins", 0),
            agent.get("logins_current", 0),
            agent.get("logins_spillover", 0),
            agent.get("approvals", 0),
            agent.get("approvals_current", 0),
            agent.get("approvals_spillover", 0),
            agent.get("approved_amount", 0),
            agent.get("disbursals", 0),
            agent.get("disbursals_current", 0),
            agent.get("disbursals_spillover", 0),
            agent.get("disbursed_amount", 0)
        ])
    
    # Totals row
    totals = report.get("totals", {})
    writer.writerow([
        "TOTAL", "",
        totals.get("files_generated", 0),
        totals.get("files_generated_current", 0),
        totals.get("files_generated_spillover", 0),
        totals.get("in_progress", 0),
        totals.get("logins", 0),
        totals.get("logins_current", 0),
        totals.get("logins_spillover", 0),
        totals.get("approvals", 0),
        totals.get("approvals_current", 0),
        totals.get("approvals_spillover", 0),
        totals.get("approved_amount", 0),
        totals.get("disbursals", 0),
        totals.get("disbursals_current", 0),
        totals.get("disbursals_spillover", 0),
        totals.get("disbursed_amount", 0)
    ])
    
    output.seek(0)
    
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=growth_partner_report_{datetime.now().strftime('%Y%m%d')}.csv"}
    )


@router.get("/export/commissions")
async def export_commissions_csv(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """Export commissions report as CSV"""
    from fastapi.responses import StreamingResponse
    import io
    import csv
    
    # Get commissions data
    report = await get_commissions(start_date, end_date, None, None, current_user)
    
    output = io.StringIO()
    writer = csv.writer(output)
    
    # Summary section
    writer.writerow(["=== COMMISSION SUMMARY ==="])
    writer.writerow(["Total Amount", "Total Records"])
    writer.writerow([report.get("total_amount", 0), report.get("total", 0)])
    
    writer.writerow([])
    writer.writerow(["=== BY GROWTH PARTNER ==="])
    writer.writerow(["Growth Partner", "Total Amount", "Count"])
    for gp in report.get("by_growth_partner", []):
        writer.writerow([gp.get("source_name", ""), gp.get("total_amount", 0), gp.get("count", 0)])
    
    writer.writerow([])
    writer.writerow(["=== BY BANK ==="])
    writer.writerow(["Bank", "Total Amount", "Count"])
    for bank in report.get("by_bank", []):
        writer.writerow([bank.get("bank_name", ""), bank.get("total_amount", 0), bank.get("count", 0)])
    
    writer.writerow([])
    writer.writerow(["=== DETAILED RECORDS ==="])
    writer.writerow(["Lead ID", "Growth Partner", "Amount", "Type", "Bank", "Status", "Created"])
    for c in report.get("commissions", []):
        writer.writerow([
            c.get("lead_id", ""),
            c.get("source_name", ""),
            c.get("amount", 0),
            c.get("commission_type") or c.get("type", ""),
            c.get("bank_name", ""),
            c.get("status", ""),
            str(c.get("created_at", ""))[:10] if c.get("created_at") else ""
        ])
    
    output.seek(0)
    
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=commissions_{datetime.now().strftime('%Y%m%d')}.csv"}
    )


# ============ ENHANCED ACTIVITY LOG ============

@router.post("/{file_id}/activities/eligibility")
async def add_eligibility_activity(
    file_id: str,
    bank_name: str,
    action: str,  # checked, login, approved, declined, disbursed, rejected
    amount: Optional[float] = None,
    reason: Optional[str] = None,
    notes: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """
    Add eligibility-related activity with bank details
    Tracks: eligibility check, login, approval, decline, disbursal
    """
    
    action_messages = {
        "checked": f"Eligibility checked for {bank_name}",
        "eligible": f"Marked eligible for {bank_name}" + (f" - ₹{amount:,.0f}" if amount else ""),
        "not_eligible": f"Marked not eligible for {bank_name}" + (f" - {reason}" if reason else ""),
        "login": f"Login done at {bank_name}" + (f" - ₹{amount:,.0f}" if amount else ""),
        "login_rejected": f"Login rejected at {bank_name}" + (f" - {reason}" if reason else ""),
        "approved": f"Approved by {bank_name}" + (f" - ₹{amount:,.0f}" if amount else ""),
        "declined": f"Declined by {bank_name}" + (f" - {reason}" if reason else ""),
        "disbursed": f"Disbursed by {bank_name}" + (f" - ₹{amount:,.0f}" if amount else ""),
        "not_disbursed": f"Not disbursed by {bank_name}" + (f" - {reason}" if reason else "")
    }
    
    message = action_messages.get(action, f"{action} for {bank_name}")
    if notes:
        message += f". Notes: {notes}"
    
    activity = {
        "type": f"bank_{action}",
        "message": message,
        "by": current_user["id"],
        "by_name": current_user.get("name", "Unknown"),
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "details": {
            "bank_name": bank_name,
            "action": action,
            "amount": amount,
            "reason": reason
        }
    }
    
    result = await db.leads.update_one(
        lead_filter(file_id),
        {
            "$push": {"file_activities": activity},
            "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}
        }
    )
    
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="File not found")
    
    return {"message": "Activity added", "activity": activity}


@router.get("/{file_id}/activities/timeline")
async def get_file_timeline(file_id: str, current_user: dict = Depends(get_current_user)):
    """
    Get complete file timeline with all activities, eligibility changes, and milestones
    """
    
    file_doc = await db.leads.find_one(lead_filter(file_id), {"_id": 0})
    if not file_doc:
        raise HTTPException(status_code=404, detail="File not found")
    
    timeline = []
    
    # Add file creation
    if file_doc.get("created_at"):
        timeline.append({
            "type": "created",
            "message": "File created",
            "timestamp": file_doc["created_at"],
            "category": "milestone"
        })
    
    # Add all activities
    for act in (file_doc.get("file_activities") or []):
        timeline.append({
            **act,
            "category": "activity"
        })
    
    # Add eligibility milestones from eligibilities array
    for elig in (file_doc.get("eligibilities") or []):
        bank = elig.get("bank_name", "Unknown")
        
        if elig.get("login_done"):
            timeline.append({
                "type": "login",
                "message": f"Login completed at {bank}",
                "timestamp": elig.get("login_done_at") or file_doc.get("updated_at"),
                "category": "bank_milestone",
                "bank_name": bank
            })
        
        if elig.get("approval_status") == "approved":
            timeline.append({
                "type": "approved",
                "message": f"Approved by {bank} - ₹{elig.get('approved_amount', 0):,.0f}",
                "timestamp": elig.get("approved_at") or file_doc.get("updated_at"),
                "category": "bank_milestone",
                "bank_name": bank,
                "amount": elig.get("approved_amount")
            })
        elif elig.get("approval_status") == "declined":
            timeline.append({
                "type": "declined",
                "message": f"Declined by {bank}" + (f" - {elig.get('declined_reason')}" if elig.get("declined_reason") else ""),
                "timestamp": elig.get("declined_at") or file_doc.get("updated_at"),
                "category": "bank_milestone",
                "bank_name": bank
            })
        
        if elig.get("disbursed") == True:
            timeline.append({
                "type": "disbursed",
                "message": f"Disbursed by {bank} - ₹{elig.get('disbursed_amount', 0):,.0f}",
                "timestamp": elig.get("disbursed_at") or file_doc.get("updated_at"),
                "category": "bank_milestone",
                "bank_name": bank,
                "amount": elig.get("disbursed_amount")
            })
    
    # Sort by timestamp
    timeline.sort(key=lambda x: x.get("timestamp") or "", reverse=True)
    
    return {
        "file_id": file_id,
        "timeline": timeline,
        "total_events": len(timeline)
    }



# ============ GP FILE MAPPING AUDIT ============

@router.get("/audit/gp-file-mapping")
async def get_gp_file_mapping_audit(current_user: dict = Depends(require_admin)):
    """
    Get GP vs File Count audit matrix.
    Shows all Growth Partners with their mapped file counts.
    Useful for verifying data migration and GP-file associations.
    """
    # Get all files
    all_files = await db.leads.find({"status": "file"}, {"_id": 0, "id": 1, "assigned_to": 1, "file_assigned_to": 1, "source_id": 1}).to_list(10000)
    
    # Get all users (potential GPs)
    all_users = await db.users.find({"role": {"$in": ["telecaller", "admin"]}}, {"_id": 0, "id": 1, "full_name": 1, "name": 1, "email": 1, "connect_id": 1}).to_list(500)
    
    # Create a mapping of user IDs to names
    user_map = {}
    for u in all_users:
        uid = u.get('id') or u.get('connect_id')
        if uid:
            user_map[uid] = u.get('full_name') or u.get('name') or u.get('email', '').split('@')[0]
    
    # Count files by GP
    gp_file_counts = {}
    unassigned_count = 0
    
    for f in all_files:
        assigned = f.get('assigned_to') or f.get('file_assigned_to') or f.get('source_id')
        if assigned:
            if assigned not in gp_file_counts:
                gp_file_counts[assigned] = {
                    "gp_id": assigned,
                    "gp_name": user_map.get(assigned, f"Unknown ({assigned})"),
                    "file_count": 0
                }
            gp_file_counts[assigned]["file_count"] += 1
        else:
            unassigned_count += 1
    
    # Sort by file count descending
    gp_list = sorted(gp_file_counts.values(), key=lambda x: -x["file_count"])
    
    return {
        "total_files": len(all_files),
        "total_gps_with_files": len(gp_file_counts),
        "unassigned_files": unassigned_count,
        "gp_file_matrix": gp_list
    }



# ============ SALES & OPS COMPREHENSIVE REPORT ============

@router.get("/reports/sales-ops")
async def get_sales_ops_report(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """
    Comprehensive Sales & Operations Report matching OLD CRM format.
    Includes: Business Volume, Team Productivity, Bank Performance, Rejection Analysis
    """
    from datetime import datetime, timezone
    from collections import defaultdict
    
    # Parse dates
    date_filter = {}
    if start_date:
        try:
            date_start = datetime.fromisoformat(start_date.replace('Z', '+00:00'))
            if date_start.tzinfo is None:
                date_start = date_start.replace(tzinfo=timezone.utc)
            date_filter["$gte"] = date_start
        except ValueError:
            pass
    if end_date:
        try:
            date_end = datetime.fromisoformat(end_date.replace('Z', '+00:00'))
            if date_end.tzinfo is None:
                date_end = date_end.replace(hour=23, minute=59, second=59, tzinfo=timezone.utc)
            date_filter["$lte"] = date_end
        except ValueError:
            pass
    
    # Query all files (for spillover analysis)
    query = {"status": "file"}
    all_files = await db.leads.find(query).to_list(10000)
    
    # Filter files created in date range (current) vs before (spillover)
    current_files = []
    spillover_files = []
    
    for f in all_files:
        created = f.get('created_at')
        if created:
            if isinstance(created, str):
                try:
                    created = datetime.fromisoformat(created.replace('Z', '+00:00'))
                except (ValueError, TypeError):
                    created = None
            
            if created and date_filter:
                if date_filter.get('$gte') and created >= date_filter['$gte']:
                    if not date_filter.get('$lte') or created <= date_filter['$lte']:
                        current_files.append(f)
                    else:
                        spillover_files.append(f)
                else:
                    spillover_files.append(f)
            else:
                current_files.append(f)
        else:
            current_files.append(f)
    
    # Status definitions
    IN_PROGRESS = ['documents_pending', 'sent_for_eligibility', 'sent_for_login', 'query_hold', 
                   'contacted', 'documents_collected']
    LOGIN_BEYOND = ['login', 'approved', 'disbursed', 'declined', 'not_disbursed', 'fi_negative', 
                    'sanctioned', 'underwriting', 'fi']
    APPROVED = ['approved', 'disbursed', 'not_disbursed', 'sanctioned']
    INTERIM_REJECTS = ['fi_negative', 'declined', 'customer_not_interested', 'customer_not_supporting']
    FINAL_REJECTS = ['rejected', 'not_eligible', 'not_login', 'not_disbursed']
    
    def count_by_status(files, statuses):
        return sum(1 for f in files if f.get('file_status') in statuses)
    
    def sum_amount(files, field='loan_amount_required'):
        total = 0
        for f in files:
            fd = f.get('file_details', {})
            amt = fd.get(field) or f.get(field) or 0
            try:
                total += float(str(amt).replace(',', ''))
            except (ValueError, TypeError):
                pass
        return total
    
    # 1. Business Volume Metrics
    volume = {
        "total_files": len(current_files),
        "in_progress": count_by_status(current_files, IN_PROGRESS),
        "login": count_by_status(all_files, LOGIN_BEYOND),
        "login_current": count_by_status(current_files, LOGIN_BEYOND),
        "login_spillover": count_by_status(spillover_files, LOGIN_BEYOND),
        "approved": count_by_status(all_files, APPROVED),
        "approved_current": count_by_status(current_files, APPROVED),
        "approved_spillover": count_by_status(spillover_files, APPROVED),
        "disbursed": count_by_status(all_files, ['disbursed']),
        "disbursed_current": count_by_status(current_files, ['disbursed']),
        "disbursed_spillover": count_by_status(spillover_files, ['disbursed']),
        "disbursed_amount": sum_amount([f for f in all_files if f.get('file_status') == 'disbursed']),
        "disbursed_amount_current": sum_amount([f for f in current_files if f.get('file_status') == 'disbursed']),
        "disbursed_amount_spillover": sum_amount([f for f in spillover_files if f.get('file_status') == 'disbursed']),
        "final_rejections": count_by_status(all_files, FINAL_REJECTS),
        "final_rejections_current": count_by_status(current_files, FINAL_REJECTS),
        "final_rejections_spillover": count_by_status(spillover_files, FINAL_REJECTS),
        "interim_rejects": count_by_status(all_files, INTERIM_REJECTS),
        "interim_rejects_current": count_by_status(current_files, INTERIM_REJECTS),
        "interim_rejects_spillover": count_by_status(spillover_files, INTERIM_REJECTS),
    }
    
    # Calculate pipeline amount
    pipeline_amount = 0
    for f in all_files:
        if f.get('file_status') not in ['disbursed', 'rejected', 'not_eligible', 'declined']:
            for elig in f.get('eligibilities', []):
                if elig.get('login_done') in [True, 'yes', 'Yes'] and elig.get('disbursed') not in [True, 'yes', 'Yes']:
                    try:
                        pipeline_amount += float(str(elig.get('eligible_amount', 0)).replace(',', ''))
                    except (ValueError, TypeError):
                        pass
    volume["pipeline_amount"] = pipeline_amount
    
    # Average loan value
    disbursed_count = volume["disbursed"]
    volume["avg_loan_value"] = volume["disbursed_amount"] / disbursed_count if disbursed_count > 0 else 0
    
    # 2. Team Productivity
    gp_stats = defaultdict(lambda: {
        "name": "", "files": 0, "logins": 0, "approvals": 0, "disbursals": 0, 
        "disbursed_amount": 0, "conversion": 0
    })
    
    # Get user names
    all_users = await db.users.find({}, {"_id": 0, "id": 1, "full_name": 1, "name": 1, "connect_id": 1}).to_list(500)
    user_map = {u.get('id') or u.get('connect_id'): u.get('full_name') or u.get('name', 'Unknown') for u in all_users}
    
    for f in all_files:
        gp_id = f.get('source_id') or f.get('assigned_to') or f.get('file_assigned_to')
        if gp_id:
            gp_stats[gp_id]["name"] = user_map.get(gp_id, f"Unknown ({gp_id[:8]})")
            gp_stats[gp_id]["files"] += 1
            if f.get('file_status') in LOGIN_BEYOND:
                gp_stats[gp_id]["logins"] += 1
            if f.get('file_status') in APPROVED:
                gp_stats[gp_id]["approvals"] += 1
            if f.get('file_status') == 'disbursed':
                gp_stats[gp_id]["disbursals"] += 1
                fd = f.get('file_details', {})
                try:
                    gp_stats[gp_id]["disbursed_amount"] += float(str(fd.get('loan_amount_required', 0)).replace(',', ''))
                except (ValueError, TypeError):
                    pass
    
    # Calculate conversion
    for gp_id, stats in gp_stats.items():
        if stats["files"] > 0:
            stats["conversion"] = (stats["disbursals"] / stats["files"]) * 100
    
    gp_list = sorted(gp_stats.values(), key=lambda x: -x["disbursals"])
    active_gps = len([g for g in gp_list if g["files"] > 0])
    
    team = {
        "active_gps": active_gps,
        "files_per_gp": len(all_files) / active_gps if active_gps > 0 else 0,
        "disbursals_per_gp": volume["disbursed"] / active_gps if active_gps > 0 else 0,
        "gps": gp_list
    }
    
    # 3. Bank Performance
    bank_stats = defaultdict(lambda: {
        "name": "", "logins": 0, "approvals": 0, "disbursals": 0, "disbursed_amount": 0
    })
    
    for f in all_files:
        for elig in f.get('eligibilities', []):
            bank = elig.get('bank_name', 'Unknown')
            if elig.get('login_done') in [True, 'yes', 'Yes']:
                bank_stats[bank]["name"] = bank
                bank_stats[bank]["logins"] += 1
                if elig.get('approval_status') == 'approved':
                    bank_stats[bank]["approvals"] += 1
                if elig.get('disbursed') in [True, 'yes', 'Yes']:
                    bank_stats[bank]["disbursals"] += 1
                    try:
                        bank_stats[bank]["disbursed_amount"] += float(str(elig.get('disbursed_amount', 0)).replace(',', ''))
                    except (ValueError, TypeError):
                        pass
    
    banks = sorted(bank_stats.values(), key=lambda x: -x["disbursals"])
    
    # 4. Rejection Analysis
    rejection_reasons = defaultdict(int)
    total_rejections = 0
    login_approval_rejections = 0
    
    for f in all_files:
        if f.get('file_status') in INTERIM_REJECTS + FINAL_REJECTS:
            total_rejections += 1
            for elig in f.get('eligibilities', []):
                if elig.get('approval_status') == 'declined':
                    login_approval_rejections += 1
                    reason = elig.get('rejection_reason') or elig.get('remarks') or 'Unknown'
                    rejection_reasons[reason] += 1
    
    top_reasons = sorted([{"reason": r, "count": c} for r, c in rejection_reasons.items()], key=lambda x: -x["count"])[:10]
    
    rejection = {
        "total": total_rejections,
        "login_approval_rate": (login_approval_rejections / volume["login"] * 100) if volume["login"] > 0 else 0,
        "top_reasons": top_reasons
    }
    
    return {
        "volume": volume,
        "team": team,
        "banks": banks,
        "rejection": rejection,
        "spillover_count": len(spillover_files)
    }
