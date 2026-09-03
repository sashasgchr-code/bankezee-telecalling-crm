import React, { useState, useEffect } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Phone, Clock, TrendingUp, Target, Loader2, RefreshCw, PhoneOff, PhoneMissed, Calendar, BarChart3 } from 'lucide-react';
import api from '../../services/api';
import AttendanceCard from '../../components/attendance/AttendanceCard';

const TelecallerDashboard = () => {
  const [stats, setStats] = useState(null);
  const [activityStats, setActivityStats] = useState(null);
  const [hourlyData, setHourlyData] = useState(null);
  const [hourlyLoading, setHourlyLoading] = useState(true);
  const [period, setPeriod] = useState('today');
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showDateRange, setShowDateRange] = useState(false);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [hourlyDate, setHourlyDate] = useState(new Date().toISOString().split('T')[0]);

  const fetchData = async (showRefresh = false) => {
    try {
      if (showRefresh) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }
      
      let url = `/dashboard/stats?period=${period}`;
      if (showDateRange && fromDate && toDate) {
        url = `/dashboard/stats?from_date=${fromDate}&to_date=${toDate}`;
      }
      
      const [statsRes, activityRes] = await Promise.all([
        api.get(url),
        api.get('/activity/my-stats'),
      ]);
      setStats(statsRes.data);
      setActivityStats(activityRes.data);
    } catch (error) {
      console.error('Error fetching stats:', error);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  const fetchHourlyData = async () => {
    setHourlyLoading(true);
    try {
      const res = await api.get(`/reports/my-hourly?date=${hourlyDate}`);
      setHourlyData(res.data);
    } catch (error) {
      console.error('Error fetching hourly data:', error);
    } finally {
      setHourlyLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    fetchHourlyData();
    const interval = setInterval(() => fetchData(true), 30000);
    return () => clearInterval(interval);
  }, [period, showDateRange, fromDate, toDate]);

  useEffect(() => {
    fetchHourlyData();
  }, [hourlyDate]);

  const handleRefresh = () => {
    fetchData(true);
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

  const periods = [
    { id: 'today', label: 'Today' },
    { id: 'this_week', label: 'This Week' },
    { id: 'this_month', label: 'This Month' },
    { id: 'all_time', label: 'All Time' },
  ];

  // All statuses to display (without 'new' and 'presentation')
  // Flow: Connected → not_interested, follow_up, leads, file
  const allStatuses = [
    { key: 'not_interested', label: 'Not Interested', color: '#9E9E9E' },
    { key: 'follow_up', label: 'Follow Up', color: '#9C27B0' },
    { key: 'leads', label: 'Lead', color: '#00C853' },
    { key: 'file', label: 'File', color: '#FF9800' },
  ];

  // Call outcomes to display
  const callOutcomes = [
    { key: 'connected', label: 'Connected', color: '#4CAF50' },
    { key: 'not_connecting', label: 'Not Connecting', color: '#9E9E9E' },
    { key: 'no_answer', label: 'No Answer', color: '#F44336' },
    { key: 'busy', label: 'Busy', color: '#FF9800' },
    { key: 'wrong_number', label: 'Wrong Number', color: '#E91E63' },
    { key: 'voicemail', label: 'Voicemail', color: '#9C27B0' },
  ];

  return (
    <div className="p-4" data-testid="telecaller-dashboard">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold text-gray-900">My Dashboard</h2>
        <button
          onClick={handleRefresh}
          disabled={isRefreshing || isLoading}
          className="p-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          data-testid="refresh-btn"
        >
          <RefreshCw size={20} className={isRefreshing ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Attendance Card - At the top */}
      <div className="mb-4">
        <AttendanceCard />
      </div>

      {/* Period Filter */}
      <div className="flex flex-wrap gap-2 mb-3">
        {periods.map((p) => (
          <button
            key={p.id}
            onClick={() => handlePeriodChange(p.id)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              period === p.id && !showDateRange
                ? 'bg-green-600 text-white'
                : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50'
            }`}
          >
            {p.label}
          </button>
        ))}
        <button
          onClick={handleDateRangeToggle}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1 ${
            showDateRange
              ? 'bg-green-600 text-white'
              : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50'
          }`}
        >
          <Calendar size={14} />
          Custom
        </button>
      </div>

      {/* Date Range Picker */}
      {showDateRange && (
        <div className="flex gap-2 mb-4 items-center flex-wrap">
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="input-field text-sm py-1.5"
          />
          <span className="text-gray-500 text-sm">to</span>
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="input-field text-sm py-1.5"
          />
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 text-green-600 animate-spin" />
        </div>
      ) : (
        <>
          {/* Main Stats */}
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="card p-4 text-center">
              <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-2">
                <Target size={20} className="text-green-600" />
              </div>
              <p className="text-xl font-bold text-gray-900">{stats?.my_data || 0}</p>
              <p className="text-xs text-gray-500">My Data</p>
            </div>
            <div className="card p-4 text-center">
              <div className="w-10 h-10 rounded-full bg-orange-100 flex items-center justify-center mx-auto mb-2">
                <Target size={20} className="text-orange-600" />
              </div>
              <p className="text-xl font-bold text-orange-600">{stats?.my_unused_data || 0}</p>
              <p className="text-xs text-gray-500">Unused</p>
            </div>
            <div className="card p-4 text-center">
              <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center mx-auto mb-2">
                <Phone size={20} className="text-blue-600" />
              </div>
              <p className="text-xl font-bold text-gray-900">{stats?.my_connected || 0}</p>
              <p className="text-xs text-gray-500">Calls</p>
            </div>
          </div>

          {/* Activity Stats */}
          {activityStats && (
            <div className="card p-4 mb-4">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Today's Activity</h3>
              <div className="grid grid-cols-4 gap-3">
                <div className="text-center">
                  <div className="flex items-center justify-center gap-2 text-blue-600 mb-1">
                    <Phone size={18} />
                    <span className="text-xl font-bold">{activityStats.calls_made}</span>
                  </div>
                  <p className="text-xs text-gray-500">Outgoing</p>
                </div>
                <div className="text-center">
                  <div className="flex items-center justify-center gap-2 text-green-600 mb-1">
                    <Phone size={18} />
                    <span className="text-xl font-bold">{stats?.incoming_calls?.count || 0}</span>
                  </div>
                  <p className="text-xs text-gray-500">Incoming</p>
                </div>
                <div className="text-center">
                  <div className="flex items-center justify-center gap-2 text-purple-600 mb-1">
                    <Clock size={18} />
                    <span className="text-xl font-bold">
                      {formatTime(activityStats.total_call_seconds + (stats?.incoming_calls?.total_time_seconds || 0))}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500">Total Talk</p>
                </div>
                <div className="text-center">
                  <div className="flex items-center justify-center gap-2 text-orange-600 mb-1">
                    <Clock size={18} />
                    <span className="text-xl font-bold">{formatTime(activityStats.total_idle_seconds)}</span>
                  </div>
                  <p className="text-xs text-gray-500">Idle Time</p>
                </div>
              </div>
            </div>
          )}

          {/* Status Breakdown */}
          <div className="card p-4 mb-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Status Breakdown</h3>
            <div className="grid grid-cols-2 gap-3">
              {allStatuses.map((status) => {
                const count = stats?.leads_by_status?.[status.key] || 0;
                return (
                  <div 
                    key={status.key} 
                    className="flex items-center justify-between p-3 rounded-lg"
                    style={{ backgroundColor: `${status.color}15` }}
                  >
                    <div className="flex items-center gap-2">
                      <div 
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: status.color }}
                      />
                      <span className="text-sm text-gray-700">{status.label}</span>
                    </div>
                    <span className="font-bold" style={{ color: status.color }}>{count}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Call Outcomes */}
          <div className="card p-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Call Outcomes</h3>
            <div className="grid grid-cols-2 gap-3">
              {callOutcomes.map((outcome) => {
                const count = stats?.call_outcomes?.[outcome.key] || 0;
                return (
                  <div 
                    key={outcome.key} 
                    className="flex items-center justify-between p-3 rounded-lg"
                    style={{ backgroundColor: `${outcome.color}15` }}
                  >
                    <div className="flex items-center gap-2">
                      <div 
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: outcome.color }}
                      />
                      <span className="text-sm text-gray-700">{outcome.label}</span>
                    </div>
                    <span className="font-bold" style={{ color: outcome.color }}>{count}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Hourly Report - Vertical Layout */}
          <div className="card p-4 mt-4" data-testid="hourly-report-section">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <BarChart3 size={20} className="text-green-600" />
                <h3 className="text-lg font-semibold text-gray-900">Today's Hourly Report</h3>
              </div>
              <input
                type="date"
                value={hourlyDate}
                onChange={(e) => setHourlyDate(e.target.value)}
                className="text-sm border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
            
            <p className="text-xs text-gray-500 mb-3">C = Calls, Co = Connected, L = Leads, F = Files</p>
            
            {hourlyLoading ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="w-6 h-6 text-green-600 animate-spin" />
              </div>
            ) : hourlyData ? (
              <div className="space-y-2">
                {/* Totals Row */}
                <div className="bg-green-600 text-white rounded-lg p-3 mb-3">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">TOTAL</span>
                    <div className="flex gap-4">
                      <div className="text-center">
                        <div className="text-lg font-bold">{hourlyData.total_calls || 0}</div>
                        <div className="text-xs opacity-80">C</div>
                      </div>
                      <div className="text-center">
                        <div className="text-lg font-bold">{hourlyData.total_connected || 0}</div>
                        <div className="text-xs opacity-80">Co</div>
                      </div>
                      <div className="text-center">
                        <div className="text-lg font-bold">{hourlyData.total_leads || 0}</div>
                        <div className="text-xs opacity-80">L</div>
                      </div>
                      <div className="text-center">
                        <div className="text-lg font-bold">{hourlyData.total_file || 0}</div>
                        <div className="text-xs opacity-80">F</div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Hourly Breakdown - Vertical */}
                {hourlyData.hourly_breakdown && hourlyData.hourly_breakdown.length > 0 ? (
                  <div className="space-y-2">
                    {hourlyData.hourly_breakdown.map((h) => (
                      <div key={h.hour} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-100">
                        <div className="flex items-center gap-2">
                          <div className="w-16 font-medium text-gray-700">{h.hour_label}</div>
                        </div>
                        <div className="flex gap-4">
                          <div className="text-center min-w-[40px]">
                            <div className={`text-base font-semibold ${h.calls > 0 ? 'text-blue-600' : 'text-gray-400'}`}>
                              {h.calls || '-'}
                            </div>
                            <div className="text-[10px] text-gray-400">C</div>
                          </div>
                          <div className="text-center min-w-[40px]">
                            <div className={`text-base font-semibold ${h.connected > 0 ? 'text-green-600' : 'text-gray-400'}`}>
                              {h.connected || '-'}
                            </div>
                            <div className="text-[10px] text-gray-400">Co</div>
                          </div>
                          <div className="text-center min-w-[40px]">
                            <div className={`text-base font-semibold ${h.leads > 0 ? 'text-purple-600' : 'text-gray-400'}`}>
                              {h.leads || '-'}
                            </div>
                            <div className="text-[10px] text-gray-400">L</div>
                          </div>
                          <div className="text-center min-w-[40px]">
                            <div className={`text-base font-semibold ${h.file > 0 ? 'text-orange-600' : 'text-gray-400'}`}>
                              {h.file || '-'}
                            </div>
                            <div className="text-[10px] text-gray-400">F</div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-6 text-gray-400">
                    <Clock size={32} className="mx-auto mb-2 opacity-50" />
                    <p className="text-sm">No activity recorded yet today</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-6 text-gray-400">
                <p className="text-sm">Unable to load hourly data</p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default TelecallerDashboard;
