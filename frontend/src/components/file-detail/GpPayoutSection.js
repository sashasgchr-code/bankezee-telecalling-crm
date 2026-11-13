import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { IndianRupee, RotateCcw, AlertTriangle, Lock } from 'lucide-react';
import api from '../../services/api';

const inr = (v) => (v == null || v === '' ? '—' : `₹${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`);
const err = (e, d) => e?.response?.data?.detail || d;
const Row = ({ k, v, tid }) => <div className="flex justify-between gap-3 text-sm py-1"><span className="text-gray-500">{k}</span><span className="font-medium text-gray-900 text-right" data-testid={tid}>{v}</span></div>;
const rateText = (c) => (c ? (c.payout_type === 'percent' ? `${c.payout_value}%` : `${inr(c.payout_value)} fixed`) : '—');

const OverrideForm = ({ fileId, d, onSaved }) => {
  const [mode, setMode] = useState('percent');
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const amt = d.disbursement?.amount || 0;
  const revised = value === '' ? null : mode === 'percent' ? Math.round(amt * Number(value)) / 100 : Number(value);
  const original = d.calculation?.gross ?? null;
  const current = d.payout?.gross ?? null;
  const base = current ?? original;
  const save = async () => {
    setBusy(true);
    try { const { data } = await api.put(`/gp/file-payout/${fileId}/manual`, { mode, value: Number(value), reason }); toast.success('Payout saved — it still follows the normal approval workflow'); setValue(''); setReason(''); onSaved(data); }
    catch (e) { toast.error(err(e, 'Could not save the payout')); } finally { setBusy(false); }
  };
  return (
    <div className="mt-3 border-t border-gray-100 pt-3 space-y-2" data-testid="gp-payout-override">
      <p className="text-xs font-semibold text-gray-700">{d.calculation ? 'Override payout' : 'Enter payout manually'}</p>
      <div className="flex gap-2">
        <select value={mode} onChange={(e) => setMode(e.target.value)} className="h-9 px-2 border border-gray-200 rounded-lg text-sm bg-white" data-testid="gp-payout-mode">
          <option value="percent">Revised percentage (%)</option><option value="amount">Final gross payout (₹)</option>
        </select>
        <input type="number" step="0.01" value={value} onChange={(e) => setValue(e.target.value)} placeholder={mode === 'percent' ? 'e.g. 1.5' : 'e.g. 7500'} className="h-9 w-32 px-2 border border-gray-200 rounded-lg text-sm" data-testid="gp-payout-value" />
      </div>
      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (required, kept internal)" className="h-9 w-full px-2 border border-gray-200 rounded-lg text-sm" data-testid="gp-payout-reason" />
      {revised != null && <div className="rounded-lg bg-gray-50 p-2 text-xs" data-testid="gp-payout-preview">
        <Row k="Original calculation" v={inr(original)} tid="gp-preview-original" /><Row k="Revised payout" v={inr(revised)} tid="gp-preview-revised" />
        <Row k="Difference" v={base == null ? '—' : `${revised - base >= 0 ? '+' : '−'}${inr(Math.abs(revised - base))}`} tid="gp-preview-diff" /></div>}
      <button disabled={busy || !value || !reason.trim()} onClick={save} className="w-full h-9 rounded-lg bg-green-600 text-white text-sm font-semibold disabled:opacity-50" data-testid="gp-payout-save">{busy ? 'Saving…' : 'Save payout'}</button>
    </div>
  );
};

const Adjust = ({ fileId, onSaved }) => {
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const go = async () => {
    try { const { data } = await api.post(`/gp/file-payout/${fileId}/adjustment`, { amount: Number(amount), reason }); toast.success('Adjustment added'); setAmount(''); setReason(''); onSaved(data); } catch (e) { toast.error(err(e, 'Could not add adjustment')); }
  };
  return (
    <div className="mt-3 border-t border-gray-100 pt-3 space-y-2" data-testid="gp-payout-adjust">
      <p className="text-xs text-gray-600 flex items-center gap-1"><Lock size={12} />Paid payouts are locked. Add an adjustment (use a negative amount to recover).</p>
      <div className="flex gap-2"><input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="± ₹" className="h-9 w-28 px-2 border border-gray-200 rounded-lg text-sm" data-testid="gp-adjust-amount" />
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason" className="h-9 flex-1 px-2 border border-gray-200 rounded-lg text-sm" data-testid="gp-adjust-reason" /></div>
      <button disabled={!Number(amount) || !reason.trim()} onClick={go} className="w-full h-9 rounded-lg border border-gray-300 text-sm font-semibold disabled:opacity-50" data-testid="gp-adjust-save">Add adjustment</button>
    </div>
  );
};

