import React from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Clock, Calendar, FolderOpen, LogOut } from 'lucide-react';
import useAuthStore from '../store/authStore';

const HrLayout = () => {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();

  const handleLogout = () => {
    if (window.confirm('Are you sure you want to logout?')) {
      logout();
      navigate('/login');
    }
  };

  const navItems = [
    { path: '/hr', icon: LayoutDashboard, label: 'Dashboard', exact: true, testId: 'hr-nav-dashboard' },
    { path: '/hr/attendance', icon: Clock, label: 'Attendance', testId: 'hr-nav-attendance' },
    { path: '/hr/leave', icon: Calendar, label: 'Leave Management', testId: 'hr-nav-leave' },
    { path: '/hr/files', icon: FolderOpen, label: 'Files', testId: 'hr-nav-files' },
  ];

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col" data-testid="hr-layout">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-40">
        <div className="px-4 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-green-600">BANKEZEE</h1>
            <p className="text-xs text-gray-500 -mt-1">Connect HR</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right hidden sm:block">
              <p className="text-sm font-medium text-gray-900">{user?.name}</p>
              <p className="text-xs text-gray-500">HR</p>
            </div>
            <div className="w-10 h-10 rounded-full bg-green-600 flex items-center justify-center">
              <span className="text-white font-bold">{user?.name?.charAt(0).toUpperCase()}</span>
            </div>
            <button
              onClick={handleLogout}
              className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
              data-testid="hr-logout-btn"
              title="Logout"
            >
              <LogOut size={20} />
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-auto pb-20">
        <Outlet />
      </main>

      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 safe-area-bottom z-40">
        <div className="flex items-center justify-around py-2">
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.exact}
              className={({ isActive }) =>
                `flex flex-col items-center py-1 px-2 rounded-lg transition-colors ${
                  isActive ? 'text-green-600' : 'text-gray-500 hover:text-gray-700'
                }`
              }
              data-testid={item.testId}
            >
              <item.icon size={22} />
              <span className="text-xs mt-0.5 font-medium">{item.label}</span>
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
};

export default HrLayout;
