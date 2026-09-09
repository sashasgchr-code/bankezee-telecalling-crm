import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl,
  ActivityIndicator, SafeAreaView, StatusBar, Modal, TextInput, Alert, Linking, ScrollView,
} from 'react-native';
import { getTLMeta, getTLLeads, getTLStats, logTLCall } from '../services/api';

const OUTCOMES = [
  ['connected', 'Connected'], ['call_back', 'Call Back'], ['not_answering', 'Not Answering'],
  ['switched_off', 'Switched Off'], ['not_interested', 'Not Interested'], ['not_qualified', 'Not Qualified'],
];
const STATUS = [['', 'No change'], ['leads', 'Lead'], ['follow_up', 'Follow Up'], ['not_interested', 'Not Interested'], ['file', 'Convert to File']];

const sanitizePhone = (raw) => {
  let p = String(raw ?? '').split('.')[0].replace(/[^0-9]/g, '').replace(/^0+/, '');
  if (p.length === 10) p = '91' + p; else if (!p.startsWith('91') && p.length > 10) p = '91' + p;
  return p;
};
const waMessage = (name, agent) =>
  `Hello ${name || 'there'},\n\nThis is ${agent || 'BankEzee'} from BankEzee regarding your loan requirement. We help consolidate existing loans, reduce EMI burden and arrange additional funding.\n\nPlease let us know a convenient time to connect.\n\nRegards,\n${agent || 'Team'}\nBankEzee – Loan Consolidation Platform\nwww.BankEzee.com`;

