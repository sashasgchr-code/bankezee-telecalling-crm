import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Plus, Eye, Loader2, Search, UserPlus, 
  ChevronLeft, ChevronRight, X, Key, Copy, Check,
  CheckCircle, XCircle, Clock, Edit2, User,
  Phone, CreditCard, Building2, EyeOff, Users, Mail,
  Shield, UserCog, Briefcase, ToggleLeft, ToggleRight,
  Filter, Download, RefreshCw, Trash2, Power
} from 'lucide-react';
import api from '../../services/api';
import Modal from '../../components/Modal';
import { toast } from 'sonner';

// Role display config with new roles
const ROLE_CONFIG = {
  admin: { label: 'Admin', color: 'bg-red-100 text-red-700', icon: Shield },
  hr: { label: 'HR', color: 'bg-pink-100 text-pink-700', icon: Users },
  manager: { label: 'Manager', color: 'bg-indigo-100 text-indigo-700', icon: UserCog },
  ops: { label: 'Operations', color: 'bg-orange-100 text-orange-700', icon: Briefcase },
  growth_partner: { label: 'Growth Partner', color: 'bg-green-100 text-green-700', icon: User },
  team_lead: { label: 'Team Lead', color: 'bg-purple-100 text-purple-700', icon: Users },
  // Legacy roles mapping
  telecaller: { label: 'Growth Partner', color: 'bg-green-100 text-green-700', icon: User },
  sales_agent: { label: 'Growth Partner', color: 'bg-emerald-100 text-emerald-700', icon: User },
  team_leader: { label: 'Growth Partner', color: 'bg-teal-100 text-teal-700', icon: User },
  partner: { label: 'Growth Partner', color: 'bg-cyan-100 text-cyan-700', icon: User },
  operations: { label: 'Operations', color: 'bg-orange-100 text-orange-700', icon: Briefcase },
};

// Valid base roles for dropdown (includes TL as filterable option)
const BASE_ROLES = ['admin', 'hr', 'manager', 'ops', 'growth_partner'];

// Filter roles (includes Team Lead as a separate filter option)
const FILTER_ROLES = ['admin', 'hr', 'manager', 'ops', 'growth_partner', 'team_lead'];

// GP roles for filtering
const GP_ROLES = ['growth_partner', 'telecaller', 'sales_agent', 'team_leader', 'partner'];

