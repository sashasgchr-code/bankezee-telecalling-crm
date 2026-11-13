import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import api from '../../services/api';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { AdminCreatives } from './AdminCreatives';
import { Btn, Card, Badge, PageHead, Tabs, RTable, Field, Input, Select, inr, errMsg } from '../gp/ui';

const dl = async (url, name, open) => { const r = await api.get(url, { responseType: 'blob' }); const u = URL.createObjectURL(r.data); if (open) return window.open(u); const l = document.createElement('a'); l.href = u; l.download = name; document.body.appendChild(l); l.click(); l.remove(); };

const AskDialog = ({ ask, onClose }) => {
  const [v, setV] = useState({});
  useEffect(() => { setV({}); }, [ask]);
  if (!ask) return null;
  const ok = ask.fields.every((f) => (v[f.key] || '').trim());
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="gpa-ask-dialog">
        <DialogHeader><DialogTitle>{ask.title}</DialogTitle></DialogHeader>
        <div className="space-y-3">{ask.fields.map((f) => <Field key={f.key} label={f.label}><Input data-testid={`gpa-ask-${f.key}`} type={f.type || 'text'} value={v[f.key] || ''} onChange={(e) => setV({ ...v, [f.key]: e.target.value })} /></Field>)}</div>
        <div className="flex justify-end gap-2 mt-2"><Btn variant="outline" data-testid="gpa-ask-cancel" onClick={onClose}>Cancel</Btn><Btn data-testid="gpa-ask-submit" disabled={!ok} onClick={() => { ask.onSubmit(v); onClose(); }}>Confirm</Btn></div>
      </DialogContent>
    </Dialog>
  );
};

