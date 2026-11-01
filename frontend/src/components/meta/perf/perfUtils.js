import api from "../../../services/api";
import { toast } from "sonner";

export const inr = (v) => (v == null ? "—" : `₹${Math.round(v).toLocaleString("en-IN")}`);
export const pct = (v) => (v == null ? "—" : `${v}%`);
export const num = (v) => (v == null ? "—" : v);

// Authenticated CSV download (exports go through the same permission-checked backend queries).
export const downloadCsv = async (url, params, filename) => {
  try {
    const { data } = await api.get(url, { params: { ...params, format: "csv" }, responseType: "blob" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(data);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  } catch { toast.error("Export failed"); }
};

export const rowsToCsv = (rows, cols, filename) => {
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const body = [cols.map((c) => esc(c[1])).join(","), ...rows.map((r) => cols.map((c) => esc(typeof c[2] === "function" ? c[2](r) : r[c[0]])).join(","))].join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([body], { type: "text/csv" }));
  a.download = filename;
  a.click();
};

export const useFilterOptions = () => {
  const load = async () => {
    const out = { partners: [], processors: [], loanTypes: [] };
    await Promise.all([
      api.get("/meta/partners").then(({ data }) => { out.partners = data; }).catch(() => {}),
      api.get("/meta/processors").then(({ data }) => { out.processors = data; }).catch(() => {}),
      api.get("/meta/files/filter-options").then(({ data }) => { out.loanTypes = data.loan_types || []; }).catch(() => {}),
    ]);
    return out;
  };
  return load;
};

export const Sel = ({ value, onChange, children, testid, className = "" }) => (
  <select data-testid={testid} value={value} onChange={(e) => onChange(e.target.value)} className={`border border-slate-200 rounded-md px-2 py-1.5 text-xs bg-white ${className}`}>{children}</select>
);
