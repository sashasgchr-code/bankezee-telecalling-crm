"""Single definition of the Files population.

Both the Files list and the Files dashboard/stats (and the exports) build their query here,
so identical active filters always resolve to an identical set of documents.

Fail-closed contract: when an explicitly selected Manager / Team Lead / Growth Partner scope
resolves to nobody, `build_files_query` returns None. Callers MUST render an empty result
(0 rows, 0 stats) - never fall back to the unrestricted dataset.
"""
from datetime import datetime, timezone, timedelta

from utils.auth import normalize_role, is_gp_role
from utils.hierarchy import load_user_index

OWNER_FIELDS = ("assigned_to", "file_assigned_to", "source_id")
ASSIGNEE_FIELDS = ("assigned_to", "file_assigned_to")


def owner_clause(ids, fields=OWNER_FIELDS):
    id_list = sorted(i for i in ids if i)
    return {"$or": [{field: {"$in": id_list}} for field in fields]}


def _parse_start(value):
    try:
        if "T" in value:
            dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        else:
            dt = datetime.fromisoformat(value + "T00:00:00+00:00")
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except (ValueError, TypeError):
        return None


def _parse_end(value):
    try:
        if "T" in value:
            dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        else:
            dt = datetime.fromisoformat(value + "T23:59:59+00:00")
        return dt if dt.tzinfo else dt.replace(hour=23, minute=59, second=59, tzinfo=timezone.utc)
    except (ValueError, TypeError):
        return None


def _date_clause(field, start_date, end_date):
    """Match both real datetimes and the ISO strings legacy CRM rows carry."""
    dt_range, str_range = {}, {}
    start = _parse_start(start_date) if start_date else None
    end = _parse_end(end_date) if end_date else None
    if start:
        dt_range["$gte"] = start
        str_range["$gte"] = start.strftime("%Y-%m-%d")
    if end:
        dt_range["$lte"] = end
        str_range["$lte"] = (end + timedelta(days=1)).strftime("%Y-%m-%d")
    if not dt_range:
        return None
    return {"$or": [{field: dt_range}, {field: str_range}]}


def search_clause(search):
    regex = {"$regex": search, "$options": "i"}
    return {"$or": [
        {"name": regex}, {"full_name": regex}, {"mobile": regex},
        {"phone": regex}, {"email": regex},
        {"file_details.full_name": regex}, {"file_details.mobile": regex},
    ]}


async def build_files_query(
    db,
    current_user,
    *,
    file_status=None,
    gp_id=None,
    tl_id=None,
    manager_id=None,
    assigned_to=None,
    loan_types=None,
    search=None,
    start_date=None,
    end_date=None,
    activity_start_date=None,
    activity_end_date=None,
    team_view=False,
    index=None,
):
    """Return the Mongo query for the requested Files population, or None to fail closed."""
    idx = index or await load_user_index(db)
    clauses = [{"status": "file"}]

    role = normalize_role(current_user.get("role", ""))
    user_key = current_user.get("id") or str(current_user.get("_id") or "")

    # ---- role scope ----
    if role in ("admin", "ops"):
        pass
    elif role == "manager":
        # Full recursive downward subtree (direct GPs, TLs, GPs under TLs, sub-managers and below)
        scope = idx.descendants(user_key)
        if not scope:
            return None
        clauses.append(owner_clause(scope))
    elif is_gp_role(role):
        if team_view and current_user.get("is_tl"):
            team = idx.descendants(user_key, include_self=False)
            if not team:
                return None
            clauses.append(owner_clause(team))
        else:
            own = idx.aliases(user_key) or {user_key}
            clauses.append(owner_clause(own))
    else:
        return None  # hr and any other role have no Files access

    # ---- explicit scope filters (fail closed) ----
    if gp_id:
        scope = idx.aliases(gp_id)
        if not scope:
            return None
        clauses.append(owner_clause(scope))
    if tl_id:
        scope = idx.descendants(tl_id, include_self=False)
        if not scope:
            return None
        clauses.append(owner_clause(scope))
    if manager_id:
        scope = idx.descendants(manager_id)
        if not scope:
            return None
        clauses.append(owner_clause(scope))
    if assigned_to:
        scope = idx.aliases(assigned_to) or {assigned_to}
        clauses.append(owner_clause(scope, ASSIGNEE_FIELDS))

    # ---- attribute filters ----
    if file_status:
        clauses.append({"file_status": file_status})
    if loan_types:
        types = [t.strip() for t in loan_types.split(",") if t.strip()] if isinstance(loan_types, str) else list(loan_types)
        if types:
            clauses.append({"file_details.type_of_loan": {"$in": types}})
    if search:
        clauses.append(search_clause(search))

    created = _date_clause("created_at", start_date, end_date)
    if created:
        clauses.append(created)
    activity = _date_clause("updated_at", activity_start_date, activity_end_date)
    if activity:
        clauses.append(activity)

    return {"$and": clauses} if len(clauses) > 1 else clauses[0]
