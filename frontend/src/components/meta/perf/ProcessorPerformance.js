import React, { useCallback, useEffect, useState } from "react";
import api from "../../../services/api";
import { Loader2, ChevronDown, ChevronRight, Info, Download } from "lucide-react";
import { RecordsDialog } from "./RecordsDialog";
import { inr, pct, num, Sel, useFilterOptions, downloadCsv } from "./perfUtils";

const TAT_STATUSES = ["On Track", "Due Soon", "TAT Exceeded", "Follow-up Overdue", "No Recent Activity", "Missing Information", "Awaiting Customer", "Awaiting Bank", "Processor Action Required"];
const RESP = ["Processor action", "Customer delay", "Bank delay", "Customer eligibility / bank decision"];
const EXC_TONE = { tat_exceeded: "red", followup_overdue: "red", no_activity: "amber", due_soon: "amber", no_followup: "amber", no_reason: "amber", missing_info: "amber", awaiting_customer: "slate", awaiting_bank: "slate", processor_action: "slate", rework: "slate" };
const TONE = { red: "bg-red-50 text-red-700 border-red-200", amber: "bg-amber-50 text-amber-800 border-amber-200", slate: "bg-slate-50 text-slate-700 border-slate-200", green: "bg-emerald-50 text-emerald-700 border-emerald-200" };
const FILE_COLS = [["customer", "Customer"], ["lead_id", "File ref"], ["stage", "Stage"], ["processor", "Processor"], ["assigned_at", "Assigned"], ["last_activity", "Last meaningful activity"], ["next_followup", "Next follow-up"], ["tat_deadline", "TAT deadline"], ["elapsed_tat_days", "Elapsed TAT (days)"], ["overdue_days", "Overdue (days)"], ["days_under_current_processor", "Days with current processor"], ["status_label", "Status"], ["delay_reason", "Delay reason"], ["missing", "Missing info"], ["next_action", "Next action"]];

const Count = ({ v, tone, onClick, testid }) => (
  <button data-testid={testid} disabled={!v} onClick={onClick} className={`min-w-[28px] px-1.5 py-0.5 rounded border text-xs font-semibold ${v ? TONE[tone] + " hover:underline" : "border-transparent text-slate-300"}`}>{v || 0}</button>
);

