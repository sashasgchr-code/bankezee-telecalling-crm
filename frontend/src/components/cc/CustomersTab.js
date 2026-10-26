import React, { useCallback, useEffect, useState } from "react";
import api from "../../services/api";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Download, Upload, RefreshCw, Eye, Send } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { B, inr, fmtDate, fmtDob, fmtDT, ConsentBadge, Kpi, Field, inputCls, btn, errMsg, download } from "./ccShared";
import { CustomerDialog, LoanTable } from "./CustomerDialog";

const EMPTY = { status: "both", date_from: "", date_to: "", gp: "", processor: "", loan_type: "", bank: "", name: "", mobile: "", dob: "", consent: "" };

export const CustomerFilters = ({ f, setF, opts, compact }) => (
  <div className="flex flex-wrap gap-2 items-end" data-testid="cc-filters">
    <Field label="Loans"><select data-testid="cc-f-status" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} className={inputCls}>
      <option value="both">Approved & Disbursed</option><option value="approved">Approved only (not disbursed)</option><option value="disbursed">Disbursed only</option></select></Field>
    {!compact && <><Field label="Date from"><input data-testid="cc-f-from" type="date" value={f.date_from} onChange={(e) => setF({ ...f, date_from: e.target.value })} className={inputCls} /></Field>
      <Field label="Date to"><input data-testid="cc-f-to" type="date" value={f.date_to} onChange={(e) => setF({ ...f, date_to: e.target.value })} className={inputCls} /></Field></>}
    <Field label="Growth Partner"><select data-testid="cc-f-gp" value={f.gp} onChange={(e) => setF({ ...f, gp: e.target.value })} className={inputCls}><option value="">All</option>{opts.gps.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></Field>
    <Field label="Processor"><select data-testid="cc-f-proc" value={f.processor} onChange={(e) => setF({ ...f, processor: e.target.value })} className={inputCls}><option value="">All</option>{opts.processors.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></Field>
    <Field label="Loan type"><select data-testid="cc-f-loan" value={f.loan_type} onChange={(e) => setF({ ...f, loan_type: e.target.value })} className={inputCls}><option value="">All</option>{opts.loan_types.map((g) => <option key={g} value={g}>{g}</option>)}</select></Field>
    <Field label="Bank/NBFC"><select data-testid="cc-f-bank" value={f.bank} onChange={(e) => setF({ ...f, bank: e.target.value })} className={inputCls}><option value="">All</option>{opts.banks.map((g) => <option key={g} value={g}>{g}</option>)}</select></Field>
    <Field label="DOB"><select data-testid="cc-f-dob" value={f.dob} onChange={(e) => setF({ ...f, dob: e.target.value })} className={inputCls}><option value="">Any</option><option value="has">DOB available</option><option value="missing">DOB missing</option></select></Field>
    {!compact && <><Field label="Consent"><select data-testid="cc-f-consent" value={f.consent} onChange={(e) => setF({ ...f, consent: e.target.value })} className={inputCls}><option value="">Any</option><option value="opted_in">Opted In</option><option value="unknown">Unknown</option><option value="opted_out">Opted Out</option></select></Field>
      <Field label="Customer name"><input data-testid="cc-f-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className={`${inputCls} w-40`} /></Field>
      <Field label="Mobile"><input data-testid="cc-f-mobile" value={f.mobile} onChange={(e) => setF({ ...f, mobile: e.target.value })} className={`${inputCls} w-32`} /></Field></>}
  </div>
);

export const useFilterOptions = () => {
  const [opts, setOpts] = useState({ gps: [], processors: [], loan_types: [], banks: [] });
  useEffect(() => { api.get("/cc/filter-options").then(({ data }) => setOpts(data)).catch(() => {}); }, []);
  return opts;
};

const ImportDialog = ({ open, onClose, onDone }) => {
  const [kind, setKind] = useState("dob");
  const [prev, setPrev] = useState(null);
  const [file, setFile] = useState(null);
  const preview = async () => {
    if (!file) return toast.error("Choose a CSV file");
    const fd = new FormData(); fd.append("kind", kind); fd.append("file", file);
    try { const { data } = await api.post("/cc/import/preview", fd, { headers: { "Content-Type": "multipart/form-data" } }); setPrev(data); } catch (e) { toast.error(errMsg(e)); }
  };
  const commit = async () => {
    try { const { data } = await api.post("/cc/import/commit", { kind, rows: prev.rows }); toast.success(`${data.updated} customers updated`); setPrev(null); onDone(); onClose(); }
    catch (e) { toast.error(errMsg(e)); }
  };
  const toggle = (i) => setPrev({ ...prev, rows: prev.rows.map((r, j) => (j === i ? { ...r, overwrite: !r.overwrite } : r)) });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto" data-testid="cc-import-dialog">
        <DialogHeader><DialogTitle>Bulk import from CSV</DialogTitle></DialogHeader>
        <p className="text-xs text-slate-500">DOB columns: <code>customer_id</code> or <code>file_id</code>, <code>dob</code> (DD-MM-YYYY or DD-MM). Consent columns: <code>customer_id</code>/<code>file_id</code>, <code>consent</code> (opted_in / opted_out / unknown), <code>consent_date</code>, <code>consent_source</code>, <code>consent_reference</code>.</p>
        <div className="flex flex-wrap gap-2 items-end">
          <Field label="Import"><select data-testid="cc-import-kind" value={kind} onChange={(e) => { setKind(e.target.value); setPrev(null); }} className={inputCls}><option value="dob">Dates of birth</option><option value="consent">Marketing consent</option></select></Field>
          <input data-testid="cc-import-file" type="file" accept=".csv" onChange={(e) => setFile(e.target.files?.[0])} className="text-sm" />
          <button type="button" data-testid="cc-import-preview" onClick={preview} className={btn("ghost")}>Preview</button>
        </div>
        {prev && <>
          <p className="text-xs font-semibold" data-testid="cc-import-summary">{Object.entries(prev.summary).map(([k, v]) => `${k}: ${v}`).join(" · ")}</p>
          <div className="max-h-72 overflow-auto border rounded"><table className="w-full text-xs"><thead className="bg-slate-50 sticky top-0"><tr>{["Row", "Customer", "Value", "Existing", "Result", "Overwrite"].map((h) => <th key={h} className="text-left px-2 py-1.5">{h}</th>)}</tr></thead>
            <tbody>{prev.rows.map((r, i) => (
              <tr key={i} className={`border-t ${["invalid", "not_found", "ambiguous"].includes(r.status) ? "bg-red-50" : r.status === "conflict" ? "bg-amber-50" : ""}`}>
                <td className="px-2 py-1">{r.row}</td><td className="px-2 py-1">{r.name || r.customer_id || r.file_id || "—"}</td>
                <td className="px-2 py-1">{kind === "dob" ? (r.dob ? fmtDob(r.dob) : r.raw || "—") : r.consent_status || "—"}</td><td className="px-2 py-1">{kind === "dob" ? fmtDob(r.existing) : r.existing}</td>
                <td className="px-2 py-1">{r.status}{r.message ? ` — ${r.message}` : ""}</td>
                <td className="px-2 py-1">{r.status === "conflict" && <input data-testid={`cc-import-overwrite-${i}`} type="checkbox" checked={!!r.overwrite} onChange={() => toggle(i)} />}</td>
              </tr>))}</tbody></table></div>
          <button type="button" data-testid="cc-import-commit" onClick={commit} className={btn("green")}>Import valid rows</button>
        </>}
      </DialogContent>
    </Dialog>
  );
};

