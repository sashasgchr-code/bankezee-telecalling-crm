import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut, Info, Lock, Loader2 } from 'lucide-react';
import useAuthStore from '../../store/authStore';
import api from '../../services/api';

const AdminSettings = () => {
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });

  const handleLogout = () => {
    if (window.confirm('Are you sure you want to logout?')) {
      logout();
      navigate('/login');
    }
  };

  const handleChangePassword = async () => {
    if (!currentPassword.trim() || !newPassword.trim()) {
      setMessage({ type: 'error', text: 'Please fill in all fields' });
      return;
    }

    if (newPassword.length < 6) {
      setMessage({ type: 'error', text: 'New password must be at least 6 characters' });
      return;
    }

    setIsSubmitting(true);
    setMessage({ type: '', text: '' });

    try {
      await api.post('/auth/change-password', {
        current_password: currentPassword,
        new_password: newPassword,
      });
      setMessage({ type: 'success', text: 'Password changed successfully' });
      setCurrentPassword('');
      setNewPassword('');
      setTimeout(() => setShowChangePassword(false), 2000);
    } catch (error) {
      setMessage({ type: 'error', text: error.response?.data?.detail || 'Failed to change password' });
    } finally {
      setIsSubmitting(false);
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

      {/* Change Password */}
      <div className="card p-6 mb-6">
        <button
          onClick={() => setShowChangePassword(!showChangePassword)}
          className="flex items-center gap-3 w-full text-left"
        >
          <Lock size={20} className="text-gray-600" />
          <span className="font-medium text-gray-900">Change Password</span>
        </button>

        {showChangePassword && (
          <div className="mt-4 space-y-4">
            {message.text && (
              <div
                className={`p-3 rounded-lg text-sm ${
                  message.type === 'error'
                    ? 'bg-red-50 text-red-600'
                    : 'bg-green-50 text-green-600'
                }`}
              >
                {message.text}
              </div>
            )}
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="Current Password"
              className="input-field"
              data-testid="current-password-input"
            />
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="New Password"
              className="input-field"
              data-testid="new-password-input"
            />
            <button
              onClick={handleChangePassword}
              disabled={isSubmitting}
              className="btn-primary w-full flex items-center justify-center gap-2"
              data-testid="change-password-btn"
            >
              {isSubmitting ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                'Update Password'
              )}
            </button>
          </div>
        )}
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
