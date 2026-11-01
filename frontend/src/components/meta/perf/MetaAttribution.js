import React, { useEffect, useState } from "react";
import api from "../../../services/api";
import { Megaphone } from "lucide-react";

const sel = "border border-slate-200 rounded-md px-2 py-1 text-xs bg-white max-w-[220px]";

// Meta ad attribution filters for the Leads table (IDs are the keys; names are display only).
export const AdAttributionFilter = ({ value, onChange }) => {
  const [o, setO] = useState({ campaigns: [], adsets: [], ads: [] });
  useEffect(() => { api.get("/meta/ad-perf/options").then(({ data }) => setO(data)).catch(() => {}); }, []);
  const v = value;
  return (
    <div className="flex flex-wrap items-center gap-1.5 mb-3 text-xs" data-testid="lead-ad-filters">
      <Megaphone size={14} className="text-slate-400" />
      <select data-testid="lead-filter-campaign" className={sel} value={v.campaign_id} onChange={(e) => onChange({ ...v, campaign_id: e.target.value, adset_id: "", ad_id: "" })}>
        <option value="">All campaigns</option>{o.campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <select data-testid="lead-filter-adset" className={sel} value={v.adset_id} onChange={(e) => onChange({ ...v, adset_id: e.target.value, ad_id: "" })}>
        <option value="">All ad sets</option>{o.adsets.filter((a) => !v.campaign_id || a.campaign_id === v.campaign_id).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
      <select data-testid="lead-filter-ad" className={sel} value={v.ad_id} onChange={(e) => onChange({ ...v, ad_id: e.target.value })}>
        <option value="">All ads</option>{o.ads.filter((a) => (!v.campaign_id || a.campaign_id === v.campaign_id) && (!v.adset_id || a.adset_id === v.adset_id)).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
      <select data-testid="lead-filter-attribution" className={sel} value={v.attribution} onChange={(e) => onChange({ ...v, attribution: e.target.value })}>
        <option value="">Attribution: all</option><option value="available">Available</option><option value="missing">Unknown / Not available</option>
      </select>
    </div>
  );
};

const Row = ({ k, v }) => <div className="flex justify-between gap-3 py-1 border-b border-slate-100"><span className="text-slate-500">{k}</span><span className="text-right font-medium text-slate-800 break-all">{v || "Unknown / Not available"}</span></div>;

// Original captured Meta attribution (+ latest names if they changed). Preserved through lead → file conversion.
export const MetaAttribution = ({ lead }) => {
  const a = lead.meta_attr;
  const l = lead.meta_attr_latest || {};
  const changed = (k) => (a && l[k] && l[k] !== a[k] ? ` (now: ${l[k]})` : "");
  return (
    <div className="mt-4 rounded-lg border border-slate-200 p-3 text-xs" data-testid="lead-meta-attribution">
      <p className="font-semibold text-slate-700 mb-1.5 flex items-center gap-1.5"><Megaphone size={14} />Meta ad attribution</p>
      {!a ? <p className="text-slate-500" data-testid="lead-attr-unknown">Unknown / Not available</p> : (<>
        <Row k="Campaign" v={a.campaign_name && `${a.campaign_name}${changed("campaign_name")}`} /><Row k="Ad set" v={a.adset_name && `${a.adset_name}${changed("adset_name")}`} />
        <Row k="Ad" v={a.ad_name && `${a.ad_name}${changed("ad_name")}`} /><Row k="Form" v={a.form_name} />
        <Row k="Campaign / Ad set / Ad ID" v={`${a.campaign_id || "—"} / ${a.adset_id || "—"} / ${a.ad_id || "—"}`} />
        <Row k="Meta lead ID" v={a.meta_lead_id} /><Row k="Ad account ID" v={a.ad_account_id} /><Row k="Form ID" v={a.form_id} />
        <Row k="Meta lead created" v={a.meta_created_time} /><Row k="CRM imported" v={a.crm_imported_at && new Date(a.crm_imported_at).toLocaleString("en-IN")} />
        <Row k="Import source" v={`${a.import_source}${a.backfilled_at ? " · backfilled from sheet by Meta lead ID" : ""}`} />
      </>)}
    </div>
  );
};
