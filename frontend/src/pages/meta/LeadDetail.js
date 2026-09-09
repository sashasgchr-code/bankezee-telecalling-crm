import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import api from "../../services/api";
import { toast } from "sonner";
import { useMetaUser, StatusPill, STATUS_LABEL, LEAD_STATUSES, PROC_STATUSES, fmtDur, BRAND, BRAND_DARK } from "./metaCommon";
import MetaCallModal from "./MetaCallModal";
import { openMetaWhatsApp } from "../../utils/whatsapp";
import { ArrowLeft, Phone, PhoneCall, Mail, MapPin, Briefcase, Wallet, Megaphone, Send, MessageSquare, MessageCircle, Activity, UserCog, FolderOpen, Plus, Trash2, Save, Clock, Upload, Download, FileText } from "lucide-react";

const InfoRow = ({ icon: Icon, label, value }) => (
  <div className="flex items-start gap-3 py-2">
    <Icon size={16} className="text-slate-400 mt-0.5 shrink-0" />
    <div className="min-w-0"><p className="text-xs text-slate-400 uppercase tracking-wider">{label}</p><p className="text-sm text-slate-800 break-words">{value || "—"}</p></div>
  </div>
);

const F = ({ label, value, onChange, type = "text", placeholder, disabled }) => (
  <div>
    <label className="text-xs font-medium text-slate-500">{label}</label>
    <input type={type} value={value || ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} disabled={disabled}
      className="mt-1 w-full border border-slate-300 rounded-md px-3 py-2 text-sm outline-none disabled:bg-slate-50 disabled:text-slate-500" />
  </div>
);
const Sel = ({ label, value, onChange, options, disabled }) => (
  <div>
    <label className="text-xs font-medium text-slate-500">{label}</label>
    <select value={value || ""} onChange={(e) => onChange(e.target.value)} disabled={disabled}
      className="mt-1 w-full border border-slate-300 rounded-md px-3 py-2 text-sm bg-white outline-none disabled:bg-slate-50 disabled:text-slate-500">
      <option value="">Select</option>{options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  </div>
);
const Section = ({ title, children }) => (
  <div className="mt-3 pt-3 border-t border-slate-100">
    <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wider mb-2">{title}</p>
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{children}</div>
  </div>
);

function FileStatusModal({ onClose, onConfirm }) {
  const [docs, setDocs] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (!docs) { toast.error("Please select whether documents are received"); return; }
    setSaving(true);
    try { await onConfirm(docs === "yes"); } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); } finally { setSaving(false); }
  };
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()} data-testid="meta-file-status-modal">
        <div className="flex items-center gap-3 mb-4">
          <div className="h-10 w-10 rounded-full bg-violet-50 text-violet-600 flex items-center justify-center"><FolderOpen size={20} /></div>
          <div><p className="text-sm font-semibold" style={{ color: BRAND_DARK }}>Convert to File</p><p className="text-xs text-slate-500">Confirm document status</p></div>
        </div>
        <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">Documents Received?</label>
        <select data-testid="meta-file-docs-select" value={docs} onChange={(e) => setDocs(e.target.value)} className="mt-1 mb-4 w-full border border-slate-300 rounded-md px-3 py-2 text-sm bg-white outline-none">
          <option value="">Select...</option><option value="yes">Yes</option><option value="no">No</option>
        </select>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-md px-4 py-2 text-sm font-medium transition-colors">Cancel</button>
          <button data-testid="meta-file-status-confirm-btn" disabled={saving} onClick={submit} className="text-white rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:opacity-60" style={{ background: BRAND }}>Convert to File</button>
        </div>
      </div>
    </div>
  );
}

