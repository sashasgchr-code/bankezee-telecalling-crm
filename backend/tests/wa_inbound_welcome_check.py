# WhatsApp inbound welcome: lead that already has whatsapp.wamid must NOT get another welcome (send mocked, no real WhatsApp)
import asyncio, sys, time, uuid
loop = asyncio.new_event_loop(); asyncio.set_event_loop(loop)
sys.path.insert(0, '/app/backend')
from dotenv import load_dotenv; load_dotenv('/app/backend/.env')
from routes import wa_inbox, whatsapp as wa
from utils.database import db
sent = []
async def fake_send(lead, **kw):
    sent.append((lead["lead_id"], kw)); return {"ok": True}
wa.send_whatsapp_for_lead = fake_send
wa._send_configured = lambda: True
async def main():
    num = "918" + str(int(time.time()))[-9:]
    lid = f"lead_TEST{uuid.uuid4().hex[:8]}"
    await db.meta_leads.insert_one({"lead_id": lid, "full_name": "TEST Existing Welcomed", "phone": num, "phone_norm": num[-10:], "source_tab": "TEST", "status": "NEW",
                                    "whatsapp": {"wamid": "wamid.PRIOR"}, "created_at": "2026-01-01T00:00:00+00:00"})
    for i in range(2):
        msg = {"from": num, "id": f"wamid.in{i}{num}", "type": "text", "text": {"body": "Hello"}, "timestamp": str(int(time.time()))}
        await wa_inbox.on_inbound(msg, {"metadata": {"phone_number_id": wa.PHONE_NUMBER_ID}, "contacts": [{"profile": {"name": "TEST Other Name"}}]})
    n = await db.meta_leads.count_documents({"phone_norm": num[-10:]})
    conv = await db[wa_inbox.CONV.name].find_one({"wa_number": wa._to_recipient(num)})
    print("existing-wamid: sent", len(sent), "leads", n, "conv lead", conv and conv.get("lead_id") == lid)
    # second case: existing lead WITHOUT wamid gets exactly one welcome
    sent.clear()
    num2 = "917" + str(int(time.time()))[-9:]
    lid2 = f"lead_TEST{uuid.uuid4().hex[:8]}"
    await db.meta_leads.insert_one({"lead_id": lid2, "full_name": "TEST Existing NoWelcome", "phone": num2, "phone_norm": num2[-10:], "source_tab": "TEST", "status": "NEW",
                                    "created_at": "2026-01-01T00:00:00+00:00"})
    async def fake_send2(lead, **kw):
        sent.append((lead["lead_id"], kw)); await db.meta_leads.update_one({"lead_id": lead["lead_id"]}, {"$set": {"whatsapp.wamid": "wamid.T2"}}); return {"ok": True}
    wa.send_whatsapp_for_lead = fake_send2
    for i in range(2):
        msg = {"from": num2, "id": f"wamid.in{i}{num2}", "type": "text", "text": {"body": "Hi"}, "timestamp": str(int(time.time()))}
        await wa_inbox.on_inbound(msg, {"metadata": {"phone_number_id": wa.PHONE_NUMBER_ID}, "contacts": [{"profile": {"name": "X"}}]})
    n2 = await db.meta_leads.count_documents({"phone_norm": num2[-10:]})
    print("existing-no-wamid: sent", len(sent), "to", sent[0][0] == lid2 if sent else None, "leads", n2)
    for nn in (num, num2):
        await db.meta_leads.delete_many({"phone_norm": nn[-10:], "lead_id": {"$in": [lid, lid2]}})
        await db[wa_inbox.CONV.name].delete_many({"wa_number": wa._to_recipient(nn)}); await wa_inbox.MSG.delete_many({"wa_number": wa._to_recipient(nn)})
loop.run_until_complete(main())
