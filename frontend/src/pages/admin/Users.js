import React, { useState, useEffect } from 'react';
import { 
  Plus, Eye, Loader2, Search, UserPlus, Link2, 
  ChevronLeft, ChevronRight, X, Key, Copy, Check
} from 'lucide-react';
import api from '../../services/api';
import Modal from '../../components/Modal';
import { toast } from 'sonner';

// Role display config
const ROLE_CONFIG = {
  admin: { label: 'admin', color: 'bg-blue-100 text-blue-700' },
  telecaller: { label: 'telecaller', color: 'bg-green-100 text-green-700' },
  sales_agent: { label: 'sales_agent', color: 'bg-emerald-100 text-emerald-700' },
  team_leader: { label: 'team_leader', color: 'bg-purple-100 text-purple-700' },
  manager: { label: 'manager', color: 'bg-indigo-100 text-indigo-700' },
  operations: { label: 'operations', color: 'bg-orange-100 text-orange-700' },
  hr: { label: 'hr', color: 'bg-pink-100 text-pink-700' },
  partner: { label: 'partner', color: 'bg-teal-100 text-teal-700' },
};

const AdminUsers = () => {
  const [users, setUsers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showUserModal, setShowUserModal] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [newUser, setNewUser] = useState({ 
    name: '', 
    email: '', 
    password: '', 
    role: 'telecaller',
    phone: '',
    designation: ''
  });
  const [newPassword, setNewPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [copiedField, setCopiedField] = useState(null);
  const pageSize = 20;

  const fetchUsers = async () => {
    try {
      const response = await api.get('/users');
      setUsers(response.data);
    } catch (error) {
      console.error('Error fetching users:', error);
      toast.error('Failed to load users');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleAddUser = async () => {
    if (!newUser.name.trim() || !newUser.email.trim() || !newUser.password.trim()) {
      toast.error('Please fill in Name, Email and Password');
      return;
    }

    setIsSubmitting(true);
    try {
      await api.post('/users', newUser);
      setShowAddModal(false);
      setNewUser({ name: '', email: '', password: '', role: 'telecaller', phone: '', designation: '' });
      fetchUsers();
      toast.success('User created successfully');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to create user');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleActive = async (userId, currentStatus, e) => {
    e?.stopPropagation();
    try {
      await api.put(`/users/${userId}`, { is_active: !currentStatus });
      fetchUsers();
      toast.success(currentStatus ? 'User deactivated' : 'User activated');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to update user');
    }
  };

  const handleChangePassword = async () => {
    if (!newPassword || newPassword.length < 6) {
      toast.error('Password must be at least 6 characters');
      return;
    }

    setIsSubmitting(true);
    try {
      await api.put(`/users/${selectedUser.id}/change-password`, { new_password: newPassword });
      setShowPasswordModal(false);
      setNewPassword('');
      fetchUsers();
      toast.success('Password changed successfully');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to change password');
    } finally {
      setIsSubmitting(false);
    }
  };

  const openUserDetail = (user, e) => {
    e?.stopPropagation();
    setSelectedUser(user);
    setShowUserModal(true);
  };

  const copyToClipboard = (text, field) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
    toast.success('Copied to clipboard');
  };

  // Filter users
  const filteredUsers = users.filter(user => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      user.name?.toLowerCase().includes(query) ||
      user.email?.toLowerCase().includes(query) ||
      user.id?.toLowerCase().includes(query) ||
      user.connect_id?.toLowerCase().includes(query)
    );
  });

  // Pagination
  const totalPages = Math.ceil(filteredUsers.length / pageSize);
  const paginatedUsers = filteredUsers.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const unmappedCount = users.filter(u => !u.crm_user_id && !u.old_crm_id).length;

  return (
    <div className="p-4 sm:p-6" data-testid="admin-users">
      {/* Tabs - Match OLD CRM style */}
      <div className="flex items-center gap-6 border-b border-gray-200 mb-6">
        <button className="pb-3 text-gray-500 hover:text-gray-700 flex items-center gap-2">
          <span>Dashboard</span>
        </button>
        <button className="pb-3 text-gray-500 hover:text-gray-700 flex items-center gap-2">
          <span>Approvals</span>
        </button>
        <button className="pb-3 border-b-2 border-green-600 text-green-600 font-medium flex items-center gap-2">
          <span>Users</span>
        </button>
      </div>

      {/* Header Row - Match OLD CRM */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="text-xl font-bold text-gray-900">All Users ({users.length})</h2>
          <p className="text-sm text-gray-500">CRM users - map to Connect ID for unified login</p>
        </div>
        <div className="flex items-center gap-3">
          {unmappedCount > 0 && (
            <span className="text-orange-500 font-medium">{unmappedCount} unmapped</span>
          )}
          <button
            onClick={() => setShowAddModal(true)}
            className="px-4 py-2 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 flex items-center gap-2"
            data-testid="add-user-btn"
          >
            Manage Users
          </button>
        </div>
      </div>

      {/* Search Bar */}
      <div className="mb-4">
        <div className="relative max-w-md">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search by name, email, or ID..."
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
            className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
          />
        </div>
      </div>

      {/* Users Table - Match OLD CRM Layout */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        {/* Table Header */}
        <div className="grid grid-cols-12 gap-4 px-4 py-3 bg-gray-50 border-b border-gray-200 text-sm font-medium text-gray-600">
          <div className="col-span-3">Name</div>
          <div className="col-span-3">Email</div>
          <div className="col-span-1">Role</div>
          <div className="col-span-2">Connect ID</div>
          <div className="col-span-1">Status</div>
          <div className="col-span-2 text-center">Actions</div>
        </div>

        {/* Table Body */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 text-green-600 animate-spin" />
          </div>
        ) : paginatedUsers.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            No users found
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {paginatedUsers.map((user) => {
              const roleConfig = ROLE_CONFIG[user.role] || { label: user.role, color: 'bg-gray-100 text-gray-700' };
              const isMapped = user.crm_user_id || user.old_crm_id || user.connect_id;
              
              return (
                <div 
                  key={user.id} 
                  className="grid grid-cols-12 gap-4 px-4 py-3 items-center hover:bg-gray-50 transition-colors"
                >
                  {/* Name */}
                  <div className="col-span-3">
                    <p className="font-medium text-gray-900 truncate">{user.name || 'Unnamed'}</p>
                  </div>
                  
                  {/* Email */}
                  <div className="col-span-3">
                    <p className="text-gray-600 truncate">{user.email}</p>
                  </div>
                  
                  {/* Role */}
                  <div className="col-span-1">
                    <span className={`inline-block px-2 py-0.5 text-xs rounded ${roleConfig.color}`}>
                      {roleConfig.label}
                    </span>
                  </div>
                  
                  {/* Connect ID */}
                  <div className="col-span-2">
                    {isMapped ? (
                      <code className="text-xs text-gray-600 font-mono truncate block">
                        {(user.connect_id || user.id || '').slice(0, 12)}...
                      </code>
                    ) : (
                      <span className="text-orange-500 text-sm flex items-center gap-1">
                        Not Mapped <span className="text-orange-400">→</span>
                      </span>
                    )}
                  </div>
                  
                  {/* Status */}
                  <div className="col-span-1">
                    <span className={`px-2 py-0.5 text-xs rounded ${
                      user.is_active 
                        ? 'bg-green-100 text-green-700' 
                        : 'bg-red-100 text-red-700'
                    }`}>
                      {user.is_active ? 'active' : 'inactive'}
                    </span>
                  </div>
                  
                  {/* Actions */}
                  <div className="col-span-2 flex items-center justify-center gap-2">
                    <button
                      onClick={(e) => openUserDetail(user, e)}
                      className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                      title="View user details"
                      data-testid={`view-user-${user.id}`}
                    >
                      <Eye size={18} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 bg-gray-50">
            <p className="text-sm text-gray-600">
              Showing {((currentPage - 1) * pageSize) + 1} to {Math.min(currentPage * pageSize, filteredUsers.length)} of {filteredUsers.length}
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="p-2 border border-gray-200 rounded-lg disabled:opacity-50 hover:bg-gray-100"
              >
                <ChevronLeft size={18} />
              </button>
              <span className="px-3 py-1 text-sm">Page {currentPage} of {totalPages}</span>
              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="p-2 border border-gray-200 rounded-lg disabled:opacity-50 hover:bg-gray-100"
              >
                <ChevronRight size={18} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Add/Manage User Modal - Match OLD CRM Sign Up Form */}
      <Modal 
        isOpen={showAddModal} 
        onClose={() => setShowAddModal(false)} 
        title="Add New User"
      >
        <div className="p-6">
          {/* Form matching OLD CRM style */}
          <div className="space-y-4">
            {/* Full Name */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Full Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={newUser.name}
                onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
                placeholder="Enter full name"
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                data-testid="user-name-input"
              />
            </div>

            {/* Email */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Email Address <span className="text-red-500">*</span>
              </label>
              <input
                type="email"
                value={newUser.email}
                onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                placeholder="Enter email address"
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                data-testid="user-email-input"
              />
            </div>

            {/* Phone */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Phone Number
              </label>
              <input
                type="tel"
                value={newUser.phone}
                onChange={(e) => setNewUser({ ...newUser, phone: e.target.value })}
                placeholder="Enter phone number"
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
              />
            </div>

            {/* Password */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Password <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={newUser.password}
                onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                placeholder="Enter password (min 6 characters)"
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                data-testid="user-password-input"
              />
              <p className="text-xs text-gray-500 mt-1">Password will be visible to admin</p>
            </div>

            {/* Role Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                User Role <span className="text-red-500">*</span>
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {[
                  { key: 'telecaller', label: 'Growth Partner' },
                  { key: 'sales_agent', label: 'Sales Agent' },
                  { key: 'team_leader', label: 'Team Leader' },
                  { key: 'manager', label: 'Manager' },
                  { key: 'operations', label: 'Operations' },
                  { key: 'admin', label: 'Admin' },
                ].map(({ key, label }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setNewUser({ ...newUser, role: key })}
                    className={`px-3 py-2 rounded-lg border text-sm font-medium transition-all ${
                      newUser.role === key
                        ? 'border-green-600 bg-green-50 text-green-700'
                        : 'border-gray-200 text-gray-600 hover:border-green-300 hover:bg-green-50/50'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Designation (optional) */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Designation
              </label>
              <input
                type="text"
                value={newUser.designation}
                onChange={(e) => setNewUser({ ...newUser, designation: e.target.value })}
                placeholder="e.g., Senior Executive, Team Lead"
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
              />
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3 mt-6 pt-4 border-t border-gray-200">
            <button
              onClick={() => setShowAddModal(false)}
              className="flex-1 px-4 py-2.5 border border-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={handleAddUser}
              disabled={isSubmitting}
              className="flex-1 px-4 py-2.5 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 flex items-center justify-center gap-2"
              data-testid="submit-user-btn"
            >
              {isSubmitting ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <>
                  <UserPlus size={18} />
                  Create User
                </>
              )}
            </button>
          </div>
        </div>
      </Modal>

      {/* User Detail Modal */}
      <Modal 
        isOpen={showUserModal} 
        onClose={() => { setShowUserModal(false); setSelectedUser(null); }} 
        title="User Details"
      >
        {selectedUser && (
          <div className="p-6">
            {/* User Header */}
            <div className="flex items-center gap-4 mb-6 pb-4 border-b border-gray-200">
              <div className={`w-16 h-16 rounded-full flex items-center justify-center ${
                selectedUser.role === 'admin' ? 'bg-blue-600' : 'bg-green-600'
              }`}>
                <span className="text-white font-bold text-2xl">
                  {selectedUser.name?.charAt(0).toUpperCase() || '?'}
                </span>
              </div>
              <div className="flex-1">
                <h3 className="text-xl font-bold text-gray-900">{selectedUser.name}</h3>
                <p className="text-gray-500">{selectedUser.email}</p>
                <div className="flex items-center gap-2 mt-1">
                  <span className={`px-2 py-0.5 text-xs rounded ${ROLE_CONFIG[selectedUser.role]?.color || 'bg-gray-100 text-gray-700'}`}>
                    {selectedUser.role}
                  </span>
                  <span className={`px-2 py-0.5 text-xs rounded ${selectedUser.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                    {selectedUser.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>
              </div>
            </div>

            {/* User Info Grid */}
            <div className="space-y-4">
              {/* Connect ID */}
              <div className="bg-gray-50 rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-500 mb-1">Connect User ID</p>
                    <code className="text-sm font-mono text-gray-900 break-all">
                      {selectedUser.id || selectedUser.connect_id || 'N/A'}
                    </code>
                  </div>
                  <button
                    onClick={() => copyToClipboard(selectedUser.id || selectedUser.connect_id, 'connect')}
                    className="p-2 hover:bg-gray-200 rounded-lg"
                  >
                    {copiedField === 'connect' ? <Check size={16} className="text-green-600" /> : <Copy size={16} />}
                  </button>
                </div>
              </div>

              {/* CRM ID */}
              <div className="bg-gray-50 rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-500 mb-1">Mapped CRM User ID</p>
                    <code className="text-sm font-mono text-gray-900 break-all">
                      {selectedUser.crm_user_id || selectedUser.old_crm_id || 'Not Mapped'}
                    </code>
                  </div>
                  {(selectedUser.crm_user_id || selectedUser.old_crm_id) && (
                    <button
                      onClick={() => copyToClipboard(selectedUser.crm_user_id || selectedUser.old_crm_id, 'crm')}
                      className="p-2 hover:bg-gray-200 rounded-lg"
                    >
                      {copiedField === 'crm' ? <Check size={16} className="text-green-600" /> : <Copy size={16} />}
                    </button>
                  )}
                </div>
              </div>

              {/* Password */}
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-amber-700 mb-1 flex items-center gap-2">
                      <Key size={14} />
                      Password
                    </p>
                    <code className="text-sm font-mono text-amber-900">
                      {selectedUser.plain_password || 'Not stored'}
                    </code>
                  </div>
                  <div className="flex items-center gap-2">
                    {selectedUser.plain_password && (
                      <button
                        onClick={() => copyToClipboard(selectedUser.plain_password, 'password')}
                        className="p-2 hover:bg-amber-100 rounded-lg"
                      >
                        {copiedField === 'password' ? <Check size={16} className="text-green-600" /> : <Copy size={16} />}
                      </button>
                    )}
                    <button
                      onClick={() => { setShowUserModal(false); setShowPasswordModal(true); }}
                      className="px-3 py-1.5 text-sm bg-amber-100 text-amber-700 rounded-lg hover:bg-amber-200 font-medium"
                    >
                      Change
                    </button>
                  </div>
                </div>
              </div>

              {/* Phone */}
              {selectedUser.phone && (
                <div className="bg-gray-50 rounded-lg p-4">
                  <p className="text-sm text-gray-500 mb-1">Phone</p>
                  <p className="text-gray-900">{selectedUser.phone}</p>
                </div>
              )}

              {/* Created Date */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-gray-50 rounded-lg p-4">
                  <p className="text-sm text-gray-500 mb-1">Created</p>
                  <p className="text-gray-900">
                    {selectedUser.created_at ? new Date(selectedUser.created_at).toLocaleDateString() : 'N/A'}
                  </p>
                </div>
                <div className="bg-gray-50 rounded-lg p-4">
                  <p className="text-sm text-gray-500 mb-1">Last Login</p>
                  <p className="text-gray-900">
                    {selectedUser.last_login ? new Date(selectedUser.last_login).toLocaleDateString() : 'Never'}
                  </p>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-3 mt-6 pt-4 border-t border-gray-200">
              <button
                onClick={() => { setShowUserModal(false); setShowPasswordModal(true); }}
                className="flex-1 px-4 py-2.5 border border-green-600 text-green-600 rounded-lg font-medium hover:bg-green-50"
              >
                Change Password
              </button>
              <button
                onClick={(e) => { handleToggleActive(selectedUser.id, selectedUser.is_active, e); setShowUserModal(false); }}
                className={`flex-1 px-4 py-2.5 rounded-lg font-medium ${
                  selectedUser.is_active
                    ? 'bg-red-100 text-red-600 hover:bg-red-200'
                    : 'bg-green-100 text-green-600 hover:bg-green-200'
                }`}
              >
                {selectedUser.is_active ? 'Deactivate User' : 'Activate User'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Change Password Modal */}
      <Modal 
        isOpen={showPasswordModal} 
        onClose={() => { setShowPasswordModal(false); setNewPassword(''); }} 
        title="Change Password"
      >
        <div className="p-6">
          <div className="bg-gray-50 rounded-lg p-4 mb-4">
            <p className="text-sm text-gray-600">Changing password for:</p>
            <p className="font-semibold text-gray-900">{selectedUser?.name}</p>
            <p className="text-sm text-gray-500">{selectedUser?.email}</p>
          </div>
          
          {selectedUser?.plain_password && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4">
              <p className="text-sm text-amber-700">Current password:</p>
              <code className="font-mono text-amber-900">{selectedUser.plain_password}</code>
            </div>
          )}
          
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-1">New Password</label>
            <input
              type="text"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Enter new password (min 6 characters)"
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
              autoFocus
            />
          </div>
          
          <div className="flex gap-3">
            <button
              onClick={() => { setShowPasswordModal(false); setNewPassword(''); }}
              className="flex-1 px-4 py-2.5 border border-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={handleChangePassword}
              disabled={isSubmitting || newPassword.length < 6}
              className="flex-1 px-4 py-2.5 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Change Password'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default AdminUsers;
