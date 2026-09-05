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

// Call logging functions
export const logCallOutcome = async (data) => {
  // For mobile app, use the dedicated mobile endpoint which handles verified calls
  // and integrates with the unified call_logs collection
  if (data.duration_seconds !== undefined) {
    // Mobile call with native duration - use mobile endpoint
    const response = await api.post('/call-logs/mobile', {
      lead_id: data.lead_id,
      duration_seconds: data.duration_seconds,
      outcome: data.outcome,
      notes: data.notes,
      call_type: data.call_type || 'outgoing',
      device_timestamp: data.device_timestamp || new Date().toISOString(),
    });
    return response.data;
  } else {
    // Legacy fallback - use standard call-logs endpoint
    const response = await api.post('/call-logs', {
      ...data,
      source: 'mobile',
    });
    return response.data;
  }
};

// Get unified call logs (web + mobile combined)
export const getUnifiedCallLogs = async (params = {}) => {
  const response = await api.get('/call-logs/unified', { params });
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
  // Same source as the web dropdowns (all GP roles: growth_partner/telecaller/sales_agent/partner)
  const response = await api.get('/users/growth-partners');
  return response.data || [];
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
  // Web-parity Summary endpoint (returns { overall, telecaller_reports })
  const response = await api.get('/reports/telecallers', { params: { period } });
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

// Attendance functions
export const getTodayAttendance = async () => {
  const response = await api.get('/attendance/today');
  return response.data;
};

export const checkIn = async (locationData) => {
  const response = await api.post('/attendance/check-in', locationData);
  return response.data;
};

export const checkOut = async (locationData) => {
  const response = await api.post('/attendance/check-out', locationData);
  return response.data;
};

export const getAttendanceHistory = async (params = {}) => {
  const response = await api.get('/attendance/history', { params });
  return response.data;
};

export const submitWFHRequest = async (data) => {
  const response = await api.post('/attendance/wfh-request', data);
  return response.data;
};

export const getMyWFHRequests = async () => {
  const response = await api.get('/attendance/wfh-requests');
  return response.data;
};

// ===================== LEAVE MANAGEMENT =====================

export const getLeaveBalance = async () => {
  const response = await api.get('/leave/balance');
  return response.data;
};

export const getMyLeaveRequests = async () => {
  const response = await api.get('/leave/requests/my');
  return response.data;
};

export const getMyWfhRequests = async () => {
  const response = await api.get('/leave/wfh/requests/my');
  return response.data;
};

export const submitLeaveRequest = async (data) => {
  const response = await api.post('/leave/requests', data);
  return response.data;
};

export const submitWfhRequest = async (data) => {
  const response = await api.post('/leave/wfh/requests', data);
  return response.data;
};

export const cancelLeaveRequest = async (requestId) => {
  const response = await api.delete(`/leave/requests/${requestId}`);
  return response.data;
};

// ============ FILES CRM API ============

// Get files (leads with status='file')
export const getFiles = async (params = {}) => {
  const response = await api.get('/files', { params });
  return response.data;
};

// Get files dashboard stats
export const getFilesStats = async () => {
  const response = await api.get('/files/dashboard/stats');
  return response.data;
};

// Get file details
export const getFileDetails = async (fileId) => {
  const response = await api.get(`/files/${fileId}`);
  return response.data;
};

// Update file details
export const updateFileDetails = async (fileId, data) => {
  const response = await api.put(`/files/${fileId}/details`, data);
  return response.data;
};

// Update file status
export const updateFileStatus = async (fileId, status) => {
  const response = await api.put(`/files/${fileId}/file-status`, { file_status: status });
  return response.data;
};

// Add note to file
export const addFileNote = async (fileId, note) => {
  const response = await api.post(`/files/${fileId}/notes`, { note });
  return response.data;
};

// Assign file
export const assignFile = async (fileId, assignedTo) => {
  const response = await api.put(`/files/${fileId}/assign`, { assigned_to: assignedTo });
  return response.data;
};

// Bulk assign files
export const bulkAssignFiles = async (fileIds, assignedTo) => {
  const response = await api.put('/files/bulk-assign', {
    file_ids: fileIds,
    assigned_to: assignedTo
  });
  return response.data;
};

// Get operations team
export const getOpsTeam = async () => {
  const response = await api.get('/files/operations-team');
  return response.data;
};

// Update eligibilities
export const updateEligibilities = async (fileId, eligibilities) => {
  const response = await api.put(`/files/${fileId}/eligibilities`, { eligibilities });
  return response.data;
};

// Get file activities
export const getFileActivities = async (fileId) => {
  const response = await api.get(`/files/${fileId}/activities`);
  return response.data;
};

// Upload document
export const uploadFileDocument = async (fileId, file, documentType = 'general') => {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('document_type', documentType);
  const response = await api.post(`/files/${fileId}/upload`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });
  return response.data;
};

// Get file documents
export const getFileDocuments = async (fileId) => {
  const response = await api.get(`/files/${fileId}/documents`);
  return response.data;
};

// Files Reports
export const getFilesReports = async (params = {}) => {
  const response = await api.get('/files/reports', { params });
  return response.data;
};

export default api;
