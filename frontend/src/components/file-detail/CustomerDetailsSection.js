import React from 'react';
import { EditableField, EditableSelect } from './EditableField';

// Employment Types from OLD CRM
const EMPLOYMENT_TYPES = [
  { value: 'salaried', label: 'Salaried' },
  { value: 'self_employed', label: 'Self Employed' },
  { value: 'business', label: 'Business Owner' },
  { value: 'professional', label: 'Professional (Doctor/CA/Lawyer)' },
  { value: 'government', label: 'Government Employee' },
  { value: 'pensioner', label: 'Pensioner' },
  { value: 'other', label: 'Other' }
];

// Company Categories from OLD CRM Policy Master
const COMPANY_CATEGORIES = [
  { value: 'government', label: 'Government' },
  { value: 'psu', label: 'PSU' },
  { value: 'listed', label: 'Listed Company' },
  { value: 'mnc', label: 'MNC' },
  { value: 'cat_a', label: 'Category A' },
  { value: 'cat_b', label: 'Category B' },
  { value: 'cat_c', label: 'Category C' },
  { value: 'private', label: 'Private Limited' },
  { value: 'partnership', label: 'Partnership Firm' },
  { value: 'proprietorship', label: 'Proprietorship' },
  { value: 'other', label: 'Other' }
];

// Cities from OLD CRM
const CITIES = [
  { value: 'mumbai', label: 'Mumbai' },
  { value: 'delhi', label: 'Delhi' },
  { value: 'bangalore', label: 'Bangalore' },
  { value: 'hyderabad', label: 'Hyderabad' },
  { value: 'chennai', label: 'Chennai' },
  { value: 'kolkata', label: 'Kolkata' },
  { value: 'pune', label: 'Pune' },
  { value: 'ahmedabad', label: 'Ahmedabad' },
  { value: 'jaipur', label: 'Jaipur' },
  { value: 'lucknow', label: 'Lucknow' },
  { value: 'other', label: 'Other' }
];

const CustomerDetailsSection = ({ 
  details, 
  isEditing, 
  onDetailChange 
}) => {
  return (
    <div>
      <h4 className="text-sm font-semibold text-green-600 mb-3 flex items-center gap-2">
        <span className="w-6 h-6 rounded-full bg-green-100 text-green-700 flex items-center justify-center text-xs font-bold">1</span>
        Customer Details
      </h4>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {/* Basic Info */}
        <EditableField
          label="Full Name *"
          value={details.full_name}
          onChange={(v) => onDetailChange('full_name', v)}
          isEditing={isEditing}
          required
        />
        <EditableField
          label="Mobile *"
          value={details.mobile}
          onChange={(v) => onDetailChange('mobile', v)}
          isEditing={isEditing}
          type="tel"
          required
        />
        <EditableField
          label="Email"
          value={details.email}
          onChange={(v) => onDetailChange('email', v)}
          isEditing={isEditing}
          type="email"
        />
        
        {/* Personal Details - OLD CRM Fields */}
        <EditableField
          label="Father's Name"
          value={details.father_name}
          onChange={(v) => onDetailChange('father_name', v)}
          isEditing={isEditing}
        />
        <EditableField
          label="Mother's Name"
          value={details.mother_name}
          onChange={(v) => onDetailChange('mother_name', v)}
          isEditing={isEditing}
        />
        <EditableField
          label="Date of Birth"
          value={details.date_of_birth}
          onChange={(v) => onDetailChange('date_of_birth', v)}
          isEditing={isEditing}
          type="date"
        />
        <EditableField
          label="PAN Number"
          value={details.pan_number}
          onChange={(v) => onDetailChange('pan_number', v.toUpperCase())}
          isEditing={isEditing}
          placeholder="ABCDE1234F"
        />
        <EditableField
          label="Aadhaar Number"
          value={details.aadhaar_number}
          onChange={(v) => onDetailChange('aadhaar_number', v)}
          isEditing={isEditing}
          placeholder="1234 5678 9012"
        />
        
        {/* Address Fields - Preserved from OLD CRM */}
        <EditableField
          label="Current Address"
          value={details.current_address}
          onChange={(v) => onDetailChange('current_address', v)}
          isEditing={isEditing}
          colSpan={2}
        />
        <EditableSelect
          label="City"
          value={details.city}
          onChange={(v) => onDetailChange('city', v)}
          isEditing={isEditing}
          options={CITIES}
          displayValue={CITIES.find(c => c.value === details.city)?.label || details.city}
          allowCustom
        />
        <EditableField
          label="Permanent Address"
          value={details.permanent_address}
          onChange={(v) => onDetailChange('permanent_address', v)}
          isEditing={isEditing}
          colSpan={2}
        />
        <EditableField
          label="PIN Code"
          value={details.pin_code}
          onChange={(v) => onDetailChange('pin_code', v)}
          isEditing={isEditing}
          type="text"
          placeholder="400001"
        />
        
        {/* Residence Details - OLD CRM fields */}
        <EditableSelect
          label="Residence Type"
          value={details.residence_type}
          onChange={(v) => onDetailChange('residence_type', v)}
          isEditing={isEditing}
          options={[
            { value: 'owned', label: 'Owned' },
            { value: 'rented', label: 'Rented' },
            { value: 'company_provided', label: 'Company Provided' },
            { value: 'parental', label: 'Parental' },
            { value: 'hostel', label: 'Hostel' },
            { value: 'other', label: 'Other' }
          ]}
        />
        <EditableField
          label="Years at Current Address"
          value={details.years_at_current_address}
          onChange={(v) => onDetailChange('years_at_current_address', v)}
          isEditing={isEditing}
          type="number"
        />
      </div>
    </div>
  );
};

export default CustomerDetailsSection;
export { EMPLOYMENT_TYPES, COMPANY_CATEGORIES, CITIES };
