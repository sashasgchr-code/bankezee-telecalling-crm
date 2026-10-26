import React, { useEffect, useState } from "react";
import api from "../../services/api";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { B, inr, fmtDate, fmtDob, fmtDT, ConsentBadge, StatusBadge, Field, inputCls, btn, errMsg, parseDobInput } from "./ccShared";

const DobEditor = ({ cust, onSaved }) => {
  const [text, setText] = useState(cust.dob ? fmtDob(cust.dob) : "");
  const [saving, setSaving] = useState(false);
  const save = async (overwrite = false) => {
    const v = text.trim() ? parseDobInput(text) : "";
    if (v === null) return toast.error("Enter a valid date as DD-MM-YYYY, or DD-MM if the year is unknown");
    setSaving(true);
    try {
      const { data } = await api.patch(`/cc/customers/${cust.customer_id}`, { dob: v, overwrite_dob: overwrite });
      toast.success("Date of birth saved"); onSaved(data);
    } catch (e) {
      if (e?.response?.status === 409 && window.confirm("This customer already has a date of birth. Overwrite it?")) { setSaving(false); return save(true); }
      toast.error(errMsg(e));
    } finally { setSaving(false); }
  };
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field label="Date of birth (DD-MM-YYYY or DD-MM)">
        <div className="flex gap-1.5">
          <input data-testid="cc-dob-input" value={text} onChange={(e) => setText(e.target.value)} placeholder="DD-MM-YYYY" className={`${inputCls} w-36`} />
          <input data-testid="cc-dob-picker" type="date" max={new Date().toISOString().slice(0, 10)} aria-label="Pick date"
            onChange={(e) => e.target.value && setText(fmtDate(e.target.value))} className={`${inputCls} w-10 px-1 cursor-pointer`} />
        </div>
      </Field>
      <button type="button" data-testid="cc-dob-save" disabled={saving} onClick={() => save()} className={btn("primary")}>Save</button>
    </div>
  );
};

const ConsentEditor = ({ cust, onSaved }) => {
  const c = cust.consent || {};
  const [f, setF] = useState({ consent_status: c.status || "unknown", consent_date: c.consent_date || "", consent_source: c.source || "", consent_reference: c.reference || "", opt_out_reason: "" });
  const save = async () => {
    try { const { data } = await api.patch(`/cc/customers/${cust.customer_id}`, f); toast.success("Communication preference saved"); onSaved(data); }
    catch (e) { toast.error(errMsg(e)); }
  };
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 items-end min-w-0 [&_input]:w-full [&_select]:w-full">
      <Field label="Marketing opt-in">
        <select data-testid="cc-consent-status" value={f.consent_status} onChange={(e) => setF({ ...f, consent_status: e.target.value })} className={inputCls}>
          <option value="unknown">Unknown</option><option value="opted_in">Opted In (verified)</option><option value="opted_out">Opted Out</option>
        </select>
      </Field>
      {f.consent_status === "opted_in" && <>
        <Field label="Consent date"><input data-testid="cc-consent-date" type="date" value={f.consent_date} onChange={(e) => setF({ ...f, consent_date: e.target.value })} className={inputCls} /></Field>
        <Field label="Consent source"><input data-testid="cc-consent-source" value={f.consent_source} onChange={(e) => setF({ ...f, consent_source: e.target.value })} placeholder="e.g. Signed form, recorded call" className={inputCls} /></Field>
        <Field label="Evidence / reference"><input data-testid="cc-consent-ref" value={f.consent_reference} onChange={(e) => setF({ ...f, consent_reference: e.target.value })} className={inputCls} /></Field>
      </>}
      {f.consent_status === "opted_out" && <Field label="Opt-out reason"><input data-testid="cc-optout-reason" value={f.opt_out_reason} onChange={(e) => setF({ ...f, opt_out_reason: e.target.value })} className={inputCls} /></Field>}
      <button type="button" data-testid="cc-consent-save" onClick={save} className={btn("dark")}>Save preference</button>
    </div>
  );
};

