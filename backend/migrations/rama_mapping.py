"""One-time, idempotent, flag-guarded migration: fix Rama's Connect<->Meta identity mapping.

Keeps THREE identities separate (no cross-map/overwrite):
  - rama@neosales.org      = Connect MANAGER (web); Meta -> Ops (rama.saffronglobal@gmail.com / user_f78e7c76fd60)
  - rama@bankezee.com      = Connect GROWTH PARTNER (web+mobile); Meta -> GP (rama@neosales.org / user_ff7502ecd6a5)
  - rama.saffronglobal@... = untouched (existing Meta Ops identity)

Idempotent: safe to run repeatedly. Recorded in db.migrations so it executes once per DB.
- Never overwrites an existing Manager password (password set only when the account is created).
- Only re-parents managers named Saikiran / Teja Vanam when their manager_id is empty or already
  points at this Rama manager (won't clobber an unexpected existing parent).
"""
import uuid
from datetime import datetime, timezone

MIGRATION_KEY = "rama_mapping_v1"
META_GP_UID = "user_ff7502ecd6a5"      # meta_users rama@neosales.org (growth_partner)
META_OPS_UID = "user_f78e7c76fd60"     # meta_users rama.saffronglobal@gmail.com (ops)


async def run(db, get_password_hash):
    existing_flag = await db.migrations.find_one({"key": MIGRATION_KEY})
    if existing_flag and existing_flag.get("done"):
        return {"skipped": True, "reason": "already applied"}

    report = {"key": MIGRATION_KEY, "actions": []}

    # (A) rama@bankezee.com -> Connect Growth Partner, Meta GP mapping
    a = await db.users.update_one({"email": "rama@bankezee.com"}, {"$set": {
        "role": "growth_partner", "is_tl": False,
        "meta_access": True, "meta_role": "growth_partner",
        "meta_email": "rama@neosales.org", "meta_user_id": META_GP_UID,
    }})
    report["actions"].append({"rama@bankezee.com": "GP+MetaGP", "matched": a.matched_count, "modified": a.modified_count})

    # (B) rama@neosales.org -> Connect Manager, Meta Ops mapping (create only if missing; don't touch existing password)
    mgr_fields = {
        "name": "Rama Samudrala", "role": "manager", "is_tl": False, "is_active": True,
        "is_approved": True, "approval_status": "approved",
        "meta_access": True, "meta_role": "ops",
        "meta_email": "rama.saffronglobal@gmail.com", "meta_user_id": META_OPS_UID,
    }
    existing = await db.users.find_one({"email": "rama@neosales.org"})
    if existing:
        await db.users.update_one({"_id": existing["_id"]}, {"$set": mgr_fields})
        mgr_id = existing.get("id") or str(existing["_id"])
        report["actions"].append({"rama@neosales.org": "existing manager fields corrected", "id": mgr_id})
    else:
        mgr_id = str(uuid.uuid4())
        doc = {"id": mgr_id, "email": "rama@neosales.org", "phone": "",
               "password": get_password_hash("Manager@123"), "plain_password": "Manager@123",
               "manager_id": None, "tl_id": None,
               "created_at": datetime.now(timezone.utc).isoformat()}
        doc.update(mgr_fields)
        await db.users.insert_one(doc)
        report["actions"].append({"rama@neosales.org": "created manager (pw Manager@123)", "id": mgr_id})

    # (C) Re-parent Saikiran / Teja Vanam under this Manager ONLY if unset or already this Rama.
    for name_rx in ["^Saikiran", "Teja"]:
        managers = await db.users.find({"name": {"$regex": name_rx, "$options": "i"}, "role": "manager"}).to_list(20)
        for m in managers:
            cur = m.get("manager_id")
            if not cur or str(cur) == mgr_id:
                await db.users.update_one({"_id": m["_id"]}, {"$set": {"manager_id": mgr_id}})
                report["actions"].append({"reparent": m.get("name"), "manager_id": mgr_id})
            else:
                report["actions"].append({"reparent_skipped": m.get("name"), "existing_manager_id": str(cur)})

    await db.migrations.update_one({"key": MIGRATION_KEY},
                                   {"$set": {"key": MIGRATION_KEY, "done": True,
                                             "applied_at": datetime.now(timezone.utc).isoformat(),
                                             "report": report}}, upsert=True)
    report["done"] = True
    return report
