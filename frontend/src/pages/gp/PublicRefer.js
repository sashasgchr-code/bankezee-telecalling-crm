import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { toast } from 'sonner';
import api from '../../services/api';
import { AuthShell } from './GpAuth';
import { Btn, Field, Input, Select, errMsg } from './ui';
import { CheckCircle2 } from 'lucide-react';

export default function PublicRefer() {
  const { code } = useParams();
  const [p, setP] = useState(null);
  const [err, setErr] = useState(null);
  const [done, setDone] = useState(false);
  const [f, setF] = useState({ name: '', mobile: '', city: '', loan_type: 'Personal Loan', consent: false });
  useEffect(() => { api.get(`/gp/public/partner/${code}`).then(({ data }) => setP(data)).catch(() => setErr('This referral link is not valid.')); }, [code]);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    try { await api.post(`/gp/public/refer/${code}`, f); setDone(true); } catch (er) { toast.error(errMsg(er)); }
  };
  return (
    <AuthShell>
      {err ? <p className="text-sm text-[#A12B2B]" data-testid="refer-invalid">{err}</p> : !p ? <p className="text-sm">Loading…</p> : done ? (
        <div className="text-center py-8" data-testid="refer-done"><CheckCircle2 className="w-12 h-12 text-[#2FB34A] mx-auto" /><h1 className="text-2xl font-bold mt-3">Thank you!</h1><p className="text-sm text-[#6B6F6A] mt-1">A Bankezee loan expert will call you shortly.</p></div>
      ) : (
        <>
          <h1 className="text-3xl font-bold">Apply for a loan</h1>
          <p className="text-sm text-[#6B6F6A] mt-1 mb-6">Referred by Bankezee Growth Partner {p.display_name} ({p.partner_id})</p>
          <form onSubmit={submit} className="space-y-4" data-testid="refer-form">
            <Field label="Your name"><Input data-testid="refer-name" required value={f.name} onChange={set('name')} /></Field>
            <Field label="Mobile number"><Input data-testid="refer-mobile" required inputMode="tel" value={f.mobile} onChange={set('mobile')} /></Field>
            <Field label="City"><Input data-testid="refer-city" value={f.city} onChange={set('city')} /></Field>
            <Field label="What do you need?"><Select data-testid="refer-product" value={f.loan_type} onChange={set('loan_type')} options={p.products} /></Field>
            <label className="flex gap-2 text-sm"><input data-testid="refer-consent" type="checkbox" checked={f.consent} onChange={(e) => setF({ ...f, consent: e.target.checked })} className="mt-1" />I agree to be contacted by Bankezee (NeoSales Consulting Pvt Ltd) about my loan enquiry.</label>
            <Btn className="w-full" data-testid="refer-submit" disabled={!f.consent}>Submit</Btn>
          </form>
        </>
      )}
    </AuthShell>
  );
}
