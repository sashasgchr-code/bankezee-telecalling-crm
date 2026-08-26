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
export const getLeads = async (params = {}) => {
  const response = await api.get('/leads', { params });
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

// Recording upload function
export const uploadRecording = async (recordingData) => {
  const response = await api.post('/recordings/upload', recordingData, {
    timeout: 120000, // 2 minute timeout for large files
  });
  return response.data;
};

// Get pending recordings count
export const getPendingRecordingsCount = async () => {
  try {
    const pendingUploads = await AsyncStorage.getItem('pending_recording_uploads');
    const queue = pendingUploads ? JSON.parse(pendingUploads) : [];
    return queue.length;
  } catch (error) {
    return 0;
  }
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
export const getFollowUps = async (params = {}) => {
  const response = await api.get('/follow-ups', { params });
  return response.data;
};

export const createFollowUp = async (data) => {
  const response = await api.post('/follow-ups', data);
  return response.data;
};

export const updateFollowUp = async (followUpId, data) => {
  const response = await api.put(`/follow-ups/${followUpId}`, data);
  return response.data;
};

export const deleteFollowUp = async (followUpId) => {
  const response = await api.delete(`/follow-ups/${followUpId}`);
  return response.data;
};

// User management functions (Admin)
export const getUsers = async () => {
  const response = await api.get('/users');
  return response.data;
};

export const getTelecallers = async () => {
  const response = await api.get('/users');
  // Filter to only telecallers
  return response.data.filter(u => u.role === 'telecaller');
};

export const createUser = async (userData) => {
  const response = await api.post('/auth/register', userData);
  return response.data;
};

export const updateUser = async (userId, data) => {
  const response = await api.put(`/users/${userId}`, data);
  return response.data;
};

export const deleteUsers = async (userIds) => {
  const response = await api.delete('/users', { data: { user_ids: userIds } });
  return response.data;
};

// Reports functions
export const getDashboardStats = async (period = 'today') => {
  const response = await api.get('/dashboard/stats', { params: { period } });
  return response.data;
};

export const getTelecallerReports = async (period = 'today') => {
  const response = await api.get('/reports/telecaller-summary', { params: { period } });
  return response.data;
};

export const getRecordingsStats = async () => {
  const response = await api.get('/recordings/stats');
  return response.data;
};

export const getDailyTrackingSheet = async (userId, month, year) => {
  const params = { month, year };
  if (userId) {
    params.user_id = userId;
  }
  const response = await api.get('/reports/daily-tracking-sheet', { params });
  return response.data;
};

// Lead call logs
export const getLeadCallLogs = async (leadId) => {
  const response = await api.get(`/leads/${leadId}/call-logs`);
  return response.data;
};

export default api;
