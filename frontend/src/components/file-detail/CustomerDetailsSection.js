import React from 'react';
import { EditableField } from './EditableField';

const CustomerDetailsSection = ({ 
  details, 
  isEditing, 
  onDetailChange 
}) => {
  return (
    <div>
      <h4 className="text-sm font-semibold text-green-600 mb-3">Customer Details</h4>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <EditableField
          label="Full Name"
          value={details.full_name}
          onChange={(v) => onDetailChange('full_name', v)}
          isEditing={isEditing}
        />
        <EditableField
          label="Mobile"
          value={details.mobile}
          onChange={(v) => onDetailChange('mobile', v)}
          isEditing={isEditing}
        />
        <EditableField
          label="Email"
          value={details.email}
          onChange={(v) => onDetailChange('email', v)}
          isEditing={isEditing}
          type="email"
        />
        <EditableField
          label="Mother Name"
          value={details.mother_name}
          onChange={(v) => onDetailChange('mother_name', v)}
          isEditing={isEditing}
        />
        <EditableField
          label="Current Address"
          value={details.current_address}
          onChange={(v) => onDetailChange('current_address', v)}
          isEditing={isEditing}
          colSpan={2}
        />
      </div>
    </div>
  );
};

export default CustomerDetailsSection;
