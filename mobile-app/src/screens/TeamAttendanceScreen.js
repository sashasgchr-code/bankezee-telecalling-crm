import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity, ActivityIndicator, RefreshControl } from 'react-native';
import { getTeamAttendanceToday } from '../services/api';

const toDateStr = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const statusStyle = (rec) => {
  if (rec.work_mode === 'wfh') return { bg: '#dbeafe', fg: '#1d4ed8', label: 'WFH' };
  const s = rec.attendance_status;
  if (s === 'PRESENT') return { bg: '#dcfce7', fg: '#15803d', label: 'Present' };
  if (s === 'LATE') return { bg: '#fef9c3', fg: '#a16207', label: 'Late' };
  if (s === 'ON_LEAVE' || s === 'LEAVE') return { bg: '#fef3c7', fg: '#b45309', label: 'Leave' };
  return { bg: '#fee2e2', fg: '#b91c1c', label: 'Absent' };
};

const TeamAttendanceScreen = ({ navigation }) => {
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
      const res = await getTeamAttendanceToday(date);
      setData(res);
    } catch (e) {
      console.error('Team attendance error', e?.message);
      setData(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [date]);

  useEffect(() => { load(); }, [load]);

  const onRefresh = () => { setRefreshing(true); load(); };

  const summary = data?.summary || {};
  const records = data?.records || [];

  const renderRow = ({ item }) => {
    const st = statusStyle(item);
    return (
      <View style={styles.card} data-testid={`team-att-${item.user_id}`}>
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>{item.name}</Text>
          <Text style={styles.role}>{item.role}</Text>
        </View>
        <View style={styles.times}>
          <Text style={styles.timeText}>In: {item.check_in_time_ist || '—'}</Text>
          <Text style={styles.timeText}>Out: {item.check_out_time_ist || '—'}</Text>
        </View>
        <View style={[styles.badge, { backgroundColor: st.bg }]}>
          <Text style={[styles.badgeText, { color: st.fg }]}>{st.label}</Text>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        {navigation && (
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} data-testid="team-att-back">
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>
        )}
        <Text style={styles.title}>Team Attendance</Text>
        <View style={styles.dateNav}>
          <TouchableOpacity onPress={() => setDayOffset(dayOffset - 1)} style={styles.navBtn}><Text style={styles.navBtnText}>‹</Text></TouchableOpacity>
          <Text style={styles.dateLabel}>{isToday ? `Today · ${date}` : date}</Text>
          <TouchableOpacity onPress={() => setDayOffset(Math.min(0, dayOffset + 1))} style={[styles.navBtn, isToday && styles.navDisabled]} disabled={isToday}><Text style={styles.navBtnText}>›</Text></TouchableOpacity>
        </View>
      </View>

      <View style={styles.summaryRow}>
        <Sm v={summary.present} l="Present" c="#15803d" />
        <Sm v={summary.wfh} l="WFH" c="#1d4ed8" />
        <Sm v={summary.leave} l="Leave" c="#b45309" />
        <Sm v={summary.absent} l="Absent" c="#b91c1c" />
      </View>

      {loading ? (
        <ActivityIndicator color="#16a34a" style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={records}
          keyExtractor={(item, i) => `${item.user_id || i}`}
          renderItem={renderRow}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#16a34a']} />}
          ListEmptyComponent={<Text style={styles.empty}>No team members found</Text>}
        />
      )}
    </View>
  );
};

const Sm = ({ v, l, c }) => (
  <View style={styles.smCard}>
    <Text style={[styles.smValue, { color: c }]}>{v || 0}</Text>
    <Text style={styles.smLabel}>{l}</Text>
  </View>
);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  header: { paddingHorizontal: 16, paddingTop: 50, paddingBottom: 10, backgroundColor: '#fff' },
  backBtn: { marginBottom: 6 },
  backText: { fontSize: 15, color: '#16a34a', fontWeight: '600' },
  title: { fontSize: 22, fontWeight: '700', color: '#111827' },
  dateNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  navBtn: { paddingHorizontal: 14, paddingVertical: 4, backgroundColor: '#f3f4f6', borderRadius: 8 },
  navDisabled: { opacity: 0.4 },
  navBtnText: { fontSize: 20, color: '#16a34a', fontWeight: '700' },
  dateLabel: { fontSize: 13, color: '#6b7280', fontWeight: '600' },
  summaryRow: { flexDirection: 'row', gap: 8, padding: 12 },
  smCard: { flex: 1, backgroundColor: '#fff', borderRadius: 10, paddingVertical: 12, alignItems: 'center', borderWidth: 1, borderColor: '#e5e7eb' },
  smValue: { fontSize: 18, fontWeight: '700' },
  smLabel: { fontSize: 11, color: '#6b7280', marginTop: 2 },
  list: { paddingHorizontal: 12, paddingBottom: 30 },
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: '#e5e7eb' },
  name: { fontSize: 14, fontWeight: '600', color: '#111827' },
  role: { fontSize: 11, color: '#9ca3af', marginTop: 1 },
  times: { marginRight: 10 },
  timeText: { fontSize: 11, color: '#6b7280' },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, minWidth: 62, alignItems: 'center' },
  badgeText: { fontSize: 11, fontWeight: '700' },
  empty: { textAlign: 'center', color: '#9ca3af', marginTop: 40, fontSize: 14 },
});

export default TeamAttendanceScreen;
