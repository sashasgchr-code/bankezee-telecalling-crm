"""Identity resolution and recursive hierarchy traversal.

One person can exist as several `users` documents (legacy CRM import + Connect account),
sometimes with different `id` values, and lead/file/call ownership fields may reference any
of those identifiers. Everything that needs "who is this person" or "who reports to whom"
must go through this module so every endpoint answers identically.

Read-only: nothing here writes to the database.
"""
from collections import defaultdict

EMAIL_PREFIX = "email:"
PARENT_FIELDS = ("manager_id", "tl_id")
ALIAS_FIELDS = ("id", "connect_id", "legacy_user_id")
MAX_DEPTH = 25  # guard against pathological chains; cycles are handled separately


def norm_email(value):
    return (value or "").strip().lower()


def _doc_keys(doc):
    """Every identifier this document can be referenced by. Order-stable, deduplicated."""
    keys = []
    mongo_id = doc.get("_id")
    if mongo_id is not None:
        keys.append(str(mongo_id))
    for field in ALIAS_FIELDS:
        value = doc.get(field)
        if isinstance(value, str) and value.strip():
            keys.append(value.strip())
    email = norm_email(doc.get("email"))
    if email:
        keys.append(EMAIL_PREFIX + email)
    seen = set()
    return [k for k in keys if not (k in seen or seen.add(k))]


class UserIndex:
    """In-memory union-find index over the users collection."""

    def __init__(self, docs):
        self._parent = {}
        self.groups = {}
        self._root_of = {}
        self._children = defaultdict(set)

        for doc in docs:
            keys = _doc_keys(doc)
            for key in keys[1:]:
                self._union(keys[0], key)

        for doc in docs:
            keys = _doc_keys(doc)
            if not keys:
                continue
            root = self._find(keys[0])
            group = self.groups.setdefault(root, {"ids": set(), "emails": set(), "docs": [], "active": False})
            group["docs"].append(doc)
            for key in keys:
                if key.startswith(EMAIL_PREFIX):
                    group["emails"].add(key[len(EMAIL_PREFIX):])
                else:
                    group["ids"].add(key)
            if doc.get("is_active"):
                group["active"] = True

        for root, group in self.groups.items():
            for key in group["ids"]:
                self._root_of[key] = root
            for email in group["emails"]:
                self._root_of[EMAIL_PREFIX + email] = root

        # hierarchy edges, resolved to groups so legacy/duplicate ids link up
        for root, group in self.groups.items():
            for doc in group["docs"]:
                for field in PARENT_FIELDS:
                    parent_root = self._root_of.get(_lookup_key(doc.get(field)))
                    if parent_root and parent_root != root:
                        self._children[parent_root].add(root)

    # ---- union-find ----
    def _find(self, key):
        self._parent.setdefault(key, key)
        while self._parent[key] != key:
            self._parent[key] = self._parent[self._parent[key]]
            key = self._parent[key]
        return key

    def _union(self, a, b):
        ra, rb = self._find(a), self._find(b)
        if ra != rb:
            self._parent[ra] = rb

    # ---- public API ----
    def root_for(self, key):
        return self._root_of.get(_lookup_key(key))

    def group_for(self, key):
        root = self.root_for(key)
        return self.groups.get(root) if root else None

    def aliases(self, key):
        """All identifiers equivalent to `key`. Empty set when the person is unknown."""
        group = self.group_for(key)
        return set(group["ids"]) if group else set()

    def docs_for(self, key):
        group = self.group_for(key)
        return list(group["docs"]) if group else []

    def is_active(self, key):
        group = self.group_for(key)
        return bool(group and group["active"])

    def canonical_doc(self, key):
        """The one editable document for this person (see _primary_doc)."""
        group = self.group_for(key)
        return _primary_doc(group) if group else None

    def canonical_id(self, key):
        doc = self.canonical_doc(key)
        if not doc:
            return None
        return doc.get("id") or str(doc["_id"])

    def display_name(self, key):
        doc = self.canonical_doc(key)
        if not doc:
            return None
        return doc.get("name") or doc.get("full_name") or doc.get("email")

    def descendant_roots(self, key, include_self=True):
        """Group roots for the whole subtree below `key`. Cycle-safe."""
        root = self.root_for(key)
        if not root:
            return set()
        visited = {root}
        frontier = {root}
        for _ in range(MAX_DEPTH):
            nxt = set()
            for node in frontier:
                nxt |= self._children.get(node, set())
            nxt -= visited
            if not nxt:
                break
            visited |= nxt
            frontier = nxt
        if not include_self:
            visited.discard(root)
        return visited

    def descendants(self, key, include_self=True, active_only=True):
        """All identifiers owned by the subtree below `key`, deduplicated.

        `active_only` is evaluated per PERSON, not per document: a person counts as active
        when any of their documents is active, so inactive legacy duplicates never drop a
        live team member nor duplicate them.
        """
        root = self.root_for(key)
        ids = set()
        for node in self.descendant_roots(key, include_self=include_self):
            group = self.groups[node]
            if active_only and not group["active"] and node != root:
                continue
            ids |= group["ids"]
        return ids

    def subtree_members(self, key, include_self=True, active_only=True):
        """One representative document per person in the subtree (deduplicated)."""
        root = self.root_for(key)
        members = []
        for node in self.descendant_roots(key, include_self=include_self):
            group = self.groups[node]
            if active_only and not group["active"] and node != root:
                continue
            members.append(_primary_doc(group))
        return members

    def team_leads_under(self, key, include_self=False):
        """Active Team Leads anywhere in the subtree below `key`."""
        leads = []
        for member in self.subtree_members(key, include_self=include_self):
            if member.get("is_tl"):
                leads.append(member)
        return leads

    def belongs_under(self, key, ancestor_key):
        root = self.root_for(key)
        return bool(root and root in self.descendant_roots(ancestor_key))


def _lookup_key(value):
    if not isinstance(value, str) or not value.strip():
        return None
    value = value.strip()
    return value if "@" not in value else EMAIL_PREFIX + value.lower()


def _primary_doc(group):
    """Deterministic canonical document for a person - never varies between requests.

    Order: active + login credential > active > has connect_id > oldest _id.
    Admin edits (role, active, manager, TL) must always read and write this document;
    the other documents of the same person are aliases for historical ownership only.
    """
    docs = sorted(group["docs"], key=lambda d: str(d.get("_id")))
    for doc in docs:
        if doc.get("is_active") and doc.get("has_login"):
            return doc
    for doc in docs:
        if doc.get("is_active"):
            return doc
    for doc in docs:
        if doc.get("connect_id"):
            return doc
    return docs[0]


async def load_user_index(db):
    """Load the users collection once and build the index (collection is small).

    Credentials are reduced to a boolean inside Mongo so no hash ever enters the process.
    """
    docs = await db.users.aggregate([
        {"$project": {
            "id": 1, "connect_id": 1, "legacy_user_id": 1, "email": 1,
            "name": 1, "full_name": 1, "role": 1, "is_tl": 1, "is_active": 1,
            "manager_id": 1, "tl_id": 1,
            "has_login": {"$or": [
                {"$toBool": {"$ifNull": ["$password", False]}},
                {"$toBool": {"$ifNull": ["$password_hash", False]}},
            ]},
        }}
    ]).to_list(5000)
    return UserIndex(docs)
