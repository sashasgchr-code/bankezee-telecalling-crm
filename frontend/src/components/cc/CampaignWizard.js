import React, { useEffect, useState } from "react";
import api from "../../services/api";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { B, Field, inputCls, btn, errMsg } from "./ccShared";
import { CustomerFilters, useFilterOptions } from "./CustomersTab";
import { TemplatePreview } from "./TemplatesTab";

const STEPS = ["Details", "Audience", "Template", "Media", "Schedule", "Preview & Confirm"];
const BLANK = { name: "", type: "", description: "", filters: { status: "both" }, customer_ids: null, template: "", language: "", var_map: {}, media_ref: null, schedule_mode: "now", schedule_at: "", timezone: "Asia/Kolkata" };

const Audience = ({ v, set }) => {
  const opts = useFilterOptions();
  const [count, setCount] = useState(null);
  const [pick, setPick] = useState(false);
  const [q, setQ] = useState("");
  const [list, setList] = useState([]);
  const f = v.filters;
  const setF = (nf) => set({ ...v, filters: nf });
  useEffect(() => {
    const t = setTimeout(() => api.post("/cc/audience/preview", { filters: f, customer_ids: v.customer_ids }).then(({ data }) => setCount(data)).catch(() => {}), 350);
    return () => clearTimeout(t);
  }, [f, v.customer_ids]);
  useEffect(() => { if (pick) api.get("/cc/customers", { params: { name: q, page_size: 50 } }).then(({ data }) => setList(data.items)); }, [pick, q]);
  const ids = new Set(v.customer_ids || []);
  const toggle = (id) => { const n = new Set(ids); n.has(id) ? n.delete(id) : n.add(id); set({ ...v, customer_ids: n.size ? [...n] : null }); };
  const num = (k, label) => <Field label={label}><input data-testid={`cc-aud-${k}`} type="number" min="0" value={f[k] || ""} onChange={(e) => setF({ ...f, [k]: e.target.value })} className={`${inputCls} w-32`} /></Field>;
  const dt = (k, label) => <Field label={label}><input data-testid={`cc-aud-${k}`} type="date" value={f[k] || ""} onChange={(e) => setF({ ...f, [k]: e.target.value })} className={inputCls} /></Field>;
  return (
    <div className="space-y-3">
      <CustomerFilters f={{ gp: "", processor: "", loan_type: "", bank: "", dob: "", ...f }} setF={setF} opts={opts} compact />
      <div className="flex flex-wrap gap-2">{dt("approval_date_from", "Approval from")}{dt("approval_date_to", "Approval to")}{dt("disbursement_date_from", "Disbursement from")}{dt("disbursement_date_to", "Disbursement to")}
        {num("approved_min", "Approved ₹ min")}{num("approved_max", "Approved ₹ max")}{num("disbursed_min", "Disbursed ₹ min")}{num("disbursed_max", "Disbursed ₹ max")}</div>
      <label className="flex items-center gap-2 text-sm"><input data-testid="cc-aud-individual" type="checkbox" checked={pick} onChange={(e) => { setPick(e.target.checked); if (!e.target.checked) set({ ...v, customer_ids: null }); }} /> Select individual customers{ids.size ? ` (${ids.size} selected)` : ""}</label>
      {pick && <div className="border rounded-lg p-2 space-y-2"><input data-testid="cc-aud-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name…" className={`${inputCls} w-full`} />
        <div className="max-h-48 overflow-auto">{list.map((c) => <label key={c.customer_id} className="flex items-center gap-2 text-xs py-1"><input data-testid={`cc-aud-pick-${c.customer_id}`} type="checkbox" checked={ids.has(c.customer_id)} onChange={() => toggle(c.customer_id)} />{c.name} · {c.phone} · {c.consent?.status}</label>)}</div></div>}
      {count && <div className="rounded-lg border p-3 bg-slate-50" data-testid="cc-aud-counts">
        <p className="text-sm font-semibold" style={{ color: B.navy }}>Total Selected: <span data-testid="cc-aud-total">{count.total}</span> Customers · <span className="text-emerald-700">Eligible for WhatsApp: <span data-testid="cc-aud-eligible">{count.eligible}</span></span> · <span className="text-red-600">Excluded: <span data-testid="cc-aud-excluded">{count.excluded}</span></span></p>
        {Object.keys(count.reasons).length > 0 && <ul className="text-xs text-slate-600 mt-1 list-disc pl-5">{Object.entries(count.reasons).map(([r, n]) => <li key={r}>{n} — {r}</li>)}</ul>}
        <p className="text-[11px] text-slate-400 mt-1">Loan approval is not treated as marketing consent. Only customers with recorded opt-in and a valid number receive messages; one message per WhatsApp number.</p>
      </div>}
    </div>
  );
};

