import React, { useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { User, LogOut, FileText, MoreHorizontal, Users, Database, HeartHandshake } from 'lucide-react';
import useAuthStore from '../store/authStore';
import api from '../services/api';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '../components/ui/sheet';

const TelecallerLayout = () => {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const [moreOpen, setMoreOpen] = useState(false);
  
  // Handle logout
  const handleLogout = async () => {
    try {
      await api.post('/auth/logout');
    } catch (error) {
      console.log('Logout API call failed');
    }
    logout();
    navigate('/login');
  };

  // Primary nav items - 5 items max for mobile: Dashboard, Data, Files, Follow-ups, More
  const primaryNavItems = [
    { path: '/agent/files', icon: FileText, label: 'Files' },
    { path: '/agent/customers-campaigns', icon: HeartHandshake, label: 'Customers & Campaigns' },
  ];
  
  // More menu items - overflow (Reports removed - shown inline on Dashboard for GPs)
  const moreNavItems = [
    { path: '/agent/profile', icon: User, label: 'Profile' },
    ...(user?.meta_access ? [{ path: '/meta', icon: Database, label: 'Meta CRM' }] : []),
  ];

  // Team menu items - only visible for Team Leads (is_tl = true)
  const teamNavItems = user?.is_tl ? [
    { path: '/agent/team', icon: Users, label: 'My Team' },
    { path: '/agent/team/files', icon: FileText, label: 'Team Files' },
  ] : [];

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-40">
        <div className="px-4 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-green-600">BANKEZEE</h1>
            <p className="text-xs text-gray-500 -mt-1">Connect</p>
          </div>
          <div className="flex items-center gap-2">
            {/* Logout Button */}
            <button
              onClick={handleLogout}
              className="p-2 rounded-full bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
              data-testid="logout-btn"
            >
              <LogOut size={16} />
            </button>
            
            <div className="w-8 h-8 rounded-full bg-green-600 flex items-center justify-center">
              <span className="text-white font-bold text-sm">
                {user?.name?.charAt(0).toUpperCase()}
              </span>
            </div>
          </div>
        </div>

      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-auto pb-20">
        <Outlet />
      </main>

      {/* Bottom Navigation: Files, Customers & Campaigns, More */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 safe-area-bottom z-40">
        <div className="flex items-center justify-around py-2">
          {primaryNavItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.exact}
              className={({ isActive }) =>
                `flex flex-col items-center py-1 px-2 rounded-lg transition-colors ${
                  isActive
                    ? 'text-green-600'
                    : 'text-gray-500 hover:text-gray-700'
                }`
              }
              data-testid={`nav-${item.label.toLowerCase().replace('-', '')}`}
            >
              <item.icon size={22} />
              <span className="text-xs mt-0.5 font-medium">{item.label}</span>
            </NavLink>
          ))}
          
          {/* More Menu Drawer */}
          <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
            <SheetTrigger asChild>
              <button
                className={`flex flex-col items-center py-1 px-2 rounded-lg transition-colors ${
                  moreOpen ? 'text-green-600' : 'text-gray-500 hover:text-gray-700'
                }`}
                data-testid="nav-more"
              >
                <MoreHorizontal size={22} />
                <span className="text-xs mt-0.5 font-medium">More</span>
              </button>
            </SheetTrigger>
            <SheetContent side="bottom" className="h-auto max-h-[70vh] rounded-t-2xl">
              <SheetHeader className="pb-4">
                <SheetTitle className="text-left">More Options</SheetTitle>
              </SheetHeader>
              <div className="grid grid-cols-3 gap-4 pb-6">
                {moreNavItems.map((item) => (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    onClick={() => setMoreOpen(false)}
                    className={({ isActive }) =>
                      `flex flex-col items-center py-3 px-2 rounded-xl transition-colors ${
                        isActive
                          ? 'bg-green-50 text-green-600'
                          : 'text-gray-600 hover:bg-gray-50'
                      }`
                    }
                    data-testid={`more-${item.label.toLowerCase()}`}
                  >
                    <item.icon size={24} />
                    <span className="text-xs mt-1.5 font-medium">{item.label}</span>
                  </NavLink>
                ))}
              </div>

              {/* Team Section - Only visible for Team Leads */}
              {teamNavItems.length > 0 && (
                <>
                  <div className="border-t border-gray-200 pt-4 pb-2">
                    <h3 className="text-sm font-semibold text-gray-500 px-2 mb-3 flex items-center gap-2">
                      <Users size={16} />
                      Team Lead View
                    </h3>
                    <div className="grid grid-cols-4 gap-2">
                      {teamNavItems.map((item) => (
                        <NavLink
                          key={item.path}
                          to={item.path}
                          onClick={() => setMoreOpen(false)}
                          className={({ isActive }) =>
                            `flex flex-col items-center py-2.5 px-1 rounded-xl transition-colors ${
                              isActive
                                ? 'bg-blue-50 text-blue-600'
                                : 'text-gray-600 hover:bg-gray-50'
                            }`
                          }
                          data-testid={`team-nav-${item.label.toLowerCase().replace(' ', '-')}`}
                        >
                          <item.icon size={20} />
                          <span className="text-[10px] mt-1 font-medium text-center leading-tight">{item.label}</span>
                        </NavLink>
                      ))}
                    </div>
                  </div>
                </>
              )}
              
              {/* Break & Logout in More menu */}
              <div className="border-t border-gray-200 pt-4 space-y-2">
                <button
                  onClick={() => { setMoreOpen(false); handleLogout(); }}
                  className="w-full flex items-center gap-3 px-4 py-3 text-red-600 hover:bg-red-50 rounded-xl transition-colors"
                  data-testid="more-logout"
                >
                  <LogOut size={20} />
                  <span className="font-medium">Logout</span>
                </button>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </nav>

    </div>
  );
};

export default TelecallerLayout;
