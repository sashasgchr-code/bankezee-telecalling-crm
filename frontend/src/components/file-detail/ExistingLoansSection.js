import React from 'react';
import { EditableField, EditableSelect } from './EditableField';
import { Plus, Trash2 } from 'lucide-react';

// Loan Types for existing loans
const EXISTING_LOAN_TYPES = [
  { value: 'personal_loan', label: 'Personal Loan' },
  { value: 'home_loan', label: 'Home Loan' },
  { value: 'car_loan', label: 'Car Loan' },
  { value: 'two_wheeler_loan', label: 'Two Wheeler Loan' },
  { value: 'education_loan', label: 'Education Loan' },
  { value: 'business_loan', label: 'Business Loan' },
  { value: 'credit_card', label: 'Credit Card' },
  { value: 'overdraft', label: 'Overdraft' },
  { value: 'lap', label: 'LAP' },
  { value: 'gold_loan', label: 'Gold Loan' },
  { value: 'other', label: 'Other' }
];

// Common Banks
const COMMON_BANKS = [
  { value: 'hdfc', label: 'HDFC Bank' },
  { value: 'icici', label: 'ICICI Bank' },
  { value: 'sbi', label: 'SBI' },
  { value: 'axis', label: 'Axis Bank' },
  { value: 'kotak', label: 'Kotak Bank' },
  { value: 'indusind', label: 'IndusInd Bank' },
  { value: 'yes', label: 'Yes Bank' },
  { value: 'bajaj', label: 'Bajaj Finance' },
  { value: 'tata_capital', label: 'Tata Capital' },
  { value: 'idfc', label: 'IDFC First' },
  { value: 'other', label: 'Other' }
];