const TemplateStep = ({ v, set, templates }) => {
  const t = templates.find((x) => x.name === v.template && x.language === v.language);
  const vars = t ? [...(t.header_vars || []), ...(t.body_vars || [])] : [];
  const setVar = (k, spec) => set({ ...v, var_map: { ...v.var_map, [k]: spec } });
  return (
    <div className="space-y-3">
      <Field label="Meta-approved template">
        <select data-testid="cc-tpl-select" value={t ? `${t.name}|${t.language}` : ""} onChange={(e) => { const [n, l] = e.target.value.split("|"); set({ ...v, template: n, language: l, var_map: {}, media_ref: null }); }} className={inputCls}>
          <option value="">Choose…</option>
          {templates.map((x) => <option key={`${x.name}|${x.language}`} value={`${x.name}|${x.language}`} disabled={!x.sendable}>{x.name} · {x.category} · {x.language} · {x.status}{x.sendable ? "" : " (not sendable)"}</option>)}
        </select>
      </Field>
      {t && <>
        <TemplatePreview t={t} />
        {vars.map((k) => {
          const spec = v.var_map[k] || {};
          return (
            <div key={k} className="flex flex-wrap gap-2 items-end">
              <Field label={`Variable {{${k}}}`}><select data-testid={`cc-var-src-${k}`} value={spec.source || ""} onChange={(e) => setVar(k, { source: e.target.value })} className={inputCls}><option value="">Choose…</option><option value="customer_name">Customer name</option><option value="static">Fixed text</option></select></Field>
              {spec.source === "customer_name" && <label className="text-xs flex items-center gap-1"><input type="checkbox" checked={!!spec.first_name} onChange={(e) => setVar(k, { ...spec, first_name: e.target.checked })} /> First name only</label>}
              {spec.source === "static" && <input data-testid={`cc-var-val-${k}`} value={spec.value || ""} onChange={(e) => setVar(k, { ...spec, value: e.target.value })} className={inputCls} placeholder="Value" />}
            </div>);
        })}
        {(t.button_vars || []).map((b) => (
          <Field key={b.index} label={`Button "${b.text}" link value — ${b.url}`}><input data-testid={`cc-btn-val-${b.index}`} value={v.var_map[`button_${b.index}`]?.value || ""} onChange={(e) => setVar(`button_${b.index}`, { source: "static", value: e.target.value })} className={inputCls} /></Field>
        ))}
      </>}
    </div>
  );
};

export const MediaPicker = ({ kind, mediaRef, onChange, testid = "cc-media" }) => {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    if (!mediaRef || kind !== "IMAGE") return setUrl(null);
    let u; api.get(`/cc/media/${mediaRef}`, { responseType: "blob" }).then((r) => { u = URL.createObjectURL(r.data); setUrl(u); });
    return () => u && URL.revokeObjectURL(u);
  }, [mediaRef, kind]);
  const upload = async (file) => {
    const fd = new FormData(); fd.append("file", file);
    try { const { data } = await api.post("/cc/media", fd, { headers: { "Content-Type": "multipart/form-data" } }); if (data.kind !== kind) return toast.error(`This template needs a ${kind.toLowerCase()} header`); onChange(data.media_ref); toast.success("Uploaded"); }
    catch (e) { toast.error(errMsg(e)); }
  };
  const accept = { IMAGE: "image/jpeg,image/png", VIDEO: "video/mp4", DOCUMENT: "application/pdf" }[kind];
  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-500">{kind === "IMAGE" ? "JPG or PNG, up to 5 MB" : kind === "VIDEO" ? "MP4, up to 16 MB" : "PDF, up to 100 MB"} — used as the template's approved {kind.toLowerCase()} header.</p>
      <input data-testid={`${testid}-input`} type="file" accept={accept} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} className="text-sm" />
      {url && <img data-testid={`${testid}-preview`} src={url} alt="header" className="max-h-48 rounded-lg border" />}
      {mediaRef && kind !== "IMAGE" && <p className="text-xs text-emerald-700">File uploaded.</p>}
    </div>
  );
};

