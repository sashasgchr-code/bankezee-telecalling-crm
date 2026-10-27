import React, { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import api from "../../services/api";
import { Search, MessagesSquare, ChevronLeft, ChevronRight } from "lucide-react";
import { ChatThread } from "../../components/inbox/ChatThread";
import { CustomerPanel } from "../../components/inbox/CustomerPanel";
import { FILTERS, CONV_STATUS, SOURCE_LABEL, fmtIST } from "../../components/inbox/inboxUtils";
import { useMetaUser, LEAD_STATUSES, PROC_STATUSES } from "./metaCommon";

const sel = "border border-slate-200 rounded-md px-2 py-1 text-xs bg-white";

const Filters = ({ f, setF, procs, partners, templates }) => (
  <div className="grid grid-cols-2 gap-1.5 p-3 border-b" data-testid="inbox-adv-filters">
    <select data-testid="inbox-filter-processor" className={sel} value={f.processor} onChange={(e) => setF({ ...f, processor: e.target.value })}><option value="">Any processor</option><option value="UNASSIGNED">Unassigned</option>{procs.map((p) => <option key={p.user_id} value={p.user_id}>{p.name}</option>)}</select>
    <select data-testid="inbox-filter-gp" className={sel} value={f.gp} onChange={(e) => setF({ ...f, gp: e.target.value })}><option value="">Any GP</option>{partners.map((p) => <option key={p.user_id} value={p.user_id}>{p.name}</option>)}</select>
    <select data-testid="inbox-filter-lead-status" className={sel} value={f.lead_status} onChange={(e) => setF({ ...f, lead_status: e.target.value })}><option value="">Any lead/file status</option>{[...LEAD_STATUSES, ...PROC_STATUSES].map((s) => <option key={s} value={s}>{s}</option>)}</select>
    <select data-testid="inbox-filter-source" className={sel} value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })}><option value="">Any source</option>{Object.entries(SOURCE_LABEL).filter(([k]) => k !== "note").map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
    <select data-testid="inbox-filter-template" className={sel} value={f.template} onChange={(e) => setF({ ...f, template: e.target.value })}><option value="">Any template</option>{templates.map((t) => <option key={t} value={t}>{t}</option>)}</select>
    <div className="flex gap-1"><input type="date" data-testid="inbox-filter-from" className={`${sel} w-full`} value={f.date_from} onChange={(e) => setF({ ...f, date_from: e.target.value })} /><input type="date" data-testid="inbox-filter-to" className={`${sel} w-full`} value={f.date_to} onChange={(e) => setF({ ...f, date_to: e.target.value })} /></div>
  </div>
);

const ConvItem = ({ c, active, onClick }) => (
  <button data-testid={`inbox-conv-${c.id}`} onClick={onClick} className={`w-full text-left px-3 py-2.5 border-b border-slate-100 hover:bg-slate-50 ${active ? "bg-sky-50" : ""}`}>
    <div className="flex items-center gap-2">
      <p className="text-sm font-semibold text-slate-800 truncate flex-1">{c.customer_name || c.profile_name || `+${c.wa_number}`}{!c.lead_id && <span className="ml-1 text-[10px] text-amber-600">(unmatched)</span>}</p>
      <span className="text-[10px] text-slate-400 shrink-0">{fmtIST(c.last_message_at)}</span>
    </div>
    <p className="text-[11px] text-slate-400">+{c.wa_number} · {c.assigned_processor_name || "Unassigned"} · {CONV_STATUS[c.status]}</p>
    <div className="flex items-center gap-2 mt-0.5">
      <p className="text-xs text-slate-600 truncate flex-1">{c.last_direction === "in" ? "↙ " : "↗ "}<span className="text-slate-400">{SOURCE_LABEL[c.last_source] || ""}:</span> {c.last_preview}</p>
      {c.unread_count > 0 && <span data-testid={`inbox-unread-${c.id}`} className="min-w-[18px] h-[18px] px-1 rounded-full bg-emerald-600 text-white text-[10px] leading-[18px] text-center">{c.unread_count}</span>}
    </div>
  </button>
);

