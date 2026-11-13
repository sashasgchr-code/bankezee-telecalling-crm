import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import api from '../../services/api';
import useAuthStore from '../../store/authStore';
import { LOGO, Btn, Field, Input, Card, errMsg } from './ui';
import { ProfileForm, KycForm, PayoutForm, AgreementPanel } from './Onboarding';
import { Check, CheckCircle2, IndianRupee, Share2, BadgeCheck } from 'lucide-react';

export const AuthShell = ({ children }) => (
  <div className="min-h-screen bg-[#F6F7F5] lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]" style={{ fontFamily: "'Poppins', 'Segoe UI', sans-serif" }}>
    <aside className="hidden lg:flex flex-col justify-between p-12 bg-gradient-to-b from-[#EEF8EF] to-[#F6F7F5] border-r border-[#E6E8E3]">
      <img src={LOGO} alt="Bankezee" className="h-12 w-auto self-start" />
      <div>
        <p className="text-xs font-bold tracking-[0.2em] text-[#2FB34A] uppercase">Growth Partner Programme</p>
        <h2 className="text-4xl font-bold text-[#2B2B2B] leading-tight mt-3">Submit loan files.<br />Track every status.<br />Get paid on time.</h2>
        <ul className="mt-8 space-y-4 text-[#2B2B2B]">
          {[[IndianRupee, 'Transparent payout structure with statements'], [Share2, 'Your own application link and QR'], [BadgeCheck, 'Digital partner card and certificate']].map(([I, t]) => (
            <li key={t} className="flex items-center gap-3 text-sm"><span className="w-9 h-9 rounded-full bg-white border border-[#E6E8E3] flex items-center justify-center"><I className="w-4 h-4 text-[#2FB34A]" /></span>{t}</li>
          ))}
        </ul>
      </div>
      <p className="text-xs text-[#6B6F6A]">Bankezee is a brand of NeoSales Consulting Pvt Ltd.</p>
    </aside>
    <main className="flex flex-col min-h-screen">
      <div className="lg:hidden p-5 border-b border-[#E6E8E3] bg-white"><img src={LOGO} alt="Bankezee" className="h-9" /></div>
      <div className="flex-1 flex items-start lg:items-center justify-center p-5 sm:p-10"><div className="w-full max-w-xl">{children}</div></div>
    </main>
  </div>
);

export const GpSignIn = () => {
  const [f, setF] = useState({ identifier: '', password: '' });
  const [busy, setBusy] = useState(false);
  const { setSession } = useAuthStore();
  const nav = useNavigate();
  const go = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { data } = await api.post('/gp/login', f);
      setSession(data.token, data.user);
      const r = data.user.role;
      if (['admin', 'manager', 'hr'].includes(r)) return nav(r === 'admin' ? '/admin' : `/${r}`);
      const { data: me } = await api.get('/gp/me').catch(() => ({ data: null }));
      nav(me && me.status === 'Onboarding' && me.first_incomplete ? '/gp/signup' : '/gp');
    } catch (er) { toast.error(errMsg(er, 'Sign-in failed')); } finally { setBusy(false); }
  };
  return (
    <AuthShell>
      <h1 className="text-3xl font-bold text-[#2B2B2B]">Welcome back</h1>
      <p className="text-sm text-[#6B6F6A] mt-1 mb-6">Sign in to your Growth Partner account.</p>
      <form onSubmit={go} className="space-y-4" data-testid="gp-signin-form">
        <Field label="Mobile number or email"><Input data-testid="gp-signin-id" required value={f.identifier} onChange={(e) => setF({ ...f, identifier: e.target.value })} placeholder="98765 43210" /></Field>
        <Field label="Password"><Input data-testid="gp-signin-password" type="password" required value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
        <Btn className="w-full" data-testid="gp-signin-submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</Btn>
      </form>
      <p className="text-sm text-center mt-6 text-[#6B6F6A]">New to Bankezee? <Link to="/gp/signup" className="font-semibold text-[#1F7A33]" data-testid="gp-goto-signup">Become a Growth Partner</Link></p>
      <p className="text-xs text-center mt-2 text-[#6B6F6A]">Bankezee staff? <Link to="/login" className="underline">Staff sign-in</Link></p>
    </AuthShell>
  );
};

const STEPS = [['account', 'Account'], ['profile', 'Profile'], ['kyc', 'KYC'], ['payout', 'Payout details'], ['agreement', 'Agreement']];

