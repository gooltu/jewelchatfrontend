import * as SecureStore from 'expo-secure-store';
import * as authApi from '../gameserver/authApi';
import * as phoneAuthApi from '../gameserver/phoneAuthApi';
import { setAuthTokenProvider, setUnauthorizedHandler, setRefreshHandler } from '../gameserver/client';
import { attemptRefreshAndRetry } from '../gameserver/tokenRefresh';
import { store } from '../store';
import { authenticationStarted, authenticationFailed, signedIn, signedOut } from '../store/slices/authSlice';
import * as chatService from './chatService';

export const COUNTRY_CODE = '91';

/**
 * Login/logout orchestration. Owns the only reads/writes of auth tokens —
 * always via expo-secure-store, never AsyncStorage/redux-persist (see
 * store/index.ts's persist whitelist comment).
 */

const ACCESS_TOKEN_KEY = 'jewelchat.accessToken';
const REFRESH_TOKEN_KEY = 'jewelchat.refreshToken';
const JID_KEY = 'jewelchat.jid';
const USER_ID_KEY = 'jewelchat.userId';
const PHONE_KEY = 'jewelchat.phone';
const DOMAIN_KEY = 'jewelchat.domain';

export async function getStoredAccessToken(): Promise<string | null> {
  return SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
}

export async function getStoredRefreshToken(): Promise<string | null> {
  return SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
}

export async function getStoredDomain(): Promise<string | null> {
  return SecureStore.getItemAsync(DOMAIN_KEY);
}

export async function updateAccessToken(accessToken: string): Promise<void> {
  await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, accessToken);
}

async function storeSession(args: {
  accessToken: string;
  refreshToken: string;
  jid?: string;
  userId?: string;
  phone?: string;
  domain?: string;
}): Promise<void> {
  const writes = [
    SecureStore.setItemAsync(ACCESS_TOKEN_KEY, args.accessToken),
    SecureStore.setItemAsync(REFRESH_TOKEN_KEY, args.refreshToken),
  ];
  if (args.jid !== undefined) writes.push(SecureStore.setItemAsync(JID_KEY, args.jid));
  if (args.userId !== undefined) writes.push(SecureStore.setItemAsync(USER_ID_KEY, args.userId));
  if (args.phone !== undefined) writes.push(SecureStore.setItemAsync(PHONE_KEY, args.phone));
  if (args.domain !== undefined) writes.push(SecureStore.setItemAsync(DOMAIN_KEY, args.domain));
  await Promise.all(writes);
}

async function clearSession(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY),
    SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY),
    SecureStore.deleteItemAsync(JID_KEY),
    SecureStore.deleteItemAsync(USER_ID_KEY),
    SecureStore.deleteItemAsync(PHONE_KEY),
    SecureStore.deleteItemAsync(DOMAIN_KEY),
  ]);
}

/** Wires the gameserver client's Authorization header + 401 handling. Call once at startup. */
export function configureGameserverAuth(): void {
  setAuthTokenProvider(getStoredAccessToken);
  setUnauthorizedHandler(() => {
    void logout();
  });
  setRefreshHandler(attemptRefreshAndRetry);
}

/** Phone/OTP sign-up flow — see gameserver/phoneAuthApi.ts for the wire contract. */
export async function requestOtp(
  phone: string,
): Promise<{ userId: number; active: boolean; domain: string }> {
  const result = await phoneAuthApi.registerPhoneNumber(`${COUNTRY_CODE}${phone}`);
  return { userId: result.userId, active: result.active, domain: result.domain };
}

export async function verifyOtp(
  userId: number,
  code: string,
  params: { phone: string; domain: string },
): Promise<void> {
  const { refreshToken } = await phoneAuthApi.verifyCode(userId, code);
  const { accessToken } = await phoneAuthApi.getAccessToken(refreshToken);
  // Backend-controlled domain assumed free of JID-reserved characters (@, /, whitespace).
  const jid = `${userId}@${params.domain}`;
  await storeSession({
    accessToken,
    refreshToken,
    jid,
    userId: String(userId),
    phone: `${COUNTRY_CODE}${params.phone}`,
    domain: params.domain,
  });
}

