import React, { useEffect, useState, useCallback } from 'react';
import { PhoneCall, Search, User, Clock, PhoneIncoming, PhoneOutgoing, PhoneMissed, Eye } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import api from '../../../services/api';
import useAuthStore from '../../../store/authStore';
import { Input } from '../../../components/ui/input';

const TeamCalls = () => {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const [calls, setCalls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ total: 0, pages: 1 });
  const [stats, setStats] = useState({ total_calls: 0, connected: 0, not_connected: 0 });

  useEffect(() => {
    if (!user?.is_tl) {
      navigate('/agent');
      return;
    }
  }, [user, navigate]);

  const fetchTeamCalls = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({
        page: page.toString(),
        limit: '20',
        team_view: 'true',
      });
      if (search) params.append('search', search);
      
      const response = await api.get(`/call-logs/team?${params}`);
      setCalls(response.data.calls || []);
      setPagination(response.data.pagination || { total: 0, pages: 1 });
      setStats(response.data.stats || { total_calls: 0, connected: 0, not_connected: 0 });
    } catch (error) {
      console.error('Failed to fetch team calls:', error);
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => {
    if (user?.is_tl) {
      fetchTeamCalls();
    }
  }, [fetchTeamCalls, user]);

  const handleSearch = (e) => {
    e.preventDefault();
    setPage(1);
    fetchTeamCalls();
  };

  const getOutcomeIcon = (outcome) => {
    if (!outcome) return <PhoneCall size={16} className="text-gray-400" />;
    const normalized = outcome.toLowerCase();
    if (normalized === 'connected' || normalized === 'answered') {
      return <PhoneIncoming size={16} className="text-green-500" />;
    }
    if (normalized.includes('no_answer') || normalized.includes('not_answer')) {
      return <PhoneMissed size={16} className="text-orange-500" />;
    }
    return <PhoneOutgoing size={16} className="text-gray-400" />;
  };

  const getOutcomeColor = (outcome) => {
    if (!outcome) return 'bg-gray-100 text-gray-700';
    const normalized = outcome.toLowerCase();
    if (normalized === 'connected' || normalized === 'answered') {
      return 'bg-green-100 text-green-700';
    }
    if (normalized.includes('no_answer') || normalized.includes('not_answer')) {
      return 'bg-orange-100 text-orange-700';
    }
    if (normalized.includes('switched_off') || normalized.includes('unreachable')) {
      return 'bg-red-100 text-red-700';
    }
    return 'bg-gray-100 text-gray-700';
  };

  const formatDuration = (seconds) => {
    if (!seconds) return '-';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins > 0) {
      return `${mins}m ${secs}s`;
    }
    return `${secs}s`;
  };

  const formatDateTime = (dateStr) => {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-IN', { 
      day: '2-digit', 
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  if (loading && calls.length === 0) {
    return (
      <div className="p-4 flex items-center justify-center min-h-[50vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600"></div>
      </div>
    );
  }

  return (
    <div className="p-4 pb-24" data-testid="team-calls-page">
      {/* Header */}
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-gray-900">Team Calls</h1>
        <p className="text-sm text-gray-500 mt-1">
          View-only access to your team's call history
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
            placeholder="Search by GP name or lead..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
            data-testid="team-calls-search"
          />
        </div>
      </form>

      {/* Stats Summary */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        <div className="bg-white rounded-xl p-3 shadow-sm border border-gray-100 text-center">
          <p className="text-xl font-bold text-gray-900">{stats.total_calls}</p>
          <p className="text-xs text-gray-500">Total Calls</p>
        </div>
        <div className="bg-white rounded-xl p-3 shadow-sm border border-gray-100 text-center">
          <p className="text-xl font-bold text-green-600">{stats.connected}</p>
          <p className="text-xs text-gray-500">Connected</p>
        </div>
        <div className="bg-white rounded-xl p-3 shadow-sm border border-gray-100 text-center">
          <p className="text-xl font-bold text-orange-600">{stats.not_connected}</p>
          <p className="text-xs text-gray-500">Not Connected</p>
        </div>
      </div>

      {/* Calls List */}
      {calls.length === 0 ? (
        <div className="bg-white rounded-xl p-8 text-center shadow-sm border border-gray-100">
          <PhoneCall size={48} className="mx-auto text-gray-300 mb-3" />
          <h3 className="text-lg font-medium text-gray-900 mb-1">No Calls Found</h3>
          <p className="text-sm text-gray-500">
            {search ? 'No calls match your search.' : 'Your team has no call records yet.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {calls.map((call, index) => (
            <div
              key={call.id || index}
              className="bg-white rounded-xl p-4 shadow-sm border border-gray-100"
              data-testid={`team-call-item-${call.id || index}`}
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-3">
                  {getOutcomeIcon(call.call_outcome)}
                  <div>
                    <h3 className="font-semibold text-gray-900">{call.lead_name || 'Unknown'}</h3>
                    <p className="text-sm text-gray-500">{call.lead_phone}</p>
                  </div>
                </div>
                <span className={`text-xs px-2 py-1 rounded-full ${getOutcomeColor(call.call_outcome)}`}>
                  {call.call_outcome?.replace(/_/g, ' ') || 'Unknown'}
                </span>
              </div>

              {/* Call Details */}
              <div className="grid grid-cols-2 gap-3 mt-3 pt-3 border-t border-gray-100">
                <div className="flex items-center gap-2">
                  <User size={14} className="text-gray-400" />
                  <span className="text-sm text-gray-600">{call.user_name || 'Unknown GP'}</span>
                </div>
                <div className="flex items-center gap-2 justify-end">
                  <Clock size={14} className="text-gray-400" />
                  <span className="text-sm text-gray-600">{formatDuration(call.duration)}</span>
                </div>
              </div>

              {/* Notes */}
              {call.notes && (
                <div className="mt-3 pt-3 border-t border-gray-100">
                  <p className="text-sm text-gray-600 italic">"{call.notes}"</p>
                </div>
              )}

              {/* Timestamp */}
              <div className="flex items-center gap-1 mt-2 text-xs text-gray-400">
                <Clock size={12} />
                <span>{formatDateTime(call.created_at || call.timestamp)}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {pagination.pages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-6">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg disabled:opacity-50"
          >
            Previous
          </button>
          <span className="text-sm text-gray-500">
            Page {page} of {pagination.pages}
          </span>
          <button
            onClick={() => setPage(p => Math.min(pagination.pages, p + 1))}
            disabled={page >= pagination.pages}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg disabled:opacity-50"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
};

export default TeamCalls;
