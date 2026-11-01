import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import api from "../../services/api";
import { Loader2, Download, RefreshCw, Info, ChevronRight, AlertTriangle, Trophy } from "lucide-react";
import { useMetaUser, BRAND_DARK, LEAD_STATUSES } from "./metaCommon";
import { RecordsDialog } from "../../components/meta/perf/RecordsDialog";
import { inr, pct, num, Sel, useFilterOptions, rowsToCsv } from "../../components/meta/perf/perfUtils";

const REC_COLS = [["name", "Customer"], ["lead_id", "Lead ID"], ["status", "Lead status"], ["stage", "File stage"], ["campaign_name", "Campaign"], ["adset_name", "Ad set"], ["ad_name", "Ad"], ["partner_name", "GP"], ["processor_name", "Processor"], ["created", "Lead created"], ["file_at", "File created"], ["approved_at", "Approved"], ["approved_amount", "Approved ₹", true], ["disbursed_at", "Disbursed"], ["disbursed_amount", "Disbursed ₹", true]];
const NEXT = { campaign: "adset", adset: "ad", ad: null };
const LVL = { campaign: "Campaign", adset: "Ad set", ad: "Ad" };
const COLS = [["leads", "Leads"], ["not_contacted", "Not contacted"], ["contacted", "Contacted"], ["qualified", "Qualified"], ["not_eligible", "Not eligible"], ["files", "Files"], ["file_conv", "Lead→file %", "pct"], ["tat_exceeded", "TAT exceeded"], ["approved", "Approved"], ["approved_amount", "Approved ₹", "inr"], ["disbursed", "Disbursed"], ["disbursed_amount", "Disbursed ₹", "inr"], ["declined", "Declined"], ["approval_conv", "Lead→approval %", "pct"], ["disb_conv", "Lead→disbursal %", "pct"], ["file_to_disb", "File→disbursal %", "pct"], ["median_age_days", "Median lead age (d)"], ["spend", "Spend", "inr"], ["meta_cpl", "Meta CPL", "inr"], ["crm_cpl", "CRM CPL", "inr"], ["cost_per_file", "Cost/file", "inr"], ["cost_per_approved", "Cost/approved", "inr"], ["cost_per_disb", "Cost/disbursal", "inr"]];
const CLICKABLE = new Set(["leads", "not_contacted", "contacted", "qualified", "not_eligible", "files", "tat_exceeded", "approved", "disbursed", "declined"]);
const fmt = (v, t) => (t === "pct" ? pct(v) : t === "inr" ? inr(v) : num(v));

const Card = ({ label, value, onClick, testid, tone = "" }) => (
  <button data-testid={testid} onClick={onClick} disabled={!onClick} className={`text-left bg-white border rounded-lg px-3 py-2.5 ${onClick ? "hover:border-sky-300" : ""} ${tone}`}>
    <p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p><p className="text-lg font-bold text-slate-800">{value}</p>
  </button>
);

const Ranked = ({ title, icon: Icon, items, tone, testid }) => (
  <div className="bg-white border rounded-lg p-3" data-testid={testid}>
    <h3 className={`text-sm font-semibold flex items-center gap-1.5 mb-2 ${tone}`}><Icon size={15} />{title}</h3>
    {items.length === 0 ? <p className="text-xs text-slate-400">Not enough ads meet the minimum sample yet.</p> : items.map((a) => (
      <div key={a.id} className="py-1.5 border-b last:border-0 text-xs"><p className="font-medium text-slate-800">{a.name}</p><p className="text-[10px] text-slate-400">Ad ID {a.id}{a.adset_name ? ` · Ad set: ${a.adset_name}` : ""}</p><p className="text-slate-500">{a.reason}</p></div>
    ))}
  </div>
);

