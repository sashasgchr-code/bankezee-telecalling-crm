import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl,
  TextInput, ActivityIndicator, SafeAreaView, StatusBar, ScrollView, Linking, Modal, Alert,
} from 'react-native';
import { getMetaLeads, getMetaFilesReport, getMetaFilesStats, getMetaPartners, assignMetaLead, refreshProfile } from '../services/api';
import { IS_PREVIEW, API_HOST } from '../config';

// ---- Web Meta design tokens (mirrors frontend/src/pages/meta/metaCommon.js) ----
const BRAND = '#0F52BA';
const BRAND_DARK = '#0A192F';

const truthy = (v) => v === true || v === 'true' || v === 1 || v === '1';
const inr = (n) => (n ? `₹${Number(n).toLocaleString('en-IN')}` : '—');
const label = (s) => (s || '').replace(/_/g, ' ');
const fmtDate = (v) => {
  if (!v) return '—';
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v).slice(0, 10);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

const CRM_STATUSES = ['', 'NEW', 'CALL_BACK', 'NOT_ANSWERING', 'SWITCHED_OFF', 'NOT_INTERESTED', 'NOT_QUALIFIED', 'LEAD', 'FILE'];
const PROC_STATUSES = ['', 'New', 'Contacted', 'Documents Collected', 'Documents Pending', 'Sent for Eligibility',
  'Sent for Login', 'Login Done', 'Sent for Approval', 'Approved', 'Disbursed', 'Not Eligible', 'Declined'];

// Lead status pill palette (identical to web STATUS_STYLES)
const STATUS_STYLES = {
  NEW: { bg: '#f1f5f9', text: '#334155', border: '#e2e8f0' },
  CALL_BACK: { bg: '#eff6ff', text: '#1d4ed8', border: '#bfdbfe' },
  NOT_ANSWERING: { bg: '#fffbeb', text: '#b45309', border: '#fde68a' },
  SWITCHED_OFF: { bg: '#fff7ed', text: '#c2410c', border: '#fed7aa' },
  NOT_INTERESTED: { bg: '#f1f5f9', text: '#475569', border: '#e2e8f0' },
  NOT_QUALIFIED: { bg: '#fef2f2', text: '#b91c1c', border: '#fecaca' },
  LEAD: { bg: '#ecfdf5', text: '#047857', border: '#a7f3d0' },
  FILE: { bg: '#f5f3ff', text: '#6d28d9', border: '#ddd6fe' },
};
const StatusPill = ({ status }) => {
  const s = STATUS_STYLES[status] || STATUS_STYLES.NEW;
  return (
    <View style={[styles.pill, { backgroundColor: s.bg, borderColor: s.border }]}>
      <Text style={[styles.pillText, { color: s.text }]}>{label(status) || 'NEW'}</Text>
    </View>
  );
};

// Processing status pill palette (identical to web Files.js STATUS_COLOR)
const GREEN = ['Approved', 'Disbursed', 'Login Done', 'Documents Collected'];
const RED = ['Declined', 'Not Eligible', 'Not Login', 'Not Disbursed', 'FI Negative'];
const AMBER = ['Query/Hold', 'Documents Pending', 'FI Reinitiated', 'Underwriting'];
const BLUE = ['Sent for Eligibility', 'Sent for Login', 'Sent for Approval', 'Contacted', 'FI (Field Investigation)'];
const procStyle = (s) => {
  if (GREEN.includes(s)) return { bg: '#ecfdf5', text: '#047857', border: '#a7f3d0' };
  if (RED.includes(s)) return { bg: '#fef2f2', text: '#b91c1c', border: '#fecaca' };
  if (AMBER.includes(s) || (s || '').includes('Need Help')) return { bg: '#fffbeb', text: '#b45309', border: '#fde68a' };
  if (BLUE.includes(s)) return { bg: '#eff6ff', text: '#1d4ed8', border: '#bfdbfe' };
  return { bg: '#f1f5f9', text: '#475569', border: '#e2e8f0' };
};
const ProcPill = ({ status }) => {
  const st = status || 'New';
  const s = procStyle(st);
  return (
    <View style={[styles.pill, { backgroundColor: s.bg, borderColor: s.border }]}>
      <Text style={[styles.pillText, { color: s.text }]}>{st}</Text>
    </View>
  );
};

