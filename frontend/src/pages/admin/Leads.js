import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Filter, Upload, Plus, Users, Trash2, RefreshCw, Loader2, CheckSquare, Square, X } from 'lucide-react';
import api from '../../services/api';
import LeadCard from '../../components/LeadCard';
import Modal from '../../components/Modal';
import { StatusColors, StatusLabels } from '../../constants/colors';

const AdminLeads = () => {
  const navigate = useNavigate();
  const [leads, setLeads] = useState([]);
  const [telecallers, setTelecallers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [assignedFilter, setAssignedFilter] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  
  // Modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showAssignModal, setShowAssignModal] = useState(false);
  
  // Selection
  const [selectedLeads, setSelectedLeads] = useState([]);
  const [selectMode, setSelectMode] = useState(false);
  
  // Form
  const [newLead, setNewLead] = useState({ name: '', phone: '', email: '', city: '', source: '', notes: '' });
  const [importFile, setImportFile] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const statuses = ['new', 'not_interested', 'follow_up', 'presentation', 'leads', 'file'];

  const fetchData = async () => {
    try {
      const params = {};
      if (searchQuery) params.search = searchQuery;
      if (statusFilter) params.status = statusFilter;
      if (assignedFilter) params.assigned_to = assignedFilter;
      
      const [leadsRes, telecallersRes] = await Promise.all([
        api.get('/leads', { params }),
        api.get('/users/telecallers'),
      ]);
      setLeads(leadsRes.data);
      setTelecallers(telecallersRes.data);
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [searchQuery, statusFilter, assignedFilter]);

  const handleRefresh = () => {
    setIsRefreshing(true);
    fetchData();
  };

  const handleLeadPress = (lead) => {
    if (selectMode) {
      toggleLeadSelection(lead.id);
    } else {
      navigate(`/admin/leads/${lead.id}`);
    }
  };

  const handleCall = (lead) => {
    let phone = lead.phone.replace(/[^0-9+]/g, '');
    if (!phone.startsWith('+')) {
      phone = '+91' + phone;
    }
    window.location.href = `tel:${phone}`;
  };

  const toggleLeadSelection = (leadId) => {
    setSelectedLeads(prev => 
      prev.includes(leadId)
        ? prev.filter(id => id !== leadId)
        : [...prev, leadId]
    );
  };

  const selectAll = () => {
    if (selectedLeads.length === leads.length) {
      setSelectedLeads([]);
    } else {
      setSelectedLeads(leads.map(l => l.id));
    }
  };

  const handleAddLead = async () => {
    if (!newLead.name.trim() || !newLead.phone.trim()) {
      alert('Name and phone are required');
      return;
    }

    setIsSubmitting(true);
    try {
      await api.post('/leads', newLead);
      setShowAddModal(false);
      setNewLead({ name: '', phone: '', email: '', city: '', source: '', notes: '' });
      fetchData();
    } catch (error) {
      alert(error.response?.data?.detail || 'Failed to add lead');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleImport = async () => {
    if (!importFile) {
      alert('Please select a file');
      return;
    }

    setIsSubmitting(true);
    try {
      const formData = new FormData();
      formData.append('file', importFile);
      const response = await api.post('/leads/import', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      alert(response.data.message);
      setShowImportModal(false);
      setImportFile(null);
      fetchData();
    } catch (error) {
      alert(error.response?.data?.detail || 'Failed to import leads');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAssign = async (telecallerId) => {
    if (selectedLeads.length === 0) return;

    setIsSubmitting(true);
    try {
      await api.post('/leads/assign', {
        lead_ids: selectedLeads,
        user_id: telecallerId,
      });
      setShowAssignModal(false);
      setSelectedLeads([]);
      setSelectMode(false);
      fetchData();
    } catch (error) {
      alert(error.response?.data?.detail || 'Failed to assign leads');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAutoDistribute = async () => {
    if (selectedLeads.length === 0) return;

    setIsSubmitting(true);
    try {
      await api.post('/leads/auto-distribute', {
        lead_ids: selectedLeads,
      });
      alert('Leads distributed successfully');
      setShowAssignModal(false);
      setSelectedLeads([]);
      setSelectMode(false);
      fetchData();
    } catch (error) {
      alert(error.response?.data?.detail || 'Failed to distribute leads');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedLeads.length === 0) return;

    if (window.confirm(`Are you sure you want to delete ${selectedLeads.length} leads?`)) {
      setIsSubmitting(true);
      try {
        await api.post('/leads/bulk-delete', { lead_ids: selectedLeads });
        setSelectedLeads([]);
        setSelectMode(false);
        fetchData();
      } catch (error) {
        alert(error.response?.data?.detail || 'Failed to delete leads');
      } finally {
        setIsSubmitting(false);
      }
    }
  };

  return (
    <div className="flex flex-col h-full" data-testid="admin-leads">
      {/* Header */}
      <div className="p-4 bg-white border-b border-gray-200">
        <div className="flex items-center gap-2 mb-3">
          <button
            onClick={() => setShowAddModal(true)}
            className="btn-primary flex items-center gap-1 text-sm py-2"
            data-testid="add-lead-btn"
          >
            <Plus size={18} />
            Add
          </button>
          <button
            onClick={() => setShowImportModal(true)}
            className="btn-secondary flex items-center gap-1 text-sm py-2"
            data-testid="import-btn"
          >
            <Upload size={18} />
            Import
          </button>
          <button
            onClick={() => setSelectMode(!selectMode)}
            className={`flex items-center gap-1 text-sm py-2 px-3 rounded-lg transition-colors ${
              selectMode ? 'bg-green-100 text-green-700' : 'btn-secondary'
            }`}
            data-testid="select-mode-btn"
          >
            {selectMode ? <CheckSquare size={18} /> : <Square size={18} />}
            Select
          </button>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search data..."
              className="w-full pl-10 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
              data-testid="search-input"
            />
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`p-2 rounded-lg border transition-colors ${
              statusFilter || assignedFilter ? 'bg-green-50 border-green-600 text-green-600' : 'border-gray-200 text-gray-600'
            }`}
          >
            <Filter size={20} />
          </button>
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="p-2 rounded-lg border border-gray-200 text-gray-600"
          >
            <RefreshCw size={20} className={isRefreshing ? 'animate-spin' : ''} />
          </button>
        </div>

        {/* Filters */}
        {showFilters && (
          <div className="mt-3 pt-3 border-t border-gray-100 space-y-3">
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setStatusFilter('')}
                className={`px-3 py-1.5 rounded-full text-sm font-medium ${
                  !statusFilter ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-700'
                }`}
              >
                All Status
              </button>
              {statuses.map((status) => (
                <button
                  key={status}
                  onClick={() => setStatusFilter(status)}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium capitalize ${
                    statusFilter === status ? 'text-white' : 'bg-gray-100 text-gray-700'
                  }`}
                  style={{ backgroundColor: statusFilter === status ? StatusColors[status] : undefined }}
                >
                  {StatusLabels[status] || status.replace('_', ' ')}
                </button>
              ))}
            </div>
            <select
              value={assignedFilter}
              onChange={(e) => setAssignedFilter(e.target.value)}
              className="w-full input-field text-sm"
            >
              <option value="">All Assignments</option>
              <option value="unassigned">Unassigned</option>
              {telecallers.map((tc) => (
                <option key={tc.id} value={tc.id}>{tc.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Selection Actions */}
      {selectMode && selectedLeads.length > 0 && (
        <div className="p-3 bg-green-50 border-b border-green-200 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={selectAll} className="text-sm text-green-700 font-medium">
              {selectedLeads.length === leads.length ? 'Deselect All' : 'Select All'}
            </button>
            <span className="text-green-700 font-semibold">{selectedLeads.length} selected</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowAssignModal(true)}
              className="flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white rounded-lg text-sm font-medium"
            >
              <Users size={16} />
              Assign
            </button>
            <button
              onClick={handleBulkDelete}
              className="flex items-center gap-1 px-3 py-1.5 bg-red-500 text-white rounded-lg text-sm font-medium"
            >
              <Trash2 size={16} />
            </button>
            <button
              onClick={() => { setSelectedLeads([]); setSelectMode(false); }}
              className="p-1.5 text-gray-600"
            >
              <X size={20} />
            </button>
          </div>
        </div>
      )}

      {/* Data Count */}
      <div className="px-4 py-2 bg-gray-50 border-b border-gray-200">
        <p className="text-sm text-gray-600">
          <span className="font-semibold">{leads.length}</span> data
        </p>
      </div>

      {/* Data List */}
      <div className="flex-1 overflow-auto p-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 text-green-600 animate-spin" />
          </div>
        ) : leads.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-500">No data found</p>
          </div>
        ) : (
          <div className="space-y-3">
            {leads.map((lead) => (
              <div key={lead.id} className="relative">
                {selectMode && (
                  <button
                    onClick={() => toggleLeadSelection(lead.id)}
                    className="absolute left-2 top-1/2 -translate-y-1/2 z-10 p-1"
                  >
                    {selectedLeads.includes(lead.id) ? (
                      <CheckSquare size={22} className="text-green-600" />
                    ) : (
                      <Square size={22} className="text-gray-400" />
                    )}
                  </button>
                )}
                <div className={selectMode ? 'pl-10' : ''}>
                  <LeadCard
                    lead={lead}
                    onPress={() => handleLeadPress(lead)}
                    onCall={() => handleCall(lead)}
                    showAssignment={true}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add Lead Modal */}
      <Modal isOpen={showAddModal} onClose={() => setShowAddModal(false)} title="Add New Lead">
        <div className="p-4 space-y-4">
          <input
            type="text"
            value={newLead.name}
            onChange={(e) => setNewLead({ ...newLead, name: e.target.value })}
            placeholder="Name *"
            className="input-field"
            data-testid="lead-name-input"
          />
          <input
            type="tel"
            value={newLead.phone}
            onChange={(e) => setNewLead({ ...newLead, phone: e.target.value })}
            placeholder="Phone *"
            className="input-field"
            data-testid="lead-phone-input"
          />
          <input
            type="email"
            value={newLead.email}
            onChange={(e) => setNewLead({ ...newLead, email: e.target.value })}
            placeholder="Email"
            className="input-field"
          />
          <input
            type="text"
            value={newLead.city}
            onChange={(e) => setNewLead({ ...newLead, city: e.target.value })}
            placeholder="City"
            className="input-field"
          />
          <input
            type="text"
            value={newLead.source}
            onChange={(e) => setNewLead({ ...newLead, source: e.target.value })}
            placeholder="Source"
            className="input-field"
          />
          <textarea
            value={newLead.notes}
            onChange={(e) => setNewLead({ ...newLead, notes: e.target.value })}
            placeholder="Notes"
            className="input-field min-h-[80px] resize-none"
          />
          <button
            onClick={handleAddLead}
            disabled={isSubmitting}
            className="btn-primary w-full flex items-center justify-center gap-2"
            data-testid="submit-lead-btn"
          >
            {isSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Add Lead'}
          </button>
        </div>
      </Modal>

      {/* Import Modal */}
      <Modal isOpen={showImportModal} onClose={() => setShowImportModal(false)} title="Import Leads">
        <div className="p-4 space-y-4">
          <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={(e) => setImportFile(e.target.files[0])}
              className="hidden"
              id="file-upload"
              data-testid="file-upload"
            />
            <label htmlFor="file-upload" className="cursor-pointer">
              <Upload size={40} className="mx-auto text-gray-400 mb-3" />
              <p className="text-gray-600">
                {importFile ? importFile.name : 'Click to upload CSV or Excel file'}
              </p>
            </label>
          </div>
          <div className="text-sm text-gray-500">
            <p className="font-medium mb-2">Required columns:</p>
            <p>• name, phone</p>
            <p className="font-medium mt-2 mb-1">Optional columns:</p>
            <p>• email, source, city, status, notes, telecaller</p>
          </div>
          <button
            onClick={handleImport}
            disabled={isSubmitting || !importFile}
            className="btn-primary w-full flex items-center justify-center gap-2"
            data-testid="submit-import-btn"
          >
            {isSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Import'}
          </button>
        </div>
      </Modal>

      {/* Assign Modal */}
      <Modal isOpen={showAssignModal} onClose={() => setShowAssignModal(false)} title="Assign Leads">
        <div className="p-4">
          <p className="text-gray-600 mb-4">
            Assign <span className="font-semibold">{selectedLeads.length}</span> leads to:
          </p>
          <div className="space-y-2 mb-4 max-h-60 overflow-auto">
            {telecallers.map((tc) => (
              <button
                key={tc.id}
                onClick={() => handleAssign(tc.id)}
                disabled={isSubmitting}
                className="w-full p-3 text-left bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <p className="font-medium text-gray-900">{tc.name}</p>
                <p className="text-sm text-gray-500">{tc.email}</p>
              </button>
            ))}
          </div>
          <button
            onClick={handleAutoDistribute}
            disabled={isSubmitting || telecallers.length === 0}
            className="w-full btn-secondary flex items-center justify-center gap-2"
          >
            {isSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Auto Distribute Equally'}
          </button>
        </div>
      </Modal>
    </div>
  );
};

export default AdminLeads;
