import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl,
  TextInput, ActivityIndicator, SafeAreaView, StatusBar,
} from 'react-native';
import { getMetaLeads } from '../services/api';

const CRM_STATUSES = ['', 'NEW', 'CALL_BACK', 'NOT_ANSWERING', 'SWITCHED_OFF', 'NOT_INTERESTED', 'NOT_QUALIFIED', 'LEAD', 'FILE'];

const MetaLeadsScreen = ({ navigation, user }) => {
  const [data, setData] = useState({ leads: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');

  const load = useCallback(async () => {
    try {
      const params = { page: 1, page_size: 100 };
      if (q) params.q = q;
      if (status) params.status = status;
      const res = await getMetaLeads(params);
      setData(res);
    } catch (e) { /* handled by interceptor */ } finally { setLoading(false); setRefreshing(false); }
  }, [q, status]);

  useEffect(() => { const t = setTimeout(load, 300); return () => clearTimeout(t); }, [load]);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.header}>
        <Text style={styles.headerTitle}>🟣 Meta Leads</Text>
        <Text style={styles.headerCount}>{data.total}</Text>
      </View>
      <View style={styles.filters}>
        <TextInput style={styles.search} value={q} onChangeText={setQ}
          placeholder="Search name/phone…" placeholderTextColor="#9ca3af" data-testid="meta-search" />
      </View>
      <View style={styles.chips}>
        {CRM_STATUSES.map(s => (
          <TouchableOpacity key={s || 'all'} onPress={() => setStatus(s)}
            style={[styles.chip, status === s && styles.chipActive]}>
            <Text style={[styles.chipText, status === s && styles.chipTextActive]}>{s || 'All'}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {loading ? <ActivityIndicator style={{ marginTop: 40 }} color="#16a34a" /> : (
        <FlatList
          data={data.leads}
          keyExtractor={(l) => l.lead_id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
          contentContainerStyle={{ padding: 12 }}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.card} data-testid="meta-lead-row"
              onPress={() => navigation.navigate('MetaLeadDetail', { leadId: item.lead_id, user })}>
              <View style={styles.cardRow}>
                <Text style={styles.name}>{item.full_name || 'Unnamed'}</Text>
                <Text style={styles.status}>{item.status}</Text>
              </View>
              <Text style={styles.sub}>{item.phone || '—'} · {item.city || '—'}</Text>
            </TouchableOpacity>
          )}
          ListEmptyComponent={<Text style={styles.empty}>No Meta leads assigned</Text>}
        />
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#eee' },
  headerTitle: { fontSize: 20, fontWeight: 'bold', color: '#111827' },
  headerCount: { fontSize: 14, color: '#6b7280', fontWeight: '600' },
  filters: { padding: 12, paddingBottom: 0 },
  search: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, padding: 12 },
  chip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e5e7eb' },
  chipActive: { backgroundColor: '#16a34a', borderColor: '#16a34a' },
  chipText: { fontSize: 11, color: '#6b7280' },
  chipTextActive: { color: '#fff', fontWeight: '600' },
  card: { backgroundColor: '#fff', borderRadius: 10, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: '#eee' },
  cardRow: { flexDirection: 'row', justifyContent: 'space-between' },
  name: { fontSize: 15, fontWeight: '600', color: '#111827' },
  status: { fontSize: 11, fontWeight: '700', color: '#7c3aed' },
  sub: { fontSize: 13, color: '#6b7280', marginTop: 4 },
  empty: { textAlign: 'center', color: '#9ca3af', marginTop: 40 },
});

export default MetaLeadsScreen;
