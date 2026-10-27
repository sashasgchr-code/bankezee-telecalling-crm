import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import api from "../../services/api";
import { MessagesSquare, Loader2 } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "../ui/sheet";
import { ChatThread } from "./ChatThread";
import { errMsg } from "./inboxUtils";

const ChatSheetBody = ({ leadId, onChanged }) => {
  const navigate = useNavigate();
  const [conv, setConv] = useState(undefined);
  useEffect(() => { api.get(`/inbox/leads/${leadId}/conversation`).then(({ data }) => setConv(data.conversation)).catch((e) => { toast.error(errMsg(e)); setConv(null); }); }, [leadId]);
  const start = async () => { try { const { data } = await api.post(`/inbox/leads/${leadId}/conversation`); setConv(data.conversation); } catch (e) { toast.error(errMsg(e)); } };
  if (conv === undefined) return <div className="flex-1 flex items-center justify-center"><Loader2 className="animate-spin text-slate-400" /></div>;
  if (!conv) return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6 text-center" data-testid="chat-sheet-empty">
      <p className="text-sm text-slate-600">No WhatsApp conversation yet.</p>
      <button data-testid="chat-sheet-start-btn" onClick={start} className="rounded-md bg-emerald-600 text-white px-4 py-2 text-sm">Start with an approved template</button>
    </div>
  );
  return (
    <>
      <button data-testid="chat-open-full-inbox-btn" onClick={() => navigate(`/meta/inbox?c=${conv.id}`)} className="mx-4 my-2 self-start text-xs font-semibold text-sky-700 underline">OPEN FULL INBOX</button>
      <ChatThread convId={conv.id} onChanged={onChanged} />
    </>
  );
};

export const ChatSheet = ({ leadId, open, onClose, onChanged }) => (
  <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
    <SheetContent side="right" className="w-full sm:max-w-xl p-0 flex flex-col" data-testid="chat-sheet">
      <SheetHeader className="px-4 pt-4"><SheetTitle className="flex items-center gap-2 text-base"><MessagesSquare size={18} /> WhatsApp conversation</SheetTitle></SheetHeader>
      {open && <ChatSheetBody leadId={leadId} onChanged={onChanged} />}
    </SheetContent>
  </Sheet>
);

// Chat icon (+ unread badge) that opens the shared slide-out. Hidden for roles without inbox access.
export const ChatButton = ({ leadId, unread = 0, role, variant = "icon", onChanged }) => {
  const [open, setOpen] = useState(false);
  if (!["admin", "ops", "processor", "growth_partner"].includes(role)) return null;
  return (
    <>
      {variant === "icon" ? (
        <button type="button" data-testid={`meta-chat-btn-${leadId}`} title="Open WhatsApp Conversation" onClick={(e) => { e.stopPropagation(); setOpen(true); }}
          className="relative h-7 w-7 rounded-full bg-sky-50 text-sky-700 hover:bg-sky-100 flex items-center justify-center shrink-0">
          <MessagesSquare size={14} />
          {unread > 0 && <span data-testid={`meta-chat-unread-${leadId}`} className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] leading-4 text-center">{unread}</span>}
        </button>
      ) : (
        <button type="button" data-testid="meta-chat-btn" title="Open WhatsApp Conversation" onClick={() => setOpen(true)}
          className="bg-sky-600 hover:bg-sky-700 text-white rounded-md px-4 py-2 text-sm font-medium transition-colors flex items-center gap-2"><MessagesSquare size={16} /> Chat</button>
      )}
      <ChatSheet leadId={leadId} open={open} onClose={() => setOpen(false)} onChanged={onChanged} />
    </>
  );
};
