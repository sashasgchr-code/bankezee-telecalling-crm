import React from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from "recharts";
import {
  Users2, UserPlus, FolderOpen, Loader, XCircle, UserX, LogIn, CheckCircle2, IndianRupee, Ban, BadgeCheck, Wallet,
  CircleDot, FileClock, FileCheck2, Send, Gavel, PauseCircle, HelpCircle, AlertTriangle, Eye, Clock, Timer, Hourglass, Layers,
} from "lucide-react";
import { C, KpiCard, ConvPill, Section, SortTable, inrShort, inrFull, days, sumRows } from "./ReportWidgets";

export const KpiRows = ({ k, go }) => (
  <div className="space-y-3" data-testid="reports-kpis">
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
      <KpiCard testid="kpi-total-leads" label="Total Leads" value={k.leads} icon={Users2} color={C.blue} tint="#EEF4FF" onClick={() => go.leads({})} />
      <KpiCard testid="kpi-new-leads" label="New Leads" value={k.new_leads} icon={UserPlus} color="#0EA5E9" tint="#F0F9FF" onClick={() => go.leads({ status: "NEW" })} />
      <KpiCard testid="kpi-total-files" label="Total Files" value={k.files} icon={FolderOpen} color={C.purple} tint="#F5F3FF" onClick={() => go.files({})} />
      <KpiCard testid="kpi-in-progress" label="Files In Progress" value={k.files_in_progress} icon={Loader} color={C.orange} tint="#FFFBEB" onClick={() => go.files({ tat: "ongoing" })} />
      <KpiCard testid="kpi-not-eligible" label="Not Eligible" value={k.not_eligible} icon={XCircle} color={C.red} tint="#FEF2F2" onClick={() => go.files({ status: "Not Eligible" })} />
      <KpiCard testid="kpi-unassigned" label="Unassigned" value={`${k.unassigned_leads} / ${k.unassigned_files}`} sub="Leads (no GP) / Files (no processor)" icon={UserX} color="#64748B" tint="#F1F5F9" onClick={() => go.leads({ partnerFilter: "UNASSIGNED" })} />
    </div>
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
      <KpiCard big testid="kpi-logins" label="Logins" value={k.logins} icon={LogIn} color="#4F46E5" tint="#EEF2FF" onClick={() => go.files({ status: "Login Done" })} />
      <KpiCard big testid="kpi-approved" label="Approved" value={k.approved} icon={CheckCircle2} color="#16A34A" tint="#F0FDF4" onClick={() => go.files({ status: "Approved" })} />
      <KpiCard big testid="kpi-approved-amount" label="Approved Amount" value={inrShort(k.approved_amount)} sub={inrFull(k.approved_amount)} icon={IndianRupee} color="#0D9488" tint="#F0FDFA" onClick={() => go.files({ status: "Approved" })} />
      <KpiCard big testid="kpi-declined" label="Declined" value={k.declined} icon={Ban} color={C.red} tint="#FEF2F2" onClick={() => go.files({ status: "Declined" })} />
      <KpiCard big testid="kpi-disbursed" label="Disbursed" value={k.disbursed} icon={BadgeCheck} color={C.emerald} tint="#ECFDF5" onClick={() => go.files({ status: "Disbursed" })} />
      <KpiCard big testid="kpi-disbursed-amount" label="Disbursed Amount" value={inrShort(k.disbursed_amount)} sub={inrFull(k.disbursed_amount)} icon={Wallet} color="#B8860B" tint="#FFFBEA" onClick={() => go.files({ status: "Disbursed" })} />
    </div>
    <div className="flex flex-wrap gap-2" data-testid="reports-conversions">
      <ConvPill testid="conv-lead-file" label="Lead → File" value={k.conv_lead_file} n={`${k.conv_lead_file_n?.[0]} of ${k.conv_lead_file_n?.[1]} leads became files`} />
      <ConvPill testid="conv-file-login" label="File → Login" value={k.conv_file_login} n="Logged-in files ÷ files (cohort basis only)" />
      <ConvPill testid="conv-login-approval" label="Login → Approval" value={k.conv_login_approval} n="Approved ÷ logins" />
      <ConvPill testid="conv-approval-disbursal" label="Approval → Disbursement" value={k.conv_approval_disbursal} n="Disbursed ÷ approved" />
    </div>
  </div>
);

