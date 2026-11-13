import React, { useEffect, useState } from "react";
import api from "../../services/api";
import { MetaSummaryTable, MetaHourlyTable } from "./MetaReportBlocks";

const today = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const PERIODS = [["today", "Today"], ["week", "This week"], ["month", "This month"], ["three_months", "Last 3 months"]];
const cls = "border rounded-md px-2 py-1 text-xs bg-white";

// Partner call activity (summary + IST hourly), moved here from the retired Connect Reports page.
export default function MetaCallActivity() {
  const [period, setPeriod] = useState("today");
  const [date, setDate] = useState(today());
  const [summary, setSummary] = useState(null);
  const [hourly, setHourly] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    setSummary(null);
    api.get("/meta/reports/summary", { params: { period } }).then(({ data }) => setSummary(data)).catch(() => setErr("Could not load the summary"));
  }, [period]);
  useEffect(() => {
    setHourly(null);
    api.get("/meta/reports/hourly", { params: { date } }).then(({ data }) => setHourly(data)).catch(() => setErr("Could not load the hourly report"));
  }, [date]);
  return (
    <div className="space-y-4" data-testid="meta-call-activity">
      {err && <p className="text-xs text-red-600" data-testid="meta-call-activity-error">{err}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-bold text-slate-800 mr-auto">Partner Call Activity</h2>
        <label className="text-xs text-slate-500">Summary period
          <select data-testid="meta-summary-period" className={`${cls} ml-1`} value={period} onChange={(e) => setPeriod(e.target.value)}>
            {PERIODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select></label>
        <label className="text-xs text-slate-500">Hourly date
          <input data-testid="meta-hourly-date" type="date" className={`${cls} ml-1`} value={date} max={today()} onChange={(e) => setDate(e.target.value)} /></label>
      </div>
      {summary ? <MetaSummaryTable data={summary} /> : <p className="text-xs text-slate-400">Loading summary…</p>}
      {hourly ? <MetaHourlyTable data={hourly} /> : <p className="text-xs text-slate-400">Loading hourly report…</p>}
    </div>
  );
}