const TLTeamLeadsScreen = ({ user }) => {
  const [meta, setMeta] = useState({ is_tl: false, me: null });
  const [leads, setLeads] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [period, setPeriod] = useState('today');
  const [active, setActive] = useState(null); // lead in call
  const [seconds, setSeconds] = useState(0);
  const [outcome, setOutcome] = useState('');
  const [status, setStatus] = useState('');
  const [notes, setNotes] = useState('');
  const [reason, setReason] = useState('');
  const [fd, setFd] = useState(''); const [ft, setFt] = useState('');
  const [saving, setSaving] = useState(false);
  const startRef = useRef(0);
  const timerRef = useRef(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [m, s, l] = await Promise.all([
        getTLMeta().catch(() => ({ is_tl: false })),
        getTLStats({ period }).catch(() => null),
        getTLLeads({ period }).catch(() => ({ leads: [] })),
      ]);
      setMeta(m); setStats(s); setLeads(l.leads || []);
    } catch (e) { /* ignore */ } finally { setLoading(false); setRefreshing(false); }
  }, [period]);

  useEffect(() => { load(); }, [load]);

  const startCall = async (lead) => {
    setActive(lead); setOutcome(''); setStatus(''); setNotes(''); setReason(''); setFd(''); setFt('');
    startRef.current = Date.now(); setSeconds(0);
    timerRef.current && clearInterval(timerRef.current);
    timerRef.current = setInterval(() => setSeconds(Math.floor((Date.now() - startRef.current) / 1000)), 1000);
    const ph = sanitizePhone(lead.phone);
    if (ph) Linking.openURL(`tel:${ph}`).catch(() => {});
  };

  const closeCall = () => { timerRef.current && clearInterval(timerRef.current); setActive(null); };

  const save = async () => {
    if (!outcome) { Alert.alert('Required', 'Select a call outcome'); return; }
    if (outcome === 'not_qualified' && !reason.trim()) { Alert.alert('Required', 'Reason is required'); return; }
    setSaving(true);
    try {
      await logTLCall(active.lead_id, {
        duration_seconds: Math.floor((Date.now() - startRef.current) / 1000),
        outcome, resulting_status: status || null, reason: reason.trim() || null,
        notes: notes.trim() || null,
        follow_up_date: ['call_back', 'not_answering', 'switched_off'].includes(outcome) ? (fd || null) : null,
        follow_up_time: ['call_back', 'not_answering', 'switched_off'].includes(outcome) ? (ft || null) : null,
        convert_to_file: status === 'file',
      });
      closeCall(); load();
    } catch (e) { Alert.alert('Error', e.response?.data?.detail || 'Failed to save'); } finally { setSaving(false); }
  };

  const openWA = (lead) => {
    const ph = sanitizePhone(lead.phone); if (!ph) return;
    Linking.openURL(`https://wa.me/${ph}?text=${encodeURIComponent(waMessage(lead.name, user?.name))}`);
  };

  const Stat = ({ v, l, c }) => (<View style={styles.stat}><Text style={[styles.statV, c && { color: c }]}>{v}</Text><Text style={styles.statL}>{l}</Text></View>);

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" backgroundColor="#fff" />
      <View style={styles.header}><Text style={styles.title}>Team Leads (TL)</Text></View>
      <View style={styles.periodRow}>
        {[['today', 'Today'], ['yesterday', 'Yest'], ['week', 'Week'], ['month', 'Month']].map(([k, l]) => (
          <TouchableOpacity key={k} onPress={() => setPeriod(k)} style={[styles.pBtn, period === k && styles.pBtnA]}>
            <Text style={[styles.pTxt, period === k && styles.pTxtA]}>{l}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {stats && (
        <View style={styles.statsGrid}>
          <Stat v={stats.range_total_leads} l="Leads" c="#2563eb" />
          <Stat v={stats.contacted_leads} l="Contacted" c="#7c3aed" />
          <Stat v={stats.files_converted} l="Files" c="#ea580c" />
          <Stat v={`${stats.file_conversion_rate}%`} l="Conv%" c="#059669" />
        </View>
      )}
      {loading ? <ActivityIndicator style={{ marginTop: 40 }} color="#16a34a" /> : (
        <FlatList
          data={leads}
          keyExtractor={(i) => i.lead_id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
          contentContainerStyle={{ padding: 12 }}
          ListEmptyComponent={<Text style={styles.empty}>No leads in this range</Text>}
          renderItem={({ item }) => (
            <View style={styles.card} data-testid="tl-lead-row">
              <View style={styles.cardTop}>
                <Text style={styles.name}>{item.name}</Text>
                <Text style={[styles.badge, item.status === 'file' && styles.badgeFile]}>{(item.status || '').toUpperCase()}</Text>
              </View>
              <Text style={styles.sub}>{item.phone} · {item.loan_type || 'loan requirement'}</Text>
              <Text style={styles.meta}>GP: {item.gp_name}   ·   Lead: {item.lead_created_at ? new Date(item.lead_created_at).toLocaleDateString() : '—'}</Text>
              <Text style={styles.meta}>Last TL: {item.last_tl_call ? item.last_tl_call.outcome : '—'}   ·   Follow-up: {item.follow_up_date || '—'}</Text>
              {item.converted_by_tl && <Text style={styles.tlNote}>TL-converted to File (owner remains GP)</Text>}
              <View style={styles.actions}>
                <TouchableOpacity style={[styles.aBtn, styles.callBtn]} data-testid="tl-card-call" onPress={() => startCall(item)}><Text style={styles.aTxt}>📞  Call</Text></TouchableOpacity>
                <TouchableOpacity style={[styles.aBtn, styles.waBtn]} data-testid="tl-card-wa" onPress={() => openWA(item)}><Text style={styles.aTxt}>💬  WhatsApp</Text></TouchableOpacity>
              </View>
            </View>
          )}
        />
      )}

      <Modal visible={!!active} transparent animationType="slide" onRequestClose={closeCall}>
        <View style={styles.modalWrap}>
          <View style={styles.modal}>
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={styles.modalTitle}>TL Call · {active?.name}</Text>
              <Text style={styles.timer}>{String(Math.floor(seconds / 60)).padStart(2, '0')}:{String(seconds % 60).padStart(2, '0')}</Text>
              <Text style={styles.gpNote}>Original GP: {active?.gp_name} (ownership stays with GP)</Text>
              <Text style={styles.lbl}>Outcome</Text>
              <View style={styles.chips}>
                {OUTCOMES.map(([v, l]) => (
                  <TouchableOpacity key={v} onPress={() => setOutcome(v)} style={[styles.chip, outcome === v && styles.chipA]} data-testid={`tl-outcome-${v}`}>
                    <Text style={[styles.chipT, outcome === v && styles.chipTA]}>{l}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={styles.lbl}>Update Status</Text>
              <View style={styles.chips}>
                {STATUS.map(([v, l]) => (
                  <TouchableOpacity key={v || 'none'} onPress={() => setStatus(v)} style={[styles.chip, status === v && styles.chipA]} data-testid={`tl-status-${v || 'none'}`}>
                    <Text style={[styles.chipT, status === v && styles.chipTA]}>{l}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {outcome === 'not_qualified' && <TextInput style={styles.input} value={reason} onChangeText={setReason} placeholder="Reason (required)" placeholderTextColor="#9ca3af" />}
              {['call_back', 'not_answering', 'switched_off'].includes(outcome) && (
                <View style={styles.row2}>
                  <TextInput style={[styles.input, { flex: 1 }]} value={fd} onChangeText={setFd} placeholder="YYYY-MM-DD" placeholderTextColor="#9ca3af" maxLength={10} />
                  <TextInput style={[styles.input, { flex: 1 }]} value={ft} onChangeText={setFt} placeholder="HH:MM" placeholderTextColor="#9ca3af" maxLength={5} />
                </View>
              )}
              <TextInput style={[styles.input, { height: 70 }]} value={notes} onChangeText={setNotes} placeholder="Notes..." placeholderTextColor="#9ca3af" multiline />
              <View style={styles.mBtns}>
                <TouchableOpacity style={styles.cancel} onPress={closeCall}><Text>Cancel</Text></TouchableOpacity>
                <TouchableOpacity style={styles.saveB} onPress={save} disabled={saving} data-testid="tl-save-call">
                  <Text style={styles.saveT}>{saving ? 'Saving...' : 'Save Call'}</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f3f4f6' },
  header: { paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e5e7eb' },
  title: { fontSize: 20, fontWeight: '700', color: '#111827' },
  periodRow: { flexDirection: 'row', gap: 8, padding: 12, backgroundColor: '#fff' },
  pBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: '#f3f4f6' },
  pBtnA: { backgroundColor: '#16a34a' },
  pTxt: { fontSize: 13, color: '#374151' }, pTxtA: { color: '#fff', fontWeight: '700' },
  statsGrid: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingBottom: 8, backgroundColor: '#fff' },
  stat: { flex: 1, backgroundColor: '#f9fafb', borderRadius: 8, padding: 8, alignItems: 'center', borderWidth: 1, borderColor: '#e5e7eb' },
  statV: { fontSize: 18, fontWeight: '700', color: '#111827' }, statL: { fontSize: 10, color: '#6b7280', marginTop: 2 },
  empty: { textAlign: 'center', color: '#9ca3af', marginTop: 40 },
  card: { backgroundColor: '#fff', borderRadius: 10, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#e5e7eb' },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name: { fontSize: 15, fontWeight: '700', color: '#111827', flex: 1 },
  badge: { fontSize: 10, fontWeight: '700', color: '#15803d', backgroundColor: '#dcfce7', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 5 },
  badgeFile: { color: '#c2410c', backgroundColor: '#ffedd5' },
  sub: { fontSize: 13, color: '#4b5563', marginTop: 4 },
  meta: { fontSize: 11, color: '#6b7280', marginTop: 3 },
  tlNote: { fontSize: 10, color: '#ea580c', marginTop: 4 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  aBtn: { flex: 1, paddingVertical: 9, borderRadius: 9, alignItems: 'center' },
  callBtn: { backgroundColor: '#16a34a' }, waBtn: { backgroundColor: '#22c55e' },
  aTxt: { color: '#fff', fontWeight: '700', fontSize: 14 },
  modalWrap: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modal: { backgroundColor: '#fff', borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 18, maxHeight: '90%' },
  modalTitle: { fontSize: 17, fontWeight: '700', color: '#111827' },
  timer: { fontSize: 22, fontWeight: '700', color: '#16a34a', marginTop: 4 },
  gpNote: { fontSize: 11, color: '#4f46e5', backgroundColor: '#eef2ff', padding: 6, borderRadius: 6, marginTop: 8 },
  lbl: { fontSize: 11, fontWeight: '700', color: '#6b7280', textTransform: 'uppercase', marginTop: 14, marginBottom: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, backgroundColor: '#f3f4f6' },
  chipA: { backgroundColor: '#16a34a' }, chipT: { fontSize: 13, color: '#374151' }, chipTA: { color: '#fff', fontWeight: '700' },
  input: { backgroundColor: '#f3f4f6', borderRadius: 9, padding: 10, fontSize: 14, marginTop: 10 },
  row2: { flexDirection: 'row', gap: 10 },
  mBtns: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 16 },
  cancel: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 9, borderWidth: 1, borderColor: '#e5e7eb' },
  saveB: { paddingHorizontal: 22, paddingVertical: 10, borderRadius: 9, backgroundColor: '#16a34a' },
  saveT: { color: '#fff', fontWeight: '700' },
});

export default TLTeamLeadsScreen;
