import React, { useState, useEffect } from 'react';
import { Database, Phone, TrendingUp, Users, Loader2 } from 'lucide-react';
import api from '../../services/api';
import StatCard from '../../components/StatCard';

const AdminDashboard = () => {
  const [stats, setStats] = useState(null);
  const [telecallers, setTelecallers] = useState([]);
  const [period, setPeriod] = useState('today');
  const [selectedTelecaller, setSelectedTelecaller] = useState('all');
  const [isLoading, setIsLoading] = useState(true);

  const fetchData = async () => {
    try {
      setIsLoading(true);
      const [statsRes, telecallersRes] = await Promise.all([
        api.get(`/dashboard/stats?period=${period}&telecaller_id=${selectedTelecaller}`),
        api.get('/users/telecallers'),
      ]);
      setStats(statsRes.data);
      setTelecallers(telecallersRes.data);
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [period, selectedTelecaller]);

  const periods = [
    { id: 'today', label: 'Today' },
    { id: 'this_week', label: 'This Week' },
    { id: 'this_month', label: 'This Month' },
    { id: 'last_month', label: 'Last Month' },
    { id: 'all_time', label: 'All Time' },
  ];

  return (
    <div className="p-4" data-testid="admin-dashboard">
      <h2 className="text-2xl font-bold text-gray-900 mb-4">Dashboard</h2>

      {/* Period Filter */}
      <div className="flex flex-wrap gap-2 mb-4 overflow-x-auto pb-2 -mx-4 px-4">
        {periods.map((p) => (
          <button
            key={p.id}
            onClick={() => setPeriod(p.id)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
              period === p.id
                ? 'bg-green-600 text-white'
                : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Telecaller Filter */}
      <div className="mb-6">
        <select
          value={selectedTelecaller}
          onChange={(e) => setSelectedTelecaller(e.target.value)}
          className="w-full input-field"
          data-testid="telecaller-filter"
        >
          <option value="all">All Telecallers</option>
          {telecallers.map((tc) => (
            <option key={tc.id} value={tc.id}>{tc.name}</option>
          ))}
        </select>
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
              title="Total Data"
              value={stats?.total_data || 0}
              icon={Database}
              color="#4CAF50"
            />
            <StatCard
              title="Connected"
              value={stats?.connected || 0}
              icon={Phone}
              color="#2196F3"
            />
            <StatCard
              title="Leads Generated"
              value={stats?.total_leads_generated || 0}
              icon={TrendingUp}
              color="#9C27B0"
            />
            <StatCard
              title="Interested"
              value={stats?.total_interested || 0}
              icon={TrendingUp}
              color="#FF9800"
            />
          </div>

          {/* Active Telecallers */}
          <div className="card p-4 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Active Telecallers</h3>
              <span className="bg-green-100 text-green-600 px-3 py-1 rounded-full text-sm font-semibold">
                {stats?.active_telecallers || 0}
              </span>
            </div>
          </div>

          {/* Status Breakdown */}
          {stats?.leads_by_status && Object.keys(stats.leads_by_status).length > 0 && (
            <div className="card p-4 mb-6">
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

          {/* Calls Per User */}
          {stats?.calls_per_user && Object.keys(stats.calls_per_user).length > 0 && (
            <div className="card p-4">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Calls by Telecaller</h3>
              <div className="space-y-3">
                {Object.entries(stats.calls_per_user).map(([name, count]) => (
                  <div key={name} className="flex items-center justify-between">
                    <span className="text-sm text-gray-700">{name}</span>
                    <span className="font-semibold text-gray-900">{count} calls</span>
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

export default AdminDashboard;