// ---- Meta WhatsApp deep link (mirrors web utils/whatsapp.js openMetaWhatsApp) ----
const normalizePhone = (phone) => {
  let clean = String(phone ?? '').split('.')[0].replace(/[^0-9]/g, '').replace(/^0+/, '');
  if (clean.length === 10 || (clean.length > 10 && !clean.startsWith('91'))) clean = '91' + clean;
  return clean;
};
const metaWaMessage = (name, loanType, agent) => `Hi ${name || 'there'},

We have received your application regarding ${loanType || 'loan requirement'} through Instagram/Meta.

We would like to understand your requirement better and discuss the best available solution for you.

If you are looking to consolidate existing debts, reduce your EMI burden, arrange additional funding, or explore a suitable loan option, our team can assist you in checking the available possibilities.

Please call us back on this number or reply here so we can discuss your requirement.

Regards,
${agent || 'Team'}
BankEzee – Loan Consolidation Platform
www.BankEzee.com`;
const openMetaWhatsApp = (phone, name, loanType, agent) => {
  if (!phone) return;
  Linking.openURL(`https://wa.me/${normalizePhone(phone)}?text=${encodeURIComponent(metaWaMessage(name, loanType, agent))}`).catch(() => {});
};

// ---- small building blocks ----
const Field = ({ label: l, value, color }) => (
  <View style={styles.field}>
    <Text style={styles.fieldLabel}>{l}</Text>
    <Text style={[styles.fieldValue, color && { color }]} numberOfLines={1}>{value || '—'}</Text>
  </View>
);

