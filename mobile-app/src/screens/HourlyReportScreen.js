import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, TouchableOpacity, RefreshControl } from 'react-native';
import { getMyHourlyReport } from '../services/api';

const toDateStr = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const HourlyReportScreen = ({ navigation }) => {
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
      const res = await getMyHourlyReport(date);
      setData(res);
    } catch (e) {
      console.error('Hourly report error', e?.message);
      setData(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [date]);

  useEffect(() => { load(); }, [load]);

  const onRefresh = () => { setRefreshing(true); load(); };

  const totals = data || {};
  const rows = data?.hourly_breakdown || [];

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        {navigation && (
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} data-testid="hourly-back">
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>
        )}
        <Text style={styles.title}>My Hourly Report</Text>
        <View style={styles.dateNav}>
          <TouchableOpacity onPress={() => setDayOffset(dayOffset - 1)} style={styles.navBtn} data-testid="hourly-prev-day">
            <Text style={styles.navBtnText}>‹</Text>
          </TouchableOpacity>
          <Text style={styles.dateLabel}>{isToday ? `Today · ${date}` : date}</Text>
          <TouchableOpacity
            onPress={() => setDayOffset(Math.min(0, dayOffset + 1))}
            style={[styles.navBtn, isToday && styles.navBtnDisabled]}
            disabled={isToday}
            data-testid="hourly-next-day"
          >
            <Text style={styles.navBtnText}>›</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#16a34a']} />}
      >
        {/* Totals */}
        <View style={styles.totalsRow}>
          <View style={styles.totalCard}><Text style={styles.totalValue}>{totals.total_calls || 0}</Text><Text style={styles.totalLabel}>Calls</Text></View>
          <View style={styles.totalCard}><Text style={styles.totalValue}>{totals.total_connected || 0}</Text><Text style={styles.totalLabel}>Connected</Text></View>
          <View style={styles.totalCard}><Text style={styles.totalValue}>{totals.total_leads || 0}</Text><Text style={styles.totalLabel}>Leads</Text></View>
          <View style={styles.totalCard}><Text style={styles.totalValue}>{totals.total_file || 0}</Text><Text style={styles.totalLabel}>Files</Text></View>
        </View>

        {/* Table */}
        <View style={styles.table}>
          <View style={styles.tableHeadRow}>
            <Text style={[styles.th, styles.colHour]}>Hour</Text>
            <Text style={[styles.th, styles.colNum]}>C</Text>
            <Text style={[styles.th, styles.colNum]}>CO</Text>
            <Text style={[styles.th, styles.colNum]}>L</Text>
            <Text style={[styles.th, styles.colNum]}>F</Text>
          </View>
          {loading ? (
            <ActivityIndicator color="#16a34a" style={{ margin: 20 }} />
          ) : rows.length === 0 ? (
            <Text style={styles.empty}>No activity recorded for this day</Text>
          ) : (
            rows.map((r) => (
              <View key={r.hour} style={styles.tableRow} data-testid={`hourly-row-${r.hour}`}>
                <Text style={[styles.td, styles.colHour, styles.hourText]}>{r.hour_label}</Text>
                <Text style={[styles.td, styles.colNum]}>{r.calls}</Text>
                <Text style={[styles.td, styles.colNum, { color: '#16a34a' }]}>{r.connected}</Text>
                <Text style={[styles.td, styles.colNum, { color: '#2563eb' }]}>{r.leads}</Text>
                <Text style={[styles.td, styles.colNum, { color: '#d97706' }]}>{r.file}</Text>
              </View>
            ))
          )}
        </View>
        <Text style={styles.legend}>C = Calls · CO = Connected · L = Leads · F = Files</Text>
        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  header: { paddingHorizontal: 16, paddingTop: 50, paddingBottom: 10, backgroundColor: '#fff' },
  backBtn: { marginBottom: 6 },
  backText: { fontSize: 15, color: '#16a34a', fontWeight: '600' },
  title: { fontSize: 22, fontWeight: '700', color: '#111827' },
  dateNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  navBtn: { paddingHorizontal: 14, paddingVertical: 4, backgroundColor: '#f3f4f6', borderRadius: 8 },
  navBtnDisabled: { opacity: 0.4 },
  navBtnText: { fontSize: 20, color: '#16a34a', fontWeight: '700' },
  dateLabel: { fontSize: 13, color: '#6b7280', fontWeight: '600' },
  body: { padding: 12 },
  totalsRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  totalCard: { flex: 1, backgroundColor: '#fff', borderRadius: 10, paddingVertical: 14, alignItems: 'center', borderWidth: 1, borderColor: '#e5e7eb' },
  totalValue: { fontSize: 20, fontWeight: '700', color: '#16a34a' },
  totalLabel: { fontSize: 11, color: '#6b7280', marginTop: 2 },
  table: { backgroundColor: '#fff', borderRadius: 10, borderWidth: 1, borderColor: '#e5e7eb', overflow: 'hidden' },
  tableHeadRow: { flexDirection: 'row', backgroundColor: '#f9fafb', paddingVertical: 10, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: '#e5e7eb' },
  th: { fontSize: 12, fontWeight: '700', color: '#6b7280' },
  tableRow: { flexDirection: 'row', paddingVertical: 12, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  td: { fontSize: 14, color: '#111827' },
  colHour: { flex: 2 },
  colNum: { flex: 1, textAlign: 'center', fontWeight: '600' },
  hourText: { fontWeight: '600', color: '#374151' },
  empty: { textAlign: 'center', color: '#9ca3af', paddingVertical: 30, fontSize: 14 },
  legend: { fontSize: 12, color: '#9ca3af', textAlign: 'center', marginTop: 12 },
});

export default HourlyReportScreen;