const AdminUsers = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('users');
  const [users, setUsers] = useState([]);
  const [managers, setManagers] = useState([]);
  const [teamLeads, setTeamLeads] = useState([]);
  const [hierarchyStats, setHierarchyStats] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showUserModal, setShowUserModal] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [showBulkApprovalModal, setShowBulkApprovalModal] = useState(false);
  const [showEditRoleModal, setShowEditRoleModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [selectedManagerId, setSelectedManagerId] = useState(null);
  const [selectedTlId, setSelectedTlId] = useState(null);
  const [newUser, setNewUser] = useState({ 
    name: '', email: '', password: '', role: 'growth_partner', phone: ''
  });
  const [roleEditData, setRoleEditData] = useState({
    role: '',
    is_tl: false,
    manager_id: null,
    tl_id: null
  });
  const [newPassword, setNewPassword] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterRole, setFilterRole] = useState('');
  const [filterManager, setFilterManager] = useState('');
  const [filterStatus, setFilterStatus] = useState(''); // all, active, inactive
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

  const fetchManagers = async () => {
    try {
      const response = await api.get('/users/managers');
      setManagers(response.data);
    } catch (error) {
      console.error('Error fetching managers:', error);
    }
  };

  const fetchTeamLeads = async (managerId = null) => {
    try {
      const url = managerId ? `/users/team-leads?manager_id=${managerId}` : '/users/team-leads';
      const response = await api.get(url);
      setTeamLeads(response.data);
    } catch (error) {
      console.error('Error fetching team leads:', error);
    }
  };

  const fetchHierarchyStats = async () => {
    try {
      const response = await api.get('/users/hierarchy-stats');
      setHierarchyStats(response.data);
    } catch (error) {
      console.error('Error fetching hierarchy stats:', error);
    }
  };

  useEffect(() => {
    fetchUsers();
    fetchManagers();
    fetchTeamLeads();
    fetchHierarchyStats();
  }, []);

  // When manager changes in edit modal, fetch relevant TLs
  useEffect(() => {
    if (roleEditData.manager_id) {
      fetchTeamLeads(roleEditData.manager_id);
    } else {
      fetchTeamLeads();
    }
  }, [roleEditData.manager_id]);

  const handleAddUser = async () => {
    if (!newUser.name.trim() || !newUser.email.trim() || !newUser.password.trim()) {
      toast.error('Please fill in Name, Email and Password');
      return;
    }
    setIsSubmitting(true);
    try {
      await api.post('/users', newUser);
      setShowAddModal(false);
      setNewUser({ name: '', email: '', password: '', role: 'growth_partner', phone: '' });
      fetchUsers();
      fetchHierarchyStats();
      toast.success('User created successfully');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to create user');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleApproveUser = async (userId, managerId = null, tlId = null) => {
    setIsSubmitting(true);
    try {
      await api.post(`/users/${userId}/approve`, { 
        manager_id: managerId,
        tl_id: tlId
      });
      fetchUsers();
      fetchHierarchyStats();
      toast.success('User approved! Email notification sent.');
      setShowUserModal(false);
      setSelectedManagerId(null);
      setSelectedTlId(null);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to approve user');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRejectUser = async (userId, reason = '') => {
    setIsSubmitting(true);
    try {
      await api.post(`/users/${userId}/reject`, { reason });
      fetchUsers();
      fetchHierarchyStats();
      toast.success('User rejected. Email notification sent.');
      setShowUserModal(false);
      setRejectionReason('');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to reject user');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleBulkApprove = async () => {
    if (selectedUsers.length === 0) {
      toast.error('No users selected');
      return;
    }
    setIsSubmitting(true);
    try {
      const response = await api.post('/users/bulk-approve', {
        user_ids: selectedUsers,
        manager_id: selectedManagerId,
        tl_id: selectedTlId
      });
      fetchUsers();
      fetchHierarchyStats();
      toast.success(`Approved ${response.data.approved_count} users! ${response.data.emails_sent} emails sent.`);
      setShowBulkApprovalModal(false);
      setSelectedUsers([]);
      setSelectedManagerId(null);
      setSelectedTlId(null);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to bulk approve');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdateRoleHierarchy = async () => {
    if (!selectedUser) return;
    setIsSubmitting(true);
    try {
      // Build payload - only include GP-specific fields for GP roles
      const payload = {};
      
      // Always include role if changed
      if (roleEditData.role !== selectedUser.role) {
        payload.role = roleEditData.role;
      }
      
      // Only include is_tl for GP roles and if changed
      if (isGpRole(roleEditData.role)) {
        if (roleEditData.is_tl !== (selectedUser.is_tl || false)) {
          payload.is_tl = roleEditData.is_tl;
        }
        // Only include tl_id for non-TL GPs and if changed
        if (!roleEditData.is_tl && roleEditData.tl_id !== (selectedUser.tl_id || null)) {
          payload.tl_id = roleEditData.tl_id || '';
        }
      }
      
      // Include manager_id if changed
      if (roleEditData.manager_id !== (selectedUser.manager_id || null)) {
        payload.manager_id = roleEditData.manager_id || '';
      }
      
      // If nothing changed, just close
      if (Object.keys(payload).length === 0) {
        toast.info('No changes to save');
        setShowEditRoleModal(false);
        return;
      }
      
      await api.put(`/users/${selectedUser.id}/role-hierarchy`, payload);
      fetchUsers();
      fetchHierarchyStats();
      toast.success('User role and hierarchy updated');
      setShowEditRoleModal(false);
      setSelectedUser(null);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to update user');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleActive = async (userId, currentStatus, e) => {
    e?.stopPropagation();
    try {
      await api.put(`/users/${userId}/toggle-active`);
      fetchUsers();
      toast.success(currentStatus ? 'User deactivated' : 'User activated');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to update user');
    }
  };

  const handleDeleteUser = async (user, e) => {
    e?.stopPropagation();
    
    // Confirm deletion
    if (!window.confirm(`Are you sure you want to delete "${user.name}"? This action cannot be undone.`)) {
      return;
    }
    
    try {
      await api.delete(`/users/${user.id}`);
      fetchUsers();
      toast.success(`User "${user.name}" deleted successfully`);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to delete user');
    }
  };

  const formatLastLogin = (lastLogin) => {
    if (!lastLogin) return 'Never';
    
    const date = new Date(lastLogin);
    const now = new Date();
    const diffMs = now - date;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
    if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
    return date.toLocaleDateString();
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

  const toggleUserSelection = (userId) => {
    setSelectedUsers(prev => 
      prev.includes(userId) 
        ? prev.filter(id => id !== userId) 
        : [...prev, userId]
    );
  };

  const toggleSelectAll = () => {
    const pendingIds = pendingUsers.map(u => u.id);
    if (selectedUsers.length === pendingIds.length) {
      setSelectedUsers([]);
    } else {
      setSelectedUsers(pendingIds);
    }
  };

  const openUserDetail = (user, e) => {
    e?.stopPropagation();
    setSelectedUser(user);
    setShowUserModal(true);
  };

  const openEditRoleModal = (user, e) => {
    e?.stopPropagation();
    setSelectedUser(user);
    setRoleEditData({
      role: user.role || 'growth_partner',
      is_tl: user.is_tl || false,
      manager_id: user.manager_id || null,
      tl_id: user.tl_id || null
    });
    setShowEditRoleModal(true);
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

  const isGpRole = (role) => GP_ROLES.includes(role);

  // Filter users based on tab and search
  const pendingUsers = users.filter(u => u.approval_status === 'pending');
  const approvedUsers = users.filter(u => u.approval_status !== 'pending' || u.is_active);
  
  const filteredUsers = (activeTab === 'approvals' ? pendingUsers : approvedUsers).filter(user => {
    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      const matchesSearch = (
        user.name?.toLowerCase().includes(query) ||
        user.email?.toLowerCase().includes(query) ||
        user.partner_code?.toLowerCase().includes(query)
      );
      if (!matchesSearch) return false;
    }
    
    // Role filter
    if (filterRole) {
      if (filterRole === 'growth_partner') {
        // Show GPs who are NOT TLs
        if (!isGpRole(user.role) || user.is_tl) return false;
      } else if (filterRole === 'team_lead') {
        // Show only users with is_tl=true
        if (!user.is_tl) return false;
      } else if (user.role !== filterRole) {
        return false;
      }
    }
    
    // Manager filter
    if (filterManager && user.manager_id !== filterManager) {
      return false;
    }
    
    // Status filter (active/inactive)
    if (filterStatus === 'active' && !user.is_active) return false;
    if (filterStatus === 'inactive' && user.is_active) return false;
    
    return true;
  }).sort((a, b) => {
    // Sort: Active users first, then inactive
    if (a.is_active && !b.is_active) return -1;
    if (!a.is_active && b.is_active) return 1;
    // Within same status, sort by name
    return (a.name || '').localeCompare(b.name || '');
  });

  // Count active and inactive for display
  const activeCount = approvedUsers.filter(u => u.is_active).length;
  const inactiveCount = approvedUsers.filter(u => !u.is_active).length;

  // Pagination
  const totalPages = Math.ceil(filteredUsers.length / pageSize);
  const paginatedUsers = filteredUsers.slice((currentPage - 1) * pageSize, currentPage * pageSize);

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
          onClick={() => { setActiveTab('approvals'); setCurrentPage(1); setSelectedUsers([]); }}
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

      {/* Dashboard Tab */}
      {activeTab === 'dashboard' && hierarchyStats && (
        <div className="space-y-6">
          <h2 className="text-xl font-bold text-gray-900">User Hierarchy Overview</h2>
          
          {/* Role Stats Cards */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {Object.entries(hierarchyStats.role_counts).map(([role, count]) => {
              const config = ROLE_CONFIG[role] || { label: role, color: 'bg-gray-100 text-gray-700' };
              return (
                <div key={role} className={`p-4 rounded-lg border ${config.color.replace('text-', 'border-').replace('100', '200')}`}>
                  <p className="text-sm text-gray-600">{config.label}</p>
                  <p className="text-2xl font-bold">{count}</p>
                </div>
              );
            })}
          </div>
          
          {/* Summary Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-4 bg-green-50 rounded-lg border border-green-200">
              <p className="text-sm text-green-600">Total Growth Partners</p>
              <p className="text-2xl font-bold text-green-700">{hierarchyStats.total_gps}</p>
            </div>
            <div className="p-4 bg-purple-50 rounded-lg border border-purple-200">
              <p className="text-sm text-purple-600">Team Leads</p>
              <p className="text-2xl font-bold text-purple-700">{hierarchyStats.total_tls}</p>
            </div>
            <div className="p-4 bg-amber-50 rounded-lg border border-amber-200">
              <p className="text-sm text-amber-600">Unassigned GPs</p>
              <p className="text-2xl font-bold text-amber-700">{hierarchyStats.unassigned_gps}</p>
            </div>
            <div className="p-4 bg-orange-50 rounded-lg border border-orange-200">
              <p className="text-sm text-orange-600">Pending Approvals</p>
              <p className="text-2xl font-bold text-orange-700">{hierarchyStats.pending_approvals}</p>
            </div>
          </div>
          
          <div className="flex gap-3">
            <button
              onClick={() => { fetchUsers(); fetchHierarchyStats(); toast.success('Data refreshed'); }}
              className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 flex items-center gap-2"
            >
              <RefreshCw size={16} /> Refresh
            </button>
          </div>
        </div>
      )}

      {/* Users/Approvals Tab */}
      {activeTab !== 'dashboard' && (
        <>
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
            <div>
              <h2 className="text-xl font-bold text-gray-900">
                {activeTab === 'approvals' ? `Pending Approvals (${pendingUsers.length})` : `All Users (${approvedUsers.length})`}
              </h2>
              <p className="text-sm text-gray-500">
                {activeTab === 'approvals' ? 'New registrations awaiting approval' : 'Manage users, roles, and team hierarchy'}
              </p>
            </div>
            <div className="flex items-center gap-3">
              {activeTab === 'approvals' && selectedUsers.length > 0 && (
                <button
                  onClick={() => setShowBulkApprovalModal(true)}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 flex items-center gap-2"
                >
                  <CheckCircle size={18} /> Approve Selected ({selectedUsers.length})
                </button>
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

          {/* Search & Filters */}
          <div className="flex flex-wrap gap-3 mb-4">
            <div className="relative flex-1 min-w-[200px] max-w-md">
              <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Search by name, email, or code..."
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
                className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
            
            {activeTab === 'users' && (
              <>
                <select
                  value={filterStatus}
                  onChange={(e) => { setFilterStatus(e.target.value); setCurrentPage(1); }}
                  className="px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                  data-testid="filter-status"
                >
                  <option value="">All Status ({activeCount} active, {inactiveCount} inactive)</option>
                  <option value="active">Active Only ({activeCount})</option>
                  <option value="inactive">Inactive Only ({inactiveCount})</option>
                </select>
                
                <select
                  value={filterRole}
                  onChange={(e) => { setFilterRole(e.target.value); setCurrentPage(1); }}
                  className="px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                >
                  <option value="">All Roles</option>
                  {FILTER_ROLES.map(role => (
                    <option key={role} value={role}>{ROLE_CONFIG[role]?.label || role}</option>
                  ))}
                </select>
                
                <select
                  value={filterManager}
                  onChange={(e) => { setFilterManager(e.target.value); setCurrentPage(1); }}
                  className="px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                >
                  <option value="">All Managers</option>
                  {managers.filter(m => m.id).map(m => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              </>
            )}
          </div>

          {/* Users Table */}
          <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
            {/* Table Header */}
            <div className="min-w-[1200px]">
              <div className="grid gap-2 px-4 py-3 bg-gray-50 border-b border-gray-200 text-sm font-medium text-gray-600" style={{ gridTemplateColumns: activeTab === 'approvals' ? 'auto 1fr 1.5fr auto auto auto auto auto auto auto' : '1fr 1.5fr auto auto auto auto auto auto 100px' }}>
                {activeTab === 'approvals' && (
                  <div className="flex items-center">
                    <input
                      type="checkbox"
                      checked={selectedUsers.length === pendingUsers.length && pendingUsers.length > 0}
                      onChange={toggleSelectAll}
                      className="w-4 h-4 rounded border-gray-300 text-green-600 focus:ring-green-500"
                    />
                  </div>
                )}
                <div>Name</div>
                <div>Email</div>
                <div>Role</div>
                <div>Source</div>
                <div>Files</div>
                <div>Last Login</div>
                <div>Status</div>
                <div>Actions</div>
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
                    const isSelected = selectedUsers.includes(user.id);
                    const isGP = isGpRole(user.role);
                    
                    return (
                      <div 
                        key={user.id} 
                        className={`grid gap-2 px-4 py-3 items-center hover:bg-gray-50 transition-colors ${isSelected ? 'bg-green-50' : ''}`}
                        style={{ gridTemplateColumns: activeTab === 'approvals' ? 'auto 1fr 1.5fr auto auto auto auto auto auto auto' : '1fr 1.5fr auto auto auto auto auto auto 100px' }}
                      >
                        {activeTab === 'approvals' && (
                          <div>
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleUserSelection(user.id)}
                              className="w-4 h-4 rounded border-gray-300 text-green-600 focus:ring-green-500"
                            />
                          </div>
                        )}
                        <div>
                          <p className="font-medium text-gray-900 truncate">{user.name || 'Unnamed'}</p>
                          {user.phone && <p className="text-xs text-gray-500">{user.phone}</p>}
                        </div>
                        <div>
                          <p className="text-gray-600 truncate text-sm">{user.email}</p>
                        </div>
                        <div>
                          <span className={`inline-block px-2 py-0.5 text-xs rounded ${roleConfig.color}`}>
                            {roleConfig.label}
                          </span>
                        </div>
                        <div>
                          <span className={`inline-block px-2 py-0.5 text-xs rounded ${
                            user.source === 'connect' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'
                          }`}>
                            {user.source === 'connect' ? 'Connect' : 'CRM'}
                          </span>
                        </div>
                        <div>
                          <span className={`px-2 py-0.5 text-xs rounded font-medium ${
                            user.files_count > 0 ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                          }`}>
                            {user.files_count || 0}
                          </span>
                        </div>
                        <div>
                          <span className={`text-xs ${user.last_login ? 'text-gray-600' : 'text-red-500'}`}>
                            {formatLastLogin(user.last_login)}
                          </span>
                        </div>
                        <div>
                          {isPending ? (
                            <span className="px-2 py-0.5 text-xs rounded bg-amber-100 text-amber-700 flex items-center gap-1 w-fit">
                              <Clock size={12} /> Pending
                            </span>
                          ) : (
                            <span className={`px-2 py-0.5 text-xs rounded ${
                              (user.is_active !== false && user.status !== 'inactive') ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                            }`}>
                              {(user.is_active !== false && user.status !== 'inactive') ? 'Active' : 'Inactive'}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-0.5">
                          <button
                            onClick={(e) => openUserDetail(user, e)}
                            className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded"
                            title="View details"
                          >
                            <Eye size={16} />
                          </button>
                          {!isPending && (
                            <>
                              <button
                                onClick={(e) => openEditRoleModal(user, e)}
                                className="p-1.5 text-blue-500 hover:text-blue-700 hover:bg-blue-50 rounded"
                                title="Edit role & hierarchy"
                              >
                                <Edit2 size={16} />
                              </button>
                              {/* Toggle Active/Inactive - not for admins */}
                              {user.role !== 'admin' && (
                                <button
                                  onClick={(e) => handleToggleActive(user.id, user.is_active !== false, e)}
                                  className={`p-1.5 rounded ${
                                    user.is_active !== false 
                                      ? 'text-amber-500 hover:text-amber-700 hover:bg-amber-50' 
                                      : 'text-green-500 hover:text-green-700 hover:bg-green-50'
                                  }`}
                                  title={user.is_active !== false ? 'Deactivate user' : 'Activate user'}
                                >
                                  <Power size={16} />
                                </button>
                              )}
                              {/* Delete - not for admins */}
                              {user.role !== 'admin' && (
                                <button
                                  onClick={(e) => handleDeleteUser(user, e)}
                                  className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded"
                                  title="Delete user"
                                >
                                  <Trash2 size={16} />
                                </button>
                              )}
                            </>
                          )}
                          {isPending && (
                            <button
                              onClick={(e) => { e.stopPropagation(); openUserDetail(user, e); }}
                              className="p-1.5 text-green-600 hover:bg-green-50 rounded"
                              title="Review & Approve"
                            >
                              <CheckCircle size={16} />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

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
        </>
      )}

      {/* User Detail Modal */}
      <Modal 
        isOpen={showUserModal} 
        onClose={() => { setShowUserModal(false); setSelectedUser(null); setSelectedManagerId(null); setSelectedTlId(null); setRejectionReason(''); }} 
        title=""
      >
        {selectedUser && (
          <div className="p-0">
            {/* Header */}
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
                     selectedUser.approval_status === 'rejected' ? 'Rejected' : 'Pending Approval'}
                  </span>
                  {selectedUser.is_tl && (
                    <span className="px-2 py-0.5 text-xs rounded bg-purple-100 text-purple-700">
                      Team Lead
                    </span>
                  )}
                </div>
                <p className="text-sm text-gray-500">{selectedUser.phone} | Code: <span className="text-green-600 font-mono">{selectedUser.partner_code || 'N/A'}</span></p>
                <p className="text-sm text-gray-500">{selectedUser.email}</p>
              </div>
            </div>

            {/* Details */}
            <div className="p-4">
              <div className="grid grid-cols-3 gap-6 mb-6">
                {/* Basic Info */}
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
                    <p><span className="text-gray-500">Role:</span> <span className={`px-2 py-0.5 text-xs rounded ${ROLE_CONFIG[selectedUser.role]?.color || 'bg-gray-100'}`}>{ROLE_CONFIG[selectedUser.role]?.label || selectedUser.role}</span></p>
                  </div>
                </div>

                {/* KYC */}
                <div>
                  <div className="flex items-center gap-2 text-gray-600 mb-3">
                    <CreditCard size={16} />
                    <span className="font-medium">KYC Details</span>
                  </div>
                  <div className="space-y-2 text-sm">
                    <p><span className="text-gray-500">PAN:</span> <span className="text-gray-900 font-mono">{selectedUser.pan_number || 'N/A'}</span></p>
                  </div>
                </div>

                {/* Bank */}
                <div>
                  <div className="flex items-center gap-2 text-gray-600 mb-3">
                    <Building2 size={16} />
                    <span className="font-medium">Bank Details</span>
                  </div>
                  <div className="space-y-2 text-sm">
                    {selectedUser.bank_details ? (
                      <>
                        <p><span className="text-gray-500">Bank:</span> <span className="text-gray-900">{selectedUser.bank_details.bank_name}</span></p>
                        <p><span className="text-gray-500">A/C:</span> <span className="text-gray-900 font-mono">{selectedUser.bank_details.account_number}</span></p>
                        <p><span className="text-gray-500">IFSC:</span> <span className="text-gray-900 font-mono">{selectedUser.bank_details.ifsc_code}</span></p>
                      </>
                    ) : (
                      <p className="text-gray-400 italic">Not provided</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Hierarchy Info */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-6">
                <div className="flex items-center gap-2 text-blue-700 mb-2">
                  <Users size={16} />
                  <span className="font-medium">Team Hierarchy</span>
                </div>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-blue-600">Manager:</p>
                    <p className="text-blue-800 font-medium">{selectedUser.manager_name || 'Unassigned'}</p>
                  </div>
                  <div>
                    <p className="text-blue-600">Team Lead:</p>
                    <p className="text-blue-800 font-medium">{selectedUser.tl_name || 'None'}</p>
                  </div>
                </div>
              </div>

              {/* Password Section */}
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-6">
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
                        <button onClick={() => togglePasswordVisibility(selectedUser.id)} className="p-2 hover:bg-amber-100 rounded-lg">
                          {showPassword[selectedUser.id] ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                        <button onClick={() => copyToClipboard(selectedUser.plain_password, 'password')} className="p-2 hover:bg-amber-100 rounded-lg">
                          {copiedField === 'password' ? <Check size={16} className="text-green-600" /> : <Copy size={16} />}
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => { setShowUserModal(false); setShowPasswordModal(true); }}
                      className="px-3 py-1.5 bg-amber-100 text-amber-700 rounded-lg text-sm hover:bg-amber-200 flex items-center gap-1"
                    >
                      <Key size={14} /> Change
                    </button>
                  </div>
                </div>
              </div>

              {/* Manager/TL Assignment (for pending users) */}
              {selectedUser.approval_status === 'pending' && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6">
                  <div className="flex items-center gap-2 text-green-700 mb-3">
                    <Users size={16} />
                    <span className="font-medium">Assign Team (Optional)</span>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm text-green-600 mb-1">Manager</label>
                      <select
                        value={selectedManagerId || ''}
                        onChange={(e) => {
                          setSelectedManagerId(e.target.value || null);
                          setSelectedTlId(null); // Reset TL when manager changes
                          if (e.target.value) {
                            fetchTeamLeads(e.target.value);
                          }
                        }}
                        className="w-full px-3 py-2 border border-green-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
                      >
                        <option value="">Unassigned</option>
                        {managers.filter(m => m.id).map(manager => (
                          <option key={manager.id} value={manager.id}>{manager.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm text-green-600 mb-1">Team Lead</label>
                      <select
                        value={selectedTlId || ''}
                        onChange={(e) => setSelectedTlId(e.target.value || null)}
                        className="w-full px-3 py-2 border border-green-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
                        disabled={!selectedManagerId}
                      >
                        <option value="">No Team Lead</option>
                        {teamLeads.filter(t => t.id && (!selectedManagerId || t.manager_id === selectedManagerId)).map(tl => (
                          <option key={tl.id} value={tl.id}>{tl.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <p className="text-xs text-green-600 mt-2">
                    <Mail size={12} className="inline mr-1" />
                    Email notification will be sent upon approval
                  </p>
                </div>
              )}

              {/* Action Buttons */}
              {selectedUser.approval_status === 'pending' && (
                <div className="flex gap-3 pt-4 border-t border-gray-200">
                  <button
                    onClick={() => handleApproveUser(selectedUser.id, selectedManagerId, selectedTlId)}
                    disabled={isSubmitting}
                    className="flex-1 px-4 py-2.5 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {isSubmitting ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle size={18} />}
                    Approve & Send Email
                  </button>
                  <button
                    onClick={() => handleRejectUser(selectedUser.id, rejectionReason)}
                    disabled={isSubmitting}
                    className="flex-1 px-4 py-2.5 bg-red-100 text-red-600 rounded-lg font-medium hover:bg-red-200 disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    <XCircle size={18} /> Reject
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* Edit Role & Hierarchy Modal */}
      <Modal
        isOpen={showEditRoleModal}
        onClose={() => { setShowEditRoleModal(false); setSelectedUser(null); }}
        title="Edit Role & Hierarchy"
      >
        {selectedUser && (
          <div className="p-6 space-y-4">
            <div className="bg-gray-50 rounded-lg p-3 mb-2">
              <p className="font-medium">{selectedUser.name}</p>
              <p className="text-sm text-gray-500">{selectedUser.email}</p>
            </div>

            {/* Role Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Base Role</label>
              <div className="grid grid-cols-3 gap-2">
                {BASE_ROLES.map(role => (
                  <button
                    key={role}
                    type="button"
                    onClick={() => {
                      setRoleEditData(prev => ({ 
                        ...prev, 
                        role,
                        is_tl: role === 'growth_partner' ? prev.is_tl : false,
                        tl_id: role === 'growth_partner' ? prev.tl_id : null
                      }));
                    }}
                    className={`px-3 py-2 rounded-lg border text-sm ${
                      roleEditData.role === role
                        ? 'border-green-600 bg-green-50 text-green-700'
                        : 'border-gray-200 text-gray-600 hover:border-green-300'
                    }`}
                  >
                    {ROLE_CONFIG[role]?.label || role}
                  </button>
                ))}
              </div>
            </div>

            {/* TL Toggle (only for GPs) */}
            {isGpRole(roleEditData.role) && (
              <div className="flex items-center justify-between p-3 bg-purple-50 rounded-lg border border-purple-200">
                <div>
                  <p className="font-medium text-purple-700">Team Lead Capability</p>
                  <p className="text-xs text-purple-600">Enable to allow this GP to manage a team</p>
                </div>
                <button
                  onClick={() => setRoleEditData(prev => ({ ...prev, is_tl: !prev.is_tl }))}
                  className={`p-2 rounded-lg ${roleEditData.is_tl ? 'bg-purple-600 text-white' : 'bg-white text-gray-400 border'}`}
                >
                  {roleEditData.is_tl ? <ToggleRight size={24} /> : <ToggleLeft size={24} />}
                </button>
              </div>
            )}

            {/* Manager Assignment */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Manager</label>
              <select
                value={roleEditData.manager_id || ''}
                onChange={(e) => {
                  const newManagerId = e.target.value || null;
                  setRoleEditData(prev => ({ 
                    ...prev, 
                    manager_id: newManagerId,
                    tl_id: null // Reset TL when manager changes
                  }));
                }}
                className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
              >
                <option value="">Unassigned</option>
                {managers.filter(m => m.id).map(manager => (
                  <option key={manager.id} value={manager.id}>{manager.name} ({manager.email?.split('@')[0]})</option>
                ))}
              </select>
            </div>

            {/* TL Assignment (only for GPs, not TLs themselves) */}
            {isGpRole(roleEditData.role) && !roleEditData.is_tl && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Team Lead</label>
                <select
                  value={roleEditData.tl_id || ''}
                  onChange={(e) => setRoleEditData(prev => ({ ...prev, tl_id: e.target.value || null }))}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                  disabled={!roleEditData.manager_id}
                >
                  <option value="">No Team Lead (Direct to Manager)</option>
                  {teamLeads.filter(t => t.id && (!roleEditData.manager_id || t.manager_id === roleEditData.manager_id)).map(tl => (
                    <option key={tl.id} value={tl.id}>{tl.name}</option>
                  ))}
                </select>
                {!roleEditData.manager_id && (
                  <p className="text-xs text-amber-600 mt-1">Select a manager first to see available Team Leads</p>
                )}
              </div>
            )}

            <div className="flex gap-3 pt-4">
              <button
                onClick={() => setShowEditRoleModal(false)}
                className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg font-medium hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleUpdateRoleHierarchy}
                disabled={isSubmitting}
                className="flex-1 px-4 py-2.5 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isSubmitting ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />}
                Save Changes
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Bulk Approval Modal */}
      <Modal
        isOpen={showBulkApprovalModal}
        onClose={() => { setShowBulkApprovalModal(false); setSelectedManagerId(null); setSelectedTlId(null); }}
        title="Bulk Approve Users"
      >
        <div className="p-6">
          <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6">
            <p className="text-green-700 font-medium mb-2">
              <CheckCircle size={16} className="inline mr-2" />
              Approving {selectedUsers.length} users
            </p>
            <p className="text-sm text-green-600">
              All selected users will be activated and email notifications will be sent.
            </p>
          </div>

          <div className="space-y-4 mb-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                <Users size={14} className="inline mr-1" />
                Assign Manager to All
              </label>
              <select
                value={selectedManagerId || ''}
                onChange={(e) => {
                  setSelectedManagerId(e.target.value || null);
                  setSelectedTlId(null);
                  if (e.target.value) {
                    fetchTeamLeads(e.target.value);
                  }
                }}
                className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
              >
                <option value="">Unassigned</option>
                {managers.filter(m => m.id).map(manager => (
                  <option key={manager.id} value={manager.id}>{manager.name}</option>
                ))}
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Assign Team Lead to All
              </label>
              <select
                value={selectedTlId || ''}
                onChange={(e) => setSelectedTlId(e.target.value || null)}
                className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                disabled={!selectedManagerId}
              >
                <option value="">No Team Lead</option>
                {teamLeads.filter(t => t.id && (!selectedManagerId || t.manager_id === selectedManagerId)).map(tl => (
                  <option key={tl.id} value={tl.id}>{tl.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-6">
            <p className="text-sm text-blue-700">
              <Mail size={14} className="inline mr-1" />
              Email notifications will be sent to all approved users with their login details.
            </p>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => setShowBulkApprovalModal(false)}
              className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg font-medium hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={handleBulkApprove}
              disabled={isSubmitting}
              className="flex-1 px-4 py-2.5 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isSubmitting ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle size={18} />}
              Approve All ({selectedUsers.length})
            </button>
          </div>
        </div>
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
              {BASE_ROLES.map(role => (
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
                  {ROLE_CONFIG[role]?.label || role}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-3 pt-4">
            <button onClick={() => setShowAddModal(false)} className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg">Cancel</button>
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