// Permission-gated GP assignment control (Admin/Ops only — backend is final authority).
const AssignGP = ({ lead, partners, onAssigned }) => {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const current = partners.find((p) => p.user_id === lead.assigned_partner_id);
  const currentName = lead.assigned_partner_name || (current && current.name) || 'Unassigned';

  const doAssign = async (partnerId, name) => {
    if (saving) return; // block rapid duplicate taps
    setSaving(true);
    try {
      await assignMetaLead(lead.lead_id, partnerId);
      onAssigned(lead.lead_id, partnerId || null, partnerId ? name : null); // update only after backend confirms
      setOpen(false);
    } catch (e) {
      Alert.alert('Assignment failed', e?.response?.data?.detail || 'Could not update assignment');
    } finally { setSaving(false); }
  };

  return (
    <View style={styles.assignWrap}>
      <View style={{ flex: 1 }}>
        <Text style={styles.fieldLabel}>Assign Growth Partner</Text>
        <Text style={[styles.fieldValue, { color: lead.assigned_partner_id ? '#047857' : '#9ca3af' }]} numberOfLines={1}>{currentName}</Text>
      </View>
      <TouchableOpacity style={styles.assignBtn} onPress={() => setOpen(true)} disabled={saving} data-testid={`meta-assign-open-${lead.lead_id}`}>
        {saving ? <ActivityIndicator size="small" color={BRAND} /> : <Text style={styles.assignBtnText}>{lead.assigned_partner_id ? 'Reassign' : 'Assign'}</Text>}
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => !saving && setOpen(false)}>
          <View style={styles.modalSheet} onStartShouldSetResponder={() => true}>
            <Text style={styles.modalTitle}>Assign Growth Partner</Text>
            <Text style={styles.modalSub} numberOfLines={1}>{lead.full_name || 'Lead'}</Text>
            <FlatList
              data={[{ user_id: '', name: 'Unassigned' }, ...partners]}
              keyExtractor={(p) => p.user_id || 'none'}
              style={{ maxHeight: 320 }}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => {
                const active = (item.user_id || '') === (lead.assigned_partner_id || '');
                return (
                  <TouchableOpacity style={[styles.partnerRow, active && styles.partnerRowActive]} disabled={saving}
                    onPress={() => doAssign(item.user_id || null, item.name)} data-testid={`meta-assign-pick-${item.user_id || 'none'}`}>
                    <Text style={[styles.partnerName, active && { color: BRAND, fontWeight: '700' }]}>{item.name}</Text>
                    {active && <Text style={{ color: BRAND, fontWeight: '700' }}>✓</Text>}
                  </TouchableOpacity>
                );
              }}
            />
            <TouchableOpacity style={styles.modalCancel} onPress={() => !saving && setOpen(false)}><Text style={styles.modalCancelText}>Cancel</Text></TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
};

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
    <View style={styles.dateRow}>
      <Text style={styles.dateLabel}>Date:</Text>
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
  const [partners, setPartners] = useState([]);
  const metaRole = (profile?.meta_role || '').toLowerCase();
  const canAssign = ['admin', 'ops'].includes(metaRole);

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
  useEffect(() => { if (canAssign) getMetaPartners().then(setPartners).catch(() => {}); }, [canAssign]);

  const applyAssign = (leadId, partnerId, name) => {
    setData((d) => ({ ...d, leads: d.leads.map((l) => l.lead_id === leadId ? { ...l, assigned_partner_id: partnerId, assigned_partner_name: name } : l) }));
  };

  const openDetail = (item) => {
    if ((item.status || '').toUpperCase() === 'FILE') {
      navigation.navigate('FileDetail', { fileId: item.lead_id, apiBase: '/meta/files-compat', mode: 'meta', roleOverride: (profile?.meta_role || '').toLowerCase() });
    } else {
      navigation.navigate('MetaLeadDetail', { leadId: item.lead_id, user: profile });
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.searchWrap}>
        <TextInput style={styles.search} value={q} onChangeText={setQ} placeholder="Search name, email, phone, city..." placeholderTextColor="#9ca3af" data-testid="meta-leads-search" />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsScroll} contentContainerStyle={styles.chipsRow}>
        {CRM_STATUSES.map((s) => (
          <TouchableOpacity key={s || 'all'} onPress={() => setStatus(s)} style={[styles.chip, status === s && styles.chipActive]}>
            <Text style={[styles.chipText, status === s && styles.chipTextActive]}>{s ? label(s) : 'ALL'}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      <DateBar preset={preset} setPreset={setPreset} custom={custom} setCustom={setCustom}
        presets={[{ k: 'ALL', label: 'All time' }, { k: 'TODAY', label: 'Today' }, { k: '7D', label: 'Last 7 days' }, { k: '30D', label: 'Last 30 days' }]} />
      {loading ? <ActivityIndicator style={{ marginTop: 30 }} color={BRAND} /> : (
        <FlatList
          data={data.leads}
          keyExtractor={(l) => l.lead_id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
          contentContainerStyle={{ padding: 12, paddingBottom: 96 }}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={<Text style={styles.countLabel}>{data.total} lead(s)</Text>}
          renderItem={({ item }) => (
            <View style={styles.card} data-testid="meta-lead-row">
              <TouchableOpacity onPress={() => openDetail(item)} activeOpacity={0.7}>
                <View style={styles.cardRow}>
                  <View style={{ flex: 1, paddingRight: 8 }}>
                    <Text style={styles.name} numberOfLines={1}>{item.full_name || 'Unnamed'}</Text>
                    {!!item.campaign_name && <Text style={styles.campaign} numberOfLines={1}>{item.campaign_name}</Text>}
                  </View>
                  <StatusPill status={item.status} />
                </View>
              </TouchableOpacity>
              <View style={styles.actionRow}>
                <TouchableOpacity style={[styles.actionBtn, styles.callBtn]} data-testid="meta-card-call"
                  onPress={() => navigation.navigate('MetaLeadDetail', { leadId: item.lead_id, user: profile, autoStartCall: true })}>
                  <Text style={styles.actionText}>📞  Call</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.actionBtn, styles.waBtn]} data-testid="meta-card-whatsapp"
                  onPress={() => openMetaWhatsApp(item.phone, item.full_name, item.file?.loan_type || item.loan_type, profile?.name)}>
                  <Text style={styles.actionText}>💬  WhatsApp</Text>
                </TouchableOpacity>
              </View>
              {canAssign && <AssignGP lead={item} partners={partners} onAssigned={applyAssign} />}
              <View style={styles.grid}>
                <Field label="City" value={item.city} />
                <Field label="Employment" value={item.employment_status} />
                <Field label="Salary" value={item.monthly_salary} />
                <Field label="Outstanding" value={item.outstanding_amount} />
                <Field label="Assigned GP" value={item.assigned_partner_name} color={item.assigned_partner_id ? '#047857' : '#9ca3af'} />
                <Field label="Date" value={fmtDate(item.created_time || item.created_at)} />
              </View>
            </View>
          )}
          ListEmptyComponent={<Text style={styles.empty}>No Meta leads assigned</Text>}
        />
      )}
    </View>
  );
};

