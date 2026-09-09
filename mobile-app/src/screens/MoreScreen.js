import React from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert } from 'react-native';

const ITEMS = {
  MyTeam: { icon: '👥', label: 'My Team', desc: 'Your mapped team & stats' },
  TLTeamLeads: { icon: '🎯', label: 'Team Leads (TL)', desc: 'Second-level calling on GP-generated leads' },
  Reports: { icon: '📈', label: 'Reports', desc: 'Team performance summary' },
  MyHourly: { icon: '⏱️', label: 'My Hourly Report', desc: 'Your own calls, leads & files by hour' },
  TeamHourly: { icon: '📊', label: 'Team Hourly Report', desc: "Your team's activity by hour" },
  Attendance: { icon: '📅', label: 'Attendance', desc: 'Check-in & monthly summary' },
  TeamAttendance: { icon: '🗓️', label: 'Team Attendance', desc: "Your team's attendance today" },
  PolicyMaster: { icon: '🏦', label: 'Policy Master', desc: 'Bank policies & criteria' },
  Leave: { icon: '🌴', label: 'Leave', desc: 'Your leave & WFH requests' },
};

// Menu contents per mobile role. Tabs already cover the primary screens for each role.
const MENU_BY_ROLE = {
  gp: ['MyHourly', 'Attendance', 'PolicyMaster', 'Leave'],
  tl: ['MyTeam', 'TLTeamLeads', 'Reports', 'MyHourly', 'TeamHourly', 'Attendance', 'PolicyMaster', 'Leave'],
  manager: ['TLTeamLeads', 'TeamHourly', 'TeamAttendance', 'PolicyMaster', 'Leave'],
};

// Map menu keys to the actual navigator screen + params.
const navTarget = {
  MyHourly: ['HourlyReport', { scope: 'self' }],
  TeamHourly: ['HourlyReport', { scope: 'team' }],
};

const MoreScreen = ({ navigation, user, mobileRole = 'gp', onLogout }) => {
  const keys = MENU_BY_ROLE[mobileRole] || MENU_BY_ROLE.gp;

  const confirmLogout = () => {
    Alert.alert('Logout', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Logout', style: 'destructive', onPress: onLogout },
    ]);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>More</Text>
        <Text style={styles.sub}>{user?.name || user?.email}</Text>
      </View>

      {/* TEMP PREVIEW-ONLY diagnostic - shows what the phone actually received */}
      {String(process.env.EXPO_PUBLIC_API_URL || '').includes('preview') && (
        <View style={{ backgroundColor: '#fef9c3', borderColor: '#fde047', borderWidth: 1, margin: 12, padding: 10, borderRadius: 8 }}>
          <Text style={{ fontSize: 11, fontWeight: '700', color: '#854d0e' }}>META DIAGNOSTIC (preview only)</Text>
          <Text style={{ fontSize: 11, color: '#713f12' }}>META ACCESS: {String(user?.meta_access)}</Text>
          <Text style={{ fontSize: 11, color: '#713f12' }}>META ROLE: {String(user?.meta_role)}</Text>
          <Text style={{ fontSize: 11, color: '#713f12' }}>META USER ID: {String(user?.meta_user_id)}</Text>
          <Text style={{ fontSize: 11, color: '#713f12' }}>EMAIL: {String(user?.email)}</Text>
          <Text style={{ fontSize: 11, color: '#713f12' }}>API: {String(process.env.EXPO_PUBLIC_API_URL || '').replace('https://', '').replace('/api', '')}</Text>
          <Text style={{ fontSize: 11, color: '#713f12' }}>BUILD: 2.6.6 / vc23 · Meta tab: {(user?.meta_access === true || user?.meta_access === 'true') && String(user?.meta_role || '').trim().toLowerCase() === 'growth_partner' ? 'SHOULD SHOW' : 'HIDDEN'}</Text>
        </View>
      )}

      <ScrollView contentContainerStyle={styles.body}>
        {keys.map(key => {
          const item = ITEMS[key];
          if (!item) return null;
          return (
            <TouchableOpacity
              key={key}
              style={styles.row}
              onPress={() => {
                const [screen, params] = navTarget[key] || [key, undefined];
                navigation.navigate(screen, params);
              }}
              activeOpacity={0.7}
              data-testid={`more-${key.toLowerCase()}`}
            >
              <Text style={styles.icon}>{item.icon}</Text>
              <View style={styles.rowText}>
                <Text style={styles.label}>{item.label}</Text>
                <Text style={styles.desc}>{item.desc}</Text>
              </View>
              <Text style={styles.arrow}>›</Text>
            </TouchableOpacity>
          );
        })}

        <TouchableOpacity style={styles.logoutBtn} onPress={confirmLogout} data-testid="more-logout">
          <Text style={styles.logoutText}>Log Out</Text>
        </TouchableOpacity>
        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  header: { paddingHorizontal: 20, paddingTop: 50, paddingBottom: 16, backgroundColor: '#fff' },
  title: { fontSize: 24, fontWeight: '700', color: '#111827' },
  sub: { fontSize: 13, color: '#6b7280', marginTop: 2 },
  body: { padding: 12 },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 10, borderWidth: 1, borderColor: '#e5e7eb' },
  icon: { fontSize: 22, marginRight: 14 },
  rowText: { flex: 1 },
  label: { fontSize: 16, fontWeight: '600', color: '#111827' },
  desc: { fontSize: 12, color: '#9ca3af', marginTop: 2 },
  arrow: { fontSize: 24, color: '#d1d5db' },
  logoutBtn: { marginTop: 12, backgroundColor: '#fee2e2', borderRadius: 12, padding: 16, alignItems: 'center' },
  logoutText: { color: '#dc2626', fontWeight: '700', fontSize: 15 },
});

export default MoreScreen;
