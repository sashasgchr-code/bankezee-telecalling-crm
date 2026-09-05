import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator, RefreshControl, Alert } from 'react-native';
import * as Location from 'expo-location';
import { getTodayAttendance, checkIn, checkOut, getMyMonthlyMatrix } from '../services/api';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

const codeStyle = (code) => {
  const base = (code || '').split(' ')[0];
  if (base.startsWith('L')) return { bg: '#ffedd5', fg: '#c2410c' };
  const map = {
    P: { bg: '#dcfce7', fg: '#15803d' },
    W: { bg: '#dbeafe', fg: '#1d4ed8' },
    A: { bg: '#fef3c7', fg: '#b45309' },
    U: { bg: '#fee2e2', fg: '#b91c1c' },
    '-': { bg: '#f3f4f6', fg: '#9ca3af' },
  };
  return map[base] || { bg: '#f9fafb', fg: '#d1d5db' };
};

const AttendanceScreen = ({ navigation }) => {
  const now = new Date();
  const [today, setToday] = useState(null);
  const [matrix, setMatrix] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [t, m] = await Promise.all([
        getTodayAttendance().catch(() => null),
        getMyMonthlyMatrix(month, year).catch(() => null),
      ]);
      setToday(t);
      setMatrix(m);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [month, year]);

  useEffect(() => { load(); }, [load]);

  const onRefresh = () => { setRefreshing(true); load(); };

  const getLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return {};
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      return { latitude: loc.coords.latitude, longitude: loc.coords.longitude, accuracy: loc.coords.accuracy };
    } catch {
      return {};
    }
  };

  const doCheckIn = async () => {
    setBusy(true);
    try {
      const loc = await getLocation();
      await checkIn({ platform: 'android', ...loc });
      Alert.alert('✅ Checked In', 'Your check-in has been recorded.');
      load();
    } catch (e) {
      Alert.alert('Check-In Failed', e.response?.data?.detail || e.message || 'Failed to check in');
    } finally {
      setBusy(false);
    }
  };

  const doCheckOut = async () => {
    Alert.alert('Confirm Check-Out', 'Check out for the day?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Check Out',
        onPress: async () => {
          setBusy(true);
          try {
            const loc = await getLocation();
            await checkOut({ platform: 'android', ...loc });
            Alert.alert('✅ Checked Out', 'Your check-out has been recorded.');
            load();
          } catch (e) {
            Alert.alert('Check-Out Failed', e.response?.data?.detail || e.message || 'Failed to check out');
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  };

  const prevMonth = () => {
    if (month === 1) { setMonth(12); setYear(year - 1); } else { setMonth(month - 1); }
  };
  const nextMonth = () => {
    if (year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth() + 1)) {
      if (month === 12) { setMonth(1); setYear(year + 1); } else { setMonth(month + 1); }
    }
  };

  const summary = matrix?.summary || {};
  const daysInMonth = matrix?.days_in_month || new Date(year, month, 0).getDate();
  const firstDow = new Date(year, month - 1, 1).getDay();

  const statusBadge = today?.attendance_status === 'PRESENT' ? { bg: '#dcfce7', fg: '#15803d' }
    : today?.attendance_status === 'LATE' ? { bg: '#ffedd5', fg: '#c2410c' }
    : { bg: '#f3f4f6', fg: '#6b7280' };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        {navigation && (
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} data-testid="attendance-back">
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>
        )}
        <Text style={styles.title}>My Attendance</Text>
        <Text style={styles.sub}>{today?.attendance_date || new Date().toLocaleDateString()}</Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#16a34a']} />}
      >
        {loading ? (
          <ActivityIndicator color="#16a34a" style={{ marginTop: 40 }} />
        ) : (
          <>
            {/* Today status */}
            <View style={styles.card} data-testid="attendance-today-card">
              <View style={styles.rowBetween}>
                <Text style={styles.cardTitle}>🕐 Today's Status</Text>
                <View style={[styles.badge, { backgroundColor: statusBadge.bg }]}>
                  <Text style={[styles.badgeText, { color: statusBadge.fg }]}>{today?.attendance_status || 'Not Marked'}</Text>
                </View>
              </View>
              <View style={styles.timeRow}>
                <View style={styles.timeBox}>
                  <Text style={styles.timeLabel}>Check In</Text>
                  <Text style={styles.timeValue}>{today?.check_in_time_ist || '-'}</Text>
                </View>
                <View style={styles.timeBox}>
                  <Text style={styles.timeLabel}>Check Out</Text>
                  <Text style={styles.timeValue}>{today?.check_out_time_ist || '-'}</Text>
                </View>
              </View>
              {!today?.checked_in ? (
                <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#16a34a' }]} onPress={doCheckIn} disabled={busy} data-testid="attendance-check-in-btn">
                  <Text style={styles.actionBtnText}>{busy ? 'Please wait...' : '✓ Check In'}</Text>
                </TouchableOpacity>
              ) : !today?.checked_out ? (
                <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#dc2626' }]} onPress={doCheckOut} disabled={busy} data-testid="attendance-check-out-btn">
                  <Text style={styles.actionBtnText}>{busy ? 'Please wait...' : '✕ Check Out'}</Text>
                </TouchableOpacity>
              ) : (
                <View style={styles.doneBox}><Text style={styles.doneText}>Attendance Completed for Today</Text></View>
              )}
              {today?.working_minutes > 0 && (
                <Text style={styles.workTime}>Working Time: {Math.floor(today.working_minutes / 60)}h {today.working_minutes % 60}m</Text>
              )}
            </View>

            {/* Monthly matrix */}
            <View style={styles.card} data-testid="attendance-monthly-matrix">
              <View style={styles.rowBetween}>
                <Text style={styles.cardTitle}>📅 {MONTHS[month - 1]} {year}</Text>
                <View style={styles.monthNav}>
                  <TouchableOpacity onPress={prevMonth} style={styles.navBtn}><Text style={styles.navBtnText}>‹</Text></TouchableOpacity>
                  <TouchableOpacity onPress={nextMonth} style={styles.navBtn}><Text style={styles.navBtnText}>›</Text></TouchableOpacity>
                </View>
              </View>

              <View style={styles.summaryRow}>
                <Summary v={summary.present} l="Present" bg="#dcfce7" fg="#15803d" />
                <Summary v={summary.late} l="Late" bg="#ffedd5" fg="#c2410c" />
                <Summary v={summary.wfh} l="WFH" bg="#dbeafe" fg="#1d4ed8" />
                <Summary v={summary.leave} l="Leave" bg="#fef3c7" fg="#b45309" />
                <Summary v={summary.absent} l="Absent" bg="#fee2e2" fg="#b91c1c" />
              </View>

              <View style={styles.calGrid}>
                {DOW.map((d, i) => (
                  <View key={`dow-${i}`} style={styles.cell}><Text style={styles.dowText}>{d}</Text></View>
                ))}
                {Array.from({ length: firstDow }).map((_, i) => <View key={`e-${i}`} style={styles.cell} />)}
                {Array.from({ length: daysInMonth }).map((_, i) => {
                  const day = i + 1;
                  const dd = matrix?.days?.[day] || matrix?.days?.[String(day)];
                  const code = dd?.code || '';
                  const display = code.startsWith('L') ? 'L' : code;
                  const cs = codeStyle(code);
                  return (
                    <View key={day} style={styles.cell}>
                      <View style={[styles.dayBox, { backgroundColor: cs.bg }]}>
                        <Text style={[styles.dayNum, { color: cs.fg }]}>{day}</Text>
                        <Text style={[styles.dayCode, { color: cs.fg }]}>{display}</Text>
                      </View>
                    </View>
                  );
                })}
              </View>

              <Text style={styles.pct}>{summary.attendance_percentage || 0}%</Text>
              <Text style={styles.pctLabel}>Attendance Rate</Text>
            </View>
          </>
        )}
        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
};

