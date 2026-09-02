import React, { useEffect, useState, useCallback } from 'react';
import { FileText, Search, User, Clock, Star, Eye, IndianRupee } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import api from '../../../services/api';
import useAuthStore from '../../../store/authStore';
import { Input } from '../../../components/ui/input';

const TeamFiles = () => {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ total: 0, pages: 1 });

  useEffect(() => {
    if (!user?.is_tl) {
      navigate('/agent');
      return;
    }
  }, [user, navigate]);

  const fetchTeamFiles = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({
        page: page.toString(),
        limit: '20',
        team_view: 'true',
      });
      if (search) params.append('search', search);
      
      const response = await api.get(`/files?${params}`);
      setFiles(response.data.files || []);
      setPagination(response.data.pagination || { total: 0, pages: 1 });
    } catch (error) {
      console.error('Failed to fetch team files:', error);
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => {
    if (user?.is_tl) {
      fetchTeamFiles();
    }
  }, [fetchTeamFiles, user]);

  const handleSearch = (e) => {
    e.preventDefault();
    setPage(1);
    fetchTeamFiles();
  };

  const getStatusColor = (status) => {
    const colors = {
      new: 'bg-blue-100 text-blue-700',
      contacted: 'bg-yellow-100 text-yellow-700',
      documents_pending: 'bg-orange-100 text-orange-700',
      documents_collected: 'bg-cyan-100 text-cyan-700',
      sent_to_bank: 'bg-purple-100 text-purple-700',
      login: 'bg-indigo-100 text-indigo-700',
      approved: 'bg-green-100 text-green-700',
      disbursed: 'bg-emerald-100 text-emerald-700',
      rejected: 'bg-red-100 text-red-700',
      declined: 'bg-red-100 text-red-700',
    };
    return colors[status] || 'bg-gray-100 text-gray-700';
  };

  const formatAmount = (amount) => {
    if (!amount) return '-';
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  };

  const renderStars = (rating) => {
    if (!rating) return null;
    return (
      <div className="flex items-center gap-0.5">
        {[1, 2, 3, 4, 5].map((star) => (
          <Star
            key={star}
            size={12}
            className={star <= rating ? 'text-yellow-400 fill-yellow-400' : 'text-gray-200'}
          />
        ))}
      </div>
    );
  };

  if (loading && files.length === 0) {
    return (
      <div className="p-4 flex items-center justify-center min-h-[50vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600"></div>
      </div>
    );
  }

  return (
    <div className="p-4 pb-24" data-testid="team-files-page">
      {/* Header */}
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-gray-900">Team Files</h1>
        <p className="text-sm text-gray-500 mt-1">
          View-only access to your team's loan files
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
            placeholder="Search by name or mobile..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
            data-testid="team-files-search"
          />
        </div>
      </form>

      {/* Stats Summary */}
      <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 mb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText size={18} className="text-green-600" />
            <span className="font-medium text-gray-900">Total Files</span>
          </div>
          <span className="text-xl font-bold text-green-600">{pagination.total}</span>
        </div>
      </div>

      {/* Files List */}
      {files.length === 0 ? (
        <div className="bg-white rounded-xl p-8 text-center shadow-sm border border-gray-100">
          <FileText size={48} className="mx-auto text-gray-300 mb-3" />
          <h3 className="text-lg font-medium text-gray-900 mb-1">No Files Found</h3>
          <p className="text-sm text-gray-500">
            {search ? 'No files match your search.' : 'Your team has no loan files yet.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {files.map((file) => {
            const fd = file.file_details || {};
            return (
              <div
                key={file.id}
                className="bg-white rounded-xl p-4 shadow-sm border border-gray-100"
                data-testid={`team-file-item-${file.id}`}
              >
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <h3 className="font-semibold text-gray-900">
                      {fd.full_name || file.name || 'Unknown'}
                    </h3>
                    <p className="text-sm text-gray-500">{fd.mobile || file.phone}</p>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-full ${getStatusColor(file.file_status)}`}>
                    {file.file_status?.replace(/_/g, ' ') || 'New'}
                  </span>
                </div>

                {/* Loan Details */}
                <div className="grid grid-cols-2 gap-3 mt-3 pt-3 border-t border-gray-100">
                  <div>
                    <p className="text-xs text-gray-500">Loan Type</p>
                    <p className="text-sm font-medium text-gray-900">
                      {fd.type_of_loan?.replace(/_/g, ' ') || file.requirement || '-'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Amount Required</p>
                    <p className="text-sm font-medium text-gray-900 flex items-center gap-1">
                      {formatAmount(fd.loan_amount_required)}
                    </p>
                  </div>
                </div>

                {/* Rating & GP */}
                <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100">
                  <div className="flex items-center gap-2">
                    <User size={14} className="text-gray-400" />
                    <span className="text-sm text-gray-600">{file.source_name || 'Unassigned'}</span>
                  </div>
                  {file.star_rating && renderStars(file.star_rating)}
                </div>

                {/* Last Updated */}
                <div className="flex items-center gap-1 mt-2 text-xs text-gray-400">
                  <Clock size={12} />
                  <span>Updated: {formatDate(file.updated_at)}</span>
                </div>
              </div>
            );
          })}
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

export default TeamFiles;
