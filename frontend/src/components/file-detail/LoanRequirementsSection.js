import React from 'react';
import { EditableField, EditableSelect } from './EditableField';

const LOAN_TYPES = [
  { value: 'reduce_home_loan_emi', label: 'Reduce Home Loan EMI' },
  { value: 'merge_multiple_loans', label: 'Merge Multiple Loans' },
  { value: 'top_up_loan', label: 'Top-Up Loan' },
  { value: 'new_personal_loan', label: 'New Personal Loan' },
  { value: 'new_home_loan', label: 'New Home Loan' },
  { value: 'business_loan', label: 'Business Loan' },
  { value: 'vehicle_loan', label: 'Vehicle Loan' },
  { value: 'balance_transfer', label: 'Balance Transfer' },
  { value: 'bt_top_up_pl', label: 'Balance Transfer + Top Up PL' }
];

export { LOAN_TYPES };

const LoanRequirementsSection = ({ 
  details, 
  isEditing, 
  onDetailChange 
}) => {
  return (
    <div className="pt-4 border-t border-gray-200">
      <h4 className="text-sm font-semibold text-green-600 mb-3">Loan Requirements</h4>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <EditableSelect
          label="Type of Loan"
          value={details.type_of_loan}
          onChange={(v) => onDetailChange('type_of_loan', v)}
          isEditing={isEditing}
          options={LOAN_TYPES}
          displayValue={LOAN_TYPES.find(t => t.value === details.type_of_loan)?.label || details.type_of_loan}
        />
        <EditableField
          label="CIBIL Score"
          value={details.cibil_score}
          onChange={(v) => onDetailChange('cibil_score', v)}
          isEditing={isEditing}
          type="number"
        />
        <EditableField
          label="Loan Amount Required (₹)"
          value={details.loan_amount_required}
          onChange={(v) => onDetailChange('loan_amount_required', v)}
          isEditing={isEditing}
          type="number"
        />
        <EditableField
          label="Tenure Required (months)"
          value={details.tenure_required}
          onChange={(v) => onDetailChange('tenure_required', v)}
          isEditing={isEditing}
          type="number"
        />
      </div>
    </div>
  );
};

export default LoanRequirementsSection;
