import React, { useState, useEffect } from 'react';
import { Calendar, Clock, MapPin, Building2, Home, Palmtree, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import api from '../../services/api';

/**
 * AttendanceHistory - Shows attendance history for agents
 */
const AttendanceHistory = () => {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState(new Date().getMonth());
  const [year, setYear] = useState(new Date().getFullYear());

  const workModeConfig = {
    OFFICE: { icon: Building2, label: 'Office', color: 'text-blue-600', bgColor: 'bg-blue-100' },
    WORK_FROM_HOME: { icon: Home, label: 'WFH', color: 'text-purple-600', bgColor: 'bg-purple-100' },
    LEAVE: { icon: Palmtree, label: 'Leave', color: 'text-green-600', bgColor: 'bg-green-100' },
  };

  const statusColors = {
    PRESENT: 'bg-green-100 text-green-700',
    LATE: 'bg-amber-100 text-amber-700',
    HALF_DAY: 'bg-blue-100 text-blue-700',
    ABSENT: 'bg-red-100 text-red-700',
    ON_LEAVE: 'bg-green-100 text-green-700',
  };

  const fetchHistory = async () => {
    try {
      setLoading(true);
      const startDate = new Date(year, month, 1).toISOString();
      const endDate = new Date(year, month + 1, 0).toISOString();
      
      const response = await api.get('/attendance/history', {
        params: { start_date: startDate, end_date: endDate, limit: 50 }
      });
      setRecords(response.data);
    } catch (error) {
      console.error('Error fetching attendance history:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, [month, year]);

  const formatTime = (isoString, istTimeFormatted = null) => {
    // Prefer pre-formatted IST time from API if available
    if (istTimeFormatted) return istTimeFormatted;
    if (!isoString) return '--:--';
    try {
      const date = new Date(isoString);
      // Use Intl.DateTimeFormat with Asia/Kolkata timezone for consistent IST display
      return new Intl.DateTimeFormat('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
        timeZone: 'Asia/Kolkata'
      }).format(date);
    } catch (e) {
      const date = new Date(isoString);
      return date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
    }
  };

  const formatDate = (isoString) => {
    if (!isoString) return '';
    const date = new Date(isoString);
    return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', weekday: 'short' });
  };

  const formatDuration = (minutes) => {
    if (!minutes || minutes <= 0) return '-';
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h ${mins}m`;
  };

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  const prevMonth = () => {
    if (month === 0) {
      setMonth(11);
      setYear(year - 1);
    } else {
      setMonth(month - 1);
    }
  };

  const nextMonth = () => {
    if (month === 11) {
      setMonth(0);
      setYear(year + 1);
    } else {
      setMonth(month + 1);
    }
  };

  // Calculate summary
  const summary = records.reduce((acc, record) => {
    acc.total++;
    if (record.attendance_status === 'PRESENT' || record.attendance_status === 'LATE') {
      acc.present++;
    }
    if (record.attendance_status === 'LATE') acc.late++;
    if (record.attendance_status === 'ON_LEAVE' || record.work_mode === 'LEAVE') acc.leave++;
    if (record.work_mode === 'OFFICE') acc.office++;
    if (record.work_mode === 'WORK_FROM_HOME') acc.wfh++;
    acc.totalMinutes += record.working_minutes || 0;
    return acc;
  }, { total: 0, present: 0, late: 0, leave: 0, office: 0, wfh: 0, totalMinutes: 0 });

  return (
    <div className="space-y-6" data-testid="attendance-history">
      {/* Month Navigation */}
      <div className="card p-4">
        <div className="flex items-center justify-between">
          <button
            onClick={prevMonth}
            className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <ChevronLeft size={20} />
          </button>
          <h2 className="text-lg font-semibold text-gray-900">
            {monthNames[month]} {year}
          </h2>
          <button
            onClick={nextMonth}
            className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <ChevronRight size={20} />
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="card p-3 text-center">
          <p className="text-2xl font-bold text-green-600">{summary.present}</p>
          <p className="text-xs text-gray-500">Present</p>
        </div>
        <div className="card p-3 text-center">
          <p className="text-2xl font-bold text-amber-600">{summary.late}</p>
          <p className="text-xs text-gray-500">Late</p>
        </div>
        <div className="card p-3 text-center">
          <p className="text-2xl font-bold text-green-600">{summary.leave}</p>
          <p className="text-xs text-gray-500">Leave</p>
        </div>
      </div>

      {/* Total Hours */}
      <div className="card p-4 bg-green-50 border border-green-200">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-green-700">Total Working Hours</p>
            <p className="text-2xl font-bold text-green-800">
              {Math.floor(summary.totalMinutes / 60)}h {summary.totalMinutes % 60}m
            </p>
          </div>
          <Clock size={32} className="text-green-500" />
        </div>
      </div>

      {/* Records List */}
      <div className="card overflow-hidden">
        <div className="p-4 border-b border-gray-200">
          <h3 className="font-semibold text-gray-900">Attendance Records</h3>
        </div>
        
        {loading ? (
          <div className="p-8 flex justify-center">
            <Loader2 className="w-8 h-8 animate-spin text-green-600" />
          </div>
        ) : records.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <Calendar size={48} className="mx-auto mb-2 text-gray-300" />
            <p>No attendance records for this month</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {records.map((record) => {
              const modeConfig = workModeConfig[record.work_mode] || workModeConfig.OFFICE;
              const ModeIcon = modeConfig.icon;
              
              return (
                <div key={record.id} className="p-4 hover:bg-gray-50">
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3">
                      <div className={`w-10 h-10 rounded-lg ${modeConfig.bgColor} flex items-center justify-center`}>
                        <ModeIcon size={18} className={modeConfig.color} />
                      </div>
                      <div>
                        <p className="font-medium text-gray-900">{formatDate(record.attendance_date)}</p>
                        <p className="text-sm text-gray-500">{modeConfig.label}</p>
                      </div>
                    </div>
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColors[record.attendance_status] || 'bg-gray-100 text-gray-700'}`}>
                      {record.attendance_status?.replace('_', ' ') || '-'}
                    </span>
                  </div>
                  
                  {record.check_in_time && (
                    <div className="mt-3 flex items-center gap-4 text-sm text-gray-600 pl-13">
                      <div className="flex items-center gap-1">
                        <Clock size={14} className="text-green-500" />
                        <span>In: {formatTime(record.check_in_time, record.check_in_time_ist)}</span>
                      </div>
                      {record.check_out_time && (
                        <>
                          <div className="flex items-center gap-1">
                            <Clock size={14} className="text-red-500" />
                            <span>Out: {formatTime(record.check_out_time, record.check_out_time_ist)}</span>
                          </div>
                          <div className="flex items-center gap-1 font-medium text-gray-900">
                            <span>{formatDuration(record.working_minutes)}</span>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                  
                  {record.check_in_distance_from_office && (
                    <div className="mt-2 flex items-center gap-1 text-xs text-gray-400 pl-13">
                      <MapPin size={12} />
                      <span>{record.check_in_distance_from_office}m from office</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default AttendanceHistory;
