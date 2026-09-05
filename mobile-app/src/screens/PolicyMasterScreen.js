import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator, RefreshControl } from 'react-native';
import { getPolicies } from '../services/api';

const LOAN_TYPES = [
  { value: '', label: 'All' },
  { value: 'personal_loan', label: 'Personal' },
  { value: 'home_loan', label: 'Home' },
  { value: 'business_loan', label: 'Business' },
  { value: 'car_loan', label: 'Car' },
  { value: 'lap', label: 'LAP' },
  { value: 'education_loan', label: 'Education' },
  { value: 'gold_loan', label: 'Gold' },
];

const fmtCurrency = (a) => {
  if (!a) return '-';
  const n = Number(a);
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(1)} Cr`;
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)} L`;
  return `₹${n.toLocaleString('en-IN')}`;
};

const Field = ({ label, value }) => (
  <View style={styles.field}>
    <Text style={styles.fieldLabel}>{label}</Text>
    <Text style={styles.fieldValue}>{value || '-'}</Text>
  </View>
);

const PolicyCard = ({ policy, expanded, onToggle }) => (
  <View style={styles.card} data-testid={`policy-card-${policy.bank_name}`}>
    <TouchableOpacity style={styles.cardHead} onPress={onToggle} activeOpacity={0.7}>
      <View style={{ flex: 1 }}>
        <View style={styles.rowCenter}>
          <View style={[styles.bankDot, { backgroundColor: policy.is_active ? '#dcfce7' : '#f3f4f6' }]}>
            <Text style={{ fontSize: 16 }}>🏦</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.bankName}>{policy.bank_name}</Text>
            <Text style={styles.bankSub} numberOfLines={1}>
              {(policy.salary_text || (policy.min_salary ? `Min ₹${Number(policy.min_salary).toLocaleString()}` : 'Any salary'))}
              {' · '}
              {(policy.cibil_text || (policy.min_cibil ? `CIBIL ${policy.min_cibil}+` : 'All CIBIL'))}
            </Text>
          </View>
        </View>
      </View>
      <View style={styles.rowCenter}>
        <View style={[styles.statusPill, { backgroundColor: policy.is_active ? '#dcfce7' : '#f3f4f6' }]}>
          <Text style={[styles.statusText, { color: policy.is_active ? '#15803d' : '#6b7280' }]}>{policy.is_active ? 'Active' : 'Inactive'}</Text>
        </View>
        <Text style={styles.chevron}>{expanded ? '▲' : '▼'}</Text>
      </View>
    </TouchableOpacity>

    {expanded && (
      <View style={styles.cardBody}>
        <Text style={styles.groupTitle}>Basic Criteria</Text>
        <View style={styles.grid}>
          <Field label="Min Salary" value={policy.salary_text || fmtCurrency(policy.min_salary)} />
          <Field label="Min CIBIL" value={policy.cibil_text || (policy.min_cibil || 'No Min')} />
          <Field label="Max FOIR" value={policy.foir_text || `${policy.max_foir || 50}%`} />
          <Field label="Profiles" value={policy.applicable_profiles || 'Salaried'} />
        </View>

        <Text style={styles.groupTitle}>Loan Parameters</Text>
        <View style={styles.grid}>
          <Field label="Loan Amount" value={policy.loan_amount_text || `${fmtCurrency(policy.min_loan_amount)} - ${fmtCurrency(policy.max_loan_amount)}`} />
          <Field label="Tenure" value={policy.tenure_text || `${policy.min_tenure || 0}-${policy.max_tenure || 60} mo`} />
          <Field label="ROI" value={policy.roi_text || (policy.roi_min ? `${policy.roi_min}% - ${policy.roi_max}%` : '-')} />
          <Field label="Processing Fee" value={policy.processing_fee} />
        </View>

        <Text style={styles.groupTitle}>Employment</Text>
        <View style={styles.grid}>
          <Field label="Companies" value={policy.company_requirement_text || policy.company_categories} />
          <Field label="Eligible Emp." value={policy.eligible_employees} />
          <Field label="Present Emp." value={policy.present_employment_text || `${policy.min_present_employment_months || 0} mo`} />
          <Field label="Total Emp." value={policy.total_employment_text || `${policy.min_total_employment_months || 0} mo`} />
        </View>

        <Text style={styles.groupTitle}>Age & Accommodation</Text>
        <View style={styles.grid}>
          <Field label="Age Limit" value={policy.age_text || `${policy.min_age || 21}-${policy.max_age || 60}`} />
          <Field label="Bachelor" value={policy.bachelor_accommodation ? 'Allowed' : 'Not Allowed'} />
          <Field label="Hostel" value={policy.hostel_accommodation ? 'Allowed' : 'Not Allowed'} />
          <Field label="Locations" value={policy.serviceable_locations?.join(', ') || 'All India'} />
        </View>

        <Text style={styles.groupTitle}>BT & Top-up</Text>
        <View style={styles.grid}>
          <Field label="BT" value={policy.bt_text || (policy.bt_allowed ? `Yes (Max ${policy.max_bt_count || 0})` : 'No')} />
          <Field label="App Loan BT" value={policy.bt_app_loans_text || (policy.app_loan_bt ? 'Allowed' : 'Not Allowed')} />
          <Field label="CC BT" value={policy.cc_bt_allowed ? 'Allowed' : 'Not Allowed'} />
          <Field label="Top-up" value={policy.topup_text || (policy.topup_allowed ? 'Allowed' : 'Not Allowed')} />
        </View>

        {!!policy.special_features && (
          <View style={styles.noteBox}><Text style={styles.noteTitle}>Special Features</Text><Text style={styles.noteText}>{policy.special_features}</Text></View>
        )}
        {!!policy.special_notes && (
          <View style={[styles.noteBox, { backgroundColor: '#fffbeb', borderColor: '#fde68a' }]}><Text style={[styles.noteTitle, { color: '#b45309' }]}>Special Notes</Text><Text style={[styles.noteText, { color: '#92400e' }]}>{policy.special_notes}</Text></View>
        )}
        {policy.required_documents?.length > 0 && (
          <>
            <Text style={styles.groupTitle}>Required Documents</Text>
            <View style={styles.tagWrap}>
              {policy.required_documents.map((d, i) => <View key={i} style={styles.tag}><Text style={styles.tagText}>{d}</Text></View>)}
            </View>
          </>
        )}
      </View>
    )}
  </View>
);

