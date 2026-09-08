import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../../services/api";
import { StatusPill, fmtDur, BRAND, BRAND_DARK } from "./metaCommon";
import { PhoneCall, Clock } from "lucide-react";

const OUTCOME_STYLES = {
  NOT_ANSWERING: "bg-red-50 text-red-700", SWITCHED_OFF: "bg-orange-50 text-orange-700",
  NOT_INTERESTED: "bg-slate-100 text-slate-600", NOT_QUALIFIED: "bg-red-50 text-red-700",
  CALL_BACK: "bg-blue-50 text-blue-700", LEAD: "bg-emerald-50 text-emerald-700", FILE: "bg-violet-50 text-violet-700",
};

export default function MetaCallLogs() {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  useEffect(() => { api.get("/meta/call-logs").then(({ data }) => setRows(data)).catch(() => {}).finally(() => setLoading(false)); }, []);

  const filtered = rows.filter((r) => !q || `${r.customer} ${r.mobile} ${r.caller}`.toLowerCase().includes(q.toLowerCase()));
  const totalMins = Math.round(rows.reduce((a, r) => a + (r.duration_seconds || 0), 0) / 60);

  return (
    <div data-testid="meta-call-logs">
      <header className="h-16 border-b border-slate-200 bg-white px-4 md:px-8 flex items-center gap-2 sticky top-0 z-30">
        <PhoneCall size={20} className="text-emerald-600" />
        <h1 className="text-xl font-bold" style={{ color: BRAND_DARK }}>Call Logs</h1>
      </header>

      <div className="p-4 md:p-8">
        <div className="flex flex-wrap items-center gap-3 mb-5">
          <input data-testid="meta-calllog-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search customer, mobile, caller..."
            className="flex-1 min-w-[220px] border border-slate-300 rounded-md px-3 py-2 text-sm outline-none bg-white" />
          <div className="text-sm text-slate-500 bg-white border border-slate-200 rounded-md px-4 py-2" data-testid="meta-calllog-summary">
            <span className="font-semibold" style={{ color: BRAND_DARK }}>{rows.length}</span> calls · <span className="font-semibold" style={{ color: BRAND_DARK }}>{totalMins}</span> min total
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-md shadow-sm overflow-hidden">
          <div className="text-white px-5 py-3" style={{ background: BRAND }}>
            <p className="font-semibold text-sm">Detailed Call Report</p>
            <p className="text-xs text-white/70">{filtered.length} calls</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead><tr className="bg-slate-50/80 border-b border-slate-200">
                {["Date / Time", "Caller", "Customer", "Mobile", "City", "Call Outcome", "Duration", "Lead Status"].map((h) => <th key={h} className="text-xs font-semibold uppercase tracking-wider text-slate-500 py-3 px-3 text-left">{h}</th>)}
              </tr></thead>
              <tbody data-testid="meta-calllog-table-body">
                {loading ? (
                  <tr><td colSpan={8} className="py-16 text-center text-slate-400 text-sm">Loading call logs...</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={8} className="py-16 text-center text-slate-400 text-sm">No calls logged yet.</td></tr>
                ) : filtered.map((r, i) => (
                  <tr key={i} onClick={() => navigate(`/meta/leads/${r.lead_id}`)} className="border-b border-slate-100 hover:bg-slate-50/60 transition-colors cursor-pointer">
                    <td className="py-2.5 px-3 text-xs text-slate-500">{r.at ? new Date(r.at).toLocaleString() : "—"}</td>
                    <td className="py-2.5 px-3 text-sm font-medium text-emerald-700">{r.caller}</td>
                    <td className="py-2.5 px-3 text-sm font-medium text-slate-800">{r.customer || "—"}</td>
                    <td className="py-2.5 px-3 text-sm text-slate-600">{r.mobile}</td>
                    <td className="py-2.5 px-3 text-sm text-slate-500">{r.city || "—"}</td>
                    <td className="py-2.5 px-3"><span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${OUTCOME_STYLES[r.disposition] || "bg-slate-100 text-slate-600"}`}>{(r.disposition || "").replace(/_/g, " ").toLowerCase()}</span></td>
                    <td className="py-2.5 px-3 text-sm text-violet-600 flex items-center gap-1"><Clock size={12} /> {fmtDur(r.duration_seconds)}</td>
                    <td className="py-2.5 px-3"><StatusPill status={r.lead_status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
