import React, { useEffect, useState } from 'react';
import { 
  FileText, TrendingUp, DollarSign, Building2, Users, 
  ArrowRight, RefreshCw, Loader2, Download, BarChart3,
  CheckCircle, XCircle, Clock
} from 'lucide-react';
import api from '../../services/api';
import { toast } from 'sonner';

const FilesReports = () => {
  const [reports, setReports] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState({ start: '', end: '' });

  useEffect(() => {
    fetchReports();
  }, []);

  const fetchReports = async () => {
    setLoading(true);
    try {
      const params = {};
      if (dateRange.start) params.start_date = dateRange.start;
      if (dateRange.end) params.end_date = dateRange.end;
      
      const response = await api.get('/files/reports', { params });
      setReports(response.data);
    } catch (error) {
      console.error('Error fetching reports:', error);
      toast.error('Failed to load reports');
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (amount) => {
    if (!amount) return '₹0';
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0
    }).format(amount);
  };

  const handleExport = async () => {
    try {
      const response = await api.get('/files/export');
      const blob = new Blob([JSON.stringify(response.data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `files_export_${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Export downloaded');
    } catch (error) {
      toast.error('Failed to export');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-green-600" />
      </div>
    );
  }

  const { summary, funnel, bank_stats, team_stats } = reports || {};

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <nav className="bg-white border-b border-gray-200 px-6 py-4 sticky top-0 z-50">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <BarChart3 size={24} className="text-green-600" />
            Files Reports
          </h1>
          <div className="flex gap-3">
            <button 
              onClick={fetchReports}
              className="flex items-center gap-2 px-4 py-2 border border-gray-200 rounded-lg hover:bg-gray-50"
            >
              <RefreshCw size={16} />
              Refresh
            </button>
            <button 
              onClick={handleExport}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
            >
              <Download size={16} />
              Export Data
            </button>
          </div>
        </div>
      </nav>

      <div className="px-6 py-8 space-y-8">
        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-lg bg-blue-100 flex items-center justify-center">
                <FileText size={24} className="text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Total Files</p>
                <p className="text-2xl font-bold text-gray-900">{summary?.total_files || 0}</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-lg bg-green-100 flex items-center justify-center">
                <CheckCircle size={24} className="text-green-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Disbursed</p>
                <p className="text-2xl font-bold text-green-600">{summary?.total_disbursed_count || 0}</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-lg bg-emerald-100 flex items-center justify-center">
                <DollarSign size={24} className="text-emerald-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Disbursed Amount</p>
                <p className="text-2xl font-bold text-emerald-600">{formatCurrency(summary?.total_disbursed_amount)}</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-lg bg-purple-100 flex items-center justify-center">
                <TrendingUp size={24} className="text-purple-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Total Commission</p>
                <p className="text-2xl font-bold text-purple-600">{formatCurrency(summary?.total_commission)}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Conversion Funnel */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="text-lg font-semibold text-gray-900">Conversion Funnel</h2>
          </div>
          <div className="p-6">
            <div className="flex items-center justify-between gap-2">
              {[
                { label: 'Total Files', value: funnel?.total_files, color: 'bg-gray-500' },
                { label: 'Docs Collected', value: funnel?.docs_collected, color: 'bg-purple-500' },
                { label: 'Sent to Bank', value: funnel?.sent_to_bank, color: 'bg-indigo-500' },
                { label: 'Login Done', value: funnel?.login_done, color: 'bg-teal-500' },
                { label: 'Approved', value: funnel?.approved, color: 'bg-green-500' },
                { label: 'Disbursed', value: funnel?.disbursed, color: 'bg-emerald-500' },
              ].map((stage, index, arr) => (
                <React.Fragment key={stage.label}>
                  <div className="flex-1 text-center">
                    <div className={`w-full h-16 ${stage.color} rounded-lg flex items-center justify-center`}>
                      <span className="text-white text-xl font-bold">{stage.value || 0}</span>
                    </div>
                    <p className="text-xs text-gray-500 mt-2">{stage.label}</p>
                    {funnel?.total_files > 0 && (
                      <p className="text-xs text-gray-400">
                        {((stage.value || 0) / funnel.total_files * 100).toFixed(0)}%
                      </p>
                    )}
                  </div>
                  {index < arr.length - 1 && (
                    <ArrowRight size={20} className="text-gray-300 flex-shrink-0" />
                  )}
                </React.Fragment>
              ))}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Bank-wise Stats */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <Building2 size={20} className="text-green-600" />
                Bank-wise Performance
              </h2>
            </div>
            <div className="p-6">
              {!bank_stats || bank_stats.length === 0 ? (
                <p className="text-center text-gray-500 py-8">No bank data yet</p>
              ) : (
                <div className="space-y-4">
                  {bank_stats.map((bank, idx) => (
                    <div key={idx} className="border rounded-lg p-4">
                      <div className="flex justify-between items-start mb-3">
                        <h3 className="font-semibold text-gray-900">{bank._id || 'Unknown Bank'}</h3>
                        <span className="text-sm text-green-600 font-medium">
                          {formatCurrency(bank.disbursed_amount)}
                        </span>
                      </div>
                      <div className="grid grid-cols-5 gap-2 text-center text-xs">
                        <div>
                          <p className="text-gray-500">Total</p>
                          <p className="font-semibold">{bank.total}</p>
                        </div>
                        <div>
                          <p className="text-gray-500">Eligible</p>
                          <p className="font-semibold text-blue-600">{bank.eligible}</p>
                        </div>
                        <div>
                          <p className="text-gray-500">Login</p>
                          <p className="font-semibold text-teal-600">{bank.login}</p>
                        </div>
                        <div>
                          <p className="text-gray-500">Approved</p>
                          <p className="font-semibold text-green-600">{bank.approved}</p>
                        </div>
                        <div>
                          <p className="text-gray-500">Disbursed</p>
                          <p className="font-semibold text-emerald-600">{bank.disbursed}</p>
                        </div>
                      </div>
                      {bank.commission_amount > 0 && (
                        <p className="text-xs text-purple-600 mt-2">
                          Commission: {formatCurrency(bank.commission_amount)}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Team Performance */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <Users size={20} className="text-green-600" />
                Team Performance
              </h2>
            </div>
            <div className="p-6">
              {!team_stats || team_stats.length === 0 ? (
                <p className="text-center text-gray-500 py-8">No team data yet</p>
              ) : (
                <div className="space-y-3">
                  {team_stats.map((member, idx) => (
                    <div key={idx} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                      <div>
                        <p className="font-medium text-gray-900">{member.name}</p>
                        <p className="text-xs text-gray-500">{member.total_files} files assigned</p>
                      </div>
                      <div className="flex gap-4 text-center">
                        <div>
                          <p className="text-lg font-bold text-green-600">{member.disbursed || 0}</p>
                          <p className="text-xs text-gray-500">Disbursed</p>
                        </div>
                        <div>
                          <p className="text-lg font-bold text-blue-600">{member.approved || 0}</p>
                          <p className="text-xs text-gray-500">Approved</p>
                        </div>
                        <div>
                          <p className="text-lg font-bold text-red-500">{member.rejected || 0}</p>
                          <p className="text-xs text-gray-500">Rejected</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Status Breakdown */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="text-lg font-semibold text-gray-900">Status Breakdown</h2>
          </div>
          <div className="p-6">
            <div className="grid grid-cols-3 md:grid-cols-6 gap-4">
              {Object.entries(summary?.by_status || {}).map(([status, count]) => (
                <div key={status} className="text-center p-4 bg-gray-50 rounded-lg">
                  <p className="text-2xl font-bold text-gray-900">{count}</p>
                  <p className="text-xs text-gray-500 capitalize">{status.replace('_', ' ')}</p>
                </div>
              ))}
              {Object.keys(summary?.by_status || {}).length === 0 && (
                <p className="col-span-full text-center text-gray-500 py-4">No status data</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FilesReports;
