"""One-time File date repair.

Two safe, additive operations on `leads` documents with `status == "file"`:
  1. `file_created_at` (BSON date) - when the lead actually became a File. Sourced, in order,
     from the `file_created` entry in `file_activities`, then a status-change activity in the
     `activities` collection, then the file's own `created_at`.
  2. Normalise ISO-STRING `created_at` / `updated_at` into real BSON dates (same instant, only
     the storage type changes) so date filters and indexes work.

Nothing else is written. Dry run by default. Re-running is a no-op.
"""
import collections
from datetime import datetime, timezone

FILE_QUERY = {"status": "file"}


def to_datetime(value):
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, str) and value.strip():
        text = value.strip().replace("Z", "+00:00")
        try:
            parsed = datetime.fromisoformat(text)
        except ValueError:
            return None
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    return None


def conversion_time(doc, activity_by_lead):
    """Best available timestamp for 'became a File', with its provenance."""
    for entry in doc.get("file_activities") or []:
        if entry.get("type") == "file_created":
            when = to_datetime(entry.get("timestamp"))
            if when:
                return when, "file_activities.file_created"
    stamps = [to_datetime(e.get("timestamp")) for e in (doc.get("file_activities") or [])]
    stamps = [s for s in stamps if s]
    if stamps:
        return min(stamps), "file_activities.earliest"
    for key in (doc.get("id"), str(doc.get("_id"))):
        when = to_datetime((activity_by_lead.get(key) or {}).get("timestamp"))
        if when:
            return when, "activities.status_change"
    when = to_datetime(doc.get("created_at"))
    if when:
        return when, "created_at"
    return None, "unavailable"


async def load_conversion_activities(db):
    """Earliest 'converted to file' activity per lead."""
    out = {}
    cursor = db.activities.find({"to_status": "file"}, {"lead_id": 1, "timestamp": 1}).sort("timestamp", 1)
    async for act in cursor:
        out.setdefault(str(act.get("lead_id")), act)
    return out


async def run_backfill(db, apply=False):
    activity_by_lead = await load_conversion_activities(db)
    counts = collections.Counter()
    sources = collections.Counter()
    samples = []
    failures = []

    cursor = db.leads.find(FILE_QUERY, {
        "id": 1, "name": 1, "created_at": 1, "updated_at": 1, "file_created_at": 1,
        "file_activities": 1})
    async for doc in cursor:
        counts["files"] += 1
        set_doc = {}

        if not isinstance(doc.get("file_created_at"), datetime):
            when, source = conversion_time(doc, activity_by_lead)
            if when:
                set_doc["file_created_at"] = when
                sources[source] += 1
            else:
                failures.append({"id": doc.get("id"), "name": doc.get("name"),
                                 "reason": "no usable timestamp"})
        for field in ("created_at", "updated_at"):
            value = doc.get(field)
            if isinstance(value, datetime) or value is None:
                continue
            normalised = to_datetime(value)
            if normalised:
                set_doc[field] = normalised
                counts["normalised_" + field] += 1
            else:
                failures.append({"id": doc.get("id"), "name": doc.get("name"),
                                 "reason": f"unparsable {field}: {value!r}"})

        if not set_doc:
            counts["already_correct"] += 1
            continue
        counts["to_update"] += 1
        if len(samples) < 15:
            samples.append({"id": doc.get("id"), "name": doc.get("name"),
                            "created_at_before": str(doc.get("created_at")),
                            "updated_at_before": str(doc.get("updated_at")),
                            "file_created_at": str(set_doc.get("file_created_at",
                                                               doc.get("file_created_at")))})
        if apply:
            try:
                result = await db.leads.update_one({"_id": doc["_id"]}, {"$set": set_doc})
                counts["updated"] += 1
                counts["modified"] += result.modified_count
            except Exception as exc:  # noqa: BLE001
                counts["failed"] += 1
                failures.append({"id": doc.get("id"), "error": str(exc)})

    return {
        "mode": "apply" if apply else "dry_run",
        "run_at": datetime.now(timezone.utc).isoformat(),
        "db": db.name,
        "files_scanned": counts["files"],
        "files_to_update" if not apply else "files_updated":
            counts["to_update"] if not apply else counts["updated"],
        "already_correct": counts["already_correct"],
        "file_created_at_sources": dict(sources),
        "created_at_normalised": counts["normalised_created_at"],
        "updated_at_normalised": counts["normalised_updated_at"],
        "failed": counts["failed"],
        "failures": failures[:50],
        "samples": samples,
        "new_documents_created": 0,
        "documents_deleted": 0,
    }
