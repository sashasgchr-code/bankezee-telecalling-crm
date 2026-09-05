import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl, TouchableOpacity, Dimensions } from 'react-native';
import { getTeamHourly } from '../services/api';

const { width } = Dimensions.get('window');

const toDateStr = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const ReportsScreen = ({ mobileRole }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [dayOffset, setDayOffset] = useState(0);

  const dateObj = new Date();
  dateObj.setDate(dateObj.getDate() + dayOffset);
  const date = toDateStr(dateObj);
  const isToday = dayOffset === 0;

  const load = useCallback(async () => {
    try {
      setLoading(true);
      // Role-scoped: Manager -> their GPs, TL -> their team.
      const res = await getTeamHourly(date);
      setData(res);
    } catch (e) {
      console.error('Reports load error', e?.message);
      setData(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [date]);

  useEffect(() => { load(); }, [load]);

  const onRefresh = () => { setRefreshing(true); load(); };

  const members = (data?.telecallers || [])
    .slice()
    .sort((a, b) => (b.total_calls || 0) - (a.total_calls || 0));
  const overall = members.reduce((a, m) => ({
    calls: a.calls + (m.total_calls || 0),
    connected: a.connected + (m.total_connected || 0),
    leads: a.leads + (m.total_leads || 0),
    file: a.file + (m.total_file || 0),
  }), { calls: 0, connected: 0, leads: 0, file: 0 });

  return (
    <ScrollView style={styles.container} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#16a34a']} />}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Team Reports</Text>
        <View style={styles.dateNav}>
          <TouchableOpacity onPress={() => setDayOffset(dayOffset - 1)} style={styles.navBtn}><Text style={styles.navBtnText}>‹</Text></TouchableOpacity>
          <Text style={styles.dateLabel}>{isToday ? `Today · ${date}` : date}</Text>
          <TouchableOpacity onPress={() => setDayOffset(Math.min(0, dayOffset + 1))} style={[styles.navBtn, isToday && styles.navDisabled]} disabled={isToday}><Text style={styles.navBtnText}>›</Text></TouchableOpacity>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Team Overview</Text>
        <View style={styles.statsGrid}>
          <View style={styles.statCard}><Text style={styles.statValue}>{overall.calls}</Text><Text style={styles.statLabel}>Total Calls</Text></View>
          <View style={styles.statCard}><Text style={styles.statValue}>{overall.connected}</Text><Text style={styles.statLabel}>Connected</Text></View>
          <View style={styles.statCard}><Text style={styles.statValue}>{overall.leads}</Text><Text style={styles.statLabel}>Leads</Text></View>
          <View style={styles.statCard}><Text style={styles.statValue}>{overall.file}</Text><Text style={styles.statLabel}>Files</Text></View>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Member Performance</Text>
        {loading ? (
          <Text style={styles.muted}>Loading…</Text>
        ) : members.length === 0 ? (
          <Text style={styles.muted}>No activity recorded for this day</Text>
        ) : members.map((m, idx) => (
          <View key={m.user_id} style={styles.memberCard} data-testid={`report-member-${m.user_id}`}>
            <View style={styles.tcHeader}>
              <View>
                <Text style={styles.tcRank}>#{idx + 1}</Text>
                <Text style={styles.tcName}>{m.user_name}</Text>
              </View>
              <View style={styles.tcMainStat}>
                <Text style={styles.tcMainValue}>{m.total_calls}</Text>
                <Text style={styles.tcMainLabel}>calls</Text>
              </View>
            </View>
            <View style={styles.tcStats}>
              <View style={styles.tcStatItem}><Text style={styles.tcStatValue}>{m.total_connected || 0}</Text><Text style={styles.tcStatLabel}>Connected</Text></View>
              <View style={styles.tcStatItem}><Text style={styles.tcStatValue}>{m.total_leads || 0}</Text><Text style={styles.tcStatLabel}>Leads</Text></View>
              <View style={styles.tcStatItem}><Text style={styles.tcStatValue}>{m.total_file || 0}</Text><Text style={styles.tcStatLabel}>Files</Text></View>
              <View style={styles.tcStatItem}><Text style={styles.tcStatValue}>{m.total_presentations || 0}</Text><Text style={styles.tcStatLabel}>Present.</Text></View>
            </View>
          </View>
        ))}
      </View>
      <View style={{ height: 40 }} />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  header: { padding: 20, paddingTop: 50, backgroundColor: '#fff' },
  headerTitle: { fontSize: 24, fontWeight: 'bold', color: '#111827' },
  dateNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },
  navBtn: { paddingHorizontal: 14, paddingVertical: 4, backgroundColor: '#f3f4f6', borderRadius: 8 },
  navDisabled: { opacity: 0.4 },
  navBtnText: { fontSize: 20, color: '#16a34a', fontWeight: '700' },
  dateLabel: { fontSize: 13, color: '#6b7280', fontWeight: '600' },
  section: { padding: 16 },
  sectionTitle: { fontSize: 18, fontWeight: '600', color: '#111827', marginBottom: 12 },
  muted: { color: '#9ca3af', fontSize: 14 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  statCard: { width: (width - 48) / 2, backgroundColor: '#fff', borderRadius: 12, padding: 16, margin: 4, alignItems: 'center' },
  statValue: { fontSize: 24, fontWeight: 'bold', color: '#16a34a' },
  statLabel: { fontSize: 12, color: '#6b7280', marginTop: 4 },
  memberCard: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 12 },
  tcHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 },
  tcRank: { fontSize: 12, color: '#9ca3af' },
  tcName: { fontSize: 16, fontWeight: '600', color: '#111827' },
  tcMainStat: { alignItems: 'flex-end' },
  tcMainValue: { fontSize: 28, fontWeight: 'bold', color: '#16a34a' },
  tcMainLabel: { fontSize: 12, color: '#6b7280' },
  tcStats: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#f3f4f6', paddingTop: 12 },
  tcStatItem: { flex: 1, alignItems: 'center' },
  tcStatValue: { fontSize: 16, fontWeight: '600', color: '#111827' },
  tcStatLabel: { fontSize: 10, color: '#9ca3af', marginTop: 2 },
});

export default ReportsScreen;
