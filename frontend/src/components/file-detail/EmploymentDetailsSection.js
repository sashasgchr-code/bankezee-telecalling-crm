import React from 'react';
import { EditableField, EditableSelect } from './EditableField';
import { EMPLOYMENT_TYPES, COMPANY_CATEGORIES } from './CustomerDetailsSection';

const EmploymentDetailsSection = ({ 
  details, 
  isEditing, 
  onDetailChange 
}) => {
  return (
    <div className="pt-4 border-t border-gray-200">
      <h4 className="text-sm font-semibold text-green-600 mb-3 flex items-center gap-2">
        <span className="w-6 h-6 rounded-full bg-green-100 text-green-700 flex items-center justify-center text-xs font-bold">2</span>
        Employment & Income Details
      </h4>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Employment Type */}
        <EditableSelect
          label="Employment Type *"
          value={details.employment_type}
          onChange={(v) => onDetailChange('employment_type', v)}
          isEditing={isEditing}
          options={EMPLOYMENT_TYPES}
          displayValue={EMPLOYMENT_TYPES.find(e => e.value === details.employment_type)?.label || details.employment_type}
        />
        
        {/* Company Details */}
        <EditableField
          label="Company Name *"
          value={details.company_name}
          onChange={(v) => onDetailChange('company_name', v)}
          isEditing={isEditing}
        />
        <EditableSelect
          label="Company Category"
          value={details.company_type}
          onChange={(v) => onDetailChange('company_type', v)}
          isEditing={isEditing}
          options={COMPANY_CATEGORIES}
          displayValue={COMPANY_CATEGORIES.find(c => c.value === details.company_type)?.label || details.company_type}
        />
        <EditableField
          label="Designation"
          value={details.designation}
          onChange={(v) => onDetailChange('designation', v)}
          isEditing={isEditing}
        />
        
        {/* Office Address */}
        <EditableField
          label="Office Address"
          value={details.office_address}
          onChange={(v) => onDetailChange('office_address', v)}
          isEditing={isEditing}
          colSpan={2}
        />
        <EditableField
          label="Office City"
          value={details.office_city}
          onChange={(v) => onDetailChange('office_city', v)}
          isEditing={isEditing}
        />
        <EditableField
          label="Office PIN Code"
          value={details.office_pincode}
          onChange={(v) => onDetailChange('office_pincode', v)}
          isEditing={isEditing}
        />
        
        {/* Employment Duration - OLD CRM Policy Master fields */}
        <EditableField
          label="Present Employment (months)"
          value={details.present_employment_months}
          onChange={(v) => onDetailChange('present_employment_months', v)}
          isEditing={isEditing}
          type="number"
          placeholder="e.g., 24"
        />
        <EditableField
          label="Total Experience (months)"
          value={details.total_employment_months}
          onChange={(v) => onDetailChange('total_employment_months', v)}
          isEditing={isEditing}
          type="number"
          placeholder="e.g., 60"
        />
        
        {/* Income Details - Critical for eligibility */}
        <EditableField
          label="Gross Salary (₹) *"
          value={details.gross_salary}
          onChange={(v) => onDetailChange('gross_salary', v)}
          isEditing={isEditing}
          type="number"
          placeholder="Monthly gross"
        />
        <EditableField
          label="Net Salary (₹) *"
          value={details.net_salary}
          onChange={(v) => onDetailChange('net_salary', v)}
          isEditing={isEditing}
          type="number"
          placeholder="Monthly net/in-hand"
        />
        
        {/* Bank Account for Salary */}
        <EditableField
          label="Salary Bank Name"
          value={details.salary_bank_name}
          onChange={(v) => onDetailChange('salary_bank_name', v)}
          isEditing={isEditing}
        />
        <EditableField
          label="Salary Account No."
          value={details.salary_account_number}
          onChange={(v) => onDetailChange('salary_account_number', v)}
          isEditing={isEditing}
        />
        
        {/* Additional Income - OLD CRM fields */}
        <EditableField
          label="Additional Income (₹)"
          value={details.additional_income}
          onChange={(v) => onDetailChange('additional_income', v)}
          isEditing={isEditing}
          type="number"
          placeholder="Rental, investments, etc."
        />
        <EditableField
          label="Additional Income Source"
          value={details.additional_income_source}
          onChange={(v) => onDetailChange('additional_income_source', v)}
          isEditing={isEditing}
          placeholder="e.g., Rental, Dividends"
        />
        
        {/* Self-Employed specific fields (if needed) */}
        {(details.employment_type === 'self_employed' || details.employment_type === 'business') && (
          <>
            <EditableField
              label="Business Name"
              value={details.business_name}
              onChange={(v) => onDetailChange('business_name', v)}
              isEditing={isEditing}
            />
            <EditableField
              label="Business Vintage (years)"
              value={details.business_vintage}
              onChange={(v) => onDetailChange('business_vintage', v)}
              isEditing={isEditing}
              type="number"
            />
            <EditableField
              label="Annual Turnover (₹)"
              value={details.annual_turnover}
              onChange={(v) => onDetailChange('annual_turnover', v)}
              isEditing={isEditing}
              type="number"
            />
            <EditableField
              label="ITR Filed Amount (₹)"
              value={details.itr_filed_amount}
              onChange={(v) => onDetailChange('itr_filed_amount', v)}
              isEditing={isEditing}
              type="number"
            />
          </>
        )}
      </div>
    </div>
  );
};

export default EmploymentDetailsSection;
