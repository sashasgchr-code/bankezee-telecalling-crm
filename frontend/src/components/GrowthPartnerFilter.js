import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search, Users, X } from 'lucide-react';
import api from '../services/api';

/**
 * One authoritative Growth Partner picker: active Growth Partners only, searchable by name or
 * mobile, checkbox multi-select with Select All / Clear All. `mode="single"` renders the same
 * searchable list as a single-choice selector (used by the Call Log filter).
 */
/** The active Growth Partner population + a mobile lookup, loaded once per mount. */
export const useActiveGrowthPartners = () => {
  const [partners, setPartners] = useState([]);

  useEffect(() => {
    api.get('/users/growth-partners')
      .then(res => {
        const list = (Array.isArray(res.data) ? res.data : res.data?.users || [])
          .map(u => ({
            id: u.id || u._id,
            name: u.full_name || u.name || u.email,
            mobile: u.phone || u.mobile || ''
          }))
          .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        setPartners(list);
      })
      .catch(err => console.error('Error loading growth partners:', err));
  }, []);

  const mobileById = useMemo(() => {
    const map = {};
    partners.forEach(p => { map[p.id] = p.mobile; });
    return map;
  }, [partners]);

  return { partners, mobileById };
};

export const GrowthPartnerFilter = ({
  selected = [],
  onChange,
  mode = 'multi',
  label = 'Growth Partner',
  testId = 'gp-filter'
}) => {
  const { partners } = useActiveGrowthPartners();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const boxRef = useRef(null);

  useEffect(() => {
    const close = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return partners;
    return partners.filter(p =>
      (p.name || '').toLowerCase().includes(term) ||
      String(p.mobile || '').replace(/\D/g, '').includes(term.replace(/\D/g, '')) && /\d/.test(term)
    );
  }, [partners, search]);

  const isSingle = mode === 'single';
  const allIds = partners.map(p => p.id);
  // An empty selection means "no filter applied" -> every active Growth Partner is shown.
  const summary = isSingle
    ? (partners.find(p => p.id === selected[0])?.name || `All ${label}s`)
    : (!selected.length || selected.length === partners.length
        ? `All ${label}s (${partners.length})`
        : `${selected.length} of ${partners.length} selected`);

  const toggle = (id) => {
    if (isSingle) {
      onChange(selected[0] === id ? [] : [id]);
      setOpen(false);
      return;
    }
    onChange(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id]);
  };

  return (
    <div className="relative print-hide" ref={boxRef} data-testid={testId}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full min-w-[220px] flex items-center justify-between gap-2 px-3 py-2 border border-gray-200 rounded-lg bg-white text-sm hover:border-green-400 transition-colors"
        data-testid={`${testId}-toggle`}
      >
        <span className="flex items-center gap-2 text-gray-700 truncate">
          <Users size={16} className="text-gray-400" />
          {summary}
        </span>
        <ChevronDown size={16} className={`text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute z-50 mt-2 w-[300px] bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden">
          <div className="p-2 border-b border-gray-100">
            <div className="relative">
              <Search size={15} className="absolute left-2.5 top-2.5 text-gray-400" />
              <input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name or mobile"
                className="w-full pl-8 pr-7 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                data-testid={`${testId}-search`}
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute right-2 top-2.5 text-gray-400 hover:text-gray-600"
                  data-testid={`${testId}-search-clear`}
                >
                  <X size={14} />
                </button>
              )}
            </div>
          </div>

          {!isSingle && (
            <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b border-gray-100 text-xs">
              <button
                onClick={() => onChange(allIds)}
                className="text-green-700 font-medium hover:underline"
                data-testid={`${testId}-select-all`}
              >
                Select All
              </button>
              <button
                onClick={() => onChange([])}
                className="text-gray-600 font-medium hover:underline"
                data-testid={`${testId}-clear-all`}
              >
                Clear All
              </button>
            </div>
          )}

          <div className="max-h-64 overflow-y-auto" data-testid={`${testId}-options`}>
            {isSingle && (
              <button
                onClick={() => { onChange([]); setOpen(false); }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
                data-testid={`${testId}-option-all`}
              >
                All {label}s
              </button>
            )}
            {visible.length === 0 && (
              <p className="px-3 py-4 text-sm text-gray-500" data-testid={`${testId}-empty`}>
                No Growth Partner matches "{search}"
              </p>
            )}
            {visible.map(p => (
              <label
                key={p.id}
                className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50 cursor-pointer"
                data-testid={`${testId}-option`}
              >
                <input
                  type={isSingle ? 'radio' : 'checkbox'}
                  checked={selected.includes(p.id)}
                  onChange={() => toggle(p.id)}
                  className="w-4 h-4 accent-green-600"
                />
                <span className="text-gray-800 truncate">{p.name}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

/** Search box for filtering employee rows by name or mobile. */
export const EmployeeSearch = ({ value, onChange, testId = 'gp-search' }) => (
  <div className="relative print-hide">
    <Search size={15} className="absolute left-2.5 top-2.5 text-gray-400" />
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Search Growth Partner (name or mobile)"
      className="w-full min-w-[260px] pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
      data-testid={testId}
    />
  </div>
);

/** Name / mobile / GP-selection match used by every employee view. */
export const matchesGpFilters = (row, { selectedIds, search, mobileById }) => {
  const id = row?.user_id || row?.id;
  if (selectedIds?.length && id && !selectedIds.includes(id)) return false;
  const term = (search || '').trim().toLowerCase();
  if (!term) return true;
  const name = (row?.user_name || row?.name || row?.full_name || '').toLowerCase();
  const mobile = String(row?.mobile || row?.phone || (mobileById || {})[id] || '').replace(/\D/g, '');
  const digits = term.replace(/\D/g, '');
  return name.includes(term) || (digits.length > 0 && mobile.includes(digits));
};

export default GrowthPartnerFilter;
