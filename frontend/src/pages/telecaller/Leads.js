import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { Search, Filter, RefreshCw, Loader2 } from 'lucide-react';
import api from '../../services/api';
import LeadCard from '../../components/LeadCard';
import { StatusColors, StatusLabels } from '../../constants/colors';

const TelecallerLeads = () => {
  const navigate = useNavigate();
  const { startCall, activeCall } = useOutletContext();
  const [leads, setLeads] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  const statuses = ['new', 'not_interested', 'follow_up', 'presentation', 'leads', 'file'];

  const fetchLeads = async () => {
    try {
      const params = {};
      if (searchQuery) params.search = searchQuery;
      if (statusFilter) params.status = statusFilter;
      
      const response = await api.get('/leads', { params });
      setLeads(response.data);
    } catch (error) {
      console.error('Error fetching leads:', error);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchLeads();
  }, [searchQuery, statusFilter]);

  const handleRefresh = () => {
    setIsRefreshing(true);
    fetchLeads();
  };

  const handleCall = useCallback((lead) => {
    startCall(lead);
  }, [startCall]);

  const handleLeadPress = (lead) => {
    navigate(`/agent/leads/${lead.id}`);
  };

  return (
    <div className="flex flex-col h-full" data-testid="telecaller-leads">
      {/* Header */}
      <div className="p-4 bg-white border-b border-gray-200">
        <div className="flex items-center gap-3">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search data..."
              className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
              data-testid="search-input"
            />
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`p-2.5 rounded-lg border transition-colors ${
              statusFilter ? 'bg-green-50 border-green-600 text-green-600' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
            data-testid="filter-btn"
          >
            <Filter size={20} />
          </button>
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="p-2.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
            data-testid="refresh-btn"
          >
            <RefreshCw size={20} className={isRefreshing ? 'animate-spin' : ''} />
          </button>
        </div>

        {/* Filters */}
        {showFilters && (
          <div className="mt-3 pt-3 border-t border-gray-100">
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setStatusFilter('')}
                className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                  !statusFilter
                    ? 'bg-green-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                All
              </button>
              {statuses.map((status) => (
                <button
                  key={status}
                  onClick={() => setStatusFilter(status)}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium capitalize transition-colors ${
                    statusFilter === status
                      ? 'text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                  style={{
                    backgroundColor: statusFilter === status ? StatusColors[status] : undefined
                  }}
                >
                  {StatusLabels[status] || status.replace('_', ' ')}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Data Count */}
      <div className="px-4 py-2 bg-gray-50 border-b border-gray-200">
        <p className="text-sm text-gray-600">
          <span className="font-semibold">{leads.length}</span> data assigned to you
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
              <LeadCard
                key={lead.id}
                lead={lead}
                onPress={() => handleLeadPress(lead)}
                onCall={() => handleCall(lead)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default TelecallerLeads;
