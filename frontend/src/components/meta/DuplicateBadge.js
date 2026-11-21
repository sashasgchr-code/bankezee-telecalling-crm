import React from "react";
import { useNavigate } from "react-router-dom";
import { Copy } from "lucide-react";

const fmt = (d) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "");

export const DuplicateBadge = ({ lead, tid = "meta-duplicate-badge", full = false }) => {
  const navigate = useNavigate();
  const d = lead?.duplicate_of;
  if (!d?.lead_id) return null;
  const title = `Same mobile number as ${d.full_name || "an earlier lead"}${d.campaign_name ? ` · ${d.campaign_name}` : ""}${d.created_time ? ` · ${fmt(d.created_time)}` : ""}. Click to open it.`;
  return (
    <button type="button" data-testid={`${tid}-${lead.lead_id}`} title={title}
      onClick={(e) => { e.stopPropagation(); navigate(`/meta/leads/${d.lead_id}`); }}
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold border bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100 transition-colors whitespace-nowrap">
      <Copy size={10} /> {full ? `Duplicate of ${d.full_name || "earlier lead"}${d.created_time ? ` (${fmt(d.created_time)})` : ""}` : "Duplicate"}
    </button>
  );
};
