import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  FileText, Search, Filter, ChevronLeft, ChevronRight, 
  CheckCircle, Clock, XCircle, TrendingUp, Users, Loader2,
  Download, RefreshCw
} from 'lucide-react';
import api from '../../services/api';
import { toast } from 'sonner';
import { FILE_STATUS_OPTIONS } from '../../components/file-detail/FileStatusCard';

const FILE_STATUS_COLORS = {
  new: { bg: 'bg-blue-100', text: 'text-blue-700' },
  contacted: { bg: 'bg-cyan-100', text: 'text-cyan-700' },
  documents_collected: { bg: 'bg-purple-100', text: 'text-purple-700' },
  not_eligible: { bg: 'bg-red-100', text: 'text-red-700' },
  sent_to_bank: { bg: 'bg-indigo-100', text: 'text-indigo-700' },
  login: { bg: 'bg-teal-100', text: 'text-teal-700' },
  not_login: { bg: 'bg-orange-100', text: 'text-orange-700' },
  approved: { bg: 'bg-green-100', text: 'text-green-700' },
  declined: { bg: 'bg-red-100', text: 'text-red-700' },
  disbursed: { bg: 'bg-emerald-100', text: 'text-emerald-700' },
  not_disbursed: { bg: 'bg-rose-100', text: 'text-rose-700' },
  rejected: { bg: 'bg-gray-100', text: 'text-gray-700' }
};

