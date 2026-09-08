"""
Phase 2 - Link Connect identities to imported Meta users (isolated, non-destructive).

Rule (per spec):
  1. Case-insensitive email match Connect<->Meta => auto-link identity.
  2. No duplicate Meta users created.
  3. Unmatched Meta users preserved unchanged (reported for manual mapping).
  4. Connect ID formats left untouched (we match on email, never ObjectId() coercion).

On a matched Connect user we set (without touching anything else):
  meta_access   = True
  meta_role     = <meta user's role>
  meta_email    = <meta user's email>   (operational identity, kept separate from login email)
  meta_user_id  = <meta user's user_id or _id>
"""
import asyncio, os
from dotenv import load_dotenv
load_dotenv()
from motor.motor_asyncio import AsyncIOMotorClient


async def main():
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]

    meta_users = await db.meta_users.find({}).to_list(1000)
    connect_users = await db.users.find({}, {"email": 1, "meta_access": 1}).to_list(10000)
    conn_by_email = {}
    for u in connect_users:
        e = (u.get("email") or "").strip().lower()
        if e:
            conn_by_email[e] = u

    auto_mapped, manual_needed = [], []
    for mu in meta_users:
        email = (mu.get("email") or "").strip().lower()
        meta_uid = mu.get("user_id") or (mu.get("_id") if isinstance(mu.get("_id"), str) else str(mu.get("_id")))
        cu = conn_by_email.get(email)
        is_seed = ("example.com" in email) or email.startswith("test_") or email.startswith("testrestore")
        if cu:
            await db.users.update_one(
                {"_id": cu["_id"]},
                {"$set": {
                    "meta_access": True,
                    "meta_role": mu.get("role"),
                    "meta_email": mu.get("email"),
                    "meta_user_id": meta_uid,
                }},
            )
            auto_mapped.append({"email": mu.get("email"), "meta_role": mu.get("role"), "meta_user_id": meta_uid})
        else:
            manual_needed.append({"email": mu.get("email"), "meta_role": mu.get("role"),
                                  "meta_user_id": meta_uid, "seed_or_test": is_seed})

    print(f"=== AUTO-MAPPED ({len(auto_mapped)}) ===")
    for m in auto_mapped:
        print(f"  {m['email']:40} role={m['meta_role']:15} meta_user_id={m['meta_user_id']}")
    real_manual = [m for m in manual_needed if not m["seed_or_test"]]
    seed_manual = [m for m in manual_needed if m["seed_or_test"]]
    print(f"\n=== MANUAL MAPPING NEEDED - real ({len(real_manual)}) ===")
    for m in real_manual:
        print(f"  {m['email']:40} role={m['meta_role']}")
    print(f"\n=== unmatched seed/test Meta users ({len(seed_manual)}) - preserved, ignore ===")
    print(f"\nSUMMARY: auto={len(auto_mapped)} real_manual={len(real_manual)} seed={len(seed_manual)} total_meta_users={len(meta_users)}")


if __name__ == "__main__":
    asyncio.run(main())
