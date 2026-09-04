import React from 'react';
import { Trash2, ChevronDown, ChevronUp, Save, Loader2, Clock } from 'lucide-react';

const YES_NO = [['yes', 'Yes'], ['no', 'No']];

const money = (v) => (v === '' || v === null || v === undefined || isNaN(Number(v))
  ? '-' : `₹${Number(v).toLocaleString('en-IN')}`);

export const commissionAmount = (bank) => {
  const amount = Number(bank.disbursed_amount);
  const pct = Number(bank.commission_percentage);
  if (bank.disbursed !== 'yes' || !amount || !pct) return '';
  return Math.round(((amount * pct) / 100) * 100) / 100;
};

// Vehicle conditions gate the disbursement step, exactly as in the old CRM
export const vehicleConditionsMet = (bank, isVehicle, isUsedVehicleBt) => {
  if (!isVehicle) return true;
  if (bank.rc_submitted !== 'yes') return false;
  if (isUsedVehicleBt && bank.noc_submitted !== 'yes') return false;
  return bank.hypothecation === 'yes';
};

const Field = ({ label, children, span = '' }) => (
  <div className={span}>
    <label className="text-xs text-gray-500 block mb-1">{label}</label>
    {children}
  </div>
);

const Stamp = ({ label, value }) => (value ? (
  <span className="inline-flex items-center gap-1 text-[11px] text-gray-500">
    <Clock size={11} /> {label} {new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
  </span>
) : null);

const BankEligibilityRow = ({
  bank, index, canEdit, canEditSm, isVehicleLoan, isUsedVehicleBt,
  expanded, onToggle, onChange, onRemove, onSave, saving,
}) => {
  const tid = (name) => `bank-${index + 1}-${name}`;
  const cls = (editable) =>
    `w-full px-3 py-2 border border-gray-200 rounded-lg text-sm ${editable ? '' : 'bg-gray-50 cursor-not-allowed'}`;

  // Rendered as plain elements (not nested components) so React keeps the same DOM input across
  // renders - defining components inline remounted the input and stole focus after each keystroke.
  const text = (field, { type = 'text', editable = canEdit, step, placeholder } = {}) => (
    <input
      type={type}
      step={step}
      placeholder={placeholder}
      value={bank[field] ?? ''}
      onChange={(e) => onChange(index, field, e.target.value)}
      disabled={!editable}
      className={cls(editable)}
      data-testid={tid(field)}
    />
  );

  const choice = (field, options = YES_NO, placeholder = 'Select') => (
    <select
      value={bank[field] ?? ''}
      onChange={(e) => onChange(index, field, e.target.value)}
      disabled={!canEdit}
      className={cls(canEdit)}
      data-testid={tid(field)}
    >
      <option value="">{placeholder}</option>
      {options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </select>
  );

  const eligible = bank.is_eligible === 'yes';
  const loginDone = bank.login_done === 'yes';
  const approved = bank.approval_status === 'approved';
  const vehicleOk = vehicleConditionsMet(bank, isVehicleLoan, isUsedVehicleBt);

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden" data-testid={`bank-card-${index + 1}`}>
      <div className="flex items-center justify-between p-4 bg-gray-50 cursor-pointer" onClick={() => onToggle(index)}>
        <h3 className="font-semibold text-green-600">
          Bank #{index + 1}{bank.bank_name ? ` - ${bank.bank_name}` : ''}
          {bank.is_eligible === 'no' && <span className="ml-2 text-xs text-red-600 font-normal">Not Eligible</span>}
          {approved && <span className="ml-2 text-xs text-green-700 font-normal">Approved</span>}
          {bank.disbursed === 'yes' && <span className="ml-2 text-xs text-emerald-700 font-normal">Disbursed {money(bank.disbursed_amount)}</span>}
        </h3>
        <div className="flex items-center gap-2">
          {canEdit && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); onSave(index); }}
                disabled={saving}
                className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-green-700 border border-green-200 rounded hover:bg-green-50 disabled:opacity-50"
                data-testid={`bank-save-${index + 1}`}
              >
                {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Save
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onRemove(index); }}
                className="p-1 text-red-500 hover:bg-red-50 rounded"
                data-testid={`bank-remove-${index + 1}`}
              >
                <Trash2 size={16} />
              </button>
            </>
          )}
          {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </div>
      </div>

      <div className="p-4">
        {/* STEP 1 - Bank eligibility */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Field label="Bank Name">{text('bank_name')}</Field>
          <Field label="Eligible?">
            {choice('is_eligible', [['yes', 'Yes - Eligible'], ['no', 'No - Not Eligible']])}
          </Field>
          {bank.is_eligible === 'no' && (
            <Field label="Not Eligible Reason" span="col-span-2">{text('not_eligible_reason')}</Field>
          )}
          {eligible && (
            <>
              <Field label="Eligible Amount (₹)">{text('eligible_amount', { type: 'number' })}</Field>
              <Field label="Eligible ROI (%)">{text('eligible_roi', { type: 'number', step: '0.01' })}</Field>
            </>
          )}
        </div>

        {expanded && eligible && (
          <>
            {/* STEP 2 - Login status */}
            <div className="pt-4 mt-4 border-t border-gray-100">
              <h4 className="text-sm font-semibold text-gray-700 mb-3">
                Login Status <Stamp label="logged on" value={bank.login_done_at} />
              </h4>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <Field label="Login Done?">{choice('login_done')}</Field>
                {bank.login_done === 'no' && (
                  <Field label="Login Rejection Reason" span="col-span-2 md:col-span-4">
                    {text('login_rejection_reason')}
                  </Field>
                )}
                {loginDone && (
                  <>
                    <Field label="Login Bank">{text('login_bank')}</Field>
                    <Field label="Application ID">{text('application_id')}</Field>
                    <Field label={`SM Name${canEditSm ? '' : ' (Admin/Ops)'}`}>
                      {text('sm_name', { editable: canEdit && canEditSm })}
                    </Field>
                    <Field label={`SM Number${canEditSm ? '' : ' (Admin/Ops)'}`}>
                      {text('sm_number', { editable: canEdit && canEditSm })}
                    </Field>
                  </>
                )}
              </div>
            </div>

            {/* STEP 3 - Approval */}
            {loginDone && (
              <div className="pt-4 mt-4 border-t border-gray-100">
                <h4 className="text-sm font-semibold text-gray-700 mb-3">
                  Approval <Stamp label="approved on" value={bank.approved_at} /> <Stamp label="rejected on" value={bank.rejected_at} />
                </h4>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                  <Field label="Approval Status">
                    {choice('approval_status', [['approved', 'Approved'], ['declined', 'Declined']])}
                  </Field>
                  {bank.approval_status === 'declined' && (
                    <>
                      <Field label="Declined Bank">{text('declined_bank')}</Field>
                      <Field label="Decline Reason" span="col-span-2 md:col-span-3">{text('declined_reason')}</Field>
                    </>
                  )}
                  {approved && (
                    <>
                      <Field label="Approved Bank">{text('approved_bank')}</Field>
                      <Field label="Approved Amount (₹)">{text('approved_amount', { type: 'number' })}</Field>
                      <Field label="Approved Tenure (months)">{text('approved_tenure', { type: 'number' })}</Field>
                      <Field label="Approved ROI (%)">{text('approved_roi', { type: 'number', step: '0.01' })}</Field>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* STEP 3.5 - Vehicle loan conditions */}
            {approved && isVehicleLoan && (
              <div className="pt-4 mt-4 border-t border-gray-100">
                <h4 className="text-sm font-semibold text-gray-700 mb-3">Vehicle Loan Conditions</h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <Field label="RC Submitted?">{choice('rc_submitted')}</Field>
                  {bank.rc_submitted === 'no' && (
                    <Field label="RC Not Submitted Reason" span="col-span-2 md:col-span-3">
                      {text('rc_not_submitted_reason')}
                    </Field>
                  )}
                  {isUsedVehicleBt && (
                    <>
                      <Field label="NOC Submitted?">{choice('noc_submitted')}</Field>
                      {bank.noc_submitted === 'no' && (
                        <Field label="NOC Not Submitted Reason" span="col-span-2 md:col-span-3">
                          {text('noc_not_submitted_reason')}
                        </Field>
                      )}
                    </>
                  )}
                  <Field label="Hypothecation Done?">{choice('hypothecation')}</Field>
                  {bank.hypothecation === 'no' && (
                    <Field label="Hypothecation Not Done Reason" span="col-span-2 md:col-span-3">
                      {text('hypothecation_not_done_reason')}
                    </Field>
                  )}
                </div>
                {!vehicleOk && (
                  <p className="text-xs text-amber-600 mt-2" data-testid={`bank-${index + 1}-vehicle-block`}>
                    Disbursement opens once RC{isUsedVehicleBt ? ', NOC' : ''} and Hypothecation are completed.
                  </p>
                )}
              </div>
            )}

            {/* STEP 4 - Disbursement */}
            {approved && vehicleOk && (
              <div className="pt-4 mt-4 border-t border-gray-100">
                <h4 className="text-sm font-semibold text-gray-700 mb-3">
                  Disbursement <Stamp label="disbursed on" value={bank.disbursed_at} />
                </h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <Field label="Disbursed?">{choice('disbursed')}</Field>
                  {bank.disbursed === 'no' && (
                    <Field label="Rejection Reason" span="col-span-2 md:col-span-3">
                      {text('disbursement_rejection_reason')}
                    </Field>
                  )}
                  {bank.disbursed === 'yes' && (
                    <>
                      <Field label="Disbursal Date">{text('disbursal_date', { type: 'date' })}</Field>
                      <Field label="Disbursed Bank">{text('disbursed_bank')}</Field>
                      <Field label="Disbursed Amount (₹)">{text('disbursed_amount', { type: 'number' })}</Field>
                      <Field label="Tenure (months)">{text('disbursed_tenure', { type: 'number' })}</Field>
                      <Field label="ROI (%)">{text('disbursed_roi', { type: 'number', step: '0.01' })}</Field>
                      <Field label="Commission %">{text('commission_percentage', { type: 'number', step: '0.01' })}</Field>
                      <Field label="Commission Amount (₹)">
                        <input
                          readOnly
                          disabled
                          value={commissionAmount(bank) === '' ? '' : commissionAmount(bank)}
                          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-green-50 font-medium text-green-700"
                          data-testid={tid('commission_amount')}
                        />
                      </Field>
                      <Field label="PF (₹)">{text('pf', { type: 'number' })}</Field>
                      <Field label="EMI (₹)">{text('emi', { type: 'number' })}</Field>
                      <Field label="First EMI Date">{text('first_emi_date', { type: 'date' })}</Field>
                    </>
                  )}
                </div>
              </div>
            )}

            <div className="pt-4 mt-4 border-t border-gray-100">
              <Field label="Notes">
                <textarea
                  value={bank.notes ?? ''}
                  onChange={(e) => onChange(index, 'notes', e.target.value)}
                  disabled={!canEdit}
                  rows={2}
                  className={cls(canEdit)}
                  data-testid={tid('notes')}
                />
              </Field>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default BankEligibilityRow;