const ExistingLoansSection = ({ 
  details, 
  isEditing, 
  onDetailChange 
}) => {
  // Parse existing loans from old format or new array format
  const existingLoans = details.existing_loans || [];
  
  // Also support legacy format (existing_loan_1, existing_loan_2, etc.)
  const legacyLoans = [
    details.existing_loan_1,
    details.existing_loan_2,
    details.existing_loan_3
  ].filter(Boolean);

  const handleAddLoan = () => {
    const newLoans = [...existingLoans, { 
      type: '', 
      bank: '', 
      outstanding: '', 
      emi: '', 
      tenure_remaining: '',
      start_date: ''
    }];
    onDetailChange('existing_loans', newLoans);
  };

  const handleRemoveLoan = (index) => {
    const newLoans = existingLoans.filter((_, i) => i !== index);
    onDetailChange('existing_loans', newLoans);
  };

  const handleLoanChange = (index, field, value) => {
    const newLoans = [...existingLoans];
    newLoans[index] = { ...newLoans[index], [field]: value };
    onDetailChange('existing_loans', newLoans);
  };

  return (
    <div className="pt-4 border-t border-gray-200">
      <h4 className="text-sm font-semibold text-green-600 mb-3 flex items-center gap-2">
        <span className="w-6 h-6 rounded-full bg-green-100 text-green-700 flex items-center justify-center text-xs font-bold">3</span>
        Existing Obligations & Credit Profile
      </h4>
      
      {/* CIBIL & FOIR - Critical metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        <EditableField
          label="CIBIL Score *"
          value={details.cibil_score}
          onChange={(v) => onDetailChange('cibil_score', v)}
          isEditing={isEditing}
          type="number"
          placeholder="300-900"
        />
        <EditableSelect
          label="CIBIL Issues"
          value={details.cibil_issues}
          onChange={(v) => onDetailChange('cibil_issues', v)}
          isEditing={isEditing}
          options={[
            { value: 'none', label: 'No Issues' },
            { value: 'dpd', label: 'DPD History' },
            { value: 'writeoff', label: 'Write-off' },
            { value: 'settled', label: 'Settled Account' },
            { value: 'enquiries', label: 'High Enquiries' },
            { value: 'no_history', label: 'No Credit History' }
          ]}
        />
        <EditableField
          label="Total EMI (₹)"
          value={details.obligations_emi}
          onChange={(v) => onDetailChange('obligations_emi', v)}
          isEditing={isEditing}
          type="number"
          placeholder="Total monthly EMIs"
        />
        <EditableField
          label="FOIR %"
          value={details.foir}
          onChange={(v) => onDetailChange('foir', v)}
          isEditing={isEditing}
          type="number"
          placeholder="Fixed Obligation to Income Ratio"
        />
      </div>

      {/* TVR & EMI OK Status - OLD CRM fields */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        <EditableSelect
          label="TVR Done"
          value={details.tvr_done}
          onChange={(v) => onDetailChange('tvr_done', v)}
          isEditing={isEditing}
          options={[
            { value: 'yes', label: 'Yes' },
            { value: 'no', label: 'No' },
            { value: 'pending', label: 'Pending' }
          ]}
        />
        {details.tvr_done === 'no' && (
          <EditableField
            label="TVR Not Done Reason"
            value={details.tvr_not_done_reason}
            onChange={(v) => onDetailChange('tvr_not_done_reason', v)}
            isEditing={isEditing}
          />
        )}
        <EditableSelect
          label="EMI OK"
          value={details.emi_ok}
          onChange={(v) => onDetailChange('emi_ok', v)}
          isEditing={isEditing}
          options={[
            { value: 'yes', label: 'Yes' },
            { value: 'no', label: 'No' },
            { value: 'pending', label: 'Pending' }
          ]}
        />
        {details.emi_ok === 'no' && (
          <EditableField
            label="EMI Not OK Reason"
            value={details.emi_not_ok_reason}
            onChange={(v) => onDetailChange('emi_not_ok_reason', v)}
            isEditing={isEditing}
          />
        )}
      </div>

      {/* Existing Loans Array */}
      <div className="mt-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-gray-700">Existing Loans ({existingLoans.length})</span>
          {isEditing && (
            <button
              onClick={handleAddLoan}
              className="flex items-center gap-1 text-sm text-green-600 hover:text-green-700"
            >
              <Plus size={16} /> Add Loan
            </button>
          )}
        </div>

        {/* Legacy format loans (if any) */}
        {legacyLoans.length > 0 && existingLoans.length === 0 && (
          <div className="bg-gray-50 rounded-lg p-3 mb-2">
            <p className="text-xs text-gray-500 mb-2">Legacy Format Loans:</p>
            {legacyLoans.map((loan, i) => (
              <div key={i} className="text-sm text-gray-700 py-1 border-b border-gray-200 last:border-0">
                {loan}
              </div>
            ))}
          </div>
        )}

        {/* New format loans */}
        {existingLoans.map((loan, index) => (
          <div key={index} className="bg-gray-50 rounded-lg p-4 mb-3 relative">
            {isEditing && (
              <button
                onClick={() => handleRemoveLoan(index)}
                className="absolute top-2 right-2 text-red-500 hover:text-red-600"
              >
                <Trash2 size={16} />
              </button>
            )}
            <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
              <EditableSelect
                label="Loan Type"
                value={loan.type}
                onChange={(v) => handleLoanChange(index, 'type', v)}
                isEditing={isEditing}
                options={EXISTING_LOAN_TYPES}
                displayValue={EXISTING_LOAN_TYPES.find(t => t.value === loan.type)?.label || loan.type}
              />
              <EditableSelect
                label="Bank/Lender"
                value={loan.bank}
                onChange={(v) => handleLoanChange(index, 'bank', v)}
                isEditing={isEditing}
                options={COMMON_BANKS}
                displayValue={COMMON_BANKS.find(b => b.value === loan.bank)?.label || loan.bank}
                allowCustom
              />
              <EditableField
                label="Outstanding (₹)"
                value={loan.outstanding}
                onChange={(v) => handleLoanChange(index, 'outstanding', v)}
                isEditing={isEditing}
                type="number"
              />
              <EditableField
                label="EMI (₹)"
                value={loan.emi}
                onChange={(v) => handleLoanChange(index, 'emi', v)}
                isEditing={isEditing}
                type="number"
              />
              <EditableField
                label="Tenure Remaining"
                value={loan.tenure_remaining}
                onChange={(v) => handleLoanChange(index, 'tenure_remaining', v)}
                isEditing={isEditing}
                type="number"
                placeholder="months"
              />
              <EditableField
                label="Loan Start Date"
                value={loan.start_date}
                onChange={(v) => handleLoanChange(index, 'start_date', v)}
                isEditing={isEditing}
                type="date"
              />
            </div>
          </div>
        ))}

        {existingLoans.length === 0 && legacyLoans.length === 0 && !isEditing && (
          <p className="text-sm text-gray-500 italic">No existing loans recorded</p>
        )}
      </div>

      {/* Credit Cards - OLD CRM fields */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
        <EditableField
          label="Credit Card Count"
          value={details.credit_card_count}
          onChange={(v) => onDetailChange('credit_card_count', v)}
          isEditing={isEditing}
          type="number"
        />
        <EditableField
          label="Total CC Limit (₹)"
          value={details.total_cc_limit}
          onChange={(v) => onDetailChange('total_cc_limit', v)}
          isEditing={isEditing}
          type="number"
        />
        <EditableField
          label="CC Outstanding (₹)"
          value={details.cc_outstanding}
          onChange={(v) => onDetailChange('cc_outstanding', v)}
          isEditing={isEditing}
          type="number"
        />
        <EditableField
          label="CC Utilization %"
          value={details.cc_utilization}
          onChange={(v) => onDetailChange('cc_utilization', v)}
          isEditing={isEditing}
          type="number"
        />
      </div>
    </div>
  );
};

export default ExistingLoansSection;
export { EXISTING_LOAN_TYPES, COMMON_BANKS };
