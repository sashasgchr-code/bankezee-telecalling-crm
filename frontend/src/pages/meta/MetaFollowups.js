import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../../services/api";
import { Bell, BellOff, CalendarClock, AlertTriangle, Clock, PhoneCall, MessagesSquare } from "lucide-react";
import { toast } from "sonner";
import { BRAND, BRAND_DARK, URGENCY_META, followupDaysLabel, useMetaUser } from "./metaCommon";

// Shared source of truth for Query/Hold reminders. Polls every 2 min and refreshes
// immediately when a follow-up changes elsewhere (via the 'meta-followup-changed' event).
export const useFollowups = (poll = true) => {
  const [data, setData] = useState({ items: [], reminders: [], counts: {} });
  const load = async () => {
    try {
      const { data } = await api.get("/meta/followups");
      setData(data || { items: [], reminders: [], counts: {} });
    } catch { /* non-fatal */ }
  };
  useEffect(() => {
    load();
    const onChange = () => load();
    window.addEventListener("meta-followup-changed", onChange);
    let id;
    if (poll) id = setInterval(load, 120000);
    return () => { window.removeEventListener("meta-followup-changed", onChange); if (id) clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { ...data, reload: load };
};

// Overdue TAT nudges — files past the 4-day line, scoped to the current user
// (a processor sees only their assigned files). Polls every 2 min + refreshes on status change.
export const useTatAlerts = (poll = true, excludeSnoozed = false) => {
  const [data, setData] = useState({ items: [], count: 0, limit_hours: 96 });
  const load = async () => {
    try {
      const { data } = await api.get(`/meta/tat/alerts${excludeSnoozed ? "?exclude_snoozed=true" : ""}`);
      setData(data || { items: [], count: 0, limit_hours: 96 });
    } catch { /* non-fatal */ }
  };
  useEffect(() => {
    load();
    const onChange = () => load();
    window.addEventListener("meta-followup-changed", onChange);
    window.addEventListener("meta-status-changed", onChange);
    let id;
    if (poll) id = setInterval(load, 120000);
    return () => {
      window.removeEventListener("meta-followup-changed", onChange);
      window.removeEventListener("meta-status-changed", onChange);
      if (id) clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { ...data, reload: load };
};

// Leads that tapped "Request Expert Call" on WhatsApp and whose status hasn't changed since.
export const useCallRequests = (poll = true) => {
  const [data, setData] = useState({ items: [], count: 0 });
  const load = async () => {
    try {
      const { data } = await api.get("/meta/call-requests");
      setData(data || { items: [], count: 0 });
    } catch { /* non-fatal */ }
  };
  useEffect(() => {
    load();
    window.addEventListener("meta-status-changed", load);
    const id = poll ? setInterval(load, 60000) : null;
    return () => { window.removeEventListener("meta-status-changed", load); if (id) clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return data;
};

const fmtWhen = (iso) => iso ? new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "";

// WhatsApp customer replies (unread conversations in the user's scope); toasts when a new reply arrives.
export const useReplyAlerts = () => {
  const [data, setData] = useState({ items: [], count: 0 });
  const seen = useRef(null);
  useEffect(() => {
    const load = async () => {
      try {
        const { data: d } = await api.get("/inbox/reply-alerts");
        const sig = Object.fromEntries((d.items || []).map((c) => [c.id, c.last_inbound_at]));
        if (seen.current) {
          const fresh = (d.items || []).filter((c) => seen.current[c.id] !== c.last_inbound_at);
          fresh.slice(0, 3).forEach((c) => toast(`New WhatsApp reply from ${c.customer_name || c.profile_name || c.wa_number}`, { description: c.last_preview }));
        }
        seen.current = sig;
        setData(d);
      } catch { /* non-fatal */ }
    };
    load();
    const id = setInterval(load, 20000);
    return () => clearInterval(id);
  }, []);
  return data;
};

const ReplyAlertsSection = ({ items, onOpen }) => (
  <>
    <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between bg-emerald-50/60">
      <span className="text-sm font-semibold flex items-center gap-1.5 text-emerald-700"><MessagesSquare size={14} /> WhatsApp replies</span>
      <span data-testid="meta-reply-bell-count" className="text-xs font-semibold text-emerald-700">{items.length}</span>
    </div>
    {items.length === 0 ? <p className="px-4 py-4 text-center text-xs text-slate-400">No unread customer replies.</p> : items.map((c) => (
      <button key={c.id} data-testid={`meta-reply-bell-item-${c.id}`} onClick={() => onOpen(c.id)} className="w-full text-left px-4 py-3 border-b border-slate-50 hover:bg-emerald-50/50 transition-colors">
        <p className="text-sm font-medium text-slate-800 flex justify-between gap-2"><span className="truncate">{c.customer_name || c.profile_name || `+${c.wa_number}`}</span><span className="text-[10px] rounded-full bg-emerald-600 text-white px-1.5">{c.unread_count}</span></p>
        <p className="text-xs text-slate-500 truncate">{c.last_preview}</p>
      </button>
    ))}
  </>
);

const CallRequestsSection = ({ items, canOpen, onOpen }) => (
  <>
    <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between bg-orange-50/60">
      <span className="text-sm font-semibold flex items-center gap-1.5 text-orange-700"><PhoneCall size={14} /> Wants a Call</span>
      <span data-testid="meta-call-request-bell-count" className="text-xs font-semibold text-orange-600">{items.length}</span>
    </div>
    {items.length === 0 ? (
      <p className="px-4 py-4 text-center text-xs text-slate-400">No pending call requests.</p>
    ) : items.map((r) => (
      <div key={`call-${r.lead_id}`} role="button" tabIndex={0} data-testid={`meta-call-request-item-${r.lead_id}`}
        onClick={() => canOpen && onOpen(r.lead_id)}
        className={`px-4 py-3 border-b border-slate-50 transition-colors ${canOpen ? "hover:bg-orange-50/50 cursor-pointer" : ""}`}>
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-slate-800 truncate">{r.full_name || "—"}</span>
          <span className="text-[10px] text-slate-400 whitespace-nowrap">{fmtWhen(r.requested_at)}</span>
        </div>
        <div className="flex items-center justify-between gap-2 mt-0.5">
          <a data-testid={`meta-call-request-phone-${r.lead_id}`} href={`tel:${r.phone}`} onClick={(e) => e.stopPropagation()} className="text-xs font-medium text-emerald-700 hover:underline">{r.phone || "—"}</a>
          <span className="text-[10px] text-slate-500 truncate">{r.assigned_partner_name || "Unassigned"}</span>
        </div>
      </div>
    ))}
  </>
);

const Badge = ({ urgency }) => {
  const m = URGENCY_META[urgency] || URGENCY_META.none;
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border ${m.cls}`}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: m.dot }} />{m.label}
    </span>
  );
};

// Floating header notification bell — fixed top-right across all Meta pages.
export const FollowupBell = () => {
  const navigate = useNavigate();
  const { reminders, counts } = useFollowups();
  const { items: tatItems, count: tatCount, reload: reloadTat } = useTatAlerts(true, true);
  const { items: callItems } = useCallRequests();
  const { role } = useMetaUser();
  const { items: replyItems } = useReplyAlerts();
  const [open, setOpen] = useState(false);
  const [snoozing, setSnoozing] = useState(null);
  const ref = useRef(null);
  const snooze = async (e, leadId) => {
    e.stopPropagation();
    setSnoozing(leadId);
    try {
      await api.post(`/meta/tat/snooze/${leadId}`);
      await reloadTat();
    } catch { /* non-fatal */ }
    setSnoozing(null);
  };
  useEffect(() => {
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  const fuCount = counts.reminders || 0;
  const count = fuCount + (tatCount || 0) + callItems.length + replyItems.length;
  return (
    <div className="fixed top-2 right-3 md:top-3 md:right-5 z-[60]" ref={ref}>
      <button
        data-testid="meta-followup-bell"
        onClick={() => setOpen((v) => !v)}
        className="relative h-10 w-10 rounded-full bg-white border border-slate-200 shadow-sm flex items-center justify-center hover:bg-slate-50 transition-colors"
      >
        <Bell size={18} className="text-slate-600" />
        {count > 0 && (
          <span data-testid="meta-followup-bell-count" className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[10px] font-bold flex items-center justify-center">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-80 max-h-[70vh] overflow-auto bg-white border border-slate-200 rounded-xl shadow-xl" data-testid="meta-followup-bell-panel">
          <ReplyAlertsSection items={replyItems} onOpen={(id) => { setOpen(false); navigate(`/meta/inbox?c=${id}`); }} />
          <CallRequestsSection items={callItems} canOpen={role !== "processor"} onOpen={(id) => { setOpen(false); navigate(`/meta/leads/${id}`); }} />
          {/* Overdue TAT nudges */}
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between bg-red-50/60">
            <span className="text-sm font-semibold flex items-center gap-1.5 text-red-700">
              <AlertTriangle size={14} /> TAT Overdue (4+ days)
            </span>
            <span data-testid="meta-tat-bell-count" className="text-xs font-semibold text-red-600">{tatCount || 0}</span>
          </div>
          {(!tatItems || tatItems.length === 0) ? (
            <p className="px-4 py-4 text-center text-xs text-slate-400">No files past the 4-day TAT line.</p>
          ) : (
            tatItems.map((r) => (
              <div
                key={`tat-${r.lead_id}`}
                role="button"
                tabIndex={0}
                data-testid={`meta-tat-bell-item-${r.lead_id}`}
                onClick={() => { setOpen(false); navigate(`/meta/files/${r.lead_id}`); }}
                className="w-full text-left px-4 py-3 border-b border-slate-50 hover:bg-red-50/50 transition-colors cursor-pointer"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-slate-800 truncate">{r.full_name || "—"}</span>
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold border bg-red-100 text-red-700 border-red-200 whitespace-nowrap">
                    <AlertTriangle size={10} /> {r.tat_days}d {r.tat_hours}h
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 mt-0.5">
                  <p className="text-xs text-slate-500 truncate">{r.processing_status || "—"}{r.assigned_processor_name ? ` · ${r.assigned_processor_name}` : ""}</p>
                  <button
                    data-testid={`meta-tat-snooze-${r.lead_id}`}
                    onClick={(e) => snooze(e, r.lead_id)}
                    disabled={snoozing === r.lead_id}
                    title="Snooze for today"
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium text-slate-500 border border-slate-200 hover:bg-slate-100 hover:text-slate-700 transition-colors disabled:opacity-50 shrink-0"
                  >
                    <BellOff size={11} /> {snoozing === r.lead_id ? "…" : "Snooze today"}
                  </button>
                </div>
              </div>
            ))
          )}

          {/* Follow-up reminders */}
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <span className="text-sm font-semibold" style={{ color: BRAND_DARK }}>Follow-up Reminders</span>
            <span className="text-xs text-slate-400">{fuCount}</span>
          </div>
          {reminders.length === 0 ? (
            <p className="px-4 py-4 text-center text-xs text-slate-400">No follow-ups due in the next 3 days.</p>
          ) : (
            reminders.map((r) => (
              <button
                key={r.lead_id}
                data-testid={`meta-followup-bell-item-${r.lead_id}`}
                onClick={() => { setOpen(false); navigate(`/meta/files/${r.lead_id}`); }}
                className="w-full text-left px-4 py-3 border-b border-slate-50 hover:bg-slate-50 transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-slate-800 truncate">{r.full_name || "—"}</span>
                  <Badge urgency={r.urgency} />
                </div>
                <p className="text-xs text-slate-500 mt-0.5">{r.kind} · {followupDaysLabel(r.days)}</p>
                {r.description && <p className="text-xs text-slate-400 truncate mt-0.5">{r.description}</p>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
};

// Compact dashboard widget: counts + nearest follow-ups, each routing to filtered Files.
export const FollowupWidget = () => {
  const navigate = useNavigate();
  const { items, counts } = useFollowups();
  const go = (fu) => navigate(`/meta/files?${fu ? `fu=${fu}` : "status=Query"}`);
  const tiles = [
    { key: "overdue", label: "Overdue", value: counts.overdue || 0, icon: AlertTriangle, cls: "text-red-600 bg-red-50" },
    { key: "due_today", label: "Due Today", value: counts.due_today || 0, icon: Clock, cls: "text-orange-600 bg-orange-50" },
    { key: "upcoming", label: "Upcoming", value: counts.upcoming || 0, icon: CalendarClock, cls: "text-blue-600 bg-blue-50" },
  ];
  return (
    <div className="bg-white border border-slate-200 rounded-md p-5 shadow-sm" data-testid="meta-followup-widget">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold flex items-center gap-2" style={{ color: BRAND_DARK }}>
          <CalendarClock size={16} /> Pending Follow-ups
        </h3>
        <span className="text-xs text-slate-400" data-testid="meta-followup-widget-total">{counts.total_active || 0} active</span>
      </div>
      <div className="grid grid-cols-3 gap-2 mb-4">
        {tiles.map((t) => (
          <button
            key={t.key}
            data-testid={`meta-followup-tile-${t.key}`}
            onClick={() => go(t.key)}
            className="rounded-md border border-slate-100 p-3 text-left hover:border-slate-300 transition-colors"
          >
            <div className={`h-7 w-7 rounded-md flex items-center justify-center mb-2 ${t.cls}`}><t.icon size={15} /></div>
            <p className="text-2xl font-semibold" style={{ color: BRAND_DARK }}>{t.value}</p>
            <p className="text-[11px] text-slate-500">{t.label}</p>
          </button>
        ))}
      </div>
      <div className="space-y-1.5 max-h-56 overflow-auto">
        {items.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400">No active Query/Hold follow-ups.</p>
        ) : (
          items.slice(0, 8).map((r) => (
            <button
              key={r.lead_id}
              data-testid={`meta-followup-widget-item-${r.lead_id}`}
              onClick={() => navigate(`/meta/files/${r.lead_id}`)}
              className="w-full flex items-center justify-between gap-2 text-left px-2 py-1.5 rounded hover:bg-slate-50"
            >
              <span className="min-w-0">
                <span className="text-sm font-medium text-slate-700 truncate block">{r.full_name || "—"}</span>
                <span className="text-[11px] text-slate-400">{r.kind} · {followupDaysLabel(r.days)}</span>
              </span>
              <Badge urgency={r.urgency} />
            </button>
          ))
        )}
      </div>
    </div>
  );
};
