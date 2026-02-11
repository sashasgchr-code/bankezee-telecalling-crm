import React, { useState, useEffect } from 'react';
import { Clock, Phone, TrendingUp, Loader2 } from 'lucide-react';
import api from '../../services/api';

const AdminReports = () => {
  const [reports, setReports] = useState(null);
  const [period, setPeriod] = useState('today');
  const [isLoading, setIsLoading] = useState(true);

  const fetchReports = async () => {
    try {
      setIsLoading(true);
      const response = await api.get(`/reports/telecallers?period=${period}`);
      setReports(response.data);
    } catch (error) {
      console.error('Error fetching reports:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchReports();
  }, [period]);

  const formatTime = (seconds) => {
    if (!seconds) return '0m';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    if (hrs > 0) return `${hrs}h ${mins}m`;
    return `${mins}m`;
  };

  const periods = [
    { id: 'today', label: 'Today' },
    { id: 'week', label: 'This Week' },
    { id: 'month', label: 'This Month' },
  ];

  return (
    <div className="p-4" data-testid="admin-reports">
      <h2 className="text-2xl font-bold text-gray-900 mb-4">Reports</h2>

      {/* Period Filter */}
      <div className="flex gap-2 mb-6">
        {periods.map((p) => (
          <button
            key={p.id}
            onClick={() => setPeriod(p.id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              period === p.id
                ? 'bg-green-600 text-white'
                : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 text-green-600 animate-spin" />
        </div>
      ) : reports ? (
        <>
          {/* Overall Stats */}
          <div className="card p-4 mb-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Overall Performance</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="text-center">
                <p className="text-2xl font-bold text-green-600">{reports.overall.total_calls}</p>
                <p className="text-sm text-gray-500">Total Calls</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-blue-600">{reports.overall.total_leads_generated}</p>
                <p className="text-sm text-gray-500">Leads Generated</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-purple-600">
                  {formatTime(reports.overall.total_call_seconds)}
                </p>
                <p className="text-sm text-gray-500">Talk Time</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-orange-600">
                  {reports.overall.calls_to_lead_rate.toFixed(1)}%
                </p>
                <p className="text-sm text-gray-500">Conversion Rate</p>
              </div>
            </div>
          </div>

          {/* Telecaller Performance */}
          <div className="card p-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Telecaller Performance</h3>
            <div className="space-y-4">
              {reports.telecallers.map((tc) => (
                <div
                  key={tc.user_id}
                  className={`p-4 bg-gray-50 rounded-lg ${!tc.is_active ? 'opacity-60' : ''}`}
                  data-testid={`report-card-${tc.user_id}`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                        tc.is_active ? 'bg-green-600' : 'bg-gray-400'
                      }`}>
                        <span className="text-white font-bold">
                          {tc.user_name?.charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <div>
                        <p className="font-semibold text-gray-900">{tc.user_name}</p>
                        <p className="text-xs text-gray-500">{tc.total_leads} leads assigned</p>
                      </div>
                    </div>
                    {!tc.is_active && (
                      <span className="px-2 py-1 bg-gray-200 text-gray-600 rounded text-xs">
                        Inactive
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-4 gap-2">
                    <div className="text-center p-2 bg-white rounded">
                      <div className="flex items-center justify-center gap-1 text-green-600">
                        <Phone size={14} />
                        <span className="font-bold">{tc.total_calls}</span>
                      </div>
                      <p className="text-xs text-gray-500">Calls</p>
                    </div>
                    <div className="text-center p-2 bg-white rounded">
                      <div className="flex items-center justify-center gap-1 text-blue-600">
                        <TrendingUp size={14} />
                        <span className="font-bold">{tc.leads_generated}</span>
                      </div>
                      <p className="text-xs text-gray-500">Leads</p>
                    </div>
                    <div className="text-center p-2 bg-white rounded">
                      <div className="flex items-center justify-center gap-1 text-purple-600">
                        <Clock size={14} />
                        <span className="font-bold">{formatTime(tc.total_call_seconds)}</span>
                      </div>
                      <p className="text-xs text-gray-500">Talk</p>
                    </div>
                    <div className="text-center p-2 bg-white rounded">
                      <div className="flex items-center justify-center gap-1 text-orange-600">
                        <Clock size={14} />
                        <span className="font-bold">{formatTime(tc.total_idle_seconds)}</span>
                      </div>
                      <p className="text-xs text-gray-500">Idle</p>
                    </div>
                  </div>

                  <div className="mt-3 pt-3 border-t border-gray-200">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Call to Lead Rate</span>
                      <span className="font-semibold text-gray-900">
                        {tc.calls_to_lead_rate.toFixed(1)}%
                      </span>
                    </div>
                  </div>
                </div>
              ))}

              {reports.telecallers.length === 0 && (
                <p className="text-center text-gray-500 py-4">No telecaller data available</p>
              )}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
};

export default AdminReports;