export async function resendOtp(userId: number): Promise<void> {
  await phoneAuthApi.resendVcode(userId);
}

export async function completeAuth(userId: number, displayName?: string): Promise<void> {
  const [jid, refreshToken] = await Promise.all([
    SecureStore.getItemAsync(JID_KEY),
    getStoredRefreshToken(),
  ]);
  await chatService.seedWelcomeContact();
  store.dispatch(
    signedIn({ userId: String(userId), jid: jid ?? '', displayName: displayName ?? 'defaultJCUname' }),
  );
  if (jid && refreshToken) {
    chatService.connect(jid, refreshToken);
  }
}

export async function submitInitialDetails(
  userId: number,
  referrerPhone: string,
  nickname: string,
): Promise<void> {
  const reference = referrerPhone ? `${COUNTRY_CODE}${referrerPhone}` : referrerPhone;
  await phoneAuthApi.initialDetails(reference, nickname);
  await completeAuth(userId, nickname || undefined);
}

export async function login(username: string, password: string): Promise<void> {
  store.dispatch(authenticationStarted());
  try {
    const { tokens, user } = await authApi.login({ username, password });
    await storeSession({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      jid: user.jid,
    });
    store.dispatch(
      signedIn({ userId: user.userId, jid: user.jid, displayName: user.displayName }),
    );
    // The chat server accepts the same access token as the SASL password —
    // the game server is the identity provider for both REST and XMPP.
    chatService.connect(user.jid, tokens.accessToken);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Login failed';
    store.dispatch(authenticationFailed(message));
    throw error;
  }
}

let logoutPromise: Promise<void> | null = null;

/**
 * Single-flight: reachable both from user-initiated sign-out and from
 * tokenRefresh.ts's refresh-failure path, so concurrent 401s that all
 * exhaust their retry must collapse into one sign-out, not re-run the body
 * (and re-dispatch signedOut) once per caller.
 */
export function logout(): Promise<void> {
  if (!logoutPromise) {
    logoutPromise = (async () => {
      chatService.disconnect();
      await clearSession();
      store.dispatch(signedOut());
    })().finally(() => {
      logoutPromise = null;
    });
  }
  return logoutPromise;
}

/** Call at app startup: if a session exists, restore it locally without prompting for login. */
export async function restoreSession(): Promise<void> {
  const [accessToken, refreshToken, jid, userId] = await Promise.all([
    getStoredAccessToken(),
    getStoredRefreshToken(),
    SecureStore.getItemAsync(JID_KEY),
    SecureStore.getItemAsync(USER_ID_KEY),
  ]);
  if (!accessToken || !refreshToken || !jid || !userId) {
    // Covers both "never signed in" and a partial/interrupted write.
    await clearSession();
    store.dispatch(signedOut());
    return;
  }

  // Optimistic/local restore — no "whoami" endpoint exists for phone-auth'd
  // users. Token validity is checked lazily: the first authenticated
  // gameserverClient request either succeeds or 401s into tokenRefresh.ts's
  // attemptRefreshAndRetry, which refreshes-and-retries or calls logout().
  store.dispatch(signedIn({ userId, jid, displayName: 'defaultJCUname' }));
  chatService.connect(jid, refreshToken);
}

/** Call on the app's background-to-active transition: no-ops if not signed in. */
export async function reconnectChat(): Promise<void> {
  const [jid, refreshToken] = await Promise.all([
    SecureStore.getItemAsync(JID_KEY),
    getStoredRefreshToken(),
  ]);
  if (jid && refreshToken) {
    await chatService.resyncAfterForeground(jid, refreshToken);
  }
}
