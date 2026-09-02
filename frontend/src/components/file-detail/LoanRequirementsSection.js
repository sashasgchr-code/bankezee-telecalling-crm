import React from 'react';
import { EditableField, EditableSelect } from './EditableField';

// Complete OLD CRM Loan Types - All types preserved
const LOAN_TYPES = [
  // Personal Loans
  { value: 'new_personal_loan', label: 'New Personal Loan', category: 'personal' },
  { value: 'balance_transfer_pl', label: 'Balance Transfer PL', category: 'personal' },
  { value: 'top_up_pl', label: 'Top Up PL', category: 'personal' },
  { value: 'balance_transfer_topup_pl', label: 'Balance Transfer + Top Up PL', category: 'personal' },
  { value: 'merge_multiple_loans', label: 'Merge Multiple Loans', category: 'personal' },
  // Home Loans
  { value: 'new_home_loan', label: 'New Home Loan', category: 'home' },
  { value: 'balance_transfer_hl', label: 'Balance Transfer HL', category: 'home' },
  { value: 'balance_transfer_topup_hl', label: 'Balance Transfer + Top Up HL', category: 'home' },
  { value: 'reduce_home_loan_emi', label: 'Reduce Home Loan EMI', category: 'home' },
  // Vehicle Loans
  { value: 'new_vehicle_loan', label: 'New Vehicle Loan', category: 'vehicle' },
  { value: 'used_vehicle_loan_fresh', label: 'Used Vehicle Loan (Fresh)', category: 'vehicle' },
  { value: 'used_vehicle_loan_bt', label: 'Used Vehicle Loan BT', category: 'vehicle' },
  // Business Loans
  { value: 'business_loan', label: 'Business Loan', category: 'business' },
  { value: 'msme_loan', label: 'MSME Loan', category: 'business' },
  // Other
  { value: 'lap', label: 'LAP (Loan Against Property)', category: 'other' },
  { value: 'gold_loan', label: 'Gold Loan', category: 'other' },
  { value: 'education_loan', label: 'Education Loan', category: 'other' },
  { value: 'other', label: 'Other', category: 'other' }
];

// Loan Purpose Options
const LOAN_PURPOSES = [
  { value: 'debt_consolidation', label: 'Debt Consolidation' },
  { value: 'home_purchase', label: 'Home Purchase' },
  { value: 'home_renovation', label: 'Home Renovation' },
  { value: 'vehicle_purchase', label: 'Vehicle Purchase' },
  { value: 'business_expansion', label: 'Business Expansion' },
  { value: 'working_capital', label: 'Working Capital' },
  { value: 'education', label: 'Education' },
  { value: 'medical', label: 'Medical Expenses' },
  { value: 'wedding', label: 'Wedding' },
  { value: 'travel', label: 'Travel' },
  { value: 'other', label: 'Other' }
];

export { LOAN_TYPES, LOAN_PURPOSES };

