import React from "react";
import { Check, CheckCheck, Clock, AlertCircle, ExternalLink, Reply, StickyNote, RotateCcw } from "lucide-react";
import { MediaView } from "./MediaView";
import { fmtIST, SOURCE_LABEL } from "./inboxUtils";

const Tick = ({ s }) => {
  if (s === "read") return <CheckCheck size={13} className="text-sky-500" />;
  if (s === "delivered") return <CheckCheck size={13} />;
  if (s === "sent" || s === "accepted") return <Check size={13} />;
  if (s === "sending") return <Clock size={12} />;
  if (s === "failed") return <AlertCircle size={13} className="text-red-500" />;
  return null;
};

const Buttons = ({ buttons }) => (buttons || []).length ? (
  <div className="mt-2 border-t border-black/5 pt-1.5 space-y-1">
    {buttons.map((b, i) => b.url ? (
      <a key={i} href={b.url} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-1 text-xs font-medium text-sky-700 hover:underline break-all"><ExternalLink size={12} />{b.text}<span className="sr-only">{b.url}</span></a>
    ) : (
      <p key={i} className="flex items-center justify-center gap-1 text-xs font-medium text-sky-700"><Reply size={12} />{b.text}</p>
    ))}
    {buttons.filter((b) => b.url).map((b, i) => <p key={`u${i}`} className="text-[10px] text-slate-500 break-all" data-testid="msg-button-url">{b.url}</p>)}
  </div>
) : null;

export const MessageBubble = ({ m, onRetry }) => {
  if (m.direction === "note") return (
    <div data-testid={`msg-note-${m.id}`} className="mx-auto max-w-[80%] rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-900">
      <p className="flex items-center gap-1 text-[11px] font-semibold mb-0.5"><StickyNote size={12} /> Internal note · {m.sender?.name} · {fmtIST(m.created_at)}</p>
      <p className="whitespace-pre-wrap">{m.text}</p>
    </div>
  );
  const out = m.direction === "out";
  const auto = ["welcome", "campaign", "birthday", "bot"].includes(m.source);
  const tone = !out ? "bg-white border border-slate-200" : auto ? "bg-indigo-50 border border-indigo-100" : "bg-emerald-50 border border-emerald-100";
  return (
    <div className={`flex ${out ? "justify-end" : "justify-start"}`} data-testid={`msg-${m.id}`}>
      <div className={`max-w-[78%] rounded-xl px-3 py-2 shadow-sm ${tone}`}>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1">
          {out ? `${SOURCE_LABEL[m.source] || m.source}${m.sender?.name && !auto ? ` · ${m.sender.name}` : ""}` : "Customer"}
          {m.template?.name && <span className="normal-case font-normal"> · template {m.template.name}</span>}
        </p>
        {m.header?.type && <MediaView msgId={m.id} part="header" kind={m.header.type} />}
        {m.media && <MediaView msgId={m.id} kind={m.type} filename={m.media.filename} />}
        {m.text && <p className="text-sm whitespace-pre-wrap break-words text-slate-800">{m.text}</p>}
        <Buttons buttons={m.buttons} />
        <div className="flex items-center justify-end gap-1 mt-1 text-[10px] text-slate-400">
          {fmtIST(m.created_at)} {out && <span data-testid={`msg-status-${m.id}`} title={m.status}><Tick s={m.status} /></span>}
        </div>
        {m.status === "failed" && (
          <div className="mt-1 text-[11px] text-red-600" data-testid={`msg-error-${m.id}`}>
            {m.error || "Failed"}
            {m.source === "staff" && m.type === "text" && <button onClick={() => onRetry(m)} data-testid={`msg-retry-${m.id}`} className="ml-2 inline-flex items-center gap-0.5 underline"><RotateCcw size={11} />Retry</button>}
          </div>
        )}
      </div>
    </div>
  );
};
