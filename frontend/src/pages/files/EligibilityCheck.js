import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, CardContent } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { toast } from 'sonner';
import api from '../../services/api';
import { ArrowLeft, RefreshCw, ChevronDown, ChevronUp, Building2, AlertTriangle, CheckCircle, XCircle, HelpCircle, Trophy, Upload, FileText, Shield, Clock, Users, Banknote, Printer, History, Sparkles, Loader2 } from 'lucide-react';

const STATUS_CONFIG = {
  eligible: { bg: 'bg-green-50 border-green-300', text: 'text-green-700', icon: CheckCircle, label: 'ELIGIBLE', dot: 'bg-green-500' },
  possibly_eligible: { bg: 'bg-amber-50 border-amber-300', text: 'text-amber-700', icon: HelpCircle, label: 'POSSIBLY ELIGIBLE', dot: 'bg-amber-500' },
  not_eligible: { bg: 'bg-red-50 border-red-300', text: 'text-red-700', icon: XCircle, label: 'NOT ELIGIBLE', dot: 'bg-red-500' },
};

const formatAmt = (v) => {
  if (!v) return '—';
  const n = Number(v);
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(2)} Cr`;
  if (n >= 100000) return `₹${(n / 100000).toFixed(2)} L`;
  return `₹${n.toLocaleString('en-IN')}`;
};

const ConfBadge = ({ level }) => {
  const cfg = { high: 'bg-green-100 text-green-800 border-green-200', medium: 'bg-amber-100 text-amber-800 border-amber-200', low: 'bg-red-100 text-red-800 border-red-200' };
  return <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border ${cfg[level] || cfg.low}`}>{(level || 'low').toUpperCase()} CONFIDENCE</span>;
};

const RankBadge = ({ rank }) => {
  const cfg = {
    1: { bg: 'bg-yellow-400', text: 'text-yellow-900', label: 'BEST MATCH' },
    2: { bg: 'bg-slate-300', text: 'text-slate-800', label: '2ND BEST' },
    3: { bg: 'bg-orange-300', text: 'text-orange-900', label: '3RD BEST' },
  };
  const c = cfg[rank];
  if (!c) return null;
  return <span className={`text-[10px] px-2 py-0.5 rounded font-bold ${c.bg} ${c.text}`}>{c.label}</span>;
};

const RuleRow = ({ r }) => {
  const color = r.result === 'PASS' ? 'text-green-600' : r.result === 'FAIL' ? 'text-red-600' : 'text-amber-600';
  const icon = r.result === 'PASS' ? <CheckCircle className="w-3.5 h-3.5 text-green-500" /> : r.result === 'FAIL' ? <XCircle className="w-3.5 h-3.5 text-red-500" /> : <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />;
  return (
    <tr className="text-xs border-b last:border-0 hover:bg-slate-50/50">
      <td className="py-1.5 pr-3 font-medium text-slate-700">{r.rule}</td>
      <td className="py-1.5 pr-3 text-slate-600">{r.customer}</td>
      <td className="py-1.5 pr-3 text-slate-500">{r.required}</td>
      <td className={`py-1.5 pr-3 font-semibold ${color}`}>
        <span className="flex items-center gap-1">{icon} {r.result}</span>
      </td>
      <td className="py-1.5 text-slate-400">{r.source}</td>
    </tr>
  );
};

const InfoPill = ({ icon: Icon, label, value, className = '' }) => {
  if (!value || value === '—') return null;
  return (
    <div className={`flex items-center gap-1.5 text-xs ${className}`}>
      {Icon && <Icon className="w-3 h-3 text-slate-400 shrink-0" />}
      <span className="text-slate-500">{label}:</span>
      <span className="font-medium text-slate-700">{value}</span>
    </div>
  );
};