export const CustomerDialog = ({ id, me, onClose, onChanged }) => {
  const [c, setC] = useState(null);
  useEffect(() => { if (id) api.get(`/cc/customers/${id}`).then(({ data }) => setC(data)).catch((e) => toast.error(errMsg(e))); else setC(null); }, [id]);
  const saved = (d) => { setC((p) => ({ ...p, ...d })); onChanged?.(); };
  const cons = c?.consent || {};
  return (
    <Dialog open={!!id} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-5xl w-[95vw] max-h-[90vh] overflow-y-auto overflow-x-hidden" data-testid="cc-customer-dialog">
        <DialogHeader><DialogTitle style={{ color: B.navy }}>{c?.name || "Customer"}</DialogTitle></DialogHeader>
        {!c ? <p className="text-sm text-slate-500">Loading…</p> : (
          <div className="space-y-5 text-sm">
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-slate-600">
              <span>Mobile: <b data-testid="cc-detail-phone">{c.phone || "—"}</b></span>
              <span>DOB: <b data-testid="cc-detail-dob">{fmtDob(c.dob)}</b></span>
              <span>Consent: <ConsentBadge status={cons.status} testid="cc-detail-consent" /></span>
              <span className="text-[11px] text-slate-400">ID {c.customer_id}</span>
            </div>
            {(c.dob_added_by || c.dob_updated_by) && (
              <p className="text-[11px] text-slate-500" data-testid="cc-dob-audit">DOB added by {c.dob_added_by || "—"} on {fmtDT(c.dob_added_at)} · last updated by {c.dob_updated_by || "—"} on {fmtDT(c.dob_updated_at)}</p>
            )}
            {me.can_edit && <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-3"><DobEditor cust={c} onSaved={saved} /><ConsentEditor cust={c} onSaved={saved} /></div>}
            {cons.status && cons.status !== "unknown" && (
              <p className="text-[11px] text-slate-500">Consent {cons.status === "opted_out" ? `opted out ${fmtDT(cons.opt_out_date)} — ${cons.opt_out_reason || ""}` : `recorded ${cons.consent_date || ""} via ${cons.source || "—"} (${cons.reference || "no reference"})`} · by {cons.updated_by || "—"}</p>
            )}
            <div>
              <h4 className="font-bold mb-2" style={{ color: B.navy }}>Loans ({c.loans?.length})</h4>
              <LoanTable loans={c.loans} />
            </div>
            <div>
              <h4 className="font-bold mb-2" style={{ color: B.navy }}>WhatsApp History</h4>
              {c.history?.length ? (
                <div className="overflow-x-auto border border-slate-200 rounded-lg"><table className="w-full text-xs" data-testid="cc-wa-history">
                  <thead className="bg-slate-50"><tr>{["Campaign", "Template", "Category", "Date", "Status", "Read", "Reply", "Failure reason"].map((h) => <th key={h} className="text-left px-2.5 py-2 text-[10px] uppercase text-slate-500">{h}</th>)}</tr></thead>
                  <tbody>{c.history.map((h, i) => (
                    <tr key={i} className="border-t border-slate-100">
                      <td className="px-2.5 py-1.5">{h.campaign_name || "—"}</td><td className="px-2.5 py-1.5">{h.template}</td><td className="px-2.5 py-1.5">{h.category || "—"}</td>
                      <td className="px-2.5 py-1.5 whitespace-nowrap">{fmtDT(h.submitted_at || h.processed_at || h.created_at)}</td>
                      <td className="px-2.5 py-1.5"><StatusBadge s={h.status} /></td><td className="px-2.5 py-1.5">{h.read_at ? fmtDT(h.read_at) : h.status === "read" ? "Yes" : "—"}</td>
                      <td className="px-2.5 py-1.5">{h.replied ? `Yes — ${h.reply_text || ""}` : "—"}</td><td className="px-2.5 py-1.5 text-red-600">{h.error || ""}</td>
                    </tr>))}</tbody>
                </table></div>
              ) : <p className="text-xs text-slate-400">No WhatsApp messages yet.</p>}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export const LoanTable = ({ loans }) => (
  <div className="overflow-x-auto max-w-full border border-slate-200 rounded-lg">
    <table className="w-full text-xs" data-testid="cc-loan-table">
      <thead className="bg-slate-50"><tr>{["File", "Loan Type", "Bank/NBFC", "Status", "Approval Date", "Approved Amt", "Disbursement Date", "Disbursed Amt", "Growth Partner", "Processor"].map((h) => <th key={h} className="text-left px-2.5 py-2 text-[10px] uppercase text-slate-500 whitespace-nowrap">{h}</th>)}</tr></thead>
      <tbody>{(loans || []).map((l) => (
        <tr key={l.loan_key} className="border-t border-slate-100" data-testid={`cc-loan-${l.loan_key}`}>
          <td className="px-2.5 py-1.5 font-mono text-[10px] text-slate-500">{l.source === "meta" ? "Meta" : "Connect"} · {l.file_id.slice(0, 13)}</td>
          <td className="px-2.5 py-1.5">{l.loan_type || "—"}</td><td className="px-2.5 py-1.5">{l.bank || "—"}</td>
          <td className="px-2.5 py-1.5"><span className={`font-semibold ${l.status === "Disbursed" ? "text-emerald-700" : "text-blue-700"}`}>{l.status}</span></td>
          <td className="px-2.5 py-1.5 whitespace-nowrap" title={l.approval_date_source ? `From ${l.approval_date_source}` : "Not recorded"}>{fmtDate(l.approval_date)}</td>
          <td className="px-2.5 py-1.5 tabular-nums">{inr(l.approved_amount)}</td>
          <td className="px-2.5 py-1.5 whitespace-nowrap">{fmtDate(l.disbursement_date)}</td>
          <td className="px-2.5 py-1.5 tabular-nums">{inr(l.disbursed_amount)}</td>
          <td className="px-2.5 py-1.5">{l.gp_name || "—"}</td><td className="px-2.5 py-1.5">{l.processor_name || "—"}</td>
        </tr>))}</tbody>
    </table>
  </div>
);