const GpPayoutSection = ({ fileId, refreshKey }) => {
  const [d, setD] = useState(null);
  const load = () => api.get(`/gp/file-payout/${fileId}`).then(({ data }) => setD(data)).catch(() => setD(null));
  useEffect(() => { load(); }, [fileId, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d || !d.is_partner_file) return null;
  const p = d.payout;
  const restore = async () => {
    try { const { data } = await api.post(`/gp/file-payout/${fileId}/restore`, { reason: 'Restored calculated payout' }); toast.success('Calculated payout restored'); setD(data); } catch (e) { toast.error(err(e, 'Could not restore')); }
  };
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4" data-testid="gp-payout-section">
      <div className="flex items-center gap-2 mb-2"><IndianRupee size={16} className="text-green-600" /><h3 className="font-semibold text-gray-900 mr-auto">Growth Partner Payout</h3>
        {p && <span className={`text-[11px] px-2 py-0.5 rounded-full border font-semibold ${p.source === 'manual' ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-green-50 text-green-700 border-green-200'}`} data-testid="gp-payout-source">{p.source === 'manual' ? 'Entered Manually' : p.source === 'adjustment' ? 'Adjustment' : 'Calculated from CSV'}</span>}</div>
      <Row k="Partner" v={`${d.partner.name} (${d.partner.partner_code})`} tid="gp-payout-partner" />
      {!d.disbursement ? <p className="text-sm text-gray-500 mt-2" data-testid="gp-payout-not-disbursed">The payout is calculated once a bank row is marked Disbursed with a disbursed amount.</p> : <>
        <Row k="Disbursed amount" v={inr(d.disbursement.amount)} tid="gp-payout-disbursed" />
        <Row k="Disbursed on · lender" v={`${d.disbursement.date} · ${d.disbursement.lender || '—'}`} />
        <Row k="Applied percentage" v={rateText(d.calculation)} tid="gp-payout-rate" />
        <Row k="Calculated payout" v={inr(d.calculation?.gross)} tid="gp-payout-calculated" />
        <Row k="Rate version" v={d.calculation ? `${d.calculation.rate_code} v${d.calculation.rate_version}` : '—'} tid="gp-payout-rate-version" />
        {d.manual_required && <div className="mt-2 rounded-lg bg-amber-50 border border-amber-200 p-2 text-sm text-amber-800 font-semibold" data-testid="gp-payout-manual-required">Manual Payout Required<span className="block text-xs font-normal">{d.calc_error}</span></div>}
        {p && <div className="mt-2 rounded-lg bg-gray-50 p-2">
          <Row k="Final payout (gross)" v={inr(p.gross)} tid="gp-payout-final" /><Row k="Net after deductions" v={inr(p.net)} tid="gp-payout-net" />
          <Row k="Payout status" v={p.status} tid="gp-payout-status" />
          {p.manual && <p className="text-xs text-gray-500 mt-1">{p.manual.mode === 'percent' ? `${p.manual.value}%` : inr(p.manual.value)} by {p.manual.by} · {p.manual.reason}</p>}
        </div>}
        {p?.needs_review && <p className="mt-2 text-xs text-red-700 flex gap-1" data-testid="gp-payout-review"><AlertTriangle size={14} />{p.review_note}</p>}
        {d.adjustments.length > 0 && <div className="mt-2 text-xs text-gray-600">{d.adjustments.map((a) => <p key={a.id}>Adjustment {inr(a.gross)} · {a.status} · {a.internal_reason}</p>)}</div>}
        {d.locked ? (p.status === 'Paid' && <Adjust fileId={fileId} onSaved={setD} />) : <>
          {p?.source === 'manual' && d.calculation && <button onClick={restore} className="mt-3 w-full h-9 rounded-lg border border-gray-300 text-sm font-semibold flex items-center justify-center gap-1" data-testid="gp-payout-restore"><RotateCcw size={14} />Restore Calculated Payout</button>}
          <OverrideForm fileId={fileId} d={d} onSaved={setD} /></>}
      </>}
      {p?.audit?.length > 0 && <details className="mt-3 text-xs" data-testid="gp-payout-audit"><summary className="cursor-pointer text-gray-600">Payout history ({p.audit.length})</summary>
        {p.audit.slice().reverse().map((a, i) => <p key={i} className="py-1 border-t border-gray-100">{String(a.timestamp).slice(0, 16).replace('T', ' ')} · {a.by_name}: {a.message}{a.previous != null || a.new != null ? ` (${inr(a.previous)} → ${inr(a.new)})` : ''}{a.reason ? ` · ${a.reason}` : ''}</p>)}</details>}
    </div>
  );
};

export default GpPayoutSection;
