import React, { useCallback, useEffect, useState } from "react";
import api from "../../services/api";
import { toast } from "sonner";
import { Plus, Download, Pause, Play, X, Pencil } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { B, Kpi, StatusBadge, fmtDT, btn, errMsg, download } from "./ccShared";
import { CampaignWizard } from "./CampaignWizard";

const rate = (v) => (v === null || v === undefined ? "—" : `${v}%`);

const Detail = ({ id, onClose, onAction, canAct }) => {
  const [d, setD] = useState(null);
  useEffect(() => { if (id) api.get(`/cc/campaigns/${id}`).then(({ data }) => setD(data)); else setD(null); }, [id]);
  return (
    <Dialog open={!!id} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto" data-testid="cc-campaign-detail">
        <DialogHeader><DialogTitle style={{ color: B.navy }}>{d?.name || "Campaign"}</DialogTitle></DialogHeader>
        {d && <div className="space-y-3 text-sm">
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-slate-600">
            <span>Status: <StatusBadge s={d.status} testid="cc-detail-status" /></span><span>Mode: <b>{d.mode || "—"}</b></span><span>Type: <b>{d.type}</b></span>
            <span>Template: <b>{d.template}</b></span><span>Created by <b>{d.created_by}</b> {fmtDT(d.created_at)}</span>
            <span>Send: <b>{d.schedule_mode === "later" ? `${(d.schedule_at || "").replace("T", " ")} IST` : fmtDT(d.started_at || d.confirmed_at)}</b></span>
          </div>
          <p className="text-xs text-slate-500">Audience filters: {Object.entries(d.filters || {}).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join(", ") || "all"}{d.customer_ids ? ` · ${d.customer_ids.length} individually selected` : ""}</p>
          <div className="flex flex-wrap gap-2 text-xs">{Object.entries(d.counts).map(([k, v]) => <span key={k} className="px-2 py-1 rounded bg-slate-100"><b>{v}</b> {k}</span>)}</div>
          {canAct && <div className="flex gap-2">
            {["running", "scheduled"].includes(d.status) && <button type="button" data-testid="cc-pause" onClick={() => onAction(d.campaign_id, "pause")} className={btn("ghost")}><Pause size={14} /> Pause</button>}
            {d.status === "paused" && <button type="button" data-testid="cc-resume" onClick={() => onAction(d.campaign_id, "resume")} className={btn("ghost")}><Play size={14} /> Resume</button>}
            {["draft", "scheduled", "running", "paused"].includes(d.status) && <button type="button" data-testid="cc-cancel" onClick={() => window.confirm("Cancel this campaign? Queued messages will not be sent.") && onAction(d.campaign_id, "cancel")} className={btn("danger")}><X size={14} /> Cancel</button>}
            <button type="button" onClick={() => download(api, "/cc/campaigns-export", { cid: d.campaign_id }, `${d.name}_recipients.csv`)} className={btn("ghost")}><Download size={14} /> Recipients CSV</button>
          </div>}
          <div className="overflow-x-auto border rounded-lg max-h-80"><table className="w-full text-xs" data-testid="cc-recipients">
            <thead className="bg-slate-50 sticky top-0"><tr>{["Customer", "Number", "Status", "Accepted", "Delivered", "Read", "Reply", "Error"].map((h) => <th key={h} className="text-left px-2.5 py-2 text-[10px] uppercase text-slate-500">{h}</th>)}</tr></thead>
            <tbody>{d.recipients.map((r) => (
              <tr key={r.dedupe_key} className="border-t"><td className="px-2.5 py-1.5">{r.name}{r.kind === "test" ? " (test)" : ""}</td><td className="px-2.5 py-1.5">{r.wa_number ? `••••${r.wa_number.slice(-4)}` : "—"}</td>
                <td className="px-2.5 py-1.5"><StatusBadge s={r.status} /></td><td className="px-2.5 py-1.5">{fmtDT(r.submitted_at)}</td><td className="px-2.5 py-1.5">{fmtDT(r.delivered_at)}</td>
                <td className="px-2.5 py-1.5">{fmtDT(r.read_at)}</td><td className="px-2.5 py-1.5">{r.replied ? r.reply_text || "Yes" : "—"}</td><td className="px-2.5 py-1.5 text-red-600">{r.error || r.note || ""}</td></tr>))}</tbody>
          </table></div>
          {d.log?.length > 0 && <div className="text-[11px] text-slate-500 space-y-0.5">{d.log.map((l, i) => <p key={i}>{fmtDT(l.at)} — {l.action.replace(/_/g, " ")} by {l.by_name}</p>)}</div>}
        </div>}
      </DialogContent>
    </Dialog>
  );
};

