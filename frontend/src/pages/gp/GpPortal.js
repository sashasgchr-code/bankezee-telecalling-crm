import React, { useEffect, useState, useCallback } from 'react';
import { NavLink, Outlet, useNavigate, useOutletContext } from 'react-router-dom';
import { toast } from 'sonner';
import { QRCodeCanvas } from 'qrcode.react';
import api from '../../services/api';
import useAuthStore from '../../store/authStore';
import { LOGO, Btn, Card, Badge, PageHead, Tabs, Empty, Stat, RTable, Field, Input, Select, inr, errMsg } from './ui';
import { ProfileForm, KycForm, PayoutForm, AgreementPanel } from './Onboarding';
import { LayoutDashboard, Users, Wallet, Percent, IdCard, ShieldCheck, FileSignature, LifeBuoy, Menu, X, LogOut, Plus, Share2, Copy, Download, MessageCircle, ArrowRight, FolderOpen } from 'lucide-react';

const NAV = [['/gp', 'Dashboard', LayoutDashboard], ['/gp/leads', 'Leads', Users], ['/gp/payouts', 'Payouts', Wallet], ['/gp/payout-structure', 'Payout Structure', Percent],
  ['/gp/card', 'Card & Certificate', IdCard], ['/gp/profile', 'Profile & KYC', ShieldCheck], ['/gp/agreement', 'Partner Agreement', FileSignature], ['/gp/support', 'Support', LifeBuoy]];
const PRODUCTS = ['Personal Loan', 'Business Loan', 'Home Loan', 'Loan Against Property', 'Balance Transfer', 'Credit Card', 'Auto Loan', 'Education Loan', 'Gold Loan'];
export const refLink = (code) => `${window.location.origin}/r/${code}`;
const download = async (url, name) => { const r = await api.get(url, { responseType: 'blob' }); const l = document.createElement('a'); l.href = URL.createObjectURL(r.data); l.download = name; document.body.appendChild(l); l.click(); l.remove(); };

export const GpLayout = () => {
  const { user, logout } = useAuthStore();
  const [me, setMe] = useState(null);
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const reload = useCallback(() => api.get('/gp/me').then(({ data }) => setMe(data)).catch(() => {}), []);
  useEffect(() => { reload(); }, [reload]);
  const side = (
    <nav className="flex flex-col h-full">
      <div className="px-5 py-5 border-b border-[#E6E8E3]"><img src={LOGO} alt="Bankezee" className="h-9" /><p className="text-[11px] font-semibold tracking-wider text-[#2FB34A] uppercase mt-2">Growth Partner</p></div>
      <div className="flex-1 overflow-y-auto py-3">
        {NAV.map(([to, l, I]) => (
          <NavLink key={to} to={to} end={to === '/gp'} onClick={() => setOpen(false)} data-testid={`gp-nav-${l.toLowerCase().replace(/[^a-z]+/g, '-')}`}
            className={({ isActive }) => `flex items-center gap-3 mx-3 my-0.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${isActive ? 'bg-[#E8F6EA] text-[#1F7A33]' : 'text-[#3A3D3B] hover:bg-[#F6F7F5]'}`}>
            <I className="w-4 h-4" />{l}</NavLink>
        ))}
        {user?.is_tl && <NavLink to="/agent/files" className="flex items-center gap-3 mx-3 mt-4 px-3 py-2.5 rounded-lg text-sm text-[#3A3D3B] hover:bg-[#F6F7F5]" data-testid="gp-nav-team-workspace"><FolderOpen className="w-4 h-4" />Team workspace</NavLink>}
      </div>
      <div className="p-4 border-t border-[#E6E8E3]">
        <p className="text-sm font-semibold truncate">{me?.name || user?.name}</p><p className="text-xs text-[#6B6F6A]">ID {me?.partner_id}</p>
        <button data-testid="gp-logout" onClick={() => { logout(); nav('/gp/login'); }} className="mt-2 text-xs text-[#A12B2B] inline-flex items-center gap-1"><LogOut className="w-3 h-3" />Sign out</button>
      </div>
    </nav>
  );
  return (
    <div className="h-screen flex bg-[#F6F7F5] text-[#2B2B2B]" style={{ fontFamily: "'Poppins', 'Segoe UI', sans-serif" }}>
      <aside className="hidden lg:block w-64 shrink-0 bg-white border-r border-[#E6E8E3]" data-testid="gp-sidebar">{side}</aside>
      {open && <div className="lg:hidden fixed inset-0 z-40 flex"><div className="w-72 bg-white h-full shadow-xl" data-testid="gp-drawer">{side}</div><div className="flex-1 bg-black/30" onClick={() => setOpen(false)} /></div>}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="lg:hidden h-14 bg-white border-b border-[#E6E8E3] flex items-center px-4 gap-3">
          <button data-testid="gp-menu" onClick={() => setOpen(true)}>{open ? <X /> : <Menu className="w-5 h-5" />}</button><img src={LOGO} alt="Bankezee" className="h-7" />
          {me && <span className="ml-auto"><Badge s={me.status} /></span>}
        </header>
        <main className="flex-1 overflow-y-auto" data-testid="gp-main"><div className="max-w-6xl mx-auto p-4 sm:p-8">{me ? <Outlet context={{ me, reload, setMe }} /> : <p className="text-sm text-[#6B6F6A]">Loading…</p>}</div></main>
      </div>
    </div>
  );
};

