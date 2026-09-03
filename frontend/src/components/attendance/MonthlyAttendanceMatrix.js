import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ChevronLeft, ChevronRight, Loader2, X, Calendar, Clock, MapPin, Building2, Home } from 'lucide-react';
import api from '../../services/api';

/**
 * MonthlyAttendanceMatrix - Enhanced attendance matrix with responsive design
 * Shows all GPs (admin view) or single user (GP view) with day-by-day breakdown
 * 
 * Attendance Codes:
 * P = Present
 * L = Late (with login time, e.g., "L 10:24")
 * W = Work From Home
 * A = Approved Leave
 * U = Uninformed Leave/Absence
 * - = Weekend/Non-working day
 * (blank) = Future date
 */
const MonthlyAttendanceMatrix = ({ 
  isAdmin = false, 
  onClose,
  embedded = false // If true, shown inline without modal wrapper
}) => {
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(new Date().getFullYear());
  const [loading, setLoading] = useState(false);
  const [matrixData, setMatrixData] = useState(null);
  const [selectedDay, setSelectedDay] = useState(null);
  const [selectedUser, setSelectedUser] = useState(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [dayDetails, setDayDetails] = useState(null);
  
  const tableRef = useRef(null);
  
  // Generate years array (current year - 2 to current year)
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 3 }, (_, i) => currentYear - 2 + i);
  
  const months = [
    { value: 1, label: 'January' },
    { value: 2, label: 'February' },
    { value: 3, label: 'March' },
    { value: 4, label: 'April' },
    { value: 5, label: 'May' },
    { value: 6, label: 'June' },
    { value: 7, label: 'July' },
    { value: 8, label: 'August' },
    { value: 9, label: 'September' },
    { value: 10, label: 'October' },
    { value: 11, label: 'November' },
    { value: 12, label: 'December' },
  ];

  const fetchMatrixData = useCallback(async () => {
    try {
      setLoading(true);
      const endpoint = isAdmin 
        ? '/attendance/admin/monthly-matrix' 
        : '/attendance/my/monthly-matrix';
      const response = await api.get(endpoint, { params: { month, year } });
      setMatrixData(response.data);
    } catch (error) {
      console.error('Error fetching matrix data:', error);
    } finally {
      setLoading(false);
    }
  }, [month, year, isAdmin]);

  useEffect(() => {
    fetchMatrixData();
  }, [fetchMatrixData]);

  const prevMonth = () => {
    if (month === 1) {
      setMonth(12);
      setYear(year - 1);
    } else {
      setMonth(month - 1);
    }
  };

  const nextMonth = () => {
    const now = new Date();
    const canGoNext = year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth() + 1);
    if (canGoNext) {
      if (month === 12) {
        setMonth(1);
        setYear(year + 1);
      } else {
        setMonth(month + 1);
      }
    }
  };

  const handleDayClick = async (userId, userName, day, dayData) => {
    if (!dayData || dayData.code === '' || dayData.code === '-') return;
    
    setSelectedDay(day);
    setSelectedUser({ id: userId, name: userName });
    setDetailsLoading(true);
    
    try {
      // Fetch detailed attendance for this day
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const response = await api.get('/attendance/admin/today', { params: { date: dateStr } });
      const userRecord = response.data.find(r => r.user_id === userId);
      setDayDetails(userRecord || dayData);
    } catch (error) {
      console.error('Error fetching day details:', error);
      setDayDetails(dayData);
    } finally {
      setDetailsLoading(false);
    }
  };

  const closeDetails = () => {
    setSelectedDay(null);
    setSelectedUser(null);
    setDayDetails(null);
  };

  const getCodeStyle = (code) => {
    if (!code || code === '') return 'bg-gray-50 text-gray-300';
    const baseCode = code.split(' ')[0];
    const styles = {
      'P': 'bg-green-100 text-green-700 font-medium',
      'L': 'bg-orange-100 text-orange-700 font-medium',
      'W': 'bg-blue-100 text-blue-700 font-medium',
      'A': 'bg-amber-100 text-amber-700 font-medium',
      'U': 'bg-red-100 text-red-700 font-medium',
      '-': 'bg-gray-100 text-gray-400',
    };
    return styles[baseCode] || 'bg-gray-100 text-gray-500';
  };

  const formatDisplayCode = (code) => {
    if (!code) return '';
    // For Late with time, show just "L" in cell (time shows on hover/tap)
    if (code.startsWith('L ')) return 'L';
    return code;
  };

  const content = (
    <div className="flex flex-col h-full" data-testid="monthly-attendance-matrix">
      {/* Header with Filters */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <Calendar size={20} className="text-green-600" />
          Monthly Attendance Matrix
        </h3>
        
        {/* Month/Year Selectors */}
        <div className="flex items-center gap-2">
          <button 
            onClick={prevMonth}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            data-testid="prev-month-btn"
          >
            <ChevronLeft size={20} />
          </button>
          
          <div className="flex items-center gap-2">
            <select
              value={month}
              onChange={(e) => setMonth(parseInt(e.target.value))}
              className="h-9 px-3 border border-gray-200 rounded-lg bg-white text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              data-testid="month-select"
            >
              {months.map(m => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
            
            <select
              value={year}
              onChange={(e) => setYear(parseInt(e.target.value))}
              className="h-9 px-3 border border-gray-200 rounded-lg bg-white text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              data-testid="year-select"
            >
              {years.map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
          
          <button 
            onClick={nextMonth}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            data-testid="next-month-btn"
          >
            <ChevronRight size={20} />
          </button>
          
          {onClose && (
            <button 
              onClick={onClose}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors ml-2"
            >
              <X size={20} />
            </button>
          )}
        </div>
      </div>

      {/* Matrix Table */}
      {loading ? (
        <div className="flex justify-center items-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-green-600" />
        </div>
      ) : matrixData ? (
        <div className="flex-1 overflow-hidden">
          {/* Responsive table wrapper */}
          <div 
            ref={tableRef}
            className="overflow-x-auto max-h-[60vh] border border-gray-200 rounded-lg"
          >
            <table className="w-full text-xs border-collapse">
              <thead className="sticky top-0 z-20 bg-gray-50">
                <tr>
                  {/* Sticky name column header */}
                  <th className="sticky left-0 z-30 bg-gray-50 px-3 py-2 text-left font-semibold text-gray-700 border-b border-r border-gray-200 min-w-[140px] sm:min-w-[180px]">
                    Growth Partner
                  </th>
                  
                  {/* Day columns */}
                  {Array.from({ length: matrixData.days_in_month }, (_, i) => {
                    const day = i + 1;
                    const date = new Date(year, month - 1, day);
                    const isWeekend = date.getDay() === 0 || date.getDay() === 6;
                    return (
                      <th 
                        key={day} 
                        className={`px-1 py-2 text-center font-medium border-b border-gray-200 min-w-[32px] ${
                          isWeekend ? 'bg-gray-100 text-gray-500' : 'text-gray-600'
                        }`}
                      >
                        {day}
                      </th>
                    );
                  })}
                  
                  {/* Summary columns - sticky right */}
                  <th className="px-2 py-2 text-center font-semibold text-green-700 bg-green-50 border-b border-l border-gray-200 min-w-[36px]">P</th>
                  <th className="px-2 py-2 text-center font-semibold text-orange-700 bg-orange-50 border-b border-gray-200 min-w-[36px]">L</th>
                  <th className="px-2 py-2 text-center font-semibold text-blue-700 bg-blue-50 border-b border-gray-200 min-w-[36px]">W</th>
                  <th className="px-2 py-2 text-center font-semibold text-amber-700 bg-amber-50 border-b border-gray-200 min-w-[36px]">A</th>
                  <th className="px-2 py-2 text-center font-semibold text-red-700 bg-red-50 border-b border-gray-200 min-w-[36px]">U</th>
                  <th className="px-2 py-2 text-center font-semibold text-gray-700 bg-gray-100 border-b border-gray-200 min-w-[44px]" title="Working Days">WD</th>
                  <th className="px-2 py-2 text-center font-semibold text-gray-900 bg-gray-100 border-b border-gray-200 min-w-[44px]">%</th>
                </tr>
              </thead>
              
              <tbody className="divide-y divide-gray-100">
                {(isAdmin ? matrixData.matrix : [matrixData])?.map((row, idx) => (
                  <tr key={row.user_id || idx} className="hover:bg-gray-50/50">
                    {/* Sticky name column */}
                    <td className="sticky left-0 z-10 bg-white px-3 py-2 font-medium text-gray-800 border-r border-gray-200 whitespace-nowrap">
                      {row.user_name}
                    </td>
                    
                    {/* Day cells */}
                    {Array.from({ length: matrixData.days_in_month }, (_, i) => {
                      const day = i + 1;
                      const dayData = row.days?.[day];
                      const code = dayData?.code || '';
                      const displayCode = formatDisplayCode(code);
                      const date = new Date(year, month - 1, day);
                      const isWeekend = date.getDay() === 0 || date.getDay() === 6;
                      
                      return (
                        <td 
                          key={day} 
                          className={`px-1 py-2 text-center cursor-pointer transition-colors ${getCodeStyle(code)} ${
                            isWeekend && code === '-' ? 'bg-gray-50' : ''
                          }`}
                          title={dayData?.detail || ''}
                          onClick={() => isAdmin && handleDayClick(row.user_id, row.user_name, day, dayData)}
                          data-testid={`cell-${row.user_id}-${day}`}
                        >
                          {displayCode}
                        </td>
                      );
                    })}
                    
                    {/* Summary cells */}
                    <td className="px-2 py-2 text-center font-semibold bg-green-50 text-green-700 border-l border-gray-200">
                      {row.summary?.present || 0}
                    </td>
                    <td className="px-2 py-2 text-center font-semibold bg-orange-50 text-orange-700">
                      {row.summary?.late || 0}
                    </td>
                    <td className="px-2 py-2 text-center font-semibold bg-blue-50 text-blue-700">
                      {row.summary?.wfh || 0}
                    </td>
                    <td className="px-2 py-2 text-center font-semibold bg-amber-50 text-amber-700">
                      {row.summary?.leave || 0}
                    </td>
                    <td className="px-2 py-2 text-center font-semibold bg-red-50 text-red-700">
                      {row.summary?.absent || 0}
                    </td>
                    <td className="px-2 py-2 text-center font-semibold bg-gray-100 text-gray-700" title="Working Days">
                      {row.summary?.working_days || 0}
                    </td>
                    <td className="px-2 py-2 text-center font-bold bg-gray-100 text-gray-900">
                      {row.summary?.attendance_percentage || 0}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          
          {/* Legend */}
          <div className="flex flex-wrap gap-3 mt-4 pt-4 border-t border-gray-100 text-xs">
            <span className="flex items-center gap-1">
              <span className="w-4 h-4 rounded bg-green-100 border border-green-200"></span> P = Present
            </span>
            <span className="flex items-center gap-1">
              <span className="w-4 h-4 rounded bg-orange-100 border border-orange-200"></span> L = Late
            </span>
            <span className="flex items-center gap-1">
              <span className="w-4 h-4 rounded bg-blue-100 border border-blue-200"></span> W = WFH
            </span>
            <span className="flex items-center gap-1">
              <span className="w-4 h-4 rounded bg-amber-100 border border-amber-200"></span> A = Approved Leave
            </span>
            <span className="flex items-center gap-1">
              <span className="w-4 h-4 rounded bg-red-100 border border-red-200"></span> U = Uninformed Absence
            </span>
            <span className="flex items-center gap-1">
              <span className="w-4 h-4 rounded bg-gray-100 border border-gray-200"></span> - = Weekend
            </span>
          </div>
        </div>
      ) : (
        <p className="text-gray-500 text-center py-8">No attendance data available</p>
      )}

      {/* Day Details Modal/Drawer */}
      {selectedDay && selectedUser && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50" onClick={closeDetails}>
          <div 
            className="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl p-5 max-h-[80vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <div>
                <h4 className="font-semibold text-gray-900">{selectedUser.name}</h4>
                <p className="text-sm text-gray-500">
                  {months.find(m => m.value === month)?.label} {selectedDay}, {year}
                </p>
              </div>
              <button onClick={closeDetails} className="p-2 hover:bg-gray-100 rounded-lg">
                <X size={20} />
              </button>
            </div>
            
            {detailsLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-green-600" />
              </div>
            ) : dayDetails ? (
              <div className="space-y-4">
                {/* Status Badge */}
                <div className="flex items-center gap-2">
                  <span className={`px-3 py-1 rounded-full text-sm font-medium ${getCodeStyle(dayDetails.code || dayDetails.attendance_status)}`}>
                    {dayDetails.attendance_status || dayDetails.detail || 'Unknown'}
                  </span>
                  {dayDetails.work_mode && (
                    <span className="flex items-center gap-1 text-sm text-gray-600">
                      {dayDetails.work_mode === 'OFFICE' ? <Building2 size={14} /> : <Home size={14} />}
                      {dayDetails.work_mode === 'WORK_FROM_HOME' ? 'WFH' : dayDetails.work_mode}
                    </span>
                  )}
                </div>
                
                {/* Time Details */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-xs text-gray-500 mb-1">Check In</p>
                    <p className="font-semibold text-gray-900 flex items-center gap-1">
                      <Clock size={14} className="text-green-600" />
                      {dayDetails.check_in_time_ist || '-'}
                    </p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-xs text-gray-500 mb-1">Check Out</p>
                    <p className="font-semibold text-gray-900 flex items-center gap-1">
                      <Clock size={14} className="text-red-600" />
                      {dayDetails.check_out_time_ist || '-'}
                    </p>
                  </div>
                </div>
                
                {/* Working Hours */}
                {dayDetails.working_minutes > 0 && (
                  <div className="bg-green-50 rounded-lg p-3">
                    <p className="text-xs text-gray-500 mb-1">Working Hours</p>
                    <p className="text-lg font-bold text-green-700">
                      {Math.floor(dayDetails.working_minutes / 60)}h {dayDetails.working_minutes % 60}m
                    </p>
                  </div>
                )}
                
                {/* Late Info */}
                {dayDetails.late_minutes > 0 && (
                  <div className="bg-orange-50 rounded-lg p-3">
                    <p className="text-xs text-gray-500 mb-1">Late by</p>
                    <p className="font-semibold text-orange-700">
                      {dayDetails.late_minutes} minutes
                    </p>
                  </div>
                )}
                
                {/* Location */}
                {dayDetails.check_in_distance_from_office !== undefined && dayDetails.check_in_distance_from_office !== null && (
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <MapPin size={14} />
                    <span>Check-in {dayDetails.check_in_distance_from_office}m from office</span>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-gray-500 text-center py-4">No detailed data available</p>
            )}
          </div>
        </div>
      )}
    </div>
  );

  // If embedded, return content directly
  if (embedded) {
    return content;
  }

  // Otherwise wrap in a card
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      {content}
    </div>
  );
};

export default MonthlyAttendanceMatrix;
