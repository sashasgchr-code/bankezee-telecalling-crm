import React, { useEffect, useState } from "react";
import api from "../../services/api";
import { toast } from "sonner";
import { Settings } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { Field, inputCls, btn, errMsg } from "./ccShared";

export const SettingsDialog = ({ onChanged }) => {
  const [open, setOpen] = useState(false);
  const [s, setS] = useState(null);
  const [newType, setNewType] = useState("");
  useEffect(() => { if (open) api.get("/cc/settings").then(({ data }) => setS(data)).catch((e) => toast.error(errMsg(e))); }, [open]);
  const save = async (patch) => {
    try { const { data } = await api.put("/cc/settings", patch); setS((p) => ({ ...p, ...data })); toast.success("Saved"); onChanged(); }
    catch (e) { toast.error(errMsg(e)); }
  };
  const toggleLive = () => {
    if (!s.live_sending && !window.confirm("Enable LIVE sending? Confirmed campaigns and birthday greetings will send real WhatsApp messages to opted-in customers.")) return;
    save({ live_sending: !s.live_sending });
  };
  const access = async (u) => { await api.put(`/cc/users-access/${u.id}`, { enabled: !u.cc_campaign_access }); setS({ ...s, users: s.users.map((x) => (x.id === u.id ? { ...x, cc_campaign_access: !x.cc_campaign_access } : x)) }); };
  return (
    <>
      <button type="button" data-testid="cc-settings-btn" onClick={() => setOpen(true)} className={btn("ghost")}><Settings size={14} /> Settings</button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto" data-testid="cc-settings-dialog">
          <DialogHeader><DialogTitle>Campaign settings</DialogTitle></DialogHeader>
          {s && <div className="space-y-5 text-sm">
            <div className={`rounded-lg border p-3 ${s.live_sending ? "bg-red-50 border-red-200" : "bg-violet-50 border-violet-200"}`}>
              <p className="font-semibold">{s.live_sending ? "LIVE sending is ON — real WhatsApp messages are sent." : "Mock mode — no WhatsApp messages are sent."}</p>
              <button type="button" data-testid="cc-live-toggle" onClick={toggleLive} className={btn(s.live_sending ? "ghost" : "danger") + " mt-2"}>{s.live_sending ? "Switch back to mock mode" : "Enable live sending"}</button>
            </div>
            <div className="flex gap-2 items-end">
              <Field label="Admin test WhatsApp number"><input data-testid="cc-test-number" value={s.test_number || ""} onChange={(e) => setS({ ...s, test_number: e.target.value })} placeholder="10-digit mobile" className={inputCls} /></Field>
              <Field label="Price per message (₹, optional)"><input data-testid="cc-price" type="number" step="0.01" value={s.price_per_message ?? ""} onChange={(e) => setS({ ...s, price_per_message: e.target.value === "" ? null : +e.target.value })} className={`${inputCls} w-28`} /></Field>
              <button type="button" data-testid="cc-settings-save" onClick={() => save({ test_number: s.test_number || "", ...(s.price_per_message !== null ? { price_per_message: s.price_per_message } : {}) })} className={btn("primary")}>Save</button>
            </div>
            <div>
              <p className="font-semibold mb-1">Campaign types</p>
              <div className="flex flex-wrap gap-1.5 mb-2">{s.campaign_types.map((t) => <span key={t} className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100">{t} <button type="button" onClick={() => save({ campaign_types: s.campaign_types.filter((x) => x !== t) })} className="text-slate-400 ml-0.5">×</button></span>)}</div>
              <div className="flex gap-2"><input data-testid="cc-new-type" value={newType} onChange={(e) => setNewType(e.target.value)} placeholder="New campaign type" className={inputCls} />
                <button type="button" data-testid="cc-add-type" onClick={() => { if (newType.trim()) { save({ campaign_types: [...s.campaign_types, newType.trim()] }); setNewType(""); } }} className={btn("ghost")}>Add</button></div>
            </div>
            <div>
              <p className="font-semibold mb-1">Who else may create & send campaigns</p>
              {s.users.length === 0 && <p className="text-xs text-slate-400">No ops or manager users.</p>}
              {s.users.map((u) => <label key={u.id} className="flex items-center gap-2 text-xs py-0.5"><input data-testid={`cc-access-${u.id}`} type="checkbox" checked={!!u.cc_campaign_access} onChange={() => access(u)} />{u.name} ({u.role})</label>)}
            </div>
          </div>}
        </DialogContent>
      </Dialog>
    </>
  );
};
