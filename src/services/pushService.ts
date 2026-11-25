import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { disablePush, enablePush } from '@chatserver/push';

/**
 * Remote push registration, done over XMPP (XEP-0357) rather than a game
 * server endpoint. MongooseIM keeps the subscription in its own
 * event_pusher_push_subscription table. When a message arrives for this user
 * with no live session, it calls ServerProjextX, which sends through FCM
 * (see ChatServerConf/CLAUDE.md "mod_push_service_mongoosepush").
 *
 * The token is the native FCM device token (getDevicePushTokenAsync), not
 * an Expo push token: the server talks to FCM directly through
 * firebase-admin. Android only for now. iOS would need APNs through FCM and a
 * GoogleService-Info.plist, which this project doesn't have yet.
 *
 * Only chatService calls into this module (enable on every 'connected',
 * disable on logout), so screens never touch it directly.
 */

const NODE_ID_KEY = 'pushNodeId';

/**
 * Must match ServerProjextX utils/buildFcmMessage.js's android.notification.channelId.
 * If FCM names a channel that doesn't exist, Android falls back to a
 * low-importance default, so chat pushes would arrive silently.
 */
export const MESSAGES_CHANNEL_ID = 'messages';

export async function ensureNotificationChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(MESSAGES_CHANNEL_ID, {
    name: 'Messages',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    showBadge: true,
  });
}

let tokenSubscription: Notifications.EventSubscription | null = null;
let currentJid: string | null = null;
let registrationInFlight: Promise<void> | null = null;
/** Token most recently sent in an enable IQ, so a listener echo of the same token is ignored. */
let lastRegisteredToken: string | null = null;

// Emulators with Google Play services get real FCM tokens too, so there's
// no Device.isDevice gate. Without Play services, getDevicePushTokenAsync
// throws, and ensurePushRegistered logs and swallows it.
function pushSupported(): boolean {
  return Platform.OS === 'android';
}

function randomId(): string {
  const bytes = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Stable per-install XEP-0357 node id, so re-enabling replaces rather than duplicates. */
export async function getPushNodeId(): Promise<string> {
  const existing = await SecureStore.getItemAsync(NODE_ID_KEY);
  if (existing) return existing;
  const created = `jc-${randomId()}`;
  await SecureStore.setItemAsync(NODE_ID_KEY, created);
  return created;
}

async function ensurePermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.status === 'granted') return true;
  if (!current.canAskAgain) return false;
  const requested = await Notifications.requestPermissionsAsync();
  return requested.status === 'granted';
}

async function register(myJid: string, token?: string): Promise<void> {
  const log = (msg: string) => {
    if (__DEV__) console.log(`[pushService] ${msg}`);
  };
  log('registering');
  await ensureNotificationChannels();
  if (!(await ensurePermission())) {
    log('notification permission not granted, skipping');
    return;
  }
  const fcmToken = token ?? (await Notifications.getDevicePushTokenAsync()).data;
  if (typeof fcmToken !== 'string' || !fcmToken) {
    log('no FCM token, skipping');
    return;
  }
  const nodeId = await getPushNodeId();
  await enablePush(myJid, nodeId, fcmToken);
  lastRegisteredToken = fcmToken;
  log(`enabled (node ${nodeId})`);
}

/**
 * Idempotent: call on every transition to 'connected'. Registering means
 * asking for notification permission (Android 13+ POST_NOTIFICATIONS), getting
 * the FCM token and sending the XEP-0357 enable IQ. Failures are logged and
 * swallowed, because push must never block the chat connection.
 */
export function ensurePushRegistered(myJid: string): Promise<void> {
  if (!pushSupported()) return Promise.resolve();
  currentJid = myJid;

  if (!tokenSubscription) {
    // FCM can rotate the token at any time. Re-register with the new token
    // while signed in, so pushes don't go to a dead token.
    tokenSubscription = Notifications.addPushTokenListener((devicePushToken) => {
      if (!currentJid || typeof devicePushToken.data !== 'string') return;
      // The listener also fires for the very first token fetch, the one the
      // in-flight registration is already sending. Only a genuinely new token
      // needs another enable.
      if (registrationInFlight || devicePushToken.data === lastRegisteredToken) return;
      void register(currentJid, devicePushToken.data).catch((error) => {
        if (__DEV__) console.log('[pushService] re-register after token refresh failed:', error);
      });
    });
  }

  if (!registrationInFlight) {
    registrationInFlight = register(myJid)
      .catch((error) => {
        if (__DEV__) console.log('[pushService] push registration failed:', error);
      })
      .finally(() => {
        registrationInFlight = null;
      });
  }
  return registrationInFlight;
}

/**
 * Call before disconnecting on sign-out. Removes this device's
 * subscription server-side, so a signed-out phone stops getting the
 * previous user's pushes. Best-effort: if it fails (offline, for example),
 * the old subscription stays until the next sign-in on this install replaces
 * it, since that sign-in reuses the same node id.
 */
export async function unregisterPush(): Promise<void> {
  const jid = currentJid;
  currentJid = null;
  lastRegisteredToken = null;
  tokenSubscription?.remove();
  tokenSubscription = null;
  if (!jid || !pushSupported()) return;
  try {
    // Capped so a half-dead socket can't hold up sign-out for the full IQ timeout.
    const nodeId = await getPushNodeId();
    await Promise.race([
      disablePush(jid, nodeId),
      new Promise((_, reject) => setTimeout(() => reject(new Error('disablePush: gave up after 3s')), 3_000)),
    ]);
  } catch (error) {
    if (__DEV__) console.log('[pushService] push unregister failed:', error);
  }
  await Notifications.dismissAllNotificationsAsync().catch(() => undefined);
}

/**
 * Clears the system-tray notifications for one conversation once the user
 * opens it. Called from chatService.setActiveConversation.
 */
export async function dismissNotificationsForConversation(chatRoomJid: string): Promise<void> {
  if (!pushSupported()) return;
  try {
    const presented = await Notifications.getPresentedNotificationsAsync();
    await Promise.all(
      presented
        .filter((n) => (n.request.content.data as { chatRoomJid?: unknown } | null)?.chatRoomJid === chatRoomJid)
        .map((n) => Notifications.dismissNotificationAsync(n.request.identifier)),
    );
  } catch (error) {
    if (__DEV__) console.log('[pushService] dismiss notifications failed:', error);
  }
}

/** Test-only reset of module state. */
export function resetPushServiceForTests(): void {
  tokenSubscription = null;
  currentJid = null;
  registrationInFlight = null;
  lastRegisteredToken = null;
}
