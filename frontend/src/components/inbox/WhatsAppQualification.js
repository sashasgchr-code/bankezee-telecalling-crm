import React, { useEffect, useState } from "react";
import api from "../../services/api";
import { MessagesSquare } from "lucide-react";
import { MediaView } from "./MediaView";
import { fmtIST } from "./inboxUtils";

const inr = (v) => (v === "not_sure" ? "Not sure" : v == null ? "—" : typeof v === "number" ? `₹${v.toLocaleString("en-IN")}` : v);
const val = (v) => (v === "not_sure" ? "Not sure" : v == null || v === "" ? "—" : Array.isArray(v) ? (v.length ? v.join(", ") : "None") : String(v));
const label = (s) => String(s || "—").replace(/_/g, " ");

export const useBotQualification = (leadId) => {
  const [s, setS] = useState(null);
  useEffect(() => { if (leadId) api.get(`/inbox/leads/${leadId}/bot-qualification`).then(({ data }) => setS(data.session)).catch(() => {}); }, [leadId]);
  return s;
};

// Answers the customer gave the WhatsApp qualification bot (source = WhatsApp). Read-only, customer-reported.
export const WhatsAppQualification = ({ leadId }) => {
  const s = useBotQualification(leadId);
  if (!s) return null;
  const a = s.answers || {};
  const rows = [
    ["Employment type", val(a.employment_type)], ["Payslip", label(a.payslip_status)], ["Company / business", val(a.company_name)],
    ["Monthly net salary", inr(a.net_monthly_salary)], ["Annual turnover", inr(a.annual_turnover)],
    ["Business registrations", a.business_registrations ? val(a.business_registrations) : "—"], ["Income category", val(a.income_category)],
    ["Regular monthly income", a.regular_monthly_income == null ? "—" : a.regular_monthly_income ? `Yes — ${val(a.other_income_details)}` : "No"],
    ["Credit report", label(a.credit_report_status)], ["CIBIL score", val(a.cibil_score)],
  ];
  return (
    <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50/40 p-3" data-testid="wa-qualification">
      <p className="text-xs font-semibold text-emerald-800 flex items-center gap-1.5 mb-2"><MessagesSquare size={14} /> WhatsApp qualification · Source: WhatsApp
        <span className="ml-auto rounded-full bg-white border px-2 py-0.5 font-medium" data-testid="wa-qualification-status">{s.status === "completed" ? "Completed" : `${label(s.status)} · step ${label(s.step)}`}</span></p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 text-xs">
        {rows.map(([k, v]) => <div key={k} className="flex justify-between gap-2 py-1 border-b border-emerald-100"><span className="text-slate-500">{k}</span><span className="text-right font-medium text-slate-800">{v}</span></div>)}
      </div>
      {(s.documents || []).length > 0 && (
        <div className="mt-2 space-y-1" data-testid="wa-qualification-docs">
          {s.documents.map((d) => <div key={d.msg_id} className="text-xs flex items-center gap-2"><span className="font-medium">{d.kind === "payslip" ? "Payslip" : "Credit report (pending advisor review)"}:</span>
            <MediaView msgId={d.msg_id} kind={(d.mime || "").startsWith("image/") ? "image" : "document"} filename={d.filename} /></div>)}
        </div>
      )}
      <p className="text-[10px] text-slate-400 mt-2">Customer-reported, not verified · last activity {fmtIST(s.updated_at)}</p>
    </div>
  );
};

// Loan summary from the WhatsApp bot, for "Customer Submitted Loans — Chatbot" (never used by eligibility).
export const WhatsAppLoanSummary = ({ leadId }) => {
  const s = useBotQualification(leadId);
  const a = s?.answers || {};
  if (!s || (a.number_of_loans === undefined && a.number_of_credit_cards === undefined)) return null;
  const rows = [["Number of loans", val(a.number_of_loans)], ["Total loan outstanding", inr(a.total_loan_outstanding)], ["Total monthly EMI", inr(a.total_monthly_emi)],
    ["Number of credit cards", val(a.number_of_credit_cards)], ["Credit card outstanding", inr(a.credit_card_outstanding)]];
  return (
    <div className="mt-3 rounded-md border border-blue-100 bg-blue-50/40 p-3 text-xs" data-testid="wa-loan-summary">
      <p className="font-semibold text-blue-700 mb-1">WhatsApp chatbot — loan summary (customer-reported)</p>
      {rows.map(([k, v]) => <div key={k} className="flex justify-between py-0.5"><span className="text-slate-500">{k}</span><span className="font-medium">{v}</span></div>)}
    </div>
  );
};
