import React, { useMemo, useState } from "react";
import { ChevronUp, ChevronDown, Search } from "lucide-react";

export const C = {
  navy: "#081B3A", blue: "#155EEF", emerald: "#00A86B", gold: "#F4B400", purple: "#7C3AED",
  orange: "#F59E0B", red: "#DC2626", bg: "#F8FAFC",
};

export const inrFull = (n) => `₹${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;
export const inrShort = (n) => {
  const v = Number(n) || 0;
  if (v >= 1e7) return `₹${(v / 1e7).toFixed(2)} Cr`;
  if (v >= 1e5) return `₹${(v / 1e5).toFixed(2)} L`;
  return inrFull(v);
};
export const days = (v) => (v === null || v === undefined ? "—" : `${v} d`);

export const Section = ({ title, icon: Icon, color = C.navy, right, children, testid }) => (
  <section className="bg-white border border-slate-200 rounded-xl shadow-sm" data-testid={testid}>
    <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-100">
      <h2 className="text-sm font-bold flex items-center gap-2" style={{ color }}>{Icon && <Icon size={16} />}{title}</h2>
      {right}
    </div>
    <div className="p-4">{children}</div>
  </section>
);

export const KpiCard = ({ label, value, sub, icon: Icon, color, tint, onClick, testid, big }) => (
  <button type="button" onClick={onClick} data-testid={testid}
    className="text-left rounded-xl border p-3 transition-[transform,box-shadow] duration-150 hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-offset-1"
    style={{ background: tint, borderColor: `${color}33` }}>
    <div className="flex items-center justify-between gap-2">
      <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color }}>{label}</span>
      <span className="h-7 w-7 rounded-lg flex items-center justify-center text-white shrink-0" style={{ background: color }}><Icon size={14} /></span>
    </div>
    <p className={`${big ? "text-2xl" : "text-xl"} font-extrabold mt-1.5 tabular-nums`} style={{ color: C.navy }} data-testid={`${testid}-value`}>{value}</p>
    {sub && <p className="text-[11px] text-slate-500 mt-0.5 truncate">{sub}</p>}
  </button>
);

export const ConvPill = ({ label, value, n, testid }) => (
  <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-full pl-3 pr-1 py-1" data-testid={testid} title={n}>
    <span className="text-[11px] text-slate-500 font-medium">{label}</span>
    <span className="text-xs font-bold px-2 py-0.5 rounded-full text-white" style={{ background: C.blue }}>{value === null || value === undefined ? "—" : `${value}%`}</span>
  </div>
);

// Generic compact sortable table with search + total row. `cols`: [{k, h, num, fmt, click}]
export const SortTable = ({ rows, cols, totals, searchKey, searchPlaceholder, testid, rowKey = "id", maxH = "max-h-[420px]" }) => {
  const [sort, setSort] = useState({ k: cols[1]?.k, dir: "desc" });
  const [q, setQ] = useState("");
  const view = useMemo(() => {
    let r = rows || [];
    if (searchKey && q) r = r.filter((x) => String(x[searchKey] || "").toLowerCase().includes(q.toLowerCase()));
    const k = sort.k;
    return [...r].sort((a, b) => {
      const av = a[k] ?? -Infinity; const bv = b[k] ?? -Infinity;
      const c = typeof av === "string" || typeof bv === "string" ? String(av).localeCompare(String(bv)) : av - bv;
      return sort.dir === "asc" ? c : -c;
    });
  }, [rows, q, sort, searchKey]);
  const toggle = (k) => setSort((s) => ({ k, dir: s.k === k && s.dir === "desc" ? "asc" : "desc" }));
  return (
    <div data-testid={testid}>
      {searchKey && (
        <div className="relative mb-3 max-w-xs">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input data-testid={`${testid}-search`} value={q} onChange={(e) => setQ(e.target.value)} placeholder={searchPlaceholder}
            className="w-full pl-8 pr-3 py-1.5 text-sm border border-slate-300 rounded-md outline-none focus:border-blue-500" />
        </div>
      )}
      <div className={`overflow-auto ${maxH} border border-slate-100 rounded-lg`}>
        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0 z-10 bg-slate-50">
            <tr>
              {cols.map((c) => (
                <th key={c.k} onClick={() => toggle(c.k)} data-testid={`${testid}-sort-${c.k}`}
                  className={`px-2.5 py-2 font-semibold uppercase tracking-wide text-[10px] text-slate-500 whitespace-nowrap cursor-pointer select-none hover:text-slate-800 ${c.num ? "text-right" : "text-left"}`}>
                  <span className="inline-flex items-center gap-0.5">{c.h}{sort.k === c.k && (sort.dir === "asc" ? <ChevronUp size={11} /> : <ChevronDown size={11} />)}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.length === 0 && <tr><td colSpan={cols.length} className="px-3 py-6 text-center text-slate-400">No records for these filters.</td></tr>}
            {view.map((r) => (
              <tr key={r[rowKey]} className="border-t border-slate-100 hover:bg-slate-50/70" data-testid={`${testid}-row-${r[rowKey]}`}>
                {cols.map((c) => <Td key={c.k} c={c} r={r} />)}
              </tr>
            ))}
          </tbody>
          {totals && (
            <tfoot className="sticky bottom-0 bg-slate-100 font-bold">
              <tr data-testid={`${testid}-total`}>{cols.map((c) => <td key={c.k} className={`px-2.5 py-2 whitespace-nowrap ${c.num ? "text-right tabular-nums" : ""}`}>{c.k === cols[0].k ? "Total" : (c.fmt ? c.fmt(totals[c.k]) : totals[c.k] ?? "")}</td>)}</tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
};

const Td = ({ c, r }) => {
  const v = r[c.k];
  const txt = c.fmt ? c.fmt(v, r) : (v ?? "—");
  const clickable = c.click && v;
  return (
    <td className={`px-2.5 py-1.5 whitespace-nowrap ${c.num ? "text-right tabular-nums" : "font-medium text-slate-800"} ${c.cls ? c.cls(r) : ""}`}>
      {clickable ? <button type="button" onClick={() => c.click(r)} className="font-semibold hover:underline" style={{ color: C.blue }}>{txt}</button> : txt}
    </td>
  );
};

export const sumRows = (rows, keys) => keys.reduce((acc, k) => ({ ...acc, [k]: (rows || []).reduce((s, r) => s + (Number(r[k]) || 0), 0) }), {});
