import axios, { type InternalAxiosRequestConfig } from 'axios';
import * as SecureStore from 'expo-secure-store';
import { i18n, isLanguage } from '@/lib/i18n';

export const TOKEN_KEY = 'jwt_token';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000';

const api = axios.create({
  baseURL: API_URL,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

// The API localises catalogue text (categories, grades, units) from this header.
export function withLanguageHeader(config: InternalAxiosRequestConfig): InternalAxiosRequestConfig {
  config.headers['X-App-Language'] = isLanguage(i18n.language) ? i18n.language : 'en';
  return config;
}

api.interceptors.request.use(async (config) => {
  withLanguageHeader(config);
  const token = await SecureStore.getItemAsync(TOKEN_KEY);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      // Auth state is cleared by useAuth when it next checks the token.
      await SecureStore.deleteItemAsync(TOKEN_KEY);
    }
    return Promise.reject(error);
  },
);

/** The API's error message, or a fallback, for showing in a toast. */
export function apiErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    const msg = (error.response?.data as { error?: unknown } | undefined)?.error;
    if (typeof msg === 'string' && msg) return msg;
  }
  return fallback;
}

export default api;
