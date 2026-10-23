import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { env } from '../config/env';

/**
 * REST client for the game server (auth, profile, non-realtime ops).
 * Distinct from chatserver/ (XMPP over WebSocket) — this is plain HTTP.
 */
/**
 * Cache-Control/Pragma/Expires explicitly disable caching of every request
 * — every endpoint here is either a mutation or state that changes from
 * other flows in this app, so a stale response served by an intermediary
 * (a CDN/reverse proxy in front of the API, or the OS's own HTTP cache) is
 * always wrong, never a valid optimization.
 */
export const gameserverClient = axios.create({
  baseURL: env.gameserverUrl,
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    Pragma: 'no-cache',
    Expires: '0',
  },
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

/**
 * These three endpoints are gated server-side behind Firebase App Check — see
 * appCheckService.ts, which registers the token provider below once App Check is
 * initialized at startup. No other endpoint gets the header.
 */
const APP_CHECK_PROTECTED_PATHS = new Set([
  '/registerPhoneNumber',
  '/verifyCode',
  '/getAccessToken',
]);

/**
 * Registered by appCheckService.ts once Firebase App Check is initialized — kept as
 * a setter (like authTokenProvider above) so this module stays free of any import
 * from appCheckService.ts. Best-effort: a null/failed token just means the header is
 * omitted, letting the backend's own 403 (see AttestationError below) be the signal.
 */
let appCheckTokenProvider: (() => Promise<string | null>) | null = null;

export function setAppCheckTokenProvider(provider: () => Promise<string | null>): void {
  appCheckTokenProvider = provider;
}

/**
 * Thrown in place of the raw AxiosError when one of APP_CHECK_PROTECTED_PATHS
 * responds 403 — distinguishes "this device/app failed attestation" from a normal
 * validation error (those endpoints return `{error: true, message}` with a 2xx
 * status instead, see phoneAuthApi.ts) so callers can show attestation-specific UI.
 */
export class AttestationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AttestationError';
  }
}

gameserverClient.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
  const token = await authTokenProvider?.();
  if (token) {
    config.headers.set('Authorization', `Bearer ${token}`);
  }
  if (config.url && APP_CHECK_PROTECTED_PATHS.has(config.url)) {
    const appCheckToken = await appCheckTokenProvider?.();
    if (appCheckToken) {
      config.headers.set('X-Firebase-AppCheck', appCheckToken);
    }
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
    if (
      error.response?.status === 403 &&
      error.config?.url &&
      APP_CHECK_PROTECTED_PATHS.has(error.config.url)
    ) {
      const data = error.response.data as { message?: string } | undefined;
      return Promise.reject(new AttestationError(data?.message ?? 'App Check attestation failed'));
    }
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