// "Processor Performance & Pending Action" — identical shared backend calculation on Dashboard and Reports.
export const ProcessorPerformance = ({ role }) => {
  const [f, setF] = useState({ date_from: "", date_to: "", processor: "", loan_type: "", stage: "", tat_status: "", responsibility: "", inactive_days: 2 });
  const [d, setD] = useState(null);
  const [opts, setOpts] = useState({ processors: [], loanTypes: [] });
  const [stagesOpen, setStagesOpen] = useState(false);
  const [defsOpen, setDefsOpen] = useState(false);
  const [drill, setDrill] = useState(null);
  const loadOpts = useFilterOptions();
  const load = useCallback(() => { setD(null); api.get("/meta/processor-perf", { params: f }).then(({ data }) => setD(data)).catch(() => setD({ rows: [], error: true })); }, [f]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadOpts().then(setOpts); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!["admin", "ops", "processor"].includes(role)) return null;
  const set = (k) => (v) => setF({ ...f, [k]: v });
  const open = (row, exc, label) => setDrill({ title: `${label} — ${row ? row.processor_name : "All processors"}`, params: { ...f, exception: exc, processor: row ? row.processor_id : f.processor } });
  const stages = d?.rows ? [...new Set(d.rows.flatMap((r) => Object.keys(r.stages)))].sort((a, b) => (d.stage_order || []).indexOf(a) - (d.stage_order || []).indexOf(b)) : [];
  const excKeys = d?.exception_labels ? Object.keys(d.exception_labels) : [];

  return (
    <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 space-y-3" data-testid="processor-performance">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base md:text-lg font-bold text-slate-800 mr-auto">Processor Performance &amp; Pending Action</h2>
        <span className="text-[11px] text-slate-500" data-testid="pp-as-of">Workload = snapshot as of {d?.as_of ? new Date(d.as_of).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : "…"} IST · outcomes = selected period</span>
        <button data-testid="pp-export-btn" onClick={() => downloadCsv("/meta/processor-perf/files", f, "processor_files.csv")} className="inline-flex items-center gap-1 text-xs border rounded-md px-2 py-1"><Download size={12} />Files CSV</button>
      </div>
      <div className="flex flex-wrap gap-1.5 items-center" data-testid="pp-filters">
        <input type="date" data-testid="pp-from" value={f.date_from} onChange={(e) => set("date_from")(e.target.value)} className="border rounded-md px-2 py-1 text-xs" />
        <input type="date" data-testid="pp-to" value={f.date_to} onChange={(e) => set("date_to")(e.target.value)} className="border rounded-md px-2 py-1 text-xs" />
        {role !== "processor" && <Sel testid="pp-processor" value={f.processor} onChange={set("processor")}><option value="">All processors</option><option value="UNASSIGNED">Unassigned</option>{opts.processors.map((p) => <option key={p.user_id} value={p.user_id}>{p.name}</option>)}</Sel>}
        <Sel testid="pp-loan-type" value={f.loan_type} onChange={set("loan_type")}><option value="">All loan types</option>{opts.loanTypes.map((l) => <option key={l} value={l}>{l}</option>)}</Sel>
        <Sel testid="pp-stage" value={f.stage} onChange={set("stage")}><option value="">All stages</option>{(d?.stage_order || []).map((s) => <option key={s} value={s}>{s}</option>)}</Sel>
        <Sel testid="pp-tat-status" value={f.tat_status} onChange={set("tat_status")}><option value="">Any TAT status</option>{TAT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</Sel>
        <Sel testid="pp-resp" value={f.responsibility} onChange={set("responsibility")}><option value="">Any delay responsibility</option>{RESP.map((s) => <option key={s} value={s}>{s}</option>)}</Sel>
        <label className="text-xs text-slate-500 flex items-center gap-1">Inactive after <input type="number" min={1} max={30} data-testid="pp-inactive-days" value={f.inactive_days} onChange={(e) => set("inactive_days")(e.target.value || 2)} className="w-12 border rounded px-1 py-0.5" /> days</label>
        <button data-testid="pp-stages-toggle" onClick={() => setStagesOpen(!stagesOpen)} className="text-xs text-sky-700 inline-flex items-center gap-0.5">{stagesOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}Stage columns</button>
        <button data-testid="pp-defs-toggle" onClick={() => setDefsOpen(!defsOpen)} className="text-xs text-sky-700 inline-flex items-center gap-0.5"><Info size={12} />Definitions</button>
      </div>
      {defsOpen && d && (
        <div className="text-[11px] text-slate-600 bg-slate-50 border rounded-md p-3 space-y-1" data-testid="pp-definitions">
          <p><b>TAT:</b> {d.tat_definition}</p>
          {Object.entries(d.definitions || {}).map(([k, v]) => <p key={k}><b>{k}:</b> {v}</p>)}
        </div>
      )}
      {!d ? <div className="py-8 flex justify-center"><Loader2 className="animate-spin text-slate-400" /></div> : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs" data-testid="pp-table">
            <thead><tr className="text-left text-slate-500 border-b">
              {["Processor", "Opening", "Assigned", "Active now", "Handled"].map((h) => <th key={h} className="px-2 py-2 whitespace-nowrap">{h}</th>)}
              {stagesOpen && stages.map((s) => <th key={s} className="px-2 py-2 whitespace-nowrap bg-slate-50">{s}</th>)}
              {["Login", "Approved", "Approved ₹", "Disbursed", "Disbursed ₹", "Declined", "Approval %", "Disbursal %", "TAT avg / median (days)", "Pending age median / max"].map((h) => <th key={h} className="px-2 py-2 whitespace-nowrap">{h}</th>)}
              {excKeys.map((k) => <th key={k} className="px-1 py-2 whitespace-nowrap" title={d.exception_labels[k]}>{d.exception_labels[k].split(" (")[0]}</th>)}
            </tr></thead>
            <tbody>
              {d.rows.map((r) => (
                <tr key={r.processor_id} className={`border-b ${r.highlight ? "bg-red-50/40" : ""}`} data-testid={`pp-row-${r.processor_id}`}>
                  <td className="px-2 py-2 font-semibold whitespace-nowrap">{r.processor_name}{r.highlight && <span className="ml-1 text-[10px] text-red-600">high overdue ({pct(r.overdue_pct)})</span>}</td>
                  <td className="px-2">{num(r.opening_active)}</td><td className="px-2">{r.assigned_in_period}</td><td className="px-2 font-semibold">{r.current_active}</td><td className="px-2">{r.handled}</td>
                  {stagesOpen && stages.map((s) => <td key={s} className="px-2 bg-slate-50/60">{r.stages[s] || 0}</td>)}
                  <td className="px-2">{r.sent_for_login}</td><td className="px-2">{r.approved}</td><td className="px-2">{inr(r.approved_amount)}</td><td className="px-2">{r.disbursed}</td><td className="px-2">{inr(r.disbursed_amount)}</td><td className="px-2">{r.declined}</td>
                  <td className="px-2">{pct(r.approval_rate)}</td><td className="px-2">{pct(r.disbursal_rate)}</td>
                  <td className="px-2 whitespace-nowrap">{r.completed_with_tat ? `${num(r.avg_tat_days)} / ${num(r.median_tat_days)}` : "Unavailable"}</td>
                  <td className="px-2 whitespace-nowrap">{num(r.median_pending_age_days)} / {num(r.max_pending_age_days)}</td>
                  {excKeys.map((k) => <td key={k} className="px-1"><Count testid={`pp-exc-${r.processor_id}-${k}`} v={r.exceptions[k]} tone={EXC_TONE[k]} onClick={() => open(r, k, d.exception_labels[k])} /></td>)}
                </tr>
              ))}
              {d.rows.length === 0 && <tr><td colSpan={30} className="text-center text-slate-400 py-6">No files match these filters</td></tr>}
            </tbody>
          </table>
          <p className="text-[10px] text-slate-400 mt-2">Red = needs attention now, amber = at risk, grey = waiting on someone (counts include the share of each processor's active files). Click any count to see the files.</p>
        </div>
      )}
      <RecordsDialog open={!!drill} onClose={() => setDrill(null)} title={drill?.title} url="/meta/processor-perf/files" params={drill?.params} columns={FILE_COLS} csvName="processor_exception_files.csv" />
    </section>
  );
};