function FileCard({ lead, onSave, canEditInfo, canEditBanks, canStatus, onUpdateStatus }) {
  const [f, setF] = useState(lead.file || {});
  const [banks, setBanks] = useState(lead.file?.banks || []);
  const [saving, setSaving] = useState(false);
  const [pstatus, setPstatus] = useState(lead.processing_status || "");
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const d = !canEditInfo;
  const bd = !canEditBanks;
  const canSave = canEditInfo || canEditBanks;
  const set = (k) => (v) => setF({ ...f, [k]: v });
  const setBank = (i, k, v) => {
    const b = [...banks]; b[i] = { ...b[i], [k]: v };
    if (k === "commission_pct" || k === "disbursed_amount" || k === "approved_amount") {
      const base = Number(b[i].disbursed_amount || b[i].approved_amount || 0);
      const pct = Number(b[i].commission_pct || 0);
      b[i].commission_amount = base && pct ? Math.round(base * pct) / 100 : b[i].commission_amount;
    }
    setBanks(b);
  };
  const save = async () => { setSaving(true); try { await onSave({ ...f, banks }); } catch (e) {} finally { setSaving(false); } };

  return (
    <div className="bg-white border border-violet-200 rounded-md p-5 shadow-sm" data-testid="meta-file-card">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-violet-700 flex items-center gap-2"><FolderOpen size={16} /> Loan File Details</h3>
        {canSave ? <button data-testid="meta-save-file-btn" onClick={save} disabled={saving} className="text-white rounded-md px-3 py-1.5 text-sm font-medium transition-colors flex items-center gap-1 disabled:opacity-60" style={{ background: BRAND }}><Save size={14} /> Save</button>
          : <span className="text-xs text-slate-400 italic">View only</span>}
      </div>
      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Customer Details</p>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-3 text-sm">
        <div><p className="text-xs text-slate-400">Full Name</p><p className="text-slate-800 font-medium">{lead.full_name || "—"}</p></div>
        <div><p className="text-xs text-slate-400">Mobile</p><p className="text-slate-800">{lead.phone || "—"}</p></div>
        <div><p className="text-xs text-slate-400">Email</p><p className="text-slate-800 truncate">{lead.email || "—"}</p></div>
      </div>
      <div className="grid grid-cols-2 gap-3 mb-4">
        <F label="Mother's Name" value={f.mother_name} onChange={set("mother_name")} disabled={d} />
        <F label="Current Address" value={f.current_address} onChange={set("current_address")} disabled={d} />
      </div>
      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Employment Details</p>
      <div className="grid grid-cols-2 gap-3 mb-4">
        <F label="Employment Type" value={f.employment_type} onChange={set("employment_type")} disabled={d} />
        <F label="Company Name" value={f.company_name} onChange={set("company_name")} disabled={d} />
        <F label="Net Salary (₹)" value={f.net_salary} onChange={set("net_salary")} type="number" disabled={d} />
        <F label="Office Address" value={f.office_address} onChange={set("office_address")} disabled={d} />
      </div>
      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Loan Requirements</p>
      <div className="grid grid-cols-2 gap-3 mb-4">
        <F label="Type of Loan" value={f.loan_type} onChange={set("loan_type")} disabled={d} />
        <F label="CIBIL Score" value={f.cibil} onChange={set("cibil")} type="number" disabled={d} />
        <F label="Loan Amount Required (₹)" value={f.loan_amount} onChange={set("loan_amount")} type="number" disabled={d} />
        <F label="Tenure Required (months)" value={f.tenure} onChange={set("tenure")} type="number" disabled={d} />
      </div>
      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Existing Loans &amp; Obligations</p>
      <div className="grid grid-cols-2 gap-3 mb-4">
        <F label="Monthly EMI Obligations (₹)" value={f.monthly_emi} onChange={set("monthly_emi")} disabled={d} />
        <F label="Existing Loan 1" value={f.existing_loan_1} onChange={set("existing_loan_1")} disabled={d} />
        <F label="Existing Loan 2" value={f.existing_loan_2} onChange={set("existing_loan_2")} disabled={d} />
        <F label="Existing Loan 3" value={f.existing_loan_3} onChange={set("existing_loan_3")} disabled={d} />
      </div>
      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Lead Source &amp; Status</p>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4 text-sm">
        <div><p className="text-xs text-slate-400">Source Type</p><p className="text-slate-800">{lead.platform || "Agent"}</p></div>
        <div><p className="text-xs text-slate-400">Growth Partner</p><p className="text-slate-800">{lead.assigned_partner_name || "—"}</p></div>
        <div><p className="text-xs text-slate-400">Current Status</p><p className="text-slate-800">{(lead.status || "").replace(/_/g, " ")}</p></div>
        <div><p className="text-xs text-slate-400">Created</p><p className="text-slate-800">{new Date(lead.file_created_at || lead.created_at).toLocaleDateString()}</p></div>
      </div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Bank Eligibilities ({banks.length})</p>
        {canEditBanks && <button data-testid="meta-add-bank-btn" onClick={() => setBanks([...banks, {}])} className="text-xs hover:underline flex items-center gap-1" style={{ color: BRAND }}><Plus size={12} /> Add Bank</button>}
      </div>
      <div className="space-y-4">
        {banks.map((b, i) => (
          <div key={i} className="border border-slate-200 rounded-md p-3 relative" data-testid={`meta-bank-row-${i}`}>
            {canEditBanks && <button onClick={() => setBanks(banks.filter((_, j) => j !== i))} className="absolute top-2 right-2 text-red-400 hover:text-red-600"><Trash2 size={14} /></button>}
            <p className="text-xs font-semibold text-emerald-700 mb-2">Bank #{i + 1}</p>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <F label="Bank Name" value={b.bank_name} onChange={(v) => setBank(i, "bank_name", v)} disabled={bd} />
              <Sel label="Eligible?" value={b.eligible} onChange={(v) => setBank(i, "eligible", v)} options={["Yes", "No"]} disabled={bd} />
              {b.eligible === "No" && <F label="Reason (Not Eligible)" value={b.ineligible_reason} onChange={(v) => setBank(i, "ineligible_reason", v)} disabled={bd} />}
              {b.eligible === "Yes" && <>
                <F label="Eligible Amount (₹)" value={b.eligible_amount} onChange={(v) => setBank(i, "eligible_amount", v)} type="number" disabled={bd} />
                <F label="ROI (%)" value={b.roi} onChange={(v) => setBank(i, "roi", v)} type="number" disabled={bd} />
              </>}
            </div>
            {b.eligible === "Yes" && (
              <Section title="Login Status">
                <Sel label="Login Done?" value={b.login_done} onChange={(v) => setBank(i, "login_done", v)} options={["Yes", "No"]} disabled={bd} />
                {b.login_done === "No" && <F label="Reason (No Login)" value={b.login_reason} onChange={(v) => setBank(i, "login_reason", v)} disabled={bd} />}
                {b.login_done === "Yes" && <>
                  <F label="Login Bank" value={b.login_bank} onChange={(v) => setBank(i, "login_bank", v)} disabled={bd} />
                  <F label="Application ID" value={b.application_id} onChange={(v) => setBank(i, "application_id", v)} disabled={bd} />
                  <F label="SM Name" value={b.sm_name} onChange={(v) => setBank(i, "sm_name", v)} disabled={bd} />
                  <F label="SM Number" value={b.sm_number} onChange={(v) => setBank(i, "sm_number", v)} disabled={bd} />
                </>}
              </Section>
            )}
            {b.eligible === "Yes" && b.login_done === "Yes" && (
              <Section title="Approval Status">
                <Sel label="Status" value={b.approval_status} onChange={(v) => setBank(i, "approval_status", v)} options={["Pending", "Approved", "Rejected"]} disabled={bd} />
                {b.approval_status === "Approved" && <>
                  <F label="Approved Bank" value={b.approved_bank} onChange={(v) => setBank(i, "approved_bank", v)} disabled={bd} />
                  <F label="Approved Amount (₹)" value={b.approved_amount} onChange={(v) => setBank(i, "approved_amount", v)} type="number" disabled={bd} />
                  <F label="Tenure (months)" value={b.approval_tenure} onChange={(v) => setBank(i, "approval_tenure", v)} type="number" disabled={bd} />
                  <F label="ROI (%)" value={b.approval_roi} onChange={(v) => setBank(i, "approval_roi", v)} type="number" disabled={bd} />
                </>}
              </Section>
            )}
            {b.approval_status === "Approved" && (
              <Section title="Disbursement">
                <Sel label="Disbursed?" value={b.disbursed} onChange={(v) => setBank(i, "disbursed", v)} options={["Yes", "No"]} disabled={bd} />
                {b.disbursed === "Yes" && <>
                  <F label="Disbursal Date" value={b.disbursal_date} onChange={(v) => setBank(i, "disbursal_date", v)} type="date" disabled={bd} />
                  <F label="Disbursed Bank" value={b.disbursed_bank} onChange={(v) => setBank(i, "disbursed_bank", v)} disabled={bd} />
                  <F label="Disbursed Amount (₹)" value={b.disbursed_amount} onChange={(v) => setBank(i, "disbursed_amount", v)} type="number" disabled={bd} />
                  <F label="Commission %" value={b.commission_pct} onChange={(v) => setBank(i, "commission_pct", v)} type="number" disabled={bd} />
                  <div>
                    <label className="text-xs font-medium text-slate-500">Commission Amount</label>
                    <p className="mt-1 text-lg font-semibold text-emerald-600" data-testid={`meta-commission-${i}`}>₹{Number(b.commission_amount || 0).toLocaleString("en-IN")}</p>
                  </div>
                </>}
              </Section>
            )}
          </div>
        ))}
        {banks.length === 0 && <p className="text-sm text-slate-400">No banks added yet.</p>}
      </div>

      <div className="mt-5 pt-4 border-t border-slate-200">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">File Processing Status</p>
        {lead.processing_status && <p className="text-sm text-slate-700 mb-2">Current: <span className="font-medium" style={{ color: BRAND_DARK }}>{lead.processing_status}</span></p>}
        {canStatus ? (
          <div className="flex flex-wrap items-center gap-2">
            <select data-testid="meta-processing-status-select" value={pstatus} onChange={(e) => setPstatus(e.target.value)} className="flex-1 min-w-[220px] border border-slate-300 rounded-md px-3 py-2 text-sm bg-white outline-none">
              <option value="">Select status...</option>{PROC_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <button data-testid="meta-update-status-btn" disabled={updatingStatus || !pstatus} onClick={async () => { setUpdatingStatus(true); try { await onUpdateStatus(pstatus); } finally { setUpdatingStatus(false); } }}
              className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:opacity-60">Update Status</button>
          </div>
        ) : <p className="text-sm text-slate-500">{lead.processing_status || "Not set"}</p>}
      </div>
    </div>
  );
}

function DocumentsCard({ lead, reload }) {
  const [uploading, setUploading] = useState(false);
  const docs = lead.documents || [];
  const onUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setUploading(true);
    try {
      for (const file of files) {
        const fd = new FormData(); fd.append("file", file);
        await api.post(`/meta/leads/${lead.lead_id}/documents`, fd, { headers: { "Content-Type": "multipart/form-data" } });
      }
      toast.success("Uploaded"); reload();
    } catch (err) { toast.error(err?.response?.data?.detail || "Upload failed"); }
    finally { setUploading(false); e.target.value = ""; }
  };
  const download = async (docItem) => {
    try {
      const res = await api.get(`/meta/leads/${lead.lead_id}/documents/${docItem.doc_id}`, { responseType: "blob" });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a"); a.href = url; a.download = docItem.filename; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (e) { toast.error(e?.response?.data?.detail || "Download failed"); }
  };
  const del = async (docItem) => {
    try { await api.delete(`/meta/leads/${lead.lead_id}/documents/${docItem.doc_id}`); toast.success("Deleted"); reload(); }
    catch (e) { toast.error("Delete failed"); }
  };
  const downloadZip = async () => {
    try {
      const res = await api.get(`/meta/leads/${lead.lead_id}/documents/zip`, { responseType: "blob" });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a"); a.href = url; a.download = "documents.zip"; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (e) { toast.error("Download failed"); }
  };
  return (
    <div className="bg-white border border-slate-200 rounded-md p-5 shadow-sm" data-testid="meta-documents-card">
      <h3 className="text-sm font-semibold flex items-center gap-2 mb-3" style={{ color: BRAND_DARK }}><FileText size={16} /> Documents ({docs.length})</h3>
      {docs.length > 0 && <button data-testid="meta-download-zip-btn" onClick={downloadZip} className="mb-3 inline-flex items-center gap-1 border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-md px-3 py-1.5 text-xs font-medium transition-colors"><Download size={13} /> Download All ZIP</button>}
      <div className="space-y-2 mb-4" data-testid="meta-documents-list">
        {docs.length === 0 && <p className="text-sm text-slate-400">No documents uploaded yet.</p>}
        {docs.map((docItem) => (
          <div key={docItem.doc_id} className="flex items-center justify-between border border-slate-100 rounded-md px-3 py-2 bg-slate-50/50" data-testid={`meta-doc-${docItem.doc_id}`}>
            <div className="min-w-0">
              <p className="text-sm text-slate-800 truncate">{docItem.filename}{!docItem.storage_key && <span className="ml-2 text-[10px] text-amber-600">(migration pending)</span>}</p>
              <p className="text-xs text-slate-400">{((docItem.size || 0) / 1024).toFixed(1)}KB · {docItem.uploaded_by}</p>
            </div>
            <div className="flex items-center gap-3 shrink-0 pl-3">
              <button data-testid={`meta-doc-download-${docItem.doc_id}`} onClick={() => download(docItem)} className="text-slate-400 hover:text-slate-700 transition-colors"><Download size={16} /></button>
              <button data-testid={`meta-doc-delete-${docItem.doc_id}`} onClick={() => del(docItem)} className="text-red-400 hover:text-red-600 transition-colors"><Trash2 size={16} /></button>
            </div>
          </div>
        ))}
      </div>
      <label data-testid="meta-upload-docs-label" className="flex items-center justify-center gap-2 border-2 border-dashed border-slate-300 rounded-md py-3 text-sm text-slate-500 hover:text-slate-700 cursor-pointer transition-colors">
        <Upload size={16} /> {uploading ? "Uploading..." : "Upload Documents"}
        <input type="file" multiple accept=".pdf,.png,.jpg,.jpeg" className="hidden" onChange={onUpload} data-testid="meta-upload-docs-input" disabled={uploading} />
      </label>
      <p className="text-xs text-slate-400 mt-2">PDF, PNG, JPG (max 10MB each)</p>
    </div>
  );
}

export default function MetaLeadDetail() {
  const { leadId } = useParams();
  const navigate = useNavigate();
  const meta = useMetaUser();
  const [lead, setLead] = useState(null);
  const [partners, setPartners] = useState([]);
  const [processors, setProcessors] = useState([]);
  const [note, setNote] = useState("");
  const [callOpen, setCallOpen] = useState(false);
  const [fileModal, setFileModal] = useState(false);
  const isStaffLike = ["admin", "ops", "processor"].includes(meta.role);

  const load = async () => {
    try { const { data } = await api.get(`/meta/leads/${leadId}`); setLead(data); }
    catch (e) { toast.error("Lead not found"); navigate("/meta/leads"); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [leadId]);
  useEffect(() => { if (meta.isAdmin) api.get("/meta/partners").then(({ data }) => setPartners(data)).catch(() => {}); }, [meta.isAdmin]);
  useEffect(() => { if (isStaffLike) api.get("/meta/processors").then(({ data }) => setProcessors(data)).catch(() => {}); }, [isStaffLike]);

  const assignProcessor = async (pid) => { const { data } = await api.patch(`/meta/leads/${leadId}/processor`, { processor_id: pid || null }); setLead(data); toast.success("Processor updated"); };
  const changeStatus = async (status, docs_received) => { const { data } = await api.patch(`/meta/leads/${leadId}/status`, { status, docs_received }); setLead(data); toast.success(`Status → ${STATUS_LABEL(status)}`); };
  const assign = async (pid) => { const { data } = await api.patch(`/meta/leads/${leadId}/assign`, { partner_id: pid || null }); setLead(data); toast.success("Assignment updated"); };
  const addNote = async () => { if (!note.trim()) return; const { data } = await api.post(`/meta/leads/${leadId}/notes`, { text: note }); setLead(data); setNote(""); toast.success("Note added"); };
  const logCall = async (payload) => { const { data } = await api.post(`/meta/leads/${leadId}/calls`, payload); setLead(data); toast.success("Call logged"); };
  const saveFile = async (fdata) => { const { data } = await api.patch(`/meta/leads/${leadId}/file`, { data: fdata }); setLead(data); toast.success("File details saved"); };
  const updateProcessingStatus = async (status) => { const { data } = await api.patch(`/meta/leads/${leadId}/processing-status`, { status }); setLead(data); toast.success("Processing status updated"); };

  if (!lead) return <div className="p-8"><div className="h-8 w-8 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: BRAND, borderTopColor: "transparent" }} /></div>;

  const isAssignedPartner = meta.role === "growth_partner" && lead.assigned_partner_id === meta.user_id;
  const isAssignedProcessor = meta.role === "processor" && lead.assigned_processor_id === meta.user_id;
  const canEditInfo = meta.role === "admin" || meta.role === "ops" || isAssignedPartner || isAssignedProcessor;
  const canEditBanks = meta.role === "admin" || isAssignedProcessor;
  const timeline = [...(lead.activities || [])].reverse();
  const calls = [...(lead.call_logs || [])].reverse();
  const canSeeDocs = meta.role === "admin" || meta.role === "ops" || isAssignedPartner || isAssignedProcessor;

  return (
    <div data-testid="meta-lead-detail">
      <header className="h-16 border-b border-slate-200 bg-white px-4 md:px-8 flex items-center gap-3 sticky top-0 z-30">
        <button data-testid="meta-back-btn" onClick={() => navigate("/meta/leads")} className="text-slate-500 hover:text-slate-800 transition-colors"><ArrowLeft size={20} /></button>
        <h1 className="text-xl font-bold" style={{ color: BRAND_DARK }}>{lead.full_name || "Lead"}</h1>
        <StatusPill status={lead.status} />
        <a data-testid="meta-call-btn" href={`tel:${lead.phone}`} onClick={() => setCallOpen(true)} className="ml-auto bg-emerald-600 hover:bg-emerald-700 text-white rounded-md px-4 py-2 text-sm font-medium transition-colors flex items-center gap-2"><Phone size={16} /> Call</a>
        <button data-testid="meta-wa-btn" type="button" onClick={() => openMetaWhatsApp(lead.phone, lead.full_name, lead.file?.loan_type || lead.loan_type || "loan requirement", meta.name)} className="bg-green-500 hover:bg-green-600 text-white rounded-md px-4 py-2 text-sm font-medium transition-colors flex items-center gap-2"><MessageCircle size={16} /> WhatsApp</button>
      </header>

      <div className="p-4 md:p-8 grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 space-y-6">
          <div className="bg-white border border-slate-200 rounded-md p-5 shadow-sm">
            <h3 className="text-sm font-semibold mb-2" style={{ color: BRAND_DARK }}>Lead Information</h3>
            <div className="divide-y divide-slate-50">
              <div className="flex items-start gap-3 py-2">
                <Phone size={16} className="text-slate-400 mt-0.5 shrink-0" />
                <div><p className="text-xs text-slate-400 uppercase tracking-wider">Phone</p><a data-testid="meta-phone-dial-link" href={`tel:${lead.phone}`} onClick={() => setCallOpen(true)} className="text-sm font-medium hover:underline" style={{ color: BRAND }}>{lead.phone || "—"}</a></div>
              </div>
              <InfoRow icon={Mail} label="Email" value={lead.email} />
              <InfoRow icon={MapPin} label="City" value={lead.city} />
              <InfoRow icon={Briefcase} label="Employment" value={lead.employment_status} />
              <InfoRow icon={Wallet} label="Monthly Salary" value={lead.monthly_salary} />
              <InfoRow icon={Wallet} label="Outstanding Amount" value={lead.outstanding_amount} />
              <InfoRow icon={Megaphone} label="Campaign" value={lead.campaign_name} />
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-md p-5 shadow-sm">
            <h3 className="text-sm font-semibold mb-3" style={{ color: BRAND_DARK }}>Status</h3>
            <div className="flex flex-wrap gap-1.5 mb-4">
              {LEAD_STATUSES.map((s) => (
                <button key={s} data-testid={`meta-set-status-${s}`} onClick={() => { if (s === "FILE" && lead.status !== "FILE") setFileModal(true); else changeStatus(s); }}
                  className={`px-2.5 py-1.5 rounded-md text-xs font-medium border transition-colors ${lead.status === s ? "text-white" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"}`}
                  style={lead.status === s ? { background: BRAND, borderColor: BRAND } : {}}>{STATUS_LABEL(s)}</button>
              ))}
            </div>
            <h3 className="text-sm font-semibold mb-2 flex items-center gap-2" style={{ color: BRAND_DARK }}><UserCog size={16} /> Growth Partner</h3>
            {meta.isAdmin ? (
              <select data-testid="meta-detail-assign-select" value={lead.assigned_partner_id || ""} onChange={(e) => assign(e.target.value)} className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm bg-white outline-none">
                <option value="">Unassigned</option>{partners.map((p) => <option key={p.user_id} value={p.user_id}>{p.name}</option>)}
              </select>
            ) : <p className="text-sm text-slate-700">{lead.assigned_partner_name || "Not assigned"}</p>}
            {lead.status === "FILE" && (
              <div className="mt-4">
                <h3 className="text-sm font-semibold mb-2 flex items-center gap-2" style={{ color: BRAND_DARK }}><UserCog size={16} /> Processor</h3>
                {isStaffLike ? (
                  <select data-testid="meta-processor-select" value={lead.assigned_processor_id || ""} onChange={(e) => assignProcessor(e.target.value)} className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm bg-white outline-none">
                    <option value="">Unassigned</option>{processors.map((p) => <option key={p.user_id} value={p.user_id}>{p.name}</option>)}
                  </select>
                ) : <p className="text-sm text-slate-700">{lead.assigned_processor_name || "Not assigned"}</p>}
              </div>
            )}
          </div>

          <div className="bg-white border border-slate-200 rounded-md p-5 shadow-sm">
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2" style={{ color: BRAND_DARK }}><PhoneCall size={16} /> Call Logs</h3>
            <div className="space-y-2" data-testid="meta-call-logs-list">
              {calls.length === 0 && <p className="text-sm text-slate-400">No calls logged yet.</p>}
              {calls.map((c, i) => (
                <div key={i} className="border border-slate-100 rounded-md p-2.5 bg-slate-50/50">
                  <div className="flex items-center justify-between"><StatusPill status={c.disposition} /><span className="text-xs text-slate-500 flex items-center gap-1"><Clock size={11} /> {fmtDur(c.duration_seconds || 0)}</span></div>
                  {c.reason && <p className="text-xs text-slate-600 mt-1">Reason: {c.reason}</p>}
                  {c.docs_received !== null && c.docs_received !== undefined && <p className="text-xs text-slate-600 mt-1">Docs: {c.docs_received ? "Received" : "Pending"}</p>}
                  <p className="text-xs text-slate-400 mt-1">{c.user_name} · {c.at ? new Date(c.at).toLocaleString() : ""}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="lg:col-span-2 space-y-6">
          {lead.status === "FILE" && <FileCard key={lead.updated_at} lead={lead} onSave={saveFile} canEditInfo={canEditInfo} canEditBanks={canEditBanks} canStatus={canEditBanks} onUpdateStatus={updateProcessingStatus} />}
          {lead.status === "FILE" && canSeeDocs && <DocumentsCard lead={lead} reload={load} />}

          <div className="bg-white border border-slate-200 rounded-md p-5 shadow-sm">
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2" style={{ color: BRAND_DARK }}><MessageSquare size={16} /> Notes</h3>
            <div className="flex gap-2 mb-4">
              <input data-testid="meta-note-input" value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addNote()} placeholder="Add a note..." className="flex-1 border border-slate-300 rounded-md px-3 py-2 text-sm outline-none" />
              <button data-testid="meta-add-note-btn" onClick={addNote} className="text-white rounded-md px-3 py-2 text-sm font-medium transition-colors flex items-center gap-1" style={{ background: BRAND }}><Send size={15} /></button>
            </div>
            <div className="space-y-3" data-testid="meta-notes-list">
              {(lead.notes || []).length === 0 && <p className="text-sm text-slate-400">No notes yet.</p>}
              {[...(lead.notes || [])].reverse().map((n, i) => (
                <div key={i} className="border border-slate-100 rounded-md p-3 bg-slate-50/50"><p className="text-sm text-slate-800">{n.text}</p><p className="text-xs text-slate-400 mt-1">{n.author} · {n.at ? new Date(n.at).toLocaleString() : ""}</p></div>
              ))}
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-md p-5 shadow-sm">
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2" style={{ color: BRAND_DARK }}><Activity size={16} /> Activity Timeline</h3>
            <div className="relative pl-4 space-y-4">
              {timeline.map((a, i) => (
                <div key={i} className="relative">
                  <span className="absolute -left-4 top-1 h-2 w-2 rounded-full" style={{ background: BRAND }} />
                  <span className="absolute -left-[13px] top-3 bottom-[-14px] w-px bg-slate-200" />
                  <p className="text-sm text-slate-700">{a.detail}</p>
                  <p className="text-xs text-slate-400">{a.at ? new Date(a.at).toLocaleString() : ""}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {callOpen && <MetaCallModal phone={lead.phone} onClose={() => setCallOpen(false)} onSubmit={logCall} />}
      {fileModal && <FileStatusModal onClose={() => setFileModal(false)} onConfirm={async (docs) => { await changeStatus("FILE", docs); setFileModal(false); }} />}
    </div>
  );
}
