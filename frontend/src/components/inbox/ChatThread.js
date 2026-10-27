import React, { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import api from "../../services/api";
import { Loader2 } from "lucide-react";
import { MessageBubble } from "./MessageBubble";
import { Composer } from "./Composer";
import { TemplateDialog } from "./TemplateDialog";
import { CONV_STATUS, errMsg } from "./inboxUtils";

// Shared conversation component: used by the full Team Inbox and the Leads/Files slide-out.
export const ChatThread = ({ convId, onData, onChanged }) => {
  const [data, setData] = useState(null);
  const [procs, setProcs] = useState([]);
  const [tplOpen, setTplOpen] = useState(false);
  const endRef = useRef();
  const lastCount = useRef(0);

  const load = useCallback(() => api.get(`/inbox/conversations/${convId}`).then(({ data: d }) => {
    setData(d); onData && onData(d);
    if (d.conversation.unread_count > 0) api.post(`/inbox/conversations/${convId}/read`).then(() => onChanged && onChanged());
  }).catch((e) => toast.error(errMsg(e, "Could not load conversation"))), [convId, onData, onChanged]);

  useEffect(() => { setData(null); lastCount.current = 0; load(); const t = setInterval(load, 10000); return () => clearInterval(t); }, [load]);
  useEffect(() => { api.get("/meta/processors").then(({ data: d }) => setProcs(d)).catch(() => {}); }, []);
  useEffect(() => {
    const n = data?.messages?.length || 0;
    if (n !== lastCount.current) { lastCount.current = n; endRef.current?.scrollIntoView({ block: "end" }); }
  }, [data]);

  if (!data) return <div className="flex-1 flex items-center justify-center"><Loader2 className="animate-spin text-slate-400" /></div>;
  const { conversation: c, messages, role } = data;
  const staff = role === "admin" || role === "ops";
  const act = async (path, body) => { try { await api.post(`/inbox/conversations/${convId}/${path}`, body); load(); onChanged && onChanged(); } catch (e) { toast.error(errMsg(e)); } };
  const retry = async (m) => { try { await api.post(`/inbox/messages/${m.id}/retry`); load(); } catch (e) { toast.error(errMsg(e)); } };

  return (
    <div className="flex-1 flex flex-col min-h-0" data-testid="chat-thread">
      <div className="flex flex-wrap items-center gap-2 border-b bg-white px-4 py-2.5">
        <div className="min-w-0 mr-auto">
          <p className="font-semibold text-slate-800 truncate" data-testid="chat-customer-name">{c.customer_name || c.profile_name || c.wa_number}</p>
          <p className="text-xs text-slate-500">+{c.wa_number} {data.opted_out && <span className="text-red-600 font-medium">· opted out of marketing</span>}</p>
        </div>
        {staff ? (
          <select data-testid="chat-assign-select" value={c.assigned_processor_id || ""} onChange={(e) => act("assign", { processor_id: e.target.value || null })} className="border rounded-md px-2 py-1 text-xs">
            <option value="">Unassigned</option>
            {procs.map((p) => <option key={p.user_id} value={p.user_id}>{p.name}</option>)}
          </select>
        ) : <span className="text-xs text-slate-500" data-testid="chat-assigned-name">{c.assigned_processor_name || "Unassigned"}</span>}
        <select data-testid="chat-status-select" value={c.status} onChange={(e) => act("status", { status: e.target.value })} className="border rounded-md px-2 py-1 text-xs">
          {Object.entries(CONV_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        {data.bot && (
          <span className="flex items-center gap-1 text-xs" data-testid="chat-bot-status">
            <span className={`rounded-full px-2 py-0.5 font-medium ${data.bot.status === "active" ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"}`}>Bot: {data.bot.status}{data.bot.status !== "completed" && data.bot.step ? ` · ${data.bot.step.replace(/_/g, " ")}` : ""}</span>
            {data.bot.status === "active" && <button data-testid="chat-bot-pause-btn" onClick={() => act("bot/pause")} className="rounded-md border px-2 py-0.5">Take over</button>}
            {["paused", "abandoned"].includes(data.bot.status) && data.bot.step && <button data-testid="chat-bot-resume-btn" onClick={() => act("bot/resume")} className="rounded-md border px-2 py-0.5">Resume bot</button>}
          </span>
        )}
        {c.status !== "resolved" && <button data-testid="chat-resolve-btn" onClick={() => act("status", { status: "resolved" })} className="text-xs rounded-md bg-slate-800 text-white px-2.5 py-1">Mark resolved</button>}
      </div>
      <div className="flex-1 overflow-y-auto bg-[#f4f1ea] px-4 py-4 space-y-3" data-testid="chat-messages">
        {messages.length === 0 && <p className="text-center text-sm text-slate-500" data-testid="chat-empty">No WhatsApp conversation yet.</p>}
        {messages.map((m) => <MessageBubble key={m.id} m={m} onRetry={retry} />)}
        <div ref={endRef} />
      </div>
      <Composer convId={convId} windowOpen={data.window_open} onSent={load} onTemplate={() => setTplOpen(true)} canManageQuick={staff} />
      <TemplateDialog open={tplOpen} onClose={() => setTplOpen(false)} convId={convId} customerName={c.customer_name} defaultBtn={[...messages].reverse().find((m) => m.template?.button_params?.["0"])?.template.button_params["0"]} onSent={load} />
    </div>
  );
};
