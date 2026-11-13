import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../../services/api";
import { toast } from "sonner";
import { RefreshCw, Download, RotateCcw, Check, ChevronDown, Users2, UserCog } from "lucide-react";
import { C, Section } from "../../components/meta/reports/ReportWidgets";
import { ProcessorPerformance } from "../../components/meta/perf/ProcessorPerformance";
import { useMetaUser } from "./metaCommon";
import MetaCallActivity from "../../components/meta/MetaCallActivity";
import { KpiRows, Pipeline, GpTable, ProcTable, TatSection, OverdueTable, LoanTypes, Alerts } from "../../components/meta/reports/ReportSections";

const STATE_KEY = "metaReportsFilters_v1";
const LEADS_STATE_KEY = "metaLeadsState_v1";
const pad = (x) => String(x).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const presetRange = (p) => {
  const t = new Date(); const d0 = new Date(t.getFullYear(), t.getMonth(), t.getDate());
  if (p === "today") return [ymd(d0), ymd(d0)];
  if (p === "yesterday") { const y = new Date(d0); y.setDate(y.getDate() - 1); return [ymd(y), ymd(y)]; }
  if (p === "last7") { const s = new Date(d0); s.setDate(s.getDate() - 6); return [ymd(s), ymd(d0)]; }
  if (p === "this_month") return [ymd(new Date(t.getFullYear(), t.getMonth(), 1)), ymd(d0)];
  if (p === "last_month") return [ymd(new Date(t.getFullYear(), t.getMonth() - 1, 1)), ymd(new Date(t.getFullYear(), t.getMonth(), 0))];
  return ["", ""];
};
const PRESETS = [["today", "Today"], ["yesterday", "Yesterday"], ["last7", "Last 7 Days"], ["this_month", "This Month"], ["last_month", "Last Month"], ["all", "All Time"], ["custom", "Custom"]];
const DEFAULT = (() => { const [a, b] = presetRange("this_month"); return { preset: "this_month", from_date: a, to_date: b, partner: "", processor: "", loan_type: "", source: "", file_status: "", manager: "", basis: "cohort" }; })();
const EXPORTS = [["complete", "Complete Report CSV"], ["gp", "GP Performance CSV"], ["processor", "Processor Performance CSV"], ["status", "File Status CSV"], ["tat", "TAT Report CSV"], ["overdue", "Overdue Files CSV"]];

const Sel = ({ label, value, onChange, options, testid, all = "All" }) => (
  <label className="flex flex-col text-[10px] font-semibold uppercase tracking-wide text-slate-500 min-w-[130px]">
    {label}
    <select data-testid={testid} value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 border border-slate-300 rounded-md px-2 py-1.5 text-xs font-normal normal-case tracking-normal bg-white text-slate-800 outline-none focus:border-blue-500">
      <option value="">{all}</option>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  </label>
);