export const CustomersTab = ({ me }) => {
  const opts = useFilterOptions();
  const [f, setF] = useState(EMPTY);
  const [applied, setApplied] = useState(EMPTY);
  const [sort, setSort] = useState({ sort: "latest", dir: "desc" });
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(25);
  const [data, setData] = useState(null);
  const [open, setOpen] = useState({});
  const [view, setView] = useState(null);
  const [imp, setImp] = useState(false);
  const params = useCallback(() => ({ ...Object.fromEntries(Object.entries(applied).filter(([, v]) => v)), ...sort, page, page_size: size }), [applied, sort, page, size]);
  const load = useCallback(() => api.get("/cc/customers", { params: params() }).then(({ data }) => setData(data)).catch((e) => toast.error(errMsg(e))), [params]);
  useEffect(() => { load(); }, [load]);
  const apply = () => { setApplied(f); setPage(1); };
  const sortBy = (k) => setSort((s) => ({ sort: k, dir: s.sort === k && s.dir === "desc" ? "asc" : "desc" }));
  const k = data?.kpis;
  const pages = data ? Math.max(1, Math.ceil(data.total / size)) : 1;
  const Th = ({ k: key, children }) => <th onClick={key ? () => sortBy(key) : undefined} className={`text-left px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap ${key ? "cursor-pointer hover:text-slate-800" : ""}`}>{children}{sort.sort === key ? (sort.dir === "desc" ? " ↓" : " ↑") : ""}</th>;
  return (
    <div className="space-y-4" data-testid="cc-customers-tab">
      {k && <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
        <Kpi testid="cc-kpi-customers" label="Unique Customers" value={k.customers} />
        <Kpi testid="cc-kpi-approved" label="Approved Loans" value={k.approved_loans} color={B.blue} sub="incl. disbursed" />
        <Kpi testid="cc-kpi-approved-amt" label="Approved Amount" value={inr(k.approved_amount)} color={B.blue} />
        <Kpi testid="cc-kpi-disbursed" label="Disbursed Loans" value={k.disbursed_loans} color={B.emerald} />
        <Kpi testid="cc-kpi-disbursed-amt" label="Disbursed Amount" value={inr(k.disbursed_amount)} color={B.emerald} />
        <Kpi testid="cc-kpi-with-dob" label="With DOB" value={k.with_dob} color={B.gold} />
        <Kpi testid="cc-kpi-without-dob" label="Without DOB" value={k.without_dob} color={B.red} />
        <Kpi testid="cc-kpi-eligible" label="WhatsApp Eligible" value={k.eligible} color={B.emerald} sub="valid number + opted in" />
      </div>}
      <div className="bg-white border border-slate-200 rounded-xl p-3 space-y-3">
        <CustomerFilters f={f} setF={setF} opts={opts} />
        <div className="flex flex-wrap gap-2 items-center">
          <button type="button" data-testid="cc-apply" onClick={apply} className={btn("primary")}>Apply</button>
          <button type="button" data-testid="cc-reset" onClick={() => { setF(EMPTY); setApplied(EMPTY); setPage(1); }} className={btn("ghost")}>Reset</button>
          <button type="button" data-testid="cc-export" onClick={() => download(api, "/cc/customers/export", Object.fromEntries(Object.entries(applied).filter(([, v]) => v)), "customers.csv")} className={btn("ghost")}><Download size={14} /> Export CSV</button>
          {me.can_edit && <button type="button" data-testid="cc-import" onClick={() => setImp(true)} className={btn("ghost")}><Upload size={14} /> Import CSV</button>}
          {me.can_edit && <button type="button" data-testid="cc-sync" onClick={() => api.post("/cc/sync").then(load).then(() => toast.success("Synced from files"))} className={btn("ghost")}><RefreshCw size={14} /> Sync now</button>}
          {data && <span className="ml-auto text-xs font-semibold" data-testid="cc-dob-completion" style={{ color: B.navy }}>DOB Completion: {data.dob_completion.with} / {data.dob_completion.total} Customers ({data.dob_completion.pct}%)</span>}
        </div>
        {data?.missing_by_processor?.length > 0 && (
          <div className="flex flex-wrap gap-1.5" data-testid="cc-missing-by-proc">
            <span className="text-[11px] text-slate-500 mr-1">Missing DOB by processor:</span>
            {data.missing_by_processor.map((p) => (
              <button key={p.processor_id || "none"} type="button" onClick={() => { const nf = { ...f, processor: p.processor_id, dob: "missing" }; setF(nf); setApplied(nf); setPage(1); }}
                className="text-[11px] px-2 py-0.5 rounded-full border border-red-200 bg-red-50 text-red-700 hover:bg-red-100">{p.processor}: {p.missing}/{p.customers}</button>))}
          </div>)}
      </div>
      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm" data-testid="cc-customer-table">
          <thead className="bg-slate-50 sticky top-0"><tr>
            <th className="w-8" /><Th k="name">Customer</Th><Th>Mobile</Th><Th k="dob">DOB</Th><Th>Loan Type</Th><Th>Bank/NBFC</Th><Th>Status</Th>
            <Th>Approval</Th><Th k="approved_amount">Approved</Th><Th k="latest">Disbursement</Th><Th k="disbursed_amount">Disbursed</Th><Th>GP</Th><Th>Processor</Th>
            <Th k="last_whatsapp">Last WhatsApp</Th><Th>Consent</Th><Th>Actions</Th></tr></thead>
          <tbody>
            {data?.items?.length === 0 && <tr><td colSpan={16} className="text-center py-8 text-slate-400">No customers match these filters.</td></tr>}
            {data?.items?.map((c) => {
              const ls = c.loans || [];
              const one = ls.length === 1 ? ls[0] : null;
              const multi = (fn) => (one ? fn(one) : `${ls.length} loans`);
              return (
                <React.Fragment key={c.customer_id}>
                  <tr className="border-t border-slate-100 hover:bg-slate-50/60" data-testid={`cc-row-${c.customer_id}`}>
                    <td className="px-2">{ls.length > 1 && <button type="button" data-testid={`cc-expand-${c.customer_id}`} onClick={() => setOpen({ ...open, [c.customer_id]: !open[c.customer_id] })} className="p-1 text-slate-500">{open[c.customer_id] ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button>}</td>
                    <td className="px-3 py-2 font-semibold text-slate-800 whitespace-nowrap">{c.name}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{c.phone}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{fmtDob(c.dob)}</td>
                    <td className="px-3 py-2">{multi((l) => l.loan_type || "—")}</td><td className="px-3 py-2">{multi((l) => l.bank || "—")}</td>
                    <td className="px-3 py-2">{multi((l) => l.status)}</td><td className="px-3 py-2 whitespace-nowrap">{multi((l) => fmtDate(l.approval_date))}</td>
                    <td className="px-3 py-2 tabular-nums whitespace-nowrap">{multi((l) => inr(l.approved_amount))}</td><td className="px-3 py-2 whitespace-nowrap">{multi((l) => fmtDate(l.disbursement_date))}</td>
                    <td className="px-3 py-2 tabular-nums whitespace-nowrap">{multi((l) => inr(l.disbursed_amount))}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{[...new Set(ls.map((l) => l.gp_name).filter(Boolean))].join(", ") || "—"}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{[...new Set(ls.map((l) => l.processor_name).filter(Boolean))].join(", ") || "—"}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-xs">{c.last_whatsapp_at ? `${fmtDT(c.last_whatsapp_at)}${c.last_whatsapp_mock ? " (mock)" : ""}` : "—"}</td>
                    <td className="px-3 py-2"><ConsentBadge status={c.consent?.status} /></td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <button type="button" data-testid={`cc-view-${c.customer_id}`} onClick={() => setView(c.customer_id)} className="inline-flex items-center gap-1 text-xs font-semibold mr-2" style={{ color: B.blue }}><Eye size={13} /> {me.can_edit ? "View / Edit" : "View"}</button>
                      {me.can_campaign && <span title="Create a campaign and pick this customer under Individual selection" className="inline-flex items-center gap-1 text-[11px] text-slate-400"><Send size={12} /> via campaign</span>}
                    </td>
                  </tr>
                  {open[c.customer_id] && <tr className="bg-slate-50/70"><td /><td colSpan={15} className="px-3 py-2"><LoanTable loans={ls} /></td></tr>}
                </React.Fragment>);
            })}
          </tbody>
        </table>
        {data && (
          <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-t text-xs text-slate-600" data-testid="cc-pagination">
            <span>Showing {data.total ? (page - 1) * size + 1 : 0}–{Math.min(page * size, data.total)} of {data.total}</span>
            <select data-testid="cc-page-size" value={size} onChange={(e) => { setSize(+e.target.value); setPage(1); }} className="border rounded px-1 py-0.5">{[25, 50, 100, 200].map((n) => <option key={n} value={n}>{n} / page</option>)}</select>
            <div className="ml-auto flex gap-1">
              <button type="button" data-testid="cc-prev" disabled={page <= 1} onClick={() => setPage(page - 1)} className={btn("ghost")}>Previous</button>
              <span className="px-2 py-1.5">Page {page} / {pages}</span>
              <button type="button" data-testid="cc-next" disabled={page >= pages} onClick={() => setPage(page + 1)} className={btn("ghost")}>Next</button>
            </div>
          </div>)}
      </div>
      {data?.last_sync && <p className="text-[11px] text-slate-400">Synced from Connect & Meta files {fmtDT(data.last_sync)} (auto every 15 min and when this page opens).</p>}
      <CustomerDialog id={view} me={me} onClose={() => setView(null)} onChanged={load} />
      <ImportDialog open={imp} onClose={() => setImp(false)} onDone={load} />
    </div>
  );
};
