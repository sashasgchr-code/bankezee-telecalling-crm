import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import api from '../../services/api';
import { Scale, RefreshCw } from 'lucide-react';

export const REASONS = {
  'Bank policy changed': 'policy_change',
  'Wrong or missing customer data': 'customer_correction',
  'Company category differs at bank': 'customer_exception',
  'Credit issue judged differently': 'customer_exception',
};
export const RULE_KEYS = ['min_salary', 'min_cibil', 'max_foir', 'pre_bt_max_foir', 'max_tenure', 'cc_obligation_pct', 'min_emis_paid',
  'max_enquiries_month', 'max_dpd_events', 'settlement_allowed', 'writeoff_allowed', 'additional_cash_allowed', 'company_categories'];
const SOURCES = { processor_estimate: 'Processor estimate', bank_verbal: 'Bank (verbal)', bank_email_portal: 'Bank email / portal', sanction_letter: 'Sanction letter', final_disbursal: 'Final disbursal' };
const NUMS = ['amount', 'bt_amount', 'additional', 'roi', 'tenure', 'emi', 'foir'];
const cls = 'border rounded-md px-2 py-1 text-xs';
const fmt = (v) => (v == null ? '—' : Array.isArray(v) ? v.join(', ') || '—' : typeof v === 'number' ? v.toLocaleString('en-IN') : String(v));
const parseVal = (k, v) => (v === 'true' ? true : v === 'false' ? false : k === 'company_categories' ? v.split(',').map((s) => s.trim()).filter(Boolean) : v !== '' && !isNaN(v) ? Number(v) : v);

