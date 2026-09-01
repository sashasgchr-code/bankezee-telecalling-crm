"""
Settings management routes
Handles integration settings (Google Sheets, Email, etc.)
"""
from fastapi import APIRouter, Depends, HTTPException
from datetime import datetime, timezone
from typing import Optional
from pydantic import BaseModel
import os

from utils.database import db
from utils.auth import require_admin
from utils.helpers import serialize_doc

router = APIRouter(prefix="/api/settings", tags=["Settings"])


class IntegrationSettings(BaseModel):
    sheets_api_key: Optional[str] = None
    resend_api_key: Optional[str] = None
    hr_email: Optional[str] = None
    admin_email: Optional[str] = None


@router.get("/integrations")
async def get_integration_settings(current_user: dict = Depends(require_admin)):
    """Get current integration settings"""
    settings = await db.app_settings.find_one({"type": "integrations"})
    
    if not settings:
        # Return defaults
        return {
            "sheets_api_key": os.environ.get("SHEETS_API_KEY", "bankezee_sheets_sync_2026"),
            "resend_api_key": "",
            "hr_email": os.environ.get("HR_EMAIL", "admin@bankezee.com"),
            "admin_email": os.environ.get("ADMIN_EMAIL", "admin@bankezee.com"),
        }
    
    # Don't return full Resend API key - mask it
    result = {
        "sheets_api_key": settings.get("sheets_api_key", ""),
        "resend_api_key": settings.get("resend_api_key", ""),
        "hr_email": settings.get("hr_email", ""),
        "admin_email": settings.get("admin_email", ""),
    }
    
    # Mask Resend key for display (show last 4 chars)
    if result["resend_api_key"] and len(result["resend_api_key"]) > 8:
        result["resend_api_key_masked"] = "re_****" + result["resend_api_key"][-4:]
        result["resend_api_key"] = ""  # Don't send actual key to frontend
    
    return result


@router.post("/integrations")
async def save_integration_settings(
    settings: IntegrationSettings,
    current_user: dict = Depends(require_admin)
):
    """Save integration settings"""
    now = datetime.now(timezone.utc)
    
    # Get existing settings
    existing = await db.app_settings.find_one({"type": "integrations"})
    
    update_data = {
        "type": "integrations",
        "updated_at": now,
        "updated_by": current_user["id"]
    }
    
    # Only update fields that are provided
    if settings.sheets_api_key:
        update_data["sheets_api_key"] = settings.sheets_api_key
        # Also update environment variable for runtime use
        os.environ["SHEETS_API_KEY"] = settings.sheets_api_key
    
    if settings.resend_api_key:
        update_data["resend_api_key"] = settings.resend_api_key
        os.environ["RESEND_API_KEY"] = settings.resend_api_key
    
    if settings.hr_email:
        update_data["hr_email"] = settings.hr_email
        os.environ["HR_EMAIL"] = settings.hr_email
    
    if settings.admin_email:
        update_data["admin_email"] = settings.admin_email
        os.environ["ADMIN_EMAIL"] = settings.admin_email
    
    if existing:
        await db.app_settings.update_one(
            {"type": "integrations"},
            {"$set": update_data}
        )
    else:
        update_data["created_at"] = now
        await db.app_settings.insert_one(update_data)
    
    return {"success": True, "message": "Integration settings saved successfully"}


@router.get("/sheets-sync-url")
async def get_sheets_sync_url(current_user: dict = Depends(require_admin)):
    """Get the URL and API key for Google Sheets sync"""
    settings = await db.app_settings.find_one({"type": "integrations"})
    api_key = settings.get("sheets_api_key") if settings else os.environ.get("SHEETS_API_KEY", "bankezee_sheets_sync_2026")
    
    return {
        "api_key": api_key,
        "endpoints": {
            "leads_by_status": "/api/sheets-sync/leads-by-status",
            "daily_report": "/api/sheets-sync/daily-report",
            "attendance_summary": "/api/sheets-sync/attendance-summary"
        }
    }
