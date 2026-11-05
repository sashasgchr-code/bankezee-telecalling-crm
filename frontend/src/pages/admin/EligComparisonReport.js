import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import api from '../../services/api';

const Stat = ({ label, value, id }) => <div className="bg-white border rounded-lg p-3"><p className="text-[11px] text-slate-500">{label}</p><p className="text-xl font-semibold" data-testid={id}>{value ?? '—'}</p></div>;
const show = (o) => Object.entries(o || {}).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : String(v)}`).join('; ');

const Proposal = ({ p, reload }) => {
  const act = async (path, msg) => {
    try { await api.post(path); toast.success(msg); reload(); } catch (e) { toast.error(e?.response?.data?.detail || 'Action failed'); }
  };
  const r = p.replay;
  return (
    <tr className="border-t align-top" data-testid={`proposal-${p.id}`}>
      <td className="py-1">{p.bank_name}</td><td>{show(p.existing)}</td><td className="font-semibold">{show(p.proposed)}</td>
      <td>{p.explanation || '—'}{p.verified_source ? ' · verified bank evidence' : ' · estimate only'}</td>
      <td>{r ? `${r.cases.length} cases · ${r.improved} improved · ${r.worse} worse${r.conflicting_history ? ' · conflicts with history' : ''}` : 'Not replayed'}</td>
      <td data-testid="proposal-status">{p.status}</td>
      <td className="space-x-2 whitespace-nowrap">{p.status === 'pending' && <>
        <button data-testid="proposal-replay" className="text-sky-700" onClick={() => act(`/elig-compare/proposals/${p.id}/replay`, 'Replayed against past cases')}>Replay</button>
        <button data-testid="proposal-approve" className="text-emerald-700 disabled:opacity-40" disabled={!r} onClick={() => act(`/elig-compare/proposals/${p.id}/approve`, 'Policy updated')}>Approve</button>
        <button data-testid="proposal-reject" className="text-red-600" onClick={() => act(`/elig-compare/proposals/${p.id}/reject`, 'Rejected')}>Reject</button></>}
        {p.status === 'approved' && <button data-testid="proposal-rollback" className="text-slate-600" onClick={() => act(`/elig-compare/policies/${p.policy_id}/rollback`, 'Policy rolled back to previous version')}>Undo</button>}
      </td>
    </tr>
  );
};

export default function EligComparisonReport() {
  const [d, setD] = useState(null);
  const load = () => api.get('/elig-compare/dashboard').then(({ data }) => setD(data)).catch(() => toast.error('Could not load report'));
  useEffect(() => { load(); }, []);
  if (!d) return <p className="p-6 text-sm text-slate-500">Loading…</p>;
  return (
    <div className="max-w-[1200px] mx-auto p-4 space-y-4" data-testid="elig-compare-report">
      <h1 className="text-2xl font-semibold text-slate-800">Calculator accuracy</h1>
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <Stat label="Decided bank results" value={d.comparable} id="rep-comparable" /><Stat label="Matched" value={d.matched} id="rep-matched" />
        <Stat label="Reason needed" value={d.unresolved} id="rep-unresolved" /><Stat label="Agreement (verified)" value={d.agreement_verified != null ? `${d.agreement_verified}%` : null} id="rep-agree-verified" />
        <Stat label="Agreement (estimates)" value={d.agreement_estimates != null ? `${d.agreement_estimates}%` : null} id="rep-agree-est" /><Stat label="Pending policy changes" value={d.pending_proposals} id="rep-pending" />
      </div>
      <section className="bg-white border rounded-lg p-4"><h2 className="text-sm font-semibold mb-2">Policy change suggestions</h2>
        {d.proposals.length === 0 ? <p className="text-xs text-slate-400">None yet.</p> :
          <table className="w-full text-xs"><thead><tr className="text-left text-slate-500"><th>Bank</th><th>Current</th><th>Proposed</th><th>Reason</th><th>Replay</th><th>Status</th><th /></tr></thead>
            <tbody>{d.proposals.map((p) => <Proposal key={p.id} p={p} reload={load} />)}</tbody></table>}
      </section>
      <section className="bg-white border rounded-lg p-4"><h2 className="text-sm font-semibold mb-2">Top mismatch reasons</h2>
        {d.top_reasons.length === 0 ? <p className="text-xs text-slate-400">None yet.</p> : d.top_reasons.map((r, i) => <p key={i} className="text-xs">{r.bank} · {r.reason} · <b>{r.count}</b></p>)}
      </section>
      <section className="bg-white border rounded-lg p-4"><h2 className="text-sm font-semibold mb-2">Recent comparisons</h2>
        <table className="w-full text-xs" data-testid="rep-comparisons"><thead><tr className="text-left text-slate-500"><th>File</th><th>CRM</th><th>Bank</th><th>Status</th><th>Mismatched fields</th><th>Updated</th></tr></thead>
          <tbody>{d.comparisons.map((c) => <tr key={c.id} className="border-t"><td>{c.ref_id}</td><td>{c.scope === 'meta' ? 'Meta CRM' : 'Connect'}</td><td>{c.bank_name}</td><td>{c.status}</td><td>{c.mismatches.join(', ') || '—'}</td><td>{(c.updated_at || '').slice(0, 10)} {c.updated_by}</td></tr>)}</tbody></table>
      </section>
    </div>
  );
}