const Stepper = ({ cur, done }) => (
  <ol className="flex items-center gap-1 mb-8 overflow-x-auto" data-testid="signup-stepper">
    {STEPS.map(([k, l], i) => (
      <li key={k} className="flex items-center gap-1 shrink-0">
        <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border ${done[k] ? 'bg-[#2FB34A] border-[#2FB34A] text-white' : cur === k ? 'border-[#2FB34A] text-[#1F7A33] bg-[#E8F6EA]' : 'border-[#D9DCD6] text-[#6B6F6A] bg-white'}`}>{done[k] ? <Check className="w-3.5 h-3.5" /> : i + 1}</span>
        <span className={`text-xs font-semibold ${cur === k ? 'text-[#2B2B2B]' : 'text-[#6B6F6A]'} hidden sm:inline`}>{l}</span>
        {i < STEPS.length - 1 && <span className="w-6 h-px bg-[#D9DCD6] mx-1" />}
      </li>
    ))}
  </ol>
);

const AccountStep = ({ onDone }) => {
  const [f, setF] = useState({ mobile: '', email: '', name: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [exists, setExists] = useState(false);
  const { setSession } = useAuthStore();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const checkMobile = async () => { if (f.mobile.replace(/\D/g, '').length >= 10) { const { data } = await api.get('/gp/check', { params: { mobile: f.mobile } }); setExists(data.registered); } };
  const go = async (e) => {
    e.preventDefault();
    setBusy(true);
    try { const { data } = await api.post('/gp/signup', f); setSession(data.token, data.user); onDone(); }
    catch (er) { if (errMsg(er) === 'already_registered') setExists(true); else toast.error(errMsg(er)); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={go} className="space-y-4" data-testid="account-step">
      <Field label="Full name (as on PAN)"><Input data-testid="acc-name" required value={f.name} onChange={set('name')} /></Field>
      <Field label="Mobile number" error={exists ? 'This number is already registered.' : null}><Input data-testid="acc-mobile" required inputMode="tel" value={f.mobile} onChange={(e) => { setExists(false); set('mobile')(e); }} onBlur={checkMobile} placeholder="10-digit mobile" /></Field>
      {exists && <div className="rounded-lg bg-[#EAF1FB] border border-[#C9DAF2] p-3 text-sm" data-testid="acc-exists">You already have a Bankezee account. <Link to="/gp/login" className="font-semibold text-[#24508F] underline">Sign in to continue</Link></div>}
      <Field label="Email" hint="Used for statements and to email your agreement signing code"><Input data-testid="acc-email" type="email" required value={f.email} onChange={set('email')} /></Field>
      <Field label="Create password" hint="At least 8 characters"><Input data-testid="acc-password" type="password" required minLength={8} value={f.password} onChange={set('password')} /></Field>
      <Card className="p-4 bg-[#FAFBF9]" data-testid="what-you-need">
        <p className="text-sm font-semibold mb-2">What you'll need</p>
        <ul className="text-xs text-[#55585A] space-y-1 list-disc pl-4">
          <li>PAN card</li><li>Aadhaar or another identity proof</li><li>Bank account details and a cancelled cheque</li><li>About 5 minutes — you can stop and resume anytime</li>
        </ul>
      </Card>
      <Btn className="w-full" data-testid="acc-continue" disabled={busy || exists}>{busy ? 'Creating account…' : 'Continue'}</Btn>
      <p className="text-sm text-center text-[#6B6F6A]">Already a Growth Partner? <Link to="/gp/login" className="font-semibold text-[#1F7A33]" data-testid="acc-signin-link">Sign in</Link></p>
    </form>
  );
};

export const GpSignup = () => {
  const { isAuthenticated } = useAuthStore();
  const [me, setMe] = useState(null);
  const [step, setStep] = useState(null);
  const nav = useNavigate();
  const load = () => api.get('/gp/me').then(({ data }) => { setMe(data); setStep((s) => s || data.first_incomplete || 'done'); }).catch(() => setStep('account'));
  useEffect(() => { if (isAuthenticated) load(); else setStep('account'); }, [isAuthenticated]); // eslint-disable-line react-hooks/exhaustive-deps
  const next = (data) => { setMe(data); const i = STEPS.findIndex(([k]) => k === step); setStep(STEPS[i + 1]?.[0] || 'done'); };
  const done = me?.steps || {};
  const titles = { account: ['Become a Growth Partner', 'Create your account to get started.'], profile: ['Your details', 'Tell us who is registering.'], kyc: ['Verify your identity', 'Upload clear copies — our team verifies them.'],
    payout: ['Payout details', 'Where should we send your commission?'], agreement: ['Partner Agreement', 'Read and sign your agreement to activate your account.'], done: ['You’re all set', ''] };
  if (!step) return <AuthShell><p className="text-sm text-[#6B6F6A]">Loading…</p></AuthShell>;
  const [t, s] = titles[step];
  return (
    <AuthShell>
      <Stepper cur={step} done={done} />
      <h1 className="text-3xl font-bold text-[#2B2B2B]" data-testid="signup-title">{t}</h1>
      {s && <p className="text-sm text-[#6B6F6A] mt-1 mb-6">{s}</p>}
      {step === 'account' && <AccountStep onDone={() => { setStep(null); load(); }} />}
      {step === 'profile' && me && <ProfileForm me={me} onSaved={next} />}
      {step === 'kyc' && me && <><KycForm me={me} onSaved={setMe} /><Nav back="profile" next={() => next(me)} ok={done.kyc} setStep={setStep} /></>}
      {step === 'payout' && me && <><PayoutForm me={me} onSaved={setMe} /><Nav back="kyc" next={() => next(me)} ok={done.payout} setStep={setStep} /></>}
      {step === 'agreement' && me && <><AgreementPanel onSigned={load} /><Nav back="payout" next={() => nav('/gp')} ok label="Go to dashboard" setStep={setStep} /></>}
      {step === 'done' && <div className="text-center py-8" data-testid="signup-done"><CheckCircle2 className="w-12 h-12 text-[#2FB34A] mx-auto" /><p className="mt-3 text-sm text-[#55585A]">Your onboarding is complete.</p><Btn className="mt-5" data-testid="goto-dashboard" onClick={() => nav('/gp')}>Go to dashboard</Btn></div>}
    </AuthShell>
  );
};

const Nav = ({ back, next, ok, label = 'Continue', setStep }) => (
  <div className="flex justify-between mt-6">
    <Btn variant="outline" data-testid="step-back" onClick={() => setStep(back)}>Back</Btn>
    <Btn data-testid="step-continue" disabled={!ok} onClick={next}>{label}</Btn>
  </div>
);
