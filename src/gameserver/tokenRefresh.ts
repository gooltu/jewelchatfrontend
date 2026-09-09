import type { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { gameserverClient } from './client';
import { getAccessToken } from './phoneAuthApi';
import { getStoredRefreshToken, updateAccessToken, logout } from '../services/authService';

/**
 * Single-flight refresh-on-401 for gameserverClient, registered into
 * client.ts via setRefreshHandler() (see authService.configureGameserverAuth).
 */

let refreshPromise: Promise<string> | null = null;

function doRefresh(): Promise<string> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const refreshToken = await getStoredRefreshToken();
      if (!refreshToken) throw new Error('No refresh token stored');
      const { accessToken } = await getAccessToken(refreshToken);
      await updateAccessToken(accessToken);
      return accessToken;
    })().finally(() => {
      // Clear regardless of outcome, so the NEXT 401 (post-failure or after
      // a later, non-concurrent expiry) starts a fresh refresh attempt.
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

type RetryableRequestConfig = InternalAxiosRequestConfig & { _retried?: boolean };

export async function attemptRefreshAndRetry(error: AxiosError): Promise<unknown> {
  const originalRequest = error.config as RetryableRequestConfig;
  if (originalRequest._retried) {
    // Already retried once after a refresh and still 401ing — the refresh
    // token itself is likely invalid server-side. Avoid an infinite loop.
    await logout();
    return Promise.reject(error);
  }
  try {
    const newAccessToken = await doRefresh();
    originalRequest._retried = true;
    originalRequest.headers.set('Authorization', `Bearer ${newAccessToken}`);
    return gameserverClient.request(originalRequest);
  } catch {
    await logout();
    return Promise.reject(error);
  }
}
