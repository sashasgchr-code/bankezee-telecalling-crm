import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Modal, TextInput,
  ActivityIndicator, SafeAreaView, AppState, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { getMetaLead, addMetaCallLog, addMetaNote, updateMetaStatus } from '../services/api';
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

// Direct status options (change WITHOUT a call) — mirrors backend CRM_STATUSES.
const STATUS_OPTIONS = [
  { id: 'NEW', label: 'New' },
  { id: 'CALL_BACK', label: 'Call Back' },
  { id: 'NOT_ANSWERING', label: 'Not Answering' },
  { id: 'SWITCHED_OFF', label: 'Switched Off' },
  { id: 'NOT_INTERESTED', label: 'Not Interested' },
  { id: 'NOT_QUALIFIED', label: 'Not Qualified' },
  { id: 'LEAD', label: 'Lead' },
  { id: 'FILE', label: 'File' },
];

// Reuses the EXACT Connect native call lifecycle (makePhoneCall + AppState + getRecentCallForNumber),
// but saves the outcome to the isolated Meta API. Connect calling code is untouched.
const MetaLeadDetailScreen = ({ route, navigation }) => {
  const { leadId, user, autoStartCall } = route.params;
  const [lead, setLead] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [detectedDuration, setDetectedDuration] = useState(null);
  const [lookingUp, setLookingUp] = useState(false);
  const [outcome, setOutcome] = useState(null);
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [followUpDate, setFollowUpDate] = useState('');
  const [followUpTime, setFollowUpTime] = useState('');
  const [callStartTime, setCallStartTime] = useState(null);
  const needsFollowUp = outcome === 'CALL_BACK' || outcome === 'NOT_ANSWERING' || outcome === 'SWITCHED_OFF';
  const pendingPhone = useRef(null);
  const callIdRef = useRef(null);
  // Every call is bound to the lead that initiated it. submitCall refuses to save if this
  // no longer matches the screen's current leadId (guards the stale-customer bug).
  const callLeadRef = useRef(null);
  const autoStartedRef = useRef(false);

  const load = useCallback(async () => {
    try { setLead(await getMetaLead(leadId)); } catch (e) {
      Alert.alert('Error', e.response?.data?.detail || 'Failed to load lead');
    } finally { setLoading(false); }
  }, [leadId]);
  useEffect(() => { load(); }, [load]);

  // If this screen instance is reused for a DIFFERENT meta lead, hard-reset all in-flight
  // call state so a finished/older call can never bleed into the new lead's call.
  useEffect(() => {
    setShowModal(false);
    setOutcome(null);
    setNote('');
    setReason('');
    setFollowUpDate('');
    setFollowUpTime('');
    setDetectedDuration(null);
    setLookingUp(false);
    setCallStartTime(null);
    pendingPhone.current = null;
    callIdRef.current = null;
    callLeadRef.current = null;
    autoStartedRef.current = false;
  }, [leadId]);

  const startCall = async () => {
    if (!lead?.phone) { Alert.alert('No phone', 'This lead has no phone number'); return; }
    const now = Date.now();
    setCallStartTime(now);
    callIdRef.current = `meta_${leadId}_${now}`;   // unique per physical call -> backend dedupe
    pendingPhone.current = lead.phone;
    // Bind this call to THIS lead — used to reject a save if the screen later shows another lead.
    callLeadRef.current = { id: leadId, phone: lead.phone, name: lead.full_name };
    setDetectedDuration(null); setOutcome(null); setNote(''); setReason(''); setFollowUpDate(''); setFollowUpTime('');
    await makePhoneCall(lead.phone);
  };

  // Auto-start a call when arriving via the "Call" button on a lead card. Fires once per lead.
  useEffect(() => {
    if (autoStartCall && lead && !loading && !autoStartedRef.current) {
      autoStartedRef.current = true;
      navigation.setParams({ autoStartCall: false });
      startCall();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStartCall, lead, loading]);

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
    if (outcome === 'NOT_QUALIFIED' && !reason.trim()) { Alert.alert('Required', 'Reason is required for Not Qualified'); return; }
    if (needsFollowUp) {
      if (followUpDate && !/^\d{4}-\d{2}-\d{2}$/.test(followUpDate.trim())) {
        Alert.alert('Invalid date', 'Follow-up date must be in YYYY-MM-DD format'); return;
      }
      if (followUpTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(followUpTime.trim())) {
        Alert.alert('Invalid time', 'Follow-up time must be in HH:MM (24h) format'); return;
      }
    }
    setBusy(true);
    try {
      // Refuse to save if the active call is no longer bound to the lead on screen.
      const bound = callLeadRef.current;
      if (!bound || bound.id !== leadId) {
        setShowModal(false); setBusy(false);
        Alert.alert('Call context changed', 'This lead was switched. Reloading — please make the call again.');
        callLeadRef.current = null;
        await load();
        return;
      }
      const isStatus = ['CALL_BACK', 'NOT_ANSWERING', 'SWITCHED_OFF', 'NOT_INTERESTED', 'NOT_QUALIFIED', 'LEAD', 'FILE'].includes(outcome);
      const res = await addMetaCallLog(bound.id, {
        call_id: callIdRef.current || `meta_${bound.id}_${Date.now()}`,
        phone: bound.phone,
        started_at: callStartTime ? new Date(callStartTime).toISOString() : new Date().toISOString(),
        ended_at: new Date().toISOString(),
        duration_seconds: detectedDuration || 0,
        outcome,
        note: note.trim() || null,
        reason: outcome === 'NOT_QUALIFIED' ? reason.trim() : null,
        follow_up_date: needsFollowUp ? (followUpDate.trim() || null) : null,
        follow_up_time: needsFollowUp ? (followUpTime.trim() || null) : null,
        resulting_status: isStatus ? outcome : null,
      });
      setLead(res.lead);
      setShowModal(false); setOutcome(null); setNote(''); setReason(''); setFollowUpDate(''); setFollowUpTime('');
      callLeadRef.current = null; callIdRef.current = null; pendingPhone.current = null;
    } catch (e) {
      Alert.alert('Error', e.response?.data?.detail || 'Failed to save call');
    } finally { setBusy(false); }
  };

  const changeStatus = async (status) => {
    if (!lead || status === lead.status) return;
    try {
      setBusy(true);
      const updated = await updateMetaStatus(leadId, status);
      setLead(updated);
    } catch (e) {
      Alert.alert('Error', e.response?.data?.detail || 'Failed to update status');
    } finally {
      setBusy(false);
    }
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

        {/* Direct status change — no call required */}
        <View style={styles.statusBox}>
          <Text style={styles.section}>Update Status</Text>
          <View style={styles.statusWrap}>
            {STATUS_OPTIONS.map(s => (
              <TouchableOpacity
                key={s.id}
                disabled={busy}
                onPress={() => changeStatus(s.id)}
                style={[styles.statusChip, lead.status === s.id && styles.statusChipActive]}
                data-testid={`meta-status-${s.id}`}
              >
                <Text style={[styles.statusChipText, lead.status === s.id && { color: '#fff' }]}>{s.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

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
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ width: '100%' }}>
          <View style={styles.sheet}>
            <ScrollView style={styles.sheetScroll} contentContainerStyle={{ paddingBottom: 8 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={true}>
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
            {outcome === 'NOT_QUALIFIED' && (
              <View style={styles.fieldBlock}>
                <Text style={styles.fieldLabel}>Reason <Text style={{ color: '#dc2626' }}>*</Text></Text>
                <TextInput style={styles.noteInput} value={reason} onChangeText={setReason} placeholder="Why not qualified?" placeholderTextColor="#9ca3af" data-testid="meta-call-reason" />
              </View>
            )}
            {needsFollowUp && (
              <View style={styles.followRow}>
                <View style={styles.followCol}>
                  <Text style={styles.fieldLabel}>Follow-up Date</Text>
                  <TextInput
                    style={styles.noteInput}
                    value={followUpDate}
                    onChangeText={setFollowUpDate}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor="#9ca3af"
                    keyboardType="numbers-and-punctuation"
                    maxLength={10}
                    data-testid="meta-followup-date"
                  />
                </View>
                <View style={styles.followCol}>
                  <Text style={styles.fieldLabel}>Follow-up Time</Text>
                  <TextInput
                    style={styles.noteInput}
                    value={followUpTime}
                    onChangeText={setFollowUpTime}
                    placeholder="HH:MM"
                    placeholderTextColor="#9ca3af"
                    keyboardType="numbers-and-punctuation"
                    maxLength={5}
                    data-testid="meta-followup-time"
                  />
                </View>
              </View>
            )}
            </ScrollView>
            <View style={[styles.rowBetween, styles.sheetFooter]}>
              <TouchableOpacity onPress={() => { setShowModal(false); callLeadRef.current = null; callIdRef.current = null; pendingPhone.current = null; }} style={styles.cancelBtn}><Text>Cancel</Text></TouchableOpacity>
              <TouchableOpacity onPress={submitCall} disabled={busy} style={styles.saveBtn} data-testid="meta-call-save">
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>Save</Text>}
              </TouchableOpacity>
            </View>
          </View>
          </KeyboardAvoidingView>
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
  statusBox: { backgroundColor: '#fff', borderRadius: 12, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: '#e5e7eb' },
  statusWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statusChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: '#16a34a', backgroundColor: '#f0fdf4' },
  statusChipActive: { backgroundColor: '#16a34a' },
  statusChipText: { fontSize: 12, fontWeight: '700', color: '#16a34a' },
  section: { fontSize: 13, fontWeight: '700', color: '#374151', marginBottom: 6 },
  activity: { fontSize: 13, color: '#6b7280', paddingVertical: 3 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 16, maxHeight: '90%' },
  sheetScroll: { flexShrink: 1 },
  sheetFooter: { marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#f0f0f0' },
  sheetTitle: { fontSize: 18, fontWeight: 'bold', marginBottom: 6 },
  duration: { fontSize: 14, color: '#16a34a', fontWeight: '600', marginBottom: 12 },
  outcomeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  outcomeChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 18, backgroundColor: '#f3f4f6' },
  outcomeChipActive: { backgroundColor: '#16a34a' },
  outcomeText: { fontSize: 13, color: '#374151' },
  noteInput: { backgroundColor: '#f3f4f6', borderRadius: 10, padding: 10, fontSize: 14, marginBottom: 14 },
  fieldBlock: { marginBottom: 2 },
  fieldLabel: { fontSize: 11, fontWeight: '700', color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 5 },
  followRow: { flexDirection: 'row', gap: 12 },
  followCol: { flex: 1 },
  cancelBtn: { paddingVertical: 12, paddingHorizontal: 20, borderRadius: 10, borderWidth: 1, borderColor: '#e5e7eb' },
  saveBtn: { flex: 1, marginLeft: 12, backgroundColor: '#16a34a', paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  saveText: { color: '#fff', fontWeight: '700' },
});

export default MetaLeadDetailScreen;
