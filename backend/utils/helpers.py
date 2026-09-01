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
    # If already a string, return as-is
    if isinstance(dt, str):
        return dt
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
    # Convert timestamp fields to IST (handle both datetime and string)
    timestamp_fields = ["timestamp", "created_at", "updated_at", "login_time", "logout_time"]
    for field in timestamp_fields:
        if field in doc and doc[field]:
            val = doc[field]
            if isinstance(val, str):
                doc[field] = val  # Already a string
            else:
                try:
                    doc[field] = convert_to_ist(val).isoformat()
                except (AttributeError, TypeError):
                    doc[field] = str(val)  # Fallback to string
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
