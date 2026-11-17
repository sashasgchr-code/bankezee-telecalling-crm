import React, { useEffect, useState, useCallback } from 'react';
import { NavLink, Outlet, useLocation, useNavigate, useOutletContext } from 'react-router-dom';
import { toast } from 'sonner';
import { QRCodeCanvas } from 'qrcode.react';
import api from '../../services/api';
import useAuthStore from '../../store/authStore';
import { LOGO, Btn, Card, Badge, PageHead, Tabs, Empty, Stat, RTable, Field, Input, Select, inr, errMsg } from './ui';
import { ProfileForm, KycForm, PayoutForm, AgreementPanel } from './Onboarding';
import { statusTone } from './FileForm';
import { LayoutDashboard, Wallet, Percent, IdCard, ShieldCheck, FileSignature, LifeBuoy, Menu, X, LogOut, Plus, Share2, Copy, Download, MessageCircle, ArrowRight, FolderOpen, Image as ImageIcon } from 'lucide-react';

const NAV = [['/gp', 'Dashboard', LayoutDashboard], ['/gp/files', 'Files', FolderOpen], ['/gp/payouts', 'Payouts', Wallet], ['/gp/payout-structure', 'Payout Structure', Percent],
  ['/gp/card', 'Card & Certificate', IdCard], ['/gp/creatives', 'Marketing Creatives', ImageIcon], ['/gp/profile', 'Profile & KYC', ShieldCheck], ['/gp/agreement', 'Partner Agreement', FileSignature], ['/gp/support', 'Support', LifeBuoy]];
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

export const ShareTools = ({ code, compact }) => {
  const link = refLink(code);
  const copy = () => { navigator.clipboard.writeText(link); toast.success('Application link copied'); };
  const qr = () => { const c = document.getElementById('gp-qr'); const l = document.createElement('a'); l.href = c.toDataURL('image/png'); l.download = `bankezee-application-${code}.png`; l.click(); };
  const wa = `https://wa.me/?text=${encodeURIComponent(`Looking for a loan? Apply through my Bankezee application link: ${link}`)}`;
  return (
    <div className={`flex ${compact ? 'flex-col sm:flex-row' : 'flex-col md:flex-row'} gap-5 items-start`} data-testid="share-tools">
      <div className="p-3 bg-white border border-[#E6E8E3] rounded-xl"><QRCodeCanvas id="gp-qr" value={link} size={compact ? 120 : 150} fgColor="#2B2B2B" /></div>
      <div className="flex-1 space-y-3 min-w-0">
        <div className="flex gap-2"><Input readOnly value={link} data-testid="ref-link" /><Btn variant="outline" onClick={copy} data-testid="ref-copy"><Copy className="w-4 h-4" />Copy</Btn></div>
        <div className="flex flex-wrap gap-2"><a href={wa} target="_blank" rel="noreferrer"><Btn variant="primary" data-testid="ref-whatsapp"><MessageCircle className="w-4 h-4" />Share on WhatsApp</Btn></a>
          <Btn variant="outline" onClick={qr} data-testid="ref-qr-download"><Download className="w-4 h-4" />Download QR</Btn></div>
        <p className="text-xs text-[#6B6F6A]">Customers who apply through this link create a Loan File credited to you, through to disbursement.</p>
      </div>
    </div>
  );
};

