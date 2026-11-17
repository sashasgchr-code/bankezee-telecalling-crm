import React, { useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { User, LogOut, FileText, Menu, Users, Database, Wallet, Percent, Share2, Image as ImageIcon, IdCard, FileSignature, LifeBuoy } from 'lucide-react';
import { GpTasksBanner } from '../pages/gp/GpShell';
import useAuthStore from '../store/authStore';
import api from '../services/api';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '../components/ui/sheet';

const GP_ROLES = ['growth_partner', 'telecaller', 'sales_agent', 'partner', 'team_leader'];

const DrawerLink = ({ item, onClick }) => (
  <NavLink to={item.path} end={item.end} onClick={onClick} data-testid={`menu-${item.label.toLowerCase().replace(/[^a-z]+/g, '-')}`}
    className={({ isActive }) => `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${isActive ? 'bg-green-50 text-green-700' : 'text-gray-700 hover:bg-gray-50'}`}>
    <item.icon size={18} />{item.label}
  </NavLink>
);

const TelecallerLayout = () => {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const isGp = GP_ROLES.includes(user?.role);
  const profilePath = isGp ? '/agent/partner-profile' : '/agent/profile';

  const handleLogout = async () => {
    try { await api.post('/auth/logout'); } catch (error) { console.log('Logout API call failed'); }
    logout();
    navigate('/login');
  };

  const primaryNavItems = [
    { path: '/agent/files', icon: FileText, label: 'Files', end: true },
    { path: profilePath, icon: User, label: 'Profile' },
  ];
  const menuItems = [
    ...primaryNavItems,
    ...(isGp ? [
      { path: '/agent/payouts', icon: Wallet, label: 'Payouts' },
      { path: '/agent/payout-structure', icon: Percent, label: 'Payout Structure' },
      { path: '/agent/share', icon: Share2, label: 'Link & QR' },
      { path: '/agent/creatives', icon: ImageIcon, label: 'Creatives' },
      { path: '/agent/card', icon: IdCard, label: 'Card & Certificate' },
      { path: '/agent/agreement', icon: FileSignature, label: 'Agreement' },
      { path: '/agent/support', icon: LifeBuoy, label: 'Support' },
    ] : []),
    ...(user?.meta_access ? [{ path: '/meta', icon: Database, label: 'Meta CRM' }] : []),
  ];
  const teamNavItems = user?.is_tl ? [
    { path: '/agent/team', icon: Users, label: 'My Team', end: true },
    { path: '/agent/team/files', icon: FileText, label: 'Team Files' },
  ] : [];
  const close = () => setMenuOpen(false);

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-40">
        <div className="px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => setMenuOpen(true)} className="p-2 -ml-2 rounded-lg text-gray-700 hover:bg-gray-100 transition-colors" data-testid="menu-open" aria-label="Open menu"><Menu size={22} /></button>
            <div><h1 className="text-xl font-bold text-green-600">BANKEZEE</h1><p className="text-xs text-gray-500 -mt-1">Connect</p></div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handleLogout} className="p-2 rounded-full bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors" data-testid="logout-btn"><LogOut size={16} /></button>
            <button onClick={() => navigate(profilePath)} className="w-8 h-8 rounded-full bg-green-600 flex items-center justify-center" data-testid="header-avatar" aria-label="Profile">
              <span className="text-white font-bold text-sm">{user?.name?.charAt(0).toUpperCase()}</span>
            </button>
          </div>
        </div>
      </header>

      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="left" className="w-72 p-0 flex flex-col" data-testid="menu-drawer">
          <SheetHeader className="px-5 pt-5 pb-3 border-b border-gray-100">
            <SheetTitle className="text-left"><span className="text-green-600 font-bold">BANKEZEE</span> <span className="text-xs text-gray-500 font-normal">Connect</span></SheetTitle>
            <p className="text-left text-xs text-gray-500 truncate">{user?.name}</p>
          </SheetHeader>
          <nav className="flex-1 overflow-y-auto p-3 space-y-0.5">
            {menuItems.map((item) => <DrawerLink key={item.path} item={item} onClick={close} />)}
            {teamNavItems.length > 0 && <>
              <p className="text-[11px] font-semibold uppercase text-gray-400 px-3 pt-4 pb-1">Team Lead View</p>
              {teamNavItems.map((item) => <DrawerLink key={item.path} item={item} onClick={close} />)}
            </>}
          </nav>
          <div className="p-3 border-t border-gray-100">
            <button onClick={() => { close(); handleLogout(); }} className="w-full flex items-center gap-3 px-3 py-2.5 text-red-600 hover:bg-red-50 rounded-lg text-sm font-medium" data-testid="menu-logout"><LogOut size={18} />Logout</button>
          </div>
        </SheetContent>
      </Sheet>

      <main className="flex-1 overflow-auto pb-20">
        {isGp && <GpTasksBanner />}
        <Outlet />
      </main>

      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 safe-area-bottom z-40">
        <div className="flex items-center justify-around py-2">
          {primaryNavItems.map((item) => (
            <NavLink key={item.path} to={item.path} end={item.end} data-testid={`nav-${item.label.toLowerCase()}`}
              className={({ isActive }) => `flex flex-col items-center py-1 px-2 rounded-lg transition-colors ${isActive ? 'text-green-600' : 'text-gray-500 hover:text-gray-700'}`}>
              <item.icon size={22} /><span className="text-xs mt-0.5 font-medium">{item.label}</span>
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
};

export default TelecallerLayout;
