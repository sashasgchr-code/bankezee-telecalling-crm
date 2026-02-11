import React from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut, Info } from 'lucide-react';
import useAuthStore from '../../store/authStore';

const AdminSettings = () => {
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();

  const handleLogout = () => {
    if (window.confirm('Are you sure you want to logout?')) {
      logout();
      navigate('/login');
    }
  };

  return (
    <div className="p-4" data-testid="admin-settings">
      <h2 className="text-2xl font-bold text-gray-900 mb-6">Settings</h2>

      {/* Profile */}
      <div className="card p-6 mb-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Profile</h3>
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-green-600 flex items-center justify-center">
            <span className="text-2xl font-bold text-white">
              {user?.name?.charAt(0).toUpperCase()}
            </span>
          </div>
          <div>
            <p className="text-lg font-semibold text-gray-900">{user?.name}</p>
            <p className="text-gray-500">{user?.email}</p>
            <p className="text-sm text-green-600 capitalize mt-1">{user?.role}</p>
          </div>
        </div>
      </div>

      {/* App Info */}
      <div className="card p-6 mb-6">
        <div className="flex items-center gap-3 mb-4">
          <Info size={20} className="text-gray-600" />
          <h3 className="text-lg font-semibold text-gray-900">About</h3>
        </div>
        <div className="space-y-2 text-gray-600">
          <p><span className="font-medium">App:</span> BANKEZEE Connect CRM</p>
          <p><span className="font-medium">Version:</span> 1.0.0 (Web)</p>
          <p><span className="font-medium">Platform:</span> React Web Application</p>
        </div>
      </div>

      {/* Logout */}
      <button
        onClick={handleLogout}
        className="w-full py-4 text-center text-red-600 font-semibold hover:bg-red-50 rounded-xl transition-colors flex items-center justify-center gap-2"
        data-testid="logout-btn"
      >
        <LogOut size={20} />
        <span>Logout</span>
      </button>
    </div>
  );
};

export default AdminSettings;
