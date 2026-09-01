import React from 'react';
import { EditableField } from './EditableField';

const ExistingLoansSection = ({ 
  details, 
  isEditing, 
  onDetailChange 
}) => {
  return (
    <div className="pt-4 border-t border-gray-200">
      <h4 className="text-sm font-semibold text-green-600 mb-3">Existing Loans & Obligations</h4>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <EditableField
          label="Monthly EMI Obligations (₹)"
          value={details.obligations_emi}
          onChange={(v) => onDetailChange('obligations_emi', v)}
          isEditing={isEditing}
          type="number"
        />
        <EditableField
          label="Existing Loan 1"
          value={details.existing_loan_1}
          onChange={(v) => onDetailChange('existing_loan_1', v)}
          isEditing={isEditing}
        />
        <EditableField
          label="Existing Loan 2"
          value={details.existing_loan_2}
          onChange={(v) => onDetailChange('existing_loan_2', v)}
          isEditing={isEditing}
        />
        <EditableField
          label="Existing Loan 3"
          value={details.existing_loan_3}
          onChange={(v) => onDetailChange('existing_loan_3', v)}
          isEditing={isEditing}
        />
      </div>
    </div>
  );
};

export default ExistingLoansSection;
