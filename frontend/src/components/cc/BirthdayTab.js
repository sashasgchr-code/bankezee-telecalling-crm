import React, { useCallback, useEffect, useState } from "react";
import api from "../../services/api";
import { toast } from "sonner";
import { Cake, Send } from "lucide-react";
import { B, Kpi, StatusBadge, fmtDob, fmtDate, fmtDT, Field, inputCls, btn, errMsg } from "./ccShared";
import { CustomerDialog } from "./CustomerDialog";
import { MediaPicker } from "./CampaignWizard";

const BirthdaySettings = ({ s, onSaved }) => {
  const [b, setB] = useState(s);
  const [tpls, setTpls] = useState([]);
  useEffect(() => { api.get("/cc/templates").then(({ data }) => setTpls(data)); }, []);
  const t = tpls.find((x) => x.name === b.template && x.language === b.language);
  const save = async (patch = {}) => {
    try { await api.put("/cc/settings", { birthday: { ...b, ...patch } }); toast.success("Birthday settings saved"); onSaved(); }
    catch (e) { toast.error(errMsg(e)); }
  };
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3" data-testid="cc-bday-settings">
      <div className="flex flex-wrap gap-3 items-end">
        <label className="flex items-center gap-2 text-sm font-semibold"><input data-testid="cc-bday-enabled" type="checkbox" checked={!!b.enabled} onChange={(e) => setB({ ...b, enabled: e.target.checked })} /> Enable Birthday Automation</label>
        <Field label="Approved birthday template"><select data-testid="cc-bday-template" value={t ? `${t.name}|${t.language}` : ""} onChange={(e) => { const [n, l] = e.target.value.split("|"); setB({ ...b, template: n, language: l, var_map: {}, media_ref: null }); }} className={inputCls}>
          <option value="">Choose…</option>{tpls.map((x) => <option key={`${x.name}|${x.language}`} value={`${x.name}|${x.language}`} disabled={!x.sendable}>{x.name} · {x.status}</option>)}</select></Field>
        <Field label="Send time (IST)"><input data-testid="cc-bday-time" type="time" step="900" value={b.send_time} onChange={(e) => setB({ ...b, send_time: e.target.value })} className={inputCls} /></Field>
        <Field label="29 Feb in non-leap years"><select data-testid="cc-bday-feb29" value={b.feb29_policy} onChange={(e) => setB({ ...b, feb29_policy: e.target.value })} className={inputCls}><option value="feb28">Send on 28 Feb</option><option value="mar1">Send on 1 Mar</option></select></Field>
        <Field label="Missed days"><select value="none" disabled className={inputCls}><option value="none">No late greetings</option></select></Field>
      </div>
      {t && [...(t.body_vars || [])].map((k) => (
        <div key={k} className="flex gap-2 items-end"><Field label={`Variable {{${k}}}`}><select data-testid={`cc-bday-var-${k}`} value={b.var_map?.[k]?.source || ""} onChange={(e) => setB({ ...b, var_map: { ...b.var_map, [k]: { source: e.target.value, first_name: true } } })} className={inputCls}><option value="">Choose…</option><option value="customer_name">Customer first name</option><option value="static">Fixed text</option></select></Field>
          {b.var_map?.[k]?.source === "static" && <input value={b.var_map[k].value || ""} onChange={(e) => setB({ ...b, var_map: { ...b.var_map, [k]: { source: "static", value: e.target.value } } })} className={inputCls} />}</div>))}
      {t && ["IMAGE", "VIDEO", "DOCUMENT"].includes(t.header_type) && <MediaPicker kind={t.header_type} mediaRef={b.media_ref} onChange={(r) => setB({ ...b, media_ref: r })} testid="cc-bday-media" />}
      <div className="flex gap-2 items-center">
        <button type="button" data-testid="cc-bday-save" onClick={() => save()} className={btn("primary")}>Save</button>
        <span className="text-[11px] text-slate-500">Audience: approved & disbursed customers with DOB, opted in, valid WhatsApp number. One greeting per customer per year. Last run: {b.last_run_date || "never"}.</span>
      </div>
    </div>
  );
};

