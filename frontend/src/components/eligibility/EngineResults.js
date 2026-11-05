import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import api from '../../services/api';
import { FileSearch, RefreshCw, AlertTriangle, CheckCircle2, XCircle, HelpCircle } from 'lucide-react';

const inr = (v) => (v == null ? '—' : `₹${Math.round(v).toLocaleString('en-IN')}`);
const pct = (v) => (v == null ? 'Unavailable' : `${v}%`);
const ST = { Eligible: ['text-emerald-700 bg-emerald-50 border-emerald-200', CheckCircle2], 'Not Eligible': ['text-red-700 bg-red-50 border-red-200', XCircle], 'Needs Review': ['text-amber-800 bg-amber-50 border-amber-200', HelpCircle] };
const DOC_TONE = { Completed: 'text-emerald-700', 'Needs Review': 'text-amber-700', Failed: 'text-red-600', Processing: 'text-sky-700' };

// Shared "Read Documents" status panel — same backend service for Connect and Meta files.
export const DocumentReader = ({ scope, refId, onDone }) => {
  const [s, setS] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = () => api.get(`/doc-extract/${scope}/${refId}`).then(({ data }) => setS(data)).catch(() => {});
  useEffect(() => { load(); }, [scope, refId]); // eslint-disable-line react-hooks/exhaustive-deps
  const [wasBusy, setWasBusy] = useState(false);
  useEffect(() => {
    if (s?.processing) { setWasBusy(true); const t = setTimeout(load, 5000); return () => clearTimeout(t); }
    if (wasBusy && s) { setWasBusy(false); onDone && onDone(); }
  }, [s]); // eslint-disable-line react-hooks/exhaustive-deps
  const read = async (force) => {
    setBusy(true);
    try { const { data } = await api.post(`/doc-extract/${scope}/${refId}/read-documents`, null, { params: { force } }); setS(data); toast.success('Documents read'); onDone && onDone(); }
    catch (e) { toast.error(e?.response?.data?.detail || 'Document reading failed'); } finally { setBusy(false); }
  };
  return (
    <div className="bg-white border rounded-lg p-4" data-testid="doc-reader">
      <div className="flex items-center gap-2 mb-2">
        <FileSearch className="w-4 h-4 text-slate-500" /><h3 className="text-sm font-semibold text-slate-800 mr-auto">Document reading (payslips & credit reports)</h3>
        <button data-testid="doc-read-btn" disabled={busy} onClick={() => read(false)} className="text-xs border rounded-md px-2.5 py-1 disabled:opacity-50">{busy ? 'Reading…' : 'Read Documents'}</button>
        <button data-testid="doc-reprocess-btn" disabled={busy} onClick={() => read(true)} className="text-xs text-sky-700 inline-flex items-center gap-1"><RefreshCw className="w-3 h-3" />Reprocess all</button>
      </div>
      {s?.processing && <p className="text-xs text-sky-700 mb-1" data-testid="doc-processing">Reading uploaded documents in the background — results appear here automatically.</p>}
      {!s?.documents?.length ? <p className="text-xs text-slate-400">{s?.processing ? '' : 'No documents processed yet. Uploads are read automatically.'}</p> : s.documents.map((d) => (
        <p key={d.doc_id} className="text-xs flex gap-2 py-0.5" data-testid={`doc-status-${d.doc_id}`}><span className="truncate max-w-[260px]">{d.doc_name}</span><b className={DOC_TONE[d.status]}>{d.status}</b><span className="text-slate-500">{d.message}</span></p>
      ))}
      {s?.names_seen?.length > 1 && <p className="text-xs text-red-600 mt-1" data-testid="doc-name-mismatch">Different customer names across documents: {s.names_seen.join(', ')} — check the documents belong to this customer.</p>}
      {s?.conflicts?.length > 0 && (
        <div className="mt-2 text-xs rounded-md bg-amber-50 border border-amber-200 p-2" data-testid="doc-conflicts">
          <b>Manual values kept — extracted values differ (review):</b>
          {s.conflicts.map((c, i) => <p key={i}>{c.field}: saved {String(c.current)} · document {String(c.extracted)} ({c.source?.doc || c.source?.type})</p>)}
        </div>
      )}
    </div>
  );
};

