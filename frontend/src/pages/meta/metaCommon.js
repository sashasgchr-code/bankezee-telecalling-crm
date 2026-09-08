import React from "react";
import useAuthStore from "../../store/authStore";

export const BRAND = "#0F52BA";
export const BRAND_DARK = "#0A192F";

export const STATUS_STYLES = {
  NEW: "bg-slate-100 text-slate-700 border-slate-200",
  CALL_BACK: "bg-blue-50 text-blue-700 border-blue-200",
  NOT_ANSWERING: "bg-amber-50 text-amber-700 border-amber-200",
  SWITCHED_OFF: "bg-orange-50 text-orange-700 border-orange-200",
  NOT_INTERESTED: "bg-slate-100 text-slate-600 border-slate-200",
  NOT_QUALIFIED: "bg-red-50 text-red-700 border-red-200",
  LEAD: "bg-emerald-50 text-emerald-700 border-emerald-200",
  FILE: "bg-violet-50 text-violet-700 border-violet-200",
};

export const STATUS_LABEL = (s) => (s || "").replace(/_/g, " ");

export const StatusPill = ({ status }) => (
  <span
    data-testid="meta-status-pill"
    className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_STYLES[status] || STATUS_STYLES.NEW}`}
  >
    {STATUS_LABEL(status)}
  </span>
);

export const STATUSES = ["ALL", "NEW", "CALL_BACK", "NOT_ANSWERING", "SWITCHED_OFF", "NOT_INTERESTED", "NOT_QUALIFIED", "LEAD", "FILE"];
export const LEAD_STATUSES = ["NEW", "CALL_BACK", "NOT_ANSWERING", "SWITCHED_OFF", "NOT_INTERESTED", "NOT_QUALIFIED", "LEAD", "FILE"];

export const DISPOSITIONS = [
  { v: "NOT_ANSWERING", l: "Not Answering" }, { v: "SWITCHED_OFF", l: "Switched Off" },
  { v: "NOT_INTERESTED", l: "Not Interested" }, { v: "NOT_QUALIFIED", l: "Not Qualified" },
  { v: "CALL_BACK", l: "Call Back" }, { v: "LEAD", l: "Lead" }, { v: "FILE", l: "File (Convert)" },
];

export const PROC_STATUSES = [
  "New", "Contacted", "Documents Collected", "Documents Pending", "Sent for Eligibility",
  "Sent for Login", "Login Done", "Sent for Approval", "Underwriting", "FI (Field Investigation)",
  "FI Negative", "FI Reinitiated", "Query/Hold", "Customer Not Interested - Need Help from MIT & Manager",
  "Customer Not Supporting - Need Help from MIT & Manager", "Approved", "Disbursed", "Not Eligible",
  "Not Login", "Declined", "Not Disbursed",
];

export const inr = (n) => (n ? `₹${Number(n).toLocaleString("en-IN")}` : "—");
export const maskPhone = (p) => { const s = (p || "").replace(/\s/g, ""); return s ? "*****" + s.slice(-4) : "—"; };
export const fmtDur = (s) => `${Math.floor((s || 0) / 60)}m ${(s || 0) % 60}s`;

export const fmtDate = (v) => {
  if (!v) return "—";
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v).slice(0, 10);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};
export const fmtShort = (v) => {
  if (!v) return "";
  const d = new Date(v);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
};

// Resolve the Meta identity from the logged-in Connect user.
// meta_role -> screen/action gating; meta_user_id -> ownership & "assigned to me".
export const useMetaUser = () => {
  const { user } = useAuthStore();
  const role = (user?.meta_role || "").trim().toLowerCase();
  return {
    role,
    user_id: user?.meta_user_id,
    name: user?.name,
    picture: user?.picture,
    meta_access: !!user?.meta_access,
    connectRole: user?.role,
    isStaff: role === "admin" || role === "ops",
    isAdmin: role === "admin",
  };
};
