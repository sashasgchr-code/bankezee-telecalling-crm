import React from 'react';

export const LOGO = 'https://bankezee.com/bankezee-logo.png';
export const GP_ROLES = ['growth_partner', 'telecaller', 'sales_agent', 'partner', 'team_leader'];
export const inr = (v) => (v == null || v === '' ? '—' : `₹${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`);
export const errMsg = (e, d = 'Something went wrong') => {
  const x = e?.response?.data?.detail;
  return typeof x === 'string' ? x : Array.isArray(x) ? x.map((i) => i.msg).join(', ') : d;
};

const TONES = {
  green: 'bg-[#E8F6EA] text-[#1F7A33] border-[#BFE5C6]', amber: 'bg-[#FFF6E0] text-[#8A6100] border-[#F2DDA4]',
  red: 'bg-[#FDECEC] text-[#A12B2B] border-[#F3C4C4]', blue: 'bg-[#EAF1FB] text-[#24508F] border-[#C9DAF2]', gray: 'bg-[#F1F2F0] text-[#55585A] border-[#E1E3DF]',
};
const STATUS_TONE = { Verified: 'green', Active: 'green', Signed: 'green', Paid: 'green', Disbursed: 'green', Current: 'green', Sanctioned: 'blue', Payable: 'blue',
  Pending: 'amber', 'Under Verification': 'amber', Onboarding: 'amber', 'Awaiting Signature': 'amber', 'Signing in Progress': 'blue', Upcoming: 'blue', 'In Process': 'blue',
  'Action Required': 'red', 'On Hold': 'red', Reversed: 'red', Rejected: 'red', 'Not Submitted': 'gray', Submitted: 'gray', Expired: 'gray', 'Previous version': 'gray' };

export const Badge = ({ s, children, tone }) => (
  <span data-testid={`badge-${String(s || children).toLowerCase().replace(/\s+/g, '-')}`}
    className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] font-semibold whitespace-nowrap ${TONES[tone || STATUS_TONE[s] || 'gray']}`}>{children || s}</span>
);

export const Btn = ({ variant = 'primary', className = '', ...p }) => {
  const v = { primary: 'bg-[#2FB34A] hover:bg-[#28993F] text-white', dark: 'bg-[#2B2B2B] hover:bg-black text-white',
    outline: 'border border-[#D9DCD6] bg-white hover:bg-[#F6F7F5] text-[#2B2B2B]', ghost: 'text-[#1F7A33] hover:bg-[#E8F6EA]' }[variant];
  return <button {...p} className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors duration-150 disabled:opacity-50 ${v} ${className}`} />;
};

export const Card = ({ className = '', ...p }) => <div {...p} className={`bg-white border border-[#E6E8E3] rounded-2xl ${className}`} />;

export const Field = ({ label, hint, error, children }) => (
  <label className="block">
    <span className="text-[13px] font-semibold text-[#2B2B2B]">{label}</span>
    <div className="mt-1.5">{children}</div>
    {hint && !error && <span className="text-xs text-[#6B6F6A] mt-1 block">{hint}</span>}
    {error && <span className="text-xs text-[#A12B2B] mt-1 block">{error}</span>}
  </label>
);
export const inputCls = 'w-full rounded-lg border border-[#D9DCD6] bg-white px-3 py-2.5 text-sm text-[#2B2B2B] outline-none focus:border-[#2FB34A] focus:ring-2 focus:ring-[#2FB34A]/20';
export const Input = (p) => <input {...p} className={`${inputCls} ${p.className || ''}`} />;
export const Select = ({ options, ...p }) => (
  <select {...p} className={inputCls}>{options.map((o) => (Array.isArray(o) ? <option key={o[0]} value={o[0]}>{o[1]}</option> : <option key={o}>{o}</option>))}</select>
);

export const PageHead = ({ title, sub, actions }) => (
  <div className="flex flex-wrap items-start gap-3 mb-6">
    <div className="mr-auto">
      <h1 className="text-2xl sm:text-3xl font-bold text-[#2B2B2B] tracking-tight" data-testid="page-title">{title}</h1>
      {sub && <p className="text-sm text-[#6B6F6A] mt-1">{sub}</p>}
    </div>
    {actions}
  </div>
);

export const Tabs = ({ tabs, value, onChange }) => (
  <div className="flex gap-1 border-b border-[#E6E8E3] mb-5 overflow-x-auto">
    {tabs.map(([k, l]) => (
      <button key={k} data-testid={`tab-${k}`} onClick={() => onChange(k)}
        className={`px-4 py-2.5 text-sm font-semibold whitespace-nowrap border-b-2 -mb-px transition-colors ${value === k ? 'border-[#2FB34A] text-[#1F7A33]' : 'border-transparent text-[#6B6F6A] hover:text-[#2B2B2B]'}`}>{l}</button>
    ))}
  </div>
);

export const Empty = ({ icon: I, title, text, action }) => (
  <div className="text-center py-14 px-6" data-testid="empty-state">
    {I && <div className="w-12 h-12 mx-auto rounded-full bg-[#E8F6EA] flex items-center justify-center mb-3"><I className="w-6 h-6 text-[#2FB34A]" /></div>}
    <p className="font-semibold text-[#2B2B2B]">{title}</p>
    {text && <p className="text-sm text-[#6B6F6A] mt-1 max-w-md mx-auto">{text}</p>}
    {action && <div className="mt-4">{action}</div>}
  </div>
);

export const Stat = ({ label, value, id, accent }) => (
  <Card className="p-4">
    <p className="text-xs font-medium text-[#6B6F6A]">{label}</p>
    <p className={`text-2xl font-bold mt-1 ${accent ? 'text-[#1F7A33]' : 'text-[#2B2B2B]'}`} data-testid={id}>{value}</p>
  </Card>
);

// Responsive table: cards on mobile, table on desktop.
export const RTable = ({ cols, rows, keyF = (r, i) => r.id || i, testid }) => (
  <div data-testid={testid}>
    <div className="hidden md:block overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="text-left text-[12px] text-[#6B6F6A] border-b border-[#E6E8E3]">{cols.map((c) => <th key={c[0]} className="py-2.5 px-3 font-semibold whitespace-nowrap">{c[1]}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={keyF(r, i)} className="border-b border-[#F0F1EE] hover:bg-[#FAFBF9]">{cols.map((c) => <td key={c[0]} className="py-2.5 px-3 align-top">{c[2] ? c[2](r) : r[c[0]] ?? '—'}</td>)}</tr>)}</tbody>
      </table>
    </div>
    <div className="md:hidden space-y-2">
      {rows.map((r, i) => (
        <div key={keyF(r, i)} className="border border-[#E6E8E3] rounded-xl p-3 bg-white">
          {cols.map((c) => <div key={c[0]} className="flex justify-between gap-3 py-0.5 text-sm"><span className="text-[#6B6F6A] text-xs">{c[1]}</span><span className="text-right">{c[2] ? c[2](r) : r[c[0]] ?? '—'}</span></div>)}
        </div>
      ))}
    </div>
  </div>
);
