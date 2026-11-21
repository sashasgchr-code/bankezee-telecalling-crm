import React from 'react';

// Shared modern KPI card: tinted glow, gradient icon tile, large value. Theme classes are literal so Tailwind keeps them.
export const THEMES = {
  indigo: { tile: 'from-indigo-400 to-indigo-600 shadow-indigo-200', glow: 'bg-indigo-100', value: 'text-indigo-950', bar: 'from-indigo-400 to-indigo-600' },
  sky: { tile: 'from-sky-400 to-sky-600 shadow-sky-200', glow: 'bg-sky-100', value: 'text-sky-950', bar: 'from-sky-400 to-sky-600' },
  orange: { tile: 'from-orange-400 to-orange-600 shadow-orange-200', glow: 'bg-orange-100', value: 'text-orange-700', bar: 'from-orange-400 to-orange-600' },
  violet: { tile: 'from-violet-400 to-violet-600 shadow-violet-200', glow: 'bg-violet-100', value: 'text-violet-950', bar: 'from-violet-400 to-violet-600' },
  green: { tile: 'from-green-400 to-green-600 shadow-green-200', glow: 'bg-green-100', value: 'text-green-700', bar: 'from-green-400 to-green-600' },
  emerald: { tile: 'from-emerald-400 to-emerald-600 shadow-emerald-200', glow: 'bg-emerald-100', value: 'text-emerald-700', bar: 'from-emerald-400 to-emerald-600' },
  teal: { tile: 'from-teal-400 to-teal-600 shadow-teal-200', glow: 'bg-teal-100', value: 'text-teal-800', bar: 'from-teal-400 to-teal-600' },
  amber: { tile: 'from-amber-400 to-amber-600 shadow-amber-200', glow: 'bg-amber-100', value: 'text-amber-700', bar: 'from-amber-400 to-amber-600' },
  rose: { tile: 'from-rose-400 to-rose-600 shadow-rose-200', glow: 'bg-rose-100', value: 'text-rose-700', bar: 'from-rose-400 to-rose-600' },
  blue: { tile: 'from-blue-400 to-blue-600 shadow-blue-200', glow: 'bg-blue-100', value: 'text-blue-800', bar: 'from-blue-400 to-blue-600' },
  slate: { tile: 'from-slate-400 to-slate-600 shadow-slate-200', glow: 'bg-slate-100', value: 'text-slate-900', bar: 'from-slate-400 to-slate-600' },
};

export const KpiCard = ({ label, value, sub, icon: Icon, theme = 'slate', testid }) => {
  const t = THEMES[theme] || THEMES.slate;
  return (
    <div className="group relative overflow-hidden bg-white rounded-2xl border border-gray-100 p-4 shadow-sm transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-md min-w-[140px]" data-testid={testid}>
      <span className={`pointer-events-none absolute -right-8 -top-8 w-24 h-24 rounded-full opacity-70 transition-transform duration-300 group-hover:scale-110 ${t.glow}`} />
      <span className={`absolute left-0 top-4 bottom-4 w-1 rounded-r-full bg-gradient-to-b ${t.bar}`} />
      <div className="relative flex items-start justify-between gap-2">
        <span className="text-[13px] font-medium text-gray-500 leading-tight pl-1">{label}</span>
        {Icon && <span className={`shrink-0 w-9 h-9 rounded-xl bg-gradient-to-br ${t.tile} shadow-md flex items-center justify-center text-white`}><Icon size={18} strokeWidth={2.2} /></span>}
      </div>
      <p className={`relative text-2xl font-bold mt-1.5 pl-1 tracking-tight ${t.value}`}>{value}</p>
      {sub && <p className="relative text-[11px] text-gray-400 mt-0.5 pl-1 leading-snug">{sub}</p>}
    </div>
  );
};