const STATUS_STYLE = (s) => {
  if (["Disbursed", "Approved"].includes(s)) return [C.emerald, BadgeCheck];
  if (["Not Eligible", "Declined", "Not Login", "Not Disbursed", "FI Negative"].includes(s) || s.startsWith("Customer Not")) return [C.red, XCircle];
  if (["Hold", "Query", "Query/Hold"].includes(s)) return [C.orange, s === "Hold" ? PauseCircle : HelpCircle];
  if (["Sent for Approval", "Underwriting", "FI (Field Investigation)", "FI Reinitiated"].includes(s)) return [C.purple, Gavel];
  if (["Sent for Login", "Login Done", "Sent for Eligibility"].includes(s)) return [C.blue, Send];
  if (["Documents Pending"].includes(s)) return [C.gold, FileClock];
  if (["Documents Collected"].includes(s)) return ["#0D9488", FileCheck2];
  return ["#64748B", CircleDot];
};

export const Pipeline = ({ rows, total, go }) => (
  <Section testid="reports-pipeline" title="File Pipeline – Current Status" icon={Layers} right={<span className="text-xs text-slate-500">Each file counted once · <b data-testid="pipeline-total">{total}</b> files</span>}>
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2">
      {rows.map((p) => {
        const [color, Icon] = STATUS_STYLE(p.status);
        return (
          <button key={p.status} type="button" onClick={() => go.files({ status: p.status })} data-testid={`pipeline-${p.status}`}
            className={`text-left rounded-lg border px-2.5 py-2 transition-colors hover:bg-slate-50 ${p.count ? "" : "opacity-60"}`} style={{ borderColor: `${color}40` }}>
            <div className="flex items-center gap-1.5"><Icon size={13} style={{ color }} className="shrink-0" /><span className="text-[11px] font-medium text-slate-600 leading-tight line-clamp-2">{p.status}</span></div>
            <div className="flex items-baseline justify-between mt-1"><span className="text-lg font-extrabold tabular-nums" style={{ color: C.navy }}>{p.count}</span><span className="text-[10px] font-semibold" style={{ color }}>{p.pct}%</span></div>
          </button>
        );
      })}
    </div>
  </Section>
);

const n = (v) => v ?? 0;
const pctFmt = (v) => `${v ?? 0}%`;

export const GpTable = ({ rows, extraStatuses, go }) => {
  const f = (st) => (r) => go.files({ gp: r.id, ...st });
  const cols = [
    { k: "name", h: "Growth Partner" },
    { k: "leads", h: "Leads", num: true, click: (r) => go.leads({ partnerFilter: r.id }) },
    { k: "new_leads", h: "New Leads", num: true, click: (r) => go.leads({ partnerFilter: r.id, status: "NEW" }) },
    { k: "files", h: "Files", num: true, click: f({}) },
    { k: "docs_pending", h: "Docs Pending", num: true, click: f({ docs: "pending" }) },
    { k: "docs_received", h: "Docs Received", num: true, click: f({ docs: "received" }) },
    { k: "not_eligible", h: "Not Eligible", num: true, click: f({ status: "Not Eligible" }) },
    { k: "logins", h: "Logins", num: true, click: f({ status: "Login Done" }) },
    { k: "approved", h: "Approved", num: true, click: f({ status: "Approved" }) },
    { k: "declined", h: "Declined", num: true, click: f({ status: "Declined" }) },
    { k: "disbursed", h: "Disbursed", num: true, click: f({ status: "Disbursed" }) },
    { k: "disbursed_amount", h: "Disbursed Amt", num: true, fmt: inrFull },
    { k: "conversion", h: "Conversion %", num: true, fmt: pctFmt },
    ...extraStatuses.map((s) => ({ k: `st_${s}`, h: s, num: true, click: f({ status: s }) })),
  ];
  const data = rows.map((r) => ({ ...r, ...Object.fromEntries(extraStatuses.map((s) => [`st_${s}`, n(r.by_status?.[s])])) }));
  const tot = sumRows(data, cols.filter((c) => c.num).map((c) => c.k));
  tot.conversion = tot.leads ? Math.round((tot.files * 1000) / tot.leads) / 10 : 0;
  return <SortTable testid="gp-table" rows={data} cols={cols} totals={tot} searchKey="name" searchPlaceholder="Search Growth Partner…" />;
};