const ResultForm = ({ banks, scope, refId, onSaved }) => {
  const [f, setF] = useState({ bank_name: '', status: 'Eligible', source: 'processor_estimate' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    if (!f.bank_name) return toast.error('Pick a bank');
    const body = { ...f };
    NUMS.forEach((k) => { body[k] = f[k] === '' || f[k] == null ? null : Number(f[k]); });
    try { await api.post(`/elig-compare/${scope}/${refId}/bank-result`, body); toast.success('Bank result saved'); setF({ bank_name: '', status: 'Eligible', source: 'processor_estimate' }); onSaved(); }
    catch (e) { toast.error(e?.response?.data?.detail || 'Could not save'); }
  };
  return (
    <div className="flex flex-wrap gap-2 items-end bg-slate-50 border rounded-md p-2" data-testid="cmp-form">
      <select data-testid="cmp-bank" className={cls} value={f.bank_name} onChange={set('bank_name')}><option value="">Bank…</option>{banks.map((b) => <option key={b}>{b}</option>)}</select>
      <select data-testid="cmp-status" className={cls} value={f.status} onChange={set('status')}>{['Eligible', 'Not Eligible', 'Pending'].map((s) => <option key={s}>{s}</option>)}</select>
      {NUMS.map((k) => <input key={k} data-testid={`cmp-${k}`} placeholder={k.replace('_', ' ')} className={`${cls} w-24`} value={f[k] ?? ''} onChange={set(k)} />)}
      <select data-testid="cmp-source" className={cls} value={f.source} onChange={set('source')}>{Object.entries(SOURCES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      <input data-testid="cmp-remarks" placeholder="Remarks" className={`${cls} w-40`} value={f.remarks ?? ''} onChange={set('remarks')} />
      <button data-testid="cmp-save" onClick={save} className="text-xs bg-slate-800 text-white rounded-md px-3 py-1">Save bank result</button>
    </div>
  );
};

const ReasonForm = ({ c, onDone }) => {
  const open = c.mismatches.filter((m) => !(c.reasons || []).some((r) => r.field === m));
  const [field, setField] = useState(open[0] || '');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [suggest, setSuggest] = useState(false);
  const [rk, setRk] = useState(RULE_KEYS[0]);
  const [rv, setRv] = useState('');
  if (!open.length) return null;
  const policy = reason === 'Bank policy changed' || suggest;
  const submit = async () => {
    if (!reason) return toast.error('Pick a reason');
    if (policy && rv === '') return toast.error('Enter the new rule value');
    const item = { field, reason, kind: REASONS[reason], explanation: note || null, ...(policy ? { policy_patch: { [rk]: parseVal(rk, rv) } } : {}) };
    try { await api.post(`/elig-compare/comparison/${c.id}/reasons`, { items: [item] }); toast.success(policy ? 'Reason saved — policy change sent for admin approval' : 'Reason saved'); setReason(''); setNote(''); setRv(''); onDone(); }
    catch (e) { toast.error(e?.response?.data?.detail || 'Could not save reason'); }
  };
  return (
    <div className="flex flex-wrap gap-2 items-center mt-2 bg-amber-50 border border-amber-200 rounded-md p-2" data-testid={`cmp-reason-form-${c.bank}`}>
      <span className="text-xs font-semibold text-amber-800">Why the difference?</span>
      <select data-testid="cmp-reason-field" className={cls} value={field} onChange={(e) => setField(e.target.value)}>{open.map((m) => <option key={m}>{m}</option>)}</select>
      <select data-testid="cmp-reason" className={cls} value={reason} onChange={(e) => setReason(e.target.value)}><option value="">Reason…</option>{Object.keys(REASONS).map((r) => <option key={r}>{r}</option>)}</select>
      <input data-testid="cmp-reason-note" placeholder="Explanation" className={`${cls} w-48`} value={note} onChange={(e) => setNote(e.target.value)} />
      {reason && reason !== 'Bank policy changed' && <label className="text-xs flex items-center gap-1"><input data-testid="cmp-suggest-policy" type="checkbox" checked={suggest} onChange={(e) => setSuggest(e.target.checked)} />Suggest policy update</label>}
      {policy && <>
        <select data-testid="cmp-rule-key" className={cls} value={rk} onChange={(e) => setRk(e.target.value)}>{RULE_KEYS.map((k) => <option key={k}>{k}</option>)}</select>
        <input data-testid="cmp-rule-value" placeholder="New value" className={`${cls} w-28`} value={rv} onChange={(e) => setRv(e.target.value)} />
      </>}
      <button data-testid="cmp-reason-save" onClick={submit} className="text-xs bg-amber-600 text-white rounded-md px-3 py-1">Save reason</button>
    </div>
  );
};

const Row = ({ c, reload }) => {
  const recalc = async () => {
    try { const { data } = await api.post(`/elig-compare/comparison/${c.id}/recalculate`); toast[data.resolved_difference ? 'success' : 'info'](data.resolved_difference ? 'Difference resolved after recalculation' : 'Still different after recalculation'); reload(); }
    catch { toast.error('Recalculation failed'); }
  };
  const tone = c.status === 'matched' ? 'text-emerald-700' : c.status === 'resolved' ? 'text-sky-700' : 'text-amber-700';
  return (
    <div className="border rounded-md p-2" data-testid={`cmp-row-${c.bank}`}>
      <div className="flex items-center gap-2 text-xs mb-1"><b className="text-sm">{c.bank_name}</b>
        <span className={`font-semibold ${tone}`} data-testid="cmp-status-label">{c.status === 'matched' ? 'Matches calculator' : c.status === 'resolved' ? 'Difference explained' : 'Reason needed'}</span>
        <span className="text-slate-400">{SOURCES[c.bank_result.source]}{c.verified ? ' · verified' : ''}{c.inputs_changed ? ' · file data changed since snapshot' : ''}</span>
        <button data-testid="cmp-recalc" onClick={recalc} className="ml-auto text-sky-700 inline-flex items-center gap-1"><RefreshCw className="w-3 h-3" />Recalculate</button></div>
      <table className="w-full text-xs"><thead><tr className="text-slate-500 text-left"><th>Field</th><th>Calculator</th><th>Bank</th><th>Difference</th></tr></thead>
        <tbody>{c.rows.map((r) => <tr key={r.field} className={r.mismatch ? 'bg-red-50 text-red-700' : ''}><td>{r.label}</td><td>{fmt(r.calculator)}</td><td>{fmt(r.bank)}</td><td>{r.flag || r.diff}</td></tr>)}</tbody></table>
      {(c.reasons || []).map((r) => <p key={r.id} className="text-xs text-slate-600 mt-1">{r.field}: <b>{r.reason}</b>{r.explanation ? ` — ${r.explanation}` : ''}{r.proposal_id ? ' · policy change awaiting admin approval' : ''}</p>)}
      {c.recalculated && <p className="text-xs text-slate-500 mt-1">Last recalculation: {c.recalculated.resolved_difference ? 'difference resolved' : 'still different'}</p>}
      <ReasonForm c={c} onDone={reload} />
    </div>
  );
};

export const BankComparison = ({ scope, refId, banks }) => {
  const [list, setList] = useState([]);
  const load = () => api.get(`/elig-compare/${scope}/${refId}`).then(({ data }) => setList(data)).catch(() => {});
  useEffect(() => { load(); }, [scope, refId]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="bg-white border rounded-lg p-4 space-y-2" data-testid="bank-comparison">
      <div className="flex items-center gap-2"><Scale className="w-4 h-4 text-slate-500" /><h3 className="text-sm font-semibold text-slate-800">Actual bank result vs calculator</h3></div>
      <ResultForm banks={banks} scope={scope} refId={refId} onSaved={load} />
      {list.length === 0 ? <p className="text-xs text-slate-400">No bank results entered yet.</p> : list.map((c) => <Row key={c.id} c={c} reload={load} />)}
    </div>
  );
};
