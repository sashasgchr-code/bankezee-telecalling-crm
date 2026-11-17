import React, { useCallback, useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation, useParams, NavLink } from 'react-router-dom';
import api from '../../services/api';
import { Card } from './ui';
import { ShareTools } from './GpPortal';

const GP_PATHS = { '': 'files', files: 'files', leads: 'files', payouts: 'payouts', 'payout-structure': 'payout-structure', creatives: 'creatives',
  card: 'card', profile: 'partner-profile', agreement: 'agreement', support: 'support' };

// Old /gp/* Partner Portal links -> the shared Growth Partner dashboard under /agent.
export const GpRedirect = () => {
  const { pathname, search } = useLocation();
  const { id } = useParams();
  const q = new URLSearchParams(search);
  const seg = pathname.replace(/^\/gp\/?/, '').split('/')[0];
  if (seg === 'files' && id) return <Navigate to={`/agent/files/${id}`} replace />;
  if (seg === 'files' && q.get('share')) return <Navigate to="/agent/share" replace />;
  return <Navigate to={`/agent/${GP_PATHS[seg] || 'files'}${seg === 'profile' ? search : ''}`} replace />;
};

// Loads the partner profile once and hands it to the reused Partner Portal pages (they read useOutletContext()).
export const GpData = () => {
  const [me, setMe] = useState(null);
  const [err, setErr] = useState(null);
  const reload = useCallback(() => api.get('/gp/me').then(({ data }) => setMe(data)).catch((e) => setErr(e?.response?.status === 403 ? 'These pages are for Growth Partners.' : 'Could not load your partner profile.')), []);
  useEffect(() => { reload(); }, [reload]);
  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-8 text-[#2B2B2B]" data-testid="gp-shared-page">
      {err ? <p className="text-sm text-red-600">{err}</p> : me ? <Outlet context={{ me, reload, setMe }} /> : <p className="text-sm text-gray-500">Loading…</p>}
    </div>
  );
};

export const GpShare = () => {
  const [me, setMe] = useState(null);
  useEffect(() => { api.get('/gp/me').then(({ data }) => setMe(data)).catch(() => {}); }, []);
  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-8">
      <h1 className="text-2xl font-bold mb-1">Application link & QR</h1>
      <p className="text-sm text-gray-500 mb-5">Customers who apply through this link create a Loan File credited to you.</p>
      <Card className="p-5">{me?.partner_id ? <ShareTools code={me.partner_id} /> : <p className="text-sm">Your application link isn't available yet.</p>}</Card>
    </div>
  );
};

const TASK_LINK = { profile: '/agent/partner-profile', kyc: '/agent/partner-profile?tab=kyc', kyc_fix: '/agent/partner-profile?tab=kyc', kyc_review: '/agent/partner-profile?tab=kyc',
  payout: '/agent/partner-profile?tab=payout', bank_doc: '/agent/partner-profile?tab=payout', agreement: '/agent/agreement', agreement_wait: '/agent/agreement' };

export const GpTasksBanner = () => {
  const [me, setMe] = useState(null);
  useEffect(() => { api.get('/gp/me').then(({ data }) => setMe(data)).catch(() => {}); }, []);
  if (!me?.tasks?.length) return null;
  return (
    <div className="mx-4 mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3" data-testid="gp-tasks-banner">
      <p className="text-sm font-semibold text-amber-800 mb-1">{me.status === 'Active' ? 'Finish these pending items on your account' : 'Complete these to activate your partnership'}</p>
      <div className="flex flex-wrap gap-x-4 gap-y-1">{me.tasks.map((t) => <NavLink key={t.key} to={TASK_LINK[t.key] || '/agent/partner-profile'} className="text-sm text-amber-900 underline" data-testid={`gp-task-${t.key}`}>{t.label}</NavLink>)}</div>
    </div>
  );
};

