import React from 'react';
import { Trash2 } from 'lucide-react';

const BankEligibilityCard = ({ 
  eligibility, 
  index, 
  canEdit, 
  onUpdate, 
  onRemove 
}) => {
  const elig = eligibility;
  
  const updateField = (field, value) => {
    onUpdate(index, field, value);
  };

  const inputClass = "w-full h-9 px-3 border border-gray-200 rounded-lg bg-white text-sm focus:outline-none focus:ring-2 focus:ring-green-500";
  const selectClass = "w-full h-9 px-3 border border-gray-200 rounded-lg bg-white text-sm focus:outline-none focus:ring-2 focus:ring-green-500";

  return (
    <div className="border rounded-lg p-4 bg-gray-50 relative">
      {canEdit && (
        <button 
          onClick={() => onRemove(index)} 
          className="absolute top-2 right-2 text-red-500 hover:text-red-700 p-1"
        >
          <Trash2 size={16} />
        </button>
      )}
      <h5 className="font-semibold text-green-600 mb-3">Bank #{index + 1}</h5>
      
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {/* Bank Name */}
        <div>
          <p className="text-xs text-gray-500 mb-1">Bank Name</p>
          {canEdit ? (
            <input value={elig.bank_name || ''} onChange={(e) => updateField('bank_name', e.target.value)} className={inputClass} placeholder="Enter bank name" />
          ) : (
            <p className="font-medium">{elig.bank_name || '-'}</p>
          )}
        </div>

        {/* Eligible? */}
        <div>
          <p className="text-xs text-gray-500 mb-1">Eligible?</p>
          {canEdit ? (
            <select value={elig.is_eligible || ''} onChange={(e) => updateField('is_eligible', e.target.value)} className={selectClass}>
              <option value="">Select</option>
              <option value="yes">Yes - Eligible</option>
              <option value="no">No - Not Eligible</option>
            </select>
          ) : (
            <p className={`font-medium ${elig.is_eligible === 'yes' ? 'text-green-600' : 'text-red-600'}`}>
              {elig.is_eligible === 'yes' ? 'Eligible' : elig.is_eligible === 'no' ? 'Not Eligible' : '-'}
            </p>
          )}
        </div>
        
        {/* If Eligible */}
        {elig.is_eligible === 'yes' && (
          <>
            <div>
              <p className="text-xs text-gray-500 mb-1">Eligible Amount (₹)</p>
              {canEdit ? (
                <input type="number" value={elig.eligible_amount || ''} onChange={(e) => updateField('eligible_amount', e.target.value)} className={inputClass} placeholder="Amount" />
              ) : (
                <p className="font-medium">{elig.eligible_amount ? `₹${Number(elig.eligible_amount).toLocaleString()}` : '-'}</p>
              )}
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1">Eligible Tenure (months)</p>
              {canEdit ? (
                <input type="number" value={elig.eligible_tenure || ''} onChange={(e) => updateField('eligible_tenure', e.target.value)} className={inputClass} placeholder="Months" />
              ) : (
                <p className="font-medium">{elig.eligible_tenure || '-'}</p>
              )}
            </div>
          </>
        )}
        
        {/* If Not Eligible */}
        {elig.is_eligible === 'no' && (
          <div className="col-span-2">
            <p className="text-xs text-gray-500 mb-1">Not Eligible Reason</p>
            {canEdit ? (
              <input value={elig.not_eligible_reason || ''} onChange={(e) => updateField('not_eligible_reason', e.target.value)} className={inputClass} placeholder="Reason" />
            ) : (
              <p className="font-medium">{elig.not_eligible_reason || '-'}</p>
            )}
          </div>
        )}
      </div>

      {/* Login Status Section */}
      {elig.is_eligible === 'yes' && (
        <div className="mt-4 pt-4 border-t border-dashed">
          <p className="text-xs font-semibold text-gray-700 mb-2">Login Status</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <p className="text-xs text-gray-500 mb-1">Login Done?</p>
              {canEdit ? (
                <select value={elig.login_done || ''} onChange={(e) => updateField('login_done', e.target.value)} className={selectClass}>
                  <option value="">Select</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              ) : (
                <p className="font-medium">{elig.login_done === 'yes' ? 'Yes' : elig.login_done === 'no' ? 'No' : '-'}</p>
              )}
            </div>
            {elig.login_done === 'yes' && (
              <div>
                <p className="text-xs text-gray-500 mb-1">Login Bank</p>
                {canEdit ? (
                  <input value={elig.login_bank || ''} onChange={(e) => updateField('login_bank', e.target.value)} className={inputClass} placeholder="Bank name" />
                ) : (
                  <p className="font-medium">{elig.login_bank || '-'}</p>
                )}
              </div>
            )}
            {elig.login_done === 'no' && (
              <div className="col-span-3">
                <p className="text-xs text-gray-500 mb-1">Login Rejection Reason</p>
                {canEdit ? (
                  <input value={elig.login_rejection_reason || ''} onChange={(e) => updateField('login_rejection_reason', e.target.value)} className={inputClass} placeholder="Reason" />
                ) : (
                  <p className="font-medium">{elig.login_rejection_reason || '-'}</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Approval Status Section */}
      {elig.login_done === 'yes' && (
        <div className="mt-4 pt-4 border-t border-dashed">
          <p className="text-xs font-semibold text-gray-700 mb-2">Approval Status</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <p className="text-xs text-gray-500 mb-1">Status</p>
              {canEdit ? (
                <select value={elig.approval_status || ''} onChange={(e) => updateField('approval_status', e.target.value)} className={selectClass}>
                  <option value="">Select</option>
                  <option value="approved">Approved</option>
                  <option value="declined">Declined</option>
                </select>
              ) : (
                <p className={`font-medium ${elig.approval_status === 'approved' ? 'text-green-600' : 'text-red-600'}`}>
                  {elig.approval_status === 'approved' ? 'Approved' : elig.approval_status === 'declined' ? 'Declined' : '-'}
                </p>
              )}
            </div>
            {elig.approval_status === 'approved' && (
              <>
                <div><p className="text-xs text-gray-500 mb-1">Approved Bank</p>{canEdit ? <input value={elig.approved_bank || ''} onChange={(e) => updateField('approved_bank', e.target.value)} className={inputClass} placeholder="Bank" /> : <p className="font-medium">{elig.approved_bank || '-'}</p>}</div>
                <div><p className="text-xs text-gray-500 mb-1">Approved Amount (₹)</p>{canEdit ? <input type="number" value={elig.approved_amount || ''} onChange={(e) => updateField('approved_amount', e.target.value)} className={inputClass} placeholder="Amount" /> : <p className="font-medium">{elig.approved_amount ? `₹${Number(elig.approved_amount).toLocaleString()}` : '-'}</p>}</div>
                <div><p className="text-xs text-gray-500 mb-1">Tenure (months)</p>{canEdit ? <input type="number" value={elig.approved_tenure || ''} onChange={(e) => updateField('approved_tenure', e.target.value)} className={inputClass} placeholder="Months" /> : <p className="font-medium">{elig.approved_tenure || '-'}</p>}</div>
                <div><p className="text-xs text-gray-500 mb-1">ROI (%)</p>{canEdit ? <input type="number" step="0.01" value={elig.approved_roi || ''} onChange={(e) => updateField('approved_roi', e.target.value)} className={inputClass} placeholder="%" /> : <p className="font-medium">{elig.approved_roi ? `${elig.approved_roi}%` : '-'}</p>}</div>
              </>
            )}
            {elig.approval_status === 'declined' && (
              <>
                <div><p className="text-xs text-gray-500 mb-1">Declined Bank</p>{canEdit ? <input value={elig.declined_bank || ''} onChange={(e) => updateField('declined_bank', e.target.value)} className={inputClass} placeholder="Bank" /> : <p className="font-medium">{elig.declined_bank || '-'}</p>}</div>
                <div className="col-span-2"><p className="text-xs text-gray-500 mb-1">Decline Reason</p>{canEdit ? <input value={elig.declined_reason || ''} onChange={(e) => updateField('declined_reason', e.target.value)} className={inputClass} placeholder="Reason" /> : <p className="font-medium">{elig.declined_reason || '-'}</p>}</div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Disbursement Section */}
      {elig.approval_status === 'approved' && (
        <div className="mt-4 pt-4 border-t border-dashed">
          <p className="text-xs font-semibold text-gray-700 mb-2">Disbursement</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <p className="text-xs text-gray-500 mb-1">Disbursed?</p>
              {canEdit ? (
                <select value={elig.disbursed || ''} onChange={(e) => updateField('disbursed', e.target.value)} className={selectClass}>
                  <option value="">Select</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              ) : (
                <p className={`font-medium ${elig.disbursed === 'yes' ? 'text-green-600' : ''}`}>{elig.disbursed === 'yes' ? 'Yes' : elig.disbursed === 'no' ? 'No' : '-'}</p>
              )}
            </div>
            {elig.disbursed === 'yes' && (
              <>
                <div><p className="text-xs text-gray-500 mb-1">Disbursed Bank</p>{canEdit ? <input value={elig.disbursed_bank || ''} onChange={(e) => updateField('disbursed_bank', e.target.value)} className={inputClass} placeholder="Bank" /> : <p className="font-medium">{elig.disbursed_bank || '-'}</p>}</div>
                <div><p className="text-xs text-gray-500 mb-1">Disbursed Amount</p>{canEdit ? <input type="number" value={elig.disbursed_amount || ''} onChange={(e) => updateField('disbursed_amount', e.target.value)} className={inputClass} placeholder="Amount" /> : <p className="font-medium">{elig.disbursed_amount ? `₹${Number(elig.disbursed_amount).toLocaleString()}` : '-'}</p>}</div>
                <div><p className="text-xs text-gray-500 mb-1">Tenure (months)</p>{canEdit ? <input type="number" value={elig.disbursed_tenure || ''} onChange={(e) => updateField('disbursed_tenure', e.target.value)} className={inputClass} placeholder="Months" /> : <p className="font-medium">{elig.disbursed_tenure || '-'}</p>}</div>
                <div><p className="text-xs text-gray-500 mb-1">ROI (%)</p>{canEdit ? <input type="number" step="0.01" value={elig.disbursed_roi || ''} onChange={(e) => updateField('disbursed_roi', e.target.value)} className={inputClass} placeholder="%" /> : <p className="font-medium">{elig.disbursed_roi ? `${elig.disbursed_roi}%` : '-'}</p>}</div>
                <div className="col-span-2 mt-2 pt-2 border-t border-dashed">
                  <p className="text-xs font-semibold text-green-600 mb-2">Commission</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-xs text-gray-500 mb-1">Commission %</p>
                      {canEdit ? (
                        <input type="number" step="0.01" value={elig.commission_percentage || ''} onChange={(e) => updateField('commission_percentage', e.target.value)} className={inputClass} placeholder="e.g., 0.5" />
                      ) : (
                        <p className="font-medium">{elig.commission_percentage ? `${elig.commission_percentage}%` : '-'}</p>
                      )}
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 mb-1">Commission Amount</p>
                      <p className="font-medium text-green-600">
                        {elig.commission_percentage && elig.disbursed_amount 
                          ? `₹${((Number(elig.disbursed_amount) * Number(elig.commission_percentage)) / 100).toLocaleString(undefined, {maximumFractionDigits: 2})}` 
                          : '-'}
                      </p>
                    </div>
                  </div>
                </div>
              </>
            )}
            {elig.disbursed === 'no' && (
              <div className="col-span-3"><p className="text-xs text-gray-500 mb-1">Rejection Reason</p>{canEdit ? <input value={elig.disbursement_rejection_reason || ''} onChange={(e) => updateField('disbursement_rejection_reason', e.target.value)} className={inputClass} placeholder="Reason" /> : <p className="font-medium">{elig.disbursement_rejection_reason || '-'}</p>}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default BankEligibilityCard;
