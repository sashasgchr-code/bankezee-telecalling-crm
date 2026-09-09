import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Phone, MessageCircle, RefreshCw, Users, PhoneCall, FileText, Clock, X } from 'lucide-react';
import api from '../../../services/api';
import { toast } from 'sonner';
import useAuthStore from '../../../store/authStore';
import { openWhatsApp } from '../../../utils/whatsapp';

const OUTCOMES = [
  { v: 'connected', l: 'Connected' }, { v: 'call_back', l: 'Call Back' },
  { v: 'not_answering', l: 'Not Answering' }, { v: 'switched_off', l: 'Switched Off' },
  { v: 'not_interested', l: 'Not Interested' }, { v: 'not_qualified', l: 'Not Qualified' },
];
const STATUS_OPTS = [
  { v: '', l: 'No change' }, { v: 'leads', l: 'Lead' }, { v: 'follow_up', l: 'Follow Up' },
  { v: 'not_interested', l: 'Not Interested' }, { v: 'file', l: 'Convert to File' },
];
const fmtDur = (s) => `${String(Math.floor((s || 0) / 60)).padStart(2, '0')}:${String((s || 0) % 60).padStart(2, '0')}`;
const fmtT = (s) => { if (!s) return '0m'; const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h ? `${h}h ${m}m` : `${m}m`; };

const Stat = ({ label, value, color = '#0f172a' }) => (
  <div className="bg-white border border-gray-200 rounded-lg p-3 text-center" data-testid={`tl-stat-${label}`}>
    <p className="text-2xl font-bold" style={{ color }}>{value}</p>
    <p className="text-[11px] text-gray-500 mt-1">{label}</p>
  </div>
);

