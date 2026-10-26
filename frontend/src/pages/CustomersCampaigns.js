import React, { useEffect, useState } from "react";
import api from "../services/api";
import { Users, Megaphone, Cake, FileText, History } from "lucide-react";
import { B } from "../components/cc/ccShared";
import { CustomersTab } from "../components/cc/CustomersTab";
import { CampaignsTab } from "../components/cc/CampaignsTab";
import { BirthdayTab } from "../components/cc/BirthdayTab";
import { TemplatesTab } from "../components/cc/TemplatesTab";
import { SettingsDialog } from "../components/cc/SettingsDialog";

const TABS = [
  ["customers", "Approved & Disbursed Customers", Users, () => true],
  ["campaigns", "WhatsApp Campaigns", Megaphone, (m) => m.can_campaign],
  ["birthdays", "Birthday Automation", Cake, () => true],
  ["templates", "Message Templates", FileText, (m) => m.can_campaign || m.is_admin],
  ["history", "Campaign History", History, (m) => m.can_campaign || m.role === "manager"],
];

export default function CustomersCampaigns() {
  const [me, setMe] = useState(null);
  const [tab, setTab] = useState(() => sessionStorage.getItem("ccTab") || "customers");
  const loadMe = () => api.get("/cc/me").then(({ data }) => setMe(data));
  useEffect(() => { loadMe(); }, []);
  useEffect(() => { sessionStorage.setItem("ccTab", tab); }, [tab]);
  if (!me) return <div className="p-8 text-sm text-slate-500">Loading…</div>;
  const tabs = TABS.filter(([, , , ok]) => ok(me));
  const active = tabs.find(([k]) => k === tab) ? tab : "customers";
  return (
    <div className="min-h-screen p-4 md:p-6 space-y-4" style={{ background: B.bg }} data-testid="cc-page">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-extrabold" style={{ color: B.navy }}>Customers & Campaigns</h1>
        <span data-testid="cc-mode-badge" className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${me.live_sending ? "bg-red-100 text-red-700" : "bg-violet-100 text-violet-700"}`}>{me.live_sending ? "LIVE SENDING" : "MOCK MODE"}</span>
        <div className="ml-auto">{me.is_admin && <SettingsDialog onChanged={loadMe} />}</div>
      </div>
      <div className="flex flex-wrap gap-1 border-b border-slate-200" role="tablist">
        {tabs.map(([k, label, Icon]) => (
          <button key={k} type="button" role="tab" data-testid={`cc-tab-${k}`} onClick={() => setTab(k)}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors ${active === k ? "border-[#155EEF] text-[#155EEF]" : "border-transparent text-slate-500 hover:text-slate-800"}`}>
            <Icon size={15} />{label}
          </button>))}
      </div>
      {active === "customers" && <CustomersTab me={me} />}
      {active === "campaigns" && <CampaignsTab me={me} />}
      {active === "birthdays" && <BirthdayTab me={me} />}
      {active === "templates" && <TemplatesTab me={me} />}
      {active === "history" && <CampaignsTab me={me} historyOnly />}
    </div>
  );
}