export default function EligibilityCheck() {
  const { fileId } = useParams();
  const leadId = fileId; // Alias for clarity - files are leads with status='file'
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [expandedCards, setExpandedCards] = useState({});
  const [showNotEligible, setShowNotEligible] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [showAiParser, setShowAiParser] = useState(false);
  const [aiParsing, setAiParsing] = useState(false);
  const [aiResults, setAiResults] = useState(null);
  const [aiAutoResults, setAiAutoResults] = useState(null);
  const [leadDocs, setLeadDocs] = useState([]);
  const autoParseTriggered = useRef(false);
  const printRef = useRef(null);

  const runCheck = async () => {
    setLoading(true);
    try {
      const res = await api.post(`/bank-policies/check-eligibility/${leadId}`);
      setData(res.data);
      toast.success('Eligibility analysis complete');
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to run eligibility check');
    } finally { setLoading(false); }
  };

  const loadHistory = async () => {
    setHistoryLoading(true);
    try {
      const res = await api.get(`/bank-policies/eligibility-history/${leadId}`);
      setHistory(res.data || []);
    } catch (e) {
      toast.error('Failed to load history');
    } finally { setHistoryLoading(false); }
  };

  const loadLeadDocs = async () => {
    try {
      const res = await api.get(`/leads/${leadId}`);
      setLeadDocs(res.data?.documents || []);
    } catch (e) { /* ignore */ }
  };

  const parseDocument = async (docIndex, docType) => {
    setAiParsing(true);
    try {
      const res = await api.post(`/document-ai/parse-document/${leadId}`, {
        document_index: docIndex,
        document_type: docType,
      });
      setAiResults(res.data);
      toast.success('Document parsed successfully');
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to parse document');
    } finally { setAiParsing(false); }
  };

  const applyParsedData = async () => {
    if (!aiResults?.parsed_data) return;
    try {
      const res = await api.post(`/document-ai/auto-fill-from-parse/${leadId}`, {
        parsed_data: aiResults.parsed_data,
        document_type: aiResults.document_type,
      });
      toast.success(`Updated ${res.data.fields_updated?.length || 0} fields`);
      // Re-run eligibility check with updated data
      runCheck();
    } catch (e) {
      toast.error('Failed to apply data');
    }
  };

  // Auto-parse documents in the background
  const autoParseDocuments = async () => {
    if (autoParseTriggered.current) return;
    autoParseTriggered.current = true;
    try {
      const res = await api.post(`/document-ai/auto-parse-all/${leadId}`);
      if (res.data.parsed?.length > 0) {
        setAiAutoResults(res.data);
        setShowAiParser(true);
        toast.success(`AI parsed ${res.data.parsed.length} document(s) — ${res.data.fields_updated.length} fields updated`);
        // Re-run eligibility with the updated data
        runCheck();
      }
    } catch (e) {
      // Silently fail auto-parse - not critical
      console.log('Auto-parse skipped:', e.response?.data?.detail);
    }
  };

  useEffect(() => {
    if (leadId) {
      runCheck();
      // Trigger auto-parse in background after a short delay
      const timer = setTimeout(() => autoParseDocuments(), 2000);
      return () => clearTimeout(timer);
    }
  }, [leadId]); // eslint-disable-line

  const toggle = (id) => setExpandedCards(prev => ({ ...prev, [id]: !prev[id] }));

  const handlePrint = () => {
    const content = printRef.current;
    if (!content) return;
    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
      <html><head><title>Bank Eligibility - ${data?.profile?.full_name || 'Lead'}</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 20px; color: #1e293b; font-size: 12px; }
        h1 { font-size: 18px; margin: 0 0 4px 0; } h2 { font-size: 14px; margin: 16px 0 8px; }
        .subtitle { color: #94a3b8; font-size: 11px; margin-bottom: 16px; }
        table { width: 100%; border-collapse: collapse; margin: 8px 0; }
        th, td { border: 1px solid #e2e8f0; padding: 6px 8px; text-align: left; font-size: 11px; }
        th { background: #f8fafc; font-weight: 600; }
        .pass { color: #15803d; } .fail { color: #dc2626; } .warn { color: #d97706; }
        .badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 10px; font-weight: 600; }
        .badge-green { background: #dcfce7; color: #166534; } .badge-amber { background: #fef3c7; color: #92400e; } .badge-red { background: #fee2e2; color: #991b1b; }
        .summary-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; margin: 12px 0; }
        .summary-box { text-align: center; border: 1px solid #e2e8f0; padding: 8px; border-radius: 6px; }
        .summary-box .val { font-size: 16px; font-weight: 700; } .summary-box .lbl { font-size: 9px; color: #94a3b8; }
        .section { margin: 16px 0; page-break-inside: avoid; }
        .disclaimer { font-size: 9px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 8px; margin-top: 20px; }
        @media print { body { margin: 10px; } }
      </style></head><body>
      <h1>Bank Eligibility Analysis — BankEzee</h1>
      <p class="subtitle">${data?.profile?.full_name || '—'} | ${data?.profile?.requirement || '—'} | Generated: ${new Date(data?.generated_at).toLocaleString()}</p>
      <div class="summary-grid">
        <div class="summary-box"><div class="val">${data?.profile?.cibil_score || '—'}</div><div class="lbl">CIBIL</div></div>
        <div class="summary-box"><div class="val">${data?.profile?.net_salary ? '₹' + Number(data.profile.net_salary).toLocaleString() : '—'}</div><div class="lbl">NET SALARY</div></div>
        <div class="summary-box"><div class="val">${data?.profile?.existing_emi ? '₹' + Number(data.profile.existing_emi).toLocaleString() : '—'}</div><div class="lbl">CURRENT EMI</div></div>
        <div class="summary-box"><div class="val">${data?.profile?.foir ? data.profile.foir + '%' : '—'}</div><div class="lbl">FOIR</div></div>
        <div class="summary-box"><div class="val">${data?.profile?.loan_amount_required ? formatAmt(data.profile.loan_amount_required) : '—'}</div><div class="lbl">REQUESTED</div></div>
        <div class="summary-box"><div class="val">${data?.profile?.company_type || '—'}</div><div class="lbl">COMPANY</div></div>
      </div>
      <p><b>Profile Strength:</b> ${data?.profile_strength || '—'} | <b>Eligible:</b> ${data?.eligible_count || 0} | <b>Possible:</b> ${data?.possibly_eligible_count || 0} | <b>Not Eligible:</b> ${data?.not_eligible_count || 0} / ${data?.total_policies || 0} lenders</p>
    `);

    // Comparison table for top banks
    const topBanks = (data?.results || []).filter(r => r.eligibility !== 'not_eligible').slice(0, 10);
    if (topBanks.length > 0) {
      printWindow.document.write(`
        <div class="section"><h2>Top Bank Comparison</h2>
        <table><thead><tr><th>Bank</th><th>Status</th><th>Eligible Amt</th><th>ROI</th><th>Tenure</th><th>Min Salary</th><th>CIBIL</th><th>BT</th><th>Top-up</th><th>Bachelor</th></tr></thead><tbody>
      `);
      topBanks.forEach(r => {
        const statusClass = r.eligibility === 'eligible' ? 'pass' : 'warn';
        printWindow.document.write(`<tr>
          <td><b>${r.bank_name}</b></td>
          <td class="${statusClass}">${r.eligibility === 'eligible' ? 'ELIGIBLE' : 'POSSIBLE'}</td>
          <td>${r.eligible_amount ? formatAmt(r.eligible_amount) : '—'}</td>
          <td>${r.roi_range || '—'}</td>
          <td>${r.tenure_text || '—'}</td>
          <td>${r.salary_text || '—'}</td>
          <td>${r.cibil_text || '—'}</td>
          <td>${r.bt_info?.bt_text || '—'}</td>
          <td>${r.bt_info?.topup_text || '—'}</td>
          <td>${r.bachelor_accommodation ? 'Yes' : 'No'}</td>
        </tr>`);
      });
      printWindow.document.write('</tbody></table></div>');
    }

    // Detailed per-bank analysis
    (data?.results || []).filter(r => r.eligibility !== 'not_eligible').forEach(r => {
      printWindow.document.write(`
        <div class="section"><h2>${r.bank_name} — <span class="${r.eligibility === 'eligible' ? 'pass' : 'warn'}">${r.eligibility === 'eligible' ? 'ELIGIBLE' : 'POSSIBLY ELIGIBLE'}</span></h2>
        <p>Amount: <b>${r.eligible_amount ? formatAmt(r.eligible_amount) : '—'}</b> | ROI: ${r.roi_range} | Tenure: ${r.tenure_text || '—'} | FOIR: ${r.foir_text || '—'}</p>
      `);
      const allRules = [...(r.reasons_pass || []), ...(r.reasons_fail || []), ...(r.reasons_warning || [])];
      if (allRules.length > 0) {
        printWindow.document.write('<table><thead><tr><th>Rule</th><th>Customer</th><th>Required</th><th>Result</th></tr></thead><tbody>');
        allRules.forEach(rr => {
          const cls = rr.result === 'PASS' ? 'pass' : rr.result === 'FAIL' ? 'fail' : 'warn';
          printWindow.document.write(`<tr><td>${rr.rule}</td><td>${rr.customer}</td><td>${rr.required}</td><td class="${cls}"><b>${rr.result}</b></td></tr>`);
        });
        printWindow.document.write('</tbody></table>');
      }
      if (r.special_features) printWindow.document.write(`<p><i>Features: ${r.special_features}</i></p>`);
      if (r.processing_fee) printWindow.document.write(`<p>Processing Fee: ${r.processing_fee}</p>`);
      printWindow.document.write('</div>');
    });

    printWindow.document.write(`
      <div class="disclaimer"><b>BankEzee Eligibility Estimate:</b> This assessment is indicative only and does not constitute lender approval. Final eligibility, loan amount, interest rate, tenure and terms are determined by the respective bank/NBFC after underwriting. Generated by ${data?.generated_by || '—'}.</div>
      </body></html>
    `);
    printWindow.document.close();
    printWindow.print();
  };

  if (!data && !loading) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="text-center">
        <Building2 className="w-16 h-16 mx-auto mb-4 text-slate-300" />
        <p className="text-sm text-slate-400 mb-3">Run eligibility analysis against all bank policies</p>
        <Button onClick={runCheck} data-testid="run-eligibility-btn">Run Eligibility Check</Button>
      </div>
    </div>
  );

  const eligible = (data?.results || []).filter(r => r.eligibility === 'eligible');
  const possibly = (data?.results || []).filter(r => r.eligibility === 'possibly_eligible');
  const notEligible = (data?.results || []).filter(r => r.eligibility === 'not_eligible');
  const p = data?.profile || {};

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b sticky top-0 z-10 shadow-sm">
        <div className="max-w-[1200px] mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => navigate(-1)} data-testid="back-btn">
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div>
              <h1 className="text-lg font-bold text-slate-800" data-testid="eligibility-title">Bank Eligibility Analysis</h1>
              <p className="text-xs text-slate-400">{p.full_name} — {p.requirement}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={runCheck} disabled={loading} data-testid="recheck-btn">
              <RefreshCw className={`w-4 h-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
              {loading ? 'Analysing...' : 'Recheck'}
            </Button>
            {data && (
              <>
                <Button size="sm" variant="outline" onClick={handlePrint} data-testid="print-btn">
                  <Printer className="w-4 h-4 mr-1" /> Print
                </Button>
                <Button size="sm" variant="outline" onClick={() => { setShowHistory(!showHistory); if (!showHistory && history.length === 0) loadHistory(); }} data-testid="history-btn">
                  <History className="w-4 h-4 mr-1" /> History
                </Button>
                <Button size="sm" variant="outline" className="border-violet-300 text-violet-700 hover:bg-violet-50" onClick={() => { setShowAiParser(!showAiParser); if (!showAiParser && leadDocs.length === 0) loadLeadDocs(); }} data-testid="ai-parse-btn">
                  <Sparkles className="w-4 h-4 mr-1" /> AI Parse Docs
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      {loading && (
        <div className="max-w-[1200px] mx-auto px-4 py-20 text-center">
          <RefreshCw className="w-12 h-12 mx-auto mb-4 text-primary animate-spin" />
          <p className="text-lg font-medium text-slate-600">Analysing eligibility across {data?.total_policies || '...'} lenders...</p>
          <p className="text-sm text-slate-400 mt-1">Checking salary, CIBIL, FOIR, company type, employment and more</p>
        </div>
      )}

      {data && !loading && (
        <div className="max-w-[1200px] mx-auto px-4 py-4 space-y-4" ref={printRef}>
          {/* Profile Summary */}
          <Card data-testid="profile-summary" className="border-slate-200">
            <CardContent className="py-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-slate-700">Customer Profile Summary</h2>
                <span className={`text-sm font-bold px-3 py-1 rounded-full ${
                  data.profile_strength === 'Strong' ? 'bg-green-100 text-green-700 border border-green-200' :
                  data.profile_strength === 'Moderate' ? 'bg-amber-100 text-amber-700 border border-amber-200' :
                  data.profile_strength === 'Fair' ? 'bg-blue-100 text-blue-700 border border-blue-200' :
                  data.profile_strength === 'Weak' ? 'bg-orange-100 text-orange-700 border border-orange-200' :
                  data.profile_strength === 'Not Eligible' ? 'bg-red-100 text-red-700 border border-red-200' : 'bg-slate-100 text-slate-500'
                }`} data-testid="profile-strength">{data.profile_strength} Profile</span>
              </div>
              <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
                {[
                  { val: p.cibil_score, label: 'CIBIL', fmt: v => v || '—' },
                  { val: p.net_salary, label: 'Net Salary', fmt: v => v ? `₹${Number(v).toLocaleString()}` : '—' },
                  { val: p.existing_emi, label: p.emi_source === 'CRM Data' ? 'Current EMI' : `EMI (${p.emi_source || 'auto'})`, fmt: v => v ? `₹${Number(v).toLocaleString()}` : '—' },
                  { val: p.foir, label: 'FOIR', fmt: v => v ? `${v}%` : '—' },
                  { val: p.loan_amount_required, label: 'Requested', fmt: v => v ? formatAmt(v) : '—' },
                  { val: p.company_type, label: 'Company', fmt: v => v || '—' },
                ].map((item, i) => (
                  <div key={i} className="text-center p-2 rounded-lg bg-slate-50 border">
                    <p className="text-lg font-bold text-slate-800">{item.fmt(item.val)}</p>
                    <p className="text-[10px] text-slate-400 uppercase">{item.label}</p>
                  </div>
                ))}
              </div>
              {/* Result counts */}
              <div className="flex gap-4 mt-3">
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-green-500"></span>
                  <span className="text-sm font-semibold text-green-700">{data.eligible_count} Eligible</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-500"></span>
                  <span className="text-sm font-semibold text-amber-700">{data.possibly_eligible_count} Possible</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-500"></span>
                  <span className="text-sm font-semibold text-red-500">{data.not_eligible_count} Not Eligible</span>
                </div>
                <span className="text-xs text-slate-400 ml-auto">of {data.total_policies} lenders checked</span>
              </div>

              {p.existing_loans_count > 0 && (
                <div className="mt-3 border-t pt-3" data-testid="eligibility-existing-loans">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-2">
                    <span className="text-xs font-semibold text-slate-700">
                      Existing Loans ({p.existing_loans_count})
                    </span>
                    <span className="text-xs text-slate-500">
                      EMI ₹{Number(p.existing_loans_emi || 0).toLocaleString()} · Outstanding ₹{Number(p.existing_loans_outstanding || 0).toLocaleString()}
                      {p.existing_loans_max_roi ? ` · Highest ROI ${p.existing_loans_max_roi}%` : ''}
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-slate-400 text-left">
                          <th className="py-1 pr-3 font-medium">Bank</th>
                          <th className="py-1 pr-3 font-medium">Type</th>
                          <th className="py-1 pr-3 font-medium">Amount</th>
                          <th className="py-1 pr-3 font-medium">Sanctioned</th>
                          <th className="py-1 pr-3 font-medium">Outstanding</th>
                          <th className="py-1 pr-3 font-medium">ROI</th>
                          <th className="py-1 font-medium">EMI</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(p.existing_loans || []).map((loan, i) => (
                          <tr key={i} className="border-t border-slate-100 text-slate-700">
                            <td className="py-1 pr-3">{loan.bank || '—'}</td>
                            <td className="py-1 pr-3">{loan.loan_type || '—'}</td>
                            <td className="py-1 pr-3">{loan.loan_amount ? `₹${Number(loan.loan_amount).toLocaleString()}` : '—'}</td>
                            <td className="py-1 pr-3">{loan.sanction_date || '—'}</td>
                            <td className="py-1 pr-3">{loan.outstanding ? `₹${Number(loan.outstanding).toLocaleString()}` : '—'}</td>
                            <td className="py-1 pr-3">{loan.roi ? `${loan.roi}%` : '—'}</td>
                            <td className="py-1">{loan.emi ? `₹${Number(loan.emi).toLocaleString()}` : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Side-by-Side Comparison Table */}
          {(() => {
            const topBanks = (data?.results || []).filter(r => r.eligibility !== 'not_eligible').slice(0, 8);
            if (topBanks.length === 0) return null;
            return (
              <Card data-testid="comparison-table" className="border-slate-200">
                <CardContent className="py-3 px-0">
                  <h2 className="text-sm font-bold text-slate-700 px-4 mb-2 flex items-center gap-2">
                    <Building2 className="w-4 h-4" /> Bank Comparison (Top {topBanks.length})
                  </h2>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b bg-slate-50">
                          <th className="text-left py-2 px-3 font-semibold text-slate-600 sticky left-0 bg-slate-50 z-[1]">Bank</th>
                          <th className="text-left py-2 px-3 font-semibold text-slate-600">Status</th>
                          <th className="text-right py-2 px-3 font-semibold text-slate-600">Eligible Amt</th>
                          <th className="text-left py-2 px-3 font-semibold text-slate-600">ROI</th>
                          <th className="text-left py-2 px-3 font-semibold text-slate-600">Tenure</th>
                          <th className="text-left py-2 px-3 font-semibold text-slate-600">Min Salary</th>
                          <th className="text-left py-2 px-3 font-semibold text-slate-600">CIBIL</th>
                          <th className="text-center py-2 px-3 font-semibold text-slate-600">BT</th>
                          <th className="text-center py-2 px-3 font-semibold text-slate-600">Top-up</th>
                          <th className="text-center py-2 px-3 font-semibold text-slate-600">Bachelor</th>
                          <th className="text-center py-2 px-3 font-semibold text-slate-600">Hostel</th>
                        </tr>
                      </thead>
                      <tbody>
                        {topBanks.map((r, i) => {
                          const sc = STATUS_CONFIG[r.eligibility];
                          return (
                            <tr key={r.policy_id} className={`border-b last:border-0 hover:bg-slate-50 ${i < 3 ? 'font-medium' : ''}`}>
                              <td className="py-2 px-3 font-semibold text-slate-800 sticky left-0 bg-white z-[1] whitespace-nowrap">
                                {r.rank && <RankBadge rank={r.rank} />} {r.bank_name}
                              </td>
                              <td className="py-2 px-3">
                                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${sc?.text} ${sc?.bg}`}>{sc?.label}</span>
                              </td>
                              <td className={`py-2 px-3 text-right font-bold ${sc?.text}`}>{r.eligible_amount ? formatAmt(r.eligible_amount) : '—'}</td>
                              <td className="py-2 px-3 text-slate-600 max-w-[150px] truncate">{r.roi_range || '—'}</td>
                              <td className="py-2 px-3 text-slate-600 whitespace-nowrap">{r.tenure_text || '—'}</td>
                              <td className="py-2 px-3 text-slate-600 whitespace-nowrap">{r.salary_text || '—'}</td>
                              <td className="py-2 px-3 text-slate-600 whitespace-nowrap">{r.cibil_text || '—'}</td>
                              <td className="py-2 px-3 text-center">{r.bt_info?.bt_allowed ? <CheckCircle className="w-3.5 h-3.5 text-green-500 mx-auto" /> : <XCircle className="w-3.5 h-3.5 text-slate-300 mx-auto" />}</td>
                              <td className="py-2 px-3 text-center">{r.bt_info?.topup_allowed ? <CheckCircle className="w-3.5 h-3.5 text-green-500 mx-auto" /> : <XCircle className="w-3.5 h-3.5 text-slate-300 mx-auto" />}</td>
                              <td className="py-2 px-3 text-center">{r.bachelor_accommodation ? <CheckCircle className="w-3.5 h-3.5 text-green-500 mx-auto" /> : <XCircle className="w-3.5 h-3.5 text-slate-300 mx-auto" />}</td>
                              <td className="py-2 px-3 text-center">{r.hostel_accommodation ? <CheckCircle className="w-3.5 h-3.5 text-green-500 mx-auto" /> : <XCircle className="w-3.5 h-3.5 text-slate-300 mx-auto" />}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            );
          })()}

          {/* Eligibility History Panel */}
          {showHistory && (
            <Card className="border-blue-200 bg-blue-50/30" data-testid="history-panel">
              <CardContent className="py-3">
                <h3 className="text-sm font-semibold text-blue-800 mb-2 flex items-center gap-2">
                  <History className="w-4 h-4" /> Previous Eligibility Checks
                </h3>
                {historyLoading ? (
                  <p className="text-xs text-slate-400">Loading history...</p>
                ) : history.length === 0 ? (
                  <p className="text-xs text-slate-400">No previous checks found</p>
                ) : (
                  <div className="space-y-2">
                    {history.map((h, i) => (
                      <div key={h.id} className={`text-xs p-2 rounded border bg-white ${i === 0 ? 'border-blue-200' : 'border-slate-200'}`}>
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-slate-700">
                            {new Date(h.generated_at).toLocaleString()} — by {h.generated_by}
                          </span>
                          <div className="flex gap-2">
                            <span className="text-green-600 font-semibold">{h.eligible_count} Eligible</span>
                            <span className="text-amber-600">{h.possibly_eligible_count} Possible</span>
                            <span className="text-red-500">{h.not_eligible_count} Not</span>
                          </div>
                        </div>
                        <span className="text-slate-400">{h.total_policies} policies | Profile: {h.profile_strength}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* AI Document Parser Panel */}
          {showAiParser && (
            <Card className="border-violet-200 bg-violet-50/30" data-testid="ai-parser-panel">
              <CardContent className="py-4">
                <h3 className="text-sm font-semibold text-violet-800 mb-3 flex items-center gap-2">
                  <Sparkles className="w-4 h-4" /> AI Document Parser
                </h3>
                <p className="text-xs text-violet-600 mb-3">Documents are auto-parsed when you open eligibility check. You can also manually parse individual documents below.</p>

                {/* Auto-parse results */}
                {aiAutoResults?.fields_updated?.length > 0 && (
                  <div className="mb-3 p-2 bg-green-50 border border-green-200 rounded text-xs">
                    <div className="flex items-center gap-1 text-green-700 font-semibold mb-1">
                      <CheckCircle className="w-3.5 h-3.5" /> AI Auto-Parsed {aiAutoResults.parsed?.length} document(s)
                    </div>
                    <div className="text-green-600">
                      {aiAutoResults.fields_updated.map((f, i) => <span key={i} className="inline-block mr-2">• {f}</span>)}
                    </div>
                  </div>
                )}

                {leadDocs.length === 0 ? (
                  <p className="text-xs text-slate-400">No documents uploaded for this lead. Upload documents in the lead detail page first.</p>
                ) : (
                  <div className="space-y-2">
                    {leadDocs.map((doc, i) => (
                      <div key={i} className="flex items-center justify-between p-2 bg-white rounded border text-xs">
                        <div className="flex items-center gap-2">
                          <FileText className="w-4 h-4 text-violet-500" />
                          <span className="font-medium text-slate-700">{doc.original_name || doc.file_name || `Document ${i+1}`}</span>
                          <span className="text-slate-400">{doc.document_type || 'general'}</span>
                        </div>
                        <div className="flex gap-1">
                          {['crif', 'salary_slip', 'bank_statement', 'form16'].map(dtype => (
                            <Button key={dtype} variant="outline" size="sm" className="h-6 text-[10px] px-2"
                              disabled={aiParsing}
                              onClick={() => parseDocument(i, dtype)}
                              data-testid={`parse-${dtype}-${i}`}>
                              {aiParsing ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                              {dtype === 'crif' ? 'CRIF' : dtype === 'salary_slip' ? 'Salary' : dtype === 'bank_statement' ? 'Bank Stmt' : 'Form 16'}
                            </Button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {aiParsing && (
                  <div className="mt-3 flex items-center gap-2 text-xs text-violet-600">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Parsing document with AI... This may take 10-30 seconds.
                  </div>
                )}

                {aiResults?.parsed_data && !aiResults.parsed_data.error && (
                  <div className="mt-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-semibold text-violet-700">Extracted Data — {aiResults.document_type?.toUpperCase()}</h4>
                      <Button size="sm" className="h-7 text-xs bg-violet-600 hover:bg-violet-700" onClick={applyParsedData} data-testid="apply-parsed-data">
                        <CheckCircle className="w-3 h-3 mr-1" /> Apply to Lead & Re-check
                      </Button>
                    </div>
                    <div className="bg-white rounded border p-3 text-xs space-y-1 max-h-[300px] overflow-y-auto">
                      {aiResults.document_type === 'crif' && (
                        <>
                          <div className="grid grid-cols-3 gap-2">
                            <div><b>CRIF Score:</b> {aiResults.parsed_data.credit_score || '—'}</div>
                            <div><b>Active Accounts:</b> {aiResults.parsed_data.active_accounts || '—'}</div>
                            <div><b>Outstanding:</b> ₹{(aiResults.parsed_data.total_outstanding_balance || 0).toLocaleString()}</div>
                            <div><b>Monthly EMI:</b> ₹{(aiResults.parsed_data.total_monthly_emi || 0).toLocaleString()}</div>
                            <div><b>CC Balance:</b> ₹{(aiResults.parsed_data.credit_card_total_balance || 0).toLocaleString()}</div>
                            <div><b>Credit Util:</b> {aiResults.parsed_data.credit_utilization_pct || '—'}%</div>
                            <div><b>Defaults:</b> {aiResults.parsed_data.defaults_count || 0}</div>
                            <div><b>Write-offs:</b> {aiResults.parsed_data.writeoffs_count || 0}</div>
                            <div><b>Issues:</b> {aiResults.parsed_data.cibil_issues_summary || '—'}</div>
                          </div>
                          {aiResults.parsed_data.active_loans?.length > 0 && (
                            <div className="mt-2">
                              <b>Active Loans:</b>
                              {aiResults.parsed_data.active_loans.map((l, i) => (
                                <div key={i} className="ml-2 text-slate-600">{l.lender} ({l.type}) — Balance: ₹{(l.balance||0).toLocaleString()} {l.emi ? `| EMI: ₹${l.emi.toLocaleString()}` : ''}</div>
                              ))}
                            </div>
                          )}
                          {aiResults.parsed_data.key_observations && (
                            <p className="mt-2 text-slate-500 italic">{aiResults.parsed_data.key_observations}</p>
                          )}
                        </>
                      )}
                      {aiResults.document_type === 'salary_slip' && (
                        <div className="grid grid-cols-3 gap-2">
                          <div><b>Net Salary:</b> ₹{(aiResults.parsed_data.net_salary || 0).toLocaleString()}</div>
                          <div><b>Gross:</b> ₹{(aiResults.parsed_data.gross_salary || 0).toLocaleString()}</div>
                          <div><b>Employer:</b> {aiResults.parsed_data.employer_name || '—'}</div>
                          <div><b>Employee:</b> {aiResults.parsed_data.employee_name || '—'}</div>
                          <div><b>Month:</b> {aiResults.parsed_data.month_year || '—'}</div>
                          <div><b>Deductions:</b> ₹{(aiResults.parsed_data.total_deductions || 0).toLocaleString()}</div>
                        </div>
                      )}
                      {aiResults.document_type === 'bank_statement' && (
                        <div className="grid grid-cols-3 gap-2">
                          <div><b>Salary Credit:</b> ₹{(aiResults.parsed_data.identified_salary_credit || 0).toLocaleString()}</div>
                          <div><b>Avg Balance:</b> ₹{(aiResults.parsed_data.average_monthly_balance || 0).toLocaleString()}</div>
                          <div><b>Total EMI:</b> ₹{(aiResults.parsed_data.total_identified_emi || 0).toLocaleString()}</div>
                          <div><b>Bounces:</b> {aiResults.parsed_data.bounce_count || 0}</div>
                          <div><b>Bank:</b> {aiResults.parsed_data.bank_name || '—'}</div>
                          <div><b>Period:</b> {aiResults.parsed_data.statement_period || '—'}</div>
                        </div>
                      )}
                      {!['crif', 'salary_slip', 'bank_statement'].includes(aiResults.document_type) && (
                        <pre className="text-[10px] whitespace-pre-wrap">{JSON.stringify(aiResults.parsed_data, null, 2)}</pre>
                      )}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Missing Info Alert */}
          {data.missing_info?.length > 0 && (
            <Card className="border-amber-200 bg-amber-50" data-testid="missing-info">
              <CardContent className="py-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <h3 className="text-sm font-semibold text-amber-800 mb-1">Missing Data — Confidence could improve</h3>
                    <div className="flex flex-wrap gap-2">
                      {data.missing_info.map((m, i) => (
                        <span key={i} className="text-xs bg-amber-100 text-amber-700 px-2 py-1 rounded border border-amber-200">{m} not available</span>
                      ))}
                    </div>
                    <Button variant="outline" size="sm" className="mt-2 h-7 text-xs border-amber-300 text-amber-700 hover:bg-amber-100" onClick={() => navigate(`/files/${leadId}`)}>
                      <Upload className="w-3 h-3 mr-1" /> Update Lead Data / Upload Documents
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Recommended Options */}
          {eligible.length > 0 && (
            <div>
              <h2 className="text-sm font-bold text-slate-700 mb-2 flex items-center gap-2" data-testid="eligible-section">
                <Trophy className="w-4 h-4 text-green-600" /> RECOMMENDED OPTIONS ({eligible.length})
              </h2>
              {eligible.map(r => <BankCard key={r.policy_id} r={r} expanded={expandedCards[r.policy_id]} onToggle={() => toggle(r.policy_id)} />)}
            </div>
          )}

          {/* Possibly Eligible */}
          {possibly.length > 0 && (
            <div>
              <h2 className="text-sm font-bold text-slate-700 mb-2 flex items-center gap-2" data-testid="possible-section">
                <HelpCircle className="w-4 h-4 text-amber-500" /> POSSIBLY ELIGIBLE — MANUAL CHECK REQUIRED ({possibly.length})
              </h2>
              {possibly.map(r => <BankCard key={r.policy_id} r={r} expanded={expandedCards[r.policy_id]} onToggle={() => toggle(r.policy_id)} />)}
            </div>
          )}

          {/* Not Eligible */}
          {notEligible.length > 0 && (
            <div>
              <Button variant="ghost" size="sm" className="mb-2 text-red-500 hover:bg-red-50" onClick={() => setShowNotEligible(!showNotEligible)} data-testid="not-eligible-toggle">
                {showNotEligible ? <ChevronUp className="w-4 h-4 mr-1" /> : <ChevronDown className="w-4 h-4 mr-1" />}
                NOT CURRENTLY ELIGIBLE ({notEligible.length} lenders)
              </Button>
              {showNotEligible && notEligible.map(r => <BankCard key={r.policy_id} r={r} expanded={expandedCards[r.policy_id]} onToggle={() => toggle(r.policy_id)} />)}
            </div>
          )}

          {/* Disclaimer */}
          <div className="text-[10px] text-slate-400 bg-slate-100 p-3 rounded-lg border mt-6" data-testid="disclaimer">
            <b>BankEzee Eligibility Estimate:</b> This assessment is generated using available customer information and BankEzee policy data. It is indicative only and does not constitute lender approval. Final eligibility, loan amount, interest rate, tenure and terms are determined by the respective bank/NBFC after underwriting and verification.
          </div>
          <p className="text-[9px] text-slate-300 text-center pb-4">Generated by {data.generated_by} on {new Date(data.generated_at).toLocaleString()} | {data.total_policies} policies evaluated</p>
        </div>
      )}
    </div>
  );
}

function BankCard({ r, expanded, onToggle }) {
  const cfg = STATUS_CONFIG[r.eligibility] || STATUS_CONFIG.not_eligible;
  const Icon = cfg.icon;

  return (
    <Card className={`mb-2 border ${cfg.bg} transition-shadow hover:shadow-md`} data-testid={`bank-card-${r.bank_name}`}>
      <CardContent className="py-3 px-4">
        {/* Header Row */}
        <div className="flex items-start justify-between cursor-pointer" onClick={onToggle}>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              <RankBadge rank={r.rank} />
              <h3 className="font-bold text-base text-slate-800">{r.bank_name}</h3>
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border flex items-center gap-1 ${cfg.text} ${cfg.bg}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`}></span> {cfg.label}
              </span>
              <ConfBadge level={r.confidence} />
            </div>
            {/* Key metrics row */}
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
              <span className="text-slate-600">Amount: <b className={cfg.text}>{r.eligible_amount ? formatAmt(r.eligible_amount) : '—'}</b></span>
              <span className="text-slate-600">ROI: <b className="text-slate-700">{r.roi_range || '—'}</b></span>
              {r.tenure_text && <span className="text-slate-600">Tenure: <b className="text-slate-700">{r.tenure_text}</b></span>}
              {r.estimated_emi && <span className="text-slate-600">Est. EMI: <b className="text-slate-700">{formatAmt(r.estimated_emi)}</b></span>}
              {r.salary_text && <span className="text-slate-600">Min Salary: <b className="text-slate-700">{r.salary_text}</b></span>}
              {r.cibil_text && <span className="text-slate-600">CIBIL: <b className="text-slate-700">{r.cibil_text}</b></span>}
            </div>
            {/* Quick tags */}
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              <QuickTag positive={r.bt_info?.bt_allowed} label={`BT: ${r.bt_info?.bt_text || (r.bt_info?.bt_allowed ? 'Yes' : 'No')}`} />
              <QuickTag positive={r.bt_info?.topup_allowed} label={`Top-up: ${r.bt_info?.topup_text || (r.bt_info?.topup_allowed ? 'Yes' : 'No')}`} />
              {r.bachelor_accommodation !== undefined && <QuickTag positive={r.bachelor_accommodation} label={`Bachelor: ${r.bachelor_accommodation ? 'Yes' : 'No'}`} />}
              {r.hostel_accommodation !== undefined && <QuickTag positive={r.hostel_accommodation} label={`Hostel: ${r.hostel_accommodation ? 'Yes' : 'No'}`} />}
              {/* Historical case learning badge */}
              {r.historical && r.historical.total_approved > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded border bg-blue-50 text-blue-700 border-blue-200 font-medium">
                  {r.historical.similar_approved > 0
                    ? `${r.historical.similar_approved} similar case${r.historical.similar_approved > 1 ? 's' : ''} approved`
                    : `${r.historical.total_approved} past approval${r.historical.total_approved > 1 ? 's' : ''}`}
                  {r.historical.approval_rate ? ` (${r.historical.approval_rate}% rate)` : ''}
                </span>
              )}
              {r.historical && r.historical.total_disbursed > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded border bg-emerald-50 text-emerald-700 border-emerald-200 font-medium">
                  {r.historical.total_disbursed} disbursed
                  {r.historical.avg_approved_amount > 0 ? ` (avg ₹${(r.historical.avg_approved_amount / 100000).toFixed(1)}L)` : ''}
                </span>
              )}
            </div>
          </div>
          <div className="ml-2 mt-1">
            {expanded ? <ChevronUp className="w-5 h-5 text-slate-400" /> : <ChevronDown className="w-5 h-5 text-slate-400" />}
          </div>
        </div>

        {/* Expanded Detail */}
        {expanded && (
          <div className="mt-3 pt-3 border-t space-y-4">
            {/* Policy Details Grid */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 p-3 bg-white/60 rounded-lg border">
              <InfoPill icon={Banknote} label="Salary Req" value={r.salary_text} />
              <InfoPill icon={Shield} label="CIBIL" value={r.cibil_text} />
              <InfoPill icon={Clock} label="Age" value={r.age_text} />
              <InfoPill icon={Banknote} label="Loan Range" value={r.loan_amount_text} />
              <InfoPill icon={null} label="FOIR" value={r.foir_text} />
              <InfoPill icon={Users} label="Eligible Employees" value={r.eligible_employees} />
              <InfoPill icon={Building2} label="Company" value={r.company_requirement_text} />
              <InfoPill icon={Clock} label="Present Emp" value={r.present_employment_text} />
              <InfoPill icon={Clock} label="Total Emp" value={r.total_employment_text} />
              {r.applicable_profiles?.length > 0 && (
                <InfoPill icon={Users} label="Profiles" value={r.applicable_profiles.map(p => p === 'self_employed' ? 'Self Employed' : p.charAt(0).toUpperCase() + p.slice(1)).join(', ')} />
              )}
            </div>

            {/* BT Details */}
            {(r.bt_info?.bt_text || r.bt_info?.bt_app_loans_text || r.bt_info?.topup_text) && (
              <div className="p-3 bg-white/60 rounded-lg border">
                <h4 className="text-xs font-semibold text-slate-600 mb-1.5">BALANCE TRANSFER & TOP-UP</h4>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  <InfoPill label="BT" value={r.bt_info?.bt_text} />
                  <InfoPill label="App Loan BT" value={r.bt_info?.bt_app_loans_text} />
                  <InfoPill label="CC BT" value={r.bt_info?.cc_bt_allowed ? 'Yes' : 'No'} />
                  <InfoPill label="Top-up" value={r.bt_info?.topup_text} />
                </div>
              </div>
            )}

            {/* Historical Case Learning */}
            {r.historical && (r.historical.total_approved > 0 || r.historical.total_logins > 0) && (
              <div className="p-3 bg-blue-50/60 rounded-lg border border-blue-100">
                <h4 className="text-xs font-semibold text-blue-700 mb-1.5 flex items-center gap-1">
                  <History className="w-3.5 h-3.5" /> HISTORICAL CASE DATA
                </h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                  <div><span className="text-slate-500">Total Cases:</span> <b>{r.historical.total_cases}</b></div>
                  <div><span className="text-slate-500">Logins:</span> <b>{r.historical.total_logins}</b></div>
                  <div><span className="text-slate-500">Approved:</span> <b className="text-green-700">{r.historical.total_approved}</b></div>
                  <div><span className="text-slate-500">Disbursed:</span> <b className="text-emerald-700">{r.historical.total_disbursed}</b></div>
                  {r.historical.approval_rate !== null && (
                    <div><span className="text-slate-500">Approval Rate:</span> <b className="text-blue-700">{r.historical.approval_rate}%</b></div>
                  )}
                  {r.historical.avg_approved_amount > 0 && (
                    <div><span className="text-slate-500">Avg Approved:</span> <b>{formatAmt(r.historical.avg_approved_amount)}</b></div>
                  )}
                  {r.historical.similar_approved > 0 && (
                    <div className="col-span-2"><span className="text-slate-500">Similar profiles approved:</span> <b className="text-blue-700">{r.historical.similar_approved}</b></div>
                  )}
                </div>
              </div>
            )}

            {/* Pass reasons */}
            {r.reasons_pass?.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-green-700 mb-1 flex items-center gap-1">
                  <CheckCircle className="w-3.5 h-3.5" /> ELIGIBILITY CRITERIA MET
                </h4>
                <div className="overflow-x-auto">
                  <table className="w-full"><tbody>{r.reasons_pass.map((rr, i) => <RuleRow key={i} r={rr} />)}</tbody></table>
                </div>
              </div>
            )}
            {/* Fail reasons */}
            {r.reasons_fail?.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-red-700 mb-1 flex items-center gap-1">
                  <XCircle className="w-3.5 h-3.5" /> REASON(S) NOT ELIGIBLE
                </h4>
                <div className="overflow-x-auto">
                  <table className="w-full"><tbody>{r.reasons_fail.map((rr, i) => <RuleRow key={i} r={rr} />)}</tbody></table>
                </div>
              </div>
            )}
            {/* Warnings */}
            {r.reasons_warning?.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-amber-700 mb-1 flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5" /> RISKS / MISSING DATA
                </h4>
                <div className="overflow-x-auto">
                  <table className="w-full"><tbody>{r.reasons_warning.map((rr, i) => <RuleRow key={i} r={rr} />)}</tbody></table>
                </div>
              </div>
            )}

            {/* Footer details */}
            <div className="space-y-1.5 pt-1">
              {r.special_features && (
                <p className="text-xs text-slate-600"><b className="text-slate-700">Features:</b> {r.special_features}</p>
              )}
              {r.special_notes && (
                <p className="text-xs text-slate-500 italic">{r.special_notes}</p>
              )}
              {r.processing_fee && (
                <p className="text-xs text-slate-500"><b>Processing Fee:</b> {r.processing_fee}</p>
              )}
              {r.required_documents?.length > 0 && (
                <div className="flex items-start gap-1.5 text-xs text-slate-500">
                  <FileText className="w-3 h-3 mt-0.5 shrink-0" />
                  <span><b>Documents:</b> {Array.isArray(r.required_documents) ? r.required_documents.join(', ') : r.required_documents}</span>
                </div>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function QuickTag({ positive, label }) {
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${
      positive ? 'bg-green-50 text-green-700 border-green-200' : 'bg-slate-50 text-slate-500 border-slate-200'
    }`}>{label}</span>
  );
}
