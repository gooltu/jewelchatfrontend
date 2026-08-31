import * as SecureStore from 'expo-secure-store';
import * as authApi from '../gameserver/authApi';
import { setAuthTokenProvider, setUnauthorizedHandler } from '../gameserver/client';
import { store } from '../store';
import { authenticationStarted, authenticationFailed, signedIn, signedOut } from '../store/slices/authSlice';
import * as chatService from './chatService';

/**
 * Login/logout orchestration. Owns the only reads/writes of auth tokens —
 * always via expo-secure-store, never AsyncStorage/redux-persist (see
 * store/index.ts's persist whitelist comment).
 */

const ACCESS_TOKEN_KEY = 'jewelchat.accessToken';
const REFRESH_TOKEN_KEY = 'jewelchat.refreshToken';
const JID_KEY = 'jewelchat.jid';

export async function getStoredAccessToken(): Promise<string | null> {
  return SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
}

async function storeSession(args: { accessToken: string; refreshToken: string; jid: string }): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(ACCESS_TOKEN_KEY, args.accessToken),
    SecureStore.setItemAsync(REFRESH_TOKEN_KEY, args.refreshToken),
    SecureStore.setItemAsync(JID_KEY, args.jid),
  ]);
}

async function clearSession(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY),
    SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY),
    SecureStore.deleteItemAsync(JID_KEY),
  ]);
}

/** Wires the gameserver client's Authorization header + 401 handling. Call once at startup. */
export function configureGameserverAuth(): void {
  setAuthTokenProvider(getStoredAccessToken);
  setUnauthorizedHandler(() => {
    void logout();
  });
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

export async function logout(): Promise<void> {
  chatService.disconnect();
  await authApi.logout().catch(() => undefined); // best-effort — proceed with local sign-out regardless
  await clearSession();
  store.dispatch(signedOut());
}

/** Call at app startup: if a token exists, restore the session without prompting for login. */
export async function restoreSession(): Promise<void> {
  const [accessToken, jid] = await Promise.all([
    getStoredAccessToken(),
    SecureStore.getItemAsync(JID_KEY),
  ]);
  if (!accessToken || !jid) return;

  try {
    const user = await authApi.getProfile();
    store.dispatch(signedIn({ userId: user.userId, jid: user.jid, displayName: user.displayName }));
    chatService.connect(user.jid, accessToken);
  } catch {
    // Stored token is invalid/expired — drop it silently and require a fresh login.
    await clearSession();
    store.dispatch(signedOut());
  }
}
