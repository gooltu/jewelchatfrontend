import { gameserverClient } from './client';

export interface LoginRequest {
  username: string;
  password: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export interface AuthenticatedUser {
  userId: string;
  jewelchatId: number;
  jid: string;
  username: string;
  displayName: string;
}

export interface LoginResponse {
  tokens: AuthTokens;
  user: AuthenticatedUser;
}

/** Thin REST wrappers — no token storage or Redux dispatch here, that's authService's job. */

export async function login(request: LoginRequest): Promise<LoginResponse> {
  const { data } = await gameserverClient.post<LoginResponse>('/auth/login', request);
  return data;
}

export async function refreshToken(refreshToken: string): Promise<AuthTokens> {
  const { data } = await gameserverClient.post<AuthTokens>('/auth/refresh', { refreshToken });
  return data;
}

export async function logout(): Promise<void> {
  await gameserverClient.post('/auth/logout');
}

export async function getProfile(): Promise<AuthenticatedUser> {
  const { data } = await gameserverClient.get<AuthenticatedUser>('/auth/profile');
  return data;
}
