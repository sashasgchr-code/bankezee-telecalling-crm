import React, { useEffect, useState } from "react";
import api from "../../services/api";
import { toast } from "sonner";
import { UserCog } from "lucide-react";
import { BRAND_DARK } from "./metaCommon";

// Self-contained Meta assignment card (Growth Partner + Processor) rendered as the
// File-Detail sidebarExtra. It owns its own data so the shared Connect File-Detail
// component stays untouched.
export default function MetaFileSidebar({ leadId, meta }) {
  const [lead, setLead] = useState(null);
  const [partners, setPartners] = useState([]);
  const [processors, setProcessors] = useState([]);
  const isStaffLike = ["admin", "ops", "processor"].includes(meta.role);

  const load = () => api.get(`/meta/leads/${leadId}`).then(({ data }) => setLead(data)).catch(() => {});
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [leadId]);
  useEffect(() => { if (meta.isAdmin) api.get("/meta/partners").then(({ data }) => setPartners(data)).catch(() => {}); }, [meta.isAdmin]);
  useEffect(() => { if (isStaffLike) api.get("/meta/processors").then(({ data }) => setProcessors(data)).catch(() => {}); }, [isStaffLike]);

  if (!lead) return null;

  const assignPartner = async (pid) => {
    try { const { data } = await api.patch(`/meta/leads/${leadId}/assign`, { partner_id: pid || null }); setLead(data); toast.success("Assignment updated"); }
    catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
  };
  const assignProcessor = async (pid) => {
    try { const { data } = await api.patch(`/meta/leads/${leadId}/processor`, { processor_id: pid || null }); setLead(data); toast.success("Processor updated"); }
    catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4" data-testid="meta-file-sidebar">
      <h2 className="font-semibold mb-3 flex items-center gap-2" style={{ color: BRAND_DARK }}>
        <UserCog size={18} /> Meta Assignment
      </h2>

      <label className="text-xs text-gray-500 block mb-1">Growth Partner</label>
      {meta.isAdmin ? (
        <select
          data-testid="meta-fd-partner-select"
          value={lead.assigned_partner_id || ""}
          onChange={(e) => assignPartner(e.target.value)}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white mb-4"
        >
          <option value="">Unassigned</option>
          {partners.map((p) => <option key={p.user_id} value={p.user_id}>{p.name}</option>)}
        </select>
      ) : (
        <p className="text-sm text-gray-800 mb-4">{lead.assigned_partner_name || "Not assigned"}</p>
      )}

      <label className="text-xs text-gray-500 block mb-1">Processor</label>
      {isStaffLike ? (
        <select
          data-testid="meta-fd-processor-select"
          value={lead.assigned_processor_id || ""}
          onChange={(e) => assignProcessor(e.target.value)}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white"
        >
          <option value="">Unassigned</option>
          {processors.map((p) => <option key={p.user_id} value={p.user_id}>{p.name}</option>)}
        </select>
      ) : (
        <p className="text-sm text-gray-800">{lead.assigned_processor_name || "Not assigned"}</p>
      )}
    </div>
  );
}
