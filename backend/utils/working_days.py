"""
Centralized working-day / holiday determination for BANKEZEE Connect.

A day is NON-working if it is a weekend (Sat/Sun) OR a configured company holiday.
Holidays are stored in the `holidays` collection (admin-managed) and cached briefly.
This is the single source of truth used by attendance, matrix, WFH and leave logic.
"""
import time
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

from utils.database import db as _default_db

IST = ZoneInfo("Asia/Kolkata")

_cache = {"ts": 0.0, "dates": set()}
_TTL_SECONDS = 30


def _coerce_date(value):
    """Normalize a datetime/date/ISO-string to a python `date` (IST calendar)."""
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is not None:
            value = value.astimezone(IST)
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00")[:19]).date() \
                if len(value) > 10 else datetime.fromisoformat(value[:10]).date()
        except ValueError:
            return None
    return None


def invalidate_holiday_cache():
    """Force the holiday set to be re-loaded on the next call (after CRUD)."""
    _cache["ts"] = 0.0


async def load_holiday_dates(db=None):
    """Return the set of configured holiday `date` objects (cached ~30s)."""
    database = db if db is not None else _default_db
    now = time.time()
    if now - _cache["ts"] < _TTL_SECONDS and _cache["dates"] is not None:
        return _cache["dates"]
    dates = set()
    async for h in database.holidays.find({}, {"date": 1}):
        d = _coerce_date(h.get("date"))
        if d is not None:
            dates.add(d)
    _cache["ts"] = now
    _cache["dates"] = dates
    return dates


def is_weekend(d) -> bool:
    """Weekly-off day. BankEzee works Mon-Sat; only SUNDAY is the default weekly off."""
    dd = _coerce_date(d)
    return dd is not None and dd.weekday() == 6


def is_non_working(d, holidays=None) -> bool:
    """True if the date is the weekly off (Sunday) or a configured holiday."""
    dd = _coerce_date(d)
    if dd is None:
        return False
    if dd.weekday() == 6:  # Sunday only
        return True
    if holidays and dd in holidays:
        return True
    return False


def is_working_day(d, holidays=None) -> bool:
    return not is_non_working(d, holidays)