const Confirm = ({ cid, me, onDone }) => {
  const [p, setP] = useState(null);
  const [img, setImg] = useState(null);
  const [ok, setOk] = useState(false);
  useEffect(() => { api.post(`/cc/campaigns/${cid}/preview`).then(({ data }) => setP(data)).catch((e) => toast.error(errMsg(e))); }, [cid]);
  useEffect(() => {
    if (p?.campaign?.media_ref && p.template?.header_type === "IMAGE") api.get(`/cc/media/${p.campaign.media_ref}`, { responseType: "blob" }).then((r) => setImg(URL.createObjectURL(r.data)));
  }, [p]);
  if (!p) return <p className="text-sm text-slate-500">Validating…</p>;
  const test = async () => { try { const { data } = await api.post(`/cc/campaigns/${cid}/test`); toast.success(`Test ${data.mode === "mock" ? "simulated (mock mode)" : "sent"} to ${data.to}: ${data.result}`); } catch (e) { toast.error(errMsg(e)); } };
  const confirm = async () => { try { const { data } = await api.post(`/cc/campaigns/${cid}/confirm`, { confirm: true }); toast.success(`Campaign ${data.status} — ${data.recipients} recipients`); onDone(); } catch (e) { toast.error(errMsg(e)); } };
  const c = p.campaign;
  return (
    <div className="space-y-3 text-sm" data-testid="cc-confirm">
      {!p.live_sending && <p className="rounded-md bg-violet-50 border border-violet-200 text-violet-800 text-xs px-3 py-2" data-testid="cc-mock-banner">MOCK MODE — live sending is OFF. Messages are recorded as "Mock (not sent)" and nothing reaches WhatsApp.</p>}
      <div className="grid grid-cols-2 gap-x-6 gap-y-1">
        <span>Campaign: <b>{c.name}</b></span><span>Type: <b>{c.type}</b></span>
        <span>Template: <b>{p.template.name}</b> ({p.template.category})</span><span>Send: <b data-testid="cc-confirm-when">{p.send_time}</b></span>
        <span>Eligible recipients: <b className="text-emerald-700" data-testid="cc-confirm-eligible">{p.eligible}</b></span><span>Excluded: <b className="text-red-600">{p.excluded}</b></span>
        {p.estimated_cost !== null && <span>Estimated cost: <b>₹{p.estimated_cost}</b></span>}
      </div>
      <div className="rounded-lg border bg-[#e7ffdb] p-3 max-w-sm">
        {img && <img src={img} alt="" className="rounded mb-2" />}
        <p className="whitespace-pre-wrap text-[13px]" data-testid="cc-confirm-preview">{p.message_preview}</p>
        {p.template.footer && <p className="text-[11px] text-slate-500 mt-1">{p.template.footer}</p>}
        {(p.template.buttons || []).map((b, i) => <p key={i} className="mt-1 pt-1 border-t border-emerald-200 text-center text-[12px] font-semibold text-sky-700">{b.text}</p>)}
      </div>
      <label className="flex items-center gap-2"><input data-testid="cc-confirm-check" type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} /> I confirm this campaign{p.live_sending ? " will send REAL WhatsApp messages" : ""}.</label>
      <div className="flex gap-2">
        <button type="button" data-testid="cc-send-test" onClick={test} disabled={!me.test_number_set} title={me.test_number_set ? "" : "An admin must set a test number in Settings"} className={btn("ghost")}>Send Test to Admin</button>
        <button type="button" data-testid="cc-confirm-btn" onClick={confirm} disabled={!ok || (p.live_sending && !me.is_admin)} className={btn("green")}>Confirm Campaign</button>
      </div>
    </div>
  );
};

