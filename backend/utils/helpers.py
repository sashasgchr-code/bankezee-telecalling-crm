"""
Helper functions for the BANKEZEE Connect API
"""
from datetime import datetime, timedelta, timezone
from bson import ObjectId

# IST timezone offset (UTC+5:30)
IST_OFFSET = timedelta(hours=5, minutes=30)

def convert_to_ist(dt):
    """Convert a datetime to IST"""
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    ist_time = dt + IST_OFFSET
    return ist_time.replace(tzinfo=None)  # Return naive datetime for JSON serialization

def serialize_doc(doc):
    """Serialize MongoDB document, converting ObjectId to string and timestamps to IST"""
    if doc is None:
        return None
    doc["id"] = str(doc.pop("_id"))
    # Remove sensitive fields
    doc.pop("password", None)
    doc.pop("plain_password", None)
    # Convert timestamp fields to IST
    if "timestamp" in doc and doc["timestamp"]:
        doc["timestamp"] = convert_to_ist(doc["timestamp"]).isoformat()
    if "created_at" in doc and doc["created_at"]:
        doc["created_at"] = convert_to_ist(doc["created_at"]).isoformat()
    if "updated_at" in doc and doc["updated_at"]:
        doc["updated_at"] = convert_to_ist(doc["updated_at"]).isoformat()
    if "login_time" in doc and doc["login_time"]:
        doc["login_time"] = convert_to_ist(doc["login_time"]).isoformat()
    if "logout_time" in doc and doc["logout_time"]:
        doc["logout_time"] = convert_to_ist(doc["logout_time"]).isoformat()
    return doc

def serialize_docs(docs):
    """Serialize a list of MongoDB documents"""
    return [serialize_doc(doc) for doc in docs]

def format_duration(seconds):
    """Format seconds into human readable duration"""
    if not seconds:
        return "0s"
    minutes = int(seconds // 60)
    secs = int(seconds % 60)
    if minutes > 0:
        return f"{minutes}m {secs}s"
    return f"{secs}s"

def normalize_phone(phone: str) -> str:
    """Normalize phone number for comparison"""
    if not phone:
        return ""
    # Remove all non-digit characters
    normalized = ''.join(c for c in phone if c.isdigit())
    # Remove leading country code (91 for India)
    if len(normalized) > 10 and normalized.startswith('91'):
        normalized = normalized[2:]
    # Take last 10 digits
    if len(normalized) > 10:
        normalized = normalized[-10:]
    return normalized
