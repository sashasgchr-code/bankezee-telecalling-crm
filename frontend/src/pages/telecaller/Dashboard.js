import React, { useState, useEffect } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Phone, Clock, TrendingUp, Target, Loader2, RefreshCw, PhoneOff, PhoneMissed } from 'lucide-react';
import api from '../../services/api';

const TelecallerDashboard = () => {
  const [stats, setStats] = useState(null);
  const [activityStats, setActivityStats] = useState(null);
  const [period, setPeriod] = useState('today');
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchData = async (showRefresh = false) => {
    try {
      if (showRefresh) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }
      const [statsRes, activityRes] = await Promise.all([
        api.get(`/dashboard/stats?period=${period}`),
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

  useEffect(() => {
    fetchData();
    const interval = setInterval(() => fetchData(true), 30000);
    return () => clearInterval(interval);
  }, [period]);

  const handleRefresh = () => {
    fetchData(true);
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

  // All statuses to display
  const allStatuses = [
    { key: 'new', label: 'New', color: '#4CAF50' },
    { key: 'contacted', label: 'Contacted', color: '#2196F3' },
    { key: 'interested', label: 'Interested', color: '#FF9800' },
    { key: 'not_interested', label: 'Not Interested', color: '#9E9E9E' },
    { key: 'follow_up', label: 'Follow Up', color: '#9C27B0' },
    { key: 'leads', label: 'Leads', color: '#00C853' },
  ];

  // Call outcomes to display
  const callOutcomes = [
    { key: 'connected', label: 'Connected', color: '#4CAF50' },
    { key: 'no_answer', label: 'No Answer', color: '#FF9800' },
    { key: 'wrong_number', label: 'Wrong Number', color: '#F44336' },
    { key: 'busy', label: 'Busy', color: '#9E9E9E' },
    { key: 'voicemail', label: 'Voicemail', color: '#2196F3' },
    { key: 'presentation', label: 'Presentation', color: '#673AB7' },
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

      {/* Period Filter */}
      <div className="flex flex-wrap gap-2 mb-6">
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
      ) : (
        <>
          {/* Main Stats */}
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="card p-4 text-center">
              <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-2">
                <Target size={24} className="text-green-600" />
              </div>
              <p className="text-2xl font-bold text-gray-900">{stats?.my_data || 0}</p>
              <p className="text-xs text-gray-500">My Data</p>
            </div>
            <div className="card p-4 text-center">
              <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center mx-auto mb-2">
                <Phone size={24} className="text-blue-600" />
              </div>
              <p className="text-2xl font-bold text-gray-900">{stats?.my_connected || 0}</p>
              <p className="text-xs text-gray-500">Total Calls</p>
            </div>
          </div>

          {/* Activity Stats */}
          {activityStats && (
            <div className="card p-4 mb-4">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Today's Activity</h3>
              <div className="grid grid-cols-3 gap-4">
                <div className="text-center">
                  <div className="flex items-center justify-center gap-2 text-green-600 mb-1">
                    <Phone size={18} />
                    <span className="text-xl font-bold">{activityStats.calls_made}</span>
                  </div>
                  <p className="text-xs text-gray-500">Calls Made</p>
                </div>
                <div className="text-center">
                  <div className="flex items-center justify-center gap-2 text-blue-600 mb-1">
                    <Clock size={18} />
                    <span className="text-xl font-bold">{formatTime(activityStats.total_call_seconds)}</span>
                  </div>
                  <p className="text-xs text-gray-500">Talk Time</p>
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
        </>
      )}
    </div>
  );
};

export default TelecallerDashboard;
