import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || 'https://caring-celebration-production-a1bf.up.railway.app/api/v1',
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true,
});

// ✅ FIXED: Request interceptor – always attach token
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken');   // or your token key
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ✅ FIXED: Response interceptor – handle 401 (auto logout + refresh if you have it)
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('accessToken');
      // Optional: redirect to login
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export default api;