const Summary = ({ v, l, bg, fg }) => (
  <View style={[styles.summaryCard, { backgroundColor: bg }]}>
    <Text style={[styles.summaryValue, { color: fg }]}>{v || 0}</Text>
    <Text style={styles.summaryLabel}>{l}</Text>
  </View>
);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  header: { paddingHorizontal: 16, paddingTop: 50, paddingBottom: 12, backgroundColor: '#fff' },
  backBtn: { marginBottom: 6 },
  backText: { fontSize: 15, color: '#16a34a', fontWeight: '600' },
  title: { fontSize: 22, fontWeight: '700', color: '#111827' },
  sub: { fontSize: 13, color: '#6b7280', marginTop: 2 },
  body: { padding: 12 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: '#e5e7eb' },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { fontSize: 16, fontWeight: '700', color: '#111827' },
  badge: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 20 },
  badgeText: { fontSize: 12, fontWeight: '700' },
  timeRow: { flexDirection: 'row', gap: 12, marginTop: 14 },
  timeBox: { flex: 1, backgroundColor: '#f9fafb', borderRadius: 8, padding: 12 },
  timeLabel: { fontSize: 12, color: '#6b7280' },
  timeValue: { fontSize: 16, fontWeight: '700', color: '#111827', marginTop: 2 },
  actionBtn: { marginTop: 14, paddingVertical: 14, borderRadius: 10, alignItems: 'center' },
  actionBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  doneBox: { marginTop: 14, paddingVertical: 14, borderRadius: 10, backgroundColor: '#f3f4f6', alignItems: 'center' },
  doneText: { color: '#6b7280', fontWeight: '600' },
  workTime: { textAlign: 'center', marginTop: 12, color: '#16a34a', fontWeight: '700', fontSize: 15 },
  monthNav: { flexDirection: 'row', gap: 8 },
  navBtn: { paddingHorizontal: 12, paddingVertical: 2, backgroundColor: '#f3f4f6', borderRadius: 8 },
  navBtnText: { fontSize: 20, color: '#16a34a', fontWeight: '700' },
  summaryRow: { flexDirection: 'row', gap: 6, marginTop: 14, marginBottom: 12 },
  summaryCard: { flex: 1, borderRadius: 8, paddingVertical: 8, alignItems: 'center' },
  summaryValue: { fontSize: 16, fontWeight: '700' },
  summaryLabel: { fontSize: 10, color: '#4b5563', marginTop: 2 },
  calGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, alignItems: 'center', paddingVertical: 2 },
  dowText: { fontSize: 11, color: '#9ca3af', fontWeight: '600', paddingVertical: 4 },
  dayBox: { width: 38, height: 38, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  dayNum: { fontSize: 12, fontWeight: '600' },
  dayCode: { fontSize: 9 },
  pct: { textAlign: 'center', fontSize: 26, fontWeight: '700', color: '#16a34a', marginTop: 14 },
  pctLabel: { textAlign: 'center', fontSize: 13, color: '#6b7280' },
});

export default AttendanceScreen;