export default function MetaReports() {
  const navigate = useNavigate();
  const saved = (() => { try { return JSON.parse(sessionStorage.getItem(STATE_KEY) || "null"); } catch { return null; } })();
  const [draft, setDraft] = useState(saved || DEFAULT);
  const [applied, setApplied] = useState(saved || DEFAULT);
  const [opts, setOpts] = useState({ partners: [], processors: [], managers: [], loan_types: [], file_statuses: [], role: "" });
  const metaUser = useMetaUser();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [updated, setUpdated] = useState(null);
  const [expOpen, setExpOpen] = useState(false);
  const inflight = useRef(false);

  const params = useCallback((f) => {
    const p = {};
    ["from_date", "to_date", "partner", "processor", "loan_type", "source", "file_status", "manager", "basis"].forEach((k) => { if (f[k]) p[k] = f[k]; });
    return p;
  }, []);

  const load = useCallback(async (f = applied, quiet = false) => {
    if (inflight.current) return;
    inflight.current = true; if (!quiet) setLoading(true);
    try {
      const { data } = await api.get("/meta/reports/live", { params: params(f) });
      setData(data); setUpdated(new Date());
    } catch { if (!quiet) toast.error("Could not load reports"); }
    finally { inflight.current = false; setLoading(false); }
  }, [applied, params]);

  useEffect(() => { api.get("/meta/reports/options").then(({ data }) => setOpts(data)).catch(() => {}); }, []);
  useEffect(() => { load(applied); try { sessionStorage.setItem(STATE_KEY, JSON.stringify(applied)); } catch { /* ignore */ } }, [applied]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const id = setInterval(() => { if (document.visibilityState === "visible") load(applied, true); }, 60000);
    const onVis = () => { if (document.visibilityState === "visible") load(applied, true); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", onVis); };
  }, [applied, load]);

  const setPreset = (p) => { if (p === "custom") return setDraft({ ...draft, preset: "custom" }); const [a, b] = presetRange(p); setDraft({ ...draft, preset: p, from_date: a, to_date: b }); };
  const apply = () => setApplied({ ...draft });
  const reset = () => { setDraft(DEFAULT); setApplied(DEFAULT); };
  const isStaff = opts.role === "admin" || opts.role === "ops";

  const exportCsv = async (section) => {
    setExpOpen(false);
    try {
      const res = await api.get("/meta/reports/live/export", { params: { ...params(applied), section }, responseType: "blob" });
      const url = URL.createObjectURL(res.data); const a = document.createElement("a");
      a.href = url; a.download = `bankezee_report_${section}.csv`; a.click(); URL.revokeObjectURL(url);
    } catch { toast.error("Export failed"); }
  };

  // Drill-down navigation: Files page reads URL params; Leads page reads its saved session state.
  const go = {
    files: (extra) => {
      const p = new URLSearchParams();
      const base = { gp: applied.partner, proc: applied.processor, loan: opts.loan_types.find((l) => l.toLowerCase() === (applied.loan_type || "").toLowerCase()) || "", source: applied.source, status: applied.file_status };
      if (applied.basis === "cohort") { base.from = applied.from_date; base.to = applied.to_date; }
      Object.entries({ ...base, ...extra }).forEach(([k, v]) => { if (v) p.set(k, v); });
      navigate(`/meta/files?${p.toString()}`);
    },
    leads: (extra) => {
      const snap = { status: "ALL", sourceFilter: applied.source || "ALL", partnerFilter: applied.partner || "ALL", page: 1, datePreset: "ALL", ...extra };
      try { sessionStorage.setItem(LEADS_STATE_KEY, JSON.stringify(snap)); } catch { /* ignore */ }
      navigate("/meta/leads");
    },
    file: (id) => navigate(`/meta/files/${id}`),
  };

  const extraStatuses = (data?.pipeline || []).filter((p) => p.count && !["Not Eligible", "Login Done", "Approved", "Declined", "Disbursed"].includes(p.status)).map((p) => p.status);

  return (
    <div data-testid="meta-reports" style={{ background: C.bg }} className="min-h-screen">
      <header className="border-b border-slate-200 bg-white px-4 md:px-6 py-3 sticky top-0 z-30 flex flex-wrap items-center gap-3 pr-16">
        <h1 className="text-lg md:text-xl font-extrabold" style={{ color: C.navy }}>BankEzee – Live Business Reports</h1>
        <span className="text-[11px] text-slate-500" data-testid="reports-last-updated">{updated ? `Last updated ${updated.toLocaleTimeString("en-IN")}` : "Loading…"} · auto-refresh 60s</span>
      </header>

      <div className="p-3 md:p-5 space-y-4">
        <ProcessorPerformance role={metaUser.role} />
        <a href="/meta/ad-performance" data-testid="reports-ad-perf-link" className="inline-block text-xs font-semibold text-sky-700 underline">Open Meta Ad Performance →</a>
        <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-sm space-y-2.5" data-testid="reports-filters">
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map(([k, l]) => (
              <button key={k} type="button" data-testid={`preset-${k}`} onClick={() => setPreset(k)}
                className="px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors"
                style={draft.preset === k ? { background: C.navy, color: "#fff", borderColor: C.navy } : { borderColor: "#e2e8f0", color: "#475569" }}>{l}</button>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-2.5">
            <label className="flex flex-col text-[10px] font-semibold uppercase tracking-wide text-slate-500">From Date
              <input data-testid="reports-from" type="date" value={draft.from_date} onChange={(e) => setDraft({ ...draft, from_date: e.target.value, preset: "custom" })} className="mt-1 border border-slate-300 rounded-md px-2 py-1 text-xs text-slate-800" /></label>
            <label className="flex flex-col text-[10px] font-semibold uppercase tracking-wide text-slate-500">To Date
              <input data-testid="reports-to" type="date" value={draft.to_date} onChange={(e) => setDraft({ ...draft, to_date: e.target.value, preset: "custom" })} className="mt-1 border border-slate-300 rounded-md px-2 py-1 text-xs text-slate-800" /></label>
            {isStaff && <Sel testid="reports-gp" label="Growth Partner" value={draft.partner} onChange={(v) => setDraft({ ...draft, partner: v })} options={[["UNASSIGNED", "Unassigned"], ...opts.partners.map((p) => [p.user_id, p.name])]} />}
            {isStaff && <Sel testid="reports-processor" label="Processor" value={draft.processor} onChange={(v) => setDraft({ ...draft, processor: v })} options={[["UNASSIGNED", "Unassigned"], ...opts.processors.map((p) => [p.user_id, p.name])]} />}
            {isStaff && opts.managers.length > 0 && <Sel testid="reports-manager" label="Manager" value={draft.manager} onChange={(v) => setDraft({ ...draft, manager: v })} options={opts.managers.map((m) => [m.id, m.name])} />}
            <Sel testid="reports-loan" label="Loan Type" value={draft.loan_type} onChange={(v) => setDraft({ ...draft, loan_type: v })} options={opts.loan_types.map((l) => [l, l])} />
            <Sel testid="reports-source" label="Lead Source" value={draft.source} onChange={(v) => setDraft({ ...draft, source: v })} options={[["META", "Meta"], ["WEBSITE", "Website"], ["MANUAL", "Manual Entry"]]} />
            <Sel testid="reports-file-status" label="File Status" value={draft.file_status} onChange={(v) => setDraft({ ...draft, file_status: v })} options={opts.file_statuses.map((s) => [s, s])} />
            <Sel testid="reports-basis" label="Date Basis" all="Created in period" value={draft.basis === "activity" ? "activity" : ""} onChange={(v) => setDraft({ ...draft, basis: v || "cohort" })} options={[["activity", "Activity in period"]]} />
            <div className="flex items-center gap-1.5 ml-auto">
              <button type="button" data-testid="reports-apply" onClick={apply} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-bold text-white" style={{ background: C.blue }}><Check size={13} /> Apply</button>
              <button type="button" data-testid="reports-reset" onClick={reset} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-semibold border border-slate-300 text-slate-600 hover:bg-slate-50"><RotateCcw size={13} /> Reset</button>
              <button type="button" data-testid="reports-refresh" onClick={() => load(applied)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-semibold border border-slate-300 text-slate-600 hover:bg-slate-50"><RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Refresh</button>
              <div className="relative">
                <button type="button" data-testid="reports-export" onClick={() => setExpOpen((v) => !v)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-bold text-white" style={{ background: C.emerald }}><Download size={13} /> Export <ChevronDown size={12} /></button>
                {expOpen && (
                  <div className="absolute right-0 mt-1 w-52 bg-white border border-slate-200 rounded-lg shadow-xl z-40 py-1" data-testid="reports-export-menu">
                    {EXPORTS.map(([k, l]) => <button key={k} type="button" data-testid={`export-${k}`} onClick={() => exportCsv(k)} className="w-full text-left px-3 py-1.5 text-xs hover:bg-slate-50">{l}</button>)}
                  </div>
                )}
              </div>
            </div>
          </div>
          <p className="text-[10px] text-slate-400" data-testid="reports-basis-note">
            {applied.basis === "activity"
              ? "Activity in period: logins, approvals, declines and disbursals are counted by the date the milestone happened (files without a recorded milestone date are left out). Leads and files are counted by their creation date."
              : "Created in period: leads are counted by lead creation date, and files by file creation date; their logins, approvals and disbursals are counted whenever they happened."}
          </p>
        </div>

        {!data ? <div className="p-10 flex justify-center"><div className="h-8 w-8 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: C.blue, borderTopColor: "transparent" }} /></div> : (
          <>
            <KpiRows k={data.kpis} go={go} />
            <Pipeline rows={data.pipeline} total={data.total_files} go={go} />
            {data.gp.length > 0 && <Section testid="reports-gp-section" title="Growth Partner Performance" icon={Users2}><GpTable rows={data.gp} extraStatuses={extraStatuses} go={go} /></Section>}
            {data.processors.length > 0 && <Section testid="reports-processors" title="Processor Performance" icon={UserCog}><ProcTable rows={data.processors} go={go} /></Section>}
            <TatSection t={data.tat} go={go} />
            <OverdueTable rows={data.overdue} go={go} onExport={() => exportCsv("overdue")} />
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <LoanTypes rows={data.loan_types} go={go} />
              <Alerts a={data.alerts} go={go} />
            </div>
          </>
        )}
        <MetaCallActivity />
      </div>
    </div>
  );
}
