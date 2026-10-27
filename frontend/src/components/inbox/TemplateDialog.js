import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import api from "../../services/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { newClientId, errMsg } from "./inboxUtils";

const VAR_RE = /\{\{\s*([a-z0-9_]+)\s*\}\}/g;

export const TemplateDialog = ({ open, onClose, convId, customerName, onSent }) => {
  const [tpls, setTpls] = useState([]);
  const [key, setKey] = useState("");
  const [vals, setVals] = useState({});
  const [btns, setBtns] = useState({});
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) api.get("/inbox/templates").then(({ data }) => setTpls(data)).catch(() => {}); }, [open]);
  const tpl = useMemo(() => tpls.find((t) => `${t.name}|${t.language}` === key), [tpls, key]);
  useEffect(() => {
    if (!tpl) return;
    const v = {};
    [...(tpl.header_vars || []), ...(tpl.body_vars || [])].forEach((n) => { v[n] = /name/i.test(n) ? (customerName || "") : ""; });
    setVals(v); setBtns({}); setFile(null);
  }, [tpl, customerName]);
  const preview = (tpl?.body || "").replace(VAR_RE, (m, n) => vals[n] || m);
  const needsMedia = tpl && ["IMAGE", "VIDEO", "DOCUMENT"].includes(tpl.header_type);

  const send = async () => {
    setBusy(true);
    const fd = new FormData();
    fd.append("payload", JSON.stringify({ name: tpl.name, language: tpl.language, values: vals, buttons: btns, client_id: newClientId() }));
    if (file) fd.append("file", file);
    try {
      const { data } = await api.post(`/inbox/conversations/${convId}/template`, fd, { headers: { "Content-Type": "multipart/form-data" } });
      data.status === "failed" ? toast.error(`Template failed: ${data.error}`) : toast.success("Template sent");
      onSent(); onClose();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto" data-testid="template-dialog">
        <DialogHeader><DialogTitle>Send approved template</DialogTitle></DialogHeader>
        {tpls.length === 0 && <p className="text-sm text-slate-500" data-testid="template-empty">No approved templates. Sync templates in Customers &amp; Campaigns.</p>}
        <select data-testid="template-select" value={key} onChange={(e) => setKey(e.target.value)} className="w-full border rounded-md px-2 py-2 text-sm">
          <option value="">Select template…</option>
          {tpls.map((t) => <option key={`${t.name}|${t.language}`} value={`${t.name}|${t.language}`}>{t.name} · {t.category} · {t.language}</option>)}
        </select>
        {tpl && (
          <div className="space-y-2">
            {Object.keys(vals).map((n) => (
              <label key={n} className="block text-xs text-slate-600">{`{{${n}}}`}
                <input data-testid={`template-var-${n}`} value={vals[n]} onChange={(e) => setVals({ ...vals, [n]: e.target.value })} className="mt-0.5 w-full border rounded-md px-2 py-1.5 text-sm" />
              </label>
            ))}
            {(tpl.button_vars || []).map((b) => (
              <label key={b.index} className="block text-xs text-slate-600">Button "{b.text}" link value ({b.url})
                <input data-testid={`template-btn-${b.index}`} value={btns[b.index] || ""} onChange={(e) => setBtns({ ...btns, [b.index]: e.target.value })} className="mt-0.5 w-full border rounded-md px-2 py-1.5 text-sm" />
              </label>
            ))}
            {needsMedia && (
              <label className="block text-xs text-slate-600">Header {tpl.header_type.toLowerCase()} (welcome template uses its saved image if left empty)
                <input type="file" data-testid="template-header-file" onChange={(e) => setFile(e.target.files[0])} className="mt-0.5 block text-sm" />
              </label>
            )}
            <div className="rounded-md bg-slate-50 border p-3 text-sm whitespace-pre-wrap" data-testid="template-preview">
              {preview}{tpl.footer && <p className="text-xs text-slate-400 mt-2">{tpl.footer}</p>}
              {(tpl.buttons || []).map((b, i) => <p key={i} className="text-xs text-sky-700 mt-1 text-center">{b.text}</p>)}
            </div>
            <button data-testid="template-send-btn" disabled={busy} onClick={send} className="w-full rounded-md bg-emerald-600 text-white py-2 text-sm font-medium disabled:opacity-50">{busy ? "Sending…" : "Send template"}</button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