const LoanRequirementsSection = ({ 
  details, 
  isEditing, 
  onDetailChange 
}) => {
  // Group loan types by category for better UX
  const groupedLoanTypes = LOAN_TYPES.reduce((acc, type) => {
    const cat = type.category || 'other';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(type);
    return acc;
  }, {});

  const categoryLabels = {
    personal: 'Personal Loans',
    home: 'Home Loans',
    vehicle: 'Vehicle Loans',
    business: 'Business Loans',
    other: 'Other'
  };

  return (
    <div className="pt-4 border-t border-gray-200">
      <h4 className="text-sm font-semibold text-green-600 mb-3 flex items-center gap-2">
        <span className="w-6 h-6 rounded-full bg-green-100 text-green-700 flex items-center justify-center text-xs font-bold">4</span>
        Loan Requirements
      </h4>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Loan Type Selection with Categories */}
        <div className={`${isEditing ? '' : 'md:col-span-1'}`}>
          {isEditing ? (
            <div>
              <label className="block text-xs text-gray-500 mb-1">Type of Loan *</label>
              <select
                value={details.type_of_loan || ''}
                onChange={(e) => onDetailChange('type_of_loan', e.target.value)}
                className="w-full h-10 px-3 border border-gray-200 rounded-lg bg-white text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              >
                <option value="">Select Loan Type</option>
                {Object.entries(groupedLoanTypes).map(([category, types]) => (
                  <optgroup key={category} label={categoryLabels[category]}>
                    {types.map(type => (
                      <option key={type.value} value={type.value}>{type.label}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
          ) : (
            <div>
              <label className="block text-xs text-gray-500 mb-1">Type of Loan</label>
              <p className="text-sm font-medium text-gray-900">
                {LOAN_TYPES.find(t => t.value === details.type_of_loan)?.label || details.type_of_loan || '-'}
              </p>
            </div>
          )}
        </div>
        
        {/* Loan Amount */}
        <EditableField
          label="Loan Amount Required (₹) *"
          value={details.loan_amount_required}
          onChange={(v) => onDetailChange('loan_amount_required', v)}
          isEditing={isEditing}
          type="number"
          placeholder="e.g., 500000"
        />
        
        {/* Tenure */}
        <EditableField
          label="Tenure Required (months)"
          value={details.tenure_required}
          onChange={(v) => onDetailChange('tenure_required', v)}
          isEditing={isEditing}
          type="number"
          placeholder="e.g., 48"
        />
        
        {/* Purpose */}
        <EditableSelect
          label="Loan Purpose"
          value={details.loan_purpose}
          onChange={(v) => onDetailChange('loan_purpose', v)}
          isEditing={isEditing}
          options={LOAN_PURPOSES}
          displayValue={LOAN_PURPOSES.find(p => p.value === details.loan_purpose)?.label || details.loan_purpose}
        />
        
        {/* Expected ROI */}
        <EditableField
          label="Expected ROI %"
          value={details.expected_roi}
          onChange={(v) => onDetailChange('expected_roi', v)}
          isEditing={isEditing}
          type="number"
          placeholder="e.g., 10.5"
        />
        
        {/* Expected EMI */}
        <EditableField
          label="Expected EMI (₹)"
          value={details.expected_emi}
          onChange={(v) => onDetailChange('expected_emi', v)}
          isEditing={isEditing}
          type="number"
          placeholder="Max EMI affordable"
        />
        
        {/* BT/Topup Specific Fields */}
        {(details.type_of_loan?.includes('balance_transfer') || details.type_of_loan?.includes('bt')) && (
          <>
            <EditableField
              label="BT Amount (₹)"
              value={details.bt_amount}
              onChange={(v) => onDetailChange('bt_amount', v)}
              isEditing={isEditing}
              type="number"
              placeholder="Amount to transfer"
            />
            <EditableField
              label="Current ROI %"
              value={details.current_roi}
              onChange={(v) => onDetailChange('current_roi', v)}
              isEditing={isEditing}
              type="number"
              placeholder="Current loan ROI"
            />
            <EditableField
              label="Topup Amount (₹)"
              value={details.topup_amount}
              onChange={(v) => onDetailChange('topup_amount', v)}
              isEditing={isEditing}
              type="number"
              placeholder="Additional amount needed"
            />
          </>
        )}
        
        {/* Property Details for Home Loan/LAP */}
        {(details.type_of_loan?.includes('home') || details.type_of_loan === 'lap') && (
          <>
            <EditableField
              label="Property Value (₹)"
              value={details.property_value}
              onChange={(v) => onDetailChange('property_value', v)}
              isEditing={isEditing}
              type="number"
            />
            <EditableSelect
              label="Property Type"
              value={details.property_type}
              onChange={(v) => onDetailChange('property_type', v)}
              isEditing={isEditing}
              options={[
                { value: 'residential', label: 'Residential' },
                { value: 'commercial', label: 'Commercial' },
                { value: 'industrial', label: 'Industrial' },
                { value: 'land', label: 'Land' }
              ]}
            />
            <EditableField
              label="Property Location"
              value={details.property_location}
              onChange={(v) => onDetailChange('property_location', v)}
              isEditing={isEditing}
            />
          </>
        )}
        
        {/* Vehicle Details for Vehicle Loans */}
        {details.type_of_loan?.includes('vehicle') && (
          <>
            <EditableSelect
              label="Vehicle Type"
              value={details.vehicle_type}
              onChange={(v) => onDetailChange('vehicle_type', v)}
              isEditing={isEditing}
              options={[
                { value: 'car', label: 'Car' },
                { value: 'suv', label: 'SUV' },
                { value: 'two_wheeler', label: 'Two Wheeler' },
                { value: 'commercial', label: 'Commercial Vehicle' }
              ]}
            />
            <EditableField
              label="Vehicle Make/Model"
              value={details.vehicle_model}
              onChange={(v) => onDetailChange('vehicle_model', v)}
              isEditing={isEditing}
            />
            <EditableField
              label="Vehicle Year"
              value={details.vehicle_year}
              onChange={(v) => onDetailChange('vehicle_year', v)}
              isEditing={isEditing}
              type="number"
            />
          </>
        )}
      </div>
      
      {/* Additional Notes */}
      <div className="mt-4">
        <EditableField
          label="Additional Notes / Special Requirements"
          value={details.requirement_notes}
          onChange={(v) => onDetailChange('requirement_notes', v)}
          isEditing={isEditing}
          multiline
          rows={3}
          placeholder="Any special requirements, urgency, etc."
        />
      </div>
    </div>
  );
};

export default LoanRequirementsSection;
