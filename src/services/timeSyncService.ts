import AsyncStorage from '@react-native-async-storage/async-storage';
import { getGameServerTime } from '../gameserver/timeApi';
import { getChatServerTime } from '../chatserver/entityTime';

const DELTA_CHAT_KEY = 'jewelchat.serverTimeDeltaChat';
const DELTA_GAME_KEY = 'jewelchat.serverTimeDeltaGame';
const BACKGROUND_CHAT_TIME_KEY = 'jewelchat.backgroundChatTime';

/**
 * Queries both servers' current time and persists, against a single shared
 * app-clock reading (`appTime`) taken right before both queries fire:
 *   deltaChat = chatServerTime - appTime
 *   deltaGame = gameServerTime - appTime
 * Used later to reconcile chat-server-stamped history timestamps against
 * the app's/game server's clock. Best-effort: failures are logged (dev
 * only) and swallowed so a transient failure here never breaks the chat
 * connection.
 */
export async function syncServerTimeDelta(): Promise<void> {
  try {
    const appTime = Date.now();
    const [chatServerTime, gameServerTime] = await Promise.all([
      getChatServerTime(),
      getGameServerTime(),
    ]);
    const deltaChat = chatServerTime - appTime;
    const deltaGame = gameServerTime - appTime;
    await Promise.all([
      AsyncStorage.setItem(DELTA_CHAT_KEY, String(deltaChat)),
      AsyncStorage.setItem(DELTA_GAME_KEY, String(deltaGame)),
    ]);
    if (__DEV__) {
      console.log(
        `[timeSync] appTime=${appTime} chatServerTime=${chatServerTime} gameServerTime=${gameServerTime} deltaChat=${deltaChat}ms deltaGame=${deltaGame}ms`,
      );
    }
  } catch (error) {
    if (__DEV__) {
      console.log('[timeSync] failed to sync server time deltas:', error);
    }
  }
}

/** Reads back the persisted chat-server delta (ms), or null if never successfully synced. */
export async function getChatServerTimeDelta(): Promise<number | null> {
  const raw = await AsyncStorage.getItem(DELTA_CHAT_KEY);
  return raw !== null ? Number(raw) : null;
}

/** Reads back the persisted game-server delta (ms), or null if never successfully synced. */
export async function getGameServerTimeDelta(): Promise<number | null> {
  const raw = await AsyncStorage.getItem(DELTA_GAME_KEY);
  return raw !== null ? Number(raw) : null;
}

/**
 * Called when the app goes to background. Persists an estimate of the chat
 * server's clock at this moment (appTime + deltaChat), so that on the next
 * foreground the app knows the point (in chat-server time) to resume
 * history download from. No-op if a chat-server delta hasn't been
 * established yet (e.g. the app backgrounds before ever connecting).
 */
export async function recordBackgroundChatTime(): Promise<void> {
  const deltaChat = await getChatServerTimeDelta();
  if (deltaChat === null) return;

  const chatTimeAtBackground = Date.now() + deltaChat;
  await AsyncStorage.setItem(BACKGROUND_CHAT_TIME_KEY, String(chatTimeAtBackground));
  if (__DEV__) {
    console.log(`[timeSync] backgrounded at chatServerTime=${chatTimeAtBackground}`);
  }
}

/** Reads back the persisted chat-server time at the last backgrounding (ms), or null if never recorded. */
export async function getBackgroundChatTime(): Promise<number | null> {
  const raw = await AsyncStorage.getItem(BACKGROUND_CHAT_TIME_KEY);
  return raw !== null ? Number(raw) : null;
}

/**
 * Parses a "YYYY-MM-DD HH:mm:ss" backend timestamp (no timezone marker,
 * confirmed UTC — e.g. GameTask.completed_at) explicitly as UTC. A bare
 * `new Date(str)` on this non-ISO ("space" instead of "T", no "Z") format
 * is interpreted as local time by some JS engines, which would silently
 * shift a bomb countdown by the device's UTC offset.
 */
export function parseServerTimestamp(value: string): number {
  const [datePart, timePart] = value.split(' ');
  if (!datePart || !timePart) return NaN;
  const [year, month, day] = datePart.split('-').map(Number);
  const [hour, minute, second] = timePart.split(':').map(Number);
  return Date.UTC(year, month - 1, day, hour, minute, second);
}

/**
 * Factory endpoints (/startFactory, /getUserFactory) have been observed
 * sending start_time in several different shapes: a numeric string of
 * epoch seconds (e.g. "1789456675"), a full ISO-8601 string (e.g.
 * "2026-09-21T07:26:39.000Z" — has an explicit "T"/"Z", so it's unambiguous
 * for a bare `new Date()` unlike the non-ISO format below), or the same
 * "YYYY-MM-DD HH:mm:ss" format parseServerTimestamp handles elsewhere in
 * the app. Tries each in turn; never throws — returns NaN if none match,
 * so callers can treat that the same as any other failed fetch.
 */
export function parseFlexibleServerTimestamp(value: string): number {
  if (/^\d+$/.test(value)) return Number(value) * 1000;
  if (value.includes('T')) return new Date(value).getTime();
  return parseServerTimestamp(value);
}