export const ProcTable = ({ rows, go }) => {
  const f = (st) => (r) => go.files({ proc: r.id, ...st });
  const cols = [
    { k: "name", h: "Processor" },
    { k: "files", h: "Assigned Files", num: true, click: f({}) },
    { k: "active", h: "Open Now", num: true },
    { k: "docs_pending", h: "Docs Pending", num: true, click: f({ docs: "pending" }) },
    { k: "docs_received", h: "Docs Received", num: true, click: f({ docs: "received" }) },
    { k: "logins", h: "Login", num: true, click: f({ status: "Login Done" }) },
    { k: "approved", h: "Approved", num: true, click: f({ status: "Approved" }) },
    { k: "declined", h: "Declined", num: true, click: f({ status: "Declined" }) },
    { k: "disbursed", h: "Disbursed", num: true, click: f({ status: "Disbursed" }) },
    { k: "approved_amount", h: "Approved Amt", num: true, fmt: inrFull },
    { k: "disbursed_amount", h: "Disbursed Amt", num: true, fmt: inrFull },
    { k: "avg_tat_days", h: "Avg TAT", num: true, fmt: days },
    { k: "overdue", h: "Overdue Files", num: true, click: f({ tat: "exceeded" }), cls: (r) => (r.overdue ? "bg-red-50 text-red-700 font-bold" : "") },
  ];
  const tot = sumRows(rows, cols.filter((c) => c.num && c.k !== "avg_tat_days").map((c) => c.k));
  tot.avg_tat_days = null;
  return <SortTable testid="proc-table" rows={rows} cols={cols} totals={tot} searchKey="name" searchPlaceholder="Search processor…" />;
};

const BUCKET_COLORS = { "0-1": "#16A34A", "2": "#84CC16", "3": "#EAB308", "4": "#F59E0B", "5-7": "#DC2626", "8-14": "#991B1B", "15+": "#5B0E14" };

const Stat = ({ label, value, sub, color = C.navy, icon: Icon = Clock, testid }) => (
  <div className="rounded-lg border border-slate-200 px-3 py-2.5" data-testid={testid}>
    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-1"><Icon size={11} />{label}</p>
    <p className="text-lg font-extrabold tabular-nums mt-0.5" style={{ color }}>{value}</p>
    {sub && <p className="text-[10px] text-slate-400">{sub}</p>}
  </div>
);

export const TatSection = ({ t, go }) => (
  <Section testid="reports-tat" title="File Processing TAT & SLA Monitoring" icon={Timer} right={<span className="text-[11px] text-slate-500">Working days · Sundays excluded · SLA 4 working days · open-file figures cover all open files (date range not applied)</span>}>
    <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-2 mb-4">
      <Stat testid="tat-avg-open" label="Avg Open TAT" value={days(t.avg_open_days)} sub={`${t.active_files} open files`} />
      <Stat testid="tat-median-open" label="Median Open TAT" value={days(t.median_open_days)} />
      <Stat testid="tat-file-login" label="File → Login" value={days(t.file_to_login.avg_days)} sub={`${t.file_to_login.n} files with timestamps`} icon={Hourglass} />
      <Stat testid="tat-login-approval" label="Login → Approval" value={days(t.login_to_approval.avg_days)} sub={`${t.login_to_approval.n} files with timestamps`} icon={Hourglass} />
      <Stat testid="tat-approval-disb" label="Approval → Disb." value={days(t.approval_to_disbursal.avg_days)} sub={`${t.approval_to_disbursal.n} files with timestamps`} icon={Hourglass} />
      <Stat testid="tat-within" label="Within SLA" value={t.within_sla} color={C.emerald} icon={CheckCircle2} />
      <Stat testid="tat-exceeding" label="Exceeding SLA" value={t.exceeding_sla} color={C.red} icon={AlertTriangle} />
      <Stat testid="tat-oldest" label="Oldest Active" value={days(t.oldest_open_days)} color={C.red} />
    </div>
    <p className="text-[11px] font-semibold text-slate-500 mb-2">Ageing of open files (working days)</p>
    <div className="grid grid-cols-4 md:grid-cols-7 gap-2">
      {t.buckets.map((b) => (
        <button key={b.label} type="button" data-testid={`tat-bucket-${b.label}`} onClick={() => go.files({ tat: ["0-1", "2", "3"].includes(b.label) ? "within" : "exceeded" })}
          className="rounded-lg px-2 py-2 text-white text-left transition-transform hover:-translate-y-0.5" style={{ background: BUCKET_COLORS[b.label] }}>
          <p className="text-[10px] font-semibold opacity-90">{b.label} days</p>
          <p className="text-xl font-extrabold tabular-nums leading-tight">{b.count}</p>
          <p className="text-[10px] opacity-90">{b.pct}%</p>
        </button>
      ))}
    </div>
  </Section>
);

