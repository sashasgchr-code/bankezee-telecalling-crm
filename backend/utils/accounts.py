"""Exact user-ACCOUNT resolution for Admin CRUD.

Deliberately the opposite of `utils.hierarchy`: that module answers "which identifiers belong
to this PERSON" (needed for historical leads/files/calls ownership). This module answers
"which single Mongo document did the Admin click", and it must never expand to aliases or
same-email documents. One selected account -> one document -> matched_count == 1.
"""
from bson import ObjectId
from fastapi import HTTPException


def account_key(doc):
    """Immutable key of a user document - always its Mongo _id as a string."""
    return str(doc["_id"])


async def resolve_account(db, key: str):
    """The one user document identified by `key`. Raises instead of guessing.

    Accepts the immutable `_id` (preferred, sent by the UI as `account_key`) and falls back to
    the legacy `id` field for older callers. An ambiguous `id` is a hard error, never a guess.
    """
    if not key or not str(key).strip():
        raise HTTPException(status_code=400, detail="Account identifier is required")
    key = str(key).strip()

    if ObjectId.is_valid(key):
        doc = await db.users.find_one({"_id": ObjectId(key)})
        if doc:
            return doc
    doc = await db.users.find_one({"_id": key})
    if doc:
        return doc

    matches = await db.users.find({"id": key}).to_list(3)
    if len(matches) == 1:
        return matches[0]
    if len(matches) > 1:
        raise HTTPException(
            status_code=409,
            detail=f"Identifier '{key}' matches {len(matches)} accounts. Send the exact account_key."
        )
    raise HTTPException(status_code=404, detail="User account not found")


def own_identifiers(doc):
    """Identifiers this ONE account is referenced by (no person/alias expansion)."""
    keys = {str(doc["_id"])}
    for field in ("id", "connect_id", "legacy_user_id"):
        value = doc.get(field)
        if isinstance(value, str) and value.strip():
            keys.add(value.strip())
    return keys
