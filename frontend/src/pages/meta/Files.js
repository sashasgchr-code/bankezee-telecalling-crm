import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../../services/api";
import { PROC_STATUSES, inr, maskPhone, BRAND, BRAND_DARK, useMetaUser } from "./metaCommon";
import { FolderOpen, FileCheck2, FileClock, Eye, EyeOff, ChevronRight, Search, UserCheck } from "lucide-react";

const GREEN = new Set(["Approved", "Disbursed", "Login Done", "Documents Collected"]);
const RED = new Set(["Declined", "Not Eligible", "Not Login", "Not Disbursed", "FI Negative"]);
const AMBER = new Set(["Query/Hold", "Documents Pending", "FI Reinitiated", "Underwriting", "Customer Not Interested - Need Help from MIT & Manager", "Customer Not Supporting - Need Help from MIT & Manager"]);
const BLUE = new Set(["Sent for Eligibility", "Sent for Login", "Sent for Approval", "Contacted", "FI (Field Investigation)"]);
const STATUS_COLOR = (s) => GREEN.has(s) ? "bg-emerald-50 text-emerald-700 border-emerald-200"
  : RED.has(s) ? "bg-red-50 text-red-700 border-red-200"
  : AMBER.has(s) ? "bg-amber-50 text-amber-700 border-amber-200"
  : BLUE.has(s) ? "bg-blue-50 text-blue-700 border-blue-200"
  : "bg-slate-100 text-slate-600 border-slate-200";

const StatCard = ({ label, value, icon: Icon, accent, testid }) => (
  <div className="bg-white border border-slate-200 rounded-md p-5 shadow-sm" data-testid={testid}>
    <div className="flex items-center justify-between">
      <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</span>
      <div className={`h-9 w-9 rounded-md flex items-center justify-center ${accent}`}><Icon size={18} /></div>
    </div>
    <p className="text-3xl font-semibold tracking-tight mt-3" style={{ color: BRAND_DARK }}>{value}</p>
  </div>
);

