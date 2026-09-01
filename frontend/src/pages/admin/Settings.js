import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut, Info, Lock, Loader2, Key, Mail, FileSpreadsheet, Copy, Check } from 'lucide-react';
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
  
  // Integration settings
  const [showIntegrations, setShowIntegrations] = useState(false);
  const [integrationSettings, setIntegrationSettings] = useState({
    sheets_api_key: '',
    resend_api_key: '',
    hr_email: '',
  });
  const [loadingSettings, setLoadingSettings] = useState(false);
  const [copiedKey, setCopiedKey] = useState('');

  useEffect(() => {
    if (showIntegrations) {
      loadIntegrationSettings();
    }
  }, [showIntegrations]);

  const loadIntegrationSettings = async () => {
    setLoadingSettings(true);
    try {
      const response = await api.get('/settings/integrations');
      setIntegrationSettings(response.data);
    } catch (error) {
      // Settings may not exist yet, use defaults
      setIntegrationSettings({
        sheets_api_key: 'bankezee_sheets_sync_2026',
        resend_api_key: '',
        hr_email: 'admin@bankezee.com',
      });
    } finally {
      setLoadingSettings(false);
    }
  };

  const handleSaveIntegrations = async () => {
    setIsSubmitting(true);
    try {
      await api.post('/settings/integrations', integrationSettings);
      setMessage({ type: 'success', text: 'Integration settings saved successfully' });
    } catch (error) {
      setMessage({ type: 'error', text: error.response?.data?.detail || 'Failed to save settings' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const copyToClipboard = (text, key) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(''), 2000);
  };

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

      {/* Integrations */}
      <div className="card p-6 mb-6">
        <button
          onClick={() => setShowIntegrations(!showIntegrations)}
          className="flex items-center gap-3 w-full text-left"
        >
          <Key size={20} className="text-gray-600" />
          <span className="font-medium text-gray-900">Integrations</span>
        </button>

        {showIntegrations && (
          <div className="mt-4 space-y-5">
            {loadingSettings ? (
              <div className="flex justify-center py-4">
                <Loader2 className="animate-spin text-gray-400" />
              </div>
            ) : (
              <>
                {/* Google Sheets API Key */}
                <div>
                  <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2">
                    <FileSpreadsheet size={16} className="text-green-600" />
                    Google Sheets API Key
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={integrationSettings.sheets_api_key}
                      onChange={(e) => setIntegrationSettings({ ...integrationSettings, sheets_api_key: e.target.value })}
                      placeholder="Enter API key for Google Sheets sync"
                      className="input-field flex-1"
                      data-testid="sheets-api-key-input"
                    />
                    <button
                      onClick={() => copyToClipboard(integrationSettings.sheets_api_key, 'sheets')}
                      className="px-3 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
                      title="Copy API Key"
                    >
                      {copiedKey === 'sheets' ? <Check size={18} className="text-green-600" /> : <Copy size={18} />}
                    </button>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    Use this key in your Google Apps Script to sync data
                  </p>
                </div>

                {/* Resend API Key */}
                <div>
                  <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2">
                    <Mail size={16} className="text-blue-600" />
                    Resend API Key (Email Notifications)
                  </label>
                  <input
                    type="password"
                    value={integrationSettings.resend_api_key}
                    onChange={(e) => setIntegrationSettings({ ...integrationSettings, resend_api_key: e.target.value })}
                    placeholder="re_xxxxxxxxxx (from resend.com)"
                    className="input-field"
                    data-testid="resend-api-key-input"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    <a href="https://resend.com/api-keys" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                      Get your Resend API key here
                    </a>
                  </p>
                </div>

                {/* HR Email */}
                <div>
                  <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2">
                    <Mail size={16} className="text-amber-600" />
                    HR/Admin Email (Notifications)
                  </label>
                  <input
                    type="email"
                    value={integrationSettings.hr_email}
                    onChange={(e) => setIntegrationSettings({ ...integrationSettings, hr_email: e.target.value })}
                    placeholder="hr@yourcompany.com"
                    className="input-field"
                    data-testid="hr-email-input"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Leave/WFH request notifications will be sent to this email
                  </p>
                </div>

                <button
                  onClick={handleSaveIntegrations}
                  disabled={isSubmitting}
                  className="btn-primary w-full flex items-center justify-center gap-2"
                  data-testid="save-integrations-btn"
                >
                  {isSubmitting ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    'Save Integration Settings'
                  )}
                </button>
              </>
            )}
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
