import React, { useEffect, useState, useCallback } from 'react';
import { Database, Search, Phone, Clock, User, ChevronRight, Eye } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import api from '../../../services/api';
import useAuthStore from '../../../store/authStore';
import { Input } from '../../../components/ui/input';

const TeamData = () => {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ total_count: 0, total_pages: 1 });

  useEffect(() => {
    if (!user?.is_tl) {
      navigate('/agent');
      return;
    }
  }, [user, navigate]);

  const fetchTeamData = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({
        page: page.toString(),
        page_size: '20',
        team_view: 'true',
      });
      if (search) params.append('search', search);
      
      const response = await api.get(`/leads?${params}`);
      setLeads(response.data.leads || []);
      setPagination(response.data.pagination || { total_count: 0, total_pages: 1 });
    } catch (error) {
      console.error('Failed to fetch team data:', error);
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => {
    if (user?.is_tl) {
      fetchTeamData();
    }
  }, [fetchTeamData, user]);

  const handleSearch = (e) => {
    e.preventDefault();
    setPage(1);
    fetchTeamData();
  };

  const getStatusColor = (status) => {
    const colors = {
      new: 'bg-blue-100 text-blue-700',
      contacted: 'bg-yellow-100 text-yellow-700',
      interested: 'bg-green-100 text-green-700',
      not_interested: 'bg-red-100 text-red-700',
      follow_up: 'bg-purple-100 text-purple-700',
      file: 'bg-emerald-100 text-emerald-700',
    };
    return colors[status] || 'bg-gray-100 text-gray-700';
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  };

  if (loading && leads.length === 0) {
    return (
      <div className="p-4 flex items-center justify-center min-h-[50vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600"></div>
      </div>
    );
  }

  return (
    <div className="p-4 pb-24" data-testid="team-data-page">
      {/* Header */}
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-gray-900">Team Data</h1>
        <p className="text-sm text-gray-500 mt-1">
          View-only access to your team's leads
        </p>
      </div>

      {/* Read-only Badge */}
      <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4 flex items-center gap-2">
        <Eye size={16} className="text-amber-600" />
        <span className="text-sm text-amber-700 font-medium">View Only Mode</span>
      </div>

      {/* Search */}
      <form onSubmit={handleSearch} className="mb-4">
        <div className="relative">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <Input
            type="text"
            placeholder="Search by name or phone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
            data-testid="team-data-search"
          />
        </div>
      </form>

      {/* Stats Summary */}
      <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 mb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Database size={18} className="text-green-600" />
            <span className="font-medium text-gray-900">Total Records</span>
          </div>
          <span className="text-xl font-bold text-green-600">{pagination.total_count}</span>
        </div>
      </div>

      {/* Data List */}
      {leads.length === 0 ? (
        <div className="bg-white rounded-xl p-8 text-center shadow-sm border border-gray-100">
          <Database size={48} className="mx-auto text-gray-300 mb-3" />
          <h3 className="text-lg font-medium text-gray-900 mb-1">No Data Found</h3>
          <p className="text-sm text-gray-500">
            {search ? 'No records match your search.' : 'Your team has no data records yet.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {leads.map((lead) => (
            <div
              key={lead.id || lead._id}
              className="bg-white rounded-xl p-4 shadow-sm border border-gray-100"
              data-testid={`team-data-item-${lead.id}`}
            >
              <div className="flex items-start justify-between mb-2">
                <div>
                  <h3 className="font-semibold text-gray-900">{lead.name}</h3>
                  <div className="flex items-center gap-2 text-sm text-gray-500 mt-1">
                    <Phone size={14} />
                    <span>{lead.phone}</span>
                  </div>
                </div>
                <span className={`text-xs px-2 py-1 rounded-full ${getStatusColor(lead.status)}`}>
                  {lead.status?.replace(/_/g, ' ') || 'New'}
                </span>
              </div>

              {/* Assigned GP */}
              <div className="flex items-center gap-2 text-sm text-gray-500 mt-3 pt-3 border-t border-gray-100">
                <User size={14} />
                <span className="font-medium">{lead.telecaller_name || 'Unassigned'}</span>
              </div>

              {/* Last Activity */}
              <div className="flex items-center justify-between mt-2 text-xs text-gray-400">
                <div className="flex items-center gap-1">
                  <Clock size={12} />
                  <span>Last updated: {formatDate(lead.updated_at)}</span>
                </div>
                {lead.last_call_outcome && (
                  <span className="px-2 py-0.5 bg-gray-100 rounded text-gray-600">
                    {lead.last_call_outcome.replace(/_/g, ' ')}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {pagination.total_pages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-6">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg disabled:opacity-50"
          >
            Previous
          </button>
          <span className="text-sm text-gray-500">
            Page {page} of {pagination.total_pages}
          </span>
          <button
            onClick={() => setPage(p => Math.min(pagination.total_pages, p + 1))}
            disabled={page >= pagination.total_pages}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg disabled:opacity-50"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
};

export default TeamData;
