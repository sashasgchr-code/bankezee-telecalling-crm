import React, { useEffect, useState } from 'react';
import { CheckCircle, XCircle, Clock, Users, Loader2, Search, AlertTriangle, Mail } from 'lucide-react';
import api from '../../services/api';
import { toast } from 'sonner';

const Approvals = () => {
  const [pendingUsers, setPendingUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [bulkApproving, setBulkApproving] = useState(false);
  const [selectedUsers, setSelectedUsers] = useState([]);

  useEffect(() => {
    fetchPendingUsers();
  }, []);

  const fetchPendingUsers = async () => {
    setLoading(true);
    try {
      const response = await api.get('/users/pending-approval');
      setPendingUsers(response.data || []);
    } catch (error) {
      console.error('Failed to fetch pending users:', error);
      toast.error('Failed to load pending approvals');
    } finally {
      setLoading(false);
    }
  };

  const handleApproveUser = async (userId) => {
    try {
      await api.post(`/users/${userId}/approve`);
      toast.success('User approved successfully');
      fetchPendingUsers();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to approve user');
    }
  };

  const handleRejectUser = async (userId) => {
    if (!window.confirm('Are you sure you want to reject this user? They will need to register again.')) return;
    try {
      await api.post(`/users/${userId}/reject`);
      toast.success('User rejected');
      fetchPendingUsers();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to reject user');
    }
  };

  const handleBulkApprove = async () => {
    if (selectedUsers.length === 0) {
      toast.error('Select users to approve');
      return;
    }
    
    setBulkApproving(true);
    try {
      const response = await api.post('/users/bulk-approve', {
        user_ids: selectedUsers
      });
      toast.success(`${response.data.approved_count} users approved successfully`);
      setSelectedUsers([]);
      fetchPendingUsers();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to bulk approve users');
    } finally {
      setBulkApproving(false);
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
    if (selectedUsers.length === filteredUsers.length) {
      setSelectedUsers([]);
    } else {
      setSelectedUsers(filteredUsers.map(u => u.id));
    }
  };

  const filteredUsers = pendingUsers.filter(user => {
    if (!searchTerm) return true;
    const search = searchTerm.toLowerCase();
    return (
      (user.name || '').toLowerCase().includes(search) ||
      (user.full_name || '').toLowerCase().includes(search) ||
      (user.email || '').toLowerCase().includes(search) ||
      (user.phone || '').includes(search)
    );
  });

  const getRoleBadgeColor = (role) => {
    switch(role) {
      case 'admin': return 'bg-purple-100 text-purple-700';
      case 'manager': return 'bg-blue-100 text-blue-700';
      case 'ops': return 'bg-indigo-100 text-indigo-700';
      case 'hr': return 'bg-pink-100 text-pink-700';
      case 'telecaller':
      case 'growth_partner':
      case 'sales_agent':
      case 'partner':
        return 'bg-green-100 text-green-700';
      default: return 'bg-gray-100 text-gray-700';
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-green-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">User Approvals</h1>
            <p className="text-sm text-gray-500">Approve new user registrations</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-orange-50 text-orange-700 rounded-lg">
              <Clock size={16} />
              <span className="font-medium">{pendingUsers.length} Pending</span>
            </div>
          </div>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Search and Bulk Actions */}
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            {/* Search */}
            <div className="relative flex-1 w-full sm:max-w-md">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Search by name, email or phone..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full h-10 pl-9 pr-4 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                data-testid="search-pending-users"
              />
            </div>
            
            {/* Bulk Actions */}
            {selectedUsers.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-600">
                  {selectedUsers.length} selected
                </span>
                <button
                  onClick={handleBulkApprove}
                  disabled={bulkApproving}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700 disabled:opacity-50 flex items-center gap-2"
                  data-testid="bulk-approve-btn"
                >
                  {bulkApproving ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <CheckCircle size={16} />
                  )}
                  Approve Selected
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Pending Users List */}
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          {filteredUsers.length === 0 ? (
            <div className="text-center py-16">
              <CheckCircle size={48} className="mx-auto mb-4 text-green-300" />
              <p className="text-gray-600 font-medium">No pending approvals</p>
              <p className="text-sm text-gray-500 mt-1">All user registrations have been processed</p>
            </div>
          ) : (
            <>
              {/* Table Header */}
              <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 flex items-center gap-4">
                <input
                  type="checkbox"
                  checked={selectedUsers.length === filteredUsers.length && filteredUsers.length > 0}
                  onChange={toggleSelectAll}
                  className="w-4 h-4 text-green-600 rounded border-gray-300"
                  data-testid="select-all-checkbox"
                />
                <span className="text-sm font-medium text-gray-700">
                  Select All ({filteredUsers.length})
                </span>
              </div>

              {/* User Cards */}
              <div className="divide-y divide-gray-100">
                {filteredUsers.map((user) => (
                  <div
                    key={user.id}
                    className={`px-4 py-4 hover:bg-gray-50 transition-colors ${
                      selectedUsers.includes(user.id) ? 'bg-green-50' : ''
                    }`}
                    data-testid={`pending-user-${user.id}`}
                  >
                    <div className="flex items-start gap-4">
                      {/* Checkbox */}
                      <input
                        type="checkbox"
                        checked={selectedUsers.includes(user.id)}
                        onChange={() => toggleUserSelection(user.id)}
                        className="mt-1 w-4 h-4 text-green-600 rounded border-gray-300"
                      />
                      
                      {/* User Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <h4 className="font-semibold text-gray-900">
                            {user.full_name || user.name || 'Unnamed User'}
                          </h4>
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${getRoleBadgeColor(user.role)}`}>
                            {user.role || 'user'}
                          </span>
                          {user.is_tl && (
                            <span className="px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700">
                              Team Lead
                            </span>
                          )}
                        </div>
                        
                        <div className="space-y-1 text-sm text-gray-600">
                          <div className="flex items-center gap-2">
                            <Mail size={14} className="text-gray-400" />
                            <span>{user.email || '-'}</span>
                          </div>
                          {user.phone && (
                            <div className="flex items-center gap-2">
                              <Users size={14} className="text-gray-400" />
                              <span>{user.phone}</span>
                            </div>
                          )}
                          <div className="text-xs text-gray-400">
                            Registered: {user.created_at ? new Date(user.created_at).toLocaleString() : '-'}
                          </div>
                        </div>
                      </div>
                      
                      {/* Actions */}
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <button
                          onClick={() => handleApproveUser(user.id)}
                          className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700 flex items-center gap-1.5"
                          data-testid={`approve-user-${user.id}`}
                        >
                          <CheckCircle size={16} />
                          Approve
                        </button>
                        <button
                          onClick={() => handleRejectUser(user.id)}
                          className="px-4 py-2 bg-red-50 text-red-600 border border-red-200 rounded-lg text-sm hover:bg-red-100 flex items-center gap-1.5"
                          data-testid={`reject-user-${user.id}`}
                        >
                          <XCircle size={16} />
                          Reject
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Info Box */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle size={20} className="text-blue-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-blue-800">
              <p className="font-medium mb-1">About User Approvals</p>
              <ul className="list-disc list-inside space-y-1 text-blue-700">
                <li>New users who register via the Connect app appear here for approval</li>
                <li>Approved users can log in and access features based on their role</li>
                <li>Rejected users will need to register again</li>
                <li>Bulk approval will send welcome emails to all selected users</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Approvals;
