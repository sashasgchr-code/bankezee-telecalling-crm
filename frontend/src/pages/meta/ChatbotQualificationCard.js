import React, { useEffect, useState } from "react";
import api from "../../services/api";
import { toast } from "sonner";
import { BRAND, BRAND_DARK } from "./metaCommon";
import { Bot, Copy, RefreshCw, Eye, EyeOff, Link2, HelpCircle, PencilLine, Gauge, Loader2, MessageCircle } from "lucide-react";

const Stat = ({ label, value, accent }) => (
  <div>
    <p className="text-[11px] text-slate-400 uppercase tracking-wider">{label}</p>
    <p className={`text-sm font-medium break-words ${accent ? "text-emerald-700" : "text-slate-800"}`}>{value ?? "—"}</p>
  </div>
);

function ActionModal({ title, placeholder, onClose, onSubmit }) {
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    setSaving(true);
    try { await onSubmit(note); onClose(); } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); } finally { setSaving(false); }
  };
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => !saving && onClose()}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()} data-testid="chatbot-action-modal">
        <h3 className="text-base font-semibold mb-3" style={{ color: BRAND_DARK }}>{title}</h3>
        <textarea data-testid="chatbot-action-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder={placeholder} rows={4}
          className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm outline-none mb-4" autoFocus />
        <div className="flex justify-end gap-2">
          <button onClick={() => !saving && onClose()} className="border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-md px-4 py-2 text-sm font-medium">Cancel</button>
          <button data-testid="chatbot-action-submit" disabled={saving || !note.trim()} onClick={submit}
            className="text-white rounded-md px-4 py-2 text-sm font-medium flex items-center gap-2 disabled:opacity-60" style={{ background: BRAND }}>
            {saving && <Loader2 size={14} className="animate-spin" />} Send
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ChatbotQualificationCard({ lead, canEdit }) {
  const [prof, setProf] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [consent, setConsent] = useState(false);
  const [modal, setModal] = useState(null);
  const [wa, setWa] = useState(null);
  const leadId = lead.lead_id;

  const load = async () => {
    setLoading(true);
    try { const { data } = await api.get(`/meta/leads/${leadId}/chatbot`); setProf(data); }
    catch (e) { setProf({ exists: false }); } finally { setLoading(false); }
    try { const { data } = await api.get(`/meta/leads/${leadId}/whatsapp`); setWa(data); } catch (e) { /* noop */ }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [leadId]);

  const resendWhatsapp = async () => {
    setBusy("whatsapp");
    try { await api.post(`/meta/leads/${leadId}/whatsapp/resend`); toast.success("WhatsApp message sent"); load(); }
    catch (e) { toast.error(e?.response?.data?.detail?.message || e?.response?.data?.detail || "WhatsApp send failed"); }
    finally { setBusy(""); }
  };

  const errText = (e, fallback) => {
    const d = e?.response?.data?.detail;
    if (typeof d === "string") return d;
    if (d) return JSON.stringify(d);
    return e?.message || fallback;
  };

  const copyLink = async (renew = false) => {
    if (renew && !window.confirm("Issue a NEW secure link? The previous link will stop working.")) return;
    setBusy(renew ? "renew" : "copy");
    try {
      const { data } = await api.post(`/meta/leads/${leadId}/chatbot/link`, { renew, whatsapp_consent: consent });
      const link = data?.secure_link;
      if (!link) { toast.error("No link returned — try Renew Link"); return; }
      let copied = false;
      try {
        if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(link); copied = true; }
      } catch (_) { copied = false; }
      toast.success(copied
        ? (renew ? "New link created & copied" : "Chatbot link copied")
        : (renew ? "New link created" : "Chatbot link ready"),
        { description: copied ? undefined : "Use the View/Copy buttons below the title to copy it." });
      await load();
    } catch (e) { toast.error(errText(e, "Failed to get link")); }
    finally { setBusy(""); }
  };

  const refresh = async () => {
    setBusy("refresh");
    try { const { data } = await api.post(`/meta/leads/${leadId}/chatbot/refresh`); setProf(data); toast.success("Qualification refreshed"); }
    catch (e) { toast.error(errText(e, "Refresh failed")); }
    finally { setBusy(""); }
  };

  const sendAction = async (action, note) => {
    await api.post(`/meta/leads/${leadId}/chatbot/actions`, { action, note });
    toast.success("Recorded");
  };

  const applyToFile = async () => {
    setBusy("apply");
    try {
      const { data } = await api.post(`/meta/leads/${leadId}/chatbot/apply-to-file`);
      toast.success(`Synced to File — ${data.existing_loans_after} loan(s), EMI ₹${data.monthly_emi_obligations ?? "—"}`,
        { description: "Empty File fields filled from chatbot. Review in File Details." });
    } catch (e) { toast.error(errText(e, "Could not sync to File")); }
    finally { setBusy(""); }
  };

  const q = prof?.qualification || {};
  const loans = q.loans || [];
  const hasLink = !!prof?.secure_link;
  const progress = Number(q.progress || 0);
  const ratio = q.emi_to_salary_ratio;
  const stage = prof?.stage || "Not Started";
  const stageColor = {
    "Completed": "bg-emerald-100 text-emerald-700",
    "In Progress": "bg-amber-100 text-amber-700",
    "Expired": "bg-red-100 text-red-700",
    "Not Started": "bg-slate-100 text-slate-500",
  }[stage] || "bg-slate-100 text-slate-500";
  const answers = q.answers && typeof q.answers === "object" ? Object.entries(q.answers) : [];
  const fmtDate = (d) => (d ? new Date(d).toLocaleDateString() : "—");

  return (
    <div className="bg-white border border-blue-200 rounded-md p-5 shadow-sm" data-testid="chatbot-qualification-card">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h3 className="text-sm font-semibold flex items-center gap-2" style={{ color: BRAND_DARK }}>
          <Bot size={16} style={{ color: BRAND }} /> Customer Loan Qualification
          {prof?.exists && <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${stageColor}`} data-testid="chatbot-stage-badge">{stage}</span>}
        </h3>
        {prof?.exists && (
          <span className="text-xs text-slate-400">
            {q.questions_total ? `${q.questions_completed || 0} of ${q.questions_total} answered` : ""}
            {q.last_activity ? ` · last active ${new Date(q.last_activity).toLocaleString()}` : ""}
          </span>
        )}
      </div>

      {/* secure link row with View + Copy + dates */}
      {prof?.secure_link && (
        <div className="flex items-center justify-between gap-2 mb-4 rounded-md border border-slate-200 bg-slate-50/60 px-3 py-2 flex-wrap" data-testid="chatbot-link-row">
          <div className="flex items-center gap-2 text-xs text-slate-500 min-w-0">
            <Link2 size={13} className="shrink-0" style={{ color: BRAND }} />
            <span className="truncate max-w-[280px]" title={prof.secure_link} data-testid="chatbot-secure-link">{prof.secure_link}</span>
            <span className="text-slate-400 shrink-0">· created {fmtDate(prof.link_created_at)} · expires {fmtDate(prof.link_expires_at)}</span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <a data-testid="chatbot-view-link-btn" href={prof.secure_link} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 border border-slate-200 text-slate-600 hover:bg-white rounded-md px-2.5 py-1 text-xs font-medium">
              <Eye size={12} /> View
            </a>
            <button data-testid="chatbot-copy-inline-btn" onClick={() => { navigator.clipboard?.writeText(prof.secure_link).then(() => toast.success("Link copied")).catch(() => window.prompt("Copy:", prof.secure_link)); }}
              className="inline-flex items-center gap-1 border border-slate-200 text-slate-600 hover:bg-white rounded-md px-2.5 py-1 text-xs font-medium">
              <Copy size={12} /> Copy
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-400">Loading qualification…</p>
      ) : (
        <>
          {/* progress */}
          <div className="mb-4">
            <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
              <span>Completion</span><span>{progress}%</span>
            </div>
            <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, progress)}%`, background: BRAND }} />
            </div>
          </div>

          {/* action buttons */}
          <div className="flex flex-wrap gap-2 mb-4">
            <button data-testid="chatbot-copy-link-btn" onClick={() => copyLink(false)} disabled={busy === "copy"}
              className="inline-flex items-center gap-1.5 text-white rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-60" style={{ background: BRAND }}>
              {busy === "copy" ? <Loader2 size={13} className="animate-spin" /> : <Copy size={13} />} Copy Chatbot Link
            </button>
            {canEdit && (
              <button data-testid="chatbot-renew-link-btn" onClick={() => copyLink(true)} disabled={busy === "renew"}
                className="inline-flex items-center gap-1.5 border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-60">
                {busy === "renew" ? <Loader2 size={13} className="animate-spin" /> : <Link2 size={13} />} Renew Link
              </button>
            )}
            <button data-testid="chatbot-view-qual-btn" onClick={() => setExpanded((v) => !v)}
              className="inline-flex items-center gap-1.5 border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-md px-3 py-1.5 text-xs font-medium">
              {expanded ? <EyeOff size={13} /> : <Eye size={13} />} {expanded ? "Hide" : "View"} Qualification
            </button>
            <button data-testid="chatbot-refresh-btn" onClick={refresh} disabled={busy === "refresh"}
              className="inline-flex items-center gap-1.5 border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-60">
              <RefreshCw size={13} className={busy === "refresh" ? "animate-spin" : ""} /> Refresh
            </button>
            {canEdit && lead.status === "FILE" && (
              <button data-testid="chatbot-apply-file-btn" onClick={applyToFile} disabled={busy === "apply"}
                className="inline-flex items-center gap-1.5 border border-emerald-300 text-emerald-700 hover:bg-emerald-50 rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-60">
                {busy === "apply" ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Sync to File
              </button>
            )}
            {canEdit && (
              <>
                <button data-testid="chatbot-request-info-btn" onClick={() => setModal("request_missing_info")}
                  className="inline-flex items-center gap-1.5 border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-md px-3 py-1.5 text-xs font-medium">
                  <HelpCircle size={13} /> Request Missing Info
                </button>
                <button data-testid="chatbot-advisory-btn" onClick={() => setModal("advisory_note")}
                  className="inline-flex items-center gap-1.5 border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-md px-3 py-1.5 text-xs font-medium">
                  <PencilLine size={13} /> Advisory Notes
                </button>
              </>
            )}
          </div>

          {wa?.configured && (
            <div className="flex items-center justify-between gap-2 mb-4 rounded-md border border-green-200 bg-green-50/50 px-3 py-2 flex-wrap" data-testid="whatsapp-status-strip">
              <div className="flex items-center gap-2 text-xs text-slate-600 flex-wrap">
                <MessageCircle size={14} className="text-green-600" />
                <span className="font-medium">WhatsApp:</span>
                {wa.whatsapp?.status ? <span className="capitalize" data-testid="whatsapp-status">{String(wa.whatsapp.status).replace(/_/g, " ")}</span> : <span className="text-slate-400">not sent</span>}
                {wa.whatsapp?.wamid && <span className="text-slate-400" data-testid="whatsapp-wamid" title={wa.whatsapp.wamid}>· ID {String(wa.whatsapp.wamid).slice(-10)}</span>}
                {wa.whatsapp?.sent_at && <span className="text-slate-400">· {new Date(wa.whatsapp.sent_at).toLocaleString()}</span>}
                {wa.whatsapp?.link_expires_at && <span className="text-slate-400">· link expires {new Date(wa.whatsapp.link_expires_at).toLocaleDateString()}</span>}
              </div>
              {canEdit && (
                <button data-testid="whatsapp-resend-btn" onClick={resendWhatsapp} disabled={busy === "whatsapp"}
                  className="inline-flex items-center gap-1.5 border border-green-300 text-green-700 hover:bg-green-100 rounded-md px-2.5 py-1 text-xs font-medium disabled:opacity-60">
                  {busy === "whatsapp" ? <Loader2 size={12} className="animate-spin" /> : <MessageCircle size={12} />}
                  {wa.whatsapp?.wamid ? "Resend / Renew" : "Send WhatsApp"}
                </button>
              )}
            </div>
          )}

          {!hasLink && (
            <label className="flex items-center gap-2 text-xs text-slate-500 mb-4 cursor-pointer">
              <input type="checkbox" data-testid="chatbot-consent-checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              Customer gave WhatsApp consent (send link via WhatsApp)
            </label>
          )}

          {!prof?.exists ? (
            <p className="text-sm text-slate-400">No chatbot session yet. Copy the link above and share it with the customer.</p>
          ) : (
            <>
              {/* summary grid */}
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-3">
                <Stat label="Net Monthly Salary" value={q.net_monthly_salary != null ? `₹${q.net_monthly_salary}` : "—"} accent />
                <Stat label="Company" value={q.company_name} />
                <Stat label="City" value={q.city} />
                <Stat label="CIBIL" value={q.cibil_score ? `${q.cibil_score}${q.cibil_bureau ? ` (${q.cibil_bureau})` : ""}` : "—"} />
                <Stat label="Total Obligations" value={q.total_monthly_obligations != null ? `₹${q.total_monthly_obligations}` : "—"} />
                <Stat label="EMI-to-Salary" value={ratio != null && ratio !== "" ? `${ratio}%` : "—"} accent />
                <Stat label="Payslip" value={q.payslip_status || "Pending"} />
                <Stat label="Credit Report" value={q.credit_report_status || "Pending"} />
                <Stat label="Existing Loans" value={loans.length} />
              </div>

              {expanded && (
                <div className="mt-3 pt-3 border-t border-slate-100 space-y-3" data-testid="chatbot-qual-details">
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1"><Gauge size={12} /> Existing Loans & Obligations</p>
                  {loans.length === 0 && <p className="text-sm text-slate-400">No loans reported.</p>}
                  {loans.map((l, i) => (
                    <div key={l.loan_id || i} className="border border-slate-100 rounded-md p-3 bg-slate-50/50" data-testid={`chatbot-loan-${i}`}>
                      <p className="text-sm font-medium text-slate-800 mb-1">{[l.lender, l.loan_type].filter(Boolean).join(" · ") || `Loan #${i + 1}`}</p>
                      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 text-xs text-slate-600">
                        <div><span className="text-slate-400">Original</span><br />{l.original_amount != null ? `₹${l.original_amount}` : "—"}</div>
                        <div><span className="text-slate-400">Sanction Date</span><br />{l.sanction_date || "—"}</div>
                        <div><span className="text-slate-400">Outstanding</span><br />{l.outstanding_balance != null ? `₹${l.outstanding_balance}` : "—"}</div>
                        <div><span className="text-slate-400">Interest</span><br />{l.interest_rate != null ? `${l.interest_rate}%` : "—"}</div>
                        <div><span className="text-slate-400">Monthly EMI</span><br />{l.monthly_emi != null ? `₹${l.monthly_emi}` : "—"}</div>
                        <div><span className="text-slate-400">Tenure</span><br />{l.original_tenure != null ? `${l.original_tenure} mo` : "—"}</div>
                        <div><span className="text-slate-400">EMIs Paid</span><br />{l.emis_paid != null ? l.emis_paid : "—"}</div>
                      </div>
                    </div>
                  ))}
                  {(q.callback_requests || []).length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Callback Requests</p>
                      {(q.callback_requests || []).map((c, i) => (
                        <p key={i} className="text-sm text-slate-700">{typeof c === "string" ? c : (c.requested_at || c.at || JSON.stringify(c))}</p>
                      ))}
                    </div>
                  )}
                  {answers.length > 0 && (
                    <div data-testid="chatbot-answers">
                      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">All Answers Received</p>
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-1">
                        {answers.map(([k, v]) => (
                          <div key={k} className="flex justify-between gap-3 text-sm border-b border-slate-50 py-0.5">
                            <span className="text-slate-500 capitalize">{String(k).replace(/_/g, " ")}</span>
                            <span className="text-slate-800 text-right break-words">{v === null || v === "" ? "—" : (typeof v === "object" ? JSON.stringify(v) : String(v))}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}

      {modal && (
        <ActionModal
          title={modal === "request_missing_info" ? "Request Missing Information" : "Record Advisory Notes"}
          placeholder={modal === "request_missing_info" ? "Which details are missing?" : "Advisory note for this customer…"}
          onClose={() => setModal(null)}
          onSubmit={(note) => sendAction(modal, note)}
        />
      )}
    </div>
  );
}