function FileRow({ f, onOpen }) {
  const [reveal, setReveal] = useState(false);
  const dt = f.file_created_at || f.created_at;
  const file = f.file || {};
  const bank = file.disbursed_bank || file.approved_bank || file.login_bank || file.bank || file.lender;
  const processor = f.assigned_processor_name || f.processor_name;
  const docsReceived = file.docs_received ?? f.docs_received;
  const Meta = ({ label, value, className = "text-slate-700" }) => (
    <div className="min-w-0">
      <p className="text-[10px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`text-xs font-semibold truncate ${className}`}>{value || "—"}</p>
    </div>
  );
  return (
    <div data-testid={`meta-file-row-${f.lead_id}`} onClick={onOpen}
      className="p-4 border-b border-slate-100 hover:bg-slate-50/60 transition-colors cursor-pointer">
      {/* header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-800 truncate">{f.full_name || "—"}</p>
          <div className="flex items-center gap-2 text-sm text-slate-600 mt-0.5">
            <span>{reveal ? f.phone : maskPhone(f.phone)}</span>
            <button data-testid={`meta-reveal-phone-${f.lead_id}`} onClick={(e) => { e.stopPropagation(); setReveal(!reveal); }} className="text-slate-400 hover:text-slate-700">{reveal ? <EyeOff size={13} /> : <Eye size={13} />}</button>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span data-testid={`meta-proc-status-${f.lead_id}`} className={`text-xs font-medium px-2.5 py-1 rounded-full border ${STATUS_COLOR(f.processing_status || "New")}`}>{f.processing_status || "New"}</span>
          <ChevronRight size={16} className="text-slate-300 hidden sm:block" />
        </div>
      </div>
      {/* rich field grid — reflows to 2 cols on phones, up to 4 on desktop */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-2 mt-3">
        <Meta label="Loan Type" value={file.loan_type} />
        <Meta label="Loan Amount" value={file.loan_amount ? inr(file.loan_amount) : null} className="text-emerald-600" />
        <Meta label="Assigned GP" value={f.assigned_partner_name} className={f.assigned_partner_id ? "text-slate-700" : "text-slate-400"} />
        <Meta label="Processor" value={processor} />
        <Meta label="Bank / Lender" value={bank} />
        <Meta label="Created" value={dt ? new Date(dt).toLocaleDateString() : null} />
        <Meta label="Docs" value={docsReceived == null ? null : (docsReceived ? "Received" : "Pending")} className={docsReceived ? "text-emerald-600" : "text-amber-600"} />
        <Meta label="Assignment" value={f.assigned_partner_id ? "Assigned" : "Unassigned"} className={f.assigned_partner_id ? "text-emerald-600" : "text-slate-400"} />
      </div>
    </div>
  );
}

export default function MetaFiles() {
  const navigate = useNavigate();
  const meta = useMetaUser();
  const [stats, setStats] = useState(null);
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  // Processors land on their own queue by default; staff can toggle it on.
  const [myOnly, setMyOnly] = useState(meta.role === "processor");
  const canFilterMine = ["processor", "admin", "ops"].includes(meta.role);

  useEffect(() => {
    Promise.all([
      api.get("/meta/files/stats").then(({ data }) => setStats(data)),
      api.get("/meta/leads", { params: { status: "FILE", page_size: 200 } }).then(({ data }) => setFiles(data.items || data.leads || [])),
    ]).finally(() => setLoading(false));
  }, []);

  const filtered = files.filter((f) => {
    const okS = statusFilter === "ALL" || (f.processing_status || "New") === statusFilter;
    const okQ = !q || `${f.full_name || ""} ${f.phone || ""} ${f.file?.loan_type || ""}`.toLowerCase().includes(q.toLowerCase());
    const okMine = !myOnly || f.assigned_processor_id === meta.user_id;
    return okS && okQ && okMine;
  });

  return (
    <div data-testid="meta-files">
      <header className="h-16 border-b border-slate-200 bg-white px-4 md:px-8 flex items-center gap-2 sticky top-0 z-30">
        <FolderOpen size={20} className="text-violet-600" />
        <h1 className="text-xl font-bold" style={{ color: BRAND_DARK }}>Files &amp; Conversions</h1>
      </header>
      <div className="p-4 md:p-8">
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
          <StatCard label="Total Files" value={stats?.total_files ?? "—"} icon={FolderOpen} accent="bg-violet-50 text-violet-600" testid="meta-files-total" />
          <StatCard label="Docs Received" value={stats?.docs_received ?? "—"} icon={FileCheck2} accent="bg-emerald-50 text-emerald-600" testid="meta-files-received" />
          <StatCard label="Docs Pending" value={stats?.pending_docs ?? "—"} icon={FileClock} accent="bg-amber-50 text-amber-600" testid="meta-files-pending" />
        </div>
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <div className="relative flex-1 min-w-[220px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input data-testid="meta-files-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, phone, loan type..." className="w-full border border-slate-300 rounded-md pl-9 pr-3 py-2 text-sm outline-none bg-white" />
          </div>
          <select data-testid="meta-files-status-filter" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-full sm:w-auto border border-slate-300 rounded-md px-3 py-2 text-sm bg-white outline-none">
            <option value="ALL">All Statuses</option>
            {PROC_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          {canFilterMine && (
            <button
              data-testid="meta-files-my-toggle"
              onClick={() => setMyOnly((v) => !v)}
              className={`w-full sm:w-auto justify-center flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium border transition-colors ${myOnly ? "text-white border-transparent" : "bg-white text-slate-600 border-slate-300 hover:bg-slate-50"}`}
              style={myOnly ? { background: BRAND } : {}}
            >
              <UserCheck size={15} /> My Files
            </button>
          )}
        </div>
        <div className="bg-white border border-slate-200 rounded-md shadow-sm overflow-hidden" data-testid="meta-files-list">
          {loading ? <p className="py-16 text-center text-slate-400 text-sm">Loading files...</p>
            : filtered.length === 0 ? <p className="py-16 text-center text-slate-400 text-sm">No files match your filters.</p>
            : filtered.map((f) => <FileRow key={f.lead_id} f={f} onOpen={() => navigate(`/meta/files/${f.lead_id}`)} />)}
        </div>
      </div>
    </div>
  );
}
