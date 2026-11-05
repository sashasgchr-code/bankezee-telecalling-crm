import React from 'react';

const NUM = ['pre_bt_max_foir', 'cc_obligation_pct', 'min_emis_paid', 'max_enquiries_month', 'max_dpd_events'];
const LIST = ['bt_loan_types', 'app_lenders'];
const BOOL = ['settlement_allowed', 'writeoff_allowed', 'additional_cash_allowed'];

// Normalise the engine-rule fields before saving (blank = not configured, never 0/false by accident).
export const normaliseEngineRules = (fd) => {
  const out = {};
  NUM.forEach((k) => { out[k] = fd[k] === '' || fd[k] == null ? null : Number(fd[k]); });
  LIST.forEach((k) => { out[k] = typeof fd[k] === 'string' ? fd[k].split(',').map((s) => s.trim()).filter(Boolean) : fd[k] || []; });
  BOOL.forEach((k) => { out[k] = fd[k] === '' || fd[k] == null ? null : fd[k] === true || fd[k] === 'true'; });
  out.cc_obligation_rule = fd.cc_obligation_rule || null;
  out.seasoning_basis = fd.seasoning_basis || null;
  out.app_loan_disqualifies = !!fd.app_loan_disqualifies;
  return out;
};

const cls = 'w-full border rounded-md px-2 py-1.5 text-sm';
const L = ({ label, children }) => <label className="block text-xs text-slate-600">{label}<div className="mt-0.5">{children}</div></label>;

// Shared policy-editor section for the eligibility engine rules (used by Connect and Meta policy pages).
export const EngineRulesEditor = ({ formData, setFormData }) => {
  const set = (k) => (e) => setFormData({ ...formData, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const v = (k) => (Array.isArray(formData[k]) ? formData[k].join(', ') : formData[k] ?? '');
  const tri = (k) => (formData[k] === true || formData[k] === 'true' ? 'true' : formData[k] === false || formData[k] === 'false' ? 'false' : '');
  return (
    <div className="border rounded-lg p-3 space-y-3 bg-slate-50" data-testid="engine-rules-editor">
      <p className="text-xs font-semibold text-slate-700">Eligibility engine rules — leave blank if the bank hasn't confirmed; results will show "Needs Review" instead of guessing.</p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <L label="Pre-BT max FOIR %"><input data-testid="rule-pre-bt-foir" type="number" className={cls} value={v('pre_bt_max_foir')} onChange={set('pre_bt_max_foir')} /></L>
        <L label="BT loan types (comma: personal_loan, app_loan…)"><input data-testid="rule-bt-types" className={cls} value={v('bt_loan_types')} onChange={set('bt_loan_types')} /></L>
        <L label="Credit card obligation rule"><select data-testid="rule-cc-rule" className={cls} value={v('cc_obligation_rule')} onChange={set('cc_obligation_rule')}><option value="">Not configured</option><option value="pct_outstanding">% of outstanding</option><option value="emi">Card EMI</option><option value="none">Not counted</option></select></L>
        <L label="Card % of outstanding"><input data-testid="rule-cc-pct" type="number" className={cls} value={v('cc_obligation_pct')} onChange={set('cc_obligation_pct')} /></L>
        <L label="Seasoning measured from"><select data-testid="rule-seasoning-basis" className={cls} value={v('seasoning_basis')} onChange={set('seasoning_basis')}><option value="">Not specified (disbursal → open → sanction)</option><option value="disbursal">Disbursal date</option><option value="open">Account open date</option><option value="sanction">Sanction date</option></select></L>
        <L label="Min EMIs actually paid"><input data-testid="rule-min-emis" type="number" className={cls} value={v('min_emis_paid')} onChange={set('min_emis_paid')} /></L>
        <L label="Max enquiries in a month"><input data-testid="rule-max-enq" type="number" className={cls} value={v('max_enquiries_month')} onChange={set('max_enquiries_month')} /></L>
        <L label="Max late-payment events"><input data-testid="rule-max-dpd" type="number" className={cls} value={v('max_dpd_events')} onChange={set('max_dpd_events')} /></L>
        {BOOL.map((k) => <L key={k} label={k.replace(/_/g, ' ')}><select data-testid={`rule-${k}`} className={cls} value={tri(k)} onChange={set(k)}><option value="">Not specified</option><option value="true">Yes</option><option value="false">No</option></select></L>)}
        <L label="App lenders (comma, for app-loan mapping)"><input data-testid="rule-app-lenders" className={cls} value={v('app_lenders')} onChange={set('app_lenders')} /></L>
        <label className="flex items-center gap-2 text-xs text-slate-700 mt-4"><input type="checkbox" data-testid="rule-app-disqualifies" checked={!!formData.app_loan_disqualifies} onChange={set('app_loan_disqualifies')} />Any app loan makes applicant ineligible (separate from "app loans not allowed for BT")</label>
      </div>
    </div>
  );
};
