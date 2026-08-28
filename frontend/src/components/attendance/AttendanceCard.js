import React, { useState, useEffect } from 'react';
import { Clock, MapPin, Loader2, CheckCircle, XCircle, Home, Building2, Palmtree, AlertCircle, RefreshCw } from 'lucide-react';
import api from '../../services/api';

/**
 * AttendanceCard - Shows attendance status and check-in/out for agents
 * Used on both Agent Dashboard and as a standalone component
 */
const AttendanceCard = ({ compact = false }) => {
  const [attendance, setAttendance] = useState(null);
  const [loading, setLoading] = useState(true);
  const [checkingIn, setCheckingIn] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);
  const [locationError, setLocationError] = useState(null);
  const [locationStatus, setLocationStatus] = useState(null);

  // Work mode icons and colors
  const workModeConfig = {
    OFFICE: { icon: Building2, label: 'Office', color: 'text-blue-600', bgColor: 'bg-blue-50', borderColor: 'border-blue-200' },
    WORK_FROM_HOME: { icon: Home, label: 'Work From Home', color: 'text-purple-600', bgColor: 'bg-purple-50', borderColor: 'border-purple-200' },
    LEAVE: { icon: Palmtree, label: 'Leave', color: 'text-green-600', bgColor: 'bg-green-50', borderColor: 'border-green-200' },
  };

  const fetchAttendance = async () => {
    try {
      setLoading(true);
      const response = await api.get('/attendance/today');
      setAttendance(response.data);
      setLocationError(null);
    } catch (error) {
      console.error('Error fetching attendance:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAttendance();
  }, []);

  const getCurrentLocation = () => {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Geolocation is not supported by your browser'));
        return;
      }

      setLocationStatus('Getting your location...');

      navigator.geolocation.getCurrentPosition(
        (position) => {
          setLocationStatus(null);
          resolve({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
          });
        },
        (error) => {
          setLocationStatus(null);
          let message = 'Unable to get location';
          switch (error.code) {
            case error.PERMISSION_DENIED:
              message = 'Location permission denied. Please enable location access in your browser settings.';
              break;
            case error.POSITION_UNAVAILABLE:
              message = 'Location information unavailable. Please try again.';
              break;
            case error.TIMEOUT:
              message = 'Location request timed out. Please try again.';
              break;
            default:
              message = 'Unable to get your location. Please try again.';
          }
          reject(new Error(message));
        },
        {
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 0,
        }
      );
    });
  };

  const handleCheckIn = async () => {
    setCheckingIn(true);
    setLocationError(null);

    try {
      let locationData = { platform: 'web' };

      // For office mode, location is required
      if (attendance?.work_mode === 'OFFICE') {
        const location = await getCurrentLocation();
        locationData = { ...locationData, ...location };
      } else if (attendance?.work_mode === 'WORK_FROM_HOME') {
        // For WFH, try to get location but don't require it
        try {
          const location = await getCurrentLocation();
          locationData = { ...locationData, ...location };
        } catch {
          // WFH doesn't strictly require location
        }
      }

      const response = await api.post('/attendance/check-in', locationData);
      
      if (response.data.success) {
        await fetchAttendance();
      }
    } catch (error) {
      console.error('Check-in error:', error);
      const message = error.response?.data?.detail || error.message || 'Failed to check in';
      setLocationError(message);
    } finally {
      setCheckingIn(false);
    }
  };

  const handleCheckOut = async () => {
    setCheckingOut(true);
    setLocationError(null);

    try {
      let locationData = { platform: 'web' };

      // Try to get location for checkout
      try {
        const location = await getCurrentLocation();
        locationData = { ...locationData, ...location };
      } catch {
        // Location not strictly required for checkout
      }

      const response = await api.post('/attendance/check-out', locationData);
      
      if (response.data.success) {
        await fetchAttendance();
      }
    } catch (error) {
      console.error('Check-out error:', error);
      const message = error.response?.data?.detail || error.message || 'Failed to check out';
      setLocationError(message);
    } finally {
      setCheckingOut(false);
    }
  };

  const formatTime = (isoString) => {
    if (!isoString) return '--:--';
    const date = new Date(isoString);
    return date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
  };

  const formatDuration = (minutes) => {
    if (!minutes || minutes <= 0) return '0h 0m';
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h ${mins}m`;
  };

  if (loading) {
    return (
      <div className="card p-6 flex items-center justify-center" data-testid="attendance-card-loading">
        <Loader2 className="w-6 h-6 animate-spin text-green-600" />
        <span className="ml-2 text-gray-500">Loading attendance...</span>
      </div>
    );
  }

  const workMode = attendance?.work_mode || 'OFFICE';
  const modeConfig = workModeConfig[workMode] || workModeConfig.OFFICE;
  const ModeIcon = modeConfig.icon;

  // Determine state
  const isOnLeave = workMode === 'LEAVE';
  const isCheckedIn = attendance?.checked_in;
  const isCheckedOut = attendance?.checked_out;
  const isDayComplete = isCheckedIn && isCheckedOut;

  return (
    <div className={`card p-5 ${modeConfig.bgColor} ${modeConfig.borderColor} border`} data-testid="attendance-card">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-600 uppercase tracking-wide">Today's Attendance</h3>
        <button 
          onClick={fetchAttendance}
          className="p-1.5 rounded-lg hover:bg-white/50 transition-colors"
          title="Refresh"
        >
          <RefreshCw size={16} className="text-gray-400" />
        </button>
      </div>

      {/* Work Mode Badge */}
      <div className="flex items-center gap-2 mb-4">
        <div className={`w-10 h-10 rounded-xl ${modeConfig.bgColor} flex items-center justify-center border ${modeConfig.borderColor}`}>
          <ModeIcon size={20} className={modeConfig.color} />
        </div>
        <div>
          <p className={`font-semibold ${modeConfig.color}`}>{modeConfig.label}</p>
          <p className="text-xs text-gray-500">{attendance?.attendance_date}</p>
        </div>
      </div>

      {/* Leave Mode - No check-in needed */}
      {isOnLeave && (
        <div className="text-center py-4">
          <Palmtree size={48} className="mx-auto text-green-500 mb-2" />
          <p className="text-lg font-semibold text-green-700">On Leave Today</p>
          <p className="text-sm text-gray-500">Enjoy your day off!</p>
        </div>
      )}

      {/* Working Mode - Show check-in/out */}
      {!isOnLeave && (
        <>
          {/* Status Display */}
          {isDayComplete ? (
            // Day Completed
            <div className="text-center py-4 bg-white/50 rounded-xl mb-4">
              <CheckCircle size={40} className="mx-auto text-green-500 mb-2" />
              <p className="text-lg font-semibold text-green-700">Day Completed</p>
              <div className="flex justify-center gap-6 mt-3 text-sm">
                <div>
                  <p className="text-gray-500">Check In</p>
                  <p className="font-semibold text-gray-800">{formatTime(attendance.check_in_time)}</p>
                </div>
                <div>
                  <p className="text-gray-500">Check Out</p>
                  <p className="font-semibold text-gray-800">{formatTime(attendance.check_out_time)}</p>
                </div>
              </div>
              <div className="mt-3 pt-3 border-t border-gray-200">
                <p className="text-gray-500 text-sm">Working Time</p>
                <p className="text-2xl font-bold text-green-600">{formatDuration(attendance.working_minutes)}</p>
              </div>
            </div>
          ) : isCheckedIn ? (
            // Checked In - Show working status
            <div className="text-center py-4 bg-white/50 rounded-xl mb-4">
              <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-2">
                <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse" />
              </div>
              <p className="text-lg font-semibold text-green-700">Working</p>
              <p className="text-sm text-gray-500">Checked in at {formatTime(attendance.check_in_time)}</p>
              {attendance.check_in_distance !== null && (
                <p className="text-xs text-gray-400 mt-1">
                  <MapPin size={12} className="inline mr-1" />
                  {attendance.check_in_distance}m from office
                </p>
              )}
            </div>
          ) : (
            // Not Checked In
            <div className="text-center py-4 bg-white/50 rounded-xl mb-4">
              <Clock size={40} className="mx-auto text-gray-400 mb-2" />
              <p className="text-lg font-semibold text-gray-600">Not Checked In</p>
              <p className="text-sm text-gray-400">
                {workMode === 'OFFICE' 
                  ? 'Location will be verified for office check-in'
                  : 'Ready to start your work day'}
              </p>
            </div>
          )}

          {/* Location Status */}
          {locationStatus && (
            <div className="flex items-center gap-2 text-sm text-blue-600 mb-3 justify-center">
              <Loader2 size={14} className="animate-spin" />
              <span>{locationStatus}</span>
            </div>
          )}

          {/* Error Message */}
          {locationError && (
            <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg mb-4">
              <AlertCircle size={18} className="text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-700">{locationError}</p>
            </div>
          )}

          {/* Action Buttons */}
          {!isDayComplete && (
            <div className="space-y-2">
              {!isCheckedIn ? (
                <button
                  onClick={handleCheckIn}
                  disabled={checkingIn}
                  className="w-full btn-primary py-3 flex items-center justify-center gap-2 disabled:opacity-50"
                  data-testid="check-in-btn"
                >
                  {checkingIn ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <>
                      <Clock size={20} />
                      {workMode === 'WORK_FROM_HOME' ? 'Start Work' : 'Check In'}
                    </>
                  )}
                </button>
              ) : (
                <button
                  onClick={handleCheckOut}
                  disabled={checkingOut}
                  className="w-full py-3 flex items-center justify-center gap-2 bg-red-500 text-white font-semibold rounded-xl hover:bg-red-600 transition-colors disabled:opacity-50"
                  data-testid="check-out-btn"
                >
                  {checkingOut ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <>
                      <XCircle size={20} />
                      {workMode === 'WORK_FROM_HOME' ? 'End Work' : 'Check Out'}
                    </>
                  )}
                </button>
              )}
            </div>
          )}

          {/* Status Badge */}
          {attendance?.attendance_status && (
            <div className="mt-4 pt-4 border-t border-gray-200/50 flex justify-center">
              <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                attendance.attendance_status === 'PRESENT' ? 'bg-green-100 text-green-700' :
                attendance.attendance_status === 'LATE' ? 'bg-amber-100 text-amber-700' :
                attendance.attendance_status === 'HALF_DAY' ? 'bg-blue-100 text-blue-700' :
                'bg-gray-100 text-gray-700'
              }`}>
                {attendance.attendance_status.replace('_', ' ')}
                {attendance.late_minutes > 0 && ` (${attendance.late_minutes}m late)`}
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default AttendanceCard;
