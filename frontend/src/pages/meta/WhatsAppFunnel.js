import React, { useEffect, useState } from "react";
import api from "../../services/api";
import { Loader2 } from "lucide-react";

const STEP_LABEL = {
  employment: "Employment type", payslip: "Payslip question", payslip_upload: "Payslip upload", company: "Company name", salary: "Salary",
  se_regs: "Business registrations", se_name: "Business name", se_turnover: "Turnover", other_cat: "Income category",
  other_regular: "Regular income", other_income: "Monthly income", cibil_report: "Credit report question", report_choice: "Download help",
  report_upload: "Credit report upload", cibil_score: "CIBIL score", loans_count: "Number of loans", cards_count: "Number of cards",
  loan_outstanding: "Loan outstanding", loan_emi: "Monthly EMI", card_outstanding: "Card outstanding",
};

export default function WhatsAppFunnel() {
  const [d, setD] = useState(null);
  useEffect(() => { api.get("/inbox/bot-funnel").then(({ data }) => setD(data)).catch(() => setD({ steps: [], stopped_at: [], states: {} })); }, []);
  if (!d) return <div className="py-16 flex justify-center"><Loader2 className="animate-spin text-slate-400" /></div>;
  const top = Math.max(1, ...d.steps.map((s) => s.count));
  // Biggest loss along the main path only (report-upload / CIBIL / loans are alternative branches).
  const main = d.steps.filter((s) => !["report_uploaded", "cibil", "loans"].includes(s.key));
  const worst = main.slice(1).reduce((w, s, i) => { const lost = main[i].count - s.count; return lost > (w?.lost || 0) ? { ...s, lost, from: main[i].label } : w; }, null);
  return (
    <div className="space-y-6" data-testid="wa-funnel">
      {worst && <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" data-testid="wa-funnel-worst">Biggest drop-off: <b>{worst.lost}</b> customers lost between "{worst.from}" and "{worst.label}".</p>}
      <div className="bg-white border rounded-lg p-5 space-y-2.5">
        {d.steps.map((s, i) => {
          const prev = i ? d.steps[i - 1].count : null;
          const pct = prev ? Math.round((s.count / prev) * 100) : null;
          const isWorst = worst && worst.key === s.key;
          return (
            <div key={s.key} className="flex items-center gap-3 text-sm" data-testid={`wa-funnel-step-${s.key}`}>
              <span className="w-64 shrink-0 text-slate-700">{s.label}</span>
              <div className="flex-1 h-6 bg-slate-100 rounded"><div className={`h-6 rounded ${isWorst ? "bg-red-400" : "bg-emerald-500"}`} style={{ width: `${(s.count / top) * 100}%` }} /></div>
              <span className="w-12 text-right font-semibold">{s.count}</span>
              <span className={`w-14 text-right text-xs ${isWorst ? "text-red-600 font-semibold" : "text-slate-400"}`}>{pct != null ? `${pct}%` : ""}</span>
            </div>
          );
        })}
        <p className="text-[11px] text-slate-400 pt-2">Customers who upload a credit report skip the CIBIL and loan questions, so those steps are naturally lower. % = share of the previous step.</p>
      </div>
      <div className="bg-white border rounded-lg p-5" data-testid="wa-funnel-stopped">
        <h3 className="text-sm font-semibold text-slate-700 mb-2">Where unfinished customers stopped</h3>
        {d.stopped_at.length === 0 ? <p className="text-sm text-slate-400">No unfinished conversations.</p> : d.stopped_at.map((s, i) => (
          <div key={s.step} className={`flex justify-between py-1.5 border-b border-slate-100 text-sm ${i === 0 ? "text-red-700 font-semibold" : ""}`} data-testid={`wa-funnel-stop-${s.step}`}>
            <span>{STEP_LABEL[s.step] || s.step}</span><span>{s.count}</span>
          </div>
        ))}
        <p className="text-xs text-slate-500 mt-3" data-testid="wa-funnel-states">Still answering: {d.states.active || 0} · Paused by staff / expert call: {d.states.paused || 0} · Stopped (STOP): {d.states.stopped || 0} · Abandoned 7+ days: {d.states.abandoned || 0}</p>
      </div>
    </div>
  );
}
