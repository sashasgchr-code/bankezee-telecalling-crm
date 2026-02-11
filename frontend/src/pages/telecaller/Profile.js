import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { User, Mail, Lock, LogOut, Loader2 } from 'lucide-react';
import useAuthStore from '../../store/authStore';
import api from '../../services/api';

const TelecallerProfile = () => {
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
    <div className="p-4" data-testid="telecaller-profile">
      <h2 className="text-2xl font-bold text-gray-900 mb-6">Profile</h2>

      {/* Profile Card */}
      <div className="card p-6 mb-6">
        <div className="flex items-center gap-4">
          <div className="w-20 h-20 rounded-full bg-green-600 flex items-center justify-center">
            <span className="text-3xl font-bold text-white">
              {user?.name?.charAt(0).toUpperCase()}
            </span>
          </div>
          <div>
            <h3 className="text-xl font-bold text-gray-900">{user?.name}</h3>
            <p className="text-gray-500 capitalize">{user?.role}</p>
          </div>
        </div>

        <div className="mt-6 space-y-4">
          <div className="flex items-center gap-3 text-gray-600">
            <Mail size={20} />
            <span>{user?.email}</span>
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

export default TelecallerProfile;
