import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { checkFileEligibility, getEligibilityHistory } from '../services/api';

const fmtAmt = (v) => {
  if (!v) return '—';
  const n = Number(v);
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(2)} Cr`;
  if (n >= 100000) return `₹${(n / 100000).toFixed(2)} L`;
  return `₹${n.toLocaleString('en-IN')}`;
};

const STATUS = {
  eligible: { bg: '#f0fdf4', border: '#86efac', fg: '#15803d', label: 'ELIGIBLE', dot: '#22c55e' },
  possibly_eligible: { bg: '#fffbeb', border: '#fcd34d', fg: '#b45309', label: 'POSSIBLE', dot: '#f59e0b' },
  not_eligible: { bg: '#fef2f2', border: '#fca5a5', fg: '#b91c1c', label: 'NOT ELIGIBLE', dot: '#ef4444' },
};

const strengthColor = (s) => ({
  Strong: { bg: '#dcfce7', fg: '#15803d' },
  Moderate: { bg: '#fef3c7', fg: '#b45309' },
  Fair: { bg: '#dbeafe', fg: '#1d4ed8' },
  Weak: { bg: '#ffedd5', fg: '#c2410c' },
  'Not Eligible': { bg: '#fee2e2', fg: '#b91c1c' },
}[s] || { bg: '#f3f4f6', fg: '#6b7280' });

const RuleRow = ({ r }) => {
  const color = r.result === 'PASS' ? '#16a34a' : r.result === 'FAIL' ? '#dc2626' : '#d97706';
  const icon = r.result === 'PASS' ? '✓' : r.result === 'FAIL' ? '✕' : '⚠';
  return (
    <View style={styles.ruleRow}>
      <Text style={styles.ruleName}>{r.rule}</Text>
      <Text style={styles.ruleCust}>{r.customer}</Text>
      <Text style={styles.ruleReq}>{r.required}</Text>
      <Text style={[styles.ruleResult, { color }]}>{icon} {r.result}</Text>
    </View>
  );
};

const BankCard = ({ r, expanded, onToggle }) => {
  const cfg = STATUS[r.eligibility] || STATUS.not_eligible;
  return (
    <View style={[styles.bankCard, { backgroundColor: cfg.bg, borderColor: cfg.border }]} data-testid={`elig-bank-${r.bank_name}`}>
      <TouchableOpacity onPress={onToggle} activeOpacity={0.7}>
        <View style={styles.bankHead}>
          <View style={{ flex: 1 }}>
            <View style={styles.rowWrap}>
              {!!r.rank && r.rank <= 3 && <View style={styles.rankBadge}><Text style={styles.rankText}>#{r.rank}</Text></View>}
              <Text style={styles.bankName}>{r.bank_name}</Text>
              <View style={[styles.statusChip, { borderColor: cfg.border }]}>
                <View style={[styles.statusDot, { backgroundColor: cfg.dot }]} />
                <Text style={[styles.statusChipText, { color: cfg.fg }]}>{cfg.label}</Text>
              </View>
            </View>
            <View style={styles.metricsRow}>
              <Text style={styles.metric}>Amount: <Text style={[styles.metricVal, { color: cfg.fg }]}>{r.eligible_amount ? fmtAmt(r.eligible_amount) : '—'}</Text></Text>
              <Text style={styles.metric}>ROI: <Text style={styles.metricVal}>{r.roi_range || '—'}</Text></Text>
              {!!r.tenure_text && <Text style={styles.metric}>Tenure: <Text style={styles.metricVal}>{r.tenure_text}</Text></Text>}
            </View>
          </View>
          <Text style={styles.chevron}>{expanded ? '▲' : '▼'}</Text>
        </View>
      </TouchableOpacity>

      {expanded && (
        <View style={styles.bankBody}>
          <View style={styles.detailGrid}>
            {!!r.salary_text && <Detail label="Min Salary" value={r.salary_text} />}
            {!!r.cibil_text && <Detail label="CIBIL" value={r.cibil_text} />}
            {!!r.age_text && <Detail label="Age" value={r.age_text} />}
            {!!r.foir_text && <Detail label="FOIR" value={r.foir_text} />}
            {!!r.estimated_emi && <Detail label="Est. EMI" value={fmtAmt(r.estimated_emi)} />}
            {!!r.company_requirement_text && <Detail label="Company" value={r.company_requirement_text} />}
          </View>

          {r.reasons_pass?.length > 0 && (
            <>
              <Text style={[styles.sectionLabel, { color: '#15803d' }]}>✓ CRITERIA MET</Text>
              {r.reasons_pass.map((rr, i) => <RuleRow key={i} r={rr} />)}
            </>
          )}
          {r.reasons_fail?.length > 0 && (
            <>
              <Text style={[styles.sectionLabel, { color: '#b91c1c' }]}>✕ NOT ELIGIBLE REASONS</Text>
              {r.reasons_fail.map((rr, i) => <RuleRow key={i} r={rr} />)}
            </>
          )}
          {r.reasons_warning?.length > 0 && (
            <>
              <Text style={[styles.sectionLabel, { color: '#b45309' }]}>⚠ RISKS / MISSING DATA</Text>
              {r.reasons_warning.map((rr, i) => <RuleRow key={i} r={rr} />)}
            </>
          )}
          {!!r.special_features && <Text style={styles.featureText}>Features: {r.special_features}</Text>}
          {!!r.processing_fee && <Text style={styles.featureText}>Processing Fee: {r.processing_fee}</Text>}
        </View>
      )}
    </View>
  );
};

const Detail = ({ label, value }) => (
  <View style={styles.detailItem}>
    <Text style={styles.detailLabel}>{label}</Text>
    <Text style={styles.detailValue}>{value}</Text>
  </View>
);

const EligibilityScreen = ({ route, navigation }) => {
  const { fileId } = route.params;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState({});
  const [showNotEligible, setShowNotEligible] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState([]);

  const runCheck = useCallback(async () => {
    setLoading(true);
    try {
      const res = await checkFileEligibility(fileId);
      setData(res);
    } catch (e) {
      Alert.alert('Error', e.response?.data?.detail || 'Failed to run eligibility check');
    } finally {
      setLoading(false);
    }
  }, [fileId]);

  useEffect(() => { runCheck(); }, [runCheck]);

  const loadHistory = async () => {
    try {
      const res = await getEligibilityHistory(fileId);
      setHistory(res || []);
    } catch { /* ignore */ }
  };

  const toggle = (id) => setExpanded(prev => ({ ...prev, [id]: !prev[id] }));

  const results = data?.results || [];
  const eligible = results.filter(r => r.eligibility === 'eligible');
  const possibly = results.filter(r => r.eligibility === 'possibly_eligible');
  const notEligible = results.filter(r => r.eligibility === 'not_eligible');
  const p = data?.profile || {};
  const strength = strengthColor(data?.profile_strength);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <TouchableOpacity onPress={() => navigation.goBack()} data-testid="elig-back"><Text style={styles.backText}>← Back</Text></TouchableOpacity>
          <View style={styles.headerBtns}>
            <TouchableOpacity onPress={runCheck} disabled={loading} style={styles.smallBtn} data-testid="elig-recheck">
              <Text style={styles.smallBtnText}>{loading ? 'Analysing…' : '⟳ Recheck'}</Text>
            </TouchableOpacity>
            {data && (
              <TouchableOpacity onPress={() => { setShowHistory(!showHistory); if (!showHistory && history.length === 0) loadHistory(); }} style={styles.smallBtnOutline} data-testid="elig-history">
                <Text style={styles.smallBtnOutlineText}>History</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
        <Text style={styles.title} data-testid="eligibility-title">Bank Eligibility Analysis</Text>
        <Text style={styles.sub}>{p.full_name || '—'}{p.requirement ? ` — ${p.requirement}` : ''}</Text>
      </View>

      {loading && !data ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color="#16a34a" />
          <Text style={styles.loadingText}>Analysing eligibility across lenders…</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          {data && (
            <>
              {data.insufficient_data && (
                <View style={styles.warnBanner} data-testid="elig-insufficient">
                  <Text style={styles.warnTitle}>Not enough information for a meaningful check</Text>
                  <Text style={styles.warnText}>Add the following in File Details, then re-run:</Text>
                  <View style={styles.tagWrap}>
                    {(data.required_missing || []).map((m, i) => <View key={i} style={styles.warnTag}><Text style={styles.warnTagText}>{m}</Text></View>)}
                  </View>
                </View>
              )}

              {/* Profile summary */}
              <View style={styles.card} data-testid="elig-profile-summary">
                <View style={styles.rowBetween}>
                  <Text style={styles.cardTitle}>Customer Profile</Text>
                  <View style={[styles.strengthPill, { backgroundColor: strength.bg }]}>
                    <Text style={[styles.strengthText, { color: strength.fg }]}>{data.profile_strength} Profile</Text>
                  </View>
                </View>
                <View style={styles.profileGrid}>
                  <ProfileStat label="CIBIL" value={p.cibil_score || '—'} />
                  <ProfileStat label="Net Salary" value={p.net_salary ? `₹${Number(p.net_salary).toLocaleString()}` : '—'} />
                  <ProfileStat label="EMI" value={p.existing_emi ? `₹${Number(p.existing_emi).toLocaleString()}` : '—'} />
                  <ProfileStat label="FOIR" value={p.foir ? `${p.foir}%` : '—'} />
                  <ProfileStat label="Requested" value={p.loan_amount_required ? fmtAmt(p.loan_amount_required) : '—'} />
                  <ProfileStat label="Company" value={p.company_type || '—'} />
                </View>
                <View style={styles.countsRow}>
                  <Count dot="#22c55e" text={`${data.eligible_count} Eligible`} color="#15803d" />
                  <Count dot="#f59e0b" text={`${data.possibly_eligible_count} Possible`} color="#b45309" />
                  <Count dot="#ef4444" text={`${data.not_eligible_count} Not`} color="#b91c1c" />
                  <Text style={styles.ofTotal}>of {data.total_policies}</Text>
                </View>
              </View>

              {/* History */}
              {showHistory && (
                <View style={styles.card} data-testid="elig-history-panel">
                  <Text style={styles.cardTitle}>Previous Checks</Text>
                  {history.length === 0 ? (
                    <Text style={styles.mutedText}>No previous checks found</Text>
                  ) : history.map((h, i) => (
                    <View key={h.id || i} style={styles.historyRow}>
                      <Text style={styles.historyDate}>{new Date(h.generated_at).toLocaleString()} — {h.generated_by}</Text>
                      <Text style={styles.historyCounts}>
                        <Text style={{ color: '#15803d' }}>{h.eligible_count}E </Text>
                        <Text style={{ color: '#b45309' }}>{h.possibly_eligible_count}P </Text>
                        <Text style={{ color: '#b91c1c' }}>{h.not_eligible_count}N</Text>
                      </Text>
                    </View>
                  ))}
                </View>
              )}

              {/* Eligible */}
              {eligible.length > 0 && (
                <>
                  <Text style={styles.groupHeader} data-testid="elig-recommended">🏆 RECOMMENDED ({eligible.length})</Text>
                  {eligible.map(r => <BankCard key={r.policy_id} r={r} expanded={expanded[r.policy_id]} onToggle={() => toggle(r.policy_id)} />)}
                </>
              )}
              {possibly.length > 0 && (
                <>
                  <Text style={styles.groupHeader}>❔ POSSIBLY ELIGIBLE ({possibly.length})</Text>
                  {possibly.map(r => <BankCard key={r.policy_id} r={r} expanded={expanded[r.policy_id]} onToggle={() => toggle(r.policy_id)} />)}
                </>
              )}
              {notEligible.length > 0 && (
                <>
                  <TouchableOpacity onPress={() => setShowNotEligible(!showNotEligible)} style={styles.notEligibleToggle} data-testid="elig-not-eligible-toggle">
                    <Text style={styles.notEligibleToggleText}>{showNotEligible ? '▲' : '▼'} NOT ELIGIBLE ({notEligible.length})</Text>
                  </TouchableOpacity>
                  {showNotEligible && notEligible.map(r => <BankCard key={r.policy_id} r={r} expanded={expanded[r.policy_id]} onToggle={() => toggle(r.policy_id)} />)}
                </>
              )}

              <Text style={styles.disclaimer}>
                This assessment is indicative only and does not constitute lender approval. Final eligibility is determined by the bank/NBFC after underwriting.
              </Text>
            </>
          )}
          <View style={{ height: 40 }} />
        </ScrollView>
      )}
    </View>
  );
};

const ProfileStat = ({ label, value }) => (
  <View style={styles.profileStat}>
    <Text style={styles.profileValue}>{value}</Text>
    <Text style={styles.profileLabel}>{label}</Text>
  </View>
);

const Count = ({ dot, text, color }) => (
  <View style={styles.countItem}>
    <View style={[styles.countDot, { backgroundColor: dot }]} />
    <Text style={[styles.countText, { color }]}>{text}</Text>
  </View>
);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  header: { paddingHorizontal: 16, paddingTop: 50, paddingBottom: 12, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e5e7eb' },
  headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  backText: { fontSize: 15, color: '#16a34a', fontWeight: '600' },
  headerBtns: { flexDirection: 'row', gap: 8 },
  smallBtn: { backgroundColor: '#16a34a', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  smallBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  smallBtnOutline: { borderWidth: 1, borderColor: '#d1d5db', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  smallBtnOutlineText: { color: '#374151', fontSize: 13, fontWeight: '600' },
  title: { fontSize: 20, fontWeight: '700', color: '#111827' },
  sub: { fontSize: 13, color: '#6b7280', marginTop: 2 },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  loadingText: { marginTop: 12, color: '#6b7280', fontSize: 14, textAlign: 'center' },
  body: { padding: 12 },
  warnBanner: { backgroundColor: '#fffbeb', borderWidth: 1, borderColor: '#fcd34d', borderRadius: 10, padding: 12, marginBottom: 12 },
  warnTitle: { fontSize: 14, fontWeight: '700', color: '#92400e' },
  warnText: { fontSize: 13, color: '#b45309', marginTop: 4 },
  card: { backgroundColor: '#fff', borderRadius: 10, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: '#e5e7eb' },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { fontSize: 14, fontWeight: '700', color: '#374151' },
  strengthPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  strengthText: { fontSize: 12, fontWeight: '700' },
  profileGrid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 12 },
  profileStat: { width: '33.33%', alignItems: 'center', backgroundColor: '#f9fafb', paddingVertical: 10, borderRadius: 8, marginBottom: 4 },
  profileValue: { fontSize: 15, fontWeight: '700', color: '#111827' },
  profileLabel: { fontSize: 10, color: '#9ca3af', textTransform: 'uppercase', marginTop: 2 },
  countsRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12, flexWrap: 'wrap', gap: 12 },
  countItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  countDot: { width: 10, height: 10, borderRadius: 5 },
  countText: { fontSize: 13, fontWeight: '600' },
  ofTotal: { fontSize: 12, color: '#9ca3af', marginLeft: 'auto' },
  mutedText: { fontSize: 13, color: '#9ca3af', marginTop: 6 },
  historyRow: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f3f4f6', flexDirection: 'row', justifyContent: 'space-between' },
  historyDate: { fontSize: 12, color: '#374151', flex: 1 },
  historyCounts: { fontSize: 12, fontWeight: '600' },
  groupHeader: { fontSize: 13, fontWeight: '700', color: '#374151', marginBottom: 8, marginTop: 4 },
  bankCard: { borderRadius: 10, borderWidth: 1, marginBottom: 8, overflow: 'hidden' },
  bankHead: { flexDirection: 'row', alignItems: 'flex-start', padding: 12 },
  rowWrap: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  rankBadge: { backgroundColor: '#fbbf24', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 1 },
  rankText: { fontSize: 10, fontWeight: '700', color: '#78350f' },
  bankName: { fontSize: 15, fontWeight: '700', color: '#111827' },
  statusChip: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 2 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusChipText: { fontSize: 10, fontWeight: '700' },
  metricsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 6 },
  metric: { fontSize: 12, color: '#6b7280' },
  metricVal: { fontWeight: '700', color: '#374151' },
  chevron: { fontSize: 12, color: '#9ca3af', marginLeft: 8, marginTop: 4 },
  bankBody: { paddingHorizontal: 12, paddingBottom: 12, borderTopWidth: 1, borderTopColor: 'rgba(0,0,0,0.06)', paddingTop: 10 },
  detailGrid: { flexDirection: 'row', flexWrap: 'wrap', backgroundColor: 'rgba(255,255,255,0.6)', borderRadius: 8, padding: 8 },
  detailItem: { width: '50%', marginBottom: 6 },
  detailLabel: { fontSize: 10, color: '#9ca3af' },
  detailValue: { fontSize: 13, color: '#374151', fontWeight: '600' },
  sectionLabel: { fontSize: 11, fontWeight: '700', marginTop: 12, marginBottom: 4 },
  ruleRow: { flexDirection: 'row', paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.05)' },
  ruleName: { flex: 2, fontSize: 11, color: '#374151', fontWeight: '600' },
  ruleCust: { flex: 1.5, fontSize: 11, color: '#6b7280' },
  ruleReq: { flex: 1.5, fontSize: 11, color: '#9ca3af' },
  ruleResult: { flex: 1.2, fontSize: 11, fontWeight: '700', textAlign: 'right' },
  featureText: { fontSize: 12, color: '#6b7280', marginTop: 8, fontStyle: 'italic' },
  notEligibleToggle: { paddingVertical: 8 },
  notEligibleToggleText: { fontSize: 13, fontWeight: '600', color: '#dc2626' },
  disclaimer: { fontSize: 11, color: '#9ca3af', backgroundColor: '#f3f4f6', padding: 12, borderRadius: 8, marginTop: 12, borderWidth: 1, borderColor: '#e5e7eb' },
  tagWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  warnTag: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#fcd34d', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4, marginRight: 6, marginBottom: 6 },
  warnTagText: { fontSize: 11, color: '#b45309', fontWeight: '600' },
});

export default EligibilityScreen;
