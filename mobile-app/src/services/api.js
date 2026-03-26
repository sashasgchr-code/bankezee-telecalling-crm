import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_BASE_URL } from '../config';

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add auth token to requests
api.interceptors.request.use(async (config) => {
  try {
    const token = await AsyncStorage.getItem('auth_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  } catch (error) {
    console.error('Error getting auth token:', error);
  }
  return config;
});

// Handle auth errors
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      await AsyncStorage.removeItem('auth_token');
      await AsyncStorage.removeItem('user_data');
    }
    return Promise.reject(error);
  }
);

// Auth functions
export const login = async (email, password) => {
  const response = await api.post('/auth/login', { email, password });
  if (response.data.token) {
    await AsyncStorage.setItem('auth_token', response.data.token);
    await AsyncStorage.setItem('user_data', JSON.stringify(response.data.user));
  }
  return response.data;
};

export const logout = async () => {
  try {
    await api.post('/auth/logout');
  } catch (error) {
    console.error('Logout error:', error);
  }
  await AsyncStorage.removeItem('auth_token');
  await AsyncStorage.removeItem('user_data');
};

export const getCurrentUser = async () => {
  const userData = await AsyncStorage.getItem('user_data');
  return userData ? JSON.parse(userData) : null;
};

export const isAuthenticated = async () => {
  const token = await AsyncStorage.getItem('auth_token');
  return !!token;
};

// Leads functions
export const getLeads = async () => {
  const response = await api.get('/leads');
  return response.data;
};

export const getLead = async (leadId) => {
  const response = await api.get(`/leads/${leadId}`);
  return response.data;
};

export const updateLead = async (leadId, data) => {
  const response = await api.put(`/leads/${leadId}`, data);
  return response.data;
};

// Call session functions
export const startCallSession = async (leadId) => {
  const response = await api.post('/call-sessions/start', { lead_id: leadId });
  return response.data;
};

export const endCallSession = async (sessionId, outcome, notes, duration, formFillingSeconds) => {
  const response = await api.post('/call-sessions/end', {
    session_id: sessionId,
    outcome,
    notes,
    duration,
    form_filling_seconds: formFillingSeconds,
  });
  return response.data;
};

export const cancelCallSession = async () => {
  const response = await api.post('/call-sessions/cancel');
  return response.data;
};

// Call log sync functions
export const syncCallLogs = async (callLogs) => {
  const response = await api.post('/call-logs/sync', { call_logs: callLogs });
  return response.data;
};

export const getLastSyncTimestamp = async () => {
  const response = await api.get('/call-logs/last-sync');
  return response.data;
};

// Activity functions
export const pingActivity = async () => {
  const response = await api.post('/activity/ping');
  return response.data;
};

export const getMySession = async () => {
  const response = await api.get('/activity/my-session');
  return response.data;
};

export const getMyStats = async () => {
  const response = await api.get('/activity/my-stats');
  return response.data;
};

export const recordBreak = async (action, reason = null) => {
  const response = await api.post('/activity/break', { action, reason });
  return response.data;
};

// Follow-up functions
export const getFollowUps = async () => {
  const response = await api.get('/follow-ups');
  return response.data;
};

export const createFollowUp = async (leadId, scheduledAt, notes) => {
  const response = await api.post('/follow-ups', {
    lead_id: leadId,
    scheduled_at: scheduledAt,
    notes,
  });
  return response.data;
};

export default api;