const useMe = () => useOutletContext();

const ShareTools = ({ code, compact }) => {
  const link = refLink(code);
  const copy = () => { navigator.clipboard.writeText(link); toast.success('Referral link copied'); };
  const qr = () => { const c = document.getElementById('gp-qr'); const l = document.createElement('a'); l.href = c.toDataURL('image/png'); l.download = `bankezee-referral-${code}.png`; l.click(); };
  const wa = `https://wa.me/?text=${encodeURIComponent(`Looking for a loan? Apply through my Bankezee partner link: ${link}`)}`;
  return (
    <div className={`flex ${compact ? 'flex-col sm:flex-row' : 'flex-col md:flex-row'} gap-5 items-start`} data-testid="share-tools">
      <div className="p-3 bg-white border border-[#E6E8E3] rounded-xl"><QRCodeCanvas id="gp-qr" value={link} size={compact ? 120 : 150} fgColor="#2B2B2B" /></div>
      <div className="flex-1 space-y-3 min-w-0">
        <div className="flex gap-2"><Input readOnly value={link} data-testid="ref-link" /><Btn variant="outline" onClick={copy} data-testid="ref-copy"><Copy className="w-4 h-4" />Copy</Btn></div>
        <div className="flex flex-wrap gap-2"><a href={wa} target="_blank" rel="noreferrer"><Btn variant="primary" data-testid="ref-whatsapp"><MessageCircle className="w-4 h-4" />Share on WhatsApp</Btn></a>
          <Btn variant="outline" onClick={qr} data-testid="ref-qr-download"><Download className="w-4 h-4" />Download QR</Btn></div>
        <p className="text-xs text-[#6B6F6A]">Customers who apply through this link are automatically credited to you, through to disbursement.</p>
      </div>
    </div>
  );
};

export const GpDashboard = () => {
  const { me } = useMe();
  const nav = useNavigate();
  const [leads, setLeads] = useState(null);
  const [pay, setPay] = useState(null);
  useEffect(() => { api.get('/gp/leads').then(({ data }) => setLeads(data)); api.get('/gp/payouts').then(({ data }) => setPay(data)); }, []);
  const link = { profile: '/gp/profile', kyc: '/gp/profile', kyc_fix: '/gp/profile', payout: '/gp/profile', bank_doc: '/gp/profile', agreement: '/gp/agreement' };
  return (
    <>
      <PageHead title={`Hello, ${me.name || 'Partner'}`} sub={<>Partner ID <b data-testid="dash-partner-id">{me.partner_id}</b> · <Badge s={me.status} /></>}
        actions={<div className="flex flex-wrap gap-2"><Btn data-testid="qa-add-lead" onClick={() => nav('/gp/leads?add=1')}><Plus className="w-4 h-4" />Add a Lead</Btn>
          <Btn variant="outline" data-testid="qa-share" onClick={() => nav('/gp/leads?share=1')}><Share2 className="w-4 h-4" />Share My Referral Link</Btn>
          <Btn variant="outline" data-testid="qa-payouts" onClick={() => nav('/gp/payouts')}><Wallet className="w-4 h-4" />View Payouts</Btn></div>} />
      {me.tasks.length > 0 && <Card className="p-4 mb-6 border-[#F2DDA4] bg-[#FFFBEF]" data-testid="dash-tasks">
        <p className="text-sm font-semibold text-[#8A6100] mb-2">{me.status === 'Active' ? 'Finish these pending items on your account' : 'Complete these to activate your partnership'}</p>
        {me.tasks.map((t) => <button key={t.key} data-testid={`task-${t.key}`} onClick={() => link[t.key] && nav(link[t.key])} className="w-full flex items-center justify-between text-sm py-2 border-t border-[#F2DDA4] first:border-0 text-left"><span>{t.label}</span>{link[t.key] && <ArrowRight className="w-4 h-4 text-[#8A6100]" />}</button>)}
      </Card>}
      <h2 className="text-sm font-semibold text-[#55585A] mb-2">Referrals by stage</h2>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">{leads && Object.entries(leads.counts).map(([k, v]) => <Stat key={k} label={k} value={v} id={`dash-stage-${k.toLowerCase().replace(/\s/g, '-')}`} />)}</div>
      <h2 className="text-sm font-semibold text-[#55585A] mb-2">Payout summary</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">{pay && [['Earned', 'earned'], ['Under verification', 'under_verification'], ['Payable', 'payable'], ['Paid', 'paid']].map(([l, k]) => <Stat key={k} label={l} value={inr(pay.summary[k])} id={`dash-pay-${k}`} accent={k === 'paid'} />)}</div>
    </>
  );
};