export default function Inbox() {
  const meta = useMetaUser();
  const [params, setParams] = useSearchParams();
  const active = params.get("c");
  const [tab, setTab] = useState("all");
  const [q, setQ] = useState("");
  const [f, setF] = useState({ processor: "", gp: "", lead_status: "", source: "", template: "", date_from: "", date_to: "" });
  const [page, setPage] = useState(1);
  const [list, setList] = useState({ items: [], total: 0 });
  const [detail, setDetail] = useState(null);
  const [procs, setProcs] = useState([]);
  const [partners, setPartners] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [tick, setTick] = useState(0);

  const load = useCallback(() => api.get("/inbox/conversations", { params: { filter: tab, q, page, limit: 25, ...f } }).then(({ data }) => setList(data)).catch(() => {}), [tab, q, page, f]);
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]);
  useEffect(() => { setPage(1); }, [tab, q, f]);
  useEffect(() => {
    api.get("/meta/processors").then(({ data }) => setProcs(data)).catch(() => {});
    if (meta.isStaff) api.get("/meta/partners").then(({ data }) => setPartners(data)).catch(() => {});
    api.get("/inbox/templates").then(({ data }) => setTemplates([...new Set(data.map((t) => t.name))])).catch(() => {});
  }, [meta.isStaff]);
  const onData = useCallback((d) => setDetail(d), []);
  const pages = Math.max(1, Math.ceil(list.total / 25));

  if (!["admin", "ops", "processor"].includes(meta.role)) return <p className="p-8 text-slate-500" data-testid="inbox-no-access">WhatsApp Inbox is available to Admin, Operations and Processors.</p>;

  return (
    <div className="h-[calc(100vh-56px)] md:h-screen flex bg-slate-50" data-testid="whatsapp-inbox-page">
      <section className={`w-full md:w-96 shrink-0 border-r bg-white flex flex-col ${active ? "hidden md:flex" : "flex"}`}>
        <div className="p-3 border-b space-y-2">
          <h1 className="flex items-center gap-2 text-lg font-bold text-slate-800"><MessagesSquare size={20} /> WhatsApp Inbox</h1>
          <div className="relative"><Search size={14} className="absolute left-2.5 top-2.5 text-slate-400" /><input data-testid="inbox-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or mobile" className="w-full border rounded-md pl-8 pr-2 py-1.5 text-sm" /></div>
          <div className="flex flex-wrap gap-1">{FILTERS.map(([k, l]) => <button key={k} data-testid={`inbox-tab-${k}`} onClick={() => setTab(k)} className={`px-2 py-0.5 rounded-full text-[11px] border ${tab === k ? "bg-slate-800 text-white border-slate-800" : "border-slate-200 text-slate-600"}`}>{l}</button>)}</div>
        </div>
        <Filters f={f} setF={setF} procs={procs} partners={partners} templates={templates} />
        <div className="flex-1 overflow-y-auto" data-testid="inbox-conv-list">
          {list.items.length === 0 && <p className="p-6 text-center text-sm text-slate-400" data-testid="inbox-empty">No conversations</p>}
          {list.items.map((c) => <ConvItem key={c.id} c={c} active={c.id === active} onClick={() => setParams({ c: c.id })} />)}
        </div>
        <div className="flex items-center justify-between border-t px-3 py-2 text-xs text-slate-500">
          <span data-testid="inbox-total">{list.total} conversations</span>
          <div className="flex items-center gap-1"><button data-testid="inbox-prev" disabled={page <= 1} onClick={() => setPage(page - 1)} className="disabled:opacity-30"><ChevronLeft size={16} /></button>{page}/{pages}<button data-testid="inbox-next" disabled={page >= pages} onClick={() => setPage(page + 1)} className="disabled:opacity-30"><ChevronRight size={16} /></button></div>
        </div>
      </section>
      {active ? (
        <section className="flex-1 flex min-w-0">
          <div className="flex-1 flex flex-col min-w-0">
            <button className="md:hidden text-xs text-sky-700 px-4 py-2 text-left" onClick={() => setParams({})} data-testid="inbox-back">← Conversations</button>
            <ChatThread key={`${active}-${tick}`} convId={active} onData={onData} onChanged={load} />
          </div>
          <CustomerPanel data={detail} onLinked={() => { load(); setTick(tick + 1); }} />
        </section>
      ) : <div className="flex-1 hidden md:flex items-center justify-center text-slate-400 text-sm">Select a conversation</div>}
    </div>
  );
}