export const BirthdayTab = ({ me }) => {
  const [d, setD] = useState(null);
  const [view, setView] = useState(null);
  const load = useCallback(() => api.get("/cc/birthdays").then(({ data }) => setD(data)).catch((e) => toast.error(errMsg(e))), []);
  useEffect(() => { load(); }, [load]);
  const manual = async (cid, repeat = false) => {
    try { const { data } = await api.post("/cc/birthdays/manual", { customer_id: cid, confirm_repeat: repeat }); toast.success(`Greeting: ${data.status}`); load(); }
    catch (e) {
      if (e?.response?.status === 409 && window.confirm("A birthday greeting was already sent this year. Send another one?")) return manual(cid, true);
      toast.error(errMsg(e));
    }
  };
  if (!d) return <p className="text-sm text-slate-500">Loading…</p>;
  const c = d.counts;
  return (
    <div className="space-y-4" data-testid="cc-birthday-tab">
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
        <Kpi testid="cc-b-today" label="Birthdays Today" value={c.today} color={B.gold} /><Kpi testid="cc-b-tomorrow" label="Tomorrow" value={c.tomorrow} />
        <Kpi testid="cc-b-next7" label="Next 7 Days" value={c.next7} /><Kpi testid="cc-b-sent" label="Wishes Sent Today" value={c.sent_today} color={B.blue} />
        <Kpi testid="cc-b-delivered" label="Delivered Today" value={c.delivered_today} color={B.emerald} /><Kpi testid="cc-b-failed" label="Failed Today" value={c.failed_today} color={B.red} />
        <Kpi testid="cc-b-missing" label="Missing DOB" value={c.missing_dob} color={B.red} />
      </div>
      {d.settings && me.is_admin && <BirthdaySettings s={d.settings} onSaved={load} />}
      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <h3 className="px-4 pt-3 text-sm font-bold flex items-center gap-2" style={{ color: B.navy }}><Cake size={15} /> Upcoming birthdays (next 30 days)</h3>
        <table className="w-full text-sm mt-2" data-testid="cc-bday-upcoming"><thead className="bg-slate-50"><tr>{["Customer", "DOB", "Mobile", "GP", "Processor", "Birthday", "WhatsApp Status", ""].map((h) => <th key={h} className="text-left px-3 py-2 text-[10px] uppercase text-slate-500">{h}</th>)}</tr></thead>
          <tbody>{d.upcoming.length === 0 && <tr><td colSpan={8} className="text-center py-6 text-slate-400">No birthdays in the next 30 days (add DOBs on the customer list).</td></tr>}
            {d.upcoming.map((u) => (
              <tr key={u.customer_id} className="border-t" data-testid={`cc-bday-row-${u.customer_id}`}>
                <td className="px-3 py-2 font-semibold">{u.name}</td><td className="px-3 py-2">{fmtDob(u.dob)}</td><td className="px-3 py-2">{u.phone}</td><td className="px-3 py-2">{u.gp || "—"}</td><td className="px-3 py-2">{u.processor || "—"}</td>
                <td className="px-3 py-2">{fmtDate(u.birthday)}{u.in_days === 0 ? " (today)" : ""}</td><td className="px-3 py-2 text-xs">{u.whatsapp_status}</td>
                <td className="px-3 py-2 whitespace-nowrap">{me.can_edit && <button type="button" onClick={() => setView(u.customer_id)} className="text-xs font-semibold mr-2" style={{ color: B.blue }}>Edit DOB</button>}
                  {me.is_admin && u.whatsapp_status === "eligible" && <button type="button" data-testid={`cc-bday-manual-${u.customer_id}`} onClick={() => manual(u.customer_id)} className="text-xs font-semibold inline-flex items-center gap-1" style={{ color: B.emerald }}><Send size={12} /> Send now</button>}</td>
              </tr>))}</tbody></table>
      </div>
      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <h3 className="px-4 pt-3 text-sm font-bold" style={{ color: B.navy }}>Automation log</h3>
        <table className="w-full text-xs mt-2" data-testid="cc-bday-log"><thead className="bg-slate-50"><tr>{["Customer", "DOB", "Template", "Scheduled", "Sent", "Status", "Failure / skip reason"].map((h) => <th key={h} className="text-left px-3 py-2 text-[10px] uppercase text-slate-500">{h}</th>)}</tr></thead>
          <tbody>{d.log.length === 0 && <tr><td colSpan={7} className="text-center py-6 text-slate-400">No birthday attempts yet.</td></tr>}
            {d.log.map((m) => (
              <tr key={m.dedupe_key} className="border-t"><td className="px-3 py-1.5">{m.name}{m.manual_by ? ` (manual by ${m.manual_by})` : ""}</td><td className="px-3 py-1.5">{fmtDob(m.dob)}</td><td className="px-3 py-1.5">{m.template}</td>
                <td className="px-3 py-1.5">{fmtDT(m.scheduled_for)}</td><td className="px-3 py-1.5">{fmtDT(m.submitted_at || m.processed_at)}</td><td className="px-3 py-1.5"><StatusBadge s={m.status} /></td><td className="px-3 py-1.5 text-red-600">{m.error || m.note || ""}</td></tr>))}</tbody></table>
      </div>
      <CustomerDialog id={view} me={me} onClose={() => setView(null)} onChanged={load} />
    </div>
  );
};