export const GpLeads = () => {
  const { me } = useMe();
  const q = new URLSearchParams(window.location.search);
  const [tab, setTab] = useState(q.get('share') ? 'share' : q.get('add') ? 'add' : 'list');
  const [d, setD] = useState(null);
  const [search, setSearch] = useState('');
  const [stage, setStage] = useState('');
  const [f, setF] = useState({ name: '', mobile: '', city: '', loan_type: 'Personal Loan', amount: '', consent: false });
  const load = () => api.get('/gp/leads', { params: { search, stage_f: stage } }).then(({ data }) => setD(data));
  useEffect(() => { load(); }, [stage]); // eslint-disable-line react-hooks/exhaustive-deps
  const add = async (e) => {
    e.preventDefault();
    try { const { data } = await api.post('/gp/leads', { ...f, amount: f.amount ? Number(f.amount) : null }); toast.success(data.duplicate ? 'This customer was already referred today' : 'Lead added — our team will contact the customer'); setF({ ...f, name: '', mobile: '', amount: '', consent: false }); setTab('list'); load(); }
    catch (er) { toast.error(errMsg(er)); }
  };
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <>
      <PageHead title="Leads" sub="Your referred customers and their progress." actions={<Btn data-testid="leads-add" onClick={() => setTab('add')}><Plus className="w-4 h-4" />Add a Lead</Btn>} />
      <Tabs tabs={[['list', `My Leads${d ? ` (${d.total})` : ''}`], ['add', 'Refer a customer'], ['share', 'Share link / QR']]} value={tab} onChange={setTab} />
      {tab === 'list' && <Card className="p-4">
        <div className="flex flex-wrap gap-2 mb-4"><Input data-testid="leads-search" className="!w-64" placeholder="Search name or mobile" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
          <Select data-testid="leads-stage" value={stage} onChange={(e) => setStage(e.target.value)} options={[['', 'All stages'], ...['Submitted', 'In Process', 'Sanctioned', 'Disbursed', 'Rejected'].map((x) => [x, x])]} /></div>
        {d && (d.rows.length ? <RTable testid="leads-table" rows={d.rows} cols={[['name', 'Customer'], ['phone', 'Mobile'], ['product', 'Product'], ['stage', 'Status', (r) => <Badge s={r.stage} />], ['added', 'Date added'], ['updated', 'Last update', (r) => <span className="text-xs">{r.updated}{r.note ? ` · ${r.note}` : ''}</span>], ['via', 'Source']]} />
          : <Empty icon={Users} title="No leads yet" text="Refer your first customer or share your referral link to get started." action={<Btn onClick={() => setTab('add')}>Refer a customer</Btn>} />)}
      </Card>}
      {tab === 'add' && <Card className="p-5"><form onSubmit={add} className="grid sm:grid-cols-2 gap-4" data-testid="lead-form">
        <Field label="Customer name"><Input data-testid="lead-name" required value={f.name} onChange={set('name')} /></Field>
        <Field label="Customer mobile"><Input data-testid="lead-mobile" required inputMode="tel" value={f.mobile} onChange={set('mobile')} /></Field>
        <Field label="City"><Input data-testid="lead-city" value={f.city} onChange={set('city')} /></Field>
        <Field label="Product"><Select data-testid="lead-product" value={f.loan_type} onChange={set('loan_type')} options={PRODUCTS} /></Field>
        <Field label="Approx. amount (₹, optional)"><Input data-testid="lead-amount" inputMode="numeric" value={f.amount} onChange={set('amount')} /></Field>
        <label className="sm:col-span-2 flex gap-2 text-sm"><input data-testid="lead-consent" type="checkbox" checked={f.consent} onChange={(e) => setF({ ...f, consent: e.target.checked })} className="mt-1" />The customer has agreed to be contacted by Bankezee about this loan enquiry.</label>
        <div className="sm:col-span-2 flex justify-end"><Btn data-testid="lead-submit" disabled={!f.consent}>Submit lead</Btn></div></form></Card>}
      {tab === 'share' && <Card className="p-5"><ShareTools code={me.partner_id} /></Card>}
    </>
  );
};

