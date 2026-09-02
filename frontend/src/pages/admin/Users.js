import React, { useState, useEffect } from 'react';
import { 
  Plus, Eye, Loader2, Search, UserPlus, Link2, 
  ChevronLeft, ChevronRight, X, Key, Copy, Check,
  CheckCircle, XCircle, Clock, Edit2, Trash2, User,
  Phone, MapPin, CreditCard, Building2, EyeOff
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
  const [activeTab, setActiveTab] = useState('users');
  const [users, setUsers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showUserModal, setShowUserModal] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [newUser, setNewUser] = useState({ 
    name: '', email: '', password: '', role: 'telecaller', phone: '', designation: ''
  });
  const [newPassword, setNewPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [copiedField, setCopiedField] = useState(null);
  const [showPassword, setShowPassword] = useState({});
  const pageSize = 15;

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

  const handleApproveUser = async (userId) => {
    try {
      await api.put(`/users/${userId}`, { 
        is_active: true, 
        is_approved: true, 
        approval_status: 'approved',
        approval_date: new Date().toISOString()
      });
      fetchUsers();
      toast.success('User approved successfully');
      setShowUserModal(false);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to approve user');
    }
  };

  const handleRejectUser = async (userId) => {
    const reason = prompt('Enter rejection reason:');
    if (reason === null) return;
    
    try {
      await api.put(`/users/${userId}`, { 
        is_active: false, 
        is_approved: false, 
        approval_status: 'rejected',
        rejection_reason: reason
      });
      fetchUsers();
      toast.success('User rejected');
      setShowUserModal(false);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to reject user');
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

  const togglePasswordVisibility = (userId) => {
    setShowPassword(prev => ({ ...prev, [userId]: !prev[userId] }));
  };

  // Filter users based on tab and search
  const pendingUsers = users.filter(u => u.approval_status === 'pending');
  const approvedUsers = users.filter(u => u.approval_status !== 'pending' || u.is_active);
  
  const filteredUsers = (activeTab === 'approvals' ? pendingUsers : approvedUsers).filter(user => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      user.name?.toLowerCase().includes(query) ||
      user.email?.toLowerCase().includes(query) ||
      user.partner_code?.toLowerCase().includes(query)
    );
  });

  // Pagination
  const totalPages = Math.ceil(filteredUsers.length / pageSize);
  const paginatedUsers = filteredUsers.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const unmappedCount = users.filter(u => !u.crm_user_id && !u.old_crm_id).length;

  return (
    <div className="p-4 sm:p-6" data-testid="admin-users">
      {/* Tabs */}
      <div className="flex items-center gap-6 border-b border-gray-200 mb-6">
        <button 
          onClick={() => setActiveTab('dashboard')}
          className={`pb-3 flex items-center gap-2 ${activeTab === 'dashboard' ? 'border-b-2 border-green-600 text-green-600 font-medium' : 'text-gray-500 hover:text-gray-700'}`}
        >
          Dashboard
        </button>
        <button 
          onClick={() => { setActiveTab('approvals'); setCurrentPage(1); }}
          className={`pb-3 flex items-center gap-2 ${activeTab === 'approvals' ? 'border-b-2 border-green-600 text-green-600 font-medium' : 'text-gray-500 hover:text-gray-700'}`}
        >
          Approvals
          {pendingUsers.length > 0 && (
            <span className="px-2 py-0.5 text-xs bg-orange-100 text-orange-600 rounded-full">{pendingUsers.length}</span>
          )}
        </button>
        <button 
          onClick={() => { setActiveTab('users'); setCurrentPage(1); }}
          className={`pb-3 flex items-center gap-2 ${activeTab === 'users' ? 'border-b-2 border-green-600 text-green-600 font-medium' : 'text-gray-500 hover:text-gray-700'}`}
        >
          Users
        </button>
      </div>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="text-xl font-bold text-gray-900">
            {activeTab === 'approvals' ? `Pending Approvals (${pendingUsers.length})` : `All Users (${approvedUsers.length})`}
          </h2>
          <p className="text-sm text-gray-500">
            {activeTab === 'approvals' ? 'New registrations awaiting approval' : 'CRM users - map to Connect ID for unified login'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {unmappedCount > 0 && activeTab === 'users' && (
            <span className="text-orange-500 font-medium">{unmappedCount} unmapped</span>
          )}
          <button
            onClick={() => setShowAddModal(true)}
            className="px-4 py-2 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 flex items-center gap-2"
            data-testid="add-user-btn"
          >
            <Plus size={18} /> Add User
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="mb-4">
        <div className="relative max-w-md">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search by name, email, or code..."
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
            className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
          />
        </div>
      </div>

      {/* Users Table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        {/* Table Header */}
        <div className="grid grid-cols-12 gap-4 px-4 py-3 bg-gray-50 border-b border-gray-200 text-sm font-medium text-gray-600">
          <div className="col-span-3">Name</div>
          <div className="col-span-3">Email</div>
          <div className="col-span-1">Role</div>
          <div className="col-span-2">{activeTab === 'approvals' ? 'Code' : 'Connect ID'}</div>
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
            {activeTab === 'approvals' ? 'No pending approvals' : 'No users found'}
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {paginatedUsers.map((user) => {
              const roleConfig = ROLE_CONFIG[user.role] || { label: user.role, color: 'bg-gray-100 text-gray-700' };
              const isPending = user.approval_status === 'pending';
              
              return (
                <div 
                  key={user.id} 
                  className="grid grid-cols-12 gap-4 px-4 py-3 items-center hover:bg-gray-50 transition-colors"
                >
                  <div className="col-span-3">
                    <p className="font-medium text-gray-900 truncate">{user.name || 'Unnamed'}</p>
                    {user.phone && <p className="text-xs text-gray-500">{user.phone}</p>}
                  </div>
                  <div className="col-span-3">
                    <p className="text-gray-600 truncate">{user.email}</p>
                  </div>
                  <div className="col-span-1">
                    <span className={`inline-block px-2 py-0.5 text-xs rounded ${roleConfig.color}`}>
                      {roleConfig.label}
                    </span>
                  </div>
                  <div className="col-span-2">
                    {activeTab === 'approvals' ? (
                      <code className="text-xs text-green-600 font-mono">{user.partner_code || 'N/A'}</code>
                    ) : (
                      <code className="text-xs text-gray-600 font-mono truncate block">
                        {(user.id || '').slice(0, 12)}...
                      </code>
                    )}
                  </div>
                  <div className="col-span-1">
                    {isPending ? (
                      <span className="px-2 py-0.5 text-xs rounded bg-amber-100 text-amber-700 flex items-center gap-1">
                        <Clock size={12} /> Pending
                      </span>
                    ) : (
                      <span className={`px-2 py-0.5 text-xs rounded ${
                        user.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                      }`}>
                        {user.is_active ? 'active' : 'inactive'}
                      </span>
                    )}
                  </div>
                  <div className="col-span-2 flex items-center justify-center gap-1">
                    <button
                      onClick={(e) => openUserDetail(user, e)}
                      className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"
                      title="View details"
                    >
                      <Eye size={18} />
                    </button>
                    {isPending && (
                      <>
                        <button
                          onClick={() => handleApproveUser(user.id)}
                          className="p-2 text-green-600 hover:bg-green-50 rounded-lg"
                          title="Approve"
                        >
                          <CheckCircle size={18} />
                        </button>
                        <button
                          onClick={() => handleRejectUser(user.id)}
                          className="p-2 text-red-600 hover:bg-red-50 rounded-lg"
                          title="Reject"
                        >
                          <XCircle size={18} />
                        </button>
                      </>
                    )}
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

      {/* User Detail Modal - OLD CRM Style */}
      <Modal 
        isOpen={showUserModal} 
        onClose={() => { setShowUserModal(false); setSelectedUser(null); }} 
        title=""
      >
        {selectedUser && (
          <div className="p-0">
            {/* Header with actions */}
            <div className="flex items-start justify-between p-4 border-b border-gray-200">
              <div>
                <div className="flex items-center gap-3">
                  <h3 className="text-lg font-bold text-gray-900">{selectedUser.name}</h3>
                  <span className={`px-2 py-0.5 text-xs rounded ${
                    selectedUser.approval_status === 'approved' ? 'bg-green-100 text-green-700' :
                    selectedUser.approval_status === 'rejected' ? 'bg-red-100 text-red-700' :
                    'bg-amber-100 text-amber-700'
                  }`}>
                    {selectedUser.approval_status === 'approved' ? 'Approved' : 
                     selectedUser.approval_status === 'rejected' ? 'Rejected' : 'Pending'}
                  </span>
                </div>
                <p className="text-sm text-gray-500">{selectedUser.phone} | Code: <span className="text-green-600 font-mono">{selectedUser.partner_code || 'N/A'}</span></p>
                <p className="text-sm text-gray-500">{selectedUser.email}</p>
                <p className="text-sm text-green-600">Manager: {selectedUser.manager_name || 'Unassigned'}</p>
              </div>
              <div className="flex items-center gap-2">
                <button className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm hover:bg-gray-50 flex items-center gap-1">
                  <Edit2 size={14} /> Edit
                </button>
                <button className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm hover:bg-gray-50 flex items-center gap-1">
                  <Link2 size={14} /> Map
                </button>
              </div>
            </div>

            {/* Complete Details Section */}
            <div className="p-4">
              <div className="flex items-center justify-between mb-4">
                <h4 className="font-semibold text-gray-900">Complete Details</h4>
                <button className="text-sm text-gray-500 hover:text-gray-700">Hide Details ^</button>
              </div>

              <div className="grid grid-cols-3 gap-6">
                {/* Basic Information */}
                <div>
                  <div className="flex items-center gap-2 text-gray-600 mb-3">
                    <User size={16} />
                    <span className="font-medium">Basic Information</span>
                  </div>
                  <div className="space-y-2 text-sm">
                    <p><span className="text-gray-500">Name:</span> <span className="text-gray-900">{selectedUser.name}</span></p>
                    <p><span className="text-gray-500">Email:</span> <span className="text-gray-900">{selectedUser.email}</span></p>
                    <p><span className="text-gray-500">Phone:</span> <span className="text-gray-900">{selectedUser.phone || 'N/A'}</span></p>
                    <p><span className="text-gray-500">City:</span> <span className="text-gray-900">{selectedUser.city || 'N/A'}</span></p>
                    <p><span className="text-gray-500">Code:</span> <span className="text-green-600 font-mono">{selectedUser.partner_code || 'N/A'}</span></p>
                    <p><span className="text-gray-500">Registered:</span> <span className="text-gray-900">
                      {selectedUser.created_at ? new Date(selectedUser.created_at).toLocaleString() : 'N/A'}
                    </span></p>
                  </div>
                </div>

                {/* KYC Details */}
                <div>
                  <div className="flex items-center gap-2 text-gray-600 mb-3">
                    <CreditCard size={16} />
                    <span className="font-medium">KYC Details</span>
                  </div>
                  <div className="space-y-2 text-sm">
                    <p><span className="text-gray-500">PAN Number:</span> <span className="text-gray-900 font-mono">{selectedUser.pan_number || 'N/A'}</span></p>
                    <p>
                      <span className="text-gray-500">Status:</span>{' '}
                      <span className={`${selectedUser.kyc_status === 'verified' ? 'text-green-600' : 'text-amber-600'}`}>
                        {selectedUser.kyc_status === 'verified' ? 'Verified' : 'Pending'}
                      </span>
                    </p>
                    <p className="text-gray-400 italic text-xs">{selectedUser.id_document ? 'ID document uploaded' : 'No ID document uploaded'}</p>
                  </div>
                </div>

                {/* Bank Details */}
                <div>
                  <div className="flex items-center gap-2 text-gray-600 mb-3">
                    <Building2 size={16} />
                    <span className="font-medium">Bank Details</span>
                  </div>
                  <div className="space-y-2 text-sm">
                    {selectedUser.bank_details ? (
                      <>
                        <p><span className="text-gray-500">Bank Name:</span> <span className="text-gray-900">{selectedUser.bank_details.bank_name}</span></p>
                        <p><span className="text-gray-500">Account Holder:</span> <span className="text-gray-900">{selectedUser.bank_details.account_holder}</span></p>
                        <p><span className="text-gray-500">Account Number:</span> <span className="text-gray-900 font-mono">{selectedUser.bank_details.account_number}</span></p>
                        <p><span className="text-gray-500">IFSC Code:</span> <span className="text-gray-900 font-mono">{selectedUser.bank_details.ifsc_code}</span></p>
                      </>
                    ) : (
                      <p className="text-gray-400 italic">No bank details provided</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Account Details Section */}
              <div className="mt-6 pt-4 border-t border-gray-200">
                <div className="flex items-center gap-2 text-gray-600 mb-3">
                  <Key size={16} />
                  <span className="font-medium">Account Details</span>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-xs text-gray-500 mb-1">User ID:</p>
                    <div className="flex items-center gap-2">
                      <code className="text-sm font-mono text-gray-700 flex-1 truncate">{selectedUser.id}</code>
                      <button
                        onClick={() => copyToClipboard(selectedUser.id, 'userId')}
                        className="p-1 hover:bg-gray-200 rounded"
                      >
                        {copiedField === 'userId' ? <Check size={14} className="text-green-600" /> : <Copy size={14} />}
                      </button>
                    </div>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-xs text-gray-500 mb-1">Email (Login):</p>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-gray-700 flex-1 truncate">{selectedUser.email}</span>
                      <button
                        onClick={() => copyToClipboard(selectedUser.email, 'email')}
                        className="p-1 hover:bg-gray-200 rounded"
                      >
                        {copiedField === 'email' ? <Check size={14} className="text-green-600" /> : <Copy size={14} />}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Password Section */}
                <div className="mt-4 bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs text-amber-600 mb-1">Password:</p>
                      <code className="text-sm font-mono text-amber-800">
                        {showPassword[selectedUser.id] ? (selectedUser.plain_password || 'Not stored') : '••••••••'}
                      </code>
                    </div>
                    <div className="flex items-center gap-2">
                      {selectedUser.plain_password && (
                        <>
                          <button
                            onClick={() => togglePasswordVisibility(selectedUser.id)}
                            className="p-2 hover:bg-amber-100 rounded-lg"
                            title={showPassword[selectedUser.id] ? 'Hide' : 'Show'}
                          >
                            {showPassword[selectedUser.id] ? <EyeOff size={16} /> : <Eye size={16} />}
                          </button>
                          <button
                            onClick={() => copyToClipboard(selectedUser.plain_password, 'password')}
                            className="p-2 hover:bg-amber-100 rounded-lg"
                          >
                            {copiedField === 'password' ? <Check size={16} className="text-green-600" /> : <Copy size={16} />}
                          </button>
                        </>
                      )}
                      <button
                        onClick={() => { setShowUserModal(false); setShowPasswordModal(true); }}
                        className="px-3 py-1.5 bg-amber-100 text-amber-700 rounded-lg text-sm hover:bg-amber-200 flex items-center gap-1"
                      >
                        <Key size={14} /> Set/Reset Password
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              {selectedUser.approval_status === 'pending' && (
                <div className="flex gap-3 mt-6 pt-4 border-t border-gray-200">
                  <button
                    onClick={() => handleApproveUser(selectedUser.id)}
                    className="flex-1 px-4 py-2.5 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 flex items-center justify-center gap-2"
                  >
                    <CheckCircle size={18} /> Approve User
                  </button>
                  <button
                    onClick={() => handleRejectUser(selectedUser.id)}
                    className="flex-1 px-4 py-2.5 bg-red-100 text-red-600 rounded-lg font-medium hover:bg-red-200 flex items-center justify-center gap-2"
                  >
                    <XCircle size={18} /> Reject
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* Add User Modal */}
      <Modal isOpen={showAddModal} onClose={() => setShowAddModal(false)} title="Add New User">
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Full Name *</label>
            <input
              type="text"
              value={newUser.name}
              onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
              placeholder="Enter full name"
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email *</label>
            <input
              type="email"
              value={newUser.email}
              onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
              placeholder="Enter email"
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
            <input
              type="tel"
              value={newUser.phone}
              onChange={(e) => setNewUser({ ...newUser, phone: e.target.value })}
              placeholder="Enter phone"
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Password *</label>
            <input
              type="text"
              value={newUser.password}
              onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
              placeholder="Enter password"
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Role *</label>
            <div className="grid grid-cols-3 gap-2">
              {['telecaller', 'sales_agent', 'team_leader', 'manager', 'operations', 'admin'].map(role => (
                <button
                  key={role}
                  type="button"
                  onClick={() => setNewUser({ ...newUser, role })}
                  className={`px-3 py-2 rounded-lg border text-sm ${
                    newUser.role === role
                      ? 'border-green-600 bg-green-50 text-green-700'
                      : 'border-gray-200 text-gray-600 hover:border-green-300'
                  }`}
                >
                  {role.replace('_', ' ')}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-3 pt-4">
            <button
              onClick={() => setShowAddModal(false)}
              className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg"
            >
              Cancel
            </button>
            <button
              onClick={handleAddUser}
              disabled={isSubmitting}
              className="flex-1 px-4 py-2.5 bg-green-600 text-white rounded-lg disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <><UserPlus size={18} /> Create</>}
            </button>
          </div>
        </div>
      </Modal>

      {/* Change Password Modal */}
      <Modal isOpen={showPasswordModal} onClose={() => { setShowPasswordModal(false); setNewPassword(''); }} title="Set/Reset Password">
        <div className="p-6">
          <div className="bg-gray-50 rounded-lg p-4 mb-4">
            <p className="text-sm text-gray-600">Setting password for:</p>
            <p className="font-semibold">{selectedUser?.name}</p>
            <p className="text-sm text-gray-500">{selectedUser?.email}</p>
          </div>
          {selectedUser?.plain_password && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4">
              <p className="text-sm text-amber-700">Current: <code className="font-mono">{selectedUser.plain_password}</code></p>
            </div>
          )}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-1">New Password</label>
            <input
              type="text"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Min 6 characters"
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
              autoFocus
            />
          </div>
          <div className="flex gap-3">
            <button onClick={() => { setShowPasswordModal(false); setNewPassword(''); }} className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg">Cancel</button>
            <button
              onClick={handleChangePassword}
              disabled={isSubmitting || newPassword.length < 6}
              className="flex-1 px-4 py-2.5 bg-green-600 text-white rounded-lg disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Set Password'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default AdminUsers;