// ---------- FILES ----------
const StatCard = ({ label: l, value, accent }) => (
  <View style={styles.statCard}>
    <Text style={styles.statLabel}>{l}</Text>
    <Text style={[styles.statValue, accent && { color: accent }]}>{value}</Text>
  </View>
);

const FilesTab = ({ navigation, profile }) => {
  const [files, setFiles] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [q, setQ] = useState('');
  const [pstatus, setPstatus] = useState('');
  const [preset, setPreset] = useState('ALL');
  const [custom, setCustom] = useState({ from: '', to: '' });
  const metaRole = (profile?.meta_role || '').toLowerCase();
  const metaUid = profile?.meta_user_id;
  const canFilterMine = ['processor', 'admin', 'ops'].includes(metaRole);
  const [myOnly, setMyOnly] = useState(metaRole === 'processor');

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
  useEffect(() => { getMetaFilesStats().then(setStats).catch(() => {}); }, []);

  const shown = files.filter((f) =>
    (!pstatus || (f.processing_status || 'New') === pstatus) &&
    (!myOnly || f.assigned_processor_id === metaUid));

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.statRow}>
        <StatCard label="Total Files" value={stats?.total_files ?? '—'} accent="#6d28d9" />
        <StatCard label="Docs Received" value={stats?.docs_received ?? '—'} accent="#047857" />
        <StatCard label="Docs Pending" value={stats?.pending_docs ?? '—'} accent="#b45309" />
      </View>
      <View style={styles.searchWrap}>
        <TextInput style={styles.search} value={q} onChangeText={setQ} placeholder="Search name, phone, loan type..." placeholderTextColor="#9ca3af" data-testid="meta-files-search" />
      </View>
      {canFilterMine && (
        <TouchableOpacity data-testid="meta-files-my-toggle" onPress={() => setMyOnly((v) => !v)}
          style={[styles.chip, { alignSelf: 'flex-start', marginLeft: 12, marginTop: 6 }, myOnly && styles.chipActive]}>
          <Text style={[styles.chipText, myOnly && styles.chipTextActive]}>👤 My Files</Text>
        </TouchableOpacity>
      )}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsScroll} contentContainerStyle={styles.chipsRow}>
        {PROC_STATUSES.map((s) => (
          <TouchableOpacity key={s || 'all'} onPress={() => setPstatus(s)} style={[styles.chip, pstatus === s && styles.chipActive]}>
            <Text style={[styles.chipText, pstatus === s && styles.chipTextActive]}>{s || 'All Statuses'}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      <DateBar preset={preset} setPreset={setPreset} custom={custom} setCustom={setCustom}
        presets={[{ k: 'ALL', label: 'All time' }, { k: 'TODAY', label: 'Today' }, { k: '7D', label: 'Last 7 days' }, { k: '30D', label: 'Last 30 days' }]} />
      {loading ? <ActivityIndicator style={{ marginTop: 30 }} color={BRAND} /> : (
        <FlatList
          data={shown}
          keyExtractor={(f) => f.lead_id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
          contentContainerStyle={{ padding: 12, paddingBottom: 96 }}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={<Text style={styles.countLabel}>{shown.length} file(s)</Text>}
          renderItem={({ item }) => {
            const file = item.file || {};
            const dt = item.file_created_at || item.created_at;
            const bank = file.disbursed_bank || file.approved_bank || file.login_bank || file.bank || file.lender;
            const docsReceived = file.docs_received ?? item.docs_received;
            return (
              <TouchableOpacity style={styles.card} data-testid="meta-file-row" activeOpacity={0.7}
                onPress={() => navigation.navigate('FileDetail', { fileId: item.lead_id, apiBase: '/meta/files-compat', mode: 'meta', roleOverride: (profile?.meta_role || '').toLowerCase() })}>
                <View style={styles.cardRow}>
                  <View style={{ flex: 1, paddingRight: 8 }}>
                    <Text style={styles.name} numberOfLines={1}>{item.full_name || 'Unnamed'}</Text>
                    <Text style={styles.campaign}>{item.phone || '—'}</Text>
                  </View>
                  <ProcPill status={item.processing_status} />
                </View>
                <View style={styles.grid}>
                  <Field label="Loan Type" value={file.loan_type} />
                  <Field label="Loan Amount" value={file.loan_amount ? inr(file.loan_amount) : null} color="#047857" />
                  <Field label="Assigned GP" value={item.assigned_partner_name} color={item.assigned_partner_id ? '#334155' : '#9ca3af'} />
                  <Field label="Processor" value={item.assigned_processor_name || item.processor_name} />
                  <Field label="Bank / Lender" value={bank} />
                  <Field label="Created" value={dt ? new Date(dt).toLocaleDateString() : null} />
                  <Field label="Docs" value={docsReceived == null ? null : (docsReceived ? 'Received' : 'Pending')} color={docsReceived ? '#047857' : '#b45309'} />
                  <Field label="Assignment" value={item.assigned_partner_id ? 'Assigned' : 'Unassigned'} color={item.assigned_partner_id ? '#047857' : '#9ca3af'} />
                </View>
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
const Metric = ({ label: l, value, sub, accent }) => (
  <View style={styles.metric}>
    <View style={[styles.metricAccent, accent && { backgroundColor: accent }]} />
    <View style={{ flex: 1 }}>
      <Text style={styles.metricLabel}>{l}</Text>
      <Text style={[styles.metricValue, accent && { color: accent }]}>{value}</Text>
      {sub !== undefined && <Text style={styles.metricSub}>{sub}</Text>}
    </View>
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
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 12, paddingBottom: 96 }}>
      <DateBar preset={preset} setPreset={setPreset} custom={custom} setCustom={setCustom}
        presets={[{ k: 'ALL', label: 'All time' }, { k: 'MONTH', label: 'This Month' }]} />
      {loading || !o ? <ActivityIndicator style={{ marginTop: 30 }} color={BRAND} /> : (
        <>
          <Text style={styles.repHdr}>Overall {range.from ? `(${range.from} → ${range.to})` : ''}</Text>
          <View style={styles.metricGrid} data-testid="meta-report-overall">
            <Metric label="Total Files" value={o.total_files} accent="#6d28d9" />
            <Metric label="In Progress" value={o.in_progress} accent="#d97706" />
            <Metric label="Login Done" value={o.login} accent="#2563eb" />
            <Metric label="Approved" value={o.approved} sub={inr(o.approved_amount)} accent="#059669" />
            <Metric label="Disbursed" value={o.disbursed} sub={inr(o.disbursed_amount)} accent="#047857" />
            <Metric label="Rejected" value={o.rejected} accent="#dc2626" />
            <Metric label="Amt in Pipeline" value={inr(o.pipeline_amount)} accent="#2563eb" />
            <Metric label="Total Disbursed" value={inr(o.disbursed_amount)} accent="#047857" />
          </View>
          <Text style={styles.repHdr}>This Month</Text>
          <View style={styles.metricGrid} data-testid="meta-report-this-month">
            <Metric label="New Files" value={m.total_files} accent="#6d28d9" />
            <Metric label="Login Done" value={m.login} accent="#2563eb" />
            <Metric label="Approved" value={m.approved} sub={inr(m.approved_amount)} accent="#059669" />
            <Metric label="Disbursed" value={m.disbursed} sub={inr(m.disbursed_amount)} accent="#047857" />
            <Metric label="Rejected" value={m.rejected} accent="#dc2626" />
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
      <View style={styles.header}>
        <View style={styles.headerDot} />
        <Text style={styles.headerTitle}>Meta CRM</Text>
      </View>

      {checking ? (
        <>
          <ActivityIndicator style={{ marginTop: 40 }} color={BRAND} />
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
  header: { padding: 16, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#eee', flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerDot: { width: 22, height: 22, borderRadius: 11, backgroundColor: BRAND },
  headerTitle: { fontSize: 20, fontWeight: 'bold', color: BRAND_DARK },
  checking: { textAlign: 'center', color: '#6b7280', marginTop: 12, fontSize: 13 },
  tabBar: { flexDirection: 'row', backgroundColor: '#fff', paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: '#eee' },
  tabBtn: { flex: 1, paddingVertical: 12, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabBtnActive: { borderBottomColor: BRAND },
  tabText: { fontSize: 13, color: '#6b7280', fontWeight: '500' },
  tabTextActive: { color: BRAND, fontWeight: '700' },
  searchWrap: { padding: 12, paddingBottom: 4 },
  search: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14 },
  chipsScroll: { maxHeight: 44, flexGrow: 0 },
  chipsRow: { flexDirection: 'row', flexWrap: 'nowrap', gap: 6, paddingHorizontal: 12, paddingVertical: 6, alignItems: 'center' },
  dateRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 12, paddingVertical: 6, alignItems: 'center' },
  dateLabel: { fontSize: 12, color: '#64748b', fontWeight: '600', marginRight: 2 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0' },
  chipActive: { backgroundColor: BRAND, borderColor: BRAND },
  chipText: { fontSize: 11, color: '#64748b', fontWeight: '500' },
  chipTextActive: { color: '#fff', fontWeight: '600' },
  customRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingBottom: 6 },
  dateInput: { flex: 1, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, fontSize: 12 },
  countLabel: { fontSize: 12, color: '#9ca3af', marginBottom: 6 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#eef2f7' },
  cardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  name: { fontSize: 15, fontWeight: '600', color: '#1e293b' },
  campaign: { fontSize: 12, color: '#94a3b8', marginTop: 2 },
  pill: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999, borderWidth: 1, flexShrink: 1, maxWidth: '52%' },
  pillText: { fontSize: 11, fontWeight: '700', textAlign: 'center' },
  actionRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  actionBtn: { flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
  callBtn: { backgroundColor: '#16a34a' },
  waBtn: { backgroundColor: '#25D366' },
  actionText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 12 },
  field: { width: '50%', marginBottom: 8, paddingRight: 6 },
  assignWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#f1f5f9' },
  assignBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: BRAND, minWidth: 84, alignItems: 'center' },
  assignBtnText: { color: BRAND, fontWeight: '700', fontSize: 13 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: '#fff', borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 16, paddingBottom: 28 },
  modalTitle: { fontSize: 16, fontWeight: '700', color: BRAND_DARK },
  modalSub: { fontSize: 12, color: '#94a3b8', marginBottom: 10 },
  partnerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  partnerRowActive: { backgroundColor: '#eff6ff', borderRadius: 8 },
  partnerName: { fontSize: 14, color: '#334155' },
  modalCancel: { marginTop: 12, paddingVertical: 12, alignItems: 'center', backgroundColor: '#f1f5f9', borderRadius: 10 },
  modalCancelText: { color: '#475569', fontWeight: '600' },
  fieldLabel: { fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4, color: '#94a3b8' },
  fieldValue: { fontSize: 13, fontWeight: '600', color: '#334155', marginTop: 1 },
  statRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingTop: 12 },
  statCard: { flex: 1, backgroundColor: '#fff', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#eef2f7' },
  statLabel: { fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4, color: '#94a3b8', fontWeight: '600' },
  statValue: { fontSize: 22, fontWeight: '800', color: BRAND_DARK, marginTop: 4 },
  empty: { textAlign: 'center', color: '#9ca3af', marginTop: 40 },
  denied: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  deniedTitle: { fontSize: 17, fontWeight: '700', color: '#111827', textAlign: 'center' },
  deniedText: { fontSize: 13, color: '#6b7280', textAlign: 'center', marginTop: 8 },
  retry: { marginTop: 18, backgroundColor: BRAND, paddingHorizontal: 22, paddingVertical: 10, borderRadius: 10 },
  retryText: { color: '#fff', fontWeight: '600' },
  repHdr: { fontSize: 14, fontWeight: '700', color: BRAND_DARK, marginTop: 12, marginBottom: 8 },
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  metric: { width: '48%', backgroundColor: '#fff', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#eef2f7', flexDirection: 'row', alignItems: 'center', gap: 10 },
  metricAccent: { width: 4, alignSelf: 'stretch', borderRadius: 2, backgroundColor: '#cbd5e1' },
  metricLabel: { fontSize: 11, color: '#6b7280' },
  metricValue: { fontSize: 20, fontWeight: 'bold', color: '#111827', marginTop: 2 },
  metricSub: { fontSize: 11, color: '#9ca3af', marginTop: 1 },
  diag: { backgroundColor: '#fff7ed', borderWidth: 1, borderColor: '#fdba74', margin: 12, marginBottom: 0, borderRadius: 8, padding: 10 },
  diagTitle: { fontSize: 10, fontWeight: '800', color: '#c2410c', marginBottom: 4, letterSpacing: 0.5 },
  diagLine: { fontSize: 11, color: '#7c2d12', fontFamily: 'monospace' },
});

export default MetaHomeScreen;