const Profile = ({ e }) => {
  const p = e.profile, c = e.credit;
  return (
    <div className="bg-white border rounded-lg p-4" data-testid="engine-profile">
      <h3 className="text-sm font-semibold text-slate-800 mb-2">Profile Analysis</h3>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
        <div><p className="text-[11px] text-slate-500">Net monthly salary</p><p className="font-semibold" data-testid="engine-salary">{p.net_salary ? inr(p.net_salary) : 'Missing'}</p><p className="text-[10px] text-slate-400">{p.salary_basis}</p></div>
        <div><p className="text-[11px] text-slate-500">Monthly EMI Obligations (₹, loans)</p><p className="font-semibold" data-testid="engine-emi">{inr(p.obligations_from_loans)}</p><p className="text-[10px] text-slate-400">Card obligations depend on each bank's rule</p></div>
        <div><p className="text-[11px] text-slate-500">Existing FOIR</p><p className="font-semibold" data-testid="engine-foir">{pct(p.existing_foir)}</p></div>
        <div><p className="text-[11px] text-slate-500">CIBIL score</p><p className="font-semibold" data-testid="engine-cibil">{p.cibil_score ?? 'Missing'}</p></div>
        <div><p className="text-[11px] text-slate-500">Credit issues</p><p className="font-semibold" data-testid="engine-credit-cat">{c.category || 'Needs Review'}</p><p className="text-[10px] text-slate-400">{c.assessment}</p></div>
      </div>
      <ul className="mt-2 text-xs text-slate-600 list-disc pl-4" data-testid="engine-credit-reasons">{(c.reasons || []).map((r, i) => <li key={i}>{r}</li>)}
        {c.history_period && <li>History covered: {c.history_period}</li>}</ul>
      <p className="text-[10px] text-slate-400 mt-1">Internal screening category — each bank's own rules are applied separately below.</p>
    </div>
  );
};

const Bank = ({ b }) => {
  const [tone, Icon] = ST[b.status] || ST['Needs Review'];
  const sel = b.accounts.filter((a) => a.bt === 'Selected for BT');
  const kept = b.accounts.filter((a) => a.bt !== 'Selected for BT' && a.bt !== 'Excluded');
  return (
    <div className={`border rounded-lg p-3 ${tone}`} data-testid={`engine-bank-${b.bank_name}`}>
      <div className="flex flex-wrap items-center gap-2"><Icon className="w-4 h-4" /><b className="text-sm">{b.bank_name}</b><span className="text-xs font-semibold" data-testid="engine-bank-status">{b.status}</span>
        <span className="ml-auto text-xs text-slate-700">FOIR {pct(b.existing_foir)} → post-BT {pct(b.post_bt_foir)} (max {b.max_foir ?? '—'}%)</span></div>
      {b.proposed_amount != null && <p className="text-xs text-slate-700 mt-1">Proposed {inr(b.proposed_amount)} · {b.tenure} months · {b.roi}% · EMI {inr(b.proposed_emi)} · BT total {inr(b.bt_outstanding)} · retained obligations {inr(b.retained_obligations)}/month · max eligible {inr(b.max_eligible_amount)}{b.additional_amount != null ? ` · additional ${inr(b.additional_amount)}` : ''}</p>}
      {sel.length > 0 && <p className="text-xs mt-1"><b>BT selected:</b> {sel.map((a) => `${a.lender} ${inr(a.outstanding)} (${a.seasoning.months ?? '?'} mo)`).join(' · ')}</p>}
      {kept.length > 0 && <p className="text-xs mt-1 text-slate-700"><b>Retained:</b> {kept.map((a) => `${a.lender} ${a.obligation == null ? 'EMI unknown' : inr(a.obligation) + '/mo'}${a.bt_reason ? ` — ${a.bt_reason}` : ''}`).join(' · ')}</p>}
      {[...b.reasons, ...b.missing.map((m) => `Missing: ${m}`), ...b.notes].map((r, i) => <p key={i} className="text-xs flex items-start gap-1 mt-0.5"><AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />{r}</p>)}
      {b.assumptions && <p className="text-[10px] text-slate-500 mt-1">{b.assumptions.join('; ')}</p>}
    </div>
  );
};

export const EngineResults = ({ engine }) => {
  if (!engine) return null;
  return (
    <div className="space-y-3" data-testid="engine-results">
      <Profile e={engine} />
      <div className="bg-white border rounded-lg p-4 space-y-2">
        <h3 className="text-sm font-semibold text-slate-800">Bank-by-bank BT &amp; FOIR <span className="text-[10px] font-normal text-slate-400">engine {engine.engine_version} · as of {engine.as_of} · inputs {engine.inputs_hash}</span></h3>
        {engine.banks.length === 0 ? <p className="text-xs text-slate-400">No active bank policies.</p> : engine.banks.map((b) => <Bank key={b.policy_id || b.bank_name} b={b} />)}
      </div>
    </div>
  );
};
