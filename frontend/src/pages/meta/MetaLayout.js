import React, { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import useAuthStore from "../../store/authStore";
import { useMetaUser, BRAND, BRAND_DARK } from "./metaCommon";
import { LayoutDashboard, Users2, UserCircle2, LogOut, Landmark, ShieldCheck, FolderOpen, PhoneCall, BarChart3, Menu, ArrowLeft } from "lucide-react";

export default function MetaLayout() {
  const { logout, user } = useAuthStore();
  const meta = useMetaUser();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const baseRoute = user?.role === "admin" ? "/admin" : user?.role === "manager" ? "/manager" : user?.role === "hr" ? "/hr" : "/agent";

  const navItems = [
    { to: "/meta", label: "Dashboard", icon: LayoutDashboard, testid: "meta-nav-dashboard", end: true },
    { to: "/meta/leads", label: "Leads", icon: Users2, testid: "meta-nav-leads" },
    { to: "/meta/files", label: "Files", icon: FolderOpen, testid: "meta-nav-files" },
    { to: "/meta/file-reports", label: "File Reports", icon: BarChart3, testid: "meta-nav-file-reports" },
    { to: "/meta/call-logs", label: "Call Logs", icon: PhoneCall, testid: "meta-nav-call-logs" },
    ...(meta.isAdmin ? [
      { to: "/meta/partners", label: "Growth Partners", icon: UserCircle2, testid: "meta-nav-partners" },
      { to: "/meta/users", label: "User Management", icon: ShieldCheck, testid: "meta-nav-users" },
    ] : []),
  ];

  const linkClass = ({ isActive }) =>
    `flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors ${
      isActive ? "text-white" : "text-white/70 hover:bg-white/5 hover:text-white"
    }`;

  return (
    <div className="min-h-screen bg-slate-50" data-testid="meta-app">
      {/* Mobile top bar */}
      <div className="md:hidden fixed top-0 left-0 right-0 h-14 flex items-center gap-2 px-4 z-40 text-white" style={{ background: BRAND_DARK }}>
        <button data-testid="meta-mobile-menu-btn" onClick={() => setOpen(true)}><Menu size={22} /></button>
        <span className="font-bold">Meta CRM</span>
      </div>
      {open && <div className="md:hidden fixed inset-0 bg-black/40 z-40" onClick={() => setOpen(false)} />}

      <aside
        className={`w-64 fixed h-screen text-white flex flex-col z-50 transition-transform duration-200 md:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}
        style={{ background: BRAND_DARK }}
        onClick={() => setOpen(false)}
      >
        <div className="h-16 flex items-center gap-2 px-5 border-b border-white/10">
          <div className="h-8 w-8 rounded-md flex items-center justify-center" style={{ background: BRAND }}>
            <Landmark className="h-5 w-5 text-white" />
          </div>
          <span className="text-lg font-bold">BankEzee<span className="text-white/50"> Meta</span></span>
        </div>

        <button
          data-testid="meta-back-to-connect"
          onClick={() => navigate(baseRoute)}
          className="mx-3 mt-3 flex items-center gap-2 px-3 py-2 rounded-md text-xs font-medium text-white/70 border border-white/10 hover:bg-white/5 hover:text-white transition-colors"
        >
          <ArrowLeft size={15} /> Back to Connect
        </button>

        <nav className="flex-1 p-3 space-y-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              data-testid={item.testid}
              style={({ isActive }) => (isActive ? { background: BRAND } : {})}
              className={linkClass}
            >
              <item.icon size={20} />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="p-3 border-t border-white/10">
          <div className="flex items-center gap-3 px-2 py-2 mb-1">
            <div className="h-9 w-9 rounded-full flex items-center justify-center text-sm font-semibold overflow-hidden" style={{ background: "rgba(15,82,186,0.3)" }}>
              {meta.picture ? <img src={meta.picture} alt="" className="h-full w-full object-cover" /> : (meta.name?.[0] || "U").toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium truncate" data-testid="meta-sidebar-user-name">{meta.name}</p>
              <p className="text-xs text-white/50 capitalize">{meta.role?.replace("_", " ") || "no role"}</p>
            </div>
          </div>
          <button
            data-testid="meta-logout-btn"
            onClick={() => { logout(); navigate("/login"); }}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium text-white/70 hover:bg-white/5 hover:text-white transition-colors"
          >
            <LogOut size={20} /> Logout
          </button>
        </div>
      </aside>

      <main className="md:ml-64 pt-14 md:pt-0 min-h-screen">
        <Outlet />
      </main>
    </div>
  );
}
