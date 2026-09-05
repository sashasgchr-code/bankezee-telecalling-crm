import React, { useState, useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import { View, Text, ActivityIndicator, StyleSheet, TouchableOpacity } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Screens
import LoginScreen from './src/screens/LoginScreen';
import DashboardScreen from './src/screens/DashboardScreen';
import DataScreen from './src/screens/DataScreen';
import LeadDetailScreen from './src/screens/LeadDetailScreen';
import FilesScreen from './src/screens/FilesScreen';
import FileDetailScreen from './src/screens/FileDetailScreen';
import FollowUpsScreen from './src/screens/FollowUpsScreen';
import MyTeamScreen from './src/screens/MyTeamScreen';
import ReportsScreen from './src/screens/ReportsScreen';
import LeaveScreen from './src/screens/LeaveScreen';
import MoreScreen from './src/screens/MoreScreen';
import HourlyReportScreen from './src/screens/HourlyReportScreen';
import AttendanceScreen from './src/screens/AttendanceScreen';
import TeamAttendanceScreen from './src/screens/TeamAttendanceScreen';
import PolicyMasterScreen from './src/screens/PolicyMasterScreen';
import EligibilityScreen from './src/screens/EligibilityScreen';

const Tab = createBottomTabNavigator();
const Stack = createStackNavigator();

const GP_ROLES = ['growth_partner', 'telecaller', 'sales_agent', 'team_leader', 'partner'];

// Which mobile experience a user gets. Admin/HR/Ops are web-only.
const getMobileRole = (user) => {
  const role = (user?.role || '').toLowerCase();
  if (role === 'manager') return 'manager';
  if (GP_ROLES.includes(role)) return user?.is_tl ? 'tl' : 'gp';
  return 'blocked'; // admin, hr, ops, unknown
};

const TabIcon = ({ name, focused }) => {
  const icons = {
    Dashboard: '📊', Data: '📋', Files: '📁', 'Follow-ups': '📅',
    Team: '👥', Reports: '📈', More: '⋯',
  };
  return (
    <View style={styles.tabIcon}>
      <Text style={{ fontSize: focused ? 24 : 20 }}>{icons[name] || '📱'}</Text>
    </View>
  );
};

const tabScreenOptions = ({ route }) => ({
  tabBarIcon: ({ focused }) => <TabIcon name={route.name} focused={focused} />,
  tabBarActiveTintColor: '#16a34a',
  tabBarInactiveTintColor: 'gray',
  tabBarStyle: styles.tabBar,
  tabBarLabelStyle: styles.tabBarLabel,
  headerShown: false,
});

// Growth Partner + Team Lead share the same personal-work tab set.
const GpTabs = ({ user, mobileRole, onLogout }) => (
  <Tab.Navigator screenOptions={tabScreenOptions}>
    <Tab.Screen name="Dashboard">
      {props => <DashboardScreen {...props} user={user} onLogout={onLogout} />}
    </Tab.Screen>
    <Tab.Screen name="Data">{props => <DataScreen {...props} user={user} />}</Tab.Screen>
    <Tab.Screen name="Files">{props => <FilesScreen {...props} user={user} />}</Tab.Screen>
    <Tab.Screen name="Follow-ups">{props => <FollowUpsScreen {...props} user={user} />}</Tab.Screen>
    <Tab.Screen name="More">
      {props => <MoreScreen {...props} user={user} mobileRole={mobileRole} onLogout={onLogout} />}
    </Tab.Screen>
  </Tab.Navigator>
);

// Manager: no Dashboard/Data/personal Attendance. Starts with Files (team files).
const ManagerTabs = ({ user, mobileRole, onLogout }) => (
  <Tab.Navigator screenOptions={tabScreenOptions}>
    <Tab.Screen name="Files">{props => <FilesScreen {...props} user={user} />}</Tab.Screen>
    <Tab.Screen name="Team">{props => <MyTeamScreen {...props} user={user} mobileRole={mobileRole} />}</Tab.Screen>
    <Tab.Screen name="Reports">{props => <ReportsScreen {...props} user={user} mobileRole={mobileRole} />}</Tab.Screen>
    <Tab.Screen name="More">
      {props => <MoreScreen {...props} user={user} mobileRole={mobileRole} onLogout={onLogout} />}
    </Tab.Screen>
  </Tab.Navigator>
);

const AppNavigator = ({ user, mobileRole, onLogout }) => (
  <Stack.Navigator screenOptions={{ headerShown: false }}>
    <Stack.Screen name="Main">
      {props => (mobileRole === 'manager'
        ? <ManagerTabs {...props} user={user} mobileRole={mobileRole} onLogout={onLogout} />
        : <GpTabs {...props} user={user} mobileRole={mobileRole} onLogout={onLogout} />)}
    </Stack.Screen>

    <Stack.Screen name="MyTeam">{props => <MyTeamScreen {...props} user={user} mobileRole={mobileRole} />}</Stack.Screen>
    <Stack.Screen name="Reports">{props => <ReportsScreen {...props} user={user} mobileRole={mobileRole} />}</Stack.Screen>
    <Stack.Screen name="HourlyReport">{props => <HourlyReportScreen {...props} user={user} mobileRole={mobileRole} />}</Stack.Screen>
    <Stack.Screen name="Attendance" component={AttendanceScreen} />
    <Stack.Screen name="TeamAttendance">{props => <TeamAttendanceScreen {...props} user={user} mobileRole={mobileRole} />}</Stack.Screen>
    <Stack.Screen name="PolicyMaster" component={PolicyMasterScreen} />
    <Stack.Screen name="Eligibility" component={EligibilityScreen} />
    <Stack.Screen name="Leave">{props => <LeaveScreen {...props} user={user} />}</Stack.Screen>

    <Stack.Screen name="LeadDetail" component={LeadDetailScreen} options={{ headerShown: true, title: 'Lead Details' }} />
    <Stack.Screen name="FileDetail" component={FileDetailScreen} options={{ headerShown: false }} />
  </Stack.Navigator>
);

// Shown when Admin/HR/Ops sign in on mobile.
const WebOnlyScreen = ({ onLogout }) => (
  <View style={styles.blockedContainer}>
    <Text style={styles.blockedLogo}>🏦</Text>
    <Text style={styles.blockedTitle}>Web Portal Required</Text>
    <Text style={styles.blockedText}>
      This role is supported on the BankEzee web application. Please use the web portal.
    </Text>
    <TouchableOpacity style={styles.blockedBtn} onPress={onLogout} data-testid="web-only-logout">
      <Text style={styles.blockedBtnText}>Log Out</Text>
    </TouchableOpacity>
  </View>
);

const App = () => {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => { checkAuth(); }, []);

  const checkAuth = async () => {
    try {
      const userData = await AsyncStorage.getItem('user_data');
      const token = await AsyncStorage.getItem('auth_token');
      if (userData && token) setUser(JSON.parse(userData));
    } catch (error) {
      console.error('Auth check error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogin = async (userData, token) => {
    // Fresh session: wipe any residue from a previous account before storing the new one.
    await AsyncStorage.clear();
    await AsyncStorage.setItem('user_data', JSON.stringify(userData));
    await AsyncStorage.setItem('auth_token', token);
    setUser(userData);
  };

  const handleLogout = async () => {
    // Full isolation: clear ALL persisted state (auth, cached filters, last sync, etc.)
    await AsyncStorage.clear();
    setUser(null);
  };

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#16a34a" />
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  const mobileRole = user ? getMobileRole(user) : null;

  return (
    <NavigationContainer>
      {!user ? (
        <LoginScreen onLogin={handleLogin} />
      ) : mobileRole === 'blocked' ? (
        <WebOnlyScreen onLogout={handleLogout} />
      ) : (
        // key forces a full unmount/remount on account switch => no stale user state
        <AppNavigator key={user.id || user.email} user={user} mobileRole={mobileRole} onLogout={handleLogout} />
      )}
    </NavigationContainer>
  );
};

const styles = StyleSheet.create({
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f5f5f5' },
  loadingText: { marginTop: 10, color: '#666' },
  tabBar: { backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#e5e7eb', paddingTop: 5, paddingBottom: 5, height: 60 },
  tabBarLabel: { fontSize: 11, fontWeight: '500' },
  tabIcon: { alignItems: 'center', justifyContent: 'center' },
  blockedContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, backgroundColor: '#f0fdf4' },
  blockedLogo: { fontSize: 56, marginBottom: 16 },
  blockedTitle: { fontSize: 22, fontWeight: '700', color: '#111827', marginBottom: 12 },
  blockedText: { fontSize: 15, color: '#4b5563', textAlign: 'center', lineHeight: 22, marginBottom: 28 },
  blockedBtn: { backgroundColor: '#16a34a', paddingHorizontal: 32, paddingVertical: 14, borderRadius: 12 },
  blockedBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});

export default App;
