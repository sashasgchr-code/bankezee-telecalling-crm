import React, { useEffect, useState } from 'react';
import { MessageSquare } from 'lucide-react';
import api from '../../services/api';

// Read-only display of loans the customer submitted through the Bankezee website / WhatsApp
// qualification chatbot. This is PRELIMINARY customer-reported data kept separate from the
// manually-maintained "Existing Loans & Obligations" section. It is never edited here and is
// never used by the eligibility calculator. Renders nothing when there is no chatbot loan data.
const num = (v) => (v === '' || v === null || v === undefined || isNaN(Number(v)) ? null : Number(v));
const inr = (v) => (num(v) != null ? `₹${num(v).toLocaleString('en-IN')}` : '-');
const pct = (v) => (num(v) != null ? `${v}%` : '-');
const fmtDate = (d) => {
  if (!d) return '-';
  const t = new Date(d);
  return isNaN(t.getTime()) ? String(d) : t.toLocaleDateString('en-IN');
};
const titleCase = (s) => String(s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const ChatbotSubmittedLoans = ({ leadId }) => {
  const [loans, setLoans] = useState(null);
  const [meta, setMeta] = useState({ source: '', updatedAt: '' });

  useEffect(() => {
    let active = true;
    if (!leadId) return undefined;
    (async () => {
      try {
        const { data } = await api.get(`/meta/leads/${leadId}/chatbot`);
        if (!active) return;
        const q = data?.qualification || {};
        const list = Array.isArray(q.loans) ? q.loans.filter(Boolean) : [];
        setLoans(list);
        setMeta({
          source: data?.whatsapp_consent ? 'Website / WhatsApp Chatbot' : 'Bankezee Website Chatbot',
          updatedAt: data?.last_synced_at || data?.updated_at || q.last_activity || '',
        });
      } catch (e) {
        if (active) setLoans([]);
      }
    })();
    return () => { active = false; };
  }, [leadId]);

  // Only render when there is chatbot loan data.
  if (!loans || loans.length === 0) return null;

  const totalOutstanding = loans.reduce((s, l) => s + (num(l.outstanding_balance) || 0), 0);
  const totalEmi = loans.reduce((s, l) => s + (num(l.monthly_emi) || 0), 0);

  return (
    <div className="mt-6 pt-4 border-t border-gray-100" data-testid="chatbot-submitted-loans-section">
      <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
        <h3 className="text-sm font-semibold text-blue-600 flex items-center gap-2">
          <MessageSquare size={16} /> Customer Submitted Loans — Chatbot
        </h3>
        <div className="text-xs text-gray-500" data-testid="chatbot-loans-meta">
          <span data-testid="chatbot-loans-source">Source: {meta.source || 'Bankezee Chatbot'}</span>
          {meta.updatedAt && <span className="ml-3" data-testid="chatbot-loans-updated">Last updated: {fmtDate(meta.updatedAt)}</span>}
        </div>
      </div>
      <p className="text-xs text-gray-400 mb-3">
        Preliminary information reported by the customer via chatbot. Read-only — not used in eligibility calculations.
      </p>

      <div className="overflow-x-auto rounded-lg border border-blue-100">
        <table className="w-full text-sm" data-testid="chatbot-loans-table">
          <thead>
            <tr className="bg-blue-50 text-blue-700 text-xs">
              <th className="text-left font-medium px-3 py-2">Lender</th>
              <th className="text-left font-medium px-3 py-2">Loan Type</th>
              <th className="text-right font-medium px-3 py-2">Loan Amount</th>
              <th className="text-right font-medium px-3 py-2">Outstanding</th>
              <th className="text-right font-medium px-3 py-2">ROI</th>
              <th className="text-right font-medium px-3 py-2">EMI</th>
              <th className="text-left font-medium px-3 py-2">Sanction Date</th>
              <th className="text-right font-medium px-3 py-2">Tenure</th>
              <th className="text-right font-medium px-3 py-2">EMIs Paid</th>
            </tr>
          </thead>
          <tbody>
            {loans.map((l, i) => (
              <tr key={l.loan_id || i} className="border-t border-blue-50" data-testid={`chatbot-loan-row-${i}`}>
                <td className="px-3 py-2 text-gray-900">{l.lender || '-'}</td>
                <td className="px-3 py-2 text-gray-900">{l.loan_type ? titleCase(l.loan_type) : '-'}</td>
                <td className="px-3 py-2 text-right">{inr(l.original_amount)}</td>
                <td className="px-3 py-2 text-right">{inr(l.outstanding_balance)}</td>
                <td className="px-3 py-2 text-right">{pct(l.interest_rate)}</td>
                <td className="px-3 py-2 text-right">{inr(l.monthly_emi)}</td>
                <td className="px-3 py-2">{fmtDate(l.sanction_date)}</td>
                <td className="px-3 py-2 text-right">{num(l.original_tenure) != null ? `${l.original_tenure} mo` : '-'}</td>
                <td className="px-3 py-2 text-right">{num(l.emis_paid) != null ? l.emis_paid : '-'}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-blue-100 bg-blue-50/60 font-semibold text-gray-900">
              <td className="px-3 py-2" colSpan={3} data-testid="chatbot-loans-total-label">TOTAL ({loans.length})</td>
              <td className="px-3 py-2 text-right" data-testid="chatbot-loans-total-outstanding">{inr(totalOutstanding)}</td>
              <td className="px-3 py-2" />
              <td className="px-3 py-2 text-right" data-testid="chatbot-loans-total-emi">{inr(totalEmi)}</td>
              <td className="px-3 py-2" colSpan={3} />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
};

export default ChatbotSubmittedLoans;
