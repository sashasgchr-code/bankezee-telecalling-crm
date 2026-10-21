import React, { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import api from "../../services/api";
import { toast } from "sonner";
import { useMetaUser, StatusPill, STATUS_LABEL, STATUSES, fmtDate, fmtShort, BRAND, BRAND_DARK } from "./metaCommon";
import MetaCallModal from "./MetaCallModal";
import { openMetaWhatsApp } from "../../utils/whatsapp";
import { Search, RefreshCw, MapPin, Phone, MessageCircle, ChevronUp, ChevronDown, ChevronsUpDown, ChevronLeft, ChevronRight, Plus, X } from "lucide-react";

const metaLoanType = (lead) => (lead?.file?.loan_type || lead?.loan_type || "loan requirement");


export default function MetaLeads() {
  const meta = useMetaUser();
  const isStaff = meta.isStaff;
  const navigate = useNavigate();
  const [leads, setLeads] = useState([]);
  const [partners, setPartners] = useState([]);
  const [status, setStatus] = useState("ALL");
  const [q, setQ] = useState("");
  const [partnerFilter, setPartnerFilter] = useState("ALL");
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [sortBy, setSortBy] = useState("created_time");
  const [sortDir, setSortDir] = useState("desc");
  const [datePreset, setDatePreset] = useState("ALL");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [selected, setSelected] = useState(new Set());
  const [bulkPartner, setBulkPartner] = useState("");
  const [callLead, setCallLead] = useState(null);
  const callLeadRef = useRef(null);

  // Manual "Add Lead" (staff only) — for leads that did not come from the Google Sheet.
  const EMPTY_FORM = { full_name: "", phone: "", email: "", city: "", employment_status: "", monthly_salary: "", outstanding_amount: "", cibil_score: "", campaign_name: "", form_name: "", platform: "", status: "NEW", partner_id: "" };
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const setF = (k, v) => setForm((p) => ({ ...p, [k]: v }));
  const submitAdd = async () => {
    if (!form.full_name.trim() || !form.phone.trim()) { toast.error("Name and phone are required"); return; }
    setSaving(true);
    try {
      await api.post("/meta/leads", { ...form, partner_id: form.partner_id || null });
      toast.success("Lead added to Meta CRM");
      setShowAdd(false); setForm(EMPTY_FORM); setStatus("ALL"); setPage(1); load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed to add lead"); }
    finally { setSaving(false); }
  };

  // Bind a call explicitly to the lead that initiated it (guards against stale-customer saves).
  const openCall = (lead) => { callLeadRef.current = lead; setCallLead(lead); };
  const closeCall = () => { callLeadRef.current = null; setCallLead(null); };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { status, partner: partnerFilter, page, page_size: 25, sort_by: sortBy, sort_dir: sortDir };
      if (q) params.q = q;
      if (fromDate) params.from_date = fromDate;
      if (toDate) params.to_date = toDate;
      const { data } = await api.get("/meta/leads", { params });
      setLeads(data.items || data.leads || []);
      setTotal(data.total);
      setPages(data.pages);
    } finally { setLoading(false); }
  }, [status, q, partnerFilter, page, sortBy, sortDir, fromDate, toDate]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [status, q, partnerFilter, sortBy, sortDir, fromDate, toDate]);
  useEffect(() => { setSelected(new Set()); }, [page, status, q, partnerFilter, sortBy, sortDir, fromDate, toDate]);
  useEffect(() => { if (isStaff) api.get("/meta/partners").then(({ data }) => setPartners(data)).catch(() => {}); }, [isStaff]);

  const localYMD = (d) => { const off = d.getTimezoneOffset() * 60000; return new Date(d - off).toISOString().slice(0, 10); };
  const applyPreset = (preset) => {
    setDatePreset(preset);
    const today = new Date();
    if (preset === "ALL") { setFromDate(""); setToDate(""); }
    else if (preset === "TODAY") { const t = localYMD(today); setFromDate(t); setToDate(t); }
    else if (preset === "7D") { const s = new Date(today); s.setDate(s.getDate() - 6); setFromDate(localYMD(s)); setToDate(localYMD(today)); }
    else if (preset === "30D") { const s = new Date(today); s.setDate(s.getDate() - 29); setFromDate(localYMD(s)); setToDate(localYMD(today)); }
  };

  const toggleSort = (field) => {
    if (sortBy === field) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortBy(field); setSortDir("asc"); }
  };
  const SortIcon = ({ field }) => sortBy !== field ? <ChevronsUpDown size={12} className="text-slate-300" /> : (sortDir === "asc" ? <ChevronUp size={12} /> : <ChevronDown size={12} />);
  const Field = ({ label, value, className = "text-slate-700" }) => (
    <div className="min-w-0"><p className="text-[10px] uppercase tracking-wide text-slate-400">{label}</p><p className={`text-xs font-semibold truncate ${className}`}>{value || "—"}</p></div>
  );

  const logCallFor = async (payload) => {
    const bound = callLeadRef.current;
    if (!bound || (callLead && bound.lead_id !== callLead.lead_id)) {
      toast.error("Call context changed — please reopen the call for this lead");
      closeCall();
      return;
    }
    await api.post(`/meta/leads/${bound.lead_id}/calls`, payload);
    toast.success("Call logged");
    load();
  };
  const toggleOne = (id) => { const s = new Set(selected); s.has(id) ? s.delete(id) : s.add(id); setSelected(s); };
  const allOnPage = leads.length > 0 && leads.every((l) => selected.has(l.lead_id));
  const toggleAll = () => { const s = new Set(selected); allOnPage ? leads.forEach((l) => s.delete(l.lead_id)) : leads.forEach((l) => s.add(l.lead_id)); setSelected(s); };

  const doBulkAssign = async () => {
    try {
      const { data } = await api.post("/meta/leads/bulk-assign", { lead_ids: [...selected], partner_id: bulkPartner || null });
      toast.success(`${data.modified} lead${data.modified === 1 ? "" : "s"} updated`);
      setSelected(new Set()); setBulkPartner(""); load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Bulk assign failed"); }
  };
  const doBulkDelete = async () => {
    if (!window.confirm(`Delete ${selected.size} lead(s)? They will be removed from all lists and reports.`)) return;
    try {
      const { data } = await api.post("/meta/leads/bulk-delete", { lead_ids: [...selected] });
      toast.success(`${data.deleted} lead${data.deleted === 1 ? "" : "s"} deleted`);
      setSelected(new Set()); load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Delete failed"); }
  };

  const sync = async () => {
    setSyncing(true);
    try { const { data } = await api.post("/meta/leads/sync"); toast.success(`Synced: ${data.imported ?? 0} new, ${data.updated ?? 0} updated`); await load(); }
    catch (e) { toast.error("Sync failed"); } finally { setSyncing(false); }
  };

  const assign = async (leadId, partnerId, e) => {
    e.stopPropagation();
    try { await api.patch(`/meta/leads/${leadId}/assign`, { partner_id: partnerId || null }); toast.success("Assignment updated"); load(); }
    catch (err) { toast.error(err?.response?.data?.detail || "Failed to assign"); }
  };

  const headers = [
    { h: "Date", f: "created_time" }, { h: "Name", f: "full_name" }, { h: "Contact", f: null },
    { h: "City", f: "city" }, { h: "Employment", f: null }, { h: "Salary", f: null },
    { h: "Outstanding", f: null }, { h: "Status", f: "status" }, { h: "Partner", f: null },
  ];

  return (
    <div data-testid="meta-leads">
      <header className="h-16 border-b border-slate-200 bg-white px-4 md:px-8 flex items-center justify-between sticky top-0 z-30">
        <h1 className="text-xl font-bold" style={{ color: BRAND_DARK }}>Leads</h1>
        <div className="flex items-center gap-2">
          {isStaff && (
            <button data-testid="meta-add-lead-btn" onClick={() => { setForm(EMPTY_FORM); setShowAdd(true); }}
              className="flex items-center gap-2 rounded-md px-4 py-2 text-sm shadow-sm font-medium text-white transition-colors" style={{ background: BRAND }}>
              <Plus size={16} /> Add Lead
            </button>
          )}
          <button data-testid="meta-leads-sync-btn" onClick={sync} disabled={syncing}
            className="bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-2 rounded-md px-4 py-2 text-sm shadow-sm font-medium transition-colors disabled:opacity-70">
            <RefreshCw size={16} className={syncing ? "animate-spin" : ""} /> {syncing ? "Syncing..." : "Sync Now"}
          </button>
        </div>
      </header>

      <div className="p-4 md:p-8">
        {callLead && <MetaCallModal phone={callLead.phone} onClose={closeCall} onSubmit={logCallFor} />}
        {showAdd && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" data-testid="meta-add-lead-modal" onClick={() => !saving && setShowAdd(false)}>
            <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 sticky top-0 bg-white">
                <h2 className="text-lg font-bold" style={{ color: BRAND_DARK }}>Add Lead Manually</h2>
                <button data-testid="meta-add-lead-close" onClick={() => !saving && setShowAdd(false)} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
              </div>
              <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                {[
                  { k: "full_name", label: "Full Name *", ph: "e.g. Ramesh Kumar" },
                  { k: "phone", label: "Phone *", ph: "e.g. +91 98765 43210" },
                  { k: "email", label: "Email", ph: "name@example.com" },
                  { k: "city", label: "City", ph: "e.g. Hyderabad" },
                  { k: "employment_status", label: "Employment Status", ph: "e.g. Salaried" },
                  { k: "monthly_salary", label: "Monthly Salary", ph: "e.g. 50000 to 75000" },
                  { k: "outstanding_amount", label: "Outstanding Amount", ph: "e.g. 5 to 10 lakh" },
                  { k: "cibil_score", label: "CIBIL Score", ph: "e.g. 750+" },
                  { k: "campaign_name", label: "Campaign Name", ph: "Optional" },
                  { k: "form_name", label: "Form / Source", ph: "Optional" },
                ].map(({ k, label, ph }) => (
                  <div key={k} className={k === "full_name" || k === "phone" ? "" : ""}>
                    <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">{label}</label>
                    <input data-testid={`meta-add-field-${k}`} value={form[k]} onChange={(e) => setF(k, e.target.value)} placeholder={ph}
                      className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm outline-none focus:border-slate-400" />
                  </div>
                ))}
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">Status</label>
                  <select data-testid="meta-add-field-status" value={form.status} onChange={(e) => setF("status", e.target.value)}
                    className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm bg-white outline-none">
                    {STATUSES.filter((s) => s !== "ALL").map((s) => <option key={s} value={s}>{STATUS_LABEL(s)}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">Assign Growth Partner</label>
                  <select data-testid="meta-add-field-partner" value={form.partner_id} onChange={(e) => setF("partner_id", e.target.value)}
                    className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm bg-white outline-none">
                    <option value="">Unassigned</option>
                    {partners.map((p) => <option key={p.user_id} value={p.user_id}>{p.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200 sticky bottom-0 bg-white">
                <button data-testid="meta-add-lead-cancel" onClick={() => !saving && setShowAdd(false)} className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800">Cancel</button>
                <button data-testid="meta-add-lead-submit" onClick={submitAdd} disabled={saving}
                  className="px-5 py-2 rounded-md text-sm font-medium text-white transition-colors disabled:opacity-70" style={{ background: BRAND }}>
                  {saving ? "Adding..." : "Add Lead"}
                </button>
              </div>
            </div>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3 mb-5">
          <div className="relative flex-1 min-w-[220px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input data-testid="meta-leads-search-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email, phone, city..."
              className="w-full border border-slate-300 rounded-md pl-9 pr-3 py-2 text-sm outline-none bg-white" />
          </div>
          <div className="w-full md:w-auto md:flex-1 -mx-1 px-1 overflow-x-auto">
            <div className="flex gap-1.5 flex-nowrap md:flex-wrap">
              {STATUSES.map((s) => (
                <button key={s} data-testid={`meta-status-filter-${s}`} onClick={() => setStatus(s)}
                  className={`shrink-0 whitespace-nowrap px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${status === s ? "text-white" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"}`}
                  style={status === s ? { background: BRAND, borderColor: BRAND } : {}}>{s === "ALL" ? "ALL" : STATUS_LABEL(s)}</button>
              ))}
            </div>
          </div>
          {isStaff && (
            <select data-testid="meta-partner-filter" value={partnerFilter} onChange={(e) => setPartnerFilter(e.target.value)}
              className="border border-slate-300 rounded-md px-3 py-2 text-sm bg-white outline-none">
              <option value="ALL">All Partners</option>
              <option value="UNASSIGNED">Unassigned</option>
              {partners.map((p) => <option key={p.user_id} value={p.user_id}>{p.name}</option>)}
            </select>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 mb-5" data-testid="meta-date-filter-bar">
          <span className="text-xs font-medium text-slate-500 mr-1">Date:</span>
          {[{ k: "ALL", label: "All time" }, { k: "TODAY", label: "Today" }, { k: "7D", label: "Last 7 days" }, { k: "30D", label: "Last 30 days" }].map(({ k, label }) => (
            <button key={k} data-testid={`meta-date-preset-${k}`} onClick={() => applyPreset(k)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${datePreset === k ? "text-white" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"}`}
              style={datePreset === k ? { background: BRAND, borderColor: BRAND } : {}}>{label}</button>
          ))}
          <div className="flex items-center gap-1.5 ml-1">
            <input type="date" data-testid="meta-date-from-input" value={fromDate} onChange={(e) => { setDatePreset("CUSTOM"); setFromDate(e.target.value); }} className="border border-slate-300 rounded-md px-2 py-1.5 text-xs bg-white outline-none" />
            <span className="text-slate-400 text-xs">to</span>
            <input type="date" data-testid="meta-date-to-input" value={toDate} onChange={(e) => { setDatePreset("CUSTOM"); setToDate(e.target.value); }} className="border border-slate-300 rounded-md px-2 py-1.5 text-xs bg-white outline-none" />
          </div>
        </div>

        {isStaff && selected.size > 0 && (
          <div className="flex items-center gap-3 mb-3 border rounded-md px-4 py-2.5" style={{ background: "rgba(15,82,186,0.05)", borderColor: "rgba(15,82,186,0.2)" }} data-testid="meta-bulk-action-bar">
            <span className="text-sm font-medium" style={{ color: BRAND_DARK }} data-testid="meta-bulk-selected-count">{selected.size} selected</span>
            <select data-testid="meta-bulk-partner-select" value={bulkPartner} onChange={(e) => setBulkPartner(e.target.value)}
              className="border border-slate-300 rounded-md px-3 py-1.5 text-sm bg-white outline-none">
              <option value="">Unassign</option>
              {partners.map((p) => <option key={p.user_id} value={p.user_id}>{p.name}</option>)}
            </select>
            <button data-testid="meta-bulk-assign-btn" onClick={doBulkAssign} className="text-white rounded-md px-4 py-1.5 text-sm font-medium transition-colors" style={{ background: BRAND }}>Apply</button>
            {meta.isAdmin && <button data-testid="meta-bulk-delete-btn" onClick={doBulkDelete} className="bg-red-600 text-white hover:bg-red-700 rounded-md px-4 py-1.5 text-sm font-medium transition-colors">Delete</button>}
            <button data-testid="meta-bulk-clear-btn" onClick={() => setSelected(new Set())} className="text-slate-500 text-sm hover:text-slate-700 transition-colors">Clear</button>
          </div>
        )}

        <div className="bg-white border border-slate-200 rounded-md shadow-sm overflow-hidden">
          <div className="overflow-x-auto hidden md:block">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-slate-50/80 border-b border-slate-200">
                  {isStaff && <th className="py-3 px-3 w-10"><input type="checkbox" data-testid="meta-select-all-checkbox" checked={allOnPage} onChange={toggleAll} className="cursor-pointer" /></th>}
                  {headers.map(({ h, f }) => (
                    <th key={h} className="text-xs font-semibold uppercase tracking-wider text-slate-500 py-3 px-3 text-left">
                      {f ? <button data-testid={`meta-sort-${f}`} onClick={() => toggleSort(f)} className="inline-flex items-center gap-1">{h} <SortIcon field={f} /></button> : h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody data-testid="meta-leads-table-body">
                {loading ? (
                  <tr><td colSpan={isStaff ? 10 : 9} className="py-16 text-center text-slate-400 text-sm">Loading leads...</td></tr>
                ) : leads.length === 0 ? (
                  <tr><td colSpan={isStaff ? 10 : 9} className="py-16 text-center text-slate-400 text-sm">No leads found. Sync with Google Sheets to import data.</td></tr>
                ) : leads.map((lead) => (
                  <tr key={lead.lead_id} data-testid={`meta-lead-row-${lead.lead_id}`} onClick={() => navigate(`/meta/leads/${lead.lead_id}`)}
                    className="border-b border-slate-100 hover:bg-slate-50/60 transition-colors cursor-pointer">
                    {isStaff && (
                      <td className="py-2.5 px-3" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" data-testid={`meta-row-checkbox-${lead.lead_id}`} checked={selected.has(lead.lead_id)} onChange={() => toggleOne(lead.lead_id)} className="cursor-pointer" />
                      </td>
                    )}
                    <td className="py-2.5 px-3 text-xs text-slate-500 whitespace-nowrap">{fmtDate(lead.created_time || lead.created_at)}</td>
                    <td className="py-2.5 px-3"><p className="text-sm font-medium text-slate-800">{lead.full_name || "—"}</p><p className="text-xs text-slate-400">{lead.campaign_name?.slice(0, 28)}</p></td>
                    <td className="py-2.5 px-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-2">
                        <a data-testid={`meta-call-link-${lead.lead_id}`} href={`tel:${lead.phone}`} onClick={() => openCall(lead)} className="h-7 w-7 rounded-full bg-emerald-50 text-emerald-600 hover:bg-emerald-100 flex items-center justify-center shrink-0" title="Call"><Phone size={14} /></a>
                        <button data-testid={`meta-wa-link-${lead.lead_id}`} type="button" onClick={() => openMetaWhatsApp(lead.phone, lead.full_name, metaLoanType(lead), meta.name)} className="h-7 w-7 rounded-full bg-green-50 text-green-600 hover:bg-green-100 flex items-center justify-center shrink-0" title="WhatsApp"><MessageCircle size={14} /></button>
                        <div className="min-w-0"><a href={`tel:${lead.phone}`} onClick={() => openCall(lead)} className="text-sm hover:underline" style={{ color: BRAND }}>{lead.phone}</a><p className="text-xs text-slate-400 truncate">{lead.email}</p></div>
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-sm text-slate-600"><span className="inline-flex items-center gap-1"><MapPin size={12} className="text-slate-400" />{lead.city || "—"}</span></td>
                    <td className="py-2.5 px-3 text-xs text-slate-600">{lead.employment_status || "—"}</td>
                    <td className="py-2.5 px-3 text-xs text-slate-600">{lead.monthly_salary || "—"}</td>
                    <td className="py-2.5 px-3 text-xs text-slate-600">{lead.outstanding_amount || "—"}</td>
                    <td className="py-2.5 px-3"><StatusPill status={lead.status} /></td>
                    <td className="py-2.5 px-3" onClick={(e) => e.stopPropagation()}>
                      {isStaff ? (
                        <select data-testid={`meta-assign-select-${lead.lead_id}`} value={lead.assigned_partner_id || ""} onChange={(e) => assign(lead.lead_id, e.target.value, e)}
                          className="border border-slate-200 rounded-md px-2 py-1 text-xs bg-white outline-none max-w-[160px]">
                          <option value="">Unassigned</option>
                          {partners.map((p) => <option key={p.user_id} value={p.user_id}>{p.name}</option>)}
                        </select>
                      ) : <span className="text-xs text-slate-500">{lead.assigned_partner_name || "—"}</span>}
                      {lead.assigned_partner_id && lead.assigned_by && (
                        <p className="text-[10px] text-slate-400 mt-1">by {lead.assigned_by}{lead.assigned_at ? ` · ${fmtShort(lead.assigned_at)}` : ""}</p>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile card list — desktop uses the table above; keeps Meta Leads usable on phones */}
          <div className="md:hidden" data-testid="meta-leads-cards">
            {loading ? (
              <p className="py-16 text-center text-slate-400 text-sm">Loading leads...</p>
            ) : leads.length === 0 ? (
              <p className="py-16 text-center text-slate-400 text-sm">No leads found. Sync with Google Sheets to import data.</p>
            ) : leads.map((lead) => (
              <div key={lead.lead_id} data-testid={`meta-lead-card-${lead.lead_id}`} onClick={() => navigate(`/meta/leads/${lead.lead_id}`)}
                className="p-4 border-b-4 border-slate-200 last:border-b-0 hover:bg-slate-50/60 cursor-pointer">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-base font-bold text-slate-900 truncate">{lead.full_name || "—"}</p>
                    {lead.campaign_name && <p className="text-xs text-slate-400 truncate">{lead.campaign_name}</p>}
                  </div>
                  <StatusPill status={lead.status} />
                </div>
                <div className="flex items-center gap-2 mt-3 flex-wrap" onClick={(e) => e.stopPropagation()}>
                  <a data-testid={`meta-card-call-${lead.lead_id}`} href={`tel:${lead.phone}`} onClick={() => openCall(lead)}
                    className="flex-1 min-w-[130px] inline-flex items-center justify-center gap-1.5 rounded-md bg-emerald-600 text-white px-3 py-2 text-sm font-medium active:bg-emerald-700"><Phone size={15} /> Call</a>
                  <button data-testid={`meta-card-wa-${lead.lead_id}`} type="button" onClick={() => openMetaWhatsApp(lead.phone, lead.full_name, metaLoanType(lead), meta.name)}
                    className="flex-1 min-w-[130px] inline-flex items-center justify-center gap-1.5 rounded-md bg-green-500 text-white px-3 py-2 text-sm font-medium active:bg-green-600"><MessageCircle size={15} /> WhatsApp</button>
                </div>
                {isStaff && (
                  <div className="mt-3" onClick={(e) => e.stopPropagation()}>
                    <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">Assign Growth Partner</label>
                    <select data-testid={`meta-card-assign-${lead.lead_id}`} value={lead.assigned_partner_id || ""} onChange={(e) => assign(lead.lead_id, e.target.value, e)}
                      className="mt-1 w-full border border-slate-300 rounded-md px-3 py-2 text-sm bg-white outline-none">
                      <option value="">Unassigned</option>
                      {partners.map((p) => <option key={p.user_id} value={p.user_id}>{p.name}</option>)}
                    </select>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 mt-3">
                  <Field label="City" value={lead.city} />
                  <Field label="Employment" value={lead.employment_status} />
                  <Field label="Salary" value={lead.monthly_salary} />
                  <Field label="Outstanding" value={lead.outstanding_amount} />
                  <Field label="Assigned GP" value={lead.assigned_partner_name} className={lead.assigned_partner_id ? "text-emerald-600" : "text-slate-400"} />
                  <Field label="Date" value={fmtDate(lead.created_time || lead.created_at)} />
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 text-sm">
            <span className="text-slate-500" data-testid="meta-leads-count-label">{total} lead{total === 1 ? "" : "s"}{pages > 1 ? ` · page ${page} of ${pages}` : ""}</span>
            <div className="flex items-center gap-2">
              <button data-testid="meta-prev-page-btn" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="flex items-center gap-1 px-3 py-1.5 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"><ChevronLeft size={14} /> Prev</button>
              <button data-testid="meta-next-page-btn" disabled={page >= pages} onClick={() => setPage((p) => Math.min(pages, p + 1))} className="flex items-center gap-1 px-3 py-1.5 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed">Next <ChevronRight size={14} /></button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
