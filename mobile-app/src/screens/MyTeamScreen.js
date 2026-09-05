import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, FlatList, StyleSheet, RefreshControl, ActivityIndicator } from 'react-native';
import { getMyTeam, getManagerTeam } from '../services/api';

const initial = (name = '') => (name.trim()[0] || '?').toUpperCase();

const MyTeamScreen = ({ user, mobileRole }) => {
  const [members, setMembers] = useState([]);
  const [teamStats, setTeamStats] = useState({ total: 0, active_today: 0 });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = mobileRole === 'manager' ? await getManagerTeam() : await getMyTeam();
      setMembers(res.members || []);
      setTeamStats(res.stats || { total: (res.members || []).length, active_today: 0 });
    } catch (e) {
      console.error('My team load error', e?.message);
      setMembers([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [mobileRole]);

  useEffect(() => { load(); }, [load]);

  const onRefresh = () => { setRefreshing(true); load(); };

  const renderMember = ({ item }) => {
    const name = item.full_name || item.name || (item.email || '').split('@')[0];
    const stats = item.stats || {};
    return (
      <View style={styles.card} data-testid={`team-member-${item.id}`}>
        <View style={styles.rowTop}>
          <View style={[styles.avatar, { backgroundColor: item.is_tl ? '#dbeafe' : '#dcfce7' }]}>
            <Text style={[styles.avatarText, { color: item.is_tl ? '#1d4ed8' : '#15803d' }]}>{initial(name)}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{name}</Text>
            <Text style={styles.email}>{item.email}</Text>
          </View>
          <View style={[styles.roleBadge, { backgroundColor: item.is_tl ? '#dbeafe' : '#f3f4f6' }]}>
            <Text style={[styles.roleText, { color: item.is_tl ? '#1d4ed8' : '#6b7280' }]}>
              {item.is_tl ? 'Team Lead' : 'GP'}
            </Text>
          </View>
        </View>
        <View style={styles.statsRow}>
          <Stat value={stats.total_data ?? 0} label="Data" />
          <Stat value={stats.total_files ?? 0} label="Files" />
          <Stat value={stats.total_calls ?? 0} label="Calls" />
          <Stat value={item.is_active === false ? 'Off' : 'Active'} label="Status" small />
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>My Team</Text>
        <Text style={styles.sub}>{teamStats.total} members · {teamStats.active_today} active today</Text>
      </View>

      {loading ? (
        <ActivityIndicator color="#16a34a" style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={members}
          keyExtractor={(item, i) => `${item.id || i}`}
          renderItem={renderMember}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#16a34a']} />}
          ListEmptyComponent={<Text style={styles.empty}>No team members mapped to you</Text>}
        />
      )}
    </View>
  );
};

const Stat = ({ value, label, small }) => (
  <View style={styles.statItem}>
    <Text style={[styles.statValue, small && { fontSize: 14 }]}>{value}</Text>
    <Text style={styles.statLabel}>{label}</Text>
  </View>
);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  header: { paddingHorizontal: 20, paddingTop: 50, paddingBottom: 16, backgroundColor: '#fff' },
  title: { fontSize: 24, fontWeight: '700', color: '#111827' },
  sub: { fontSize: 13, color: '#6b7280', marginTop: 2 },
  list: { padding: 12 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#e5e7eb' },
  rowTop: { flexDirection: 'row', alignItems: 'center' },
  avatar: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  avatarText: { fontSize: 18, fontWeight: '700' },
  name: { fontSize: 15, fontWeight: '600', color: '#111827' },
  email: { fontSize: 12, color: '#6b7280', marginTop: 1 },
  roleBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  roleText: { fontSize: 11, fontWeight: '700' },
  statsRow: { flexDirection: 'row', marginTop: 12, borderTopWidth: 1, borderTopColor: '#f3f4f6', paddingTop: 10 },
  statItem: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 17, fontWeight: '700', color: '#16a34a' },
  statLabel: { fontSize: 11, color: '#9ca3af', marginTop: 2 },
  empty: { textAlign: 'center', color: '#9ca3af', marginTop: 40, fontSize: 14 },
});

export default MyTeamScreen;