const Partners = () => {
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState('');
  const [ask, setAsk] = useState(null);
  const load = () => api.get('/gp/admin/partners').then(({ data }) => setRows(data));
  useEffect(() => { load(); }, []);
  const approve = (p, reason = null) => {
    if (!reason) return setAsk({ title: `Approve ${p.name} as an Active partner?`, fields: [{ key: 'reason', label: 'Reason (recorded with your name)' }], onSubmit: (v) => approve(p, v.reason) });
    api.post(`/gp/admin/partners/${p.user_id}/approve`, { reason }).then(() => { toast.success(`${p.name} is now Active`); load(); }).catch((e) => toast.error(errMsg(e)));
  };
  const decide = async (p, item, status, note = null) => {
    if (status === 'Action Required' && !note) return setAsk({ title: `What should ${p.name} correct?`, fields: [{ key: 'note', label: 'Note shown to the partner' }], onSubmit: (v) => decide(p, item, status, v.note) });
    try { await api.post(`/gp/admin/partners/${p.user_id}/kyc/${item}`, { status, note }); toast.success('Updated'); load(); } catch (e) { toast.error(errMsg(e)); }
  };
  const list = rows.filter((r) => !q || `${r.name} ${r.partner_id} ${r.mobile}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <Card className="p-4">
      <AskDialog ask={ask} onClose={() => setAsk(null)} />
      <Input data-testid="gpa-search" className="!w-72 mb-3" placeholder="Search partner" value={q} onChange={(e) => setQ(e.target.value)} />
      <RTable testid="gpa-partners" rows={list.slice(0, 200)} keyF={(r) => r.user_id} cols={[['name', 'Partner', (r) => <span><b>{r.name}</b><span className="block text-xs text-[#6B6F6A]">{r.partner_id} · {r.mobile} · {r.reg_type || 'existing'}</span></span>],
        ['status', 'Status', (r) => <span className="flex flex-col items-start gap-1"><Badge s={r.status} />{r.status !== 'Active' && <button data-testid={`gpa-approve-${r.partner_id}`} className="text-xs font-semibold text-[#1F7A33] underline" onClick={() => approve(r)}>Approve as Active</button>}</span>],
        ['kyc', 'KYC', (r) => <div className="space-y-1">{Object.entries(r.kyc).map(([k, v]) => <div key={k} className="flex items-center gap-1 text-xs"><span className="w-20 capitalize">{k.replace('_', ' ')}</span><Badge s={v.status} />
          {v.doc_id && <button data-testid={`gpa-view-${r.partner_id}-${k}`} className="text-[#24508F] underline" onClick={() => dl(`/gp/docs/${v.doc_id}`, '', true)}>view</button>}
          {v.status === 'Pending' && <><button data-testid={`gpa-verify-${r.partner_id}-${k}`} className="text-[#1F7A33] font-semibold" onClick={() => decide(r, k, 'Verified')}>Verify</button>
            <button data-testid={`gpa-reject-${r.partner_id}-${k}`} className="text-[#A12B2B]" onClick={() => decide(r, k, 'Action Required')}>Reject</button></>}</div>)}</div>],
        ['agreement', 'Agreement', (r) => (r.agreement ? <span><Badge s={r.agreement.status} /> <span className="text-xs">v{r.agreement.version}</span>{r.agreement.status === 'Signed' && <button className="block text-xs text-[#24508F] underline" onClick={() => dl(`/gp/agreement/${r.agreement.id}/pdf`, `Bankezee_GP_Agreement_${r.partner_id}_v${r.agreement.version}_signed.pdf`)}>signed copy</button>}</span> : <span className="text-xs text-[#6B6F6A]">Not issued</span>)]]} />
    </Card>
  );
};

const Rates = () => {
  const [batch, setBatch] = useState(null);
  const [rates, setRates] = useState([]);
  const [hist, setHist] = useState([]);
  const load = () => { api.get('/gp/admin/rates').then(({ data }) => setRates(data)); api.get('/gp/admin/rates/batches').then(({ data }) => setHist(data)); };
  useEffect(() => { load(); }, []);
  const upload = async (e) => { const fd = new FormData(); fd.append('file', e.target.files[0]); e.target.value = ''; try { const { data } = await api.post('/gp/admin/rates/preview', fd, { headers: { 'Content-Type': 'multipart/form-data' } }); setBatch(data); load(); } catch (er) { toast.error(errMsg(er)); } };
  const publish = async () => { try { const { data } = await api.post(`/gp/admin/rates/batches/${batch.id}/publish`); toast.success(`Published ${data.published} rate(s)`); setBatch(null); load(); } catch (er) { toast.error(errMsg(er)); } };
  return (
    <div className="space-y-4">
      <Card className="p-4 flex flex-wrap gap-2 items-center">
        <Btn variant="outline" data-testid="rates-template" onClick={() => dl('/gp/admin/rates/template.csv', 'gp_payout_structure_template.csv')}>Download CSV template</Btn>
        <label className="cursor-pointer"><span className="inline-flex rounded-lg px-4 py-2.5 text-sm font-semibold bg-[#2FB34A] text-white">Upload CSV for preview</span><input data-testid="rates-upload" type="file" accept=".csv" className="hidden" onChange={upload} /></label>
        <p className="text-xs text-[#6B6F6A] basis-full">percent: enter 1.25 for 1.25% · fixed: INR amount · blank lender = all lenders · blank partner = standard rate · rate_code is the stable ID; omitted rows are never deleted.</p>
      </Card>
      {batch && <Card className="p-4" data-testid="rates-preview">
        <div className="flex flex-wrap gap-2 items-center mb-3"><b className="mr-auto">Preview · {batch.file_name}</b>{Object.entries(batch.summary).map(([k, v]) => <Badge key={k} tone={k === 'Error' ? 'red' : k === 'New' ? 'green' : k === 'Update' ? 'blue' : 'gray'}>{k}: {v}</Badge>)}
          {batch.summary.Error > 0 && <Btn variant="outline" onClick={() => dl(`/gp/admin/rates/batches/${batch.id}/errors.csv`, 'rate_errors.csv')}>Download errors</Btn>}
          <Btn variant="outline" onClick={() => api.delete(`/gp/admin/rates/batches/${batch.id}`).then(() => { setBatch(null); load(); })}>Discard draft</Btn>
          <Btn data-testid="rates-publish" disabled={batch.summary.Error > 0 || batch.summary.New + batch.summary.Update === 0} onClick={publish}>Publish</Btn></div>
        <RTable rows={batch.rows} keyF={(r) => r.row} cols={[['row', 'Row'], ['kind', 'Change', (r) => <Badge tone={r.kind === 'Error' ? 'red' : r.kind === 'New' ? 'green' : r.kind === 'Update' ? 'blue' : 'gray'}>{r.kind}</Badge>], ['rate_code', 'Rate code'], ['product_code', 'Product'], ['lender_code', 'Lender'], ['payout_type', 'Type'], ['payout_value', 'Value'], ['effective_from', 'From'], ['partner_code', 'Partner'], ['errors', 'Errors', (r) => <span className="text-xs text-[#A12B2B]">{r.errors.join('; ')}</span>]]} />
      </Card>}
      <Card className="p-4"><b className="block mb-2">Published structure & versions</b>
        <RTable testid="rates-published" rows={rates} keyF={(r) => `${r.rate_code}-${r.version}`} cols={[['rate_code', 'Rate code'], ['version', 'v'], ['status', 'Status', (r) => <Badge s={r.status === 'published' ? 'Current' : 'Previous version'} />], ['product_code', 'Product'], ['lender_code', 'Lender', (r) => r.lender_code || 'All'], ['payout', 'Payout', (r) => (r.payout_type === 'percent' ? `${r.payout_value}%` : inr(r.payout_value))], ['effective_from', 'Effective', (r) => `${r.effective_from}${r.effective_to ? ` → ${r.effective_to}` : ''}`], ['partner_code', 'Partner', (r) => r.partner_code || 'Standard'], ['published_by', 'Published', (r) => `${r.published_by || ''} ${String(r.published_at || '').slice(0, 10)}`]]} /></Card>
      <Card className="p-4"><b className="block mb-2">Upload history</b>{hist.map((h) => <p key={h.id} className="text-xs py-1 border-t border-[#F0F1EE]">{String(h.uploaded_at).slice(0, 16)} · {h.file_name} · {h.uploaded_by} · <Badge s={h.status === 'published' ? 'Current' : h.status === 'draft' ? 'Pending' : 'Expired'}>{h.status}</Badge> {h.published_by && `by ${h.published_by}`}</p>)}</Card>
    </div>
  );
};

const Ledger = () => {
  const [rows, setRows] = useState([]);
  const [f, setF] = useState({ partner_code: '', referral_ref: '', file_id: '', product_code: 'PL', lender_code: '', disbursement_date: '', disbursed_amount: '', deductions: 0, deduction_note: '' });
  const [ask, setAsk] = useState(null);
  const load = () => api.get('/gp/admin/payouts').then(({ data }) => setRows(data));
  useEffect(() => { load(); }, []);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const add = async (e) => { e.preventDefault(); try { await api.post('/gp/admin/payouts', { ...f, disbursed_amount: Number(f.disbursed_amount), deductions: Number(f.deductions || 0), file_id: f.file_id || null }); toast.success('Payout added — rate resolved and frozen'); load(); } catch (er) { toast.error(errMsg(er)); } };
  const status = async (r, s, extra) => {
    const fields = ['On Hold', 'Reversed'].includes(s) ? [{ key: 'reason', label: 'Reason shown to the partner' }] : s === 'Paid' ? [{ key: 'payment_date', label: 'Payment date', type: 'date' }, { key: 'txn_ref', label: 'Transaction reference' }] : [];
    if (fields.length && !extra) return setAsk({ title: `Mark as ${s}`, fields, onSubmit: (v) => status(r, s, v) });
    const body = { status: s, ...(extra || {}) };
    try { await api.patch(`/gp/admin/payouts/${r.id}`, body); toast.success(`Marked as ${s}`); load(); } catch (er) { toast.error(errMsg(er)); }
  };
  return (
    <div className="space-y-4">
      <AskDialog ask={ask} onClose={() => setAsk(null)} />
      <Card className="p-4"><form onSubmit={add} className="grid sm:grid-cols-4 gap-3 items-end" data-testid="ledger-form">
        {[['partner_code', 'Partner ID'], ['file_id', 'File ID'], ['referral_ref', 'Payout reference'], ['product_code', 'Product code'], ['lender_code', 'Lender code'], ['disbursement_date', 'Qualifying event date'], ['disbursed_amount', 'Disbursed amount ₹'], ['deductions', 'Deductions ₹'], ['deduction_note', 'Deduction note']].map(([k, l]) =>
          <Field key={k} label={l}><Input data-testid={`ledger-${k}`} type={k === 'disbursement_date' ? 'date' : 'text'} required={['partner_code', 'product_code', 'disbursement_date', 'disbursed_amount'].includes(k)} value={f[k]} onChange={set(k)} /></Field>)}
        <Btn data-testid="ledger-add">Add payout</Btn></form></Card>
      <Card className="p-4"><RTable testid="ledger-table" rows={rows} cols={[['partner_code', 'Partner'], ['file_id', 'File', (r) => <span className="font-mono text-xs">{(r.file_id || r.referral_ref || '—').slice(0, 8)}</span>], ['product_code', 'Product'], ['disbursement_date', 'Date'], ['disbursed_amount', 'Amount', (r) => inr(r.disbursed_amount)], ['rate_code', 'Rate (version)', (r) => (r.kind === 'adjustment' ? <span className="text-xs font-semibold text-[#24508F]">Adjustment</span> : <span>{r.rate_code ? `${r.rate_code} v${r.rate_version}` : '—'}{r.source === 'manual' && <span className="ml-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[#FFF4DB] text-[#8A6100]">Manual</span>}</span>)], ['net', 'Net', (r) => inr(r.net)],
        ['status', 'Status', (r) => <span><Badge s={r.status} />{r.reason && <span className="block text-xs">{r.reason}</span>}{r.status === 'Paid' && r.payment_date && <span className="block text-xs text-[#6B6F6A]" data-testid={`ledger-paid-${r.id}`}>{r.payment_date} · {r.txn_ref}</span>}</span>], ['act', 'Update', (r) => <Select data-testid={`ledger-status-${r.id}`} value="" onChange={(e) => e.target.value && status(r, e.target.value)} options={[['', 'Change…'], 'Under Verification', 'Payable', 'Paid', 'On Hold', 'Reversed'].map((x) => (Array.isArray(x) ? x : [x, x]))} />]]} /></Card>
    </div>
  );
};

const Agreements = () => {
  const [tpls, setTpls] = useState([]);
  const [ags, setAgs] = useState([]);
  const [setup, setSetup] = useState(null);
  const [ed, setEd] = useState(null);
  const [codes, setCodes] = useState('');
  const load = () => { api.get('/gp/admin/agreement-templates').then(({ data }) => setTpls(data)); api.get('/gp/admin/agreements').then(({ data }) => setAgs(data)); api.get('/gp/admin/setup-status').then(({ data }) => setSetup(data)); };
  useEffect(() => { load(); }, []);
  const save = async () => { try { await api.post('/gp/admin/agreement-templates', ed); toast.success('New draft version saved'); setEd(null); load(); } catch (e) { toast.error(errMsg(e)); } };
  const act = async (fn, ok) => { try { const { data } = await fn(); toast.success(ok(data)); load(); } catch (e) { toast.error(errMsg(e)); } };
  return (
    <div className="space-y-4">
      {setup && <Card className="p-4 text-sm" data-testid="agreement-setup">Signing method: <b>{setup.signing_method}</b> · Signing email: <Badge s={setup.signing_email_configured ? 'Verified' : 'Action Required'}>{setup.signing_email_configured ? 'Configured' : 'Not configured'}</Badge> · Approved template: <Badge s={setup.template_published ? 'Verified' : 'Pending'}>{setup.template_published ? `Published v${setup.published_version}` : 'Not published'}</Badge> · Published rates: {setup.rates_published}</Card>}
      <Card className="p-4"><b className="block mb-2">Templates</b>{tpls.map((t) => (
        <div key={t.id} className="flex flex-wrap gap-2 items-center py-2 border-t border-[#F0F1EE] text-sm"><span className="mr-auto">v{t.version} · {t.title} <Badge s={t.status === 'published' ? 'Current' : 'Pending'}>{t.status}</Badge></span>
          <Btn variant="outline" className="!py-1" data-testid={`tpl-preview-${t.version}`} onClick={() => dl(`/gp/admin/agreement-templates/${t.id}/preview`, '', true)}>Preview</Btn>
          <Btn variant="outline" className="!py-1" data-testid={`tpl-edit-${t.version}`} onClick={() => setEd({ title: t.title, body: t.body, schedule: t.schedule })}>Edit as new version</Btn>
          {t.status === 'draft' && <Btn className="!py-1" data-testid={`tpl-publish-${t.version}`} onClick={() => act(() => api.post(`/gp/admin/agreement-templates/${t.id}/publish`), () => 'Published')}>Publish</Btn>}
          {t.status === 'published' && <><Input data-testid="tpl-issue-codes" className="!w-56 !py-1" placeholder="Partner IDs, comma separated" value={codes} onChange={(e) => setCodes(e.target.value)} />
            <Btn className="!py-1" data-testid="tpl-issue" onClick={() => act(() => api.post(`/gp/admin/agreement-templates/${t.id}/issue`, { partner_codes: codes.split(',').map((c) => c.trim()).filter(Boolean) }), (d) => `Issued to ${d.issued}`)}>Issue</Btn>
            <Btn variant="outline" className="!py-1" data-testid="tpl-issue-all" onClick={() => window.confirm('Issue to ALL active partners?') && act(() => api.post(`/gp/admin/agreement-templates/${t.id}/issue`, { all_partners: true }), (d) => `Issued to ${d.issued}`)}>Issue to all</Btn></>}
        </div>))}</Card>
      {ed && <Card className="p-4 space-y-3"><Field label="Title"><Input value={ed.title} onChange={(e) => setEd({ ...ed, title: e.target.value })} /></Field>
        <Field label="Agreement body" hint="Placeholders: {{company_name}} {{partner_name}} {{partner_id}} {{effective_date}} {{activities}} {{schedule_version}} {{reg_type}} {{address}} {{mobile}} {{email}} {{pan_masked}} {{bank_masked}} {{ifsc}}"><textarea className="w-full h-72 border rounded-lg p-3 text-xs font-mono" value={ed.body} onChange={(e) => setEd({ ...ed, body: e.target.value })} /></Field>
        <Field label="Commercial schedule"><textarea className="w-full h-32 border rounded-lg p-3 text-xs font-mono" value={ed.schedule} onChange={(e) => setEd({ ...ed, schedule: e.target.value })} /></Field>
        <div className="flex gap-2 justify-end"><Btn variant="outline" onClick={() => setEd(null)}>Cancel</Btn><Btn onClick={save}>Save as new draft</Btn></div></Card>}
      <Card className="p-4"><b className="block mb-2">Partner agreements</b><RTable rows={ags} cols={[['partner_code', 'Partner'], ['version', 'Version'], ['status', 'Status', (r) => <Badge s={r.status} />], ['issued_at', 'Issued', (r) => String(r.issued_at).slice(0, 10)], ['signed_at', 'Signed', (r) => (r.signed_at ? `${String(r.signed_at).slice(0, 16)} · ${r.txn_ref}` : '—')], ['ev', 'Evidence', (r) => (r.status === 'Signed' ? <button className="text-xs underline text-[#24508F]" onClick={() => dl(`/gp/agreement/${r.id}/pdf`, `Bankezee_GP_Agreement_${r.partner_code}_v${r.version}_signed.pdf`)}>Signed PDF</button> : '—')]]} /></Card>
    </div>
  );
};

export default function AdminGpProgramme() {
  const [tab, setTab] = useState('partners');
  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto" data-testid="admin-gp-programme">
      <PageHead title="Growth Partner Programme" sub="Partner KYC review, payout structure, payout ledger and agreements." />
      <Tabs tabs={[['partners', 'Partners & KYC'], ['rates', 'Payout Structure'], ['ledger', 'Payout Ledger'], ['agreements', 'Agreements'], ['creatives', 'Marketing Creatives']]} value={tab} onChange={setTab} />
      {tab === 'partners' && <Partners />}{tab === 'rates' && <Rates />}{tab === 'ledger' && <Ledger />}{tab === 'agreements' && <Agreements />}{tab === 'creatives' && <AdminCreatives />}
    </div>
  );
}
