import * as SecureStore from 'expo-secure-store';
import * as authApi from '../gameserver/authApi';
import { bulkPickJewel } from '../gameserver/bulkPickJewelApi';
import { explodeBomb as explodeBombApi } from '../gameserver/explodeBombApi';
import { getFactories } from '../gameserver/getFactoriesApi';
import { getGameState } from '../gameserver/gameStateApi';
import { getNewTaskOnTaskCompletion } from '../gameserver/getNewTaskOnTaskCompletionApi';
import { getTasks } from '../gameserver/tasksApi';
import { getUserFactory } from '../gameserver/getUserFactoryApi';
import * as phoneAuthApi from '../gameserver/phoneAuthApi';
import { startFactory as startFactoryApi } from '../gameserver/startFactoryApi';
import { stopFactory as stopFactoryApi } from '../gameserver/stopFactoryApi';
import { transferJewelsFromFactory as transferJewelsFromFactoryApi } from '../gameserver/transferJewelsFromFactoryApi';
import { setAuthTokenProvider, setUnauthorizedHandler, setRefreshHandler } from '../gameserver/client';
import { attemptRefreshAndRetry } from '../gameserver/tokenRefresh';
import { store } from '../store';
import { authenticationStarted, authenticationFailed, signedIn, signedOut } from '../store/slices/authSlice';
import { factoriesReceived } from '../store/slices/factorySlice';
import { gameStateReceived, pickedJewelsCleared } from '../store/slices/gameSlice';
import { tasksReceived } from '../store/slices/tasksSlice';
import { userFactoriesReceived, factoryStarted, factoryStopped } from '../store/slices/userFactorySlice';
import { getGameServerTimeDelta, parseServerTimestamp } from './timeSyncService';
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

/**
 * Best-effort: fetches score/jewels and stores them in Redux. No-ops if
 * not signed in; swallows failures — game-state staleness isn't worth
 * surfacing an error for on a login/foreground path.
 */
export async function refreshGameState(): Promise<void> {
  if (store.getState().auth.status !== 'signedIn') return;
  try {
    const state = await getGameState();
    if (state) store.dispatch(gameStateReceived(state));
  } catch {
    // best-effort
  }
}

/**
 * Best-effort: fetches the Game tab's task list and stores it in Redux.
 * No-ops if not signed in; swallows failures — same fire-and-forget
 * treatment as refreshGameState.
 */
export async function refreshTasks(): Promise<void> {
  if (store.getState().auth.status !== 'signedIn') {
    if (__DEV__) console.log('[refreshTasks] skipped, not signed in');
    return;
  }
  try {
    const tasks = await getTasks();
    if (tasks) {
      if (__DEV__) console.log('[refreshTasks] received', tasks.length, 'tasks');
      store.dispatch(tasksReceived(tasks));
    } else if (__DEV__) {
      console.log('[refreshTasks] server returned error:true');
    }
  } catch (err) {
    if (__DEV__) console.log('[refreshTasks] request failed', err);
  }
}

/**
 * Best-effort: fetches the Factory page's static catalog (factory
 * definitions + material costs) and stores it in Redux — but only if it
 * isn't already there. Unlike refreshGameState/refreshTasks, this is
 * reference data (see factorySlice's doc comment), so once populated it's
 * persisted across relaunches and never re-fetched.
 */
export async function refreshFactories(): Promise<void> {
  if (store.getState().auth.status !== 'signedIn') return;
  if (store.getState().factory.factories) return;
  try {
    const result = await getFactories();
    if (result) store.dispatch(factoriesReceived(result));
  } catch {
    // best-effort
  }
}

/**
 * Best-effort: fetches the signed-in user's per-factory run state
 * (is_on/start_time) and stores it in Redux. No-ops if not signed in;
 * swallows failures — same fire-and-forget treatment as refreshTasks.
 */
export async function refreshUserFactory(): Promise<void> {
  if (store.getState().auth.status !== 'signedIn') return;
  try {
    const userFactories = await getUserFactory();
    if (userFactories) store.dispatch(userFactoriesReceived(userFactories));
  } catch (err) {
    if (__DEV__) console.log('[refreshUserFactory] failed', err);
  }
}

/**
 * POST /startFactory for the given factory. On success, dispatches
 * factoryStarted so FactoryScreen's card flips to its running layout
 * (rotating jewel, counting-down duration, Stop CTA) immediately, without
 * waiting for a /getUserFactory round-trip. Returns whether it started.
 */
export async function startFactory(factoryId: number): Promise<boolean> {
  try {
    const startTime = await startFactoryApi(factoryId);
    if (startTime === null) {
      if (__DEV__) console.log('[startFactory] server returned error:true', { factoryId });
      return false;
    }
    store.dispatch(
      factoryStarted({ factoryId, startTime, userId: Number(store.getState().auth.userId) || 0 }),
    );
    // Starting a factory consumes its materials from the jewel store —
    // refresh game.jewels so the reduced counts show up immediately, same
    // as stopFactory/transferJewelsFromFactory below.
    void refreshGameState();
    return true;
  } catch (err) {
    if (__DEV__) console.log('[startFactory] failed', err);
    return false;
  }
}

/**
 * POST /stopFactory — ends a running factory early (costs the diamonds
 * shown on FactoryScreen's Stop CTA, per factory.diamond). On success,
 * optimistically flips the local run-state to idle and refreshes game
 * state (spent diamonds) + the canonical user-factory rows.
 */