export const GpDashboard = () => {
  const { me } = useMe();
  const nav = useNavigate();
  const [files, setFiles] = useState(null);
  const [pay, setPay] = useState(null);
  useEffect(() => { api.get('/gp/files').then(({ data }) => setFiles(data)); api.get('/gp/payouts').then(({ data }) => setPay(data)); }, []);
  const link = { profile: '/gp/profile', kyc: '/gp/profile?tab=kyc', kyc_fix: '/gp/profile?tab=kyc', kyc_review: '/gp/profile?tab=kyc', payout: '/gp/profile?tab=payout', bank_doc: '/gp/profile?tab=payout', agreement: '/gp/agreement', agreement_wait: '/gp/agreement' };
  return (
    <>
      <PageHead title={`Hello, ${me.name || 'Partner'}`} sub={<>Partner ID <b data-testid="dash-partner-id">{me.partner_id}</b> · <Badge s={me.status} /></>}
        actions={<div className="flex flex-wrap gap-2"><Btn data-testid="qa-add-file" onClick={() => nav('/gp/files?add=1')}><Plus className="w-4 h-4" />Add New File</Btn>
          <Btn variant="outline" data-testid="qa-share" onClick={() => nav('/gp/files?share=1')}><Share2 className="w-4 h-4" />Share Application Link</Btn>
          <Btn variant="outline" data-testid="qa-payouts" onClick={() => nav('/gp/payouts')}><Wallet className="w-4 h-4" />View Payouts</Btn></div>} />
      {me.tasks.length > 0 && <Card className="p-4 mb-6 border-[#F2DDA4] bg-[#FFFBEF]" data-testid="dash-tasks">
        <p className="text-sm font-semibold text-[#8A6100] mb-2">{me.status === 'Active' ? 'Finish these pending items on your account' : 'Complete these to activate your partnership'}</p>
        {me.tasks.map((t) => <button key={t.key} data-testid={`task-${t.key}`} onClick={() => link[t.key] && nav(link[t.key])} className="w-full flex items-center justify-between text-sm py-2 border-t border-[#F2DDA4] first:border-0 text-left"><span>{t.label}</span>{link[t.key] && <ArrowRight className="w-4 h-4 text-[#8A6100]" />}</button>)}
      </Card>}
      <h2 className="text-sm font-semibold text-[#55585A] mb-2">Files by Status</h2>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6" data-testid="dash-files-by-status">{files && <Stat label="Total files" value={files.total} id="dash-files-total" />}
        {files?.counts.map((c) => <button key={c.code} className="text-left" onClick={() => nav('/gp/files')} data-testid={`dash-status-${c.code}`}><Stat label={c.label} value={c.count} id={`dash-status-count-${c.code}`} accent={statusTone(c) === 'green'} /></button>)}</div>
      <h2 className="text-sm font-semibold text-[#55585A] mb-2">Payout summary</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">{pay && [['Earned', 'earned'], ['Under verification', 'under_verification'], ['Payable', 'payable'], ['Paid', 'paid']].map(([l, k]) => <Stat key={k} label={l} value={inr(pay.summary[k])} id={`dash-pay-${k}`} accent={k === 'paid'} />)}</div>
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
        {d.rows.length ? <RTable testid="payout-table" rows={d.rows} cols={[['referral_ref', 'File', (r) => r.file_id || r.referral_ref || '—'], ['product_code', 'Product'], ['disbursement_date', 'Disbursed on'], ['disbursed_amount', 'Amount', (r) => inr(r.disbursed_amount)],
          ['rate', 'Rate', (r) => (r.payout_type === 'percent' ? `${r.payout_value}%` : r.payout_type ? inr(r.payout_value) : '—')], ['gross', 'Gross', (r) => inr(r.gross)], ['deductions', 'Deductions', (r) => (r.deductions ? `${inr(r.deductions)}${r.deduction_note ? ` · ${r.deduction_note}` : ''}` : '—')],
          ['net', 'Net payout', (r) => <b>{inr(r.net)}</b>], ['status', 'Status', (r) => <span><Badge s={r.status} />{r.reason && <span className="block text-xs text-[#A12B2B] mt-1">{r.reason}</span>}</span>], ['payment_date', 'Paid on', (r) => r.payment_date ? `${r.payment_date} · ${r.txn_ref}` : '—']]} />
          : <Empty icon={Wallet} title="No payouts yet" text="When one of your loan files is disbursed, the commission appears here as Under Verification." />}
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

const CertificatePreview = () => {
  const [src, setSrc] = useState(null);
  useEffect(() => { let u; api.get('/gp/certificate.png', { responseType: 'blob' }).then((r) => { u = URL.createObjectURL(r.data); setSrc(u); }).catch(() => {}); return () => u && URL.revokeObjectURL(u); }, []);
  return src ? <img src={src} alt="Certificate of Partnership" className="w-full rounded-xl border border-[#E6E8E3] shadow-sm" data-testid="certificate-preview" /> : <div className="aspect-[1.414] rounded-xl bg-[#F6F7F5] animate-pulse" />;
};

export const GpCard = () => {
  const { me } = useMe();
  const active = me.status === 'Active';
  if (!active) {
    return (
      <>
        <PageHead title="Card & Certificate" sub="Your digital partner card and Certificate of Partnership." />
        <Card className="p-6" data-testid="certificate-not-issued">
          <div className="flex items-center gap-2"><IdCard className="w-5 h-5 text-[#8A6100]" /><p className="font-semibold">Not issued yet</p><Badge s={me.status} /></div>
          <p className="text-sm text-[#6B6F6A] mt-2">Your partner card and certificate are issued automatically once your partnership is Active.</p>
          {me.tasks?.length > 0 && <div className="mt-3"><p className="text-xs font-semibold text-[#55585A] mb-1">Next steps</p>{me.tasks.map((t) => <p key={t.key} className="text-sm">• {t.label}</p>)}</div>}
        </Card>
      </>
    );
  }
  return (
    <>
      <PageHead title="Card & Certificate" sub="Your digital partner card and Certificate of Partnership." />
      <div className="grid lg:grid-cols-5 gap-6 items-start">
        <div className="lg:col-span-2 space-y-3">
          <div className="rounded-2xl p-6 bg-gradient-to-br from-white to-[#EEF8EF] border border-[#BFE5C6] shadow-sm" data-testid="partner-card">
            <div className="flex items-center justify-between"><img src={LOGO} alt="Bankezee" className="h-8" /><Badge s="Verified">Verified Partner</Badge></div>
            <p className="text-[11px] font-bold tracking-[0.2em] text-[#2FB34A] uppercase mt-6">Growth Partner</p>
            <p className="text-2xl font-bold mt-1" data-testid="card-name">{me.profile?.entity_name || me.name}</p>
            <div className="flex items-end justify-between mt-6"><div className="text-sm"><p className="text-[#6B6F6A] text-xs">Partner ID</p><p className="font-semibold" data-testid="card-id">{me.partner_id}</p></div>
              <QRCodeCanvas value={refLink(me.partner_id)} size={84} fgColor="#2B2B2B" bgColor="transparent" /></div>
          </div>
        </div>
        <Card className="p-5 lg:col-span-3 space-y-4">
          <div className="flex flex-wrap items-center gap-3"><p className="font-semibold mr-auto">Certificate of Partnership</p>
            <Btn data-testid="certificate-download" onClick={() => download('/gp/certificate.pdf', `Bankezee_Partner_Certificate_${me.partner_id}.pdf`)}><Download className="w-4 h-4" />Download Certificate (PDF)</Btn></div>
          <CertificatePreview />
          <p className="text-xs text-[#6B6F6A]">Print-ready A4 landscape PDF, identical to this preview. Your KYC and bank details are never shown.</p>
        </Card>
      </div>
    </>
  );
};

const Security = () => {
  const [f, setF] = useState({ current_password: '', new_password: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async (e) => {
    e.preventDefault();
    if (f.new_password.length < 8) return toast.error('New password must be at least 8 characters');
    if (f.new_password !== f.confirm) return toast.error('New passwords do not match');
    setBusy(true);
    try { await api.post('/auth/change-password', { current_password: f.current_password, new_password: f.new_password }); toast.success('Password changed'); setF({ current_password: '', new_password: '', confirm: '' }); }
    catch (er) { toast.error(errMsg(er, 'Could not change password')); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={save} className="max-w-md space-y-4" data-testid="security-form">
      <p className="text-sm font-semibold">Change password</p>
      <Field label="Current password"><Input type="password" data-testid="sec-current" value={f.current_password} onChange={set('current_password')} required /></Field>
      <Field label="New password (min 8 characters)"><Input type="password" data-testid="sec-new" value={f.new_password} onChange={set('new_password')} required /></Field>
      <Field label="Confirm new password"><Input type="password" data-testid="sec-confirm" value={f.confirm} onChange={set('confirm')} required /></Field>
      <Btn data-testid="sec-save" disabled={busy}>{busy ? 'Saving…' : 'Change password'}</Btn>
    </form>
  );
};

export const GpProfile = () => {
  const { me, setMe } = useMe();
  const loc = useLocation();
  const [tab, setTab] = useState(new URLSearchParams(loc.search).get('tab') || 'profile');
  useEffect(() => { const t = new URLSearchParams(loc.search).get('tab'); if (t) setTab(t); }, [loc.search]);
  return (
    <>
      <PageHead title="Profile" sub="Your partner account, KYC, payout account, link and security." />
      <Card className="p-4 mb-5 flex flex-wrap items-center gap-x-8 gap-y-2" data-testid="profile-summary">
        <div><p className="text-lg font-bold" data-testid="profile-name">{me.name}</p><p className="text-xs text-[#6B6F6A]">Partner ID <b data-testid="profile-partner-id">{me.partner_id}</b></p></div>
        <div className="text-sm"><p className="text-xs text-[#6B6F6A]">Mobile</p><p data-testid="profile-mobile">{me.mobile || '—'}</p></div>
        <div className="text-sm"><p className="text-xs text-[#6B6F6A]">Email</p><p data-testid="profile-email">{me.email || '—'}</p></div>
        <div className="text-sm"><p className="text-xs text-[#6B6F6A]">Status</p><Badge s={me.status} /></div>
      </Card>
      <Tabs tabs={[['profile', 'Personal Details'], ['kyc', 'KYC Documents'], ['payout', 'Payout Account'], ['link', 'Partner Link & QR'], ['security', 'Security']]} value={tab} onChange={setTab} />
      <Card className="p-5">
        {tab === 'profile' && <ProfileForm me={me} onSaved={setMe} submitLabel="Save changes" />}
        {tab === 'kyc' && <KycForm me={me} onSaved={setMe} />}
        {tab === 'payout' && <PayoutForm me={me} onSaved={setMe} />}
        {tab === 'link' && <ShareTools code={me.partner_id} compact />}
        {tab === 'security' && <Security />}
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
    <Card className="p-6 space-y-3 text-sm" data-testid="support-card"><p>For questions about your files, payouts or your agreement, contact the Bankezee partner team:</p>
      <p>Email: <a className="text-[#1F7A33] font-semibold" href="mailto:support@bankezee.com">support@bankezee.com</a></p>
      <p className="text-xs text-[#6B6F6A]">Please mention your Partner ID in every message.</p></Card></>
);
