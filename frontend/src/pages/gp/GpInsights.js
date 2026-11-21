import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend } from 'recharts';
import { Wallet, CheckCircle2, Clock, PauseCircle, FolderOpen, TrendingUp, Banknote, Link2, Plus, Share2, Image as ImageIcon, Percent } from 'lucide-react';
import api from '../../services/api';
import { KpiCard } from '../../components/KpiCard';

const inr = (v) => `₹${Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
const CAT_COLOR = { initial: '#9AA39B', documents: '#E0A526', processing: '#3B82F6', underwriting: '#6366F1', bank: '#0EA5E9', approval: '#22A447', disbursal: '#1F7A33', rejection: '#DC2626' };
const CAT_LABEL = { initial: 'New', documents: 'Documents', processing: 'Processing', underwriting: 'Underwriting', bank: 'With bank', approval: 'Approved', disbursal: 'Disbursed', rejection: 'Rejected' };

const TONE_THEME = { green: 'green', amber: 'amber', blue: 'blue', gray: 'slate' };
const Kpi = ({ icon, label, value, note, tone = 'green', theme, tid }) => <KpiCard icon={icon} label={label} value={value} sub={note} theme={theme || TONE_THEME[tone]} testid={tid} />;

const Panel = ({ title, children, tid }) => (
  <div className="bg-white rounded-xl border border-gray-200 p-4" data-testid={tid}><p className="text-sm font-semibold text-gray-800 mb-2">{title}</p>{children}</div>
);

const months = () => {
  const out = []; const d = new Date();
  for (let i = 5; i >= 0; i -= 1) { const m = new Date(d.getFullYear(), d.getMonth() - i, 1); out.push({ key: `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`, label: m.toLocaleString('en-IN', { month: 'short' }) }); }
  return out;
};

export const GpInsights = () => {
  const nav = useNavigate();
  const [files, setFiles] = useState(null);
  const [pay, setPay] = useState(null);
  useEffect(() => {
    api.get('/gp/files').then(({ data }) => setFiles(data)).catch(() => setFiles({ rows: [], total: 0 }));
    api.get('/gp/payouts').then(({ data }) => setPay(data.summary)).catch(() => setPay({}));
  }, []);
  const stats = useMemo(() => {
    if (!files) return null;
    const rows = files.rows;
    const byCat = {}; const byLoan = {};
    rows.forEach((r) => { const c = r.status?.category || 'initial'; byCat[c] = (byCat[c] || 0) + 1; const l = r.loan_type || 'Other'; byLoan[l] = (byLoan[l] || 0) + 1; });
    const trend = months().map((m) => ({ month: m.label, Submitted: rows.filter((r) => (r.added || '').startsWith(m.key)).length, Disbursed: rows.filter((r) => (r.disbursed_at || '').startsWith(m.key)).length }));
    return {
      total: rows.length, disbursed: rows.filter((r) => r.disbursed_amount > 0).length, rejected: byCat.rejection || 0,
      active: rows.filter((r) => !['rejection', 'disbursal'].includes(r.status?.category) && !(r.disbursed_amount > 0)).length,
      loanAmt: rows.reduce((a, r) => a + (r.disbursed_amount || 0), 0), viaLink: rows.filter((r) => r.via === 'Application link').length,
      pie: Object.entries(byCat).map(([k, v]) => ({ name: CAT_LABEL[k] || k, value: v, color: CAT_COLOR[k] || '#999' })),
      loans: Object.entries(byLoan).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, v]) => ({ name: name.length > 18 ? `${name.slice(0, 17)}…` : name, Files: v })), trend,
    };
  }, [files]);
  if (!stats || !pay) return <div className="h-24 bg-white rounded-xl border border-gray-200 animate-pulse" />;
  const pending = (pay.under_verification || 0) + (pay.payable || 0);
  const go = [['Add New File', Plus, '/agent/files?new=1'], ['Link & QR', Share2, '/agent/share'], ['Creatives', ImageIcon, '/agent/creatives'], ['Payouts', Wallet, '/agent/payouts'], ['Payout Structure', Percent, '/agent/payout-structure']];
  return (
    <div className="space-y-4" data-testid="gp-insights">
      <section>
        <h2 className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-2">Earnings & Payouts <span className="normal-case font-normal">— your commission, not loan amounts</span></h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Kpi icon={Wallet} label="Total earnings" value={inr(pay.earned)} note="Net payouts: verified, payable and paid" theme="emerald" tid="gp-kpi-earned" />
          <Kpi icon={CheckCircle2} label="Paid to you" value={inr(pay.paid)} theme="green" tid="gp-kpi-paid" />
          <Kpi icon={Clock} label="Pending payout" value={inr(pending)} note="Under verification + payable" tone="amber" tid="gp-kpi-pending" />
          <Kpi icon={PauseCircle} label="On hold" value={inr(pay.on_hold)} theme="rose" tid="gp-kpi-hold" />
        </div>
      </section>
      <section>
        <h2 className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-2">File Performance</h2>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <Kpi icon={FolderOpen} label="Total files" value={stats.total} theme="indigo" tid="gp-kpi-files" />
          <Kpi icon={TrendingUp} label="In progress" value={stats.active} theme="orange" tid="gp-kpi-active" />
          <Kpi icon={CheckCircle2} label="Disbursed files" value={stats.disbursed} note={stats.total ? `${Math.round((stats.disbursed / stats.total) * 100)}% conversion` : null} tid="gp-kpi-disbursed" />
          <Kpi icon={Banknote} label="Loan amount disbursed" value={inr(stats.loanAmt)} note="Customers' loans — not your earnings" theme="teal" tid="gp-kpi-loan-amount" />
          <Kpi icon={Link2} label="Via your link / QR" value={stats.viaLink} theme="violet" tid="gp-kpi-referrals" />
        </div>
      </section>
      {stats.total === 0 ? (
        <div className="bg-white rounded-xl border border-dashed border-gray-300 p-6 text-center" data-testid="gp-insights-empty">
          <p className="font-semibold text-gray-800">No files yet</p><p className="text-sm text-gray-500 mt-1">Add your first loan file or share your application link — your charts appear here.</p>
        </div>
      ) : (
        <div className="grid lg:grid-cols-3 gap-3">
          <Panel title="Files by status" tid="gp-chart-status">
            <div className="h-56"><ResponsiveContainer><PieChart><Pie data={stats.pie} dataKey="value" nameKey="name" innerRadius="50%" outerRadius="80%" paddingAngle={2}>{stats.pie.map((e) => <Cell key={e.name} fill={e.color} />)}</Pie><Tooltip /><Legend wrapperStyle={{ fontSize: 11 }} /></PieChart></ResponsiveContainer></div>
          </Panel>
          <Panel title="Monthly performance (last 6 months)" tid="gp-chart-trend">
            <div className="h-56"><ResponsiveContainer><BarChart data={stats.trend}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="month" fontSize={11} /><YAxis allowDecimals={false} fontSize={11} width={28} /><Tooltip /><Legend wrapperStyle={{ fontSize: 11 }} /><Bar dataKey="Submitted" fill="#93C5A0" radius={[4, 4, 0, 0]} /><Bar dataKey="Disbursed" fill="#1F7A33" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div>
          </Panel>
          <Panel title="Files by loan type" tid="gp-chart-loan">
            <div className="h-56"><ResponsiveContainer><BarChart data={stats.loans} layout="vertical" margin={{ left: 8 }}><XAxis type="number" allowDecimals={false} fontSize={11} /><YAxis type="category" dataKey="name" width={110} fontSize={11} /><Tooltip /><Bar dataKey="Files" fill="#2FB34A" radius={[0, 4, 4, 0]} /></BarChart></ResponsiveContainer></div>
          </Panel>
        </div>
      )}
      <div className="flex flex-wrap gap-2" data-testid="gp-shortcuts">{go.map(([l, I, to]) => <button key={l} onClick={() => nav(to)} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white border border-gray-200 text-sm font-medium text-gray-700 hover:border-green-400 hover:text-green-700 transition-colors" data-testid={`gp-shortcut-${l.toLowerCase().replace(/[^a-z]+/g, '-')}`}><I size={15} />{l}</button>)}</div>
    </div>
  );
};
