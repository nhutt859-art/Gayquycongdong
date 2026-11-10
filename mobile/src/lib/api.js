import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

// Dùng chung backend production; có thể override bằng EXPO_PUBLIC_API_URL khi dev local.
export const API_BASE = (
  process.env.EXPO_PUBLIC_API_URL || 'https://gayquy-backend.onrender.com/api'
).replace(/\/+$/, '');

const TOKEN_KEY = 'gq_token';
let unauthorizedHandler = null;

/** Đăng ký callback khi token hết hạn (AppContext dùng để đăng xuất). */
export function onUnauthorized(handler) {
  unauthorizedHandler = handler;
  return () => {
    if (unauthorizedHandler === handler) unauthorizedHandler = null;
  };
}

export class ApiError extends Error {
  constructor(message, status, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

export async function getToken() {
  try {
    if (Platform.OS === 'web') return await AsyncStorage.getItem(TOKEN_KEY);
    return await SecureStore.getItemAsync(TOKEN_KEY);
  } catch {
    return null;
  }
}

export async function setToken(token) {
  try {
    if (Platform.OS === 'web') {
      if (token) await AsyncStorage.setItem(TOKEN_KEY, token);
      else await AsyncStorage.removeItem(TOKEN_KEY);
      return;
    }
    if (token) await SecureStore.setItemAsync(TOKEN_KEY, token);
    else await SecureStore.deleteItemAsync(TOKEN_KEY);
  } catch {
    // Bộ nhớ bảo mật có thể không khả dụng; phiên sẽ không được khôi phục.
  }
}

async function request(path, { method = 'GET', body, auth = true } = {}) {
  const token = auth ? await getToken() : null;
  const headers = { Accept: 'application/json' };

  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth && token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(
      'Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.',
      0,
      null,
    );
  }

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!res.ok) {
    if (res.status === 401 && unauthorizedHandler) unauthorizedHandler();
    throw new ApiError(
      data?.error || `Yêu cầu thất bại (${res.status}).`,
      res.status,
      data?.details || data,
    );
  }

  return data;
}

export const api = {
  get: (path, options) => request(path, { ...options, method: 'GET' }),
  post: (path, body, options) => request(path, { ...options, method: 'POST', body }),
  put: (path, body, options) => request(path, { ...options, method: 'PUT', body }),
  patch: (path, body, options) => request(path, { ...options, method: 'PATCH', body }),
  del: (path, body, options) => request(path, { ...options, method: 'DELETE', body }),
};
