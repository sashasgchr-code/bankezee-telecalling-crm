import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl,
  TextInput, ActivityIndicator, SafeAreaView, StatusBar, ScrollView, Modal,
} from 'react-native';
import { getMetaLeads, getMetaFilesReport, refreshProfile } from '../services/api';
import { IS_PREVIEW, API_HOST } from '../config';

const truthy = (v) => v === true || v === 'true' || v === 1 || v === '1';
const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;
const CRM_STATUSES = ['', 'NEW', 'CALL_BACK', 'NOT_ANSWERING', 'SWITCHED_OFF', 'NOT_INTERESTED', 'NOT_QUALIFIED', 'LEAD', 'FILE'];
const PROC_STATUSES = ['', 'New', 'Contacted', 'Documents Collected', 'Documents Pending', 'Sent for Eligibility',
  'Sent for Login', 'Login Done', 'Sent for Approval', 'Approved', 'Disbursed', 'Not Eligible', 'Declined'];

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const presetRange = (preset) => {
  const today = new Date();
  if (preset === 'ALL') return { from: '', to: '' };
  if (preset === 'TODAY') return { from: ymd(today), to: ymd(today) };
  if (preset === '7D') { const s = new Date(today); s.setDate(s.getDate() - 6); return { from: ymd(s), to: ymd(today) }; }
  if (preset === '30D') { const s = new Date(today); s.setDate(s.getDate() - 29); return { from: ymd(s), to: ymd(today) }; }
  if (preset === 'MONTH') { const s = new Date(today.getFullYear(), today.getMonth(), 1); return { from: ymd(s), to: ymd(today) }; }
  return { from: '', to: '' };
};

// ---------- shared date filter bar ----------
const DateBar = ({ preset, setPreset, custom, setCustom, presets }) => (
  <View>
    <View style={styles.chipsRow}>
      {presets.map((p) => (
        <TouchableOpacity key={p.k} onPress={() => setPreset(p.k)} style={[styles.chip, preset === p.k && styles.chipActive]}>
          <Text style={[styles.chipText, preset === p.k && styles.chipTextActive]}>{p.label}</Text>
        </TouchableOpacity>
      ))}
      <TouchableOpacity onPress={() => setPreset('CUSTOM')} style={[styles.chip, preset === 'CUSTOM' && styles.chipActive]}>
        <Text style={[styles.chipText, preset === 'CUSTOM' && styles.chipTextActive]}>Custom</Text>
      </TouchableOpacity>
    </View>
    {preset === 'CUSTOM' && (
      <View style={styles.customRow}>
        <TextInput style={styles.dateInput} value={custom.from} onChangeText={(t) => setCustom({ ...custom, from: t })} placeholder="From YYYY-MM-DD" placeholderTextColor="#9ca3af" />
        <TextInput style={styles.dateInput} value={custom.to} onChangeText={(t) => setCustom({ ...custom, to: t })} placeholder="To YYYY-MM-DD" placeholderTextColor="#9ca3af" />
      </View>
    )}
  </View>
);

