import React, { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import api from "../../services/api";
import { PROC_STATUSES, inr, maskPhone, BRAND, BRAND_DARK, useMetaUser } from "./metaCommon";
import MultiSelectDropdown from "../../components/MultiSelectDropdown";
import SearchableSelect from "../../components/SearchableSelect";
import { FolderOpen, FileCheck2, FileClock, Eye, EyeOff, ChevronRight, ChevronLeft, Search, UserCheck, X } from "lucide-react";

const GREEN = new Set(["Approved", "Disbursed", "Login Done", "Documents Collected"]);
const RED = new Set(["Declined", "Not Eligible", "Not Login", "Not Disbursed", "FI Negative"]);
const AMBER = new Set(["Query/Hold", "Documents Pending", "FI Reinitiated", "Underwriting", "Customer Not Interested - Need Help from MIT & Manager", "Customer Not Supporting - Need Help from MIT & Manager"]);
const BLUE = new Set(["Sent for Eligibility", "Sent for Login", "Sent for Approval", "Contacted", "FI (Field Investigation)"]);
const STATUS_COLOR = (s) => GREEN.has(s) ? "bg-emerald-50 text-emerald-700 border-emerald-200"
  : RED.has(s) ? "bg-red-50 text-red-700 border-red-200"
  : AMBER.has(s) ? "bg-amber-50 text-amber-700 border-amber-200"
  : BLUE.has(s) ? "bg-blue-50 text-blue-700 border-blue-200"
  : "bg-slate-100 text-slate-600 border-slate-200";

const PAGE_SIZES = [25, 50, 100];
const DOC_OPTS = [{ value: "", label: "All Docs" }, { value: "received", label: "Docs Received" }, { value: "pending", label: "Docs Pending" }];
const ASSIGN_OPTS = [{ value: "", label: "All Assignment" }, { value: "assigned", label: "Assigned" }, { value: "unassigned", label: "Unassigned" }];
const SOURCE_OPTS = [{ value: "", label: "All Sources" }, { value: "META", label: "Meta" }, { value: "WEBSITE", label: "Website" }, { value: "MANUAL", label: "Manual Entry" }];

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
  const isStaff = ["admin", "ops"].includes(meta.role);
  const canFilterMine = ["processor", "admin", "ops"].includes(meta.role);

  const [searchParams, setSearchParams] = useSearchParams();
  const sp = (k, d = "") => searchParams.get(k) ?? d;

  const [stats, setStats] = useState(null);
  const [files, setFiles] = useState([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);

  const [q, setQ] = useState(() => sp("q"));
  const [statusFilter, setStatusFilter] = useState(() => sp("status", "ALL")); // processing_status
  const [processor, setProcessor] = useState(() => sp("proc"));
  const [growthPartner, setGrowthPartner] = useState(() => sp("gp"));
  const [loanType, setLoanType] = useState(() => sp("loan"));
  const [bank, setBank] = useState(() => sp("bank"));
  const [docs, setDocs] = useState(() => sp("docs"));
  const [assignment, setAssignment] = useState(() => sp("asg"));
  const [source, setSource] = useState(() => sp("source"));
  const [fileFrom, setFileFrom] = useState(() => sp("from"));
  const [fileTo, setFileTo] = useState(() => sp("to"));
  const [myOnly, setMyOnly] = useState(() => sp("mine", meta.role === "processor" ? "1" : "") === "1");
  const [page, setPage] = useState(() => parseInt(sp("page", "1"), 10) || 1);
  const [pageSize, setPageSize] = useState(() => parseInt(sp("size", "25"), 10) || 25);
  const [pageInput, setPageInput] = useState("");

  // Option lists
  const [procOpts, setProcOpts] = useState([]);
  const [gpOpts, setGpOpts] = useState([]);
  const [loanOpts, setLoanOpts] = useState([]);
  const [bankOpts, setBankOpts] = useState([]);

  // Load stats + role-scoped filter option lists once.
  useEffect(() => {
    api.get("/meta/files/stats").then(({ data }) => setStats(data)).catch(() => {});
    api.get("/meta/files/filter-options").then(({ data }) => {
      setLoanOpts((data.loan_types || []).map((v) => ({ value: v, label: v })));
      setBankOpts((data.banks || []).map((v) => ({ value: v, label: v })));
    }).catch(() => {});
    if (isStaff) {
      api.get("/meta/processors").then(({ data }) => setProcOpts((data || []).map((p) => ({ value: p.user_id, label: p.name })))).catch(() => {});
      api.get("/meta/partners").then(({ data }) => setGpOpts((data || []).map((p) => ({ value: p.user_id, label: p.name })))).catch(() => {});
    }
  }, [isStaff]);

  const fetchFiles = useCallback((p = page, size = pageSize) => {
    setLoading(true);
    const params = { status: "FILE", page: p, page_size: size, sort_by: "file_created_at", sort_dir: "desc" };
    if (q) params.q = q;
    if (statusFilter && statusFilter !== "ALL") params.processing_status = statusFilter;
    if (loanType) params.loan_type = loanType;
    if (bank) params.bank = bank;
    if (docs) params.docs = docs;
    if (source) params.source = source;
    if (fileFrom) params.file_from = fileFrom;
    if (fileTo) params.file_to = fileTo;
    if (isStaff) {
      if (myOnly) params.processor = meta.user_id;       // "My Files" overrides processor filter
      else if (processor) params.processor = processor;
      if (growthPartner) params.partner = growthPartner;
      if (assignment) params.assignment = assignment;
    }
    api.get("/meta/leads", { params }).then(({ data }) => {
      setFiles(data.items || data.leads || []);
      setTotal(data.total || 0);
      setPages(data.pages || 1);
      setPage(data.page || 1);
    }).catch(() => { setFiles([]); setTotal(0); setPages(1); }).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, statusFilter, loanType, bank, docs, source, fileFrom, fileTo, myOnly, processor, growthPartner, assignment, isStaff, meta.user_id, pageSize]);

  // Reset to page 1 when any filter changes. Signature compare keeps the restored page on
  // first load and survives React StrictMode's dev double-invoke.
  const filterSig = JSON.stringify([q, statusFilter, loanType, bank, docs, source, fileFrom, fileTo, myOnly, processor, growthPartner, assignment]);
  const prevSig = useRef(null);
  useEffect(() => {
    if (prevSig.current === null || prevSig.current === filterSig) {
      prevSig.current = filterSig;
      fetchFiles(page, pageSize);
      return;
    }
    prevSig.current = filterSig;
    setPage(1);
    fetchFiles(1, pageSize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterSig]);

  // Mirror state into URL for refresh / back / return-from-detail persistence.
  useEffect(() => {
    const p = {};
    if (q) p.q = q;
    if (statusFilter && statusFilter !== "ALL") p.status = statusFilter;
    if (processor) p.proc = processor;
    if (growthPartner) p.gp = growthPartner;
    if (loanType) p.loan = loanType;
    if (bank) p.bank = bank;
    if (docs) p.docs = docs;
    if (assignment) p.asg = assignment;
    if (source) p.source = source;
    if (fileFrom) p.from = fileFrom;
    if (fileTo) p.to = fileTo;
    if (myOnly) p.mine = "1";
    if (page > 1) p.page = String(page);
    if (pageSize !== 25) p.size = String(pageSize);
    setSearchParams(p, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, statusFilter, processor, growthPartner, loanType, bank, docs, assignment, source, fileFrom, fileTo, myOnly, page, pageSize]);

  const goToPage = (p) => { const np = Math.min(Math.max(1, p), pages); setPage(np); fetchFiles(np, pageSize); };
  const changeSize = (s) => { setPageSize(s); setPage(1); fetchFiles(1, s); };

  const activeCount =
    [q, loanType, bank, docs, source, fileFrom, fileTo, processor, growthPartner, assignment].filter(Boolean).length +
    (statusFilter && statusFilter !== "ALL" ? 1 : 0) + (myOnly ? 1 : 0);

  const clearAll = () => {
    setQ(""); setStatusFilter("ALL"); setProcessor(""); setGrowthPartner(""); setLoanType("");
    setBank(""); setDocs(""); setAssignment(""); setSource(""); setFileFrom(""); setFileTo("");
    setMyOnly(false);
  };

  const rangeFrom = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeTo = Math.min(page * pageSize, total);

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

        {/* Primary row: search / status / my files */}
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input data-testid="meta-files-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, phone, email..." className="w-full border border-slate-300 rounded-md pl-9 pr-3 py-2 text-sm outline-none bg-white" />
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

        {/* Advanced filters */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 mb-3" data-testid="meta-files-advanced-filters">
          <SearchableSelect testId="meta-files-loan-type" placeholder="Requested Loan Type" options={loanOpts} value={loanType} onChange={setLoanType} />
          <SearchableSelect testId="meta-files-bank" placeholder="Bank / Lender" options={bankOpts} value={bank} onChange={setBank} />
          <select data-testid="meta-files-docs" value={docs} onChange={(e) => setDocs(e.target.value)} className="border border-slate-300 rounded-md px-3 py-2 text-sm bg-white outline-none">
            {DOC_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select data-testid="meta-files-source" value={source} onChange={(e) => setSource(e.target.value)} className="border border-slate-300 rounded-md px-3 py-2 text-sm bg-white outline-none">
            {SOURCE_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {isStaff && (
            <>
              <SearchableSelect testId="meta-files-processor" placeholder="Processor" options={[{ value: "UNASSIGNED", label: "Unassigned" }, ...procOpts]} value={processor} onChange={setProcessor} />
              <SearchableSelect testId="meta-files-gp" placeholder="Growth Partner" options={[{ value: "UNASSIGNED", label: "Unassigned" }, ...gpOpts]} value={growthPartner} onChange={setGrowthPartner} />
              <select data-testid="meta-files-assignment" value={assignment} onChange={(e) => setAssignment(e.target.value)} className="border border-slate-300 rounded-md px-3 py-2 text-sm bg-white outline-none">
                {ASSIGN_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </>
          )}
          <div className="flex items-center gap-1">
            <label className="text-xs text-slate-500 whitespace-nowrap">Created</label>
            <input type="date" data-testid="meta-files-date-from" value={fileFrom} onChange={(e) => setFileFrom(e.target.value)} className="border border-slate-300 rounded-md px-2 py-2 text-xs bg-white outline-none w-full" />
            <input type="date" data-testid="meta-files-date-to" value={fileTo} onChange={(e) => setFileTo(e.target.value)} className="border border-slate-300 rounded-md px-2 py-2 text-xs bg-white outline-none w-full" />
          </div>
        </div>

        {activeCount > 0 && (
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs text-slate-500">{activeCount} filter{activeCount > 1 ? "s" : ""} applied</span>
            <button onClick={clearAll} data-testid="meta-files-clear" className="flex items-center gap-1 text-xs font-medium text-red-600 hover:text-red-700">
              <X size={13} /> Clear Filters
            </button>
          </div>
        )}

        <div className="bg-white border border-slate-200 rounded-md shadow-sm overflow-hidden" data-testid="meta-files-list">
          {loading ? <p className="py-16 text-center text-slate-400 text-sm">Loading files...</p>
            : files.length === 0 ? <p className="py-16 text-center text-slate-400 text-sm">No files match your filters.</p>
            : files.map((f) => <FileRow key={f.lead_id} f={f} onOpen={() => navigate(`/meta/files/${f.lead_id}`)} />)}
        </div>

        {/* Pagination */}
        {!loading && total > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 mt-4" data-testid="meta-files-pagination">
            <div className="flex items-center gap-3 text-sm text-slate-500">
              <span data-testid="meta-files-range">Showing {rangeFrom}–{rangeTo} of {total}</span>
              <select data-testid="meta-files-page-size" value={pageSize} onChange={(e) => changeSize(parseInt(e.target.value, 10))} className="border border-slate-300 rounded-md px-2 py-1 text-sm bg-white outline-none">
                {PAGE_SIZES.map((s) => <option key={s} value={s}>{s} / page</option>)}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <button data-testid="meta-files-prev" onClick={() => goToPage(page - 1)} disabled={page <= 1} className="flex items-center gap-1 px-3 py-1.5 text-sm border border-slate-300 rounded-md bg-white disabled:opacity-40 hover:bg-slate-50">
                <ChevronLeft size={15} /> Prev
              </button>
              <span className="text-sm text-slate-600">Page {page} of {pages}</span>
              <button data-testid="meta-files-next" onClick={() => goToPage(page + 1)} disabled={page >= pages} className="flex items-center gap-1 px-3 py-1.5 text-sm border border-slate-300 rounded-md bg-white disabled:opacity-40 hover:bg-slate-50">
                Next <ChevronRight size={15} />
              </button>
              <form onSubmit={(e) => { e.preventDefault(); const n = parseInt(pageInput, 10); if (n) goToPage(n); setPageInput(""); }} className="flex items-center gap-1">
                <input data-testid="meta-files-goto-input" value={pageInput} onChange={(e) => setPageInput(e.target.value)} placeholder="Go to" className="w-16 border border-slate-300 rounded-md px-2 py-1.5 text-sm outline-none" />
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
