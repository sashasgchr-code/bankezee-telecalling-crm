import React from 'react';
import { EditableField, EditableSelect } from './EditableField';

const EMPLOYMENT_TYPES = [
  { value: 'salaried', label: 'Salaried' },
  { value: 'self_employed', label: 'Self Employed' },
  { value: 'business', label: 'Business Owner' },
  { value: 'professional', label: 'Professional' }
];

const EmploymentDetailsSection = ({ 
  details, 
  isEditing, 
  onDetailChange 
}) => {
  return (
    <div className="pt-4 border-t border-gray-200">
      <h4 className="text-sm font-semibold text-green-600 mb-3">Employment Details</h4>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <EditableSelect
          label="Employment Type"
          value={details.employment_type}
          onChange={(v) => onDetailChange('employment_type', v)}
          isEditing={isEditing}
          options={EMPLOYMENT_TYPES}
          displayValue={EMPLOYMENT_TYPES.find(t => t.value === details.employment_type)?.label}
        />
        <EditableField
          label="Company Name"
          value={details.company_name}
          onChange={(v) => onDetailChange('company_name', v)}
          isEditing={isEditing}
        />
        <EditableField
          label="Net Salary (₹)"
          value={details.net_salary}
          onChange={(v) => onDetailChange('net_salary', v)}
          isEditing={isEditing}
          type="number"
        />
        <EditableField
          label="Office Address"
          value={details.office_address}
          onChange={(v) => onDetailChange('office_address', v)}
          isEditing={isEditing}
          colSpan={2}
        />
      </div>
    </div>
  );
};

export default EmploymentDetailsSection;