const PolicyMasterScreen = ({ navigation }) => {
  const [policies, setPolicies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [loanType, setLoanType] = useState('');
  const [expanded, setExpanded] = useState(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await getPolicies(loanType ? { loan_type: loanType } : {});
      setPolicies(res.policies || []);
    } catch (e) {
      console.error('Policies error', e?.message);
      setPolicies([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [loanType]);

  useEffect(() => { load(); }, [load]);

  const onRefresh = () => { setRefreshing(true); load(); };

  const filtered = policies.filter(p =>
    !search ||
    p.bank_name?.toLowerCase().includes(search.toLowerCase()) ||
    p.special_notes?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        {navigation && (
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} data-testid="policy-back">
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>
        )}
        <Text style={styles.title}>Policy Master</Text>
        <Text style={styles.sub}>{policies.length} bank policies configured</Text>
        <TextInput
          style={styles.searchInput}
          placeholder="Search by bank name..."
          placeholderTextColor="#9ca3af"
          value={search}
          onChangeText={setSearch}
          data-testid="policy-search"
        />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow}>
          {LOAN_TYPES.map(lt => (
            <TouchableOpacity
              key={lt.value}
              style={[styles.filterChip, loanType === lt.value && styles.filterChipActive]}
              onPress={() => setLoanType(lt.value)}
              data-testid={`policy-filter-${lt.value || 'all'}`}
            >
              <Text style={[styles.filterChipText, loanType === lt.value && styles.filterChipTextActive]}>{lt.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#16a34a']} />}
      >
        {loading ? (
          <ActivityIndicator color="#16a34a" style={{ marginTop: 40 }} />
        ) : filtered.length === 0 ? (
          <Text style={styles.empty}>No policies found</Text>
        ) : (
          filtered.map(p => (
            <PolicyCard key={p.id} policy={p} expanded={expanded === p.id} onToggle={() => setExpanded(expanded === p.id ? null : p.id)} />
          ))
        )}
        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  header: { paddingHorizontal: 16, paddingTop: 50, paddingBottom: 12, backgroundColor: '#fff' },
  backBtn: { marginBottom: 6 },
  backText: { fontSize: 15, color: '#16a34a', fontWeight: '600' },
  title: { fontSize: 22, fontWeight: '700', color: '#111827' },
  sub: { fontSize: 13, color: '#6b7280', marginTop: 2 },
  searchInput: { marginTop: 12, borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: '#111827', backgroundColor: '#f9fafb' },
  filterRow: { flexDirection: 'row', marginTop: 10 },
  filterChip: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, backgroundColor: '#f3f4f6', marginRight: 8 },
  filterChipActive: { backgroundColor: '#16a34a' },
  filterChipText: { fontSize: 13, color: '#6b7280', fontWeight: '500' },
  filterChipTextActive: { color: '#fff' },
  body: { padding: 12 },
  card: { backgroundColor: '#fff', borderRadius: 10, marginBottom: 10, borderWidth: 1, borderColor: '#e5e7eb', overflow: 'hidden' },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12 },
  rowCenter: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  bankDot: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  bankName: { fontSize: 15, fontWeight: '700', color: '#111827' },
  bankSub: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  statusPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  statusText: { fontSize: 11, fontWeight: '600' },
  chevron: { fontSize: 12, color: '#9ca3af', marginLeft: 8 },
  cardBody: { padding: 12, backgroundColor: '#f9fafb', borderTopWidth: 1, borderTopColor: '#e5e7eb' },
  groupTitle: { fontSize: 11, fontWeight: '700', color: '#6b7280', textTransform: 'uppercase', marginTop: 12, marginBottom: 6 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  field: { width: '50%', marginBottom: 8, paddingRight: 8 },
  fieldLabel: { fontSize: 11, color: '#9ca3af' },
  fieldValue: { fontSize: 13, color: '#111827', fontWeight: '600', marginTop: 1 },
  noteBox: { backgroundColor: '#eff6ff', borderWidth: 1, borderColor: '#bfdbfe', borderRadius: 8, padding: 10, marginTop: 10 },
  noteTitle: { fontSize: 11, fontWeight: '700', color: '#1d4ed8', marginBottom: 2 },
  noteText: { fontSize: 13, color: '#1e40af' },
  tagWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tag: { backgroundColor: '#f3f4f6', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, marginRight: 6, marginBottom: 6 },
  tagText: { fontSize: 12, color: '#374151' },
  empty: { textAlign: 'center', color: '#9ca3af', marginTop: 40, fontSize: 14 },
});

export default PolicyMasterScreen;
