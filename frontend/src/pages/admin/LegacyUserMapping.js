import React, { useState, useEffect } from 'react';
import { 
  Link2, Users, FileText, Loader2, Search, 
  ArrowRight, Check, X, AlertTriangle, Trash2,
  UserCheck, ChevronDown, ChevronUp, RotateCcw, Clock
} from 'lucide-react';
import api from '../../services/api';
import Modal from '../../components/Modal';
import { toast } from 'sonner';

const LegacyUserMapping = () => {
  const [legacyMappings, setLegacyMappings] = useState([]);
  const [connectUsers, setConnectUsers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showMappedOnly, setShowMappedOnly] = useState(false);
  const [showMapModal, setShowMapModal] = useState(false);
  const [selectedLegacy, setSelectedLegacy] = useState(null);
  const [selectedConnectUser, setSelectedConnectUser] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [expandedRows, setExpandedRows] = useState({});
  const [showUndoModal, setShowUndoModal] = useState(false);
  const [selectedForUndo, setSelectedForUndo] = useState(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [mappingsRes, usersRes] = await Promise.all([
        api.get('/users/legacy-mappings'),
        api.get('/users/connect-users-for-mapping')
      ]);
      setLegacyMappings(mappingsRes.data);
      setConnectUsers(usersRes.data);
    } catch (error) {
      console.error('Error fetching data:', error);
      toast.error('Failed to load legacy user data');
    } finally {
      setIsLoading(false);
    }
  };

  const filteredMappings = legacyMappings.filter(m => {
    const matchesSearch = !searchQuery || 
      (m.legacy_name?.toLowerCase() || '').includes(searchQuery.toLowerCase()) ||
      (m.legacy_email?.toLowerCase() || '').includes(searchQuery.toLowerCase());
    
    const matchesFilter = !showMappedOnly || m.is_mapped;
    
    return matchesSearch && matchesFilter;
  });

  const unmappedCount = legacyMappings.filter(m => !m.is_mapped).length;
  const mappedCount = legacyMappings.filter(m => m.is_mapped).length;

  const openMapModal = (legacy) => {
    setSelectedLegacy(legacy);
    setSelectedConnectUser('');
    setShowMapModal(true);
  };

  const handleMap = async () => {
    if (!selectedConnectUser) {
      toast.error('Please select a Connect user');
      return;
    }
    
    setIsSubmitting(true);
    try {
      const result = await api.post('/users/map-legacy-to-connect', {
        legacy_user_id: selectedLegacy.legacy_user_id,
        connect_user_id: selectedConnectUser,
        delete_legacy: true
      });
      
      toast.success(result.data.message);
      setShowMapModal(false);
      setSelectedLegacy(null);
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to map user');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteOrphan = async (legacyUserId) => {
    if (!window.confirm('Delete this legacy user? This cannot be undone.')) {
      return;
    }
    
    try {
      await api.delete(`/users/legacy-mapping/${legacyUserId}`);
      toast.success('Legacy user deleted');
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to delete');
    }
  };

  const openUndoModal = (mapping) => {
    setSelectedForUndo(mapping);
    setShowUndoModal(true);
  };

  const handleUndo = async () => {
    if (!selectedForUndo) return;
    
    setIsSubmitting(true);
    try {
      const result = await api.post(`/users/undo-mapping/${selectedForUndo.legacy_user_id}`);
      toast.success(result.data.message);
      setShowUndoModal(false);
      setSelectedForUndo(null);
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to undo mapping');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Calculate time remaining for undo
  const getUndoTimeRemaining = (canUndoUntil) => {
    if (!canUndoUntil) return null;
    
    const deadline = new Date(canUndoUntil);
    const now = new Date();
    const diffMs = deadline - now;
    
    if (diffMs <= 0) return null;
    
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    
    if (hours > 0) {
      return `${hours}h ${minutes}m left`;
    }
    return `${minutes}m left`;
  };

  const toggleRow = (id) => {
    setExpandedRows(prev => ({ ...prev, [id]: !prev[id] }));
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 text-green-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Link2 className="text-green-600" />
          Legacy CRM User Mapping
        </h1>
        <p className="text-gray-500 mt-1">
          Map legacy CRM users to Connect users. Once mapped, files will be transferred and the legacy user will be removed.
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <div className="flex items-center gap-2 text-amber-700">
            <AlertTriangle size={20} />
            <span className="font-medium">Unmapped</span>
          </div>
          <p className="text-2xl font-bold text-amber-800 mt-1">{unmappedCount}</p>
          <p className="text-sm text-amber-600">Legacy users needing mapping</p>
        </div>
        
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <div className="flex items-center gap-2 text-green-700">
            <UserCheck size={20} />
            <span className="font-medium">Mapped</span>
          </div>
          <p className="text-2xl font-bold text-green-800 mt-1">{mappedCount}</p>
          <p className="text-sm text-green-600">Successfully transferred</p>
        </div>
        
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-center gap-2 text-blue-700">
            <Users size={20} />
            <span className="font-medium">Connect Users</span>
          </div>
          <p className="text-2xl font-bold text-blue-800 mt-1">{connectUsers.length}</p>
          <p className="text-sm text-blue-600">Available for mapping</p>
        </div>
      </div>

      {/* Search & Filters */}
      <div className="flex gap-3 mb-4">
        <div className="relative flex-1 max-w-md">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search by name or email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
          />
        </div>
        
        <label className="flex items-center gap-2 px-4 py-2 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50">
          <input
            type="checkbox"
            checked={showMappedOnly}
            onChange={(e) => setShowMappedOnly(e.target.checked)}
            className="w-4 h-4 rounded border-gray-300 text-green-600 focus:ring-green-500"
          />
          <span className="text-sm text-gray-600">Show mapped only</span>
        </label>
      </div>

      {/* Legacy Users Table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Legacy User</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Email</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Role</th>
                <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">Files</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Status</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Mapped To</th>
                <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredMappings.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                    {searchQuery ? 'No matching legacy users found' : 'No legacy users to map'}
                  </td>
                </tr>
              ) : (
                filteredMappings.map((mapping) => (
                  <tr 
                    key={mapping.legacy_user_id}
                    className={`hover:bg-gray-50 ${mapping.is_mapped ? 'bg-green-50/30' : ''}`}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => toggleRow(mapping.legacy_user_id)}
                          className="p-1 text-gray-400 hover:text-gray-600"
                        >
                          {expandedRows[mapping.legacy_user_id] ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        </button>
                        <div>
                          <p className="font-medium text-gray-900">{mapping.legacy_name || 'Unknown'}</p>
                          <p className="text-xs text-gray-400 font-mono">{mapping.legacy_user_id?.slice(0, 12)}...</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {mapping.legacy_email || '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 text-xs rounded bg-gray-100 text-gray-600">
                        {mapping.legacy_role || 'Unknown'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`px-2 py-0.5 text-xs rounded font-medium ${
                        mapping.files_count > 0 ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'
                      }`}>
                        <FileText size={12} className="inline mr-1" />
                        {mapping.files_count}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {mapping.is_mapped ? (
                        <span className="px-2 py-0.5 text-xs rounded bg-green-100 text-green-700 flex items-center gap-1 w-fit">
                          <Check size={12} /> Mapped
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 text-xs rounded bg-amber-100 text-amber-700 flex items-center gap-1 w-fit">
                          <AlertTriangle size={12} /> Unmapped
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {mapping.is_mapped ? (
                        <span className="text-green-700 font-medium">{mapping.connect_name}</span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1">
                        {!mapping.is_mapped && (
                          <>
                            <button
                              onClick={() => openMapModal(mapping)}
                              className="px-3 py-1.5 bg-green-600 text-white text-xs rounded-lg hover:bg-green-700 flex items-center gap-1"
                            >
                              <ArrowRight size={14} /> Map
                            </button>
                            {mapping.files_count === 0 && (
                              <button
                                onClick={() => handleDeleteOrphan(mapping.legacy_user_id)}
                                className="p-1.5 text-red-500 hover:bg-red-50 rounded"
                                title="Delete orphan user"
                              >
                                <Trash2 size={16} />
                              </button>
                            )}
                          </>
                        )}
                        {mapping.is_mapped && (
                          <div className="flex items-center gap-2">
                            {mapping.can_undo ? (
                              <>
                                <button
                                  onClick={() => openUndoModal(mapping)}
                                  className="px-3 py-1.5 bg-amber-100 text-amber-700 text-xs rounded-lg hover:bg-amber-200 flex items-center gap-1"
                                  title="Undo this mapping"
                                >
                                  <RotateCcw size={14} /> Undo
                                </button>
                                <span className="text-xs text-gray-400 flex items-center gap-1">
                                  <Clock size={12} />
                                  {getUndoTimeRemaining(mapping.can_undo_until)}
                                </span>
                              </>
                            ) : (
                              <span className="text-green-600 flex items-center gap-1">
                                <Check size={18} />
                                <span className="text-xs text-gray-400">Permanent</span>
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Map Modal */}
      <Modal
        isOpen={showMapModal}
        onClose={() => { setShowMapModal(false); setSelectedLegacy(null); }}
        title="Map Legacy User to Connect"
      >
        {selectedLegacy && (
          <div className="p-6">
            {/* Legacy User Info */}
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4">
              <p className="text-sm text-amber-600 mb-1">Legacy CRM User</p>
              <p className="font-bold text-amber-800">{selectedLegacy.legacy_name || 'Unknown'}</p>
              <p className="text-sm text-amber-700">{selectedLegacy.legacy_email}</p>
              <p className="text-xs text-amber-600 mt-2">
                <FileText size={12} className="inline mr-1" />
                {selectedLegacy.files_count} files will be transferred
              </p>
            </div>

            {/* Arrow */}
            <div className="flex justify-center my-4">
              <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
                <ArrowRight className="text-green-600" />
              </div>
            </div>

            {/* Connect User Selection */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Select Connect User to Map To
              </label>
              <select
                value={selectedConnectUser}
                onChange={(e) => setSelectedConnectUser(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
              >
                <option value="">Choose a user...</option>
                {connectUsers.map(user => (
                  <option key={user.id} value={user.id}>
                    {user.name} ({user.email}) - {user.role}
                  </option>
                ))}
              </select>
            </div>

            {/* Warning */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
              <p className="text-sm text-blue-700">
                <AlertTriangle size={14} className="inline mr-1" />
                This will transfer all files from the legacy user to the selected Connect user and delete the legacy user entry.
              </p>
            </div>

            {/* Actions */}
            <div className="flex gap-3">
              <button
                onClick={() => setShowMapModal(false)}
                className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg font-medium hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleMap}
                disabled={!selectedConnectUser || isSubmitting}
                className="flex-1 px-4 py-2.5 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isSubmitting ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : (
                  <Check size={18} />
                )}
                Map & Transfer Files
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Undo Modal */}
      <Modal
        isOpen={showUndoModal}
        onClose={() => { setShowUndoModal(false); setSelectedForUndo(null); }}
        title="Undo Mapping"
      >
        {selectedForUndo && (
          <div className="p-6">
            {/* Warning */}
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="text-amber-600 mt-0.5" size={20} />
                <div>
                  <p className="font-medium text-amber-800">Are you sure you want to undo this mapping?</p>
                  <p className="text-sm text-amber-700 mt-1">
                    This will restore the legacy user and transfer all files back from the Connect user.
                  </p>
                </div>
              </div>
            </div>

            {/* Mapping Details */}
            <div className="bg-gray-50 rounded-lg p-4 mb-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-gray-500">Legacy User</p>
                  <p className="font-medium text-gray-900">{selectedForUndo.legacy_name}</p>
                  <p className="text-sm text-gray-500">{selectedForUndo.legacy_email}</p>
                </div>
                <ArrowRight className="text-gray-400" />
                <div className="text-right">
                  <p className="text-xs text-gray-500">Connect User</p>
                  <p className="font-medium text-green-700">{selectedForUndo.connect_name}</p>
                  <p className="text-sm text-gray-500">{selectedForUndo.connect_email}</p>
                </div>
              </div>
              <div className="mt-3 pt-3 border-t border-gray-200">
                <p className="text-sm text-gray-600">
                  <FileText size={14} className="inline mr-1" />
                  {selectedForUndo.files_transferred || selectedForUndo.files_count} files will be restored to the legacy user
                </p>
              </div>
            </div>

            {/* Time Remaining */}
            {selectedForUndo.can_undo_until && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
                <p className="text-sm text-blue-700 flex items-center gap-2">
                  <Clock size={14} />
                  Undo window: {getUndoTimeRemaining(selectedForUndo.can_undo_until)}
                </p>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3">
              <button
                onClick={() => setShowUndoModal(false)}
                className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg font-medium hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleUndo}
                disabled={isSubmitting}
                className="flex-1 px-4 py-2.5 bg-amber-600 text-white rounded-lg font-medium hover:bg-amber-700 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isSubmitting ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : (
                  <RotateCcw size={18} />
                )}
                Undo Mapping
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default LegacyUserMapping;