export default function AdPerformance() {
  const meta = useMetaUser();
  const [f, setF] = useState({ view: "cohort", date_from: "", date_to: "", campaign_id: "", adset_id: "", ad_id: "", loan_type: "", partner: "", processor: "", status: "", stage: "", attr: "", min_sample: 20, maturity_days: 30, mature_only: false, rank_by: "file_conv" });
  const [level, setLevel] = useState("campaign");
  const [d, setD] = useState(null);
  const [opts, setOpts] = useState({ campaigns: [], adsets: [], ads: [] });
  const [fo, setFo] = useState({ partners: [], processors: [], loanTypes: [] });
  const [sort, setSort] = useState(["leads", -1]);
  const [drill, setDrill] = useState(null);
  const [defs, setDefs] = useState(false);
  const loadFo = useFilterOptions();
  const load = useCallback(() => { setD(null); api.get("/meta/ad-perf", { params: { ...f, level } }).then(({ data }) => setD(data)).catch(() => toast.error("Could not load report")); }, [f, level]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.get("/meta/ad-perf/options").then(({ data }) => setOpts(data)).catch(() => {}); loadFo().then(setFo); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (v) => setF({ ...f, [k]: v });
  const base = { ...f, level: "", bucket: "" };
  const openRec = (metric, row) => setDrill({ title: `${metric.replace(/_/g, " ")}${row ? ` — ${row.name}` : ""}`, params: { ...base, metric, ...(row ? { level, bucket: row.id || "" } : {}) } });
  const drillDown = (row) => {
    if (!NEXT[level] || !row.id) return openRec("leads", row);
    const key = level === "campaign" ? "campaign_id" : "adset_id";
    setF({ ...f, [key]: row.id }); setLevel(NEXT[level]);
  };
  const rows = useMemo(() => [...(d?.rows || [])].sort((a, b) => ((a[sort[0]] ?? -1) > (b[sort[0]] ?? -1) ? 1 : -1) * sort[1]), [d, sort]);
  const spendOk = d?.spend?.available;
  const cols = COLS.filter((c) => spendOk || !["spend", "meta_cpl", "crm_cpl", "cost_per_file", "cost_per_approved", "cost_per_disb"].includes(c[0]));
  const t = d?.total || {};
  const syncSpend = async () => { try { const { data } = await api.post("/meta/ad-perf/spend/sync"); data.ok ? toast.success(`Spend synced (${data.rows} rows)`) : toast.error(data.error); load(); } catch (e) { toast.error(e?.response?.data?.detail || "Sync failed"); } };

  return (
    <div className="p-4 md:p-6 space-y-4" data-testid="ad-performance-page">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold mr-auto" style={{ color: BRAND_DARK }}>Meta Ad Performance</h1>
        <div className="flex rounded-full border overflow-hidden text-xs" data-testid="ap-view-toggle">
          {[["cohort", "Lead cohort view"], ["activity", "Activity view"]].map(([k, l]) => <button key={k} data-testid={`ap-view-${k}`} onClick={() => set("view")(k)} className={`px-3 py-1.5 ${f.view === k ? "bg-slate-800 text-white" : "text-slate-600"}`}>{l}</button>)}
        </div>
        <button data-testid="ap-defs-toggle" onClick={() => setDefs(!defs)} className="text-xs text-sky-700 inline-flex items-center gap-1 mr-14"><Info size={13} />Definitions</button>
      </div>
      <p className="text-xs text-slate-500" data-testid="ap-view-help">{f.view === "cohort" ? "Leads created by Meta in the period, with their file outcomes as of " : "Imports, files, approvals and disbursals that happened in the period (each by its own date), as of "}{d ? new Date(d.as_of).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : "…"} IST.</p>
      {defs && d && <div className="text-[11px] text-slate-600 bg-slate-50 border rounded-md p-3 space-y-1" data-testid="ap-definitions">{Object.entries(d.definitions).map(([k, v]) => <p key={k}><b>{k}:</b> {v}</p>)}<p><b>TAT:</b> {d.tat_definition}</p></div>}

      <div className="flex flex-wrap gap-1.5 items-center bg-white border rounded-lg p-3" data-testid="ap-filters">
        <input type="date" data-testid="ap-from" value={f.date_from} onChange={(e) => set("date_from")(e.target.value)} className="border rounded-md px-2 py-1 text-xs" />
        <input type="date" data-testid="ap-to" value={f.date_to} onChange={(e) => set("date_to")(e.target.value)} className="border rounded-md px-2 py-1 text-xs" />
        <Sel testid="ap-campaign" value={f.campaign_id} onChange={(v) => setF({ ...f, campaign_id: v, adset_id: "", ad_id: "" })}><option value="">All campaigns</option>{opts.campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Sel>
        <Sel testid="ap-adset" value={f.adset_id} onChange={(v) => setF({ ...f, adset_id: v, ad_id: "" })}><option value="">All ad sets</option>{opts.adsets.filter((a) => !f.campaign_id || a.campaign_id === f.campaign_id).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Sel>
        <Sel testid="ap-ad" value={f.ad_id} onChange={set("ad_id")}><option value="">All ads</option>{opts.ads.filter((a) => (!f.campaign_id || a.campaign_id === f.campaign_id) && (!f.adset_id || a.adset_id === f.adset_id)).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Sel>
        <Sel testid="ap-loan-type" value={f.loan_type} onChange={set("loan_type")}><option value="">All loan types</option>{fo.loanTypes.map((l) => <option key={l} value={l}>{l}</option>)}</Sel>
        {meta.isStaff && <Sel testid="ap-partner" value={f.partner} onChange={set("partner")}><option value="">All GPs</option>{fo.partners.map((p) => <option key={p.user_id} value={p.user_id}>{p.name}</option>)}</Sel>}
        {meta.isStaff && <Sel testid="ap-processor" value={f.processor} onChange={set("processor")}><option value="">All processors</option>{fo.processors.map((p) => <option key={p.user_id} value={p.user_id}>{p.name}</option>)}</Sel>}
        <Sel testid="ap-status" value={f.status} onChange={set("status")}><option value="">Any lead status</option>{LEAD_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</Sel>
        <Sel testid="ap-stage" value={f.stage} onChange={set("stage")}><option value="">Any file stage</option>{Object.keys(t.stages || {}).map((s) => <option key={s} value={s}>{s}</option>)}</Sel>
        <Sel testid="ap-attr" value={f.attr} onChange={set("attr")}><option value="">Attribution: all</option><option value="yes">Attribution available</option><option value="no">Attribution missing</option></Sel>
      </div>

      {d && !spendOk && <p className="text-xs rounded-md border border-amber-200 bg-amber-50 text-amber-800 px-3 py-2 flex items-start gap-2" data-testid="ap-spend-unavailable"><AlertTriangle size={14} className="mt-0.5 shrink-0" />{d.spend.reason}</p>}
      {d && spendOk && <p className="text-xs text-slate-500" data-testid="ap-spend-status">Spend in {d.spend.currency} · ad account timezone {d.spend.timezone} · last sync {new Date(d.spend.last_success).toLocaleString("en-IN")}{d.spend.spend_from ? ` · spend counted from ${d.spend.spend_from}${!f.date_from ? " (first CRM Meta lead)" : ""}` : ""}{d.spend.last_error ? ` · last error: ${d.spend.last_error}` : ""} <button onClick={syncSpend} data-testid="ap-spend-sync" className="ml-2 inline-flex items-center gap-1 text-sky-700"><RefreshCw size={11} />Sync spend</button></p>}
      {d && !spendOk && meta.isStaff && d.spend.reason?.startsWith("Spend not synced") && <button onClick={syncSpend} data-testid="ap-spend-sync" className="text-xs text-sky-700">Sync spend now</button>}

      {!d ? <div className="py-16 flex justify-center"><Loader2 className="animate-spin text-slate-400" /></div> : (<>
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-2" data-testid="ap-cards">
          <Card testid="ap-card-leads" label={f.view === "cohort" ? "Unique Meta leads" : "Leads imported"} value={t.leads} onClick={() => openRec("leads")} />
          <Card testid="ap-card-not-contacted" label="Not yet contacted" value={t.not_contacted} onClick={() => openRec("not_contacted")} />
          <Card testid="ap-card-qualified" label="Qualified" value={t.qualified} onClick={() => openRec("qualified")} />
          <Card testid="ap-card-not-eligible" label="Not eligible" value={t.not_eligible} onClick={() => openRec("not_eligible")} />
          <Card testid="ap-card-files" label={`Files (${pct(t.file_conv)})`} value={t.files} onClick={() => openRec("files")} />
          <Card testid="ap-card-approved" label={`Approved · ${inr(t.approved_amount)}`} value={t.approved} onClick={() => openRec("approved")} />
          <Card testid="ap-card-disbursed" label={`Disbursed · ${inr(t.disbursed_amount)}`} value={t.disbursed} onClick={() => openRec("disbursed")} />
          <Card testid="ap-card-tat" label="Files over TAT" value={t.tat_exceeded} onClick={() => openRec("tat_exceeded")} tone="border-red-200" />
          <Card testid="ap-card-declined" label="Declined / rejected" value={t.declined} onClick={() => openRec("declined")} />
          <Card testid="ap-card-conv" label="Lead→approval / →disbursal" value={`${pct(t.approval_conv)} / ${pct(t.disb_conv)}`} />
          <Card testid="ap-card-f2d" label="File→disbursal" value={pct(t.file_to_disb)} />
          <Card testid="ap-card-missing-amt" label="Missing amounts (appr / disb)" value={`${t.approved_amount_missing} / ${t.disbursed_amount_missing}`} />
          {spendOk && <><Card testid="ap-card-spend" label={`Spend (${d.spend.currency})`} value={inr(t.spend)} /><Card testid="ap-card-meta-cpl" label="Meta CPL (÷ Meta-reported leads)" value={inr(t.meta_cpl)} /><Card testid="ap-card-crm-cpl" label="CRM CPL (÷ CRM unique leads)" value={inr(t.crm_cpl)} /><Card testid="ap-card-cpd" label="Cost per disbursal" value={inr(t.cost_per_disb)} /></>}
          <Card testid="ap-card-attr" label="Attribution available / missing" value={`${d.attributed} / ${d.unattributed}`} onClick={() => set("attr")("no")} />
        </div>

        <div className="bg-white border rounded-lg p-3 text-xs text-slate-600" data-testid="ap-imports">
          <b>Import tracking</b> (since {d.imports.tracking_since ? new Date(d.imports.tracking_since).toLocaleString("en-IN") : "—"}; earlier import logs were never recorded): {d.imports.runs} sync runs · {d.imports.imported} new leads imported · {d.imports.duplicates_skipped} rows already in CRM skipped as duplicates · {d.imports.failed} failed rows. Each sync re-reads the whole sheet, so the duplicate count includes every re-read.
        </div>

        <div className="bg-white border rounded-lg" data-testid="ap-table-wrap">
          <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b text-xs">
            <button data-testid="ap-crumb-campaign" onClick={() => { setLevel("campaign"); setF({ ...f, campaign_id: "", adset_id: "", ad_id: "" }); }} className="font-semibold text-sky-700">Campaigns</button>
            {level !== "campaign" && <><ChevronRight size={12} /><button data-testid="ap-crumb-adset" onClick={() => { setLevel("adset"); setF({ ...f, adset_id: "", ad_id: "" }); }} className="font-semibold text-sky-700">Ad sets</button></>}
            {level === "ad" && <><ChevronRight size={12} /><span className="font-semibold">Ads</span></>}
            {["campaign", "adset", "ad"].map((l) => <button key={l} data-testid={`ap-level-${l}`} onClick={() => setLevel(l)} className={`ml-1 px-2 py-0.5 rounded-full border ${level === l ? "bg-slate-800 text-white" : ""}`}>{LVL[l]}</button>)}
            <button data-testid="ap-table-export" onClick={() => rowsToCsv(rows, [["name", LVL[level]], ["id", "ID"], ["latest_name", "Latest name"], ...cols.map(([k, l]) => [k, l])], `meta_ad_${level}.csv`)} className="ml-auto inline-flex items-center gap-1 border rounded-md px-2 py-1"><Download size={12} />CSV</button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs" data-testid="ap-table">
              <thead><tr className="text-left text-slate-500 border-b">
                <th className="px-2 py-2">{LVL[level]}</th>
                {cols.map(([k, l]) => <th key={k} onClick={() => setSort([k, sort[0] === k ? -sort[1] : -1])} className="px-2 py-2 whitespace-nowrap cursor-pointer hover:text-slate-800" data-testid={`ap-sort-${k}`}>{l}{sort[0] === k ? (sort[1] < 0 ? " ↓" : " ↑") : ""}</th>)}
              </tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.id || "unknown"} className="border-b hover:bg-slate-50" data-testid={`ap-row-${r.id || "unknown"}`}>
                  <td className="px-2 py-2 min-w-[220px]"><button onClick={() => drillDown(r)} className="text-left font-medium text-sky-800 hover:underline" data-testid={`ap-drill-${r.id || "unknown"}`}>{r.name}</button>
                    {r.latest_name && r.latest_name !== r.name && <p className="text-[10px] text-slate-400">Now named: {r.latest_name}</p>}{r.id && <p className="text-[10px] text-slate-400">ID {r.id}</p>}</td>
                  {cols.map(([k, , t2]) => <td key={k} className="px-2">{CLICKABLE.has(k) && r[k] ? <button className="text-sky-700 hover:underline" onClick={() => openRec(k, r)} data-testid={`ap-cell-${r.id || "unknown"}-${k}`}>{r[k]}</button> : fmt(r[k], t2)}</td>)}
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs" data-testid="ap-rank-controls">
          <span className="font-semibold text-slate-700">Rank ads by</span>
          <Sel testid="ap-rank-by" value={f.rank_by} onChange={set("rank_by")}>{[["file_conv", "Lead-to-file conversion"], ["disb_conv", "Lead-to-disbursal conversion"], ["disbursed_amount", "Disbursed amount"], ["not_eligible_pct", "Not-eligible %"], ...(spendOk ? [["cpl", "CRM CPL"], ["cost_per_disb", "Cost per disbursed file"]] : [])].map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Sel>
          <label className="flex items-center gap-1">Min leads <input type="number" min={1} data-testid="ap-min-sample" value={f.min_sample} onChange={(e) => set("min_sample")(e.target.value || 1)} className="w-14 border rounded px-1 py-0.5" /></label>
          <label className="flex items-center gap-1">Mature after <input type="number" min={0} data-testid="ap-maturity" value={f.maturity_days} onChange={(e) => set("maturity_days")(e.target.value || 0)} className="w-14 border rounded px-1 py-0.5" /> days</label>
          <label className="flex items-center gap-1"><input type="checkbox" data-testid="ap-mature-only" checked={f.mature_only} onChange={(e) => set("mature_only")(e.target.checked)} />Mature leads only</label>
          {d.insufficient_ads > 0 && <span className="text-slate-400" data-testid="ap-insufficient">{d.insufficient_ads} ads below the minimum: Insufficient data</span>}
        </div>
        <div className="grid md:grid-cols-2 gap-3">
          <Ranked testid="ap-best" title="Best Performing Ads" icon={Trophy} items={d.best} tone="text-emerald-700" />
          <Ranked testid="ap-worst" title="Ads Needing Attention" icon={AlertTriangle} items={d.worst} tone="text-red-700" />
        </div>
      </>)}
      <RecordsDialog open={!!drill} onClose={() => setDrill(null)} title={drill?.title} url="/meta/ad-perf/records" params={drill?.params} columns={REC_COLS} csvName="meta_ad_records.csv" />
    </div>
  );
}
