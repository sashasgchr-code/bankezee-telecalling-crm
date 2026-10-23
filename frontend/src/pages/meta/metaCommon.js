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
  "FI Negative", "FI Reinitiated", "Query", "Hold", "Customer Not Interested - Need Help from MIT & Manager",
  "Customer Not Supporting - Need Help from MIT & Manager", "Approved", "Disbursed", "Not Eligible",
  "Not Login", "Declined", "Not Disbursed",
];

// Statuses that require a mandatory follow-up (description/reason + follow-up date).
export const FOLLOWUP_STATUSES = ["Query", "Hold"];
export const isFollowupStatus = (s) => s === "Query" || s === "Hold";
// Legacy combined status is preserved in data but shown with a "(Legacy)" tag and never offered.
export const procStatusLabel = (s) => (s === "Query/Hold" ? "Query/Hold (Legacy)" : (s || ""));

// IST-based urgency derived from a follow-up date (YYYY-MM-DD).
export const followupDays = (dateStr) => {
  if (!dateStr) return null;
  const d = new Date(String(dateStr).slice(0, 10) + "T00:00:00+05:30");
  if (isNaN(d.getTime())) return null;
  const nowIst = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const today = new Date(nowIst.getFullYear(), nowIst.getMonth(), nowIst.getDate());
  return Math.round((d - today) / 86400000);
};
export const followupUrgency = (days) => {
  if (days === null || days === undefined) return "none";
  if (days < 0) return "overdue";
  if (days === 0) return "due_today";
  if (days === 1) return "due_tomorrow";
  if (days <= 3) return "upcoming";
  return "later";
};
export const URGENCY_META = {
  overdue: { label: "Overdue", cls: "bg-red-50 text-red-700 border-red-200", dot: "#dc2626" },
  due_today: { label: "Due Today", cls: "bg-orange-50 text-orange-700 border-orange-200", dot: "#ea580c" },
  due_tomorrow: { label: "Due Tomorrow", cls: "bg-amber-50 text-amber-700 border-amber-200", dot: "#d97706" },
  upcoming: { label: "Upcoming", cls: "bg-blue-50 text-blue-700 border-blue-200", dot: "#2563eb" },
  later: { label: "Scheduled", cls: "bg-slate-100 text-slate-600 border-slate-200", dot: "#64748b" },
  none: { label: "No Date", cls: "bg-slate-100 text-slate-500 border-slate-200", dot: "#94a3b8" },
};
export const followupDaysLabel = (days) => {
  if (days === null || days === undefined) return "No follow-up date";
  if (days < 0) return `${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} overdue`;
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  return `${days} days remaining`;
};

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
