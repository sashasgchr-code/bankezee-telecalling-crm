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
} from 'react-native';
import { getMyStats, getDashboardStats, pingActivity, logout as apiLogout } from '../services/api';
import { syncCallLogsWithBackend, requestCallLogPermission } from '../services/callLogService';
import {
  requestRecordingPermissions,
  getRecordingEnabled,
  setRecordingEnabled,
} from '../services/recordingService';

const DashboardScreen = ({ user, onLogout }) => {
  const [stats, setStats] = useState(null);
  const [adminStats, setAdminStats] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loginDuration, setLoginDuration] = useState(0);
  const [recordingEnabled, setRecordingEnabledState] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncResult, setLastSyncResult] = useState(null);

  const isAdmin = user?.role === 'admin';

  // Format seconds to readable time
  const formatTime = (seconds) => {
    if (!seconds || seconds < 0) return '0m 0s';
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    if (hours > 0) {
      return `${hours}h ${mins}m`;
    }
    return `${mins}m ${secs}s`;
  };

  // Load stats
  const loadStats = useCallback(async () => {
    try {
      if (isAdmin) {
        const [myStatsRes, dashStatsRes] = await Promise.all([
          getMyStats(),
          getDashboardStats('today'),
        ]);
        setStats(myStatsRes);
        setAdminStats(dashStatsRes);
      } else {
        const myStatsRes = await getMyStats();
        setStats(myStatsRes);
      }
    } catch (error) {
      console.error('Error loading stats:', error);
    }
  }, [isAdmin]);

  // Load recording settings
  const loadRecordingSettings = async () => {
    const enabled = await getRecordingEnabled();
    setRecordingEnabledState(enabled);
  };

  // Initial load
  useEffect(() => {
    loadStats();
    loadRecordingSettings();
    requestCallLogPermission();

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
    if (stats?.login_time) {
      const loginTime = new Date(stats.login_time).getTime();
      
      const updateDuration = () => {
        const now = Date.now();
        const duration = Math.floor((now - loginTime) / 1000);
        setLoginDuration(duration);
      };

      updateDuration();
      const interval = setInterval(updateDuration, 1000);
      return () => clearInterval(interval);
    }
  }, [stats?.login_time]);

  // Handle refresh
  const onRefresh = async () => {
    setRefreshing(true);
    await loadStats();
    setRefreshing(false);
  };

  // Handle sync
  const handleSync = async () => {
    setSyncing(true);
    try {
      const result = await syncCallLogsWithBackend();
      setLastSyncResult(result);
      if (result.synced > 0) {
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

      {/* Real-time Stats Cards */}
      <View style={styles.statsGrid}>
        <View style={[styles.statCard, styles.primaryCard]}>
          <Text style={styles.statLabel}>Login Time</Text>
          <Text style={styles.statValueLarge}>{formatTime(loginDuration)}</Text>
          <Text style={styles.statSubtext}>Real-time ⏱️</Text>
        </View>
        
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>Talk Time</Text>
          <Text style={styles.statValue}>{formatTime(stats?.total_call_seconds || 0)}</Text>
        </View>
        
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>Calls Made</Text>
          <Text style={styles.statValue}>{stats?.calls_made || 0}</Text>
        </View>
        
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>Leads Updated</Text>
          <Text style={styles.statValue}>{stats?.leads_updated || 0}</Text>
        </View>
      </View>

      {/* Admin Stats */}
      {isAdmin && adminStats && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Team Overview (Today)</Text>
          <View style={styles.statsGrid}>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>Total Data</Text>
              <Text style={styles.statValue}>{adminStats.total_data || 0}</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>Connected</Text>
              <Text style={styles.statValue}>{adminStats.connected || 0}</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>Leads</Text>
              <Text style={styles.statValue}>{adminStats.total_leads_generated || 0}</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>Files</Text>
              <Text style={styles.statValue}>{adminStats.total_file || 0}</Text>
            </View>
          </View>
        </View>
      )}

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
          <Text style={styles.syncResult}>
            Last sync: {lastSyncResult.synced} calls, {lastSyncResult.matched} matched
          </Text>
        )}
      </View>

      {/* Call Outcomes (Telecaller) */}
      {!isAdmin && stats?.call_outcomes && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Call Outcomes (Today)</Text>
          <View style={styles.outcomesGrid}>
            {Object.entries(stats.call_outcomes).map(([key, value]) => (
              <View key={key} style={styles.outcomeItem}>
                <Text style={styles.outcomeValue}>{value}</Text>
                <Text style={styles.outcomeLabel}>{key.replace('_', ' ')}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Status Breakdown */}
      {stats?.leads_by_status && Object.keys(stats.leads_by_status).length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Leads by Status</Text>
          <View style={styles.statusGrid}>
            {Object.entries(stats.leads_by_status).map(([status, count]) => (
              <View key={status} style={[styles.statusItem, styles[`status_${status}`]]}>
                <Text style={styles.statusCount}>{count}</Text>
                <Text style={styles.statusLabel}>{status}</Text>
              </View>
            ))}
          </View>
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
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 10,
    marginTop: -20,
  },
  statCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    margin: 6,
    flex: 1,
    minWidth: '45%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  primaryCard: {
    backgroundColor: '#16a34a',
    minWidth: '95%',
  },
  statLabel: {
    fontSize: 12,
    color: '#6b7280',
    marginBottom: 4,
  },
  statValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#111827',
  },
  statValueLarge: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#fff',
  },
  statSubtext: {
    fontSize: 12,
    color: '#dcfce7',
    marginTop: 4,
  },
  section: {
    padding: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 12,
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
  outcomesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
  },
  outcomeItem: {
    width: '33%',
    alignItems: 'center',
    padding: 8,
  },
  outcomeValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#111827',
  },
  outcomeLabel: {
    fontSize: 10,
    color: '#6b7280',
    textTransform: 'capitalize',
  },
  statusGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  statusItem: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 12,
    margin: 4,
    minWidth: '30%',
    alignItems: 'center',
  },
  statusCount: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#111827',
  },
  statusLabel: {
    fontSize: 10,
    color: '#6b7280',
    textTransform: 'capitalize',
    marginTop: 2,
  },
  status_new: { borderLeftWidth: 3, borderLeftColor: '#3b82f6' },
  status_follow_up: { borderLeftWidth: 3, borderLeftColor: '#8b5cf6' },
  status_not_interested: { borderLeftWidth: 3, borderLeftColor: '#6b7280' },
  status_presentation: { borderLeftWidth: 3, borderLeftColor: '#f59e0b' },
  status_leads: { borderLeftWidth: 3, borderLeftColor: '#22c55e' },
  status_file: { borderLeftWidth: 3, borderLeftColor: '#ef4444' },
});

export default DashboardScreen;
