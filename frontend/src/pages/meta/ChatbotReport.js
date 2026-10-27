import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../../services/api";
import { BRAND, BRAND_DARK } from "./metaCommon";
import WhatsAppFunnel from "./WhatsAppFunnel";
import { Bot, MessageCircle, Loader2, ExternalLink } from "lucide-react";

const STAGES = ["All", "Not Started", "In Progress", "Completed", "Expired"];

const stageBadge = (s) => ({
  "Completed": "bg-emerald-100 text-emerald-700",
  "In Progress": "bg-amber-100 text-amber-700",
  "Expired": "bg-red-100 text-red-700",
  "Not Started": "bg-slate-100 text-slate-500",
}[s] || "bg-slate-100 text-slate-500");

const KPI = ({ label, value, accent }) => (
  <div className="bg-white border border-slate-200 rounded-md p-4" data-testid={`kpi-${label.toLowerCase().replace(/\s/g, "-")}`}>
    <p className="text-[11px] uppercase tracking-wider text-slate-400">{label}</p>
    <p className={`text-2xl font-semibold ${accent ? "text-emerald-600" : "text-slate-800"}`}>{value}</p>
  </div>
);

export default function ChatbotReport() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [stage, setStage] = useState("All");
  const [tab, setTab] = useState("website");
  const nav = useNavigate();

  const load = async (s) => {
    setLoading(true);
    try {
      const params = s && s !== "All" ? `?stage=${encodeURIComponent(s)}` : "";
      const { data } = await api.get(`/meta/chatbot/report${params}`);
      setData(data);
    } catch (e) { setData({ counts: {}, rows: [] }); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(stage); /* eslint-disable-next-line */ }, [stage]);

  const c = data?.counts || {};
  const rows = data?.rows || [];

  return (
    <div className="p-6 max-w-7xl mx-auto" data-testid="chatbot-report-page">
      <div className="flex items-center gap-2 mb-5">
        <Bot size={22} style={{ color: BRAND }} />
        <h1 className="text-xl font-semibold" style={{ color: BRAND_DARK }}>Chatbot Qualification Funnel</h1>
      </div>
      <div className="flex gap-2 mb-5">
        {[["website", "Website chatbot"], ["whatsapp", "WhatsApp chatbot"]].map(([k, l]) => (
          <button key={k} data-testid={`chatbot-report-tab-${k}`} onClick={() => setTab(k)} className={`px-4 py-1.5 rounded-full text-sm border ${tab === k ? "text-white border-transparent" : "border-slate-200 text-slate-600"}`} style={tab === k ? { background: BRAND } : {}}>{l}</button>
        ))}
      </div>
      {tab === "whatsapp" ? <WhatsAppFunnel /> : <>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-6">
        <KPI label="Total" value={c.total ?? 0} />
        <KPI label="WhatsApp Sent" value={c.wa_sent ?? 0} />
        <KPI label="Link Created" value={c.link_created ?? 0} />
        <KPI label="Opened" value={c.opened ?? 0} />
        <KPI label="In Progress" value={c.in_progress ?? 0} />
        <KPI label="Completed" value={c.completed ?? 0} accent />
        <KPI label="Abandoned" value={c.abandoned ?? 0} />
      </div>

      <div className="flex items-center gap-2 mb-3 flex-wrap">
        {STAGES.map((s) => (
          <button key={s} data-testid={`filter-${s.toLowerCase().replace(/\s/g, "-")}`} onClick={() => setStage(s)}
            className={`text-xs px-3 py-1.5 rounded-full font-medium border transition-colors ${stage === s ? "text-white border-transparent" : "text-slate-600 border-slate-200 hover:bg-slate-50"}`}
            style={stage === s ? { background: BRAND } : {}}>{s}</button>
        ))}
      </div>

      <div className="bg-white border border-slate-200 rounded-md overflow-hidden">
        {loading ? (
          <div className="p-8 flex items-center justify-center text-slate-400 gap-2"><Loader2 size={16} className="animate-spin" /> Loading…</div>
        ) : rows.length === 0 ? (
          <p className="p-8 text-center text-slate-400 text-sm">No leads in this stage yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-100 bg-slate-50/50">
                  <th className="px-4 py-3">Customer</th>
                  <th className="px-4 py-3">Source</th>
                  <th className="px-4 py-3">WhatsApp</th>
                  <th className="px-4 py-3">Stage</th>
                  <th className="px-4 py-3">Progress</th>
                  <th className="px-4 py-3">Last Activity</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.lead_id} className="border-b border-slate-50 hover:bg-slate-50/50" data-testid={`report-row-${r.lead_id}`}>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-800">{r.name || "—"}</div>
                      <div className="text-xs text-slate-400">{r.phone}</div>
                    </td>
                    <td className="px-4 py-3"><span className="text-xs text-slate-500">{r.source}</span></td>
                    <td className="px-4 py-3">
                      {r.whatsapp_sent ? (
                        <span className="inline-flex items-center gap-1 text-xs text-green-700"><MessageCircle size={12} /> {r.whatsapp_status || "sent"}</span>
                      ) : <span className="text-xs text-slate-300">—</span>}
                    </td>
                    <td className="px-4 py-3"><span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${stageBadge(r.stage)}`}>{r.stage}{r.abandoned ? " · stalled" : ""}</span></td>
                    <td className="px-4 py-3 text-xs text-slate-600">{r.questions_total ? `${r.questions_completed}/${r.questions_total}` : "—"}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">{r.last_activity ? new Date(r.last_activity).toLocaleString() : "—"}</td>
                    <td className="px-4 py-3">
                      <button data-testid={`open-lead-${r.lead_id}`} onClick={() => nav(`/meta/leads/${r.lead_id}`)}
                        className="inline-flex items-center gap-1 text-xs font-medium hover:underline" style={{ color: BRAND }}>
                        Open <ExternalLink size={12} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      </>}
    </div>
  );
}
