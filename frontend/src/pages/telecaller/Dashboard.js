import React, { useState, useEffect } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Phone, Clock, TrendingUp, Target, Loader2 } from 'lucide-react';
import api from '../../services/api';
import StatCard from '../../components/StatCard';

const TelecallerDashboard = () => {
  const [stats, setStats] = useState(null);
  const [activityStats, setActivityStats] = useState(null);
  const [period, setPeriod] = useState('today');
  const [isLoading, setIsLoading] = useState(true);

  const fetchData = async () => {
    try {
      setIsLoading(true);
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
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
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
    { id: 'this_week', label: 'This Week' },
    { id: 'this_month', label: 'This Month' },
    { id: 'all_time', label: 'All Time' },
  ];

  return (
    <div className="p-4" data-testid="telecaller-dashboard">
      <h2 className="text-2xl font-bold text-gray-900 mb-4">My Dashboard</h2>

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
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            <StatCard
              title="My Data"
              value={stats?.my_data || 0}
              icon={Target}
              color="#4CAF50"
            />
            <StatCard
              title="Connected"
              value={stats?.my_connected || 0}
              icon={Phone}
              color="#2196F3"
            />
            <StatCard
              title="Interested"
              value={stats?.my_interested || 0}
              icon={TrendingUp}
              color="#FF9800"
            />
            <StatCard
              title="Leads Generated"
              value={stats?.my_leads_generated || 0}
              icon={Target}
              color="#9C27B0"
            />
          </div>

          {/* Activity Stats */}
          {activityStats && (
            <div className="card p-4 mb-6">
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
          {stats?.leads_by_status && Object.keys(stats.leads_by_status).length > 0 && (
            <div className="card p-4">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Status Breakdown</h3>
              <div className="space-y-3">
                {Object.entries(stats.leads_by_status).map(([status, count]) => (
                  <div key={status} className="flex items-center justify-between">
                    <span className="text-sm capitalize text-gray-700">
                      {status.replace('_', ' ')}
                    </span>
                    <span className="font-semibold text-gray-900">{count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default TelecallerDashboard;
