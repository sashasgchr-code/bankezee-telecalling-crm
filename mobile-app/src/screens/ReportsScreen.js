import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
  Dimensions,
} from 'react-native';
import { getTelecallerReports, getRecordingsStats } from '../services/api';

const { width } = Dimensions.get('window');

const ReportsScreen = ({ user }) => {
  const [reports, setReports] = useState(null);
  const [recordingsStats, setRecordingsStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [period, setPeriod] = useState('today');
  const [activeTab, setActiveTab] = useState('summary'); // 'summary', 'recordings'

  const periods = [
    { id: 'today', name: 'Today' },
    { id: 'week', name: 'Week' },
    { id: 'month', name: 'Month' },
    { id: 'lifetime', name: 'All Time' },
  ];

  const loadReports = useCallback(async () => {
    try {
      const [reportsRes, recordingsRes] = await Promise.all([
        getTelecallerReports(period),
        getRecordingsStats(),
      ]);
      setReports(reportsRes);
      setRecordingsStats(recordingsRes);
    } catch (error) {
      console.error('Error loading reports:', error);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadReports();
    setRefreshing(false);
  };

  const formatTime = (seconds) => {
    if (!seconds) return '0m';
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
  };

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Reports</Text>
      </View>

      {/* Tab Switcher */}
      <View style={styles.tabSwitcher}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'summary' && styles.tabActive]}
          onPress={() => setActiveTab('summary')}
        >
          <Text style={[styles.tabText, activeTab === 'summary' && styles.tabTextActive]}>
            📊 Summary
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'recordings' && styles.tabActive]}
          onPress={() => setActiveTab('recordings')}
        >
          <Text style={[styles.tabText, activeTab === 'recordings' && styles.tabTextActive]}>
            🎙️ Recordings
          </Text>
        </TouchableOpacity>
      </View>

      {activeTab === 'summary' && (
        <>
          {/* Period Filter */}
          <View style={styles.periodFilter}>
            {periods.map(p => (
              <TouchableOpacity
                key={p.id}
                style={[styles.periodBtn, period === p.id && styles.periodBtnActive]}
                onPress={() => setPeriod(p.id)}
              >
                <Text style={[styles.periodBtnText, period === p.id && styles.periodBtnTextActive]}>
                  {p.name}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Overall Stats */}
          {reports?.overall && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Team Overview</Text>
              <View style={styles.statsGrid}>
                <View style={styles.statCard}>
                  <Text style={styles.statValue}>{reports.overall.total_calls || 0}</Text>
                  <Text style={styles.statLabel}>Total Calls</Text>
                </View>
                <View style={styles.statCard}>
                  <Text style={styles.statValue}>{reports.overall.total_leads_generated || 0}</Text>
                  <Text style={styles.statLabel}>Leads</Text>
                </View>
                <View style={styles.statCard}>
                  <Text style={styles.statValue}>{reports.overall.total_file || 0}</Text>
                  <Text style={styles.statLabel}>Files</Text>
                </View>
                <View style={styles.statCard}>
                  <Text style={styles.statValue}>{formatTime(reports.overall.total_call_seconds)}</Text>
                  <Text style={styles.statLabel}>Talk Time</Text>
                </View>
              </View>
            </View>
          )}

          {/* Telecaller Performance */}
          {reports?.telecallers && reports.telecallers.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Telecaller Performance</Text>
              {reports.telecallers.map((tc, index) => (
                <View key={tc.user_id} style={styles.telecallerCard}>
                  <View style={styles.tcHeader}>
                    <View>
                      <Text style={styles.tcRank}>#{index + 1}</Text>
                      <Text style={styles.tcName}>{tc.user_name}</Text>
                    </View>
                    <View style={styles.tcMainStat}>
                      <Text style={styles.tcMainValue}>{tc.total_calls}</Text>
                      <Text style={styles.tcMainLabel}>calls</Text>
                    </View>
                  </View>
                  
                  <View style={styles.tcStats}>
                    <View style={styles.tcStatItem}>
                      <Text style={styles.tcStatValue}>{tc.calls_connected || 0}</Text>
                      <Text style={styles.tcStatLabel}>Connected</Text>
                    </View>
                    <View style={styles.tcStatItem}>
                      <Text style={styles.tcStatValue}>{tc.leads_generated || 0}</Text>
                      <Text style={styles.tcStatLabel}>Leads</Text>
                    </View>
                    <View style={styles.tcStatItem}>
                      <Text style={styles.tcStatValue}>{tc.file || 0}</Text>
                      <Text style={styles.tcStatLabel}>Files</Text>
                    </View>
                    <View style={styles.tcStatItem}>
                      <Text style={styles.tcStatValue}>{formatTime(tc.total_call_seconds)}</Text>
                      <Text style={styles.tcStatLabel}>Talk Time</Text>
                    </View>
                  </View>
                  
                  {/* Call Outcomes */}
                  <View style={styles.outcomesRow}>
                    <View style={[styles.outcomeChip, { backgroundColor: '#dcfce7' }]}>
                      <Text style={[styles.outcomeText, { color: '#16a34a' }]}>
                        ✓ {tc.calls_connected || 0}
                      </Text>
                    </View>
                    <View style={[styles.outcomeChip, { backgroundColor: '#fee2e2' }]}>
                      <Text style={[styles.outcomeText, { color: '#ef4444' }]}>
                        ✗ {tc.calls_no_answer || 0}
                      </Text>
                    </View>
                    <View style={[styles.outcomeChip, { backgroundColor: '#fef3c7' }]}>
                      <Text style={[styles.outcomeText, { color: '#f59e0b' }]}>
                        📵 {tc.calls_busy || 0}
                      </Text>
                    </View>
                  </View>
                </View>
              ))}
            </View>
          )}
        </>
      )}

      {activeTab === 'recordings' && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Recording Statistics (Today)</Text>
          
          {recordingsStats?.overall && (
            <View style={styles.recordingsOverview}>
              <View style={styles.recordingStatCard}>
                <Text style={styles.recordingStatValue}>
                  {recordingsStats.overall.total_recordings || 0}
                </Text>
                <Text style={styles.recordingStatLabel}>Total Recordings</Text>
              </View>
              <View style={styles.recordingStatCard}>
                <Text style={styles.recordingStatValue}>
                  {recordingsStats.overall.total_duration_formatted || '0m'}
                </Text>
                <Text style={styles.recordingStatLabel}>Total Duration</Text>
              </View>
              <View style={styles.recordingStatCard}>
                <Text style={styles.recordingStatValue}>
                  {recordingsStats.overall.total_size_mb || 0} MB
                </Text>
                <Text style={styles.recordingStatLabel}>Storage Used</Text>
              </View>
            </View>
          )}

          {recordingsStats?.by_user && recordingsStats.by_user.length > 0 ? (
            <View style={styles.recordingsByUser}>
              <Text style={styles.subSectionTitle}>By Telecaller</Text>
              {recordingsStats.by_user.map(u => (
                <View key={u.user_id} style={styles.recordingUserCard}>
                  <View>
                    <Text style={styles.recordingUserName}>{u.user_name}</Text>
                    <Text style={styles.recordingUserCount}>
                      {u.total_recordings} recordings
                    </Text>
                  </View>
                  <View style={styles.recordingUserStats}>
                    <Text style={styles.recordingUserDuration}>
                      {u.total_duration_formatted}
                    </Text>
                    <Text style={styles.recordingUserSize}>{u.total_size_mb} MB</Text>
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <View style={styles.emptyRecordings}>
              <Text style={styles.emptyIcon}>🎙️</Text>
              <Text style={styles.emptyText}>No recordings today</Text>
              <Text style={styles.emptySubtext}>
                Recordings will appear here when telecallers use the mobile app with recording enabled
              </Text>
            </View>
          )}
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
    padding: 20,
    paddingTop: 50,
    backgroundColor: '#fff',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#111827',
  },
  tabSwitcher: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 8,
    marginHorizontal: 4,
  },
  tabActive: {
    backgroundColor: '#16a34a',
  },
  tabText: {
    fontSize: 14,
    color: '#6b7280',
    fontWeight: '500',
  },
  tabTextActive: {
    color: '#fff',
  },
  periodFilter: {
    flexDirection: 'row',
    padding: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  periodBtn: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 8,
    marginHorizontal: 4,
    backgroundColor: '#f3f4f6',
  },
  periodBtnActive: {
    backgroundColor: '#16a34a',
  },
  periodBtnText: {
    fontSize: 13,
    color: '#374151',
    fontWeight: '500',
  },
  periodBtnTextActive: {
    color: '#fff',
  },
  section: {
    padding: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 12,
  },
  subSectionTitle: {
    fontSize: 14,
    fontWeight: '500',
    color: '#6b7280',
    marginBottom: 8,
    marginTop: 16,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  statCard: {
    width: (width - 48) / 2,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    margin: 4,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#16a34a',
  },
  statLabel: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 4,
  },
  telecallerCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  tcHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  tcRank: {
    fontSize: 12,
    color: '#9ca3af',
  },
  tcName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
  },
  tcMainStat: {
    alignItems: 'flex-end',
  },
  tcMainValue: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#16a34a',
  },
  tcMainLabel: {
    fontSize: 12,
    color: '#6b7280',
  },
  tcStats: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: '#f3f4f6',
    paddingTop: 12,
  },
  tcStatItem: {
    flex: 1,
    alignItems: 'center',
  },
  tcStatValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
  },
  tcStatLabel: {
    fontSize: 10,
    color: '#9ca3af',
    marginTop: 2,
  },
  outcomesRow: {
    flexDirection: 'row',
    marginTop: 12,
    gap: 8,
  },
  outcomeChip: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  outcomeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  recordingsOverview: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  recordingStatCard: {
    width: (width - 48) / 3,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    margin: 4,
    alignItems: 'center',
  },
  recordingStatValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#8b5cf6',
  },
  recordingStatLabel: {
    fontSize: 10,
    color: '#6b7280',
    marginTop: 4,
    textAlign: 'center',
  },
  recordingsByUser: {
    marginTop: 8,
  },
  recordingUserCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  recordingUserName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
  },
  recordingUserCount: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 2,
  },
  recordingUserStats: {
    alignItems: 'flex-end',
  },
  recordingUserDuration: {
    fontSize: 16,
    fontWeight: '600',
    color: '#8b5cf6',
  },
  recordingUserSize: {
    fontSize: 12,
    color: '#9ca3af',
  },
  emptyRecordings: {
    alignItems: 'center',
    paddingVertical: 40,
    backgroundColor: '#fff',
    borderRadius: 12,
    marginTop: 8,
  },
  emptyIcon: {
    fontSize: 48,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#374151',
    marginTop: 12,
  },
  emptySubtext: {
    fontSize: 12,
    color: '#9ca3af',
    marginTop: 4,
    textAlign: 'center',
    paddingHorizontal: 32,
  },
});

export default ReportsScreen;
