import React from 'react';

export const EditableField = ({ 
  label, 
  value, 
  onChange, 
  isEditing, 
  type = 'text',
  placeholder = '',
  className = '',
  colSpan = 1
}) => {
  const colSpanClass = colSpan === 2 ? 'col-span-2' : colSpan === 3 ? 'col-span-3' : '';
  
  return (
    <div className={colSpanClass}>
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      {isEditing ? (
        <input 
          type={type}
          value={value || ''} 
          onChange={(e) => onChange(e.target.value)} 
          className={`w-full h-9 px-3 border border-gray-200 rounded-lg bg-white text-sm focus:outline-none focus:ring-2 focus:ring-green-500 ${className}`}
          placeholder={placeholder}
        />
      ) : (
        <p className="font-medium text-gray-900">{value || '-'}</p>
      )}
    </div>
  );
};

export const EditableSelect = ({ 
  label, 
  value, 
  onChange, 
  isEditing, 
  options,
  placeholder = 'Select',
  displayValue
}) => {
  return (
    <div>
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      {isEditing ? (
        <select 
          value={value || ''} 
          onChange={(e) => onChange(e.target.value)}
          className="w-full h-9 px-3 border border-gray-200 rounded-lg bg-white text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
        >
          <option value="">{placeholder}</option>
          {options.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      ) : (
        <p className="font-medium text-gray-900">{displayValue || value || '-'}</p>
      )}
    </div>
  );
};

export default EditableField;
