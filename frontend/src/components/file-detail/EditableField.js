import React, { useState } from 'react';

export const EditableField = ({ 
  label, 
  value, 
  onChange, 
  isEditing, 
  type = 'text',
  placeholder = '',
  className = '',
  colSpan = 1,
  required = false,
  multiline = false,
  rows = 3
}) => {
  const colSpanClass = colSpan === 2 ? 'col-span-2' : colSpan === 3 ? 'col-span-3' : '';
  
  return (
    <div className={colSpanClass}>
      <p className="text-xs text-gray-500 mb-1">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </p>
      {isEditing ? (
        multiline ? (
          <textarea
            value={value || ''} 
            onChange={(e) => onChange(e.target.value)} 
            className={`w-full px-3 py-2 border border-gray-200 rounded-lg bg-white text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-none ${className}`}
            placeholder={placeholder}
            rows={rows}
          />
        ) : (
          <input 
            type={type}
            value={value || ''} 
            onChange={(e) => onChange(e.target.value)} 
            className={`w-full h-9 px-3 border border-gray-200 rounded-lg bg-white text-sm focus:outline-none focus:ring-2 focus:ring-green-500 ${className}`}
            placeholder={placeholder}
          />
        )
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
  displayValue,
  allowCustom = false,
  required = false
}) => {
  const [customValue, setCustomValue] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);
  
  // Check if current value is custom (not in options)
  const isCustomValue = value && !options.some(opt => opt.value === value);
  
  const handleChange = (e) => {
    const newValue = e.target.value;
    if (newValue === '__custom__') {
      setShowCustomInput(true);
    } else {
      setShowCustomInput(false);
      onChange(newValue);
    }
  };
  
  const handleCustomSubmit = () => {
    if (customValue.trim()) {
      onChange(customValue.trim());
      setShowCustomInput(false);
      setCustomValue('');
    }
  };
  
  return (
    <div>
      <p className="text-xs text-gray-500 mb-1">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </p>
      {isEditing ? (
        showCustomInput ? (
          <div className="flex gap-2">
            <input
              type="text"
              value={customValue}
              onChange={(e) => setCustomValue(e.target.value)}
              className="flex-1 h-9 px-3 border border-gray-200 rounded-lg bg-white text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              placeholder="Enter custom value"
              onKeyDown={(e) => e.key === 'Enter' && handleCustomSubmit()}
            />
            <button
              onClick={handleCustomSubmit}
              className="px-3 py-1 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700"
            >
              OK
            </button>
            <button
              onClick={() => setShowCustomInput(false)}
              className="px-3 py-1 border border-gray-200 rounded-lg text-sm hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        ) : (
          <select 
            value={isCustomValue ? '__custom__' : (value || '')}
            onChange={handleChange}
            className="w-full h-9 px-3 border border-gray-200 rounded-lg bg-white text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
          >
            <option value="">{placeholder}</option>
            {options.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
            {allowCustom && <option value="__custom__">Other (Custom)...</option>}
            {isCustomValue && !allowCustom && (
              <option value={value}>{value}</option>
            )}
          </select>
        )
      ) : (
        <p className="font-medium text-gray-900">{displayValue || value || '-'}</p>
      )}
      {/* Show custom value indicator */}
      {isEditing && isCustomValue && !showCustomInput && (
        <p className="text-xs text-gray-400 mt-1">Custom: {value}</p>
      )}
    </div>
  );
};

export default EditableField;
