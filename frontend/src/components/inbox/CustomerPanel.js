import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import api from "../../services/api";
import { fmtIST, errMsg } from "./inboxUtils";

const Row = ({ k, v, tid }) => (
  <div className="flex justify-between gap-3 py-1.5 border-b border-slate-100 text-sm"><span className="text-slate-500">{k}</span><span data-testid={tid} className="text-right text-slate-800 font-medium">{v || "—"}</span></div>
);

const LinkLead = ({ convId, onLinked }) => {
  const [q, setQ] = useState("");
  const [res, setRes] = useState([]);
  const search = () => api.get("/inbox/lead-search", { params: { q } }).then(({ data }) => setRes(data)).catch(() => {});
  const link = async (id) => { try { await api.post(`/inbox/conversations/${convId}/link`, { lead_id: id }); toast.success("Linked to lead"); onLinked(); } catch (e) { toast.error(errMsg(e)); } };
  return (
    <div className="space-y-2" data-testid="link-lead-box">
      <p className="text-sm text-amber-700">Unmatched conversation — not linked to any CRM lead.</p>
      <div className="flex gap-1">
        <input data-testid="link-lead-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or mobile" className="flex-1 border rounded-md px-2 py-1 text-sm" />
        <button data-testid="link-lead-search-btn" onClick={search} className="text-xs rounded-md border px-2">Search</button>
      </div>
      {res.map((l) => <button key={l.lead_id} data-testid={`link-lead-${l.lead_id}`} onClick={() => link(l.lead_id)} className="block w-full text-left text-xs rounded border px-2 py-1 hover:bg-slate-50">{l.full_name} · {l.phone} · {l.status}</button>)}
    </div>
  );
};

export const CustomerPanel = ({ data, onLinked }) => {
  const navigate = useNavigate();
  if (!data) return null;
  const c = data.customer;
  const staff = data.role === "admin" || data.role === "ops";
  return (
    <aside className="w-80 shrink-0 border-l bg-white overflow-y-auto p-4 hidden xl:block" data-testid="customer-panel">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3 mt-10">Customer details</h3>
      {!c ? (staff ? <LinkLead convId={data.conversation.id} onLinked={onLinked} /> : <p className="text-sm text-slate-500">Not linked to a CRM lead.</p>) : (
        <>
          <Row k="Name" v={c.full_name} tid="cust-name" /><Row k="Mobile" v={c.phone} tid="cust-phone" /><Row k="Lead ID" v={c.lead_id} tid="cust-lead-id" />
          <Row k="Lead status" v={c.status} tid="cust-status" /><Row k="File status" v={c.processing_status} tid="cust-file-status" />
          <Row k="Growth Partner" v={c.assigned_partner_name} tid="cust-gp" /><Row k="Processor" v={c.assigned_processor_name} tid="cust-processor" />
          <Row k="Source" v={c.source} tid="cust-source" /><Row k="Employment" v={c.employment} tid="cust-employment" />
          <Row k="Company" v={c.company_name} tid="cust-company" /><Row k="Salary / turnover" v={c.salary} tid="cust-salary" />
          <Row k="CIBIL" v={c.cibil_score} tid="cust-cibil" /><Row k="Website chatbot" v={c.chatbot_stage} tid="cust-chatbot" />
          <Row k="Credit report" v={c.credit_report_status} tid="cust-credit" /><Row k="Payslip" v={c.payslip_status} tid="cust-payslip" />
          <Row k="Last activity" v={fmtIST(c.last_activity)} tid="cust-last-activity" />
          <button data-testid="cust-open-lead-btn" onClick={() => navigate(c.status === "FILE" ? `/meta/files/${c.lead_id}` : `/meta/leads/${c.lead_id}`)} className="mt-4 w-full rounded-md border border-slate-300 py-2 text-sm font-medium hover:bg-slate-50">Open {c.status === "FILE" ? "File" : "Lead"}</button>
        </>
      )}
    </aside>
  );
};
