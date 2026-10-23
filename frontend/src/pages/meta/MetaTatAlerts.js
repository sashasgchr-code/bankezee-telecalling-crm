import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../../services/api";
import { AlertTriangle, Eye } from "lucide-react";
import { BRAND_DARK, fmtDate } from "./metaCommon";

// Dashboard-only. Lists ongoing files whose End-to-End TAT already exceeds 4 days (96h).
// Computed server-side from the original creation timestamp; completed files are excluded.
// Polls every 2 min and refreshes when a status changes elsewhere ('meta-followup-changed').
export const useTatAlerts = (poll = true) => {
  const [data, setData] = useState({ items: [], count: 0 });
  const load = async () => {
    try {
      const { data } = await api.get("/meta/tat/alerts");
      setData(data || { items: [], count: 0 });
    } catch { /* non-fatal */ }
  };
  useEffect(() => {
    load();
    const onChange = () => load();
    window.addEventListener("meta-followup-changed", onChange);
    let id;
    if (poll) id = setInterval(load, 120000);
    return () => { window.removeEventListener("meta-followup-changed", onChange); if (id) clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { ...data, reload: load };
};

const Cell = ({ children, className = "" }) => (
  <td className={`px-3 py-2 text-xs text-slate-600 ${className}`}>{children}</td>
);

export const TatAlertWidget = () => {
  const navigate = useNavigate();
  const { items, count } = useTatAlerts();

  if (count === 0) {
    return (
      <div className="bg-white border border-emerald-200 rounded-md p-4 shadow-sm flex items-center gap-3" data-testid="meta-tat-widget">
        <div className="h-8 w-8 rounded-md bg-emerald-50 text-emerald-600 flex items-center justify-center"><AlertTriangle size={16} /></div>
        <p className="text-sm text-slate-600" data-testid="meta-tat-widget-allclear">No files exceeding the 4-day TAT limit.</p>
      </div>
    );
  }

  return (
    <div className="bg-white border border-red-200 rounded-md shadow-sm overflow-hidden" data-testid="meta-tat-widget">
      <button
        data-testid="meta-tat-widget-header"
        onClick={() => navigate("/meta/files?tat=exceeded")}
        className="w-full flex items-center justify-between gap-3 px-5 py-3 bg-red-50 hover:bg-red-100 transition-colors text-left"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-red-700">
          <AlertTriangle size={18} />
          <span data-testid="meta-tat-widget-count">{count} File{count === 1 ? "" : "s"} — TAT Exceeded 4 Days</span>
        </span>
        <span className="text-xs text-red-600 font-medium underline">View all</span>
      </button>
      <div className="overflow-x-auto max-h-80 overflow-y-auto">
        <table className="w-full border-collapse">
          <thead className="bg-slate-50 sticky top-0">
            <tr className="text-left">
              <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Customer</th>
              <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">File ID</th>
              <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Created</th>
              <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Status</th>
              <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Processor</th>
              <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Growth Partner</th>
              <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Current TAT</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {items.map((r) => (
              <tr
                key={r.lead_id}
                data-testid={`meta-tat-row-${r.lead_id}`}
                onClick={() => navigate(`/meta/files/${r.lead_id}`)}
                className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer"
              >
                <Cell className="font-semibold text-slate-800">{r.full_name || "—"}</Cell>
                <Cell className="font-mono text-[11px] text-slate-400">{r.lead_id}</Cell>
                <Cell>{fmtDate(r.file_created_at)}</Cell>
                <Cell>{r.processing_status}</Cell>
                <Cell>{r.assigned_processor_name || "—"}</Cell>
                <Cell>{r.assigned_partner_name || "—"}</Cell>
                <Cell className="font-semibold text-red-600 whitespace-nowrap" data-testid={`meta-tat-value-${r.lead_id}`}>
                  {r.tat_days}d {r.tat_hours}h
                </Cell>
                <td className="px-3 py-2">
                  <span className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800"><Eye size={13} /> View</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
