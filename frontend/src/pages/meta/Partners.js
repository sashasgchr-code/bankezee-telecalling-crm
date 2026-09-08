import React, { useEffect, useState } from "react";
import api from "../../services/api";
import { BRAND, BRAND_DARK } from "./metaCommon";
import { UserCircle2, Mail, Phone, TrendingUp } from "lucide-react";

export default function MetaPartners() {
  const [partners, setPartners] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { api.get("/meta/partners").then(({ data }) => setPartners(data)).catch(() => {}).finally(() => setLoading(false)); }, []);

  return (
    <div data-testid="meta-partners">
      <header className="h-16 border-b border-slate-200 bg-white px-4 md:px-8 flex items-center sticky top-0 z-30">
        <h1 className="text-xl font-bold" style={{ color: BRAND_DARK }}>Growth Partners</h1>
      </header>
      <div className="p-4 md:p-8">
        {loading ? <p className="text-slate-400 text-sm">Loading...</p>
          : partners.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-md p-12 text-center text-slate-400 text-sm shadow-sm">No growth partners yet. Partners appear here after they register.</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="meta-partners-grid">
              {partners.map((p) => (
                <div key={p.user_id} data-testid={`meta-partner-card-${p.user_id}`} className="bg-white border border-slate-200 rounded-md p-5 shadow-sm transition-colors">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="h-11 w-11 rounded-full flex items-center justify-center overflow-hidden" style={{ background: "rgba(15,82,186,0.1)", color: BRAND }}>
                      {p.picture ? <img src={p.picture} alt="" className="h-full w-full object-cover" /> : <UserCircle2 size={24} />}
                    </div>
                    <div className="min-w-0"><p className="text-sm font-semibold text-slate-800 truncate">{p.name}</p><p className="text-xs text-slate-400">Growth Partner</p></div>
                  </div>
                  <div className="space-y-1.5 mb-4">
                    <p className="text-xs text-slate-600 flex items-center gap-2"><Mail size={13} className="text-slate-400" />{p.email}</p>
                    {p.phone && <p className="text-xs text-slate-600 flex items-center gap-2"><Phone size={13} className="text-slate-400" />{p.phone}</p>}
                  </div>
                  <div className="grid grid-cols-2 gap-2 pt-3 border-t border-slate-100">
                    <div><p className="text-xs text-slate-400 uppercase tracking-wider">Assigned</p><p className="text-lg font-semibold" style={{ color: BRAND_DARK }}>{p.assigned_leads}</p></div>
                    <div><p className="text-xs text-slate-400 uppercase tracking-wider flex items-center gap-1"><TrendingUp size={11} /> Converted</p><p className="text-lg font-semibold text-emerald-600">{p.converted_leads}</p></div>
                  </div>
                </div>
              ))}
            </div>
          )}
      </div>
    </div>
  );
}
