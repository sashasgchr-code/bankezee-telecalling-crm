import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { CheckCircle2, FileText, Upload } from 'lucide-react';
import api from '../../services/api';
import { useLoanTypes } from '../../constants/loanTypes';
import ExistingLoansEditor from '../../components/file-detail/ExistingLoansEditor';
import { Btn, Card, Field, Input, Select, errMsg } from './ui';

const newId = () => (window.crypto?.randomUUID ? window.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
const EMPTY = { name: '', mobile: '', loan_type: '', employment_type: '', consent: false, city: '', loan_amount_required: '', company_name: '', net_salary: '', cibil_score: '', monthly_emi_obligations: '', existing_loans: [] };
const TONE = { rejection: 'red', disbursal: 'green', approval: 'green', bank: 'blue', processing: 'blue', underwriting: 'blue', documents: 'amber', initial: 'gray' };
export const statusTone = (s) => TONE[s?.category] || 'gray';

export const useFormConfig = (publicMode) => {
  const [cfg, setCfg] = useState(null);
  useEffect(() => { api.get('/gp/files/form-config').then(({ data }) => setCfg(data)).catch(() => setCfg({ documents: {} })); }, [publicMode]);
  return cfg;
};

const num = (v) => (v === '' || v == null ? null : Number(v));

const DocPicker = ({ items, picked, setPicked }) => (
  <div className="space-y-2" data-testid="file-doc-checklist">
    {items.map((d) => (
      <label key={d.category} className="flex flex-wrap items-center gap-3 border border-[#E6E8E3] rounded-xl px-3 py-2.5 bg-white">
        <FileText className="w-4 h-4 text-[#2FB34A]" /><span className="text-sm font-medium mr-auto">{d.label}</span>
        <span className="text-xs text-[#6B6F6A] truncate max-w-[160px]">{picked[d.category]?.name || 'Optional'}</span>
        <input type="file" accept=".pdf,image/*" className="text-xs w-48" data-testid={`file-doc-${d.category}`} onChange={(e) => setPicked({ ...picked, [d.category]: e.target.files[0] })} />
      </label>
    ))}
    <p className="text-xs text-[#6B6F6A]">Documents are optional now. You can add any missing ones to the same file later.</p>
  </div>
);

export const FileForm = ({ endpoint, uploadUrl, customer, onDone, initialLoan = '' }) => {
  const { loanTypes } = useLoanTypes();
  const cfg = useFormConfig(customer);
  const [f, setF] = useState({ ...EMPTY, loan_type: initialLoan });
  const [picked, setPicked] = useState({});
  const [sid, setSid] = useState(newId);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const salaried = f.employment_type === 'salaried';
  const docs = useMemo(() => (f.employment_type && cfg?.documents?.[f.employment_type]) || [], [cfg, f.employment_type]);
  const ready = f.name.trim() && f.mobile.replace(/\D/g, '').length >= 10 && f.loan_type && f.employment_type && f.consent;
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body = { ...f, submission_id: sid, loan_amount_required: num(f.loan_amount_required), net_salary: num(f.net_salary), cibil_score: num(f.cibil_score),
        monthly_emi_obligations: num(f.monthly_emi_obligations), existing_loans: f.existing_loans.map((l) => ({ bank: l.bank, loan_type: l.loan_type, loan_amount: num(l.loan_amount), outstanding: num(l.outstanding), emi: num(l.emi) })) };
      const { data } = await api.post(endpoint, body);
      let failed = 0;
      for (const [cat, file] of Object.entries(picked)) {
        if (!file || data.duplicate) continue;
        const fd = new FormData(); fd.append('files', file);
        try { await api.post(uploadUrl(data, cat), fd, { headers: { 'Content-Type': 'multipart/form-data' } }); } catch { failed += 1; }
      }
      if (failed) toast.error(`${failed} document(s) could not be uploaded — add them to the file later`);
      setF({ ...EMPTY, loan_type: initialLoan }); setPicked({}); setSid(newId());
      onDone(data);
    } catch (er) { toast.error(errMsg(er, 'Could not submit the file')); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} className="space-y-6" data-testid="file-form">
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Full name *"><Input data-testid="file-name" required value={f.name} onChange={set('name')} /></Field>
        <Field label="Mobile number *"><Input data-testid="file-mobile" required inputMode="tel" maxLength={14} value={f.mobile} onChange={set('mobile')} placeholder="10-digit mobile" /></Field>
        <Field label="Loan type *"><select data-testid="file-loan-type" required value={f.loan_type} onChange={set('loan_type')} className="w-full rounded-lg border border-[#D9DCD6] bg-white px-3 py-2.5 text-sm">
          <option value="">Select loan type</option>{loanTypes.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select></Field>
        <Field label="Employment type *"><Select data-testid="file-employment" value={f.employment_type} onChange={set('employment_type')} options={[['', 'Select'], ['salaried', 'Salaried'], ['self_employed', 'Self-employed']]} /></Field>
      </div>
      {f.employment_type && <Card className="p-4 bg-[#FAFBF9] space-y-4" data-testid="file-more-details">
        <p className="text-sm font-semibold">More details <span className="font-normal text-[#6B6F6A]">(optional — helps the team check eligibility faster)</span></p>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="City"><Input data-testid="file-city" value={f.city} onChange={set('city')} /></Field>
          <Field label="Requested amount (₹)"><Input data-testid="file-amount" inputMode="numeric" value={f.loan_amount_required} onChange={set('loan_amount_required')} /></Field>
          <Field label={salaried ? 'Company name' : 'Business name'}><Input data-testid="file-company" value={f.company_name} onChange={set('company_name')} /></Field>
          <Field label={salaried ? 'Net monthly salary (₹)' : 'Net monthly business income (₹)'}><Input data-testid="file-income" inputMode="numeric" value={f.net_salary} onChange={set('net_salary')} /></Field>
          <Field label="CIBIL score (if known)"><Input data-testid="file-cibil" inputMode="numeric" maxLength={3} value={f.cibil_score} onChange={set('cibil_score')} /></Field>
          <Field label="Monthly EMI obligations (₹)"><Input data-testid="file-emi" inputMode="numeric" value={f.monthly_emi_obligations} onChange={set('monthly_emi_obligations')} /></Field>
        </div>
        <div data-testid="file-existing-loans"><ExistingLoansEditor loans={f.existing_loans} legacyLoans={[]} isEditing onChange={(l) => setF({ ...f, existing_loans: l })} /></div>
      </Card>}
      {docs.length > 0 && <div><p className="text-sm font-semibold mb-2">Documents</p><DocPicker items={docs} picked={picked} setPicked={setPicked} /></div>}
      <label className="flex gap-2 text-sm"><input data-testid="file-consent" type="checkbox" checked={f.consent} onChange={(e) => setF({ ...f, consent: e.target.checked })} className="mt-1" />
        {customer ? 'I agree to be contacted by Bankezee (NeoSales Consulting Pvt Ltd) about my loan application.' : 'The customer has agreed to be contacted by Bankezee about this loan application.'}</label>
      <div className="flex justify-end"><Btn data-testid="file-submit" disabled={busy || !ready}><Upload className="w-4 h-4" />{busy ? 'Submitting…' : 'Submit File'}</Btn></div>
    </form>
  );
};

export const FileSuccess = ({ res, onOpen, onAnother }) => (
  <div className="text-center py-8" data-testid="file-success">
    <CheckCircle2 className="w-12 h-12 text-[#2FB34A] mx-auto" />
    <p className="text-xl font-bold mt-3">{res.duplicate ? 'This customer already has a file' : 'Loan File submitted'}</p>
    <p className="text-sm text-[#55585A] mt-1">File ID <b data-testid="file-success-id">{res.file_id}</b> · Status <b data-testid="file-success-status">{res.status?.label}</b></p>
    <div className="flex justify-center gap-2 mt-5">{onOpen && <Btn data-testid="file-success-open" onClick={onOpen}>Open file</Btn>}{onAnother && <Btn variant="outline" data-testid="file-success-another" onClick={onAnother}>Add another file</Btn>}</div>
  </div>
);
