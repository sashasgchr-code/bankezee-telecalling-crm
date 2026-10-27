import React, { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import api from "../../services/api";
import { Send, Paperclip, StickyNote, LayoutTemplate, Zap } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { newClientId, errMsg } from "./inboxUtils";

export const Composer = ({ convId, windowOpen, onSent, onTemplate, canManageQuick }) => {
  const [text, setText] = useState("");
  const [note, setNote] = useState(false);
  const [busy, setBusy] = useState(false);
  const [quick, setQuick] = useState([]);
  const fileRef = useRef();
  useEffect(() => { api.get("/inbox/quick-replies").then(({ data }) => setQuick(data)).catch(() => {}); }, []);
  const locked = !windowOpen && !note;

  const submit = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      if (note) await api.post(`/inbox/conversations/${convId}/notes`, { text });
      else {
        const { data } = await api.post(`/inbox/conversations/${convId}/messages`, { text, client_id: newClientId() });
        if (data.status === "failed") toast.error(`Not sent: ${data.error}`);
      }
      setText(""); onSent();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };

  const attach = async (f) => {
    if (!f) return;
    const fd = new FormData();
    fd.append("file", f); fd.append("caption", text); fd.append("client_id", newClientId());
    setBusy(true);
    try {
      const { data } = await api.post(`/inbox/conversations/${convId}/attachments`, fd, { headers: { "Content-Type": "multipart/form-data" } });
      if (data.status === "failed") toast.error(`Not sent: ${data.error}`);
      setText(""); onSent();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); fileRef.current.value = ""; }
  };

  const saveQuick = async () => {
    const title = window.prompt("Quick reply title");
    if (!title || !text.trim()) return toast.error("Type the reply text first, then save");
    try { const { data } = await api.post("/inbox/quick-replies", { title, text }); setQuick([...quick, data]); toast.success("Saved"); }
    catch (e) { toast.error(errMsg(e)); }
  };

  return (
    <div className="border-t bg-white p-3 space-y-2" data-testid="chat-composer">
      {!windowOpen && <p data-testid="window-expired-msg" className="text-xs rounded-md bg-amber-50 text-amber-800 border border-amber-200 px-2 py-1.5">Customer service window expired. Select an approved WhatsApp template to continue.</p>}
      <div className="flex items-center gap-1.5 text-xs">
        <button data-testid="composer-note-toggle" onClick={() => setNote(!note)} className={`inline-flex items-center gap-1 px-2 py-1 rounded-md border ${note ? "bg-amber-100 border-amber-300 text-amber-900" : "border-slate-200 text-slate-600"}`}><StickyNote size={13} />{note ? "Internal note mode" : "Internal note"}</button>
        <button data-testid="composer-template-btn" onClick={onTemplate} className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-slate-200 text-slate-700 font-medium"><LayoutTemplate size={13} />Send template</button>
        <Popover>
          <PopoverTrigger asChild><button data-testid="composer-quick-btn" className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-slate-200 text-slate-600"><Zap size={13} />Quick replies</button></PopoverTrigger>
          <PopoverContent className="w-72 p-2 space-y-1" data-testid="quick-replies-list">
            {quick.length === 0 && <p className="text-xs text-slate-500">No quick replies yet.</p>}
            {quick.map((q) => <button key={q.id} data-testid={`quick-reply-${q.id}`} onClick={() => setText(q.text)} className="block w-full text-left rounded px-2 py-1 hover:bg-slate-50 text-xs"><b>{q.title}</b><span className="block text-slate-500 truncate">{q.text}</span></button>)}
            {canManageQuick && <button data-testid="quick-reply-save" onClick={saveQuick} className="w-full text-xs text-sky-700 underline pt-1">Save current text as quick reply</button>}
          </PopoverContent>
        </Popover>
      </div>
      <div className="flex items-end gap-2">
        <button data-testid="composer-attach-btn" disabled={locked || busy || note} onClick={() => fileRef.current.click()} className="h-9 w-9 shrink-0 rounded-full border flex items-center justify-center text-slate-600 disabled:opacity-40" title="Attach image or document"><Paperclip size={16} /></button>
        <input ref={fileRef} type="file" hidden data-testid="composer-file-input" accept="image/jpeg,image/png,application/pdf,.doc,.docx,.xls,.xlsx,audio/*,video/mp4" onChange={(e) => attach(e.target.files[0])} />
        <textarea data-testid="composer-input" rows={2} disabled={locked} value={text} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
          placeholder={note ? "Write an internal note (never sent to customer)…" : locked ? "Use a template to continue" : "Type a WhatsApp reply…"}
          className={`flex-1 resize-none rounded-lg border px-3 py-2 text-sm outline-none disabled:bg-slate-50 ${note ? "bg-amber-50 border-amber-200" : ""}`} />
        <button data-testid="composer-send-btn" disabled={locked || busy || !text.trim()} onClick={submit} className="h-9 w-9 shrink-0 rounded-full bg-emerald-600 text-white flex items-center justify-center disabled:opacity-40"><Send size={15} /></button>
      </div>
    </div>
  );
};
