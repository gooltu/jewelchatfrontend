import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { env } from '../config/env';

/**
 * REST client for the game server (auth, profile, non-realtime ops).
 * Distinct from chatserver/ (XMPP over WebSocket) — this is plain HTTP.
 */
export const gameserverClient = axios.create({
  baseURL: env.gameserverUrl,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

/**
 * The auth token lives in expo-secure-store, owned by authService — this
 * module never reads secure-store directly to avoid a circular import.
 * authService calls setAuthTokenProvider() once at startup / after login.
 */
let authTokenProvider: (() => Promise<string | null>) | null = null;

export function setAuthTokenProvider(provider: () => Promise<string | null>): void {
  authTokenProvider = provider;
}

/** Called on a 401 response so authService can clear the session and route to login. */
let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(handler: () => void): void {
  onUnauthorized = handler;
}

gameserverClient.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
  const token = await authTokenProvider?.();
  if (token) {
    config.headers.set('Authorization', `Bearer ${token}`);
  }
  return config;
});

gameserverClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    if (error.response?.status === 401) {
      onUnauthorized?.();
    }
    return Promise.reject(error);
  },
);