function TLCallModal({ lead, agentName, onClose, onSaved }) {
  const [seconds, setSeconds] = useState(0);
  const [outcome, setOutcome] = useState('');
  const [status, setStatus] = useState('');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [fd, setFd] = useState(''); const [ft, setFt] = useState('');
  const [saving, setSaving] = useState(false);
  const start = useRef(Date.now());
  const boundRef = useRef(lead);
  useEffect(() => { const t = setInterval(() => setSeconds(Math.floor((Date.now() - start.current) / 1000)), 1000); return () => clearInterval(t); }, []);
  const needFollow = ['call_back', 'not_answering', 'switched_off'].includes(outcome);
  const submit = async () => {
    if (!outcome) { toast.error('Select a call outcome'); return; }
    if (outcome === 'not_qualified' && !reason.trim()) { toast.error('Reason required'); return; }
    if (boundRef.current.lead_id !== lead.lead_id) { toast.error('Call context changed'); onClose(); return; }
    setSaving(true);
    try {
      await api.post(`/tl/leads/${lead.lead_id}/call`, {
        duration_seconds: Math.floor((Date.now() - start.current) / 1000),
        outcome, resulting_status: status || null, reason: reason.trim() || null,
        notes: notes.trim() || null, follow_up_date: needFollow ? (fd || null) : null,
        follow_up_time: needFollow ? (ft || null) : null, convert_to_file: status === 'file',
      });
      toast.success('TL call logged'); onSaved(); onClose();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Failed to log call'); } finally { setSaving(false); }
  };
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-5 max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()} data-testid="tl-call-modal">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center animate-pulse"><PhoneCall size={20} /></div>
            <div><p className="text-sm font-semibold text-gray-800">TL Call · {lead.name}</p><p className="text-xs text-gray-500 flex items-center gap-1"><Clock size={12} /> {fmtDur(seconds)}</p></div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <p className="text-[11px] text-indigo-600 bg-indigo-50 rounded px-2 py-1 mb-3">Second-level TL call — original GP: <b>{lead.gp_name}</b> (ownership stays with GP)</p>
        <label className="text-xs font-semibold uppercase tracking-wider text-gray-500">Call Outcome</label>
        <select data-testid="tl-outcome-select" value={outcome} onChange={(e) => setOutcome(e.target.value)} className="mt-1 mb-3 w-full border border-gray-300 rounded-md px-3 py-2 text-sm bg-white outline-none">
          <option value="">Select outcome...</option>{OUTCOMES.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
        </select>
        <label className="text-xs font-semibold uppercase tracking-wider text-gray-500">Update Status</label>
        <select data-testid="tl-status-select" value={status} onChange={(e) => setStatus(e.target.value)} className="mt-1 mb-3 w-full border border-gray-300 rounded-md px-3 py-2 text-sm bg-white outline-none">
          {STATUS_OPTS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
        </select>
        {outcome === 'not_qualified' && <input data-testid="tl-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (required)" className="mb-3 w-full border border-gray-300 rounded-md px-3 py-2 text-sm outline-none" />}
        {needFollow && (
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div><label className="text-xs text-gray-500">Follow-up Date</label><input type="date" data-testid="tl-fu-date" value={fd} onChange={(e) => setFd(e.target.value)} className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-sm" /></div>
            <div><label className="text-xs text-gray-500">Follow-up Time</label><input type="time" data-testid="tl-fu-time" value={ft} onChange={(e) => setFt(e.target.value)} className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-sm" /></div>
          </div>
        )}
        <textarea data-testid="tl-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Notes / next step..." className="mb-4 w-full border border-gray-300 rounded-md px-3 py-2 text-sm outline-none resize-none" />
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="border border-gray-200 text-gray-600 hover:bg-gray-50 rounded-md px-4 py-2 text-sm font-medium">Cancel</button>
          <button data-testid="tl-save-call" disabled={saving} onClick={submit} className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-md px-4 py-2 text-sm font-medium disabled:opacity-60">Save Call</button>
        </div>
      </div>
    </div>
  );
}

const TeamLeads = () => {
  const { user } = useAuthStore();
  const [meta, setMeta] = useState({ tls: [], gps: [], is_tl: false, me: null, outcomes: [] });
  const [tab, setTab] = useState('leads');
  const [period, setPeriod] = useState('month');
  const [fromDate, setFromDate] = useState(''); const [toDate, setToDate] = useState('');
  const [tl, setTl] = useState('ALL'); const [gp, setGp] = useState('ALL');
  const [status, setStatus] = useState('ALL'); const [outcome, setOutcome] = useState('ALL'); const [converted, setConverted] = useState('ALL');
  const [stats, setStats] = useState(null);
  const [leads, setLeads] = useState([]);
  const [callLog, setCallLog] = useState([]);
  const [summary, setSummary] = useState(null);
  const [hourly, setHourly] = useState(null);
  const [loading, setLoading] = useState(true);
  const [callLead, setCallLead] = useState(null);
  const callRef = useRef(null);

  const rangeParams = useCallback(() => {
    const p = {};
    if (fromDate && toDate) { p.from_date = fromDate; p.to_date = toDate; } else { p.period = period; }
    if (tl !== 'ALL') p.tl = tl; if (gp !== 'ALL') p.gp = gp;
    return p;
  }, [period, fromDate, toDate, tl, gp]);

  useEffect(() => { api.get('/tl/meta').then(({ data }) => { setMeta(data); if (data.is_tl && data.me) setTl(data.me); }).catch(() => {}); }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rp = rangeParams();
      const [st, ld] = await Promise.all([
        api.get('/tl/stats', { params: rp }),
        api.get('/tl/leads', { params: { ...rp, status, outcome, converted } }),
      ]);
      setStats(st.data); setLeads(ld.data.leads || []);
      if (tab === 'calllog') setCallLog((await api.get('/tl/call-logs', { params: { ...rp, outcome, status, converted } })).data.logs || []);
      if (tab === 'summary') setSummary((await api.get('/tl/reports/summary', { params: rp })).data);
      if (tab === 'hourly') setHourly((await api.get('/tl/reports/hourly', { params: { date: (toDate || undefined), tl: tl !== 'ALL' ? tl : undefined } })).data);
    } catch (e) { /* interceptor handles */ } finally { setLoading(false); }
  }, [rangeParams, status, outcome, converted, tab, tl, toDate]);

  useEffect(() => { load(); }, [load]);

  const openCall = (lead) => { callRef.current = lead; setCallLead(lead); };
  const periods = [['today', 'Today'], ['yesterday', 'Yesterday'], ['week', 'This Week'], ['month', 'This Month']];

  return (
    <div className="p-4" data-testid="tl-team-leads">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold text-gray-900">Team Leads (TL)</h2>
        <button onClick={load} className="p-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50" data-testid="tl-refresh"><RefreshCw size={18} className={loading ? 'animate-spin' : ''} /></button>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
        {[['leads', 'Leads'], ['calllog', 'TL Call Log'], ['summary', 'TL Summary'], ['hourly', 'TL Hourly']].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} data-testid={`tl-tab-${k}`}
            className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap ${tab === k ? 'bg-emerald-600 text-white' : 'bg-white text-gray-700 border border-gray-200'}`}>{l}</button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-3">
        {periods.map(([k, l]) => (
          <button key={k} onClick={() => { setFromDate(''); setToDate(''); setPeriod(k); }} className={`px-3 py-1.5 rounded-lg text-sm ${period === k && !fromDate ? 'bg-emerald-600 text-white' : 'bg-white border border-gray-200 text-gray-700'}`}>{l}</button>
        ))}
        <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="border border-gray-300 rounded-md px-2 py-1.5 text-xs" data-testid="tl-from" />
        <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="border border-gray-300 rounded-md px-2 py-1.5 text-xs" data-testid="tl-to" />
      </div>
      <div className="flex flex-wrap gap-2 mb-4">
        {(meta.tls.length > 1 || !meta.is_tl) && (
          <select value={tl} onChange={(e) => setTl(e.target.value)} className="border border-gray-300 rounded-md px-2 py-1.5 text-sm bg-white" data-testid="tl-filter-tl">
            <option value="ALL">All Team Leaders</option>{meta.tls.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        )}
        <select value={gp} onChange={(e) => setGp(e.target.value)} className="border border-gray-300 rounded-md px-2 py-1.5 text-sm bg-white" data-testid="tl-filter-gp">
          <option value="ALL">All Growth Partners</option>{meta.gps.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
        <select value={outcome} onChange={(e) => setOutcome(e.target.value)} className="border border-gray-300 rounded-md px-2 py-1.5 text-sm bg-white" data-testid="tl-filter-outcome">
          <option value="ALL">Any outcome</option>{OUTCOMES.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
        </select>
        <select value={converted} onChange={(e) => setConverted(e.target.value)} className="border border-gray-300 rounded-md px-2 py-1.5 text-sm bg-white" data-testid="tl-filter-conv">
          <option value="ALL">All</option><option value="yes">TL-converted to File</option><option value="no">Not converted</option>
        </select>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-8 gap-2 mb-5">
          <Stat label="Leads (range)" value={stats.range_total_leads} color="#2563eb" />
          <Stat label="Today" value={stats.today} />
          <Stat label="This Week" value={stats.week} />
          <Stat label="This Month" value={stats.month} />
          <Stat label="TL Contacted" value={stats.contacted_leads} color="#7c3aed" />
          <Stat label="Converted" value={stats.files_converted} color="#ea580c" />
          <Stat label="Pending" value={stats.pending} color="#dc2626" />
          <Stat label="Conv %" value={`${stats.file_conversion_rate}%`} color="#059669" />
        </div>
      )}

      {/* LEADS TAB */}
      {tab === 'leads' && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3" data-testid="tl-leads-grid">
          {leads.length === 0 ? <p className="text-gray-400 text-sm py-8 text-center col-span-full">No leads in this range</p> : leads.map((l) => (
            <div key={l.lead_id} className="bg-white border border-gray-200 rounded-lg p-4" data-testid={`tl-lead-${l.lead_id}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0"><p className="font-semibold text-gray-900 truncate">{l.name}</p><p className="text-xs text-gray-500">{l.phone || '—'}</p></div>
                <span className={`text-[10px] font-bold px-2 py-1 rounded ${l.status === 'file' ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-700'}`}>{(l.status || '').toUpperCase()}</span>
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 mt-2 text-xs">
                <span className="text-gray-400">Loan</span><span className="text-gray-700 truncate">{l.loan_type || 'loan requirement'}</span>
                <span className="text-gray-400">Original GP</span><span className="text-gray-700 truncate">{l.gp_name}</span>
                <span className="text-gray-400">Became Lead</span><span className="text-gray-700">{l.lead_created_at ? new Date(l.lead_created_at).toLocaleDateString() : '—'}</span>
                <span className="text-gray-400">Last GP Call</span><span className="text-gray-700">{l.last_call_outcome || '—'}</span>
                <span className="text-gray-400">Last TL Call</span><span className="text-gray-700 truncate">{l.last_tl_call ? `${l.last_tl_call.outcome}` : '—'}</span>
                <span className="text-gray-400">Follow-up</span><span className="text-gray-700">{l.follow_up_date || '—'} {l.follow_up_time || ''}</span>
              </div>
              {l.converted_by_tl && <p className="text-[10px] text-orange-600 mt-2">TL-converted to File (owner remains GP)</p>}
              <div className="flex gap-2 mt-3">
                <a href={`tel:${l.phone}`} onClick={() => openCall(l)} className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-md bg-emerald-600 text-white px-3 py-2 text-sm font-medium" data-testid={`tl-call-${l.lead_id}`}><Phone size={15} /> Call</a>
                <button type="button" onClick={() => openWhatsApp(l.phone, l.name, user?.name || 'Team')} className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-md bg-green-500 text-white px-3 py-2 text-sm font-medium" data-testid={`tl-wa-${l.lead_id}`}><MessageCircle size={15} /> WhatsApp</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* CALL LOG TAB */}
      {tab === 'calllog' && (
        <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto" data-testid="tl-calllog">
          <table className="w-full text-sm">
            <thead><tr className="bg-gray-50 text-left text-xs text-gray-500">
              {['TL', 'Customer', 'Original GP', 'When', 'Dur', 'Outcome', 'Status', 'File'].map((h) => <th key={h} className="py-2 px-3">{h}</th>)}
            </tr></thead>
            <tbody>
              {callLog.length === 0 ? <tr><td colSpan={8} className="py-8 text-center text-gray-400">No TL calls</td></tr> : callLog.map((c) => (
                <tr key={c.tl_call_id} className="border-t border-gray-100">
                  <td className="py-2 px-3 font-medium">{c.tl_name}</td><td className="py-2 px-3">{c.customer}<div className="text-xs text-gray-400">{c.phone}</div></td>
                  <td className="py-2 px-3">{c.gp_name}</td><td className="py-2 px-3 text-xs">{c.at ? new Date(c.at).toLocaleString() : ''}</td>
                  <td className="py-2 px-3">{fmtDur(c.duration_seconds)}</td><td className="py-2 px-3">{c.outcome}</td>
                  <td className="py-2 px-3">{c.resulting_status || '—'}</td><td className="py-2 px-3">{c.converted_to_file ? '✓' : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* SUMMARY TAB */}
      {tab === 'summary' && summary && (
        <div>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-4">
            <Stat label="TL Calls" value={summary.overall.tl_calls} color="#2563eb" />
            <Stat label="Connected" value={summary.overall.connected} color="#7c3aed" />
            <Stat label="Follow-ups" value={summary.overall.follow_ups} />
            <Stat label="Files" value={summary.overall.files} color="#ea580c" />
            <Stat label="Talk" value={fmtT(summary.overall.talk_seconds)} />
            <Stat label="Conv %" value={`${summary.overall.conversion_pct}%`} color="#059669" />
          </div>
          <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="bg-gray-50 text-left text-xs text-gray-500">{['Team Leader', 'Calls', 'Connected', 'Call Back', 'NA', 'Not Int.', 'Follow-ups', 'Files', 'Conv %'].map((h) => <th key={h} className="py-2 px-3">{h}</th>)}</tr></thead>
              <tbody>{summary.tls.map((t) => (
                <tr key={t.tl_id} className="border-t border-gray-100"><td className="py-2 px-3 font-medium">{t.tl_name}</td>
                  <td className="py-2 px-3">{t.tl_calls}</td><td className="py-2 px-3">{t.connected}</td><td className="py-2 px-3">{t.call_back}</td>
                  <td className="py-2 px-3">{t.not_answering}</td><td className="py-2 px-3">{t.not_interested}</td><td className="py-2 px-3">{t.follow_ups}</td>
                  <td className="py-2 px-3 text-orange-600 font-semibold">{t.files}</td><td className="py-2 px-3 text-emerald-600 font-semibold">{t.conversion_pct}%</td></tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )}

      {/* HOURLY TAB */}
      {tab === 'hourly' && hourly && (
        <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto" data-testid="tl-hourly">
          <div className="px-4 py-3 bg-gradient-to-r from-emerald-600 to-emerald-700 text-white text-sm font-semibold">TL Second-Level Hourly · {hourly.date}</div>
          <table className="w-full text-sm">
            <thead><tr className="bg-gray-50 text-left text-xs text-gray-500">{['Hour', 'TL Calls', 'Connected', 'Call Back', 'NA', 'Files'].map((h) => <th key={h} className="py-2 px-3">{h}</th>)}</tr></thead>
            <tbody>{hourly.hours.length === 0 ? <tr><td colSpan={6} className="py-8 text-center text-gray-400">No TL calls</td></tr> : hourly.hours.map((h) => (
              <tr key={h.hour} className="border-t border-gray-100"><td className="py-2 px-3 font-medium">{String(h.hour).padStart(2, '0')}:00</td>
                <td className="py-2 px-3">{h.tl_calls}</td><td className="py-2 px-3">{h.connected}</td><td className="py-2 px-3">{h.call_back}</td>
                <td className="py-2 px-3">{h.not_answering}</td><td className="py-2 px-3 text-orange-600">{h.files}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {callLead && <TLCallModal lead={callLead} agentName={user?.name} onClose={() => setCallLead(null)} onSaved={load} />}
    </div>
  );
};

export default TeamLeads;
