import React, { useEffect, useState } from "react";
import api from "../../services/api";
import { toast } from "sonner";
import { RefreshCw, Image, Video, FileText, Link2, Reply } from "lucide-react";
import { B, StatusBadge, fmtDT, btn, errMsg } from "./ccShared";

const HEADER_ICON = { IMAGE: Image, VIDEO: Video, DOCUMENT: FileText };

export const TemplatePreview = ({ t }) => {
  const Icon = HEADER_ICON[t.header_type];
  return (
    <div className="rounded-lg bg-[#e7ffdb] border border-emerald-100 p-3 max-w-sm text-[13px]" data-testid={`cc-tpl-preview-${t.name}`}>
      {Icon && <div className="h-24 rounded bg-white/70 flex items-center justify-center text-slate-400 mb-2 text-xs gap-1"><Icon size={16} /> {t.header_type.toLowerCase()} header</div>}
      {t.header_type === "TEXT" && <p className="font-bold mb-1">{t.header_text}</p>}
      <p className="whitespace-pre-wrap">{t.body}</p>
      {t.footer && <p className="text-[11px] text-slate-500 mt-1">{t.footer}</p>}
      {t.buttons?.length > 0 && <div className="mt-2 border-t border-emerald-200 pt-1 space-y-1">{t.buttons.map((b, i) => (
        <p key={i} className="text-center text-[12px] font-semibold text-sky-700 flex items-center justify-center gap-1">{b.type === "URL" ? <Link2 size={12} /> : <Reply size={12} />}{b.text}</p>))}</div>}
    </div>
  );
};

export const TemplatesTab = ({ me }) => {
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const load = () => api.get("/cc/templates").then(({ data }) => setItems(data)).catch((e) => toast.error(errMsg(e)));
  useEffect(() => { load(); }, []);
  const sync = async () => {
    setBusy(true);
    try { const { data } = await api.post("/cc/templates/sync"); toast.success(`Synced ${data.count} templates from Meta`); load(); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-4" data-testid="cc-templates-tab">
      <div className="flex flex-wrap items-center gap-3">
        {me.is_admin && <button type="button" data-testid="cc-tpl-sync" onClick={sync} disabled={busy} className={btn("dark")}><RefreshCw size={14} className={busy ? "animate-spin" : ""} /> Sync Templates From Meta</button>}
        <p className="text-xs text-slate-500">Create, edit and submit templates in Meta WhatsApp Manager. Only APPROVED templates can be used for campaigns.</p>
      </div>
      {items.length === 0 && <p className="text-sm text-slate-400">No templates synced yet.</p>}
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
        {items.map((t) => (
          <div key={`${t.name}|${t.language}`} className="bg-white border border-slate-200 rounded-xl p-4 space-y-2" data-testid={`cc-tpl-${t.name}`}>
            <div className="flex items-center justify-between gap-2">
              <p className="font-bold text-sm" style={{ color: B.navy }}>{t.name}</p>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${t.sendable ? "bg-emerald-50 text-emerald-700" : t.status === "REJECTED" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"}`}>{t.status}</span>
            </div>
            <p className="text-[11px] text-slate-500">{t.category} · {t.language} · Header: {t.header_type} · Vars: {[...(t.header_vars || []), ...(t.body_vars || [])].join(", ") || "none"} · Synced {fmtDT(t.last_synced)}</p>
            <TemplatePreview t={t} />
            {!t.sendable && <p className="text-[11px] text-amber-700">Not selectable for sending until Meta approves it.</p>}
          </div>))}
      </div>
    </div>
  );
};

export { StatusBadge };
