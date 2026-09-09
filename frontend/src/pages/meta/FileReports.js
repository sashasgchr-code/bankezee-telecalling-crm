import React, { useEffect, useState, useCallback } from "react";
import api from "../../services/api";
import { toast } from "sonner";
import { useMetaUser, inr, BRAND, BRAND_DARK } from "./metaCommon";
import { BarChart3, FolderOpen, Clock, LogIn, CheckCircle2, DollarSign, AlertTriangle, TrendingUp, Download } from "lucide-react";

const Card = ({ label, value, sub, icon: Icon, accent, testid }) => (
  <div className="bg-white border border-slate-200 rounded-md p-5 shadow-sm" data-testid={testid}>
    <div className="flex items-center justify-between">
      <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</span>
      <div className={`h-8 w-8 rounded-md flex items-center justify-center ${accent}`}><Icon size={16} /></div>
    </div>
    <p className="text-2xl font-semibold mt-2" style={{ color: BRAND_DARK }}>{value}</p>
    {sub !== undefined && <p className="text-xs text-slate-400 mt-1">{sub}</p>}
  </div>
);

export default function MetaFileReports() {
  const meta = useMetaUser();
  const isAdminOps = meta.isStaff;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [partners, setPartners] = useState([]);
  const [processors, setProcessors] = useState([]);
  const [f, setF] = useState({ from_date: "", to_date: "", partner: "ALL", processor: "ALL" });
  const [workload, setWorkload] = useState([]);

  const exportCsv = async () => {
    const params = {};
    Object.entries(f).forEach(([k, v]) => { if (v && v !== "ALL") params[k] = v; });
    try {
      const res = await api.get("/meta/files/report/export", { params, responseType: "blob" });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a"); a.href = url; a.download = "meta_file_report.csv"; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (e) { toast.error("Export failed"); }
  };

  const load = useCallback(async () => {
    const params = {};
    Object.entries(f).forEach(([k, v]) => { if (v && v !== "ALL") params[k] = v; });
    setLoading(true); setLoadError(false);
    try {
      const { data } = await api.get("/meta/files/report", { params });
      setData(data);
    } catch (e) {
      setLoadError(true); setData(null);
      toast.error("Failed to load file reports");
    } finally {
      setLoading(false);
    }
  }, [f]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (meta.isAdmin) api.get("/meta/partners").then(({ data }) => setPartners(data)).catch(() => {});
    if (isAdminOps || meta.role === "processor") api.get("/meta/processors").then(({ data }) => setProcessors(data)).catch(() => {});
    if (isAdminOps) api.get("/meta/processors/workload").then(({ data }) => setWorkload(data)).catch(() => {});
  }, [meta.isAdmin, meta.role, isAdminOps]);

  const o = data?.overall;
  const m = data?.this_month;
  const upd = (k) => (e) => setF({ ...f, [k]: e.target.value });

  return (
    <div data-testid="meta-file-reports">
      <header className="h-16 border-b border-slate-200 bg-white px-4 md:px-8 flex items-center gap-2 sticky top-0 z-30">
        <BarChart3 size={20} style={{ color: BRAND }} />
        <h1 className="text-xl font-bold" style={{ color: BRAND_DARK }}>File Reports</h1>
        <button data-testid="meta-export-csv-btn" onClick={exportCsv} className="ml-auto text-white rounded-md px-3 py-2 text-sm font-medium transition-colors flex items-center gap-1" style={{ background: BRAND }}>
          <Download size={15} /> Export CSV
        </button>
      </header>

      <div className="p-4 md:p-8">
        <div className="flex flex-wrap items-end gap-3 mb-6">
          <div><label className="text-xs text-slate-500">From (File date)</label><input data-testid="meta-report-from" type="date" value={f.from_date} onChange={upd("from_date")} className="mt-1 block border border-slate-300 rounded-md px-3 py-2 text-sm outline-none" /></div>
          <div><label className="text-xs text-slate-500">To (File date)</label><input data-testid="meta-report-to" type="date" value={f.to_date} onChange={upd("to_date")} className="mt-1 block border border-slate-300 rounded-md px-3 py-2 text-sm outline-none" /></div>
          {meta.isAdmin && (
            <div><label className="text-xs text-slate-500">Growth Partner</label>
              <select data-testid="meta-report-partner" value={f.partner} onChange={upd("partner")} className="mt-1 block border border-slate-300 rounded-md px-3 py-2 text-sm bg-white outline-none">
                <option value="ALL">All Partners</option>{partners.map((p) => <option key={p.user_id} value={p.user_id}>{p.name}</option>)}
              </select>
            </div>
          )}
          {isAdminOps && (
            <div><label className="text-xs text-slate-500">Processor</label>
              <select data-testid="meta-report-processor" value={f.processor} onChange={upd("processor")} className="mt-1 block border border-slate-300 rounded-md px-3 py-2 text-sm bg-white outline-none">
                <option value="ALL">All Processors</option>{processors.map((p) => <option key={p.user_id} value={p.user_id}>{p.name}</option>)}
              </select>
            </div>
          )}
        </div>

        {loading ? <p className="text-slate-400 text-sm" data-testid="meta-reports-loading">Loading...</p>
          : loadError ? <p className="text-red-500 text-sm" data-testid="meta-reports-error">Could not load file reports. Please retry.</p>
          : !o || o.total_files === 0 ? <p className="text-slate-400 text-sm" data-testid="meta-reports-empty">No files found for the selected range.</p> : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <Card label="Total Files" value={o.total_files} icon={FolderOpen} accent="bg-violet-50 text-violet-600" testid="meta-rep-total" />
              <Card label="In Progress" value={o.in_progress} icon={Clock} accent="bg-amber-50 text-amber-600" testid="meta-rep-inprogress" />
              <Card label="Login Done" value={o.login} icon={LogIn} accent="bg-blue-50 text-blue-600" testid="meta-rep-login" />
              <Card label="Approved" value={o.approved} sub={inr(o.approved_amount)} icon={CheckCircle2} accent="bg-emerald-50 text-emerald-600" testid="meta-rep-approved" />
              <Card label="Disbursed" value={o.disbursed} sub={inr(o.disbursed_amount)} icon={DollarSign} accent="bg-emerald-50 text-emerald-700" testid="meta-rep-disbursed" />
              <Card label="Rejected" value={o.rejected} icon={AlertTriangle} accent="bg-red-50 text-red-600" testid="meta-rep-rejected" />
              <Card label="Amt in Pipeline" value={inr(o.pipeline_amount)} icon={TrendingUp} accent="bg-blue-50 text-blue-600" testid="meta-rep-pipeline" />
              <Card label="Total Disbursed" value={inr(o.disbursed_amount)} icon={DollarSign} accent="bg-emerald-50 text-emerald-700" testid="meta-rep-total-disbursed" />
            </div>

            <div className="mt-8">
              <h3 className="text-sm font-semibold mb-3" style={{ color: BRAND_DARK }}>This Month</h3>
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-4" data-testid="meta-report-this-month">
                <Card label="New Files" value={m.total_files} icon={FolderOpen} accent="bg-violet-50 text-violet-600" />
                <Card label="Login Done" value={m.login} icon={LogIn} accent="bg-blue-50 text-blue-600" />
                <Card label="Approved" value={m.approved} sub={inr(m.approved_amount)} icon={CheckCircle2} accent="bg-emerald-50 text-emerald-600" />
                <Card label="Disbursed" value={m.disbursed} sub={inr(m.disbursed_amount)} icon={DollarSign} accent="bg-emerald-50 text-emerald-700" />
                <Card label="Rejected" value={m.rejected} icon={AlertTriangle} accent="bg-red-50 text-red-600" />
              </div>
            </div>

            {isAdminOps && workload.length > 0 && (
              <div className="mt-8">
                <h3 className="text-sm font-semibold mb-3" style={{ color: BRAND_DARK }}>Processor Workload</h3>
                <div className="bg-white border border-slate-200 rounded-md shadow-sm overflow-x-auto">
                  <table className="w-full border-collapse" data-testid="meta-workload-table">
                    <thead><tr className="bg-slate-50/80 border-b border-slate-200">
                      {["Processor", "Total Files", "In Progress", "Login", "Approved", "Disbursed"].map((h) => <th key={h} className="text-xs font-semibold uppercase tracking-wider text-slate-500 py-3 px-3 text-left">{h}</th>)}
                    </tr></thead>
                    <tbody>
                      {workload.map((w) => (
                        <tr key={w.user_id} className="border-b border-slate-100" data-testid={`meta-workload-${w.user_id}`}>
                          <td className="py-2.5 px-3 text-sm font-medium text-slate-800">{w.name}</td>
                          <td className="py-2.5 px-3 text-sm font-semibold" style={{ color: BRAND_DARK }}>{w.total}</td>
                          <td className="py-2.5 px-3 text-sm text-amber-600">{w.in_progress}</td>
                          <td className="py-2.5 px-3 text-sm text-blue-600">{w.login}</td>
                          <td className="py-2.5 px-3 text-sm text-emerald-600">{w.approved}</td>
                          <td className="py-2.5 px-3 text-sm text-emerald-700">{w.disbursed}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
