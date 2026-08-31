import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Platform,
  PermissionsAndroid,
} from 'react-native';
import * as Location from 'expo-location';
import { getTodayAttendance, checkIn, checkOut } from '../services/api';

/**
 * AttendanceCard - Shows attendance status and check-in/out for mobile agents
 * Displays at the top of the Dashboard
 */
const AttendanceCard = () => {
  const [attendance, setAttendance] = useState(null);
  const [loading, setLoading] = useState(true);
  const [checkingIn, setCheckingIn] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);
  const [locationError, setLocationError] = useState(null);

  const workModeConfig = {
    OFFICE: { emoji: '🏢', label: 'Office', color: '#3B82F6', bgColor: '#EFF6FF' },
    WORK_FROM_HOME: { emoji: '🏠', label: 'Work From Home', color: '#8B5CF6', bgColor: '#F5F3FF' },
    LEAVE: { emoji: '🌴', label: 'Leave', color: '#22C55E', bgColor: '#F0FDF4' },
  };

  const fetchAttendance = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getTodayAttendance();
      setAttendance(data);
      setLocationError(null);
    } catch (error) {
      console.error('Error fetching attendance:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAttendance();
  }, [fetchAttendance]);

  const getCurrentLocation = async () => {
    try {
      // Request permission
      const { status } = await Location.requestForegroundPermissionsAsync();
      
      if (status !== 'granted') {
        throw new Error('Location permission denied. Please enable location access in settings.');
      }

      // Get current position
      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
        timeout: 15000,
      });

      return {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        accuracy: location.coords.accuracy,
      };
    } catch (error) {
      console.error('Location error:', error);
      throw new Error(error.message || 'Unable to get location. Please try again.');
    }
  };

  const handleCheckIn = async () => {
    setCheckingIn(true);
    setLocationError(null);

    try {
      let locationData = { platform: 'android' };

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

      const response = await checkIn(locationData);
      
      if (response.success) {
        Alert.alert(
          '✅ Checked In',
          `Check-in time: ${formatTime(response.check_in_time)}\n${
            response.distance_from_office 
              ? `Distance from office: ${response.distance_from_office}m` 
              : ''
          }`,
          [{ text: 'OK' }]
        );
        await fetchAttendance();
      }
    } catch (error) {
      console.error('Check-in error:', error);
      const message = error.response?.data?.detail || error.message || 'Failed to check in';
      setLocationError(message);
      Alert.alert('Check-In Failed', message);
    } finally {
      setCheckingIn(false);
    }
  };

  const handleCheckOut = async () => {
    Alert.alert(
      'Confirm Check-Out',
      'Are you sure you want to check out for the day?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Check Out',
          onPress: async () => {
            setCheckingOut(true);
            setLocationError(null);

            try {
              let locationData = { platform: 'android' };

              // Try to get location for checkout
              try {
                const location = await getCurrentLocation();
                locationData = { ...locationData, ...location };
              } catch {
                // Location not strictly required for checkout
              }

              const response = await checkOut(locationData);
              
              if (response.success) {
                Alert.alert(
                  '✅ Checked Out',
                  `Check-out time: ${formatTime(response.check_out_time)}\nWorking time: ${response.working_hours}`,
                  [{ text: 'OK' }]
                );
                await fetchAttendance();
              }
            } catch (error) {
              console.error('Check-out error:', error);
              const message = error.response?.data?.detail || error.message || 'Failed to check out';
              setLocationError(message);
              Alert.alert('Check-Out Failed', message);
            } finally {
              setCheckingOut(false);
            }
          },
        },
      ]
    );
  };

  const formatTime = (isoString) => {
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
      // Fallback to toLocaleTimeString
      const date = new Date(isoString);
      return date.toLocaleTimeString('en-IN', { 
        hour: '2-digit', 
        minute: '2-digit', 
        hour12: true,
        timeZone: 'Asia/Kolkata'
      });
    }
  };

  // Get display time - prefer pre-formatted IST time from API
  const getDisplayTime = (field) => {
    // Check for pre-formatted IST time from API (e.g., check_in_time_ist)
    const istField = `${field}_ist`;
    if (attendance && attendance[istField]) {
      return attendance[istField];
    }
    // Fallback to formatting UTC time with IST timezone
    return attendance ? formatTime(attendance[field]) : '--:--';
  };

  const formatDuration = (minutes) => {
    if (!minutes || minutes <= 0) return '0h 0m';
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h ${mins}m`;
  };

  if (loading) {
    return (
      <View style={styles.card}>
        <ActivityIndicator color="#16A34A" size="small" />
        <Text style={styles.loadingText}>Loading attendance...</Text>
      </View>
    );
  }

  const workMode = attendance?.work_mode || 'OFFICE';
  const modeConfig = workModeConfig[workMode] || workModeConfig.OFFICE;

  // Determine state
  const isOnLeave = workMode === 'LEAVE';
  const isCheckedIn = attendance?.checked_in;
  const isCheckedOut = attendance?.checked_out;
  const isDayComplete = isCheckedIn && isCheckedOut;

  return (
    <View style={[styles.card, { backgroundColor: modeConfig.bgColor, borderColor: modeConfig.color }]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerText}>TODAY'S ATTENDANCE</Text>
        <TouchableOpacity onPress={fetchAttendance}>
          <Text style={styles.refreshText}>↻</Text>
        </TouchableOpacity>
      </View>

      {/* Work Mode Badge */}
      <View style={styles.workModeRow}>
        <Text style={styles.modeEmoji}>{modeConfig.emoji}</Text>
        <View>
          <Text style={[styles.modeLabel, { color: modeConfig.color }]}>{modeConfig.label}</Text>
          <Text style={styles.dateText}>{attendance?.attendance_date}</Text>
        </View>
      </View>

      {/* Leave Mode */}
      {isOnLeave && (
        <View style={styles.statusContainer}>
          <Text style={styles.leaveEmoji}>🌴</Text>
          <Text style={styles.leaveText}>On Leave Today</Text>
          <Text style={styles.leaveSubtext}>Enjoy your day off!</Text>
        </View>
      )}

      {/* Working Mode - Show check-in/out */}
      {!isOnLeave && (
        <>
          {isDayComplete ? (
            // Day Completed
            <View style={styles.statusContainer}>
              <Text style={styles.statusEmoji}>✅</Text>
              <Text style={styles.completedText}>DAY COMPLETED</Text>
              <View style={styles.timeRow}>
                <View style={styles.timeItem}>
                  <Text style={styles.timeLabel}>Check In</Text>
                  <Text style={styles.timeValue}>{getDisplayTime('check_in_time')}</Text>
                </View>
                <View style={styles.timeItem}>
                  <Text style={styles.timeLabel}>Check Out</Text>
                  <Text style={styles.timeValue}>{getDisplayTime('check_out_time')}</Text>
                </View>
              </View>
              <View style={styles.durationContainer}>
                <Text style={styles.durationLabel}>Working Time</Text>
                <Text style={styles.durationValue}>{formatDuration(attendance.working_minutes)}</Text>
              </View>
            </View>
          ) : isCheckedIn ? (
            // Checked In - Working
            <View style={styles.statusContainer}>
              <View style={styles.workingIndicator}>
                <View style={styles.pulsingDot} />
              </View>
              <Text style={styles.workingText}>🟢 CHECKED IN</Text>
              <Text style={styles.checkInTime}>{getDisplayTime('check_in_time')}</Text>
              {attendance.check_in_distance !== null && (
                <Text style={styles.distanceText}>📍 {attendance.check_in_distance}m from office</Text>
              )}
              <Text style={styles.subText}>Working Today</Text>
            </View>
          ) : (
            // Not Checked In
            <View style={styles.statusContainer}>
              <Text style={styles.statusEmoji}>⏰</Text>
              <Text style={styles.notCheckedText}>Not checked in yet</Text>
              <Text style={styles.subText}>
                {workMode === 'OFFICE' 
                  ? 'Location will be verified'
                  : 'Ready to start your day'}
              </Text>
            </View>
          )}

          {/* Error Message */}
          {locationError && (
            <View style={styles.errorContainer}>
              <Text style={styles.errorText}>⚠️ {locationError}</Text>
            </View>
          )}

          {/* Action Button */}
          {!isDayComplete && (
            <TouchableOpacity
              style={[
                styles.actionButton,
                isCheckedIn ? styles.checkOutButton : styles.checkInButton,
              ]}
              onPress={isCheckedIn ? handleCheckOut : handleCheckIn}
              disabled={checkingIn || checkingOut}
            >
              {(checkingIn || checkingOut) ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Text style={styles.buttonText}>
                  {isCheckedIn 
                    ? (workMode === 'WORK_FROM_HOME' ? 'END WORK' : 'CHECK OUT')
                    : (workMode === 'WORK_FROM_HOME' ? 'START WORK' : 'CHECK IN')
                  }
                </Text>
              )}
            </TouchableOpacity>
          )}

          {/* Status Badge */}
          {attendance?.attendance_status && (
            <View style={styles.statusBadgeContainer}>
              <View style={[
                styles.statusBadge,
                attendance.attendance_status === 'PRESENT' && styles.presentBadge,
                attendance.attendance_status === 'LATE' && styles.lateBadge,
              ]}>
                <Text style={styles.statusBadgeText}>
                  {attendance.attendance_status.replace('_', ' ')}
                  {attendance.late_minutes > 0 && ` (${attendance.late_minutes}m late)`}
                </Text>
              </View>
            </View>
          )}
        </>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginHorizontal: 16,
    marginVertical: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  headerText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6B7280',
    letterSpacing: 0.5,
  },
  refreshText: {
    fontSize: 18,
    color: '#9CA3AF',
  },
  workModeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  modeEmoji: {
    fontSize: 32,
    marginRight: 12,
  },
  modeLabel: {
    fontSize: 16,
    fontWeight: '700',
  },
  dateText: {
    fontSize: 12,
    color: '#9CA3AF',
  },
  statusContainer: {
    alignItems: 'center',
    paddingVertical: 16,
    backgroundColor: 'rgba(255,255,255,0.5)',
    borderRadius: 12,
    marginBottom: 16,
  },
  statusEmoji: {
    fontSize: 40,
    marginBottom: 8,
  },
  leaveEmoji: {
    fontSize: 48,
    marginBottom: 8,
  },
  leaveText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#16A34A',
  },
  leaveSubtext: {
    fontSize: 14,
    color: '#6B7280',
    marginTop: 4,
  },
  completedText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#16A34A',
    marginBottom: 12,
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 32,
  },
  timeItem: {
    alignItems: 'center',
  },
  timeLabel: {
    fontSize: 12,
    color: '#6B7280',
  },
  timeValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1F2937',
  },
  durationContainer: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    alignItems: 'center',
    width: '100%',
  },
  durationLabel: {
    fontSize: 12,
    color: '#6B7280',
  },
  durationValue: {
    fontSize: 28,
    fontWeight: '700',
    color: '#16A34A',
  },
  workingIndicator: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#DCFCE7',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  pulsingDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#16A34A',
  },
  workingText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#16A34A',
  },
  checkInTime: {
    fontSize: 14,
    color: '#6B7280',
    marginTop: 4,
  },
  distanceText: {
    fontSize: 12,
    color: '#9CA3AF',
    marginTop: 4,
  },
  subText: {
    fontSize: 14,
    color: '#6B7280',
    marginTop: 8,
  },
  notCheckedText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#6B7280',
  },
  loadingText: {
    fontSize: 14,
    color: '#6B7280',
    marginTop: 8,
  },
  errorContainer: {
    backgroundColor: '#FEF2F2',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  errorText: {
    fontSize: 13,
    color: '#DC2626',
  },
  actionButton: {
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkInButton: {
    backgroundColor: '#16A34A',
  },
  checkOutButton: {
    backgroundColor: '#DC2626',
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  statusBadgeContainer: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.05)',
    alignItems: 'center',
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#F3F4F6',
  },
  presentBadge: {
    backgroundColor: '#DCFCE7',
  },
  lateBadge: {
    backgroundColor: '#FEF3C7',
  },
  statusBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#374151',
  },
});

export default AttendanceCard;
