import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Modal, TextInput,
  ActivityIndicator, SafeAreaView, AppState, Alert,
} from 'react-native';
import { getMetaLead, addMetaCallLog, addMetaNote } from '../services/api';
import { makePhoneCall, getRecentCallForNumber } from '../services/callLogService';

const OUTCOMES = [
  { id: 'CALL_BACK', label: 'Call Back' },
  { id: 'NOT_ANSWERING', label: 'Not Answering' },
  { id: 'SWITCHED_OFF', label: 'Switched Off' },
  { id: 'NOT_INTERESTED', label: 'Not Interested' },
  { id: 'NOT_QUALIFIED', label: 'Not Qualified' },
  { id: 'LEAD', label: 'Interested (LEAD)' },
  { id: 'FILE', label: 'Convert to FILE' },
];

// Reuses the EXACT Connect native call lifecycle (makePhoneCall + AppState + getRecentCallForNumber),
// but saves the outcome to the isolated Meta API. Connect calling code is untouched.
const MetaLeadDetailScreen = ({ route, navigation }) => {
  const { leadId, user } = route.params;
  const [lead, setLead] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [detectedDuration, setDetectedDuration] = useState(null);
  const [lookingUp, setLookingUp] = useState(false);
  const [outcome, setOutcome] = useState(null);
  const [note, setNote] = useState('');
  const [callStartTime, setCallStartTime] = useState(null);
  const pendingPhone = useRef(null);
  const callIdRef = useRef(null);

  const load = useCallback(async () => {
    try { setLead(await getMetaLead(leadId)); } catch (e) {
      Alert.alert('Error', e.response?.data?.detail || 'Failed to load lead');
    } finally { setLoading(false); }
  }, [leadId]);
  useEffect(() => { load(); }, [load]);

  const startCall = async () => {
    if (!lead?.phone) { Alert.alert('No phone', 'This lead has no phone number'); return; }
    const now = Date.now();
    setCallStartTime(now);
    callIdRef.current = `meta_${leadId}_${now}`;   // unique per physical call -> backend dedupe
    pendingPhone.current = lead.phone;
    setDetectedDuration(null); setOutcome(null); setNote('');
    await makePhoneCall(lead.phone);
  };

  const handleAppState = useCallback(async (next) => {
    if (next === 'active' && callStartTime && pendingPhone.current) {
      const elapsed = Math.round((Date.now() - callStartTime) / 1000);
      if (elapsed > 3) {
        setLookingUp(true);
        try {
          const res = await getRecentCallForNumber(pendingPhone.current, callStartTime, 8000);
          if (res.success && res.call) {
            setDetectedDuration(res.call.duration_seconds);
            setOutcome(res.call.duration_seconds > 0 ? 'CALL_BACK' : 'NOT_ANSWERING');
          } else setDetectedDuration(null);
        } catch { setDetectedDuration(null); }
        setLookingUp(false);
        setShowModal(true);
      }
      setCallStartTime(null); pendingPhone.current = null;
    }
  }, [callStartTime]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', handleAppState);
    return () => sub?.remove();
  }, [handleAppState]);

  const submitCall = async () => {
    if (!outcome) { Alert.alert('Required', 'Select a call outcome'); return; }
    setBusy(true);
    try {
      const isStatus = ['CALL_BACK', 'NOT_ANSWERING', 'SWITCHED_OFF', 'NOT_INTERESTED', 'NOT_QUALIFIED', 'LEAD', 'FILE'].includes(outcome);
      const res = await addMetaCallLog(leadId, {
        call_id: callIdRef.current || `meta_${leadId}_${Date.now()}`,
        phone: lead.phone,
        started_at: callStartTime ? new Date(callStartTime).toISOString() : new Date().toISOString(),
        ended_at: new Date().toISOString(),
        duration_seconds: detectedDuration || 0,
        outcome,
        note: note || null,
        resulting_status: isStatus ? outcome : null,
      });
      setLead(res.lead);
      setShowModal(false); setOutcome(null); setNote('');
    } catch (e) {
      Alert.alert('Error', e.response?.data?.detail || 'Failed to save call');
    } finally { setBusy(false); }
  };

  if (loading) return <SafeAreaView style={styles.container}><ActivityIndicator style={{ marginTop: 60 }} color="#16a34a" /></SafeAreaView>;
  if (!lead) return null;
  const activities = [...(lead.activities || [])].reverse();
  const calls = (lead.call_logs || []).filter(c => c.lead_source === 'meta' || c.source === 'mobile');

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={{ padding: 14 }}>
        <TouchableOpacity onPress={() => navigation.goBack()}><Text style={styles.back}>← Back</Text></TouchableOpacity>
        <View style={styles.card}>
          <View style={styles.rowBetween}>
            <Text style={styles.name}>{lead.full_name || 'Unnamed'}</Text>
            <Text style={styles.status}>{lead.status}</Text>
          </View>
          <Text style={styles.field}>📞 {lead.phone || '—'}</Text>
          <Text style={styles.field}>📧 {lead.email || '—'}</Text>
          <Text style={styles.field}>📍 {lead.city || '—'}</Text>
          <Text style={styles.field}>💼 {lead.employment_status || '—'} · {lead.outstanding_amount || '—'}</Text>
        </View>

        <TouchableOpacity style={styles.callBtn} onPress={startCall} data-testid="meta-start-call">
          <Text style={styles.callBtnText}>📞 Start Call</Text>
        </TouchableOpacity>

        {lead.status === 'FILE' && (
          <View style={styles.card} data-testid="meta-file-details">
            <Text style={styles.section}>📁 File Details</Text>
            <Text style={styles.field}>Processing: {lead.processing_status || 'New'}</Text>
            {lead.assigned_processor_name ? <Text style={styles.field}>Processor: {lead.assigned_processor_name}</Text> : null}
            <Text style={styles.field}>Docs: {lead.docs_received ? 'Received' : ((lead.documents || []).length ? `${(lead.documents || []).length} uploaded` : 'Pending')}</Text>
            {lead.file?.loan_type ? <Text style={styles.field}>Loan: {lead.file.loan_type}{lead.file.loan_amount ? ` · ₹${Number(lead.file.loan_amount).toLocaleString('en-IN')}` : ''}</Text> : null}
            {(lead.file?.banks || []).length > 0 && (
              <>
                <Text style={[styles.field, { fontWeight: '600', marginTop: 6 }]}>Bank Eligibilities ({lead.file.banks.length})</Text>
                {lead.file.banks.map((b, i) => (
                  <Text key={i} style={styles.activity}>
                    • {b.bank_name || 'Bank'} · Elig: {b.eligible || '—'}{b.login_done === 'Yes' ? ` · Login` : ''}{b.approval_status ? ` · ${b.approval_status}` : ''}{b.disbursed === 'Yes' ? ` · Disbursed ₹${Number(b.disbursed_amount || 0).toLocaleString('en-IN')}` : ''}
                  </Text>
                ))}
              </>
            )}
          </View>
        )}

        {calls.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.section}>Meta Call Logs ({calls.length})</Text>
            {calls.slice().reverse().map((c, i) => (
              <Text key={i} style={styles.activity}>
                {Math.floor((c.duration_seconds || 0) / 60)}m {(c.duration_seconds || 0) % 60}s · {c.disposition || '—'} · {(c.at || '').slice(0, 16)}
              </Text>
            ))}
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.section}>Activity</Text>
          {activities.length === 0 ? <Text style={styles.activity}>No activity yet</Text> :
            activities.slice(0, 15).map((a, i) => (
              <Text key={i} style={styles.activity} data-testid="meta-activity">• {a.detail}</Text>
            ))}
        </View>
      </ScrollView>

      {/* Post-call modal (shared UX pattern, Meta data destination) */}
      <Modal visible={showModal} transparent animationType="slide" onRequestClose={() => setShowModal(false)}>
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Call Outcome</Text>
            {lookingUp ? <ActivityIndicator color="#16a34a" /> : (
              <Text style={styles.duration}>
                {detectedDuration !== null ? `Talk time: ${detectedDuration}s` : 'Duration not detected'}
              </Text>
            )}
            <View style={styles.outcomeGrid}>
              {OUTCOMES.map(o => {
                const disabled = o.id === 'LEAD' && detectedDuration === 0;
                return (
                  <TouchableOpacity key={o.id} disabled={disabled}
                    onPress={() => setOutcome(o.id)}
                    style={[styles.outcomeChip, outcome === o.id && styles.outcomeChipActive, disabled && { opacity: 0.4 }]}
                    data-testid={`meta-outcome-${o.id}`}>
                    <Text style={[styles.outcomeText, outcome === o.id && { color: '#fff' }]}>{o.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <TextInput style={styles.noteInput} value={note} onChangeText={setNote} placeholder="Note (optional)" placeholderTextColor="#9ca3af" data-testid="meta-call-note" />
            <View style={styles.rowBetween}>
              <TouchableOpacity onPress={() => setShowModal(false)} style={styles.cancelBtn}><Text>Cancel</Text></TouchableOpacity>
              <TouchableOpacity onPress={submitCall} disabled={busy} style={styles.saveBtn} data-testid="meta-call-save">
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>Save</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  back: { color: '#6b7280', marginBottom: 10, fontSize: 14 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: '#eee' },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name: { fontSize: 17, fontWeight: 'bold', color: '#111827' },
  status: { fontSize: 12, fontWeight: '700', color: '#7c3aed' },
  field: { fontSize: 14, color: '#374151', marginTop: 6 },
  callBtn: { backgroundColor: '#16a34a', borderRadius: 12, padding: 15, alignItems: 'center', marginBottom: 12 },
  callBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  section: { fontSize: 13, fontWeight: '700', color: '#374151', marginBottom: 6 },
  activity: { fontSize: 13, color: '#6b7280', paddingVertical: 3 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20 },
  sheetTitle: { fontSize: 18, fontWeight: 'bold', marginBottom: 6 },
  duration: { fontSize: 14, color: '#16a34a', fontWeight: '600', marginBottom: 12 },
  outcomeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  outcomeChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 18, backgroundColor: '#f3f4f6' },
  outcomeChipActive: { backgroundColor: '#16a34a' },
  outcomeText: { fontSize: 13, color: '#374151' },
  noteInput: { backgroundColor: '#f3f4f6', borderRadius: 10, padding: 10, fontSize: 14, marginBottom: 14 },
  cancelBtn: { paddingVertical: 12, paddingHorizontal: 20, borderRadius: 10, borderWidth: 1, borderColor: '#e5e7eb' },
  saveBtn: { flex: 1, marginLeft: 12, backgroundColor: '#16a34a', paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  saveText: { color: '#fff', fontWeight: '700' },
});

export default MetaLeadDetailScreen;
