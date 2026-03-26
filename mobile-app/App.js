import React, { useState, useEffect } from 'react';
import { StatusBar, View, ActivityIndicator, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import LoginScreen from './src/screens/LoginScreen';
import HomeScreen from './src/screens/HomeScreen';
import { getCurrentUser } from './src/services/api';

const App = () => {
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState(null);

  useEffect(() => {
    checkAuthStatus();
  }, []);

  const checkAuthStatus = async () => {
    try {
      const token = await AsyncStorage.getItem('auth_token');
      if (token) {
        const userData = await getCurrentUser();
        if (userData && userData.role === 'telecaller') {
          setUser(userData);
        } else {
          // Clear invalid session
          await AsyncStorage.removeItem('auth_token');
          await AsyncStorage.removeItem('user_data');
        }
      }
    } catch (error) {
      console.error('Auth check error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLoginSuccess = (userData) => {
    setUser(userData);
  };

  const handleLogout = () => {
    setUser(null);
  };

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <StatusBar barStyle="dark-content" backgroundColor="#f5f5f5" />
        <ActivityIndicator size="large" color="#10B981" />
      </View>
    );
  }

  return (
    <>
      <StatusBar 
        barStyle={user ? "light-content" : "dark-content"} 
        backgroundColor={user ? "#10B981" : "#f5f5f5"} 
      />
      {user ? (
        <HomeScreen user={user} onLogout={handleLogout} />
      ) : (
        <LoginScreen onLoginSuccess={handleLoginSuccess} />
      )}
    </>
  );
};

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
  },
});

export default App;
