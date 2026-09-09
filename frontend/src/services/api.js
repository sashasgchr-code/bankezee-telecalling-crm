import axios from 'axios';

const API_URL = process.env.REACT_APP_BACKEND_URL || '';

const api = axios.create({
  baseURL: `${API_URL}/api`,
  timeout: 120000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    const detail = error.response?.data?.detail || '';
    // Platform access gate: a GP without web access hitting the web app (direct URL or an
    // existing session) is cleanly logged out so the restriction cannot be bypassed.
    if (status === 403 && /web access is not enabled/i.test(detail)) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      localStorage.setItem('access_denied_message', detail);
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }
    if (status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

export default api;
