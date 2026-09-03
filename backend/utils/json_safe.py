"""Make legacy/imported Mongo documents safe for JSON responses."""
import math
from datetime import datetime, date
from bson import ObjectId
from bson.decimal128 import Decimal128


def json_safe(value):
    """Recursively convert BSON/float values that FastAPI + json.dumps cannot encode.

    Legacy CRM imports contain NaN/Infinity floats (Excel/pandas exports) and nested
    ObjectId/Decimal128/bytes values which raise ValueError during response encoding.
    """
    if isinstance(value, float):
        return None if (math.isnan(value) or math.isinf(value)) else value
    if isinstance(value, ObjectId):
        return str(value)
    if isinstance(value, Decimal128):
        return float(value.to_decimal())
    if isinstance(value, bytes):
        return value.decode('utf-8', errors='replace')
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(k): json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_safe(v) for v in value]
    return value