// ---------- LEADS ----------
const LeadsTab = ({ navigation, profile }) => {
  const [data, setData] = useState({ leads: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [preset, setPreset] = useState('ALL');
  const [custom, setCustom] = useState({ from: '', to: '' });

  const range = preset === 'CUSTOM' ? custom : presetRange(preset);
  const load = useCallback(async () => {
    try {
      const params = { page: 1, page_size: 100 };
      if (q) params.q = q;
      if (status) params.status = status;
      if (range.from) params.from_date = range.from;
      if (range.to) params.to_date = range.to;
      setData(await getMetaLeads(params));
    } catch (e) {} finally { setLoading(false); setRefreshing(false); }
  }, [q, status, range.from, range.to]);
  useEffect(() => { const t = setTimeout(load, 300); return () => clearTimeout(t); }, [load]);

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.searchWrap}>
        <TextInput style={styles.search} value={q} onChangeText={setQ} placeholder="Search name/phone/city…" placeholderTextColor="#9ca3af" data-testid="meta-leads-search" />
      </View>
      <View style={styles.chipsRow}>
        {CRM_STATUSES.map((s) => (
          <TouchableOpacity key={s || 'all'} onPress={() => setStatus(s)} style={[styles.chip, status === s && styles.chipActive]}>
            <Text style={[styles.chipText, status === s && styles.chipTextActive]}>{s || 'All'}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <DateBar preset={preset} setPreset={setPreset} custom={custom} setCustom={setCustom}
        presets={[{ k: 'ALL', label: 'All Time' }, { k: 'TODAY', label: 'Today' }, { k: '7D', label: '7 Days' }, { k: '30D', label: '30 Days' }]} />
      {loading ? <ActivityIndicator style={{ marginTop: 30 }} color="#7c3aed" /> : (
        <FlatList
          data={data.leads}
          keyExtractor={(l) => l.lead_id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
          contentContainerStyle={{ padding: 12 }}
          ListHeaderComponent={<Text style={styles.countLabel}>{data.total} lead(s)</Text>}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.card} data-testid="meta-lead-row" onPress={() => navigation.navigate('MetaLeadDetail', { leadId: item.lead_id, user: profile })}>
              <View style={styles.cardRow}><Text style={styles.name}>{item.full_name || 'Unnamed'}</Text><Text style={styles.badge}>{item.status}</Text></View>
              <Text style={styles.sub}>{item.phone || '—'} · {item.city || '—'}</Text>
            </TouchableOpacity>
          )}
          ListEmptyComponent={<Text style={styles.empty}>No Meta leads assigned</Text>}
        />
      )}
    </View>
  );
};

// ---------- FILES ----------
const FilesTab = ({ navigation, profile }) => {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [q, setQ] = useState('');
  const [pstatus, setPstatus] = useState('');
  const [preset, setPreset] = useState('ALL');
  const [custom, setCustom] = useState({ from: '', to: '' });

  const range = preset === 'CUSTOM' ? custom : presetRange(preset);
  const load = useCallback(async () => {
    try {
      const params = { status: 'FILE', page: 1, page_size: 200 };
      if (q) params.q = q;
      if (range.from) params.from_date = range.from;
      if (range.to) params.to_date = range.to;
      const res = await getMetaLeads(params);
      setFiles(res.leads || res.items || []);
    } catch (e) {} finally { setLoading(false); setRefreshing(false); }
  }, [q, range.from, range.to]);
  useEffect(() => { const t = setTimeout(load, 300); return () => clearTimeout(t); }, [load]);

  const shown = files.filter((f) => !pstatus || (f.processing_status || 'New') === pstatus);

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.searchWrap}>
        <TextInput style={styles.search} value={q} onChangeText={setQ} placeholder="Search customer/phone…" placeholderTextColor="#9ca3af" data-testid="meta-files-search" />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsScroll} contentContainerStyle={styles.chipsRow}>
        {PROC_STATUSES.map((s) => (
          <TouchableOpacity key={s || 'all'} onPress={() => setPstatus(s)} style={[styles.chip, pstatus === s && styles.chipActive]}>
            <Text style={[styles.chipText, pstatus === s && styles.chipTextActive]}>{s || 'All'}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      <DateBar preset={preset} setPreset={setPreset} custom={custom} setCustom={setCustom}
        presets={[{ k: 'ALL', label: 'All Time' }, { k: 'TODAY', label: 'Today' }, { k: '7D', label: '7 Days' }, { k: '30D', label: '30 Days' }]} />
      {loading ? <ActivityIndicator style={{ marginTop: 30 }} color="#7c3aed" /> : (
        <FlatList
          data={shown}
          keyExtractor={(f) => f.lead_id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
          contentContainerStyle={{ padding: 12 }}
          ListHeaderComponent={<Text style={styles.countLabel}>{shown.length} file(s)</Text>}
          renderItem={({ item }) => {
            const fd = item.file_created_at || item.created_at;
            const docs = (item.documents || []).length;
            return (
              <TouchableOpacity style={styles.card} data-testid="meta-file-row" onPress={() => navigation.navigate('MetaLeadDetail', { leadId: item.lead_id, user: profile })}>
                <View style={styles.cardRow}><Text style={styles.name}>{item.full_name || 'Unnamed'}</Text><Text style={styles.procBadge}>{item.processing_status || 'New'}</Text></View>
                <Text style={styles.sub}>{item.phone || '—'} · {fd ? new Date(fd).toLocaleDateString() : '—'}</Text>
                <Text style={styles.sub2}>
                  {item.file?.loan_type ? `${item.file.loan_type} · ` : ''}
                  {item.file?.loan_amount ? `${inr(item.file.loan_amount)} · ` : ''}
                  {item.assigned_processor_name ? `Proc: ${item.assigned_processor_name} · ` : ''}
                  Docs: {item.docs_received ? 'Received' : (docs ? `${docs}` : 'Pending')}
                </Text>
              </TouchableOpacity>
            );
          }}
          ListEmptyComponent={<Text style={styles.empty}>No Meta files</Text>}
        />
      )}
    </View>
  );
};

// ---------- FILE REPORTS ----------
const Metric = ({ label, value, sub, color }) => (
  <View style={styles.metric}>
    <Text style={styles.metricLabel}>{label}</Text>
    <Text style={[styles.metricValue, color && { color }]}>{value}</Text>
    {sub !== undefined && <Text style={styles.metricSub}>{sub}</Text>}
  </View>
);
const ReportsTab = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [preset, setPreset] = useState('ALL');
  const [custom, setCustom] = useState({ from: '', to: '' });
  const range = preset === 'CUSTOM' ? custom : presetRange(preset);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (range.from) params.from_date = range.from;
      if (range.to) params.to_date = range.to;
      setData(await getMetaFilesReport(params));
    } catch (e) {} finally { setLoading(false); }
  }, [range.from, range.to]);
  useEffect(() => { load(); }, [load]);

  const o = data?.overall; const m = data?.this_month;
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 12 }}>
      <DateBar preset={preset} setPreset={setPreset} custom={custom} setCustom={setCustom}
        presets={[{ k: 'ALL', label: 'All Time' }, { k: 'MONTH', label: 'This Month' }]} />
      {loading || !o ? <ActivityIndicator style={{ marginTop: 30 }} color="#7c3aed" /> : (
        <>
          <Text style={styles.repHdr}>Overall {range.from ? `(${range.from} → ${range.to})` : ''}</Text>
          <View style={styles.metricGrid} data-testid="meta-report-overall">
            <Metric label="Total Files" value={o.total_files} color="#7c3aed" />
            <Metric label="In Progress" value={o.in_progress} color="#d97706" />
            <Metric label="Login Done" value={o.login} color="#2563eb" />
            <Metric label="Approved" value={o.approved} sub={inr(o.approved_amount)} color="#059669" />
            <Metric label="Disbursed" value={o.disbursed} sub={inr(o.disbursed_amount)} color="#047857" />
            <Metric label="Rejected" value={o.rejected} color="#dc2626" />
            <Metric label="Amt in Pipeline" value={inr(o.pipeline_amount)} color="#2563eb" />
            <Metric label="Total Disbursed" value={inr(o.disbursed_amount)} color="#047857" />
          </View>
          <Text style={styles.repHdr}>This Month</Text>
          <View style={styles.metricGrid} data-testid="meta-report-this-month">
            <Metric label="New Files" value={m.total_files} color="#7c3aed" />
            <Metric label="Login Done" value={m.login} color="#2563eb" />
            <Metric label="Approved" value={m.approved} sub={inr(m.approved_amount)} color="#059669" />
            <Metric label="Disbursed" value={m.disbursed} sub={inr(m.disbursed_amount)} color="#047857" />
            <Metric label="Rejected" value={m.rejected} color="#dc2626" />
          </View>
        </>
      )}
    </ScrollView>
  );
};

