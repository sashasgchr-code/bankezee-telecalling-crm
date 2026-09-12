import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check, X } from 'lucide-react';

/**
 * Lightweight checkbox multi-select dropdown.
 * - options: [{ value, label, hint }]
 * - selected: array of selected values
 * - onChange: (nextArray) => void
 * Multiple selected values are OR-ed by the caller/backend.
 */
const MultiSelectDropdown = ({
  options = [],
  selected = [],
  onChange,
  placeholder = 'Select',
  showSelectAll = true,
  testId = 'multi-select',
}) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const toggle = (value) => {
    if (selected.includes(value)) onChange(selected.filter((v) => v !== value));
    else onChange([...selected, value]);
  };

  const clearAll = (e) => { e.stopPropagation(); onChange([]); };
  const selectAll = () => onChange(options.map((o) => o.value));

  const count = selected.length;
  const label = count === 0 ? placeholder : `${placeholder} (${count})`;

  return (
    <div className="relative" ref={ref} data-testid={testId}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full input-field text-sm flex items-center justify-between gap-2"
        data-testid={`${testId}-trigger`}
      >
        <span className={count === 0 ? 'text-gray-400' : 'text-gray-800'}>{label}</span>
        <span className="flex items-center gap-1">
          {count > 0 && (
            <X className="w-3.5 h-3.5 text-gray-400 hover:text-gray-700" onClick={clearAll} data-testid={`${testId}-clear`} />
          )}
          <ChevronDown className="w-4 h-4 text-gray-400" />
        </span>
      </button>

      {open && (
        <div
          className="absolute z-30 mt-1 w-full max-h-64 overflow-auto rounded-lg border border-gray-200 bg-white shadow-lg py-1"
          data-testid={`${testId}-menu`}
        >
          {showSelectAll && options.length > 0 && (
            <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-100 text-xs">
              <button type="button" className="text-primary-600 hover:underline" onClick={selectAll} data-testid={`${testId}-select-all`}>Select All</button>
              <button type="button" className="text-gray-500 hover:underline" onClick={() => onChange([])} data-testid={`${testId}-clear-all`}>Clear</button>
            </div>
          )}
          {options.length === 0 && (
            <div className="px-3 py-2 text-xs text-gray-400">No options</div>
          )}
          {options.map((opt) => {
            const isSel = selected.includes(opt.value);
            return (
              <button
                type="button"
                key={opt.value}
                onClick={() => toggle(opt.value)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-gray-50"
                data-testid={`${testId}-option-${opt.value}`}
              >
                <span className={`w-4 h-4 rounded border flex items-center justify-center ${isSel ? 'bg-primary-600 border-primary-600' : 'border-gray-300'}`}>
                  {isSel && <Check className="w-3 h-3 text-white" />}
                </span>
                <span className="flex-1 text-gray-700">{opt.label}</span>
                {opt.hint && <span className="text-[10px] text-gray-400">{opt.hint}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default MultiSelectDropdown;
