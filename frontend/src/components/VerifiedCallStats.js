import React, { useState, useEffect, useCallback } from 'react';
import { Phone, PhoneIncoming, PhoneOutgoing, Clock, RefreshCw, Loader2, Smartphone, AlertCircle, Download } from 'lucide-react';
import api from '../services/api';

const VerifiedCallStats = () => {
  const [stats, setStats] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [error, setError] = useState(null);

  const fetchStats = useCallback(async (showRefresh = false) => {
    try {
      if (showRefresh) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }
      setError(null);
      
      const response = await api.get(`/reports/verified-call-stats?date=${date}`);
      setStats(response.data);
    } catch (error) {
      console.error('Error fetching verified call stats:', error);
      setError('Failed to load verified call stats');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [date]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const handleRefresh = () => {
    fetchStats(true);
  };

  const formatTime = (seconds) => {
    if (!seconds) return '0m';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    if (hrs > 0) return `${hrs}h ${mins}m`;
    return `${mins}m`;
  };

  const downloadCSV = () => {
    if (!stats || stats.length === 0) return;

    const headers = [
      'Telecaller',
      'Outgoing Calls',
      'Connected Outgoing',
      'Outgoing Talk Time',
      'Incoming Calls',
      'Connected Incoming',
      'Incoming Talk Time',
      'Total Verified Talk Time',
      'Missed Calls'
    ];

    const rows = stats.map(s => [
      s.user_name,
      s.total_outgoing_calls,
      s.connected_outgoing_calls,
      formatTime(s.outgoing_talk_time_seconds),
      s.total_incoming_calls,
      s.connected_incoming_calls,
      formatTime(s.incoming_talk_time_seconds),
      formatTime(s.total_verified_talk_time_seconds),
      s.missed_calls
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `verified_calls_${date}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  // Calculate totals
  const totals = stats.reduce((acc, s) => ({
    total_outgoing: acc.total_outgoing + s.total_outgoing_calls,
    connected_outgoing: acc.connected_outgoing + s.connected_outgoing_calls,
    outgoing_time: acc.outgoing_time + s.outgoing_talk_time_seconds,
    total_incoming: acc.total_incoming + s.total_incoming_calls,
    connected_incoming: acc.connected_incoming + s.connected_incoming_calls,
    incoming_time: acc.incoming_time + s.incoming_talk_time_seconds,
    total_verified: acc.total_verified + s.total_verified_talk_time_seconds,
    missed: acc.missed + s.missed_calls,
  }), {
    total_outgoing: 0,
    connected_outgoing: 0,
    outgoing_time: 0,
    total_incoming: 0,
    connected_incoming: 0,
    incoming_time: 0,
    total_verified: 0,
    missed: 0,
  });

  const hasData = stats.some(s => s.total_verified_talk_time_seconds > 0);

  return (
    <div className="card p-4" data-testid="verified-call-stats">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-green-100 rounded-lg">
            <Smartphone size={20} className="text-green-600" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Verified Call Stats</h3>
            <p className="text-sm text-gray-500">From Mobile App Call Log Sync</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="input-field text-sm py-1.5"
          />
          <button
            onClick={handleRefresh}
            disabled={isRefreshing || isLoading}
            className="p-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCw size={18} className={isRefreshing ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={downloadCSV}
            disabled={!hasData}
            className="p-2 rounded-lg border border-gray-200 text-green-600 hover:bg-green-50 disabled:opacity-50"
            title="Download CSV"
          >
            <Download size={18} />
          </button>
        </div>
      </div>

      {!hasData && !isLoading && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4">
          <div className="flex items-start gap-3">
            <AlertCircle size={20} className="text-amber-600 mt-0.5" />
            <div>
              <p className="font-medium text-amber-800">No Verified Call Data</p>
              <p className="text-sm text-amber-700 mt-1">
                Telecallers need to use the <strong>BANKEZEE Connect Mobile App</strong> to sync their call logs.
                Once they sync, actual call durations and incoming calls will appear here.
              </p>
            </div>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 text-green-600 animate-spin" />
        </div>
      ) : error ? (
        <div className="text-center py-8 text-red-500">
          {error}
        </div>
      ) : (
        <>
          {/* Summary Stats */}
          {hasData && (
            <div className="grid grid-cols-4 gap-4 mb-4">
              <div className="bg-green-50 rounded-lg p-3 text-center">
                <div className="flex items-center justify-center gap-1 mb-1">
                  <PhoneOutgoing size={16} className="text-green-600" />
                  <span className="text-2xl font-bold text-green-600">{totals.connected_outgoing}</span>
                </div>
                <p className="text-xs text-gray-600">Connected Outgoing</p>
              </div>
              <div className="bg-blue-50 rounded-lg p-3 text-center">
                <div className="flex items-center justify-center gap-1 mb-1">
                  <PhoneIncoming size={16} className="text-blue-600" />
                  <span className="text-2xl font-bold text-blue-600">{totals.connected_incoming}</span>
                </div>
                <p className="text-xs text-gray-600">Connected Incoming</p>
              </div>
              <div className="bg-purple-50 rounded-lg p-3 text-center">
                <div className="flex items-center justify-center gap-1 mb-1">
                  <Clock size={16} className="text-purple-600" />
                  <span className="text-2xl font-bold text-purple-600">{formatTime(totals.total_verified)}</span>
                </div>
                <p className="text-xs text-gray-600">Verified Talk Time</p>
              </div>
              <div className="bg-red-50 rounded-lg p-3 text-center">
                <div className="flex items-center justify-center gap-1 mb-1">
                  <Phone size={16} className="text-red-500" />
                  <span className="text-2xl font-bold text-red-500">{totals.missed}</span>
                </div>
                <p className="text-xs text-gray-600">Missed Calls</p>
              </div>
            </div>
          )}

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 px-3 font-semibold text-gray-700">Telecaller</th>
                  <th className="text-center py-2 px-2 font-semibold text-gray-700">
                    <div className="flex items-center justify-center gap-1">
                      <PhoneOutgoing size={14} className="text-green-600" />
                      <span>Outgoing</span>
                    </div>
                  </th>
                  <th className="text-center py-2 px-2 font-semibold text-gray-700">
                    <div className="flex items-center justify-center gap-1">
                      <Clock size={14} className="text-green-600" />
                      <span>Out Time</span>
                    </div>
                  </th>
                  <th className="text-center py-2 px-2 font-semibold text-gray-700">
                    <div className="flex items-center justify-center gap-1">
                      <PhoneIncoming size={14} className="text-blue-600" />
                      <span>Incoming</span>
                    </div>
                  </th>
                  <th className="text-center py-2 px-2 font-semibold text-gray-700">
                    <div className="flex items-center justify-center gap-1">
                      <Clock size={14} className="text-blue-600" />
                      <span>In Time</span>
                    </div>
                  </th>
                  <th className="text-center py-2 px-2 font-semibold text-gray-700 bg-green-50">
                    <div className="flex items-center justify-center gap-1">
                      <Smartphone size={14} className="text-green-700" />
                      <span>Verified Total</span>
                    </div>
                  </th>
                  <th className="text-center py-2 px-2 font-semibold text-gray-700">Missed</th>
                </tr>
              </thead>
              <tbody>
                {stats.map((telecaller) => (
                  <tr key={telecaller.user_id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-2 px-3 font-medium text-gray-900">{telecaller.user_name}</td>
                    <td className="text-center py-2 px-2">
                      <span className="text-green-600 font-medium">{telecaller.connected_outgoing_calls}</span>
                      <span className="text-gray-400 text-xs">/{telecaller.total_outgoing_calls}</span>
                    </td>
                    <td className="text-center py-2 px-2 text-green-600">
                      {formatTime(telecaller.outgoing_talk_time_seconds)}
                    </td>
                    <td className="text-center py-2 px-2">
                      <span className="text-blue-600 font-medium">{telecaller.connected_incoming_calls}</span>
                      <span className="text-gray-400 text-xs">/{telecaller.total_incoming_calls}</span>
                    </td>
                    <td className="text-center py-2 px-2 text-blue-600">
                      {formatTime(telecaller.incoming_talk_time_seconds)}
                    </td>
                    <td className="text-center py-2 px-2 bg-green-50 font-bold text-green-700">
                      {formatTime(telecaller.total_verified_talk_time_seconds)}
                    </td>
                    <td className="text-center py-2 px-2 text-red-500">
                      {telecaller.missed_calls}
                    </td>
                  </tr>
                ))}
                {stats.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-center py-8 text-gray-500">
                      No telecallers found
                    </td>
                  </tr>
                )}
              </tbody>
              {hasData && (
                <tfoot>
                  <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold">
                    <td className="py-2 px-3 text-gray-900">TOTAL</td>
                    <td className="text-center py-2 px-2 text-green-600">
                      {totals.connected_outgoing}/{totals.total_outgoing}
                    </td>
                    <td className="text-center py-2 px-2 text-green-600">{formatTime(totals.outgoing_time)}</td>
                    <td className="text-center py-2 px-2 text-blue-600">
                      {totals.connected_incoming}/{totals.total_incoming}
                    </td>
                    <td className="text-center py-2 px-2 text-blue-600">{formatTime(totals.incoming_time)}</td>
                    <td className="text-center py-2 px-2 bg-green-100 text-green-800">{formatTime(totals.total_verified)}</td>
                    <td className="text-center py-2 px-2 text-red-500">{totals.missed}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </>
      )}
    </div>
  );
};

export default VerifiedCallStats;
