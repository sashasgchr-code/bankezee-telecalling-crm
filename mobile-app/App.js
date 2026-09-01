import React, { useState, useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Screens
import LoginScreen from './src/screens/LoginScreen';
import DashboardScreen from './src/screens/DashboardScreen';
import DataScreen from './src/screens/DataScreen';
import LeadDetailScreen from './src/screens/LeadDetailScreen';
import FilesScreen from './src/screens/FilesScreen';
import FileDetailScreen from './src/screens/FileDetailScreen';
import FollowUpsScreen from './src/screens/FollowUpsScreen';
import TeamScreen from './src/screens/TeamScreen';
import ReportsScreen from './src/screens/ReportsScreen';
import TrackingScreen from './src/screens/TrackingScreen';
import LeaveScreen from './src/screens/LeaveScreen';

const Tab = createBottomTabNavigator();
const Stack = createStackNavigator();

// Tab Icon Component
const TabIcon = ({ name, focused, color }) => {
  const icons = {
    Dashboard: '📊',
    Data: '📋',
    Files: '📁',
    'Follow-ups': '📅',
    Team: '👥',
    Reports: '📈',
    Tracking: '📆',
    Leave: '🏖️',
  };
  return (
    <View style={styles.tabIcon}>
      <Text style={{ fontSize: focused ? 24 : 20 }}>{icons[name] || '📱'}</Text>
    </View>
  );
};

// Telecaller Tabs
const TelecallerTabs = ({ user, onLogout }) => {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused, color }) => (
          <TabIcon name={route.name} focused={focused} color={color} />
        ),
        tabBarActiveTintColor: '#16a34a',
        tabBarInactiveTintColor: 'gray',
        tabBarStyle: styles.tabBar,
        tabBarLabelStyle: styles.tabBarLabel,
        headerShown: false,
      })}
    >
      <Tab.Screen name="Dashboard">
        {props => <DashboardScreen {...props} user={user} onLogout={onLogout} />}
      </Tab.Screen>
      <Tab.Screen name="Data">
        {props => <DataScreen {...props} user={user} />}
      </Tab.Screen>
      <Tab.Screen name="Files">
        {props => <FilesScreen {...props} user={user} />}
      </Tab.Screen>
      <Tab.Screen name="Follow-ups">
        {props => <FollowUpsScreen {...props} user={user} />}
      </Tab.Screen>
      <Tab.Screen name="Leave">
        {props => <LeaveScreen {...props} user={user} />}
      </Tab.Screen>
    </Tab.Navigator>
  );
};

// Admin Tabs
const AdminTabs = ({ user, onLogout }) => {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused, color }) => (
          <TabIcon name={route.name} focused={focused} color={color} />
        ),
        tabBarActiveTintColor: '#16a34a',
        tabBarInactiveTintColor: 'gray',
        tabBarStyle: styles.tabBar,
        tabBarLabelStyle: styles.tabBarLabel,
        headerShown: false,
      })}
    >
      <Tab.Screen name="Dashboard">
        {props => <DashboardScreen {...props} user={user} onLogout={onLogout} />}
      </Tab.Screen>
      <Tab.Screen name="Data">
        {props => <DataScreen {...props} user={user} />}
      </Tab.Screen>
      <Tab.Screen name="Files">
        {props => <FilesScreen {...props} user={user} />}
      </Tab.Screen>
      <Tab.Screen name="Team">
        {props => <TeamScreen {...props} user={user} />}
      </Tab.Screen>
      <Tab.Screen name="Reports">
        {props => <ReportsScreen {...props} user={user} />}
      </Tab.Screen>
      <Tab.Screen name="Leave">
        {props => <LeaveScreen {...props} user={user} />}
      </Tab.Screen>
    </Tab.Navigator>
  );
};

// Main App Navigator
const AppNavigator = ({ user, onLogout }) => {
  const isAdmin = user?.role === 'admin';
  
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Main">
        {props => isAdmin ? 
          <AdminTabs {...props} user={user} onLogout={onLogout} /> : 
          <TelecallerTabs {...props} user={user} onLogout={onLogout} />
        }
      </Stack.Screen>
      <Stack.Screen 
        name="LeadDetail" 
        component={LeadDetailScreen}
        options={{ headerShown: true, title: 'Lead Details' }}
      />
      <Stack.Screen 
        name="FileDetail" 
        component={FileDetailScreen}
        options={{ headerShown: false }}
      />
    </Stack.Navigator>
  );
};

// Main App
const App = () => {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      const userData = await AsyncStorage.getItem('user_data');
      const token = await AsyncStorage.getItem('auth_token');
      if (userData && token) {
        setUser(JSON.parse(userData));
      }
    } catch (error) {
      console.error('Auth check error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogin = async (userData, token) => {
    await AsyncStorage.setItem('user_data', JSON.stringify(userData));
    await AsyncStorage.setItem('auth_token', token);
    setUser(userData);
  };

  const handleLogout = async () => {
    await AsyncStorage.removeItem('user_data');
    await AsyncStorage.removeItem('auth_token');
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

  return (
    <NavigationContainer>
      {user ? (
        <AppNavigator user={user} onLogout={handleLogout} />
      ) : (
        <LoginScreen onLogin={handleLogin} />
      )}
    </NavigationContainer>
  );
};

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
  },
  loadingText: {
    marginTop: 10,
    color: '#666',
  },
  tabBar: {
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    paddingTop: 5,
    paddingBottom: 5,
    height: 60,
  },
  tabBarLabel: {
    fontSize: 11,
    fontWeight: '500',
  },
  tabIcon: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default App;
