import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useOutletContext, useSearchParams } from 'react-router-dom';
import { Search, Filter, RefreshCw, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import api from '../../services/api';
import LeadCard from '../../components/LeadCard';
import { StatusColors, StatusLabels } from '../../constants/colors';

const TelecallerLeads = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { startCall, activeCall } = useOutletContext();
  const [leads, setLeads] = useState([]);
  const [statusCounts, setStatusCounts] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showFilters, setShowFilters] = useState(true); // Default open
  
  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [pageSize] = useState(50);
  
  // Read filters from URL params (persist on navigation)
  const searchQuery = searchParams.get('search') || '';
  const statusFilter = searchParams.get('status') || '';
  const outcomeFilter = searchParams.get('outcome') || '';

  // Status options (including 'new' for fresh data)
  const statuses = ['new', 'not_interested', 'follow_up', 'leads', 'file'];

  // Call outcome filters
  const callOutcomes = [
    { id: 'connected', label: 'Connected', color: '#4CAF50' },
    { id: 'no_answer', label: 'No Answer', color: '#F44336' },
    { id: 'switched_off', label: 'Switched Off', color: '#9E9E9E' },
    { id: 'not_connecting', label: 'Not Connecting', color: '#9E9E9E' },
    { id: 'busy', label: 'Busy', color: '#FF9800' },
    { id: 'wrong_number', label: 'Wrong Number', color: '#E91E63' },
    { id: 'voicemail', label: 'Voicemail', color: '#9C27B0' },
  ];

  // Update URL params when filters change
  const updateFilters = (key, value) => {
    const newParams = new URLSearchParams(searchParams);
    if (value) {
      newParams.set(key, value);
    } else {
      newParams.delete(key);
    }
    setSearchParams(newParams);
  };

  // Calculate status counts
  const calculateStatusCounts = (leadsData) => {
    const counts = {};
    leadsData.forEach(lead => {
      const status = lead.status || 'new';
      counts[status] = (counts[status] || 0) + 1;
    });
    setStatusCounts(counts);
  };

  const fetchLeads = async (page = currentPage) => {
    try {
      // Build params for the request
      const params = {
        page: page,
        page_size: pageSize,
      };
      if (searchQuery) params.search = searchQuery;
      if (statusFilter) params.status = statusFilter;
      if (outcomeFilter) params.last_call_outcome = outcomeFilter;
      
      const response = await api.get('/leads', { params });
      
      // Handle paginated response
      const leadsData = response.data;
      setLeads(leadsData.leads || []);
      setTotalCount(leadsData.pagination?.total_count || 0);
      setTotalPages(leadsData.pagination?.total_pages || 1);
      setCurrentPage(leadsData.pagination?.page || 1);
      
      // Calculate status counts from current data
      calculateStatusCounts(leadsData.leads || []);
    } catch (error) {
      console.error('Error fetching leads:', error);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    setCurrentPage(1); // Reset to page 1 when filters change
    fetchLeads(1);
  }, [searchQuery, statusFilter, outcomeFilter]);

  const handlePageChange = (newPage) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setIsLoading(true);
      setCurrentPage(newPage);
      fetchLeads(newPage);
    }
  };

  const handleRefresh = () => {
    setIsRefreshing(true);
    fetchLeads();
  };

  const handleCall = useCallback((lead) => {
    startCall(lead);
  }, [startCall]);

  const handleLeadPress = (lead) => {
    // Navigate but keep filters in URL
    navigate(`/agent/leads/${lead.id}?${searchParams.toString()}`);
  };

  const getStatusCount = (status) => {
    return statusCounts[status] || 0;
  };

  const newCount = statusCounts['new'] || 0;

  return (
    <div className="flex flex-col h-full" data-testid="telecaller-leads">
      {/* New Data Banner */}
      {newCount > 0 && statusFilter !== 'new' && (
        <div 
          onClick={() => updateFilters('status', 'new')}
          className="bg-blue-50 border-b border-blue-200 px-4 py-3 flex justify-between items-center cursor-pointer hover:bg-blue-100 transition-colors"
        >
          <span className="text-blue-700 font-medium">
            🆕 {newCount} new data available
          </span>
          <span className="text-blue-500 text-sm">Tap to view →</span>
        </div>
      )}

      {/* Header */}
      <div className="p-4 bg-white border-b border-gray-200">
        <div className="flex items-center gap-3">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => updateFilters('search', e.target.value)}
              placeholder="Search by name, phone..."
              className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
              data-testid="search-input"
            />
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`p-2.5 rounded-lg border transition-colors ${
              (statusFilter || outcomeFilter) ? 'bg-green-50 border-green-600 text-green-600' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
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
          <div className="mt-3 pt-3 border-t border-gray-100 space-y-3">
            {/* Status Filter */}
            <div>
              <p className="text-xs font-medium text-gray-500 mb-2">Status</p>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => updateFilters('status', '')}
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
                    onClick={() => updateFilters('status', status)}
                    className={`px-3 py-1.5 rounded-full text-sm font-medium capitalize transition-colors ${
                      statusFilter === status
                        ? 'text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                    style={{
                      backgroundColor: statusFilter === status ? (StatusColors[status] || '#3b82f6') : undefined
                    }}
                  >
                    {StatusLabels[status] || status.replace('_', ' ')}
                    <span className="ml-1 opacity-75">({getStatusCount(status)})</span>
                  </button>
                ))}
              </div>
            </div>
            
            {/* Call Outcome Filter */}
            <div>
              <p className="text-xs font-medium text-gray-500 mb-2">Call Outcome</p>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => updateFilters('outcome', '')}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                    !outcomeFilter
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  All
                </button>
                {callOutcomes.map((outcome) => (
                  <button
                    key={outcome.id}
                    onClick={() => updateFilters('outcome', outcome.id)}
                    className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                      outcomeFilter === outcome.id
                        ? 'text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                    style={{
                      backgroundColor: outcomeFilter === outcome.id ? outcome.color : undefined
                    }}
                  >
                    {outcome.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Data Count & Pagination */}
      <div className="px-4 py-2 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
        <p className="text-sm text-gray-600">
          <span className="font-semibold">{totalCount}</span> data 
          {(statusFilter || outcomeFilter) ? ' (filtered)' : ' assigned to you'}
          {totalPages > 1 && (
            <span className="ml-2 text-gray-500">
              (Page {currentPage} of {totalPages})
            </span>
          )}
        </p>
        
        {/* Pagination Controls */}
        {totalPages > 1 && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => handlePageChange(currentPage - 1)}
              disabled={currentPage <= 1 || isLoading}
              className="p-1.5 rounded-lg border border-gray-200 text-gray-600 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-100"
              data-testid="prev-page-btn"
            >
              <ChevronLeft size={18} />
            </button>
            <span className="text-sm text-gray-700 min-w-[60px] text-center">
              {currentPage} / {totalPages}
            </span>
            <button
              onClick={() => handlePageChange(currentPage + 1)}
              disabled={currentPage >= totalPages || isLoading}
              className="p-1.5 rounded-lg border border-gray-200 text-gray-600 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-100"
              data-testid="next-page-btn"
            >
              <ChevronRight size={18} />
            </button>
          </div>
        )}
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
            {(statusFilter || outcomeFilter || searchQuery) && (
              <button 
                onClick={() => setSearchParams(new URLSearchParams())}
                className="mt-2 text-green-600 hover:underline"
              >
                Clear all filters
              </button>
            )}
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
