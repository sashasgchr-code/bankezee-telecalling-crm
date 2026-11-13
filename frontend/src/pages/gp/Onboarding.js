import React, { useState } from 'react';
import { toast } from 'sonner';
import api from '../../services/api';
import { Btn, Field, Input, Select, Badge, errMsg } from './ui';
import { Upload, ShieldCheck } from 'lucide-react';

const STATES = ['Andhra Pradesh', 'Telangana', 'Karnataka', 'Tamil Nadu', 'Maharashtra', 'Delhi', 'Gujarat', 'Kerala', 'West Bengal', 'Uttar Pradesh', 'Rajasthan', 'Madhya Pradesh', 'Haryana', 'Punjab', 'Odisha', 'Other'];
const ENTITY_TYPES = ['Sole Proprietorship', 'Partnership', 'LLP', 'Private Limited', 'Public Limited', 'Trust / Society'];

export const ProfileForm = ({ me, onSaved, submitLabel = 'Save & Continue' }) => {
  const biz = me.profile?.reg_type === 'business';
  const [f, setF] = useState({ ...me.profile, email: me.profile?.email || me.email });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try { const { data } = await api.put('/gp/me/profile', f); toast.success('Profile saved'); onSaved(data); } catch (er) { toast.error(errMsg(er)); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={save} className="grid sm:grid-cols-2 gap-4" data-testid="profile-form">
      <Field label={biz ? 'Authorised signatory full name' : 'Legal name (as on PAN)'}><Input data-testid="pf-legal-name" required value={f.legal_name || ''} onChange={set('legal_name')} /></Field>
      <Field label="Email"><Input data-testid="pf-email" type="email" required value={f.email || ''} onChange={set('email')} /></Field>
      {!biz && <Field label="Date of birth" hint="Needed for identity verification"><Input data-testid="pf-dob" type="date" required value={f.dob || ''} onChange={set('dob')} /></Field>}
      {biz && <>
        <Field label="Legal entity name"><Input data-testid="pf-entity-name" required value={f.entity_name || ''} onChange={set('entity_name')} /></Field>
        <Field label="Entity type"><Select data-testid="pf-entity-type" value={f.entity_type || ''} onChange={set('entity_type')} options={[['', 'Select…'], ...ENTITY_TYPES.map((x) => [x, x])]} /></Field>
        <Field label="Signatory designation"><Input data-testid="pf-sig-designation" required value={f.signatory_designation || ''} onChange={set('signatory_designation')} /></Field>
        <Field label="GSTIN (if registered)"><Input data-testid="pf-gstin" value={f.gstin || ''} onChange={set('gstin')} /></Field>
        <Field label="Registration no. (CIN / LLPIN / Udyam)"><Input data-testid="pf-reg-no" value={f.registration_no || ''} onChange={set('registration_no')} /></Field>
      </>}
      <div className="sm:col-span-2"><Field label={biz ? 'Registered address' : 'Address'}><Input data-testid="pf-address" required value={(biz ? f.registered_address : f.address) || ''} onChange={set(biz ? 'registered_address' : 'address')} /></Field></div>
      <Field label="City"><Input data-testid="pf-city" required value={f.city || ''} onChange={set('city')} /></Field>
      <Field label="State"><Select data-testid="pf-state" value={f.state || ''} onChange={set('state')} options={[['', 'Select…'], ...STATES.map((x) => [x, x])]} /></Field>
      <Field label="PIN code"><Input data-testid="pf-pin" required inputMode="numeric" maxLength={6} value={f.pin || ''} onChange={set('pin')} /></Field>
      <div className="sm:col-span-2 flex justify-end"><Btn data-testid="pf-save" disabled={busy}>{busy ? 'Saving…' : submitLabel}</Btn></div>
    </form>
  );
};

const KYC_META = {
  pan: { label: 'PAN card', number: 'PAN number', ph: 'ABCDE1234F' },
  identity: { label: 'Identity proof', number: 'Document number', ph: 'Aadhaar (last 4 shown) / Passport / Voter ID', idType: true },
  business_reg: { label: 'Business registration', number: 'Registration / GSTIN number', ph: 'GST / CIN / Udyam certificate' },
  bank: { label: 'Cancelled cheque or bank statement', note: 'Confirms your payout account' },
};

