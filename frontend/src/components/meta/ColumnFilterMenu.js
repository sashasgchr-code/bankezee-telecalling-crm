import React, { useEffect, useRef, useState } from "react";
import { Filter, ChevronUp, ChevronDown } from "lucide-react";

// Small per-column filter/sort popover. Preserves the Leads table design: a tiny funnel icon
// in the header (blue dot when a filter is active) that opens a dropdown of options.
export default function ColumnFilterMenu({ label, field, active, sortBy, sortDir, children, testid }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onEsc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onEsc); };
  }, [open]);

  const sorted = field && sortBy === field;
  return (
    <div className="relative inline-flex items-center gap-1" ref={ref}>
      <span>{label}</span>
      {sorted && (sortDir === "asc" ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
      <button
        type="button"
        data-testid={testid || `meta-colfilter-${(label || "").toLowerCase()}`}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className={`inline-flex items-center justify-center h-5 w-5 rounded hover:bg-slate-200 transition-colors ${active ? "text-blue-600" : "text-slate-400"}`}
        title={`Filter ${label}`}
      >
        <Filter size={12} />
        {active && <span className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-blue-600" />}
      </button>
      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          data-testid={`${testid || `meta-colfilter-${(label || "").toLowerCase()}`}-panel`}
          className="absolute left-0 top-7 z-50 w-60 bg-white border border-slate-200 rounded-md shadow-lg p-3 text-slate-700 normal-case tracking-normal font-normal"
        >
          {children}
        </div>
      )}
    </div>
  );
}

export const MenuSortRow = ({ onAsc, onDesc, ascLabel = "Sort A–Z", descLabel = "Sort Z–A", activeDir }) => (
  <div className="flex gap-1.5 mb-2">
    <button type="button" onClick={onAsc} className={`flex-1 px-2 py-1 rounded text-xs border ${activeDir === "asc" ? "bg-blue-50 border-blue-300 text-blue-700" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>{ascLabel}</button>
    <button type="button" onClick={onDesc} className={`flex-1 px-2 py-1 rounded text-xs border ${activeDir === "desc" ? "bg-blue-50 border-blue-300 text-blue-700" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>{descLabel}</button>
  </div>
);
