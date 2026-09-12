"""
Helper functions for the BANKEZEE Connect API
"""
from datetime import datetime, timedelta, timezone
from bson import ObjectId
import re

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
    # Only set 'id' from _id if no 'id' field already exists (preserves UUID if present)
    mongo_id = doc.pop("_id", None)
    if "id" not in doc and mongo_id:
        doc["id"] = str(mongo_id)
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

def _strip_float_artifact(s: str) -> str:
    """Remove a spreadsheet float serialization suffix (a trailing '.0', '.00', ...) that
    appears ONLY because a phone column was read as numeric. Never touches real digits."""
    s = s.strip()
    # e.g. '9966770666.0' -> '9966770666'  (only a pure trailing .0*, nothing else)
    return re.sub(r'\.0+$', '', s)


def canonical_phone(value) -> str:
    """ONE canonical phone string for storage/display/dialling. String-only, never int/float.
    - strips the spreadsheet '.0' artifact
    - removes spaces, hyphens, parentheses, dots
    - preserves a single leading '+'
    Returns '' for empty / NaN-like inputs. Does NOT strip legitimate digits."""
    if value is None:
        return ""
    s = str(value).strip()
    if s.lower() in ("", "nan", "none", "null"):
        return ""
    s = _strip_float_artifact(s)
    plus = s.startswith("+")
    # keep digits only from the rest
    digits = re.sub(r'\D', '', s)
    if not digits:
        return ""
    return ("+" + digits) if plus else digits


def normalize_phone(phone) -> str:
    """Normalize phone number for MATCHING (last 10 digits for Indian numbers)."""
    if not phone:
        return ""
    # Strip the '.0' float artifact BEFORE extracting digits, otherwise '9966770666.0'
    # becomes 11 digits ('99667706660') and the last-10 rule returns the WRONG number.
    cleaned = _strip_float_artifact(str(phone))
    # Remove all non-digit characters
    normalized = ''.join(c for c in cleaned if c.isdigit())
    # Remove leading country code (91 for India)
    if len(normalized) > 10 and normalized.startswith('91'):
        normalized = normalized[2:]
    # Take last 10 digits
    if len(normalized) > 10:
        normalized = normalized[-10:]
    return normalized


# ===================== ACCOUNT SOURCE CLASSIFICATION =====================
# Single source of truth used by every endpoint that reports a user's Source badge,
# so Preview and Production always classify identically.
# The badge reflects CURRENT account capability, not where the record was imported from.

def has_login_credential(user):
    """True when the account holds a usable login credential.

    Production stores the bcrypt hash in `password` (auth.py verifies against it);
    accounts created through Connect registration store it in `password_hash`.
    """
    return bool(user.get("password") or user.get("password_hash"))


def classify_source(user):
    """'connect' = has a current Connect login identity. 'crm_import' = legacy-only record."""
    if has_login_credential(user) or user.get("connect_id"):
        return "connect"
    return "crm_import"


# ===================== DOCUMENT REFERENCE RESOLUTION =====================
# Records carry a UUID `id` when created inside Connect, and only an `_id` when they
# came from the legacy CRM import. Callers hand back whichever value the API gave them,
# so every lookup must accept both instead of assuming ObjectId.

def object_id_or_none(value):
    """ObjectId(value) when that is valid, otherwise None - never raises InvalidId."""
    if isinstance(value, ObjectId):
        return value
    if isinstance(value, str) and ObjectId.is_valid(value):
        return ObjectId(value)
    return None


def doc_ref_filter(ref, **extra):
    """Match a document by its `id` field or by `_id`, whichever the reference is."""
    oid = object_id_or_none(ref)
    query = {"$or": [{"id": ref}, {"_id": oid}]} if oid else {"id": ref}
    query.update(extra)
    return query