export const GpPayouts = () => {
  const [tab, setTab] = useState('overview');
  const [flt, setFlt] = useState({ status: '', dfrom: '', dto: '' });
  const [d, setD] = useState(null);
  useEffect(() => { api.get('/gp/payouts', { params: flt }).then(({ data }) => setD(data)); }, [flt]);
  const setF = (k) => (e) => setFlt({ ...flt, [k]: e.target.value });
  return (
    <>
      <PageHead title="Payouts" sub="Commission earned on your referred customers." actions={<Btn variant="outline" data-testid="payout-statement" onClick={() => download(`/gp/payouts/statement.csv?${new URLSearchParams(flt)}`, 'bankezee_payout_statement.csv')}><Download className="w-4 h-4" />Download statement</Btn>} />
      <Tabs tabs={[['overview', 'Overview'], ['request', 'Payout Request'], ['report', 'Commission Report']]} value={tab} onChange={setTab} />
      {d && tab === 'overview' && <div className="grid grid-cols-2 md:grid-cols-5 gap-3">{[['Earned', 'earned'], ['Under verification', 'under_verification'], ['Payable', 'payable'], ['Paid', 'paid'], ['On hold', 'on_hold']].map(([l, k]) => <Stat key={k} label={l} value={inr(d.summary[k])} id={`pay-${k}`} accent={k === 'paid'} />)}</div>}
      {tab === 'request' && <Card className="p-5 text-sm text-[#55585A]" data-testid="payout-request-info">Payouts are released automatically once Bankezee reconciles the lender payout for your disbursed files — you don't need to raise a request. Payable amounts are paid to your verified bank account in the next payout cycle.</Card>}
      {d && tab === 'report' && <Card className="p-4">
        <div className="flex flex-wrap gap-2 mb-4"><Select data-testid="pay-filter-status" value={flt.status} onChange={setF('status')} options={[['', 'All statuses'], ...['Under Verification', 'Payable', 'Paid', 'On Hold', 'Reversed'].map((x) => [x, x])]} />
          <Input data-testid="pay-filter-from" type="date" className="!w-40" value={flt.dfrom} onChange={setF('dfrom')} /><Input data-testid="pay-filter-to" type="date" className="!w-40" value={flt.dto} onChange={setF('dto')} /></div>
        {d.rows.length ? <RTable testid="payout-table" rows={d.rows} cols={[['referral_ref', 'Referral'], ['product_code', 'Product'], ['disbursement_date', 'Disbursed on'], ['disbursed_amount', 'Amount', (r) => inr(r.disbursed_amount)],
          ['rate', 'Rate', (r) => (r.payout_type === 'percent' ? `${r.payout_value}%` : r.payout_type ? inr(r.payout_value) : '—')], ['gross', 'Gross', (r) => inr(r.gross)], ['deductions', 'Deductions', (r) => (r.deductions ? `${inr(r.deductions)}${r.deduction_note ? ` · ${r.deduction_note}` : ''}` : '—')],
          ['net', 'Net payout', (r) => <b>{inr(r.net)}</b>], ['status', 'Status', (r) => <span><Badge s={r.status} />{r.reason && <span className="block text-xs text-[#A12B2B] mt-1">{r.reason}</span>}</span>], ['payment_date', 'Paid on', (r) => r.payment_date ? `${r.payment_date} · ${r.txn_ref}` : '—']]} />
          : <Empty icon={Wallet} title="No payouts yet" text="When a customer you referred is disbursed, the commission appears here as Under Verification." />}
      </Card>}
    </>
  );
};

export const GpRates = () => {
  const [d, setD] = useState(null);
  const [show, setShow] = useState('current');
  useEffect(() => { api.get('/gp/rates').then(({ data }) => setD(data)); }, []);
  const rows = (d?.rates || []).filter((r) => (show === 'current' ? ['Current', 'Upcoming'].includes(r.tag) : true));
  return (
    <>
      <PageHead title="Payout Structure" sub="Published commission rates that apply to you." />
      <Tabs tabs={[['current', 'Current & upcoming'], ['all', 'All incl. history']]} value={show} onChange={setShow} />
      <Card className="p-4">{d && (!d.published ? <Empty icon={Percent} title="Rates pending publication" text="Bankezee hasn't published the payout structure yet. It will appear here once published." />
        : <RTable testid="rates-table" rows={rows} keyF={(r) => `${r.rate_code}-${r.version}`} cols={[['product', 'Product'], ['lender_code', 'Lender', (r) => r.lender_code || 'All lenders'],
          ['payout', 'Payout', (r) => (r.payout_type === 'percent' ? `${r.payout_value}% of disbursed amount` : `${inr(r.payout_value)} fixed`)], ['slab', 'Slab', (r) => `${inr(r.slab_min_inr || 0)} – ${r.slab_max_inr ? inr(r.slab_max_inr) : 'no limit'}`],
          ['qualifying_event', 'Paid on', (r) => <span className="capitalize">{r.qualifying_event}</span>], ['effective_from', 'Effective', (r) => `${r.effective_from}${r.effective_to ? ` → ${r.effective_to}` : ''}`],
          ['tag', 'Status', (r) => <span><Badge s={r.tag} />{r.override && <Badge tone="blue">Your rate</Badge>}</span>], ['partner_visible_terms', 'Terms']]} />)}</Card>
    </>
  );
};

export const GpCard = () => {
  const { me } = useMe();
  const active = me.status === 'Active';
  return (
    <>
      <PageHead title="Card & Certificate" sub="Your digital partner card and partnership certificate." />
      {!active ? <Card><Empty icon={IdCard} title="Available once you're active" text="Complete verification and sign your agreement to unlock your partner card and certificate." /></Card> : (
        <div className="grid lg:grid-cols-2 gap-6">
          <div className="rounded-2xl p-6 bg-gradient-to-br from-white to-[#EEF8EF] border border-[#BFE5C6] shadow-sm max-w-md" data-testid="partner-card">
            <div className="flex items-center justify-between"><img src={LOGO} alt="Bankezee" className="h-8" /><Badge s="Verified">Verified Partner</Badge></div>
            <p className="text-[11px] font-bold tracking-[0.2em] text-[#2FB34A] uppercase mt-6">Growth Partner</p>
            <p className="text-2xl font-bold mt-1" data-testid="card-name">{me.profile?.entity_name || me.name}</p>
            <div className="flex items-end justify-between mt-6"><div className="text-sm"><p className="text-[#6B6F6A] text-xs">Partner ID</p><p className="font-semibold" data-testid="card-id">{me.partner_id}</p></div>
              <QRCodeCanvas value={refLink(me.partner_id)} size={84} fgColor="#2B2B2B" bgColor="transparent" /></div>
          </div>
          <Card className="p-6"><p className="font-semibold">Partnership certificate</p><p className="text-sm text-[#6B6F6A] mt-1">A printable certificate with your name, partner ID, issue date and referral QR. Your KYC and bank details are never shown.</p>
            <Btn className="mt-4" data-testid="certificate-download" onClick={() => download('/gp/certificate.pdf', `Bankezee_Partner_Certificate_${me.partner_id}.pdf`)}><Download className="w-4 h-4" />Download certificate</Btn></Card>
        </div>)}
    </>
  );
};

export const GpProfile = () => {
  const { me, setMe } = useMe();
  const [tab, setTab] = useState('profile');
  return (
    <>
      <PageHead title="Profile & KYC" sub={<>Partner ID {me.partner_id} · {me.mobile}</>} />
      <Tabs tabs={[['profile', 'Profile'], ['kyc', 'KYC documents'], ['payout', 'Payout account'], ['link', 'Partner link']]} value={tab} onChange={setTab} />
      <Card className="p-5">
        {tab === 'profile' && <ProfileForm me={me} onSaved={setMe} submitLabel="Save changes" />}
        {tab === 'kyc' && <KycForm me={me} onSaved={setMe} />}
        {tab === 'payout' && <PayoutForm me={me} onSaved={setMe} />}
        {tab === 'link' && <ShareTools code={me.partner_id} compact />}
      </Card>
    </>
  );
};

export const GpAgreement = () => {
  const { reload } = useMe();
  return <><PageHead title="Partner Agreement" sub="Read, download and sign your Bankezee Growth Partner Agreement." /><Card className="p-5"><AgreementPanel onSigned={reload} /></Card></>;
};

export const GpSupport = () => (
  <><PageHead title="Support" sub="We're here to help." />
    <Card className="p-6 space-y-3 text-sm" data-testid="support-card"><p>For questions about referrals, payouts or your agreement, contact the Bankezee partner team:</p>
      <p>Email: <a className="text-[#1F7A33] font-semibold" href="mailto:support@bankezee.com">support@bankezee.com</a></p>
      <p className="text-xs text-[#6B6F6A]">Please mention your Partner ID in every message.</p></Card></>
);
