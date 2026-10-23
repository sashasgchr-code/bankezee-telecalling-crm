import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../../services/api";
import { Bell, CalendarClock, AlertTriangle, Clock } from "lucide-react";
import { BRAND, BRAND_DARK, URGENCY_META, followupDaysLabel } from "./metaCommon";

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
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  const count = counts.reminders || 0;
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
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <span className="text-sm font-semibold" style={{ color: BRAND_DARK }}>Follow-up Reminders</span>
            <span className="text-xs text-slate-400">{count}</span>
          </div>
          {reminders.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-slate-400">No follow-ups due in the next 3 days.</p>
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
