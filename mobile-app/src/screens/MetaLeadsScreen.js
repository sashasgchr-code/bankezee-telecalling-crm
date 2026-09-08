import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl,
  TextInput, ActivityIndicator, SafeAreaView, StatusBar,
} from 'react-native';
import { getMetaLeads, refreshProfile } from '../services/api';
import { IS_PREVIEW, API_HOST } from '../config';

const CRM_STATUSES = ['', 'NEW', 'CALL_BACK', 'NOT_ANSWERING', 'SWITCHED_OFF', 'NOT_INTERESTED', 'NOT_QUALIFIED', 'LEAD', 'FILE'];

const truthy = (v) => v === true || v === 'true' || v === 1 || v === '1';

// PREVIEW/DEV only. Never rendered against the production backend.
const Diagnostic = ({ profile, source }) => {
  if (!IS_PREVIEW) return null;
  return (
    <View style={styles.diag} data-testid="meta-diagnostic">
      <Text style={styles.diagTitle}>META DIAGNOSTIC (preview only)</Text>
      <Text style={styles.diagLine}>Email: {profile?.email || '—'}</Text>
      <Text style={styles.diagLine}>API: {API_HOST || '—'}</Text>
      <Text style={styles.diagLine}>meta_access: {String(profile?.meta_access)}</Text>
      <Text style={styles.diagLine}>meta_role: {String(profile?.meta_role)}</Text>
      <Text style={styles.diagLine}>meta_user_id: {String(profile?.meta_user_id)}</Text>
      <Text style={styles.diagLine}>profile source: {source}</Text>
    </View>
  );
};

const MetaLeadsScreen = ({ navigation, user }) => {
  // Live permission gate: fetch a fresh profile every time this screen mounts,
  // rather than trusting the cached client user object.
  const [profile, setProfile] = useState(null);
  const [profileSource, setProfileSource] = useState('cached');
  const [checking, setChecking] = useState(true);

  const [data, setData] = useState({ leads: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');

  const checkAccess = useCallback(async () => {
    setChecking(true);
    try {
      const fresh = await refreshProfile(); // GET /auth/me (persists to AsyncStorage)
      if (fresh) { setProfile(fresh); setProfileSource('live /auth/me'); }
      else { setProfile(user || null); setProfileSource('cached (live returned empty)'); }
    } catch (e) {
      setProfile(user || null);
      setProfileSource('cached (live fetch failed)');
    } finally { setChecking(false); }
  }, [user]);

  useEffect(() => { checkAccess(); }, [checkAccess]);

  const hasAccess = truthy(profile?.meta_access);

  const load = useCallback(async () => {
    if (!hasAccess) { setLoading(false); setRefreshing(false); return; }
    try {
      const params = { page: 1, page_size: 100 };
      if (q) params.q = q;
      if (status) params.status = status;
      const res = await getMetaLeads(params);
      setData(res);
    } catch (e) { /* backend 403/network handled by interceptor */ } finally { setLoading(false); setRefreshing(false); }
  }, [q, status, hasAccess]);

  useEffect(() => { if (!checking && hasAccess) { const t = setTimeout(load, 300); return () => clearTimeout(t); } }, [load, checking, hasAccess]);

  if (checking) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="dark-content" />
        <View style={styles.header}><Text style={styles.headerTitle}>🟣 Meta CRM</Text></View>
        <ActivityIndicator style={{ marginTop: 40 }} color="#16a34a" />
        <Text style={styles.checkingText}>Checking Meta access…</Text>
        <Diagnostic profile={profile} source={profileSource} />
      </SafeAreaView>
    );
  }

  if (!hasAccess) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="dark-content" />
        <View style={styles.header}><Text style={styles.headerTitle}>🟣 Meta CRM</Text></View>
        <View style={styles.denied} data-testid="meta-access-denied">
          <Text style={styles.deniedIcon}>🔒</Text>
          <Text style={styles.deniedTitle}>You do not have Meta CRM access</Text>
          <Text style={styles.deniedText}>Ask an administrator to enable Meta access for your account.</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={checkAccess} data-testid="meta-retry-access">
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
        <Diagnostic profile={profile} source={profileSource} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.header}>
        <Text style={styles.headerTitle}>🟣 Meta Leads</Text>
        <Text style={styles.headerCount}>{data.total}</Text>
      </View>
      <Diagnostic profile={profile} source={profileSource} />
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
              onPress={() => navigation.navigate('MetaLeadDetail', { leadId: item.lead_id, user: profile })}>
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
  checkingText: { textAlign: 'center', color: '#6b7280', marginTop: 12, fontSize: 13 },
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
  denied: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  deniedIcon: { fontSize: 44, marginBottom: 12 },
  deniedTitle: { fontSize: 17, fontWeight: '700', color: '#111827', textAlign: 'center' },
  deniedText: { fontSize: 13, color: '#6b7280', textAlign: 'center', marginTop: 8 },
  retryBtn: { marginTop: 18, backgroundColor: '#16a34a', paddingHorizontal: 22, paddingVertical: 10, borderRadius: 10 },
  retryText: { color: '#fff', fontWeight: '600' },
  diag: { backgroundColor: '#fff7ed', borderWidth: 1, borderColor: '#fdba74', margin: 12, marginBottom: 0, borderRadius: 8, padding: 10 },
  diagTitle: { fontSize: 10, fontWeight: '800', color: '#c2410c', marginBottom: 4, letterSpacing: 0.5 },
  diagLine: { fontSize: 11, color: '#7c2d12', fontFamily: 'monospace' },
});

export default MetaLeadsScreen;
