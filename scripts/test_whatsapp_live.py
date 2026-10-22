import asyncio, json, hmac, hashlib
from utils.database import db
import routes.whatsapp as w

REF = "TEST-WA-SASHA"

async def main():
    # Clean slate
    await db.meta_leads.delete_many({"lead_id": REF})
    await db.meta_chatbot_qualifications.delete_many({"crm_lead_ref": REF})
    await db.meta_whatsapp_log.delete_many({"lead_id": REF})
    await db.meta_leads.insert_one({
        "lead_id": REF, "full_name": "sasha", "phone": "9581802000",
        "status": "NEW", "platform": "meta", "source_tab": "Loan Merge 17102026-2",
    })
    lead = await db.meta_leads.find_one({"lead_id": REF})

    print("configured:", w._send_configured())
    print("recipient:", w._to_recipient(lead["phone"]))

    # 1. LIVE SEND
    res = await w.send_whatsapp_for_lead(lead, trigger="test")
    print("SEND RESULT:", json.dumps({k: res.get(k) for k in ('ok','wamid','skipped','error','http')}))

    lead = await db.meta_leads.find_one({"lead_id": REF})
    wa = lead.get("whatsapp") or {}
    print("stored wamid:", wa.get("wamid"))
    print("stored status:", wa.get("status"))
    print("sent_at:", wa.get("sent_at"))
    print("link_expires_at (should be +30d):", wa.get("link_expires_at"))
    print("token stored (server-side):", bool(wa.get("token")))

    # 2. IDEMPOTENCY — second call must skip (no duplicate send)
    res2 = await w.send_whatsapp_for_lead(lead, trigger="test")
    print("IDEMPOTENT skip:", res2.get("skipped"))

    # 3. maybe_autosend for a WEBSITE lead must be skipped (opt-in = Meta only)
    web_lead = {"lead_id": "TEST-WA-WEB", "full_name": "web", "phone": "9581802000", "source_tab": "Website"}
    await db.meta_leads.delete_many({"lead_id": "TEST-WA-WEB"})
    await db.meta_leads.insert_one(web_lead)
    await w.maybe_autosend(await db.meta_leads.find_one({"lead_id": "TEST-WA-WEB"}))
    wl = await db.meta_leads.find_one({"lead_id": "TEST-WA-WEB"})
    print("website lead NOT messaged:", not (wl.get("whatsapp") or {}).get("wamid"))

    # 4. STATUS WEBHOOK (signed) -> status should flip to delivered
    wamid = wa.get("wamid")
    if wamid:
        body = json.dumps({"object": "whatsapp_business_account", "entry": [
            {"id": "WABA", "changes": [{"field": "messages", "value": {
                "messaging_product": "whatsapp",
                "statuses": [{"id": wamid, "status": "delivered", "timestamp": "1700000000",
                              "recipient_id": "919581802000"}]}}]}]}).encode()
        sig = "sha256=" + hmac.new(w.APP_SECRET.encode(), body, hashlib.sha256).hexdigest()
        import httpx
        r = httpx.post("http://localhost:8001/api/integrations/whatsapp/webhook",
                       content=body, headers={"X-Hub-Signature-256": sig, "Content-Type": "application/json"}, timeout=15)
        print("webhook signed status 200:", r.status_code == 200)
        lead = await db.meta_leads.find_one({"lead_id": REF})
        print("status after delivered webhook:", (lead.get("whatsapp") or {}).get("status"))

    # cleanup
    await db.meta_leads.delete_many({"lead_id": {"$in": [REF, "TEST-WA-WEB"]}})
    await db.meta_chatbot_qualifications.delete_many({"crm_lead_ref": REF})
    await db.meta_whatsapp_log.delete_many({"lead_id": REF})

asyncio.run(main())