const FilesDashboard = () => {
  const navigate = useNavigate();
  const [files, setFiles] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [opsTeam, setOpsTeam] = useState([]);
  const [assigneeFilter, setAssigneeFilter] = useState('');
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [bulkAssignTo, setBulkAssignTo] = useState('');

  const user = JSON.parse(localStorage.getItem('user') || '{}');
  const isAdmin = user.role === 'admin';

  useEffect(() => {
    fetchFiles();
    fetchStats();
    fetchOpsTeam();
  }, [page, statusFilter, assigneeFilter]);

  const fetchFiles = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.append('page', page);
      params.append('limit', 20);
      if (statusFilter) params.append('file_status', statusFilter);
      if (assigneeFilter) params.append('assigned_to', assigneeFilter);

      const response = await api.get(`/files?${params.toString()}`);
      setFiles(response.data.files || []);
      setTotalPages(response.data.pagination?.pages || 1);
    } catch (error) {
      console.error('Failed to fetch files:', error);
      toast.error('Failed to load files');
    } finally {
      setLoading(false);
    }
  };

  const fetchStats = async () => {
    try {
      const response = await api.get('/files/dashboard/stats');
      setStats(response.data);
    } catch (error) {
      console.error('Failed to fetch stats:', error);
    }
  };

  const fetchOpsTeam = async () => {
    try {
      const response = await api.get('/files/operations-team');
      setOpsTeam(response.data || []);
    } catch (error) {
      console.error('Failed to fetch ops team:', error);
    }
  };

  const handleBulkAssign = async () => {
    if (!bulkAssignTo || selectedFiles.length === 0) {
      toast.error('Select files and assignee');
      return;
    }
    try {
      await api.put('/files/bulk-assign', {
        file_ids: selectedFiles,
        assigned_to: bulkAssignTo
      });
      toast.success(`${selectedFiles.length} files assigned`);
      setSelectedFiles([]);
      setBulkAssignTo('');
      fetchFiles();
    } catch (error) {
      toast.error('Failed to assign files');
    }
  };

  const toggleFileSelection = (fileId) => {
    setSelectedFiles(prev => 
      prev.includes(fileId) 
        ? prev.filter(id => id !== fileId)
        : [...prev, fileId]
    );
  };

  const toggleSelectAll = () => {
    if (selectedFiles.length === files.length) {
      setSelectedFiles([]);
    } else {
      setSelectedFiles(files.map(f => f.id));
    }
  };

  const filteredFiles = files.filter(file => {
    if (!searchTerm) return true;
    const search = searchTerm.toLowerCase();
    return (
      (file.name || '').toLowerCase().includes(search) ||
      (file.phone || '').includes(search) ||
      (file.email || '').toLowerCase().includes(search)
    );
  });

  const getStatusLabel = (status) => {
    const opt = FILE_STATUS_OPTIONS.find(o => o.value === status);
    return opt?.label || status || 'New';
  };

  const getStatusColor = (status) => {
    return FILE_STATUS_COLORS[status] || FILE_STATUS_COLORS.new;
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <nav className="bg-white border-b border-gray-200 px-6 py-4 sticky top-0 z-50">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <FileText size={24} className="text-green-600" />
            Files Dashboard
          </h1>
          <button 
            onClick={() => { fetchFiles(); fetchStats(); }} 
            className="flex items-center gap-2 px-4 py-2 border border-gray-200 rounded-lg hover:bg-gray-50"
          >
            <RefreshCw size={16} />
            Refresh
          </button>
        </div>
      </nav>

      <div className="px-6 py-8">
        {/* Stats Cards */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 mb-8">
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
              <p className="text-sm text-gray-500">Total Files</p>
              <p className="text-2xl font-bold text-gray-900">{stats.total_files || 0}</p>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
              <p className="text-sm text-gray-500">New</p>
              <p className="text-2xl font-bold text-blue-600">{stats.new || 0}</p>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
              <p className="text-sm text-gray-500">Docs Collected</p>
              <p className="text-2xl font-bold text-purple-600">{stats.documents_collected || 0}</p>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
              <p className="text-sm text-gray-500">Sent to Bank</p>
              <p className="text-2xl font-bold text-indigo-600">{stats.sent_to_bank || 0}</p>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
              <p className="text-sm text-gray-500">Approved</p>
              <p className="text-2xl font-bold text-green-600">{stats.approved || 0}</p>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
              <p className="text-sm text-gray-500">Disbursed</p>
              <p className="text-2xl font-bold text-emerald-600">{stats.disbursed || 0}</p>
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-6">
          <div className="flex flex-wrap gap-4 items-center">
            <div className="flex-1 min-w-[200px]">
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search by name, phone, email..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full h-10 pl-10 pr-4 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>
            </div>
            <select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
              className="h-10 px-4 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            >
              <option value="">All Statuses</option>
              {FILE_STATUS_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            {isAdmin && (
              <select
                value={assigneeFilter}
                onChange={(e) => { setAssigneeFilter(e.target.value); setPage(1); }}
                className="h-10 px-4 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              >
                <option value="">All Team Members</option>
                {opsTeam.map(member => (
                  <option key={member.id} value={member.id}>{member.full_name || member.name}</option>
                ))}
              </select>
            )}
          </div>
        </div>

        {/* Bulk Actions */}
        {isAdmin && selectedFiles.length > 0 && (
          <div className="bg-green-50 border border-green-200 rounded-xl p-4 mb-6 flex items-center gap-4">
            <span className="text-sm font-medium text-green-700">{selectedFiles.length} files selected</span>
            <select
              value={bulkAssignTo}
              onChange={(e) => setBulkAssignTo(e.target.value)}
              className="h-9 px-3 border border-green-300 rounded-lg text-sm bg-white"
            >
              <option value="">Assign to...</option>
              {opsTeam.map(member => (
                <option key={member.id} value={member.id}>{member.full_name || member.name}</option>
              ))}
            </select>
            <button
              onClick={handleBulkAssign}
              disabled={!bulkAssignTo}
              className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50"
            >
              Assign Selected
            </button>
            <button
              onClick={() => setSelectedFiles([])}
              className="px-4 py-2 border border-green-300 rounded-lg text-sm text-green-700 hover:bg-green-100"
            >
              Clear Selection
            </button>
          </div>
        )}

        {/* Files Table */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={32} className="animate-spin text-green-600" />
            </div>
          ) : filteredFiles.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <FileText size={48} className="mx-auto mb-4 text-gray-300" />
              <p>No files found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    {isAdmin && (
                      <th className="w-10 px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selectedFiles.length === files.length && files.length > 0}
                          onChange={toggleSelectAll}
                          className="rounded border-gray-300"
                        />
                      </th>
                    )}
                    <th className="text-left px-4 py-3 font-semibold text-gray-700">Customer</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-700">Contact</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-700">Loan Type</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-700">Status</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-700">Assigned To</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-700">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredFiles.map((file) => {
                    const statusColor = getStatusColor(file.file_status);
                    const assignee = opsTeam.find(o => o.id === file.file_assigned_to);
                    
                    return (
                      <tr
                        key={file.id}
                        className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer transition-colors"
                        onClick={() => navigate(`/files/${file.id}`)}
                        data-testid={`file-row-${file.id}`}
                      >
                        {isAdmin && (
                          <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={selectedFiles.includes(file.id)}
                              onChange={() => toggleFileSelection(file.id)}
                              className="rounded border-gray-300"
                            />
                          </td>
                        )}
                        <td className="px-4 py-3">
                          <p className="font-medium text-gray-900">{file.name || 'Unnamed'}</p>
                          <p className="text-xs text-gray-500">{file.city || '-'}</p>
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-gray-900">{file.phone}</p>
                          <p className="text-xs text-gray-500">{file.email || '-'}</p>
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-gray-900">{file.requirement || file.file_details?.type_of_loan || '-'}</p>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-block px-2 py-1 rounded-full text-xs font-medium ${statusColor.bg} ${statusColor.text}`}>
                            {getStatusLabel(file.file_status)}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-gray-900">{assignee?.full_name || assignee?.name || '-'}</p>
                        </td>
                        <td className="px-4 py-3 text-gray-500">
                          {file.updated_at ? new Date(file.updated_at).toLocaleDateString() : '-'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between">
              <p className="text-sm text-gray-500">
                Page {page} of {totalPages}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="p-2 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50"
                >
                  <ChevronLeft size={16} />
                </button>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="p-2 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default FilesDashboard;
