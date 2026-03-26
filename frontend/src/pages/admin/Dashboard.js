import React, { useState, useEffect, useCallback } from 'react';
import { Database, Phone, TrendingUp, Users, Loader2, RefreshCw, Calendar } from 'lucide-react';
import api from '../../services/api';
import { StatusColors, StatusLabels } from '../../constants/colors';
import VerifiedCallStats from '../../components/VerifiedCallStats';

const AdminDashboard = () => {
  const [stats, setStats] = useState(null);
  const [telecallers, setTelecallers] = useState([]);
  const [period, setPeriod] = useState('today');
  const [selectedTelecaller, setSelectedTelecaller] = useState('all');
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showDateRange, setShowDateRange] = useState(false);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const fetchData = useCallback(async (showRefresh = false) => {
    try {
      if (showRefresh) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }
      
      let url = `/dashboard/stats?period=${period}&telecaller_id=${selectedTelecaller}`;
      if (showDateRange && fromDate && toDate) {
        url = `/dashboard/stats?telecaller_id=${selectedTelecaller}&from_date=${fromDate}&to_date=${toDate}`;
      }
      
      const [statsRes, telecallersRes] = await Promise.all([
        api.get(url),
        api.get('/users/telecallers'),
      ]);
      setStats(statsRes.data);
      setTelecallers(telecallersRes.data);
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [period, selectedTelecaller, showDateRange, fromDate, toDate]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(() => fetchData(true), 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

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
      // Set default dates when enabling
      const today = new Date().toISOString().split('T')[0];
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      setFromDate(weekAgo);
      setToDate(today);
    }
  };

  const periods = [
    { id: 'today', label: 'Today' },
    { id: 'this_week', label: 'This Week' },
    { id: 'this_month', label: 'This Month' },
    { id: 'last_month', label: 'Last Month' },
    { id: 'all_time', label: 'All Time' },
  ];

  // All possible statuses for display (Update statuses shown when connected)
  const allStatuses = [
    { key: 'new', label: 'New', color: '#4CAF50' },
    { key: 'not_interested', label: 'Not Interested', color: '#9E9E9E' },
    { key: 'follow_up', label: 'Follow Up', color: '#9C27B0' },
    { key: 'presentation', label: 'Presentation', color: '#673AB7' },
    { key: 'leads', label: 'Lead', color: '#00C853' },
    { key: 'file', label: 'File', color: '#FF9800' },
  ];

  return (
    <div className="p-4" data-testid="admin-dashboard">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold text-gray-900">Dashboard</h2>
        <button
          onClick={handleRefresh}
          disabled={isRefreshing || isLoading}
          className="p-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          data-testid="refresh-dashboard-btn"
        >
          <RefreshCw size={20} className={isRefreshing ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Period Filter */}
      <div className="flex flex-wrap gap-2 mb-3 overflow-x-auto pb-2 -mx-4 px-4">
        {periods.map((p) => (
          <button
            key={p.id}
            onClick={() => handlePeriodChange(p.id)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
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
          className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors flex items-center gap-1 ${
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
            data-testid="from-date"
          />
          <span className="text-gray-500 text-sm">to</span>
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="input-field text-sm py-1.5"
            data-testid="to-date"
          />
        </div>
      )}

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
          {/* Main Stats Row */}
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="card p-4 text-center">
              <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-2">
                <Database size={24} className="text-green-600" />
              </div>
              <p className="text-2xl font-bold text-gray-900">{stats?.total_data || 0}</p>
              <p className="text-xs text-gray-500">Total Data</p>
            </div>
            <div className="card p-4 text-center">
              <div className="w-12 h-12 rounded-full bg-orange-100 flex items-center justify-center mx-auto mb-2">
                <Database size={24} className="text-orange-600" />
              </div>
              <p className="text-2xl font-bold text-orange-600">{stats?.unused_data || 0}</p>
              <p className="text-xs text-gray-500">Unused Data</p>
            </div>
            <div className="card p-4 text-center">
              <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center mx-auto mb-2">
                <Phone size={24} className="text-blue-600" />
              </div>
              <p className="text-2xl font-bold text-gray-900">{stats?.connected || 0}</p>
              <p className="text-xs text-gray-500">Connected</p>
            </div>
          </div>

          {/* Status Breakdown - All Statuses */}
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

          {/* Active Telecallers */}
          <div className="card p-4 mb-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center">
                  <Users size={20} className="text-purple-600" />
                </div>
                <div>
                  <p className="font-semibold text-gray-900">Active Telecallers</p>
                  <p className="text-xs text-gray-500">Currently working</p>
                </div>
              </div>
              <span className="text-2xl font-bold text-purple-600">
                {stats?.active_telecallers || 0}
              </span>
            </div>
          </div>

          {/* Calls Per User */}
          {stats?.calls_per_user && Object.keys(stats.calls_per_user).length > 0 && (
            <div className="card p-4">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Calls by Telecaller</h3>
              <div className="space-y-3">
                {Object.entries(stats.calls_per_user).map(([name, count]) => (
                  <div key={name} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-green-600 flex items-center justify-center">
                        <span className="text-white text-sm font-bold">
                          {name.charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <span className="text-sm text-gray-700">{name}</span>
                    </div>
                    <span className="font-semibold text-green-600">{count} calls</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Verified Call Stats Section */}
          <div className="mt-6">
            <VerifiedCallStats />
          </div>
        </>
      )}
    </div>
  );
};

export default AdminDashboard;
