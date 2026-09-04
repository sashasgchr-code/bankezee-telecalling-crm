import React, { useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { LayoutDashboard, FolderOpen, BarChart3, LogOut, ClipboardList, Clock, Calendar, MoreHorizontal, Users, PhoneCall } from 'lucide-react';
import useAuthStore from '../store/authStore';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '../components/ui/sheet';

const ManagerLayout = () => {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const [moreOpen, setMoreOpen] = useState(false);

  const handleLogout = () => {
    if (window.confirm('Are you sure you want to logout?')) {
      logout();
      navigate('/login');
    }
  };

  // Primary nav items - 5 items max for mobile (Manager has no Data section)
  const primaryNavItems = [
    { path: '/manager', icon: LayoutDashboard, label: 'Dashboard', exact: true },
    { path: '/manager/files', icon: FolderOpen, label: 'Files' },
    { path: '/manager/tracking', icon: ClipboardList, label: 'Track Report' },
    { path: '/manager/reports', icon: BarChart3, label: 'Reports' },
  ];

  // More menu items - Reports is now a primary nav item
  const moreNavItems = [
    { path: '/manager/attendance', icon: Clock, label: 'Attendance' },
    { path: '/manager/leave', icon: Calendar, label: 'Leave' },
  ];

  // Team pages for Manager view - Team Data / Team Files removed (covered by main nav)
  const teamNavItems = [
    { path: '/manager/team', icon: Users, label: 'My Team' },
    { path: '/manager/team/calls', icon: PhoneCall, label: 'Team Calls' },
  ];

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-40">
        <div className="px-4 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-green-600">BANKEZEE</h1>
            <p className="text-xs text-gray-500 -mt-1">Connect Manager</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right hidden sm:block">
              <p className="text-sm font-medium text-gray-900">{user?.name}</p>
              <p className="text-xs text-gray-500">Manager</p>
            </div>
            <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center">
              <span className="text-white font-bold">
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

      {/* Bottom Navigation - 5 items: Dashboard, Files, Track Report, Reports, More */}
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
                    ? 'text-blue-600'
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
                  moreOpen ? 'text-blue-600' : 'text-gray-500 hover:text-gray-700'
                }`}
                data-testid="nav-more"
              >
                <MoreHorizontal size={22} />
                <span className="text-xs mt-0.5 font-medium">More</span>
              </button>
            </SheetTrigger>
            <SheetContent side="bottom" className="h-auto max-h-[80vh] rounded-t-2xl">
              <SheetHeader className="pb-4">
                <SheetTitle className="text-left">More Options</SheetTitle>
              </SheetHeader>
              <div className="grid grid-cols-3 gap-4 pb-4">
                {moreNavItems.map((item) => (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    onClick={() => setMoreOpen(false)}
                    className={({ isActive }) =>
                      `flex flex-col items-center py-3 px-2 rounded-xl transition-colors ${
                        isActive
                          ? 'bg-blue-50 text-blue-600'
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

              {/* Team Section for Manager */}
              <div className="border-t border-gray-200 pt-4 pb-2">
                <h3 className="text-sm font-semibold text-gray-500 px-2 mb-3 flex items-center gap-2">
                  <Users size={16} />
                  Team Management
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
              
              {/* Logout in More menu */}
              <div className="border-t border-gray-200 pt-4">
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

export default ManagerLayout;