export const CampaignWizard = ({ open, onClose, me, initial }) => {
  const [step, setStep] = useState(0);
  const [v, setV] = useState(BLANK);
  const [cid, setCid] = useState(null);
  const [templates, setTemplates] = useState([]);
  useEffect(() => { if (open) { setStep(0); setV(initial ? { ...BLANK, ...initial } : BLANK); setCid(initial?.campaign_id || null); api.get("/cc/templates").then(({ data }) => setTemplates(data)); } }, [open, initial]);
  const tpl = templates.find((x) => x.name === v.template && x.language === v.language);
  const needsMedia = tpl && ["IMAGE", "VIDEO", "DOCUMENT"].includes(tpl.header_type);
  const save = async (mode) => {
    const body = { ...v, schedule_mode: mode || v.schedule_mode };
    const { data } = cid ? await api.put(`/cc/campaigns/${cid}`, body) : await api.post("/cc/campaigns", body);
    setCid(data.campaign_id); return data;
  };
  const next = async () => {
    if (step === 0 && (!v.name.trim() || !v.type)) return toast.error("Enter the campaign name and type");
    if (step === 2 && !tpl) return toast.error("Choose an approved template");
    if (step === 4) { try { await save(); } catch (e) { return toast.error(errMsg(e)); } }
    setStep(step === 2 && !needsMedia ? 4 : step + 1);
  };
  const draft = async () => { try { await save("draft"); toast.success("Draft saved"); onClose(true); } catch (e) { toast.error(errMsg(e)); } };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose(false)}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto" data-testid="cc-wizard">
        <DialogHeader><DialogTitle style={{ color: B.navy }}>{initial?.campaign_id ? "Edit campaign" : "Create campaign"}</DialogTitle></DialogHeader>
        <div className="flex flex-wrap gap-1 mb-2">{STEPS.map((s, i) => {
          const skipped = i === 3 && !needsMedia && step > 2;
          return <span key={s} className={`text-[11px] px-2 py-1 rounded-full ${i === step ? "bg-[#081B3A] text-white" : skipped ? "bg-slate-50 text-slate-400 line-through" : i < step ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-500"}`}>{i + 1}. {s}{skipped ? " (not needed)" : ""}</span>;
        })}</div>
        {step === 0 && <div className="grid md:grid-cols-2 gap-3">
          <Field label="Campaign name"><input data-testid="cc-w-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} className={inputCls} /></Field>
          <Field label="Campaign type"><select data-testid="cc-w-type" value={v.type} onChange={(e) => setV({ ...v, type: e.target.value })} className={inputCls}><option value="">Choose…</option>{me.campaign_types.map((t) => <option key={t}>{t}</option>)}</select></Field>
          <Field label="Description (optional)"><textarea data-testid="cc-w-desc" value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} className={`${inputCls} md:col-span-2`} rows={2} /></Field>
        </div>}
        {step === 1 && <Audience v={v} set={setV} />}
        {step === 2 && <TemplateStep v={v} set={setV} templates={templates} />}
        {step === 3 && needsMedia && <MediaPicker kind={tpl.header_type} mediaRef={v.media_ref} onChange={(r) => setV({ ...v, media_ref: r })} />}
        {step === 4 && <div className="space-y-3">
          <div className="flex gap-4 text-sm">{[["now", "Send Now"], ["later", "Schedule for Later"]].map(([k, l]) => <label key={k} className="flex items-center gap-1.5"><input data-testid={`cc-w-sched-${k}`} type="radio" checked={v.schedule_mode === k} onChange={() => setV({ ...v, schedule_mode: k })} />{l}</label>)}</div>
          {v.schedule_mode === "later" && <div className="flex gap-2 items-end"><Field label="Date & time"><input data-testid="cc-w-sched-at" type="datetime-local" value={v.schedule_at} onChange={(e) => setV({ ...v, schedule_at: e.target.value })} className={inputCls} /></Field>
            <Field label="Timezone"><select value={v.timezone} disabled className={inputCls}><option>Asia/Kolkata</option></select></Field></div>}
          {v.schedule_mode === "later" && v.schedule_at && <p className="text-xs" style={{ color: B.blue }}>Will send on {new Date(v.schedule_at).toLocaleString("en-IN", { dateStyle: "full", timeStyle: "short" })} IST</p>}
        </div>}
        {step === 5 && cid && <Confirm cid={cid} me={me} onDone={() => onClose(true)} />}
        <div className="flex justify-between pt-3 border-t mt-3">
          <button type="button" data-testid="cc-w-back" disabled={step === 0} onClick={() => setStep(step === 4 && !needsMedia ? 2 : step - 1)} className={btn("ghost")}>Back</button>
          <div className="flex gap-2">
            {step < 5 && <button type="button" data-testid="cc-w-draft" onClick={draft} disabled={!v.name || !v.type} className={btn("ghost")}>Save Draft</button>}
            {step < 5 && <button type="button" data-testid="cc-w-next" onClick={next} className={btn("primary")}>{step === 4 ? "Preview" : "Next"}</button>}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
