"""Amount normalization for Meta leads.

Customer-submitted salary / outstanding values are free text, e.g.:
  "more than rs.40,000", "20 lac", "20,00,000", "₹50,000", "50k", "9 lakhs",
  "20 - 40 lacs", "above 40 lacs", "13laks", "5L".

parse_amount_to_num() returns a single numeric value (float) used ONLY for numeric
sorting and range filtering. The original text is NEVER modified. Ambiguous text is
not treated as an exact amount: for ranges and "more than/above" we return the LOWER
bound (honest, never inflates). Bare numbers with no unit are taken literally (we do
not guess lakhs).
"""
import re
from typing import Optional

_UNIT_RE = re.compile(
    r"(\d[\d,]*\.?\d*)\s*(cr|crore|crores|l|lac|lacs|lakh|lakhs|lak|laks|k|thousand)?",
    re.IGNORECASE,
)


def parse_amount_to_num(raw) -> Optional[float]:
    """Best-effort numeric value for sort/range. None when no number is present."""
    if raw is None:
        return None
    s = str(raw).strip().lower()
    if not s:
        return None
    # Drop currency noise so the number + unit survive.
    s = s.replace("₹", " ").replace("rs.", " ").replace("rs", " ").replace("inr", " ")
    m = _UNIT_RE.search(s)
    if not m:
        return None
    num_txt = m.group(1).replace(",", "")
    try:
        val = float(num_txt)
    except ValueError:
        return None
    unit = (m.group(2) or "").lower()
    if unit in ("cr", "crore", "crores"):
        val *= 10000000
    elif unit in ("l", "lac", "lacs", "lakh", "lakhs", "lak", "laks"):
        val *= 100000
    elif unit in ("k", "thousand"):
        val *= 1000
    return val
