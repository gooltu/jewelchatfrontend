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

/**
 * Called on a 401 response to attempt a token refresh + retry of the
 * original request, before falling back to onUnauthorized. Registered via
 * a setter, matching setAuthTokenProvider/setUnauthorizedHandler above, so
 * this module stays free of any import from tokenRefresh.ts/authService.ts.
 */
let refreshAndRetry: ((error: AxiosError) => Promise<unknown>) | null = null;

export function setRefreshHandler(handler: (error: AxiosError) => Promise<unknown>): void {
  refreshAndRetry = handler;
}

gameserverClient.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
  const token = await authTokenProvider?.();
  if (token) {
    config.headers.set('Authorization', `Bearer ${token}`);
  }
  if (__DEV__) {
    console.log(
      `[gameserver] ${config.method?.toUpperCase()} ${config.url} auth=${token ? 'bearer' : 'none'}`,
      config.data ?? '',
    );
  }
  return config;
});

gameserverClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    if (error.response?.status === 401 && refreshAndRetry) {
      return refreshAndRetry(error);
    }
    if (error.response?.status === 401) {
      onUnauthorized?.();
    }
    return Promise.reject(error);
  },
);

/** Dev-only response logging — runs after the 401/refresh handling above, so it logs the final settled outcome (including any retried request). */
if (__DEV__) {
  gameserverClient.interceptors.response.use(
    (response) => {
      console.log(
        `[gameserver] ${response.config.method?.toUpperCase()} ${response.config.url} ->`,
        response.data,
      );
      return response;
    },
    (error: AxiosError) => {
      console.log(
        `[gameserver] ${error.config?.method?.toUpperCase()} ${error.config?.url} failed ->`,
        error.response?.data ?? error.message,
      );
      return Promise.reject(error);
    },
  );
}
