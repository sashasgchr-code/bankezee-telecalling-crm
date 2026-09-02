import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, Clock, Calendar, MapPin, CheckCircle, XCircle, Coffee, ChevronRight, ChevronDown } from 'lucide-react';
import api from '../../services/api';
import { toast } from 'sonner';

const TelecallerAttendance = () => {
  const navigate = useNavigate();
  const [todayStatus, setTodayStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [monthlyData, setMonthlyData] = useState(null);
  const [currentMonth, setCurrentMonth] = useState(new Date().getMonth() + 1);
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear());
  
  useEffect(() => {
    fetchTodayStatus();
    fetchMonthlyMatrix();
  }, [currentMonth, currentYear]);

  const fetchTodayStatus = async () => {
    try {
      const response = await api.get('/attendance/today');
      setTodayStatus(response.data);
    } catch (error) {
      console.error('Failed to fetch attendance:', error);
    } finally {
      setLoading(false);
    }
  };
  
  const fetchMonthlyMatrix = async () => {
    try {
      const response = await api.get(`/attendance/my/monthly-matrix?month=${currentMonth}&year=${currentYear}`);
      setMonthlyData(response.data);
    } catch (error) {
      console.error('Failed to fetch monthly matrix:', error);
    }
  };

  const handleCheckIn = async () => {
    if (!navigator.geolocation) {
      toast.error('Geolocation not supported by your browser');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          await api.post('/attendance/check-in', {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            platform: 'web'
          });
          toast.success('Checked in successfully!');
          fetchTodayStatus();
        } catch (error) {
          toast.error(error.response?.data?.detail || 'Check-in failed');
        }
      },
      (error) => {
        toast.error('Unable to get your location. Please enable location services.');
      },
      { enableHighAccuracy: true }
    );
  };

  const handleCheckOut = async () => {
    if (!navigator.geolocation) {
      toast.error('Geolocation not supported by your browser');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          await api.post('/attendance/check-out', {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            platform: 'web'
          });
          toast.success('Checked out successfully!');
          fetchTodayStatus();
        } catch (error) {
          toast.error(error.response?.data?.detail || 'Check-out failed');
        }
      },
      (error) => {
        toast.error('Unable to get your location');
      },
      { enableHighAccuracy: true }
    );
  };

  const getStatusBadge = (code) => {
    const styles = {
      'P': 'bg-green-100 text-green-700',
      'W': 'bg-blue-100 text-blue-700',
      'A': 'bg-amber-100 text-amber-700',
      'U': 'bg-red-100 text-red-700',
      '-': 'bg-gray-100 text-gray-400',
      '': 'bg-gray-50 text-gray-300'
    };
    const baseCode = code?.split(' ')[0] || '';
    if (baseCode.startsWith('L')) return 'bg-orange-100 text-orange-700';
    return styles[baseCode] || 'bg-gray-100 text-gray-500';
  };

  const prevMonth = () => {
    if (currentMonth === 1) {
      setCurrentMonth(12);
      setCurrentYear(currentYear - 1);
    } else {
      setCurrentMonth(currentMonth - 1);
    }
  };

  const nextMonth = () => {
    const now = new Date();
    if (currentYear < now.getFullYear() || (currentYear === now.getFullYear() && currentMonth < now.getMonth() + 1)) {
      if (currentMonth === 12) {
        setCurrentMonth(1);
        setCurrentYear(currentYear + 1);
      } else {
        setCurrentMonth(currentMonth + 1);
      }
    }
  };

  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 
                      'July', 'August', 'September', 'October', 'November', 'December'];

  return (
    <div className="min-h-screen bg-gray-50" data-testid="telecaller-attendance">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 py-3 sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="p-2 hover:bg-gray-100 rounded-lg">
            <ChevronLeft size={20} />
          </button>
          <div>
            <h1 className="text-lg font-bold text-gray-900">My Attendance</h1>
            <p className="text-xs text-gray-500">{todayStatus?.attendance_date || new Date().toLocaleDateString()}</p>
          </div>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Today's Status Card */}
        <div className="bg-white rounded-xl border border-gray-200 p-4" data-testid="today-status-card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900 flex items-center gap-2">
              <Clock size={18} className="text-green-600" />
              Today's Status
            </h2>
            <span className={`px-3 py-1 rounded-full text-xs font-medium ${
              todayStatus?.attendance_status === 'PRESENT' ? 'bg-green-100 text-green-700' :
              todayStatus?.attendance_status === 'LATE' ? 'bg-orange-100 text-orange-700' :
              'bg-gray-100 text-gray-600'
            }`}>
              {todayStatus?.attendance_status || 'Not Marked'}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-4 mb-4">
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-xs text-gray-500 mb-1">Check In</p>
              <p className="font-semibold text-gray-900">
                {todayStatus?.check_in_time_ist || '-'}
              </p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-xs text-gray-500 mb-1">Check Out</p>
              <p className="font-semibold text-gray-900">
                {todayStatus?.check_out_time_ist || '-'}
              </p>
            </div>
          </div>

          {/* Check In/Out Buttons */}
          <div className="flex gap-3">
            {!todayStatus?.checked_in ? (
              <button
                onClick={handleCheckIn}
                className="flex-1 py-3 bg-green-600 text-white rounded-xl font-medium flex items-center justify-center gap-2 hover:bg-green-700"
                data-testid="check-in-btn"
              >
                <CheckCircle size={20} />
                Check In
              </button>
            ) : !todayStatus?.checked_out ? (
              <button
                onClick={handleCheckOut}
                className="flex-1 py-3 bg-red-600 text-white rounded-xl font-medium flex items-center justify-center gap-2 hover:bg-red-700"
                data-testid="check-out-btn"
              >
                <XCircle size={20} />
                Check Out
              </button>
            ) : (
              <div className="flex-1 py-3 bg-gray-100 text-gray-600 rounded-xl font-medium text-center">
                Attendance Completed for Today
              </div>
            )}
          </div>

          {todayStatus?.working_minutes > 0 && (
            <div className="mt-4 text-center">
              <p className="text-sm text-gray-500">Working Time</p>
              <p className="text-xl font-bold text-green-600">
                {Math.floor(todayStatus.working_minutes / 60)}h {todayStatus.working_minutes % 60}m
              </p>
            </div>
          )}
        </div>

        {/* Monthly Matrix */}
        {monthlyData && (
          <div className="bg-white rounded-xl border border-gray-200 p-4" data-testid="monthly-matrix">
            <div className="flex items-center justify-between mb-4">
              <button onClick={prevMonth} className="p-2 hover:bg-gray-100 rounded-lg">
                <ChevronLeft size={20} />
              </button>
              <h3 className="font-semibold text-gray-900">
                {monthNames[currentMonth - 1]} {currentYear}
              </h3>
              <button onClick={nextMonth} className="p-2 hover:bg-gray-100 rounded-lg">
                <ChevronRight size={20} />
              </button>
            </div>

            {/* Summary */}
            <div className="grid grid-cols-5 gap-2 mb-4">
              <div className="text-center p-2 bg-green-50 rounded-lg">
                <p className="text-lg font-bold text-green-700">{monthlyData.summary?.present || 0}</p>
                <p className="text-xs text-gray-600">Present</p>
              </div>
              <div className="text-center p-2 bg-orange-50 rounded-lg">
                <p className="text-lg font-bold text-orange-700">{monthlyData.summary?.late || 0}</p>
                <p className="text-xs text-gray-600">Late</p>
              </div>
              <div className="text-center p-2 bg-blue-50 rounded-lg">
                <p className="text-lg font-bold text-blue-700">{monthlyData.summary?.wfh || 0}</p>
                <p className="text-xs text-gray-600">WFH</p>
              </div>
              <div className="text-center p-2 bg-amber-50 rounded-lg">
                <p className="text-lg font-bold text-amber-700">{monthlyData.summary?.leave || 0}</p>
                <p className="text-xs text-gray-600">Leave</p>
              </div>
              <div className="text-center p-2 bg-red-50 rounded-lg">
                <p className="text-lg font-bold text-red-700">{monthlyData.summary?.absent || 0}</p>
                <p className="text-xs text-gray-600">Absent</p>
              </div>
            </div>

            {/* Calendar Grid */}
            <div className="grid grid-cols-7 gap-1">
              {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
                <div key={i} className="text-center text-xs text-gray-400 py-1 font-medium">{d}</div>
              ))}
              
              {/* Empty cells for first day offset */}
              {Array.from({ length: new Date(currentYear, currentMonth - 1, 1).getDay() }).map((_, i) => (
                <div key={`empty-${i}`} className="aspect-square"></div>
              ))}
              
              {/* Day cells */}
              {Array.from({ length: monthlyData.days_in_month }).map((_, i) => {
                const day = i + 1;
                const dayData = monthlyData.days?.[day];
                const code = dayData?.code || '';
                const displayCode = code.startsWith('L') ? 'L' : code;
                
                return (
                  <div
                    key={day}
                    className={`aspect-square flex flex-col items-center justify-center rounded-lg text-xs ${getStatusBadge(code)}`}
                    title={dayData?.detail || ''}
                  >
                    <span className="font-medium">{day}</span>
                    <span className="text-[10px]">{displayCode}</span>
                  </div>
                );
              })}
            </div>

            {/* Legend */}
            <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-gray-100">
              <span className="flex items-center gap-1 text-xs"><span className="w-3 h-3 rounded bg-green-100"></span> P=Present</span>
              <span className="flex items-center gap-1 text-xs"><span className="w-3 h-3 rounded bg-orange-100"></span> L=Late</span>
              <span className="flex items-center gap-1 text-xs"><span className="w-3 h-3 rounded bg-blue-100"></span> W=WFH</span>
              <span className="flex items-center gap-1 text-xs"><span className="w-3 h-3 rounded bg-amber-100"></span> A=Leave</span>
              <span className="flex items-center gap-1 text-xs"><span className="w-3 h-3 rounded bg-red-100"></span> U=Absent</span>
            </div>

            {/* Attendance Percentage */}
            <div className="mt-4 text-center">
              <p className="text-2xl font-bold text-green-600">{monthlyData.summary?.attendance_percentage || 0}%</p>
              <p className="text-sm text-gray-500">Attendance Rate</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default TelecallerAttendance;
