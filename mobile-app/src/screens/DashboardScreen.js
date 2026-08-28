import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
  Alert,
  Switch,
  Dimensions,
} from 'react-native';
import { getDashboardStats, pingActivity, logout as apiLogout } from '../services/api';
import { 
  syncCallLogsWithBackend, 
  requestAllPermissions,
  getDiagnostics,
  runDiagnostics,
} from '../services/callLogService';
import {
  requestRecordingPermissions,
  getRecordingEnabled,
  setRecordingEnabled,
} from '../services/recordingService';
import AttendanceCard from '../components/AttendanceCard';

const { width } = Dimensions.get('window');

const DashboardScreen = ({ user, onLogout }) => {
  const [stats, setStats] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loginDuration, setLoginDuration] = useState(0);
  const [recordingEnabled, setRecordingEnabledState] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncResult, setLastSyncResult] = useState(null);
  const [period, setPeriod] = useState('today');
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [diagnostics, setDiagnostics] = useState(null);

  const isAdmin = user?.role === 'admin';

  // Period filters
  const periods = [
    { id: 'today', label: 'Today' },
    { id: 'this_week', label: 'This Week' },
    { id: 'this_month', label: 'This Month' },
    { id: 'all_time', label: 'All Time' },
  ];

  // Status breakdown items (without 'new' and 'presentation')
  const statusItems = [
    { key: 'not_interested', label: 'Not Interested', color: '#9E9E9E', bgColor: '#F5F5F5' },
    { key: 'follow_up', label: 'Follow Up', color: '#9C27B0', bgColor: '#F3E5F5' },
    { key: 'leads', label: 'Lead', color: '#4CAF50', bgColor: '#E8F5E9' },
    { key: 'file', label: 'File', color: '#FF9800', bgColor: '#FFF3E0' },
  ];

  // Call outcomes
  const callOutcomes = [
    { key: 'connected', label: 'Connected', color: '#4CAF50', bgColor: '#E8F5E9' },
    { key: 'not_connecting', label: 'Not Connecting', color: '#9E9E9E', bgColor: '#F5F5F5' },
    { key: 'no_answer', label: 'No Answer', color: '#F44336', bgColor: '#FFEBEE' },
    { key: 'busy', label: 'Busy', color: '#FF9800', bgColor: '#FFF3E0' },
    { key: 'wrong_number', label: 'Wrong Number', color: '#E91E63', bgColor: '#FCE4EC' },
    { key: 'voicemail', label: 'Voicemail', color: '#9C27B0', bgColor: '#F3E5F5' },
  ];

  // Format seconds to readable time
  const formatTime = (seconds) => {
    if (!seconds || seconds < 0) return '0m';
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
  };

  // Load stats
  const loadStats = useCallback(async () => {
    try {
      const response = await getDashboardStats(period);
      setStats(response);
    } catch (error) {
      console.error('Error loading stats:', error);
    }
  }, [period]);

  // Load recording settings and run initial diagnostics
  const loadSettings = async () => {
    const enabled = await getRecordingEnabled();
    setRecordingEnabledState(enabled);
    
    // Run diagnostics in background
    const diag = await runDiagnostics();
    setDiagnostics(diag);
  };

  // Request all permissions on first load
  const initializePermissions = async () => {
    const permissions = await requestAllPermissions();
    console.log('Permissions status:', permissions);
    
    // Update diagnostics after permission request
    const diag = await runDiagnostics();
    setDiagnostics(diag);
  };

  // Initial load
  useEffect(() => {
    loadStats();
    loadSettings();
    initializePermissions();

    // Ping activity every 30 seconds
    const pingInterval = setInterval(() => {
      pingActivity().catch(console.error);
    }, 30000);

    // Refresh stats every minute
    const statsInterval = setInterval(loadStats, 60000);

    return () => {
      clearInterval(pingInterval);
      clearInterval(statsInterval);
    };
  }, [loadStats]);

  // Real-time login duration timer
  useEffect(() => {
    if (stats?.daily_session?.login_time) {
      const loginTime = new Date(stats.daily_session.login_time).getTime();
      
      const updateDuration = () => {
        const now = Date.now();
        const duration = Math.floor((now - loginTime) / 1000);
        setLoginDuration(duration);
      };

      updateDuration();
      const interval = setInterval(updateDuration, 1000);
      return () => clearInterval(interval);
    }
  }, [stats?.daily_session?.login_time]);

  // Handle refresh
  const onRefresh = async () => {
    setRefreshing(true);
    await loadStats();
    const diag = await runDiagnostics();
    setDiagnostics(diag);
    setRefreshing(false);
  };

  // Handle sync with visible feedback
  const handleSync = async () => {
    setSyncing(true);
    try {
      const result = await syncCallLogsWithBackend([], true); // showErrors = true
      setLastSyncResult(result);
      
      // Update diagnostics
      const diag = getDiagnostics();
      setDiagnostics(diag);
      
      if (result.error) {
        // Error already shown by syncCallLogsWithBackend
      } else if (result.synced > 0) {
        Alert.alert('Sync Complete', `Synced ${result.synced} calls, ${result.matched} matched to leads`);
      } else {
        Alert.alert('Sync Complete', 'No new calls to sync');
      }
    } catch (error) {
      Alert.alert('Sync Failed', error.message);
    } finally {
      setSyncing(false);
    }
  };

  // Handle recording toggle
  const handleToggleRecording = async (value) => {
    if (value) {
      const permissions = await requestRecordingPermissions();
      if (!permissions.audio) {
        Alert.alert('Permission Required', 'Microphone permission is needed for call recording');
        return;
      }
    }
    await setRecordingEnabled(value);
    setRecordingEnabledState(value);
  };

  // Handle logout
  const handleLogout = async () => {
    Alert.alert('Logout', 'Are you sure you want to logout?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Logout',
        style: 'destructive',
        onPress: async () => {
          try {
            await apiLogout();
          } catch (e) {}
          onLogout();
        },
      },
    ]);
  };

  // Get status count from leads_by_status
  const getStatusCount = (key) => {
    return stats?.leads_by_status?.[key] || 0;
  };

  // Get call outcome count
  const getOutcomeCount = (key) => {
    return stats?.call_outcomes?.[key] || 0;
  };

  // Get files count (activity-based)
  const getFilesCount = () => {
    return stats?.my_file || stats?.total_file || 0;
  };

  // Diagnostics status indicator
  const getStatusIndicator = (status) => {
    switch (status) {
      case 'granted':
      case true:
        return { icon: '✅', color: '#4CAF50' };
      case 'denied':
      case false:
        return { icon: '❌', color: '#F44336' };
      default:
        return { icon: '❓', color: '#FF9800' };
    }
  };

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>Welcome back,</Text>
          <Text style={styles.userName}>{user?.name || 'User'}</Text>
          <Text style={styles.userRole}>{isAdmin ? '👑 Admin' : '📞 Telecaller'}</Text>
        </View>
        <TouchableOpacity onPress={handleLogout} style={styles.logoutBtn}>
          <Text style={styles.logoutText}>Logout</Text>
        </TouchableOpacity>
      </View>

      {/* Files Trophy Card */}
      <View style={styles.trophyCard}>
        <View style={styles.trophyIconContainer}>
          <Text style={styles.trophyIcon}>🏆</Text>
        </View>
        <View style={styles.trophyContent}>
          <Text style={styles.trophyValue}>{getFilesCount()}</Text>
          <Text style={styles.trophyLabel}>Files ({period.replace('_', ' ')})</Text>
        </View>
      </View>

      {/* Attendance Card - Near the top */}
      <AttendanceCard />

      {/* Period Filter */}
      <View style={styles.periodFilter}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {periods.map((p) => (
            <TouchableOpacity
              key={p.id}
              style={[
                styles.periodButton,
                period === p.id && styles.periodButtonActive,
              ]}
              onPress={() => setPeriod(p.id)}
            >
              <Text
                style={[
                  styles.periodButtonText,
                  period === p.id && styles.periodButtonTextActive,
                ]}
              >
                {p.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Quick Stats Row */}
      <View style={styles.quickStatsRow}>
        <View style={styles.quickStatCard}>
          <Text style={styles.quickStatIcon}>📊</Text>
          <Text style={styles.quickStatValue}>{stats?.my_data || 0}</Text>
          <Text style={styles.quickStatLabel}>My Data</Text>
        </View>
        <View style={styles.quickStatCard}>
          <Text style={styles.quickStatIcon}>⏸️</Text>
          <Text style={[styles.quickStatValue, { color: '#FF9800' }]}>{stats?.my_unused_data || 0}</Text>
          <Text style={styles.quickStatLabel}>Unused</Text>
        </View>
        <View style={styles.quickStatCard}>
          <Text style={styles.quickStatIcon}>📞</Text>
          <Text style={[styles.quickStatValue, { color: '#2196F3' }]}>{stats?.my_connected || 0}</Text>
          <Text style={styles.quickStatLabel}>Calls</Text>
        </View>
      </View>

      {/* Today's Activity */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Today's Activity</Text>
        <View style={styles.activityGrid}>
          <View style={styles.activityItem}>
            <Text style={styles.activityIcon}>📞</Text>
            <Text style={[styles.activityValue, { color: '#2196F3' }]}>
              {(stats?.call_outcomes?.connected || 0) + (stats?.call_outcomes?.not_connecting || 0) + 
               (stats?.call_outcomes?.no_answer || 0) + (stats?.call_outcomes?.busy || 0) + 
               (stats?.call_outcomes?.wrong_number || 0) + (stats?.call_outcomes?.voicemail || 0)}
            </Text>
            <Text style={styles.activityLabel}>Outgoing</Text>
          </View>
          <View style={styles.activityItem}>
            <Text style={styles.activityIcon}>📲</Text>
            <Text style={[styles.activityValue, { color: '#4CAF50' }]}>
              {stats?.incoming_calls?.count || 0}
            </Text>
            <Text style={styles.activityLabel}>Incoming</Text>
          </View>
          <View style={styles.activityItem}>
            <Text style={styles.activityIcon}>⏱️</Text>
            <Text style={[styles.activityValue, { color: '#9C27B0' }]}>
              {formatTime((stats?.daily_session?.total_call_seconds || 0) + (stats?.incoming_calls?.total_time_seconds || 0))}
            </Text>
            <Text style={styles.activityLabel}>Total Talk</Text>
          </View>
          <View style={styles.activityItem}>
            <Text style={styles.activityIcon}>💤</Text>
            <Text style={[styles.activityValue, { color: '#F44336' }]}>
              {formatTime(stats?.daily_session?.total_idle_seconds || 0)}
            </Text>
            <Text style={styles.activityLabel}>Idle Time</Text>
          </View>
        </View>
      </View>

      {/* Status Breakdown */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Status Breakdown</Text>
        <View style={styles.statusGrid}>
          {statusItems.map((item) => (
            <View key={item.key} style={[styles.statusCard, { backgroundColor: item.bgColor }]}>
              <View style={[styles.statusDot, { backgroundColor: item.color }]} />
              <Text style={styles.statusLabel}>{item.label}</Text>
              <Text style={[styles.statusValue, { color: item.color }]}>
                {getStatusCount(item.key)}
              </Text>
            </View>
          ))}
        </View>
      </View>

      {/* Call Outcomes */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Call Outcomes</Text>
        <View style={styles.outcomesGrid}>
          {callOutcomes.map((item) => (
            <View key={item.key} style={[styles.outcomeCard, { backgroundColor: item.bgColor }]}>
              <View style={[styles.outcomeDot, { backgroundColor: item.color }]} />
              <Text style={styles.outcomeLabel}>{item.label}</Text>
              <Text style={[styles.outcomeValue, { color: item.color }]}>
                {getOutcomeCount(item.key)}
              </Text>
            </View>
          ))}
        </View>
      </View>

      {/* Login Timer */}
      <View style={styles.section}>
        <View style={styles.loginTimerCard}>
          <View>
            <Text style={styles.loginTimerLabel}>Login Time</Text>
            <Text style={styles.loginTimerValue}>{formatTime(loginDuration)}</Text>
            <Text style={styles.loginTimerSubtext}>Real-time ⏱️</Text>
          </View>
        </View>
      </View>

      {/* Call Recording Toggle */}
      <View style={styles.section}>
        <View style={styles.recordingToggle}>
          <View>
            <Text style={styles.recordingLabel}>🎙️ Call Recording</Text>
            <Text style={styles.recordingSubtext}>Use speakerphone for best quality</Text>
          </View>
          <Switch
            value={recordingEnabled}
            onValueChange={handleToggleRecording}
            trackColor={{ false: '#d1d5db', true: '#86efac' }}
            thumbColor={recordingEnabled ? '#22c55e' : '#9ca3af'}
          />
        </View>
      </View>

      {/* Sync Button */}
      <View style={styles.section}>
        <TouchableOpacity
          style={[styles.syncButton, syncing && styles.syncButtonDisabled]}
          onPress={handleSync}
          disabled={syncing}
        >
          <Text style={styles.syncButtonText}>
            {syncing ? '🔄 Syncing...' : '📲 Sync Call Logs'}
          </Text>
        </TouchableOpacity>
        {lastSyncResult && (
          <Text style={[styles.syncResult, lastSyncResult.error && styles.syncResultError]}>
            {lastSyncResult.error 
              ? `Error: ${lastSyncResult.error}` 
              : `Last sync: ${lastSyncResult.synced} calls, ${lastSyncResult.matched} matched`}
          </Text>
        )}
      </View>

      {/* Diagnostics Toggle */}
      <View style={styles.section}>
        <TouchableOpacity
          style={styles.diagnosticsToggle}
          onPress={() => setShowDiagnostics(!showDiagnostics)}
        >
          <Text style={styles.diagnosticsToggleText}>
            {showDiagnostics ? '🔧 Hide Diagnostics' : '🔧 Show Diagnostics'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Diagnostics Section */}
      {showDiagnostics && diagnostics && (
        <View style={styles.diagnosticsSection}>
          <Text style={styles.diagnosticsTitle}>📊 Call Log Diagnostics</Text>
          
          <View style={styles.diagnosticsRow}>
            <Text style={styles.diagnosticsLabel}>CallLog Module:</Text>
            <Text style={[styles.diagnosticsValue, { color: getStatusIndicator(diagnostics.moduleLoaded).color }]}>
              {getStatusIndicator(diagnostics.moduleLoaded).icon} {diagnostics.moduleLoaded ? 'LOADED' : 'NOT LOADED'}
            </Text>
          </View>
          
          {diagnostics.moduleLoadError && (
            <View style={styles.diagnosticsRow}>
              <Text style={styles.diagnosticsLabel}>Module Error:</Text>
              <Text style={[styles.diagnosticsValue, styles.diagnosticsError]}>
                {diagnostics.moduleLoadError}
              </Text>
            </View>
          )}
          
          <View style={styles.diagnosticsRow}>
            <Text style={styles.diagnosticsLabel}>READ_CALL_LOG:</Text>
            <Text style={[styles.diagnosticsValue, { color: getStatusIndicator(diagnostics.readCallLogPermission).color }]}>
              {getStatusIndicator(diagnostics.readCallLogPermission).icon} {String(diagnostics.readCallLogPermission).toUpperCase()}
            </Text>
          </View>
          
          <View style={styles.diagnosticsRow}>
            <Text style={styles.diagnosticsLabel}>READ_PHONE_STATE:</Text>
            <Text style={[styles.diagnosticsValue, { color: getStatusIndicator(diagnostics.readPhoneStatePermission).color }]}>
              {getStatusIndicator(diagnostics.readPhoneStatePermission).icon} {String(diagnostics.readPhoneStatePermission).toUpperCase()}
            </Text>
          </View>
          
          <View style={styles.diagnosticsRow}>
            <Text style={styles.diagnosticsLabel}>Call Log Entries:</Text>
            <Text style={styles.diagnosticsValue}>{diagnostics.callLogEntriesCount}</Text>
          </View>
          
          {diagnostics.lastSyncTime && (
            <View style={styles.diagnosticsRow}>
              <Text style={styles.diagnosticsLabel}>Last Sync:</Text>
              <Text style={styles.diagnosticsValue}>
                {new Date(diagnostics.lastSyncTime).toLocaleTimeString()}
              </Text>
            </View>
          )}
          
          {diagnostics.lastSyncResult && (
            <View style={styles.diagnosticsRow}>
              <Text style={styles.diagnosticsLabel}>Sync Result:</Text>
              <Text style={styles.diagnosticsValue}>
                {diagnostics.lastSyncResult.synced} synced, {diagnostics.lastSyncResult.matched} matched
              </Text>
            </View>
          )}
          
          {diagnostics.lastSyncError && (
            <View style={styles.diagnosticsRow}>
              <Text style={styles.diagnosticsLabel}>Last Error:</Text>
              <Text style={[styles.diagnosticsValue, styles.diagnosticsError]}>
                {diagnostics.lastSyncError}
              </Text>
            </View>
          )}
          
          <TouchableOpacity
            style={styles.refreshDiagnosticsBtn}
            onPress={async () => {
              const diag = await runDiagnostics();
              setDiagnostics(diag);
              Alert.alert('Diagnostics Refreshed', 'Check the values above');
            }}
          >
            <Text style={styles.refreshDiagnosticsBtnText}>🔄 Refresh Diagnostics</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={{ height: 40 }} />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: 20,
    paddingTop: 50,
    backgroundColor: '#16a34a',
  },
  greeting: {
    color: '#dcfce7',
    fontSize: 14,
  },
  userName: {
    color: '#fff',
    fontSize: 24,
    fontWeight: 'bold',
  },
  userRole: {
    color: '#bbf7d0',
    fontSize: 14,
    marginTop: 4,
  },
  logoutBtn: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  logoutText: {
    color: '#fff',
    fontWeight: '600',
  },
  trophyCard: {
    flexDirection: 'row',
    backgroundColor: '#FFF8E1',
    marginHorizontal: 16,
    marginTop: -10,
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  trophyIconContainer: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#FFD54F',
    justifyContent: 'center',
    alignItems: 'center',
  },
  trophyIcon: {
    fontSize: 32,
  },
  trophyContent: {
    marginLeft: 16,
  },
  trophyValue: {
    fontSize: 36,
    fontWeight: 'bold',
    color: '#F57C00',
  },
  trophyLabel: {
    fontSize: 14,
    color: '#795548',
    textTransform: 'capitalize',
  },
  periodFilter: {
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  periodButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#fff',
    marginHorizontal: 4,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  periodButtonActive: {
    backgroundColor: '#16a34a',
    borderColor: '#16a34a',
  },
  periodButtonText: {
    fontSize: 13,
    color: '#374151',
    fontWeight: '500',
  },
  periodButtonTextActive: {
    color: '#fff',
  },
  quickStatsRow: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  quickStatCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 4,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  quickStatIcon: {
    fontSize: 20,
    marginBottom: 4,
  },
  quickStatValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#16a34a',
  },
  quickStatLabel: {
    fontSize: 11,
    color: '#6b7280',
    marginTop: 2,
  },
  section: {
    padding: 16,
    paddingTop: 8,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 12,
  },
  activityGrid: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
  },
  activityItem: {
    flex: 1,
    alignItems: 'center',
    padding: 8,
  },
  activityIcon: {
    fontSize: 18,
    marginBottom: 4,
  },
  activityValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#111827',
  },
  activityLabel: {
    fontSize: 10,
    color: '#6b7280',
    marginTop: 2,
  },
  statusGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  statusCard: {
    width: (width - 48) / 2,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    padding: 14,
    margin: 4,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 10,
  },
  statusLabel: {
    flex: 1,
    fontSize: 13,
    color: '#374151',
  },
  statusValue: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  outcomesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  outcomeCard: {
    width: (width - 48) / 2,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    padding: 14,
    margin: 4,
  },
  outcomeDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 10,
  },
  outcomeLabel: {
    flex: 1,
    fontSize: 12,
    color: '#374151',
  },
  outcomeValue: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  loginTimerCard: {
    backgroundColor: '#16a34a',
    borderRadius: 12,
    padding: 20,
  },
  loginTimerLabel: {
    fontSize: 12,
    color: '#dcfce7',
  },
  loginTimerValue: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#fff',
    marginVertical: 4,
  },
  loginTimerSubtext: {
    fontSize: 12,
    color: '#bbf7d0',
  },
  recordingToggle: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 12,
  },
  recordingLabel: {
    fontSize: 16,
    fontWeight: '500',
    color: '#374151',
  },
  recordingSubtext: {
    fontSize: 12,
    color: '#9ca3af',
    marginTop: 2,
  },
  syncButton: {
    backgroundColor: '#3b82f6',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  syncButtonDisabled: {
    backgroundColor: '#93c5fd',
  },
  syncButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  syncResult: {
    textAlign: 'center',
    color: '#6b7280',
    marginTop: 8,
    fontSize: 12,
  },
  syncResultError: {
    color: '#ef4444',
  },
  diagnosticsToggle: {
    backgroundColor: '#f3f4f6',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  diagnosticsToggleText: {
    color: '#6b7280',
    fontSize: 14,
  },
  diagnosticsSection: {
    backgroundColor: '#fff',
    marginHorizontal: 16,
    borderRadius: 12,
    padding: 16,
    borderWidth: 2,
    borderColor: '#e5e7eb',
    borderStyle: 'dashed',
  },
  diagnosticsTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 12,
  },
  diagnosticsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  diagnosticsLabel: {
    fontSize: 13,
    color: '#6b7280',
    flex: 1,
  },
  diagnosticsValue: {
    fontSize: 13,
    fontWeight: '600',
    color: '#111827',
    flex: 1,
    textAlign: 'right',
  },
  diagnosticsError: {
    color: '#ef4444',
    fontSize: 11,
  },
  refreshDiagnosticsBtn: {
    backgroundColor: '#f3f4f6',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 12,
  },
  refreshDiagnosticsBtnText: {
    color: '#374151',
    fontSize: 14,
    fontWeight: '500',
  },
});

export default DashboardScreen;
