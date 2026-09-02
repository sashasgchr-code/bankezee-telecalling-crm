import React, { useState, useEffect } from 'react';
import { Plus, Trash2, UserX, User, Loader2 } from 'lucide-react';
import api from '../../services/api';
import Modal from '../../components/Modal';

const AdminUsers = () => {
  const [users, setUsers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newUser, setNewUser] = useState({ name: '', email: '', password: '', role: 'telecaller' });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedUsers, setSelectedUsers] = useState([]);

  const fetchUsers = async () => {
    try {
      const response = await api.get('/users');
      setUsers(response.data);
    } catch (error) {
      console.error('Error fetching users:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleAddUser = async () => {
    if (!newUser.name.trim() || !newUser.email.trim() || !newUser.password.trim()) {
      alert('Please fill in all fields');
      return;
    }

    setIsSubmitting(true);
    try {
      await api.post('/users', newUser);
      setShowAddModal(false);
      setNewUser({ name: '', email: '', password: '', role: 'telecaller' });
      fetchUsers();
    } catch (error) {
      alert(error.response?.data?.detail || 'Failed to create user');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleActive = async (userId, currentStatus) => {
    try {
      await api.put(`/users/${userId}`, { is_active: !currentStatus });
      fetchUsers();
    } catch (error) {
      alert(error.response?.data?.detail || 'Failed to update user');
    }
  };

  const handleBulkDelete = async () => {
    if (selectedUsers.length === 0) return;

    if (window.confirm(`Are you sure you want to delete ${selectedUsers.length} users?`)) {
      try {
        await api.post('/users/bulk-delete', { user_ids: selectedUsers });
        setSelectedUsers([]);
        fetchUsers();
      } catch (error) {
        alert(error.response?.data?.detail || 'Failed to delete users');
      }
    }
  };

  const toggleUserSelection = (userId) => {
    setSelectedUsers(prev =>
      prev.includes(userId)
        ? prev.filter(id => id !== userId)
        : [...prev, userId]
    );
  };

  const telecallers = users.filter(u => u.role === 'telecaller');
  const admins = users.filter(u => u.role === 'admin');

  return (
    <div className="p-4" data-testid="admin-users">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Users</h2>
        <div className="flex gap-2">
          {selectedUsers.length > 0 && (
            <button
              onClick={handleBulkDelete}
              className="btn-danger flex items-center gap-1 text-sm py-2"
            >
              <Trash2 size={18} />
              Delete ({selectedUsers.length})
            </button>
          )}
          <button
            onClick={() => setShowAddModal(true)}
            className="btn-primary flex items-center gap-1 text-sm py-2"
            data-testid="add-user-btn"
          >
            <Plus size={18} />
            Add User
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 text-green-600 animate-spin" />
        </div>
      ) : (
        <>
          {/* Growth Partners */}
          <div className="mb-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-3">
              Growth Partners ({telecallers.length})
            </h3>
            <div className="space-y-3">
              {telecallers.map((user) => (
                <div
                  key={user.id}
                  className={`card p-4 flex items-center justify-between ${
                    !user.is_active ? 'opacity-60' : ''
                  }`}
                  data-testid={`user-card-${user.id}`}
                >
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={selectedUsers.includes(user.id)}
                      onChange={() => toggleUserSelection(user.id)}
                      className="w-5 h-5 rounded border-gray-300 text-green-600 focus:ring-green-500"
                    />
                    <div
                      className={`w-12 h-12 rounded-full flex items-center justify-center ${
                        user.is_active ? 'bg-green-600' : 'bg-gray-400'
                      }`}
                    >
                      <span className="text-white font-bold text-lg">
                        {user.name?.charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div>
                      <p className="font-semibold text-gray-900">{user.name}</p>
                      <p className="text-sm text-gray-500">{user.email}</p>
                      {user.plain_password && (
                        <p className="text-xs text-gray-400">Password: {user.plain_password}</p>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => handleToggleActive(user.id, user.is_active)}
                    className={`p-2 rounded-lg transition-colors ${
                      user.is_active
                        ? 'bg-red-100 text-red-600 hover:bg-red-200'
                        : 'bg-green-100 text-green-600 hover:bg-green-200'
                    }`}
                    title={user.is_active ? 'Deactivate' : 'Activate'}
                  >
                    {user.is_active ? <UserX size={20} /> : <User size={20} />}
                  </button>
                </div>
              ))}
              {telecallers.length === 0 && (
                <p className="text-center text-gray-500 py-4">No Growth Partners yet</p>
              )}
            </div>
          </div>

          {/* Admins */}
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-3">
              Admins ({admins.length})
            </h3>
            <div className="space-y-3">
              {admins.map((user) => (
                <div
                  key={user.id}
                  className="card p-4 flex items-center gap-3"
                >
                  <div className="w-12 h-12 rounded-full bg-blue-600 flex items-center justify-center">
                    <span className="text-white font-bold text-lg">
                      {user.name?.charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900">{user.name}</p>
                    <p className="text-sm text-gray-500">{user.email}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Add User Modal */}
      <Modal isOpen={showAddModal} onClose={() => setShowAddModal(false)} title="Add New User">
        <div className="p-4 space-y-4">
          <input
            type="text"
            value={newUser.name}
            onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
            placeholder="Full Name"
            className="input-field"
            data-testid="user-name-input"
          />
          <input
            type="email"
            value={newUser.email}
            onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
            placeholder="Email"
            className="input-field"
            data-testid="user-email-input"
          />
          <input
            type="password"
            value={newUser.password}
            onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
            placeholder="Password"
            className="input-field"
            data-testid="user-password-input"
          />
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setNewUser({ ...newUser, role: 'telecaller' })}
              className={`flex-1 py-3 rounded-lg border-2 font-semibold transition-colors ${
                newUser.role === 'telecaller'
                  ? 'border-green-600 bg-green-600 text-white'
                  : 'border-green-600 text-green-600'
              }`}
            >
              Growth Partner
            </button>
            <button
              type="button"
              onClick={() => setNewUser({ ...newUser, role: 'admin' })}
              className={`flex-1 py-3 rounded-lg border-2 font-semibold transition-colors ${
                newUser.role === 'admin'
                  ? 'border-green-600 bg-green-600 text-white'
                  : 'border-green-600 text-green-600'
              }`}
            >
              Admin
            </button>
          </div>
          <button
            onClick={handleAddUser}
            disabled={isSubmitting}
            className="btn-primary w-full flex items-center justify-center gap-2"
            data-testid="submit-user-btn"
          >
            {isSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Add User'}
          </button>
        </div>
      </Modal>
    </div>
  );
};

export default AdminUsers;