const Diagnostic = ({ profile, source }) => {
  if (!IS_PREVIEW) return null;
  return (
    <View style={styles.diag} data-testid="meta-diagnostic">
      <Text style={styles.diagTitle}>META DIAGNOSTIC (preview only)</Text>
      <Text style={styles.diagLine}>Email: {profile?.email || '—'}  ·  API: {API_HOST}</Text>
      <Text style={styles.diagLine}>meta_access: {String(profile?.meta_access)}  ·  meta_role: {String(profile?.meta_role)}</Text>
      <Text style={styles.diagLine}>meta_user_id: {String(profile?.meta_user_id)}  ·  src: {source}</Text>
    </View>
  );
};

const MetaHomeScreen = ({ navigation, user }) => {
  const [profile, setProfile] = useState(null);
  const [source, setSource] = useState('cached');
  const [checking, setChecking] = useState(true);
  const [tab, setTab] = useState('leads');

  const checkAccess = useCallback(async () => {
    setChecking(true);
    try {
      const fresh = await refreshProfile();
      if (fresh) { setProfile(fresh); setSource('live /auth/me'); }
      else { setProfile(user || null); setSource('cached (empty live)'); }
    } catch (e) { setProfile(user || null); setSource('cached (live failed)'); }
    finally { setChecking(false); }
  }, [user]);
  useEffect(() => { checkAccess(); }, [checkAccess]);

  const hasAccess = truthy(profile?.meta_access);
  const TABS = [{ k: 'leads', label: 'Leads' }, { k: 'files', label: 'Files' }, { k: 'reports', label: 'File Reports' }];

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.header}><Text style={styles.headerTitle}>🟣 Meta CRM</Text></View>

      {checking ? (
        <>
          <ActivityIndicator style={{ marginTop: 40 }} color="#7c3aed" />
          <Text style={styles.checking}>Checking Meta access…</Text>
          <Diagnostic profile={profile} source={source} />
        </>
      ) : !hasAccess ? (
        <View style={styles.denied} data-testid="meta-access-denied">
          <Text style={{ fontSize: 44, marginBottom: 12 }}>🔒</Text>
          <Text style={styles.deniedTitle}>You do not have Meta CRM access</Text>
          <Text style={styles.deniedText}>Ask an administrator to enable Meta access.</Text>
          <TouchableOpacity style={styles.retry} onPress={checkAccess} data-testid="meta-retry-access"><Text style={styles.retryText}>Retry</Text></TouchableOpacity>
          <Diagnostic profile={profile} source={source} />
        </View>
      ) : (
        <>
          <Diagnostic profile={profile} source={source} />
          <View style={styles.tabBar} data-testid="meta-tabbar">
            {TABS.map((t) => (
              <TouchableOpacity key={t.k} onPress={() => setTab(t.k)} style={[styles.tabBtn, tab === t.k && styles.tabBtnActive]} data-testid={`meta-tab-${t.k}`}>
                <Text style={[styles.tabText, tab === t.k && styles.tabTextActive]}>{t.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {tab === 'leads' && <LeadsTab navigation={navigation} profile={profile} />}
          {tab === 'files' && <FilesTab navigation={navigation} profile={profile} />}
          {tab === 'reports' && <ReportsTab />}
        </>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  header: { padding: 16, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#eee' },
  headerTitle: { fontSize: 20, fontWeight: 'bold', color: '#111827' },
  checking: { textAlign: 'center', color: '#6b7280', marginTop: 12, fontSize: 13 },
  tabBar: { flexDirection: 'row', backgroundColor: '#fff', paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: '#eee' },
  tabBtn: { flex: 1, paddingVertical: 12, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabBtnActive: { borderBottomColor: '#7c3aed' },
  tabText: { fontSize: 13, color: '#6b7280', fontWeight: '500' },
  tabTextActive: { color: '#7c3aed', fontWeight: '700' },
  searchWrap: { padding: 12, paddingBottom: 4 },
  search: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14 },
  chipsScroll: { maxHeight: 44 },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 12, paddingVertical: 6, alignItems: 'center' },
  chip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e5e7eb' },
  chipActive: { backgroundColor: '#7c3aed', borderColor: '#7c3aed' },
  chipText: { fontSize: 11, color: '#6b7280' },
  chipTextActive: { color: '#fff', fontWeight: '600' },
  customRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingBottom: 6 },
  dateInput: { flex: 1, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, fontSize: 12 },
  countLabel: { fontSize: 12, color: '#9ca3af', marginBottom: 6 },
  card: { backgroundColor: '#fff', borderRadius: 10, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: '#eee' },
  cardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name: { fontSize: 15, fontWeight: '600', color: '#111827', flex: 1 },
  sub: { fontSize: 13, color: '#6b7280', marginTop: 4 },
  sub2: { fontSize: 12, color: '#6b7280', marginTop: 3 },
  badge: { fontSize: 10, fontWeight: '700', color: '#7c3aed' },
  procBadge: { fontSize: 10, fontWeight: '700', color: '#047857', backgroundColor: '#ecfdf5', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  empty: { textAlign: 'center', color: '#9ca3af', marginTop: 40 },
  denied: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  deniedTitle: { fontSize: 17, fontWeight: '700', color: '#111827', textAlign: 'center' },
  deniedText: { fontSize: 13, color: '#6b7280', textAlign: 'center', marginTop: 8 },
  retry: { marginTop: 18, backgroundColor: '#7c3aed', paddingHorizontal: 22, paddingVertical: 10, borderRadius: 10 },
  retryText: { color: '#fff', fontWeight: '600' },
  repHdr: { fontSize: 13, fontWeight: '700', color: '#374151', marginTop: 10, marginBottom: 8 },
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  metric: { width: '48%', backgroundColor: '#fff', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#eee' },
  metricLabel: { fontSize: 11, color: '#6b7280' },
  metricValue: { fontSize: 20, fontWeight: 'bold', color: '#111827', marginTop: 2 },
  metricSub: { fontSize: 11, color: '#9ca3af', marginTop: 1 },
  diag: { backgroundColor: '#fff7ed', borderWidth: 1, borderColor: '#fdba74', margin: 12, marginBottom: 0, borderRadius: 8, padding: 10 },
  diagTitle: { fontSize: 10, fontWeight: '800', color: '#c2410c', marginBottom: 4, letterSpacing: 0.5 },
  diagLine: { fontSize: 11, color: '#7c2d12', fontFamily: 'monospace' },
});

export default MetaHomeScreen;
