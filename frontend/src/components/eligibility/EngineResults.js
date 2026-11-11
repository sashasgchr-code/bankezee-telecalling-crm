import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import api from '../../services/api';
import { FileSearch, RefreshCw, AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';

export const inr = (v) => (v == null ? '—' : `₹${Math.round(v).toLocaleString('en-IN')}`);
const pct = (v) => (v == null ? 'Unavailable' : `${v}%`);
const DOC_TONE = { Extracted: 'text-emerald-700', 'Needs Review': 'text-amber-700', Failed: 'text-red-600', Processing: 'text-sky-700', 'Password Required': 'text-orange-700', Unsupported: 'text-slate-400' };
const src = (s) => [s?.doc, s?.page ? `p.${s.page}` : null, s?.report_date || s?.period].filter(Boolean).join(' · ');
const show = (v) => (v == null || v === '' ? '—' : typeof v === 'number' ? v.toLocaleString('en-IN') : String(v));

const DocRow = ({ d, onRetry }) => {
  const [pw, setPw] = useState('');
  return (
    <div className="text-xs flex flex-wrap items-center gap-2 py-0.5" data-testid={`doc-status-${d.doc_id}`}>
      <span className="truncate max-w-[260px]">{d.doc_name}</span><b className={DOC_TONE[d.status]}>{d.status}</b>
      <span className="text-slate-500">{d.summary || d.message}</span>
      {d.status === 'Password Required' && <><input data-testid={`doc-pw-${d.doc_id}`} type="password" placeholder="PDF password" value={pw} onChange={(e) => setPw(e.target.value)} className="border rounded px-1.5 py-0.5 w-28" />
        <button data-testid={`doc-unlock-${d.doc_id}`} onClick={() => onRetry(d.doc_id, pw)} className="text-sky-700">Unlock & read</button></>}
      {['Failed', 'Needs Review'].includes(d.status) && <button data-testid={`doc-retry-${d.doc_id}`} onClick={() => onRetry(d.doc_id)} className="text-sky-700">Retry</button>}
    </div>
  );
};

const Conflict = ({ c, onResolve }) => (
  <div className="border-t border-amber-200 py-1.5 flex flex-wrap items-start gap-2" data-testid={`conflict-${c.id}`}>
    <div className="flex-1 min-w-[240px]">
      <b>{c.label}</b>
      {c.kind === 'field' ? <p>Current: <b>{show(c.current)}</b> · Document: <b>{show(c.extracted)}</b></p>
        : Object.entries(c.diffs).map(([k, v]) => <p key={k}>{k.replace('_', ' ')}: current <b>{show(v.current)}</b> · document <b>{show(v.extracted)}</b></p>)}
      <p className="text-slate-500">Source: {src(c.source) || c.source?.type}</p>
    </div>
    <button data-testid={`conflict-apply-${c.id}`} onClick={() => onResolve(c.id, 'apply')} className="bg-amber-600 text-white rounded px-2 py-0.5">Apply extracted</button>
    <button data-testid={`conflict-keep-${c.id}`} onClick={() => onResolve(c.id, 'keep')} className="border rounded px-2 py-0.5 bg-white">Keep current</button>
  </div>
);

// Shared document reader — same backend service for Connect and Meta files.
export const DocumentReader = ({ scope, refId, onDone }) => {
  const [s, setS] = useState(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [wasBusy, setWasBusy] = useState(false);
  const base = `/doc-extract/${scope}/${refId}`;
  const load = () => api.get(base).then(({ data }) => setS(data)).catch(() => {});
  useEffect(() => { load(); }, [scope, refId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (s?.processing) { setWasBusy(true); const t = setTimeout(load, 5000); return () => clearTimeout(t); }
    if (wasBusy && s) { setWasBusy(false); onDone && onDone(); }
  }, [s]); // eslint-disable-line react-hooks/exhaustive-deps
  const act = async (fn, ok) => {
    if (busy) return;
    setBusy(true);
    try { const { data } = await fn(); setS(data); if (ok) toast.success(ok); onDone && onDone(); }
    catch (e) { toast.error(e?.response?.data?.detail || 'Action failed'); } finally { setBusy(false); }
  };
  const docs = s?.documents || [];
  const count = (st) => docs.filter((d) => d.status === st).length;
  return (
    <div className="bg-white border rounded-lg p-4" data-testid="doc-reader">
      <div className="flex flex-wrap items-center gap-2">
        <FileSearch className="w-4 h-4 text-slate-500" />
        <button data-testid="doc-reader-toggle" onClick={() => setOpen(!open)} className="text-sm font-semibold text-slate-800 inline-flex items-center gap-1 mr-auto">
          {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}Document reading
          <span className="text-xs font-normal text-slate-500" data-testid="doc-summary">· {count('Extracted')} read · {count('Unsupported')} not applicable · {count('Needs Review') + count('Password Required')} need action · {count('Failed')} failed</span>
        </button>
        <button data-testid="doc-read-btn" disabled={busy || s?.processing} onClick={() => act(() => api.post(`${base}/read-documents`), 'Documents read')} className="text-xs border rounded-md px-2.5 py-1 disabled:opacity-50">{busy || s?.processing ? 'Reading…' : 'Read new documents'}</button>
        <button data-testid="doc-reprocess-btn" disabled={busy || s?.processing} onClick={() => act(() => api.post(`${base}/read-documents`, null, { params: { force: true } }), 'All documents re-read')} className="text-xs text-sky-700 inline-flex items-center gap-1 disabled:opacity-50"><RefreshCw className="w-3 h-3" />Reprocess all</button>
      </div>
      {s?.processing && <p className="text-xs text-sky-700 mt-1" data-testid="doc-processing">Reading documents in the background — the page updates when finished.</p>}
      {open && <div className="mt-2" data-testid="doc-list">{docs.length ? docs.map((d) => <DocRow key={d.doc_id} d={d} onRetry={(id, password) => act(() => api.post(`${base}/documents/${id}/retry`, { password: password || null }), 'Document re-read')} />)
        : <p className="text-xs text-slate-400">No documents read yet.</p>}</div>}
      {s?.name_review?.length > 0 && <p className="text-xs text-red-600 mt-2" data-testid="doc-name-mismatch">Name on document differs from this customer: {s.name_review.join(', ')} — confirm the document belongs to this customer.</p>}
      {s?.conflicts?.length > 0 && (
        <div className="mt-2 text-xs rounded-md bg-amber-50 border border-amber-200 p-2" data-testid="doc-conflicts">
          <p className="font-semibold text-amber-800 mb-1"><AlertTriangle className="w-3 h-3 inline mr-1" />{s.conflicts.length} saved value(s) differ from the documents — choose which to keep</p>
          {s.conflicts.map((c) => <Conflict key={c.id} c={c} onResolve={(id, action) => act(() => api.post(`${base}/conflicts/${id}`, { action }), action === 'apply' ? 'Applied and saved' : 'Kept current value')} />)}
        </div>
      )}
    </div>
  );
};

// Credit + obligations block inside the original Customer Profile Summary.
export const CreditSummary = ({ meta }) => {
  const [open, setOpen] = useState(false);
  if (!meta) return null;
  const p = meta.profile, c = meta.credit;
  return (
    <div className="mt-3 border-t pt-3 grid md:grid-cols-2 gap-3 text-xs" data-testid="credit-summary">
      <div>
        <p className="font-semibold text-slate-700">Obligations</p>
        <p data-testid="summary-loan-emi">Loan EMIs: <b>{p.obligations_known ? inr(p.obligations_from_loans) : 'Unavailable / Needs Review'}</b>{p.active_loans ? ` (${p.active_loans} active loans)` : ''}</p>
        <p data-testid="summary-cards">Credit cards: <b>{p.credit_cards}</b>{p.credit_cards ? ` · outstanding ${inr(p.card_outstanding)} — obligation per each bank's card rule` : ''}</p>
        <p data-testid="summary-foir">Existing FOIR (loan EMIs): <b>{p.obligations_known ? pct(p.existing_foir) : 'Unavailable / Needs Review'}</b>{p.foir_basis === 'partial' && p.obligations_known ? ' — on available EMIs only' : ''}</p>
        {p.emi_missing_for?.length > 0 && <p className="text-amber-700" data-testid="summary-emi-missing">EMI missing for: {p.emi_missing_for.join(', ')}</p>}
        <p className="text-slate-400">Salary basis: {p.salary_basis}</p>
      </div>
      <div>
        <p className="font-semibold text-slate-700">Credit issues: <span data-testid="summary-credit-cat" className={c.category && c.category !== 'No Issues' ? 'text-amber-700' : ''}>{c.category || 'Needs Review'}</span>
          <span className="font-normal text-slate-400"> {c.report_date ? `· report ${c.report_date}` : ''}{c.history_period ? ` · ${c.history_period} history` : ''}</span></p>
        <ul className="list-disc pl-4 text-slate-600" data-testid="summary-credit-reasons">{(c.reasons || []).map((r, i) => <li key={i}>{r}</li>)}</ul>
        {c.events?.length > 0 && <button data-testid="credit-events-toggle" className="text-sky-700" onClick={() => setOpen(!open)}>{open ? 'Hide' : 'Show'} {c.events.length} late-payment events</button>}
        {open && <ul className="text-slate-500 pl-4" data-testid="credit-events">{c.events.map((e, i) => <li key={i}>{e.month} — {e.lender} ({e.account})</li>)}</ul>}
      </div>
    </div>
  );
};

// Calculation details inside each original expandable lender card.
export const CalcDetails = ({ calc }) => {
  if (!calc || !calc.bank_name) return null;
  const sel = (calc.accounts || []).filter((a) => a.bt === 'Selected for BT');
  const kept = (calc.accounts || []).filter((a) => a.bt !== 'Selected for BT' && a.bt !== 'Excluded');
  const cells = [['Eligible amount', inr(calc.proposed_amount)], ['BT amount', inr(calc.bt_outstanding)], ['Additional / top-up', calc.additional_amount == null ? '—' : inr(calc.additional_amount)],
    ['ROI', calc.roi ? `${calc.roi}%` : '—'], ['Tenure', calc.tenure ? `${calc.tenure} months` : '—'], ['Proposed EMI', inr(calc.proposed_emi)],
    ['Existing FOIR', pct(calc.existing_foir) + (calc.foir_basis === 'partial' && calc.existing_foir != null ? ' (partial)' : '')], ['Post-BT FOIR', pct(calc.post_bt_foir)], ['Max FOIR', calc.max_foir ? `${calc.max_foir}%` : '—']];
  return (
    <div className="p-3 bg-white/60 rounded-lg border text-xs space-y-1" data-testid={`calc-${calc.bank_name}`}>
      <p className="font-semibold text-slate-700">BT & FOIR calculation{calc.foir_basis === 'partial' && <span className="font-normal text-amber-700"> · indicative — some EMIs / card obligations missing, amounts may be lower</span>}</p>
      <div className="grid grid-cols-3 md:grid-cols-9 gap-2">{cells.map(([l, v]) => <div key={l}><p className="text-[10px] text-slate-400">{l}</p><p className="font-semibold">{v}</p></div>)}</div>
      {sel.length > 0 && <p><b>Closed via BT:</b> {sel.map((a) => `${a.lender} ${inr(a.outstanding)} (EMI ${inr(a.obligation)} removed)`).join(' · ')}</p>}
      {kept.length > 0 && <p className="text-slate-600"><b>Retained obligations{calc.retained_obligations != null ? ` ${inr(calc.retained_obligations)}/month` : ''}:</b> {kept.map((a) => `${a.lender} ${a.obligation == null ? 'EMI missing' : inr(a.obligation)}${a.bt_reason && !(a.obligation == null && /EMI missing/.test(a.bt_reason)) ? ` — ${a.bt_reason}` : ''}`).join(' · ')}</p>}
      {(calc.notes || []).map((n, i) => <p key={i} className="text-slate-500">{n}</p>)}
      {calc.assumptions && <p className="text-[10px] text-slate-400">{calc.assumptions.join('; ')}</p>}
    </div>
  );
};