export const OverdueTable = ({ rows, go, onExport }) => (
  <section className="bg-white border-2 border-red-300 rounded-xl shadow-sm" data-testid="reports-overdue">
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-red-50 rounded-t-xl border-b border-red-200">
      <h2 className="text-sm font-bold flex items-center gap-2 text-red-700"><AlertTriangle size={18} /> Files Exceeding 4 Working Days
        <span className="ml-1 text-base px-2.5 py-0.5 rounded-full bg-red-600 text-white font-extrabold tabular-nums" data-testid="overdue-count">{rows.length}</span>
        <span className="text-[11px] font-medium text-red-600/80">All currently open files · date range not applied</span>
      </h2>
      <button type="button" data-testid="overdue-export" onClick={onExport} className="text-xs font-semibold text-red-700 border border-red-300 rounded-md px-3 py-1.5 hover:bg-red-100 transition-colors">Export CSV</button>
    </div>
    {rows.length === 0 ? <p className="p-5 text-sm text-slate-500" data-testid="overdue-allclear">No files exceeding the 4-working-day TAT for these filters.</p> : (
      <div className="overflow-auto max-h-[440px]">
        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0 bg-slate-50 z-10"><tr>
            {["Customer", "File ID", "GP", "Processor", "Loan Type", "Created", "Current Status", "Current TAT", "Days Overdue", ""].map((h) => <th key={h} className="px-2.5 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap">{h}</th>)}
          </tr></thead>
          <tbody>
            {rows.map((r) => {
              const severe = r.overdue_days >= 4;
              return (
                <tr key={r.lead_id} data-testid={`overdue-row-${r.lead_id}`} className={`border-t border-slate-100 ${severe ? "bg-red-50/70" : "bg-orange-50/50"}`}>
                  <td className="px-2.5 py-1.5 font-semibold text-slate-800 whitespace-nowrap">{r.full_name || "—"}</td>
                  <td className="px-2.5 py-1.5 font-mono text-[10px] text-slate-400">{r.lead_id}</td>
                  <td className="px-2.5 py-1.5 whitespace-nowrap">{r.partner || "—"}</td>
                  <td className="px-2.5 py-1.5 whitespace-nowrap">{r.processor || "—"}</td>
                  <td className="px-2.5 py-1.5 whitespace-nowrap">{r.loan_type || "—"}</td>
                  <td className="px-2.5 py-1.5 whitespace-nowrap">{r.created ? new Date(r.created).toLocaleDateString("en-IN") : "—"}</td>
                  <td className="px-2.5 py-1.5 whitespace-nowrap">{r.status}</td>
                  <td className={`px-2.5 py-1.5 font-bold whitespace-nowrap ${severe ? "text-red-700" : "text-orange-600"}`}>{r.tat_days}d {r.tat_hours}h</td>
                  <td className={`px-2.5 py-1.5 font-bold tabular-nums ${severe ? "text-red-700" : "text-orange-600"}`}>{r.overdue_days} d</td>
                  <td className="px-2.5 py-1.5"><button type="button" data-testid={`overdue-view-${r.lead_id}`} onClick={() => go.file(r.lead_id)} className="inline-flex items-center gap-1 text-xs font-semibold hover:underline" style={{ color: C.blue }}><Eye size={13} /> View File</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    )}
  </section>
);

export const LoanTypes = ({ rows, go }) => {
  const cols = [
    { k: "loan_type", h: "Loan Type" },
    { k: "leads", h: "Leads", num: true },
    { k: "files", h: "Files", num: true, click: (r) => r.key && go.files({ loan: r.loan_type }) },
    { k: "logins", h: "Logins", num: true },
    { k: "approved", h: "Approved", num: true },
    { k: "approved_amount", h: "Approved Amt", num: true, fmt: inrFull },
    { k: "disbursed", h: "Disbursed", num: true },
    { k: "disbursed_amount", h: "Disbursed Amt", num: true, fmt: inrFull },
    { k: "conversion", h: "Conv %", num: true, fmt: pctFmt },
  ];
  const chart = rows.filter((r) => r.files).map((r) => ({ name: r.loan_type, Files: r.files, Logins: r.logins, Approved: r.approved, Disbursed: r.disbursed }));
  return (
    <Section testid="reports-loan-types" title="Loan Type Performance" icon={Layers}>
      <SortTable testid="loan-table" rows={rows} cols={cols} rowKey="loan_type" maxH="max-h-[240px]" />
      <div className="h-48 mt-3">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chart} margin={{ left: -20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#64748b" }} />
            <YAxis tick={{ fontSize: 10, fill: "#64748b" }} allowDecimals={false} />
            <Tooltip contentStyle={{ fontSize: 12, borderRadius: 6 }} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="Files" fill={C.purple} radius={[3, 3, 0, 0]} />
            <Bar dataKey="Logins" fill="#4F46E5" radius={[3, 3, 0, 0]} />
            <Bar dataKey="Approved" fill="#16A34A" radius={[3, 3, 0, 0]} />
            <Bar dataKey="Disbursed" fill={C.gold} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Section>
  );
};

export const Alerts = ({ a, go }) => {
  const items = [
    ["unassigned_leads", "Unassigned Leads", UserX, "#64748B", () => go.leads({ partnerFilter: "UNASSIGNED" })],
    ["unassigned_files", "Unassigned Files", FolderOpen, "#64748B", () => go.files({ proc: "UNASSIGNED" })],
    ["docs_pending_sla", "Docs Pending Beyond SLA", FileClock, C.gold, () => go.files({ docs: "pending", tat: "exceeded" })],
    ["on_hold", "Files On Hold / Query", PauseCircle, C.orange, () => go.files({ status: "Hold" })],
    ["awaiting_login", "Awaiting Login", LogIn, C.blue, () => go.files({ status: "Sent for Login" })],
    ["awaiting_approval", "Awaiting Approval", Gavel, C.purple, () => go.files({ status: "Sent for Approval" })],
    ["approved_not_disbursed", "Approved, Not Disbursed", CheckCircle2, "#0D9488", () => go.files({ status: "Approved" })],
    ["not_contacted", "Leads Not Contacted", Users2, "#0EA5E9", () => go.leads({ status: "NEW" })],
    ["tat_exceeded", "Files Exceeding 4-Day TAT", AlertTriangle, C.red, () => go.files({ tat: "exceeded" })],
  ];
  return (
    <Section testid="reports-alerts" title="Operational Attention" icon={AlertTriangle} color={C.red}>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {items.map(([k, label, Icon, color, onClick]) => (
          <button key={k} type="button" onClick={onClick} data-testid={`alert-${k}`}
            className="text-left rounded-lg border px-3 py-2 hover:bg-slate-50 transition-colors" style={{ borderColor: a[k] ? `${color}66` : "#e2e8f0" }}>
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-600"><Icon size={13} style={{ color }} />{label}</div>
            <p className="text-xl font-extrabold tabular-nums" style={{ color: a[k] ? color : "#94a3b8" }}>{a[k]}</p>
          </button>
        ))}
      </div>
      <p className="text-[10px] text-slate-400 mt-2">"On Hold" opens Hold files; Query files are counted here too. "Awaiting Approval" counts Login Done, Sent for Approval and Underwriting.</p>
    </Section>
  );
};
