import React from "react";

export const B = { navy: "#081B3A", blue: "#155EEF", emerald: "#00A86B", gold: "#F4B400", red: "#DC2626", bg: "#F8FAFC" };
export const inr = (n) => (n === null || n === undefined || n === "" ? "—" : `₹${Math.round(Number(n)).toLocaleString("en-IN")}`);
export const fmtDate = (d) => (d ? `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}` : "—");
export const fmtDob = (d) => (!d ? "—" : d.startsWith("--") ? `${d.slice(-2)}-${d.slice(-5, -3)}` : fmtDate(d));
export const fmtDT = (s) => (s ? new Date(s).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");

export const download = async (api, url, params, filename) => {
  const res = await api.get(url, { params, responseType: "blob" });
  const href = URL.createObjectURL(res.data);
  const a = document.createElement("a");
  a.href = href; a.download = filename; a.click(); URL.revokeObjectURL(href);
};

const CONSENT = { opted_in: ["Opted In", "bg-emerald-50 text-emerald-700 border-emerald-200"], opted_out: ["Opted Out", "bg-red-50 text-red-700 border-red-200"], unknown: ["Unknown", "bg-slate-100 text-slate-600 border-slate-200"] };
export const ConsentBadge = ({ status = "unknown", testid }) => {
  const [l, cls] = CONSENT[status] || CONSENT.unknown;
  return <span data-testid={testid} className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold border ${cls}`}>{l}</span>;
};

const MSG = {
  queued: "bg-slate-100 text-slate-600", sending: "bg-slate-100 text-slate-600", submitted: "bg-blue-50 text-blue-700", sent: "bg-blue-50 text-blue-700",
  delivered: "bg-emerald-50 text-emerald-700", read: "bg-emerald-100 text-emerald-800", failed: "bg-red-50 text-red-700", skipped: "bg-amber-50 text-amber-700",
  mock: "bg-violet-50 text-violet-700", draft: "bg-slate-100 text-slate-600", scheduled: "bg-blue-50 text-blue-700", running: "bg-amber-50 text-amber-700",
  paused: "bg-orange-50 text-orange-700", completed: "bg-emerald-50 text-emerald-700", cancelled: "bg-slate-200 text-slate-600",
};
const MSG_LABEL = { mock: "Mock (not sent)", submitted: "Accepted by Meta" };
export const StatusBadge = ({ s, testid }) => (
  <span data-testid={testid} className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold capitalize ${MSG[s] || "bg-slate-100 text-slate-600"}`}>{MSG_LABEL[s] || s || "—"}</span>
);

export const Kpi = ({ label, value, color = B.navy, sub, testid }) => (
  <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 shadow-sm" data-testid={testid}>
    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</p>
    <p className="text-xl font-extrabold tabular-nums mt-1" style={{ color }}>{value}</p>
    {sub && <p className="text-[11px] text-slate-400 mt-0.5">{sub}</p>}
  </div>
);

export const Field = ({ label, children }) => (
  <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}{children}</label>
);
export const inputCls = "border border-slate-300 rounded-md px-2.5 py-1.5 text-sm font-normal normal-case tracking-normal text-slate-800 bg-white outline-none focus:border-blue-500";
export const btn = (kind = "primary") => ({
  primary: "inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md text-sm font-semibold text-white bg-[#155EEF] hover:bg-[#0f4fd1] disabled:opacity-50 transition-colors",
  dark: "inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md text-sm font-semibold text-white bg-[#081B3A] hover:bg-[#0d2a57] disabled:opacity-50 transition-colors",
  green: "inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md text-sm font-semibold text-white bg-[#00A86B] hover:bg-[#00935e] disabled:opacity-50 transition-colors",
  ghost: "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors",
  danger: "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-semibold text-white bg-[#DC2626] hover:bg-red-700 disabled:opacity-50 transition-colors",
}[kind]);

export const errMsg = (e, fb = "Something went wrong") => {
  const d = e?.response?.data?.detail;
  if (Array.isArray(d)) return d.map((x) => x?.msg || String(x)).join("; ") || fb;
  return typeof d === "string" ? d : fb;
};

// DD-MM-YYYY or DD-MM text -> API value (YYYY-MM-DD | --MM-DD) ; null when invalid
export const parseDobInput = (v) => {
  const t = (v || "").trim();
  let m = t.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (m) {
    const [d, mo, y] = [+m[1], +m[2], +m[3]];
    const dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCDate() !== d || dt.getUTCMonth() !== mo - 1 || dt > new Date() || y < 1900) return null;
    return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  m = t.match(/^(\d{1,2})[-/](\d{1,2})$/);
  if (m) {
    const [d, mo] = [+m[1], +m[2]];
    const dt = new Date(Date.UTC(2000, mo - 1, d));
    if (dt.getUTCDate() !== d || dt.getUTCMonth() !== mo - 1) return null;
    return `--${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  return null;
};
