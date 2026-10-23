import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check, X } from 'lucide-react';

/**
 * Lightweight single-select dropdown with a search box.
 * - options: [{ value, label }]
 * - value: selected value ('' = none)
 * - onChange: (value) => void
 */
const SearchableSelect = ({
  options = [],
  value = '',
  onChange,
  placeholder = 'Select',
  testId = 'searchable-select',
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const selectedLabel = options.find((o) => o.value === value)?.label;
  const shown = query ? options.filter((o) => (o.label || '').toLowerCase().includes(query.toLowerCase())) : options;

  const pick = (v) => { onChange(v); setOpen(false); setQuery(''); };
  const clear = (e) => { e.stopPropagation(); onChange(''); };

  return (
    <div className="relative" ref={ref} data-testid={testId}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full input-field text-sm flex items-center justify-between gap-2"
        data-testid={`${testId}-trigger`}
      >
        <span className={value ? 'text-gray-800 truncate' : 'text-gray-400'}>{selectedLabel || placeholder}</span>
        <span className="flex items-center gap-1">
          {value && <X className="w-3.5 h-3.5 text-gray-400 hover:text-gray-700" onClick={clear} data-testid={`${testId}-clear`} />}
          <ChevronDown className="w-4 h-4 text-gray-400" />
        </span>
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-full max-h-64 overflow-auto rounded-lg border border-gray-200 bg-white shadow-lg py-1" data-testid={`${testId}-menu`}>
          <div className="px-2 py-1.5 border-b border-gray-100 sticky top-0 bg-white">
            <input
              type="text"
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search..."
              className="w-full text-sm border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary-500"
              data-testid={`${testId}-search`}
            />
          </div>
          {shown.length === 0 && <div className="px-3 py-2 text-xs text-gray-400">No options</div>}
          {shown.map((opt) => (
            <button
              type="button"
              key={opt.value}
              onClick={() => pick(opt.value)}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-gray-50"
              data-testid={`${testId}-option-${opt.value}`}
            >
              <span className="flex-1 text-gray-700 truncate">{opt.label}</span>
              {opt.value === value && <Check className="w-3.5 h-3.5 text-primary-600" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default SearchableSelect;
