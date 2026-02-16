import React, { useState, useEffect, useCallback } from 'react';
import { Clock, Phone, TrendingUp, Loader2, ChevronDown, ChevronUp, Download, RefreshCw, Calendar } from 'lucide-react';
import api from '../../services/api';

const AdminReports = () => {
  const [reports, setReports] = useState(null);
  const [period, setPeriod] = useState('today');
  const [isLoading, setIsLoading] = useState(true);
  const [expandedCards, setExpandedCards] = useState({});
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showDateRange, setShowDateRange] = useState(false);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const fetchReports = useCallback(async (showRefresh = false) => {
    try {
      if (showRefresh) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }
      
      let url = `/reports/telecallers?period=${period}`;
      if (showDateRange && fromDate && toDate) {
        url = `/reports/telecallers?from_date=${fromDate}&to_date=${toDate}`;
      }
      
      const response = await api.get(url);
      setReports(response.data);
    } catch (error) {
      console.error('Error fetching reports:', error);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [period, showDateRange, fromDate, toDate]);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  const handleRefresh = () => {
    fetchReports(true);
  };

  const handlePeriodChange = (newPeriod) => {
    setShowDateRange(false);
    setPeriod(newPeriod);
  };

  const handleDateRangeToggle = () => {
    setShowDateRange(!showDateRange);
    if (!showDateRange) {
      const today = new Date().toISOString().split('T')[0];
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      setFromDate(weekAgo);
      setToDate(today);
    }
  };

  const formatTime = (seconds) => {
    if (!seconds) return '0m';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    if (hrs > 0) return `${hrs}h ${mins}m`;
    return `${mins}m`;
  };

  const formatTimeForExcel = (seconds) => {
    if (!seconds) return '0:00';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hrs > 0) {
      return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const toggleCard = (userId) => {
    setExpandedCards(prev => ({
      ...prev,
      [userId]: !prev[userId]
    }));
  };

  const downloadExcel = () => {
    if (!reports || !reports.telecallers) return;

    let periodLabel = periods.find(p => p.id === period)?.label || period;
    if (showDateRange && fromDate && toDate) {
      periodLabel = `${fromDate} to ${toDate}`;
    }
    
    // Create CSV content
    const headers = ['Name', 'Email', 'Status', 'Leads Assigned', 'Calls', 'Leads Generated', 'Interested', 'Talk Time', 'Idle Time', 'Conversion Rate'];
    const rows = reports.telecallers.map(tc => [
      tc.user_name || '',
      tc.user_email || '',
      tc.is_active ? 'Active' : 'Inactive',
      tc.total_leads || 0,
      tc.total_calls || 0,
      tc.leads_generated || 0,
      tc.interested || 0,
      formatTimeForExcel(tc.total_call_seconds),
      formatTimeForExcel(tc.total_idle_seconds),
      `${(tc.calls_to_lead_rate || 0).toFixed(1)}%`
    ]);

    // Build CSV string
    let csvContent = `Telecaller Performance Report - ${periodLabel}\n\n`;
    csvContent += headers.join(',') + '\n';
    rows.forEach(row => {
      csvContent += row.map(cell => `"${cell}"`).join(',') + '\n';
    });
    
    // Add summary
    csvContent += '\n';
    csvContent += 'OVERALL SUMMARY\n';
    csvContent += `Total Calls,${reports.overall?.total_calls || 0}\n`;
    csvContent += `Leads Generated,${reports.overall?.total_leads_generated || 0}\n`;
    csvContent += `Total Talk Time,${formatTimeForExcel(reports.overall?.total_call_seconds)}\n`;
    csvContent += `Total Idle Time,${formatTimeForExcel(reports.overall?.total_idle_seconds)}\n`;
    csvContent += `Overall Conversion Rate,${(reports.overall?.calls_to_lead_rate || 0).toFixed(1)}%\n`;

    // Download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `telecaller_report_${period}_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const periods = [
    { id: 'today', label: 'Today' },
    { id: 'week', label: 'This Week' },
    { id: 'month', label: 'This Month' },
    { id: 'three_months', label: 'Last 3 Months' },
    { id: 'lifetime', label: 'Lifetime' },
  ];

  return (
    <div className="p-4" data-testid="admin-reports">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold text-gray-900">Reports</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRefresh}
            disabled={isRefreshing || isLoading}
            className="p-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            data-testid="refresh-report-btn"
          >
            <RefreshCw size={20} className={isRefreshing ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={downloadExcel}
            disabled={!reports || isLoading}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            data-testid="download-report-btn"
          >
            <Download size={18} />
            Export
          </button>
        </div>
      </div>

      {/* Period Filter */}
      <div className="flex flex-wrap gap-2 mb-6">
        {periods.map((p) => (
          <button
            key={p.id}
            onClick={() => setPeriod(p.id)}
            className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
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
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
              <div className="text-center">
                <p className="text-xl font-bold text-green-600">{reports.overall.total_calls}</p>
                <p className="text-xs text-gray-500">Total Calls</p>
              </div>
              <div className="text-center">
                <p className="text-xl font-bold text-blue-600">{reports.overall.total_leads_generated}</p>
                <p className="text-xs text-gray-500">Leads Generated</p>
              </div>
              <div className="text-center">
                <p className="text-xl font-bold text-purple-600">
                  {formatTime(reports.overall.total_call_seconds)}
                </p>
                <p className="text-xs text-gray-500">Talk Time</p>
              </div>
              <div className="text-center">
                <p className="text-xl font-bold text-orange-600">
                  {formatTime(reports.overall.total_idle_seconds)}
                </p>
                <p className="text-xs text-gray-500">Idle Time</p>
              </div>
              <div className="text-center">
                <p className="text-xl font-bold text-teal-600">
                  {(reports.overall.calls_to_lead_rate || 0).toFixed(1)}%
                </p>
                <p className="text-xs text-gray-500">Conversion</p>
              </div>
            </div>
          </div>

          {/* Telecaller Performance */}
          <div className="card p-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Telecaller Performance</h3>
            <div className="space-y-2">
              {reports.telecallers.map((tc) => (
                <div
                  key={tc.user_id}
                  className={`bg-gray-50 rounded-lg overflow-hidden ${!tc.is_active ? 'opacity-60' : ''}`}
                  data-testid={`report-card-${tc.user_id}`}
                >
                  {/* Header - Always visible */}
                  <button
                    onClick={() => toggleCard(tc.user_id)}
                    className="w-full p-4 flex items-center justify-between hover:bg-gray-100 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                        tc.is_active ? 'bg-green-600' : 'bg-gray-400'
                      }`}>
                        <span className="text-white font-bold">
                          {tc.user_name?.charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <div className="text-left">
                        <p className="font-semibold text-gray-900">{tc.user_name}</p>
                        <p className="text-xs text-gray-500">{tc.total_leads} data • {tc.total_calls} calls</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {!tc.is_active && (
                        <span className="px-2 py-1 bg-gray-200 text-gray-600 rounded text-xs">
                          Inactive
                        </span>
                      )}
                      {expandedCards[tc.user_id] ? (
                        <ChevronUp size={20} className="text-gray-500" />
                      ) : (
                        <ChevronDown size={20} className="text-gray-500" />
                      )}
                    </div>
                  </button>

                  {/* Expanded Content */}
                  {expandedCards[tc.user_id] && (
                    <div className="px-4 pb-4 pt-0">
                      {/* Call Stats Row */}
                      <div className="grid grid-cols-4 gap-2 mb-3">
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

                      {/* Status Breakdown */}
                      <div className="mb-3">
                        <p className="text-xs font-semibold text-gray-500 mb-2">STATUS BREAKDOWN</p>
                        <div className="grid grid-cols-3 gap-2">
                          {[
                            { key: 'new', label: 'New', color: '#4CAF50' },
                            { key: 'contacted', label: 'Contacted', color: '#2196F3' },
                            { key: 'interested', label: 'Interested', color: '#FF9800' },
                            { key: 'not_interested', label: 'Not Interested', color: '#9E9E9E' },
                            { key: 'follow_up', label: 'Follow Up', color: '#9C27B0' },
                            { key: 'leads', label: 'Leads', color: '#00C853' },
                            { key: 'not_answering', label: 'Not Answering', color: '#FF5722' },
                            { key: 'wrong_number', label: 'Wrong Number', color: '#F44336' },
                            { key: 'presentation', label: 'Presentation', color: '#673AB7' },
                          ].map((status) => (
                            <div 
                              key={status.key}
                              className="flex items-center justify-between p-2 rounded"
                              style={{ backgroundColor: `${status.color}15` }}
                            >
                              <span className="text-xs text-gray-600">{status.label}</span>
                              <span className="font-bold text-sm" style={{ color: status.color }}>
                                {tc.status_counts?.[status.key] || 0}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Call Outcomes */}
                      <div className="mb-3">
                        <p className="text-xs font-semibold text-gray-500 mb-2">CALL OUTCOMES</p>
                        <div className="grid grid-cols-3 gap-2">
                          {[
                            { key: 'calls_connected', label: 'Connected', color: '#4CAF50' },
                            { key: 'calls_no_answer', label: 'No Answer', color: '#FF9800' },
                            { key: 'calls_wrong_number', label: 'Wrong Number', color: '#F44336' },
                            { key: 'calls_busy', label: 'Busy', color: '#9E9E9E' },
                            { key: 'calls_voicemail', label: 'Voicemail', color: '#2196F3' },
                          ].map((outcome) => (
                            <div 
                              key={outcome.key}
                              className="flex items-center justify-between p-2 rounded"
                              style={{ backgroundColor: `${outcome.color}15` }}
                            >
                              <span className="text-xs text-gray-600">{outcome.label}</span>
                              <span className="font-bold text-sm" style={{ color: outcome.color }}>
                                {tc[outcome.key] || 0}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Follow-ups & Rate */}
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-gray-500">Follow-ups Pending</span>
                          <span className="font-semibold text-gray-900">{tc.follow_ups_pending}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-500">Follow-ups Completed</span>
                          <span className="font-semibold text-gray-900">{tc.follow_ups_completed}</span>
                        </div>
                        <div className="flex justify-between pt-2 border-t border-gray-200">
                          <span className="text-gray-500">Call to Lead Rate</span>
                          <span className="font-semibold text-green-600">
                            {(tc.calls_to_lead_rate || 0).toFixed(1)}%
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
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
