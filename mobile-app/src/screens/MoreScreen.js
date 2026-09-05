import React from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert } from 'react-native';

const MENU = [
  { key: 'Team', icon: '👥', label: 'Team', desc: 'View team members' },
  { key: 'Reports', icon: '📈', label: 'Reports', desc: 'Performance summary & recordings' },
  { key: 'CallLog', icon: '📞', label: 'Call Log', desc: 'Your call history' },
  { key: 'HourlyReport', icon: '⏱️', label: 'Hourly Report', desc: 'Calls, leads & files by hour' },
  { key: 'Attendance', icon: '📅', label: 'Attendance', desc: 'Check-in & monthly summary' },
  { key: 'PolicyMaster', icon: '🏦', label: 'Policy Master', desc: 'Bank policies & criteria' },
  { key: 'Leave', icon: '🌴', label: 'Leave', desc: 'Leave & WFH requests' },
];

const MoreScreen = ({ navigation, user, onLogout }) => {
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

      <ScrollView contentContainerStyle={styles.body}>
        {MENU.map(item => (
          <TouchableOpacity
            key={item.key}
            style={styles.row}
            onPress={() => navigation.navigate(item.key)}
            activeOpacity={0.7}
            data-testid={`more-${item.key.toLowerCase()}`}
          >
            <Text style={styles.icon}>{item.icon}</Text>
            <View style={styles.rowText}>
              <Text style={styles.label}>{item.label}</Text>
              <Text style={styles.desc}>{item.desc}</Text>
            </View>
            <Text style={styles.arrow}>›</Text>
          </TouchableOpacity>
        ))}

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