export const CampaignsTab = ({ me, historyOnly }) => {
  const [data, setData] = useState(null);
  const [wiz, setWiz] = useState(null);
  const [view, setView] = useState(null);
  const load = useCallback(() => api.get("/cc/campaigns").then(({ data }) => setData(data)).catch((e) => toast.error(errMsg(e))), []);
  useEffect(() => { load(); const t = setInterval(load, 20000); return () => clearInterval(t); }, [load]);
  const act = async (id, action) => { try { await api.post(`/cc/campaigns/${id}/${action}`); toast.success(`Campaign ${action}d`); setView(null); load(); } catch (e) { toast.error(errMsg(e)); } };
  const items = (data?.items || []).filter((c) => (historyOnly ? true : ["draft", "scheduled", "running", "paused"].includes(c.status)));
  const k = data?.kpis;
  return (
    <div className="space-y-4" data-testid={historyOnly ? "cc-history-tab" : "cc-campaigns-tab"}>
      {historyOnly && k && <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <Kpi testid="cc-h-total" label="Total Campaigns" value={k.campaigns} /><Kpi testid="cc-h-sent" label="Messages Accepted" value={k.accepted} sub="accepted by Meta (not mock)" color={B.blue} />
        <Kpi testid="cc-h-delivery" label="Delivery Rate" value={rate(k.delivery_rate)} sub="delivered ÷ accepted" color={B.emerald} />
        <Kpi testid="cc-h-read" label="Read Rate" value={rate(k.read_rate)} sub="read ÷ delivered" color={B.emerald} />
        <Kpi testid="cc-h-fail" label="Failure Rate" value={rate(k.failure_rate)} sub="failed ÷ attempted" color={B.red} />
        <Kpi testid="cc-h-reply" label="Reply Rate" value={rate(k.reply_rate)} sub="replied ÷ delivered" color={B.gold} />
      </div>}
      <div className="flex gap-2">
        {!historyOnly && me.can_campaign && <button type="button" data-testid="cc-create-campaign" onClick={() => setWiz({})} className={btn("primary")}><Plus size={14} /> Create Campaign</button>}
        {historyOnly && <button type="button" data-testid="cc-h-export" onClick={() => download(api, "/cc/campaigns-export", {}, "campaigns.csv")} className={btn("ghost")}><Download size={14} /> Export summary CSV</button>}
      </div>
      {!me.live_sending && <p className="text-xs rounded-md bg-violet-50 border border-violet-200 text-violet-800 px-3 py-2" data-testid="cc-mock-note">Live sending is OFF (mock mode). Campaigns run end-to-end but no WhatsApp message is sent. An admin can switch it on in Settings.</p>}
      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm" data-testid="cc-campaign-table">
          <thead className="bg-slate-50"><tr>{["Campaign", "Type", "Template", "Audience", "Queued", "Accepted", "Delivered", "Read", "Failed", "Replies", "Date", "Status", ""].map((h) => <th key={h} className="text-left px-3 py-2 text-[10px] font-semibold uppercase text-slate-500 whitespace-nowrap">{h}</th>)}</tr></thead>
          <tbody>
            {items.length === 0 && <tr><td colSpan={13} className="text-center py-8 text-slate-400">{historyOnly ? "No campaigns yet." : "No active or draft campaigns."}</td></tr>}
            {items.map((c) => {
              const n = c.counts;
              return (
                <tr key={c.campaign_id} className="border-t hover:bg-slate-50/60" data-testid={`cc-camp-${c.campaign_id}`}>
                  <td className="px-3 py-2 font-semibold">{c.name}</td><td className="px-3 py-2">{c.type}</td><td className="px-3 py-2">{c.template || "—"}</td><td className="px-3 py-2">{c.audience_total ?? "—"}</td>
                  <td className="px-3 py-2">{n.queued}</td><td className="px-3 py-2">{n.submitted + n.sent + n.delivered + n.read}{n.mock ? ` (+${n.mock} mock)` : ""}</td>
                  <td className="px-3 py-2">{n.delivered + n.read}</td><td className="px-3 py-2">{n.read}</td><td className="px-3 py-2">{n.failed}</td><td className="px-3 py-2">{n.replied}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-xs">{fmtDT(c.confirmed_at || c.created_at)}</td><td className="px-3 py-2"><StatusBadge s={c.status} /></td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <button type="button" data-testid={`cc-camp-view-${c.campaign_id}`} onClick={() => setView(c.campaign_id)} className="text-xs font-semibold mr-2" style={{ color: B.blue }}>Details</button>
                    {c.status === "draft" && me.can_campaign && <button type="button" data-testid={`cc-camp-edit-${c.campaign_id}`} onClick={() => setWiz(c)} className="text-xs font-semibold inline-flex items-center gap-1" style={{ color: B.navy }}><Pencil size={12} /> Edit</button>}
                  </td>
                </tr>);
            })}
          </tbody>
        </table>
      </div>
      <CampaignWizard open={!!wiz} initial={wiz && wiz.campaign_id ? wiz : null} me={me} onClose={(changed) => { setWiz(null); if (changed) load(); }} />
      <Detail id={view} onClose={() => setView(null)} onAction={act} canAct={me.can_campaign} />
    </div>
  );
};
