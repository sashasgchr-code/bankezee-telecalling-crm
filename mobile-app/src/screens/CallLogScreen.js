import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, FlatList, StyleSheet, ActivityIndicator, TouchableOpacity, RefreshControl } from 'react-native';
import { getUnifiedCallLogs } from '../services/api';

const toDateStr = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const formatDuration = (secs) => {
  const s = Number(secs) || 0;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
};

const outcomeColor = (o) => {
  if (o === 'connected') return '#16a34a';
  if (o === 'no_answer' || o === 'missed') return '#f59e0b';
  return '#ef4444';
};

const timeLabel = (iso) => {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
};

const CallLogScreen = ({ navigation }) => {
  const [calls, setCalls] = useState([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [dayOffset, setDayOffset] = useState(0);

  const dateObj = new Date();
  dateObj.setDate(dateObj.getDate() + dayOffset);
  const date = toDateStr(dateObj);
  const isToday = dayOffset === 0;

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getUnifiedCallLogs({ date });
      setCalls(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error('Call log load error', e?.message);
      setCalls([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [date]);

  useEffect(() => { load(); }, [load]);

  const onRefresh = () => { setRefreshing(true); load(); };

  const totals = calls.reduce(
    (acc, c) => {
      acc.calls += 1;
      if (c.outcome === 'connected') acc.connected += 1;
      acc.talk += Number(c.duration_seconds || c.duration || 0);
      return acc;
    },
    { calls: 0, connected: 0, talk: 0 }
  );

  const renderItem = ({ item }) => (
    <View style={styles.card} data-testid="call-log-row">
      <View style={styles.rowBetween}>
        <Text style={styles.caller}>{item.user_name || 'You'}</Text>
        <Text style={styles.time}>{timeLabel(item.created_at)}</Text>
      </View>
      {!!item.notes && <Text style={styles.notes} numberOfLines={2}>{item.notes}</Text>}
      <View style={styles.rowBetween}>
        <View style={styles.tagRow}>
          <Text style={[styles.outcome, { color: outcomeColor(item.outcome) }]}>
            {(item.outcome || 'unknown').replace(/_/g, ' ')}
          </Text>
          <Text style={styles.source}> · {item.source === 'mobile' ? '📱 Mobile' : '💻 Web'}</Text>
        </View>
        <Text style={styles.duration}>{formatDuration(item.duration_seconds || item.duration)}</Text>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        {navigation && (
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} data-testid="call-log-back">
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>
        )}
        <Text style={styles.title}>My Call Log</Text>
        <View style={styles.dateNav}>
          <TouchableOpacity onPress={() => setDayOffset(dayOffset - 1)} style={styles.navBtn} data-testid="call-log-prev-day">
            <Text style={styles.navBtnText}>‹</Text>
          </TouchableOpacity>
          <Text style={styles.dateLabel}>{isToday ? `Today · ${date}` : date}</Text>
          <TouchableOpacity
            onPress={() => setDayOffset(Math.min(0, dayOffset + 1))}
            style={[styles.navBtn, isToday && styles.navBtnDisabled]}
            disabled={isToday}
            data-testid="call-log-next-day"
          >
            <Text style={styles.navBtnText}>›</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.totals}>
        <Text style={styles.totalItem}>Calls: {totals.calls}</Text>
        <Text style={styles.totalItem}>Connected: {totals.connected}</Text>
        <Text style={styles.totalItem}>Talk: {formatDuration(totals.talk)}</Text>
      </View>

      <FlatList
        data={calls}
        keyExtractor={(item, i) => `${item.id || i}`}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#16a34a']} />}
        ListEmptyComponent={!loading ? <Text style={styles.empty}>No call records for this day</Text> : null}
        ListFooterComponent={loading ? <ActivityIndicator color="#16a34a" style={{ margin: 16 }} /> : null}
      />
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
  totals: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: '#ecfdf5', paddingHorizontal: 16, paddingVertical: 10 },
  totalItem: { fontSize: 13, fontWeight: '600', color: '#065f46' },
  list: { padding: 12 },
  card: { backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: '#e5e7eb' },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  caller: { fontSize: 15, fontWeight: '600', color: '#111827' },
  time: { fontSize: 12, color: '#6b7280' },
  notes: { fontSize: 13, color: '#374151', marginTop: 4, marginBottom: 4 },
  tagRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  outcome: { fontSize: 12, fontWeight: '700', textTransform: 'capitalize' },
  source: { fontSize: 11, color: '#9ca3af' },
  duration: { fontSize: 13, color: '#374151', fontWeight: '600', marginTop: 4 },
  empty: { textAlign: 'center', color: '#9ca3af', marginTop: 40, fontSize: 14 },
});

export default CallLogScreen;
