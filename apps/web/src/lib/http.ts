import axios from 'axios';
import { tenantContextStore } from './tenant-context-store';

export const http = axios.create({
  baseURL: '/',
  withCredentials: true,
  headers: { Accept: 'application/json' },
});

http.interceptors.request.use((config) => {
  const token = tenantContextStore.getState().accessToken;
  if (token) config.headers.set('X-Tenant-Context', token);
  return config;
});