const KycRow = ({ k, item, onSaved }) => {
  const m = KYC_META[k];
  const [num, setNum] = useState('');
  const [idType, setIdType] = useState('Aadhaar');
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const open = item.status === 'Not Submitted' || item.status === 'Action Required';
  const [edit, setEdit] = useState(open);
  const up = async () => {
    if (!file) return toast.error('Choose a file');
    const fd = new FormData();
    fd.append('file', file);
    if (num) fd.append('number', num);
    if (m.idType) fd.append('id_type', idType);
    setBusy(true);
    try { const { data } = await api.post(`/gp/me/kyc/${k}`, fd); toast.success(`${m.label} submitted for verification`); setEdit(false); onSaved(data); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <div className="border border-[#E6E8E3] rounded-xl p-4" data-testid={`kyc-${k}`}>
      <div className="flex flex-wrap items-center gap-2">
        <ShieldCheck className="w-4 h-4 text-[#2FB34A]" /><b className="text-sm mr-auto">{m.label}</b><Badge s={item.status} />
        {!edit && item.status !== 'Verified' && <Btn variant="ghost" className="!py-1" data-testid={`kyc-${k}-resubmit`} onClick={() => setEdit(true)}>Replace</Btn>}
      </div>
      {item.number && <p className="text-xs text-[#6B6F6A] mt-1">{item.id_type ? `${item.id_type}: ` : ''}{item.number}{item.file_name ? ` · ${item.file_name}` : ''}</p>}
      {k === 'bank' && item.account && <p className="text-xs text-[#6B6F6A] mt-1">{item.holder} · {item.account} · {item.ifsc}</p>}
      {item.note && <p className="text-xs text-[#A12B2B] mt-1" data-testid={`kyc-${k}-note`}>{item.note}</p>}
      {edit && (
        <div className="grid sm:grid-cols-3 gap-3 mt-3 items-end">
          {m.idType && <Field label="Document type"><Select value={idType} onChange={(e) => setIdType(e.target.value)} options={['Aadhaar', 'Passport', 'Voter ID', 'Driving Licence']} /></Field>}
          {m.number && <Field label={m.number}><Input data-testid={`kyc-${k}-number`} placeholder={m.ph} value={num} onChange={(e) => setNum(e.target.value.toUpperCase())} /></Field>}
          <Field label="Upload (PDF/JPG/PNG, max 10 MB)" hint={m.note}>
            <input data-testid={`kyc-${k}-file`} type="file" accept=".pdf,image/*" onChange={(e) => setFile(e.target.files[0])} className="text-xs" />
          </Field>
          <Btn data-testid={`kyc-${k}-upload`} disabled={busy} onClick={up} type="button"><Upload className="w-4 h-4" />{busy ? 'Uploading…' : 'Submit'}</Btn>
        </div>
      )}
    </div>
  );
};

export const KycForm = ({ me, onSaved, only }) => (
  <div className="space-y-3" data-testid="kyc-form">
    {Object.entries(me.kyc).filter(([k]) => (only ? only.includes(k) : k !== 'bank')).map(([k, item]) => <KycRow key={k} k={k} item={item} onSaved={onSaved} />)}
    <p className="text-xs text-[#6B6F6A]">Documents are reviewed by the Bankezee partner team, usually within 1–2 working days. You'll see Verified or Action Required here.</p>
  </div>
);

export const PayoutForm = ({ me, onSaved }) => {
  const [f, setF] = useState({ holder: me.payout?.holder || me.profile?.legal_name || '', account_number: '', confirm_account_number: '', ifsc: me.payout?.ifsc || '' });
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState(!me.payout?.account);
  const set = (k) => (e) => setF({ ...f, [k]: k === 'ifsc' ? e.target.value.toUpperCase() : e.target.value });
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try { const { data } = await api.put('/gp/me/payout', f); toast.success('Payout account saved'); setEdit(false); onSaved(data); } catch (er) { toast.error(errMsg(er)); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-3" data-testid="payout-form">
      {me.payout?.account && !edit && (
        <div className="border border-[#E6E8E3] rounded-xl p-4 flex flex-wrap items-center gap-2">
          <div className="mr-auto"><b className="text-sm">{me.payout.holder}</b><p className="text-xs text-[#6B6F6A]" data-testid="payout-masked">{me.payout.account} · {me.payout.ifsc}</p></div>
          <Badge s={me.payout.status} /><Btn variant="ghost" className="!py-1" data-testid="payout-change" onClick={() => setEdit(true)}>Change</Btn>
        </div>
      )}
      {edit && (
        <form onSubmit={save} className="grid sm:grid-cols-2 gap-4">
          <Field label="Account holder name"><Input data-testid="po-holder" required value={f.holder} onChange={set('holder')} /></Field>
          <Field label="IFSC"><Input data-testid="po-ifsc" required maxLength={11} value={f.ifsc} onChange={set('ifsc')} placeholder="HDFC0001234" /></Field>
          <Field label="Account number"><Input data-testid="po-account" required inputMode="numeric" type="password" value={f.account_number} onChange={set('account_number')} /></Field>
          <Field label="Confirm account number" error={f.confirm_account_number && f.confirm_account_number !== f.account_number ? 'Account numbers do not match' : null}>
            <Input data-testid="po-confirm" required inputMode="numeric" value={f.confirm_account_number} onChange={set('confirm_account_number')} /></Field>
          <p className="sm:col-span-2 text-xs text-[#6B6F6A]">Changing a verified account sends it for re-verification. Payouts go only to an account in your (or your business's) name.</p>
          <div className="sm:col-span-2 flex justify-end gap-2">{me.payout?.account && <Btn type="button" variant="outline" onClick={() => setEdit(false)}>Cancel</Btn>}<Btn data-testid="po-save" disabled={busy}>{busy ? 'Saving…' : 'Save payout account'}</Btn></div>
        </form>
      )}
      <KycForm me={me} onSaved={onSaved} only={['bank']} />
    </div>
  );
};

export const AgreementPanel = ({ onSigned }) => {
  const [a, setA] = useState(null);
  const [code, setCode] = useState('');
  const [accept, setAccept] = useState(false);
  const [sent, setSent] = useState(null);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState('');
  const load = () => api.get('/gp/agreement').then(({ data }) => { setA(data); if (data.current) api.get(`/gp/agreement/${data.current.id}/pdf`, { responseType: 'blob' }).then((r) => setText(URL.createObjectURL(r.data))); });
  React.useEffect(() => { load(); }, []);
  const dl = async (id, name) => {
    const r = await api.get(`/gp/agreement/${id}/pdf`, { responseType: 'blob' });
    const u = URL.createObjectURL(r.data); const l = document.createElement('a'); l.href = u; l.download = name; l.click();
  };
  const [shown, setShown] = useState(null);
  const send = async () => { setBusy(true); try { const { data } = await api.post(`/gp/agreement/${a.current.id}/send-code`); setSent(data.sent_to); setShown(data.preview_code || null); toast.success(data.preview_code ? 'Signing code generated' : `Code sent to ${data.sent_to}`); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); } };
  const sign = async () => { setBusy(true); try { await api.post(`/gp/agreement/${a.current.id}/sign`, { code, accept }); toast.success('Agreement signed'); await load(); onSigned && onSigned(); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); } };
  if (!a) return <p className="text-sm text-[#6B6F6A]">Loading…</p>;
  const c = a.current;
  return (
    <div className="space-y-4" data-testid="agreement-panel">
      {!c ? <div className="rounded-xl bg-[#FFF6E0] border border-[#F2DDA4] p-4 text-sm text-[#8A6100]" data-testid="agreement-not-issued">Your Bankezee Growth Partner Agreement hasn't been issued yet. Once Bankezee issues it, you'll read and sign it here.</div> : <>
        <div className="flex flex-wrap items-center gap-2"><b className="mr-auto">{c.title} · v{c.version}</b><Badge s={c.status} />
          <Btn variant="outline" data-testid="agreement-download" onClick={() => dl(c.id, `Bankezee_GP_Agreement_v${c.version}${c.status === 'Signed' ? '_signed' : ''}.pdf`)}>{c.status === 'Signed' ? 'Download Signed Agreement' : 'Download'}</Btn></div>
        {text && <iframe title="agreement" src={text} className="w-full h-[55vh] border border-[#E6E8E3] rounded-xl bg-white" data-testid="agreement-viewer" />}
        {c.status !== 'Signed' && (
          <div className="sticky bottom-0 bg-white border border-[#E6E8E3] rounded-xl p-4 space-y-3 shadow-sm" data-testid="sign-controls">
            <label className="flex gap-2 text-sm"><input data-testid="agreement-accept" type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} className="mt-1" />I have read and agree to the Bankezee Growth Partner Agreement and its Commercial Schedule, and I sign it electronically using a one-time code.</label>
            <div className="flex flex-wrap gap-2 items-center">
              <Btn variant="outline" data-testid="agreement-send-code" disabled={busy || !accept} onClick={send}>{sent ? 'Resend code' : 'Email me a signing code'}</Btn>
              {sent && <><Input data-testid="agreement-code" className="!w-36" inputMode="numeric" maxLength={6} placeholder="6-digit code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
                <Btn data-testid="agreement-sign" disabled={busy || code.length !== 6 || !accept} onClick={sign}>Sign Agreement</Btn></>}
            </div>
            {sent && !shown && <p className="text-xs text-[#6B6F6A]" data-testid="agreement-code-sent">Code emailed to {sent}. It expires in 10 minutes.</p>}
            {shown && <p className="text-xs rounded-lg bg-[#EAF1FB] border border-[#C9DAF2] text-[#24508F] p-2" data-testid="agreement-preview-code">Email delivery isn't set up yet, so your code is shown here: <b className="text-sm tracking-widest">{shown}</b></p>}
            {c.status === 'Action Required' && <p className="text-xs text-[#A12B2B]">The last signing attempt didn't complete. Request a new code to sign the same document.</p>}
          </div>
        )}
      </>}
      {a.signed_history?.length > 0 && <div><p className="text-sm font-semibold mb-2">Signed agreements</p>{a.signed_history.map((h) => (
        <div key={h.id} className="flex flex-wrap gap-2 items-center text-sm border-t border-[#F0F1EE] py-2"><span className="mr-auto">v{h.version} · signed {String(h.signed_at).slice(0, 10)} · {h.txn_ref}</span>
          <Btn variant="ghost" className="!py-1" data-testid={`signed-dl-${h.id}`} onClick={() => dl(h.id, `Bankezee_GP_Agreement_v${h.version}_signed.pdf`)}>Download</Btn></div>))}</div>}
    </div>
  );
};
