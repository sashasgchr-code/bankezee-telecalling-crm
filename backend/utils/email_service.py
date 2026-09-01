"""
Email Service for BankEzee Connect
Handles transactional emails for leave/WFH notifications
"""
import os
import asyncio
import logging
from datetime import datetime
from typing import Optional

logger = logging.getLogger(__name__)

# Check if Resend is configured
RESEND_API_KEY = os.environ.get("RESEND_API_KEY")
SENDER_EMAIL = os.environ.get("SENDER_EMAIL", "onboarding@resend.dev")
HR_EMAIL = os.environ.get("HR_EMAIL", "")  # HR/Admin email for notifications
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "")

# Only import resend if API key is configured
resend = None
if RESEND_API_KEY:
    try:
        import resend
        resend.api_key = RESEND_API_KEY
        logger.info("Resend email service initialized")
    except ImportError:
        logger.warning("Resend library not installed. Email notifications disabled.")


async def send_email(to: str, subject: str, html: str) -> bool:
    """
    Send an email using Resend API.
    Returns True if successful, False otherwise.
    """
    if not resend or not RESEND_API_KEY:
        logger.warning(f"Email not sent (Resend not configured): {subject} to {to}")
        return False
    
    if not to:
        logger.warning(f"Email not sent (no recipient): {subject}")
        return False
    
    try:
        params = {
            "from": SENDER_EMAIL,
            "to": [to],
            "subject": subject,
            "html": html
        }
        
        # Run sync SDK in thread to keep FastAPI non-blocking
        result = await asyncio.to_thread(resend.Emails.send, params)
        logger.info(f"Email sent successfully: {subject} to {to}")
        return True
    except Exception as e:
        logger.error(f"Failed to send email: {str(e)}")
        return False


async def send_leave_request_notification(
    employee_name: str,
    leave_type: str,
    start_date: datetime,
    end_date: datetime,
    reason: str,
    request_id: str
):
    """Send notification to HR/Admin when an employee submits a leave/WFH request"""
    recipient = HR_EMAIL or ADMIN_EMAIL
    if not recipient:
        logger.warning("No HR/Admin email configured for leave request notifications")
        return False
    
    # Format dates
    start_str = start_date.strftime("%d %b %Y")
    end_str = end_date.strftime("%d %b %Y")
    
    if leave_type == "WFH":
        subject = f"WFH Request: {employee_name} - {start_str}"
        request_type = "Work From Home"
    else:
        subject = f"Leave Request: {employee_name} - {leave_type}"
        request_type = f"{leave_type} Leave"
    
    html = f"""
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background-color: #10b981; color: white; padding: 20px; text-align: center;">
            <h1 style="margin: 0;">BankEzee Connect</h1>
        </div>
        <div style="padding: 20px; background-color: #f9fafb;">
            <h2 style="color: #1f2937;">New {request_type} Request</h2>
            <table style="width: 100%; border-collapse: collapse;">
                <tr>
                    <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; font-weight: bold;">Employee:</td>
                    <td style="padding: 10px; border-bottom: 1px solid #e5e7eb;">{employee_name}</td>
                </tr>
                <tr>
                    <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; font-weight: bold;">Type:</td>
                    <td style="padding: 10px; border-bottom: 1px solid #e5e7eb;">{request_type}</td>
                </tr>
                <tr>
                    <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; font-weight: bold;">From:</td>
                    <td style="padding: 10px; border-bottom: 1px solid #e5e7eb;">{start_str}</td>
                </tr>
                <tr>
                    <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; font-weight: bold;">To:</td>
                    <td style="padding: 10px; border-bottom: 1px solid #e5e7eb;">{end_str}</td>
                </tr>
                <tr>
                    <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; font-weight: bold;">Reason:</td>
                    <td style="padding: 10px; border-bottom: 1px solid #e5e7eb;">{reason}</td>
                </tr>
            </table>
            <div style="margin-top: 20px; padding: 15px; background-color: #fef3c7; border-radius: 8px;">
                <p style="margin: 0; color: #92400e;">
                    <strong>Action Required:</strong> Please review and approve/reject this request in the BankEzee Connect dashboard.
                </p>
            </div>
        </div>
        <div style="padding: 15px; background-color: #1f2937; color: #9ca3af; text-align: center; font-size: 12px;">
            <p style="margin: 0;">This is an automated notification from BankEzee Connect</p>
        </div>
    </div>
    """
    
    return await send_email(recipient, subject, html)


async def send_leave_approval_notification(
    employee_email: str,
    employee_name: str,
    leave_type: str,
    start_date: datetime,
    end_date: datetime,
    status: str,
    admin_notes: Optional[str] = None
):
    """Send notification to employee when their leave/WFH request is approved/rejected"""
    if not employee_email:
        logger.warning(f"No email for employee {employee_name}, skipping notification")
        return False
    
    # Format dates
    start_str = start_date.strftime("%d %b %Y")
    end_str = end_date.strftime("%d %b %Y")
    
    if leave_type == "WFH":
        request_type = "Work From Home"
    else:
        request_type = f"{leave_type} Leave"
    
    status_color = "#10b981" if status == "APPROVED" else "#ef4444"
    status_text = "Approved" if status == "APPROVED" else "Rejected"
    
    subject = f"{request_type} Request {status_text}"
    
    notes_section = ""
    if admin_notes:
        notes_section = f"""
        <tr>
            <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; font-weight: bold;">Notes:</td>
            <td style="padding: 10px; border-bottom: 1px solid #e5e7eb;">{admin_notes}</td>
        </tr>
        """
    
    html = f"""
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background-color: #10b981; color: white; padding: 20px; text-align: center;">
            <h1 style="margin: 0;">BankEzee Connect</h1>
        </div>
        <div style="padding: 20px; background-color: #f9fafb;">
            <h2 style="color: #1f2937;">Your {request_type} Request Has Been {status_text}</h2>
            <div style="padding: 15px; background-color: {status_color}; color: white; border-radius: 8px; text-align: center; margin-bottom: 20px;">
                <h3 style="margin: 0;">{status_text.upper()}</h3>
            </div>
            <p>Dear {employee_name},</p>
            <p>Your {request_type.lower()} request has been <strong>{status_text.lower()}</strong>.</p>
            <table style="width: 100%; border-collapse: collapse; margin-top: 15px;">
                <tr>
                    <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; font-weight: bold;">Request Type:</td>
                    <td style="padding: 10px; border-bottom: 1px solid #e5e7eb;">{request_type}</td>
                </tr>
                <tr>
                    <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; font-weight: bold;">From:</td>
                    <td style="padding: 10px; border-bottom: 1px solid #e5e7eb;">{start_str}</td>
                </tr>
                <tr>
                    <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; font-weight: bold;">To:</td>
                    <td style="padding: 10px; border-bottom: 1px solid #e5e7eb;">{end_str}</td>
                </tr>
                {notes_section}
            </table>
        </div>
        <div style="padding: 15px; background-color: #1f2937; color: #9ca3af; text-align: center; font-size: 12px;">
            <p style="margin: 0;">This is an automated notification from BankEzee Connect</p>
        </div>
    </div>
    """
    
    return await send_email(employee_email, subject, html)