export async function stopFactory(factoryId: number): Promise<boolean> {
  try {
    const ok = await stopFactoryApi(factoryId);
    if (ok) {
      store.dispatch(factoryStopped({ factoryId }));
      void refreshGameState();
      void refreshUserFactory();
    } else if (__DEV__) {
      console.log('[stopFactory] server returned error:true', { factoryId });
    }
    return ok;
  } catch (err) {
    if (__DEV__) console.log('[stopFactory] failed', err);
    return false;
  }
}

/**
 * POST /transferJewelsFromFactory — claims a finished factory's output
 * (FactoryScreen's "Transfer jewel to Jewel Store" CTA, shown once the
 * countdown hits zero). Same optimistic-flip + refresh treatment as
 * stopFactory.
 */
export async function transferJewelsFromFactory(factoryId: number): Promise<boolean> {
  try {
    const ok = await transferJewelsFromFactoryApi(factoryId);
    if (ok) {
      store.dispatch(factoryStopped({ factoryId }));
      void refreshGameState();
      void refreshUserFactory();
    } else if (__DEV__) {
      console.log('[transferJewelsFromFactory] server returned error:true', { factoryId });
    }
    return ok;
  } catch (err) {
    if (__DEV__) console.log('[transferJewelsFromFactory] failed', err);
    return false;
  }
}

/**
 * Best-effort: flushes any queued game.pickedJewels to POST /bulkPickJewel.
 * No-ops if the queue is empty or not signed in, so every call site (leaving
 * ChatDetailScreen, backgrounding, foregrounding) can call this
 * unconditionally. On success, clears the queue and re-fetches game state so
 * game.jewels reflects the newly-picked counts; on failure the queue is left
 * in place, retried the next time any trigger fires.
 */
export async function flushPickedJewels(): Promise<void> {
  const picked = store.getState().game.pickedJewels ?? [];
  if (picked.length === 0 || store.getState().auth.status !== 'signedIn') return;
  if (__DEV__) console.log('[flushPickedJewels] flushing', picked);
  try {
    const ok = await bulkPickJewel(picked);
    if (ok) {
      if (__DEV__) console.log('[flushPickedJewels] succeeded, clearing queue and refreshing game state');
      store.dispatch(pickedJewelsCleared());
      void refreshGameState();
    } else if (__DEV__) {
      console.log('[flushPickedJewels] server returned error:true, leaving queue in place');
    }
  } catch (err) {
    // best-effort — queue stays put, retried on the next trigger
    if (__DEV__) console.log('[flushPickedJewels] request failed', err);
  }
}

const explodingTaskIds = new Set<number>();

/**
 * Best-effort, deduped per task row id: explodes a bomb task server-side
 * and requests the next task. Deduped because the countdown driving this
 * can be mounted on both GameScreen's card and TaskDetailScreen's top card
 * simultaneously (React Navigation keeps prior stack screens mounted), and
 * separately via the foreground/cold-launch catch-up scan
 * (checkForExplodedBombs) — without this, the same explosion could fire
 * twice. Deliberately does NOT refresh tasks/game state itself — the live
 * (on-screen) callers show an explosion Lottie first and only refresh once
 * the user dismisses it (see refreshAfterBombExplosion); the headless
 * catch-up scan refreshes immediately since there's no UI to wait on.
 * Returns whether the explosion was recorded server-side.
 */
export async function explodeBomb(taskId: number, id: number): Promise<boolean> {
  if (explodingTaskIds.has(id)) return false;
  explodingTaskIds.add(id);
  try {
    const ok = await explodeBombApi(taskId, id);
    if (ok) {
      void getNewTaskOnTaskCompletion();
    } else if (__DEV__) {
      console.log('[explodeBomb] server returned error:true', { taskId, id });
    }
    return ok;
  } catch (err) {
    if (__DEV__) console.log('[explodeBomb] failed', err);
    return false;
  } finally {
    explodingTaskIds.delete(id);
  }
}

/** Call once a bomb explosion's flow has fully settled (its Lottie dismissed, or immediately for the headless catch-up scan) to pull the updated task list + game state. */
export async function refreshAfterBombExplosion(): Promise<void> {
  await Promise.all([refreshGameState(), refreshTasks()]);
}

/**
 * Call on app foreground/cold launch: explodes any bomb tasks whose
 * deadline (completed_at, UTC) already passed while backgrounded/closed,
 * so a user who never had the countdown on screen still gets the
 * explosion applied. No Lottie here (nothing to show it to) — refreshes
 * immediately after.
 */
export async function checkForExplodedBombs(): Promise<void> {
  if (store.getState().auth.status !== 'signedIn') return;
  const tasks = store.getState().tasks.tasks ?? [];
  const delta = (await getGameServerTimeDelta()) ?? 0;
  const gameNow = Date.now() + delta;
  const overdue = tasks.filter(
    (t) => t.is_bomb === 1 && !t.done && t.completed_at && parseServerTimestamp(t.completed_at) <= gameNow,
  );
  if (overdue.length === 0) return;
  for (const t of overdue) await explodeBomb(t.task_id, t.id);
  await refreshAfterBombExplosion();
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
  void refreshGameState();
  void refreshTasks();
  void refreshFactories();
  void refreshUserFactory();
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
    void refreshGameState();
    void refreshTasks();
    void refreshFactories();
    void refreshUserFactory();
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
  void refreshGameState();
  // Chained (not fire-and-forget alongside itself) so a bomb whose deadline
  // passed while the app was fully killed — not just backgrounded — still
  // gets exploded on the very next cold launch, same as the
  // background->foreground path in useAppState.ts.
  void refreshTasks().then(() => checkForExplodedBombs());
  void refreshFactories();
  void refreshUserFactory();
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
