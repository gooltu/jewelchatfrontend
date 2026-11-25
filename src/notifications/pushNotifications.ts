import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import { navigationRef } from '@navigation/AppNavigator';
import { store } from '@store/index';
import * as chatService from '@services/chatService';

/**
 * Notification presentation and tap-to-open routing. Registration (the
 * permission prompt, the FCM token, the XEP-0357 enable) lives in
 * services/pushService.ts.
 *
 * Remote pushes come from ServerProjextX's pushnotificationv3 as FCM
 * notification+data messages:
 * - App in background or killed: Android draws them itself on the
 *   `messages` channel.
 * - App in foreground: the handler below decides.
 *
 * Normally the app is disconnected from XMPP while backgrounded (see
 * useAppState.ts), so the server treats the user as offline and pushes.
 * While foregrounded and connected, no remote push is sent, because the
 * message arrives over the socket. The handler only matters for the brief
 * reconnect window right after returning to the foreground.
 *
 * Expo Go can't receive remote push (removed in SDK 53+). This needs a
 * development or release build (expo run:android).
 */

/** Data keys set by ServerProjextX utils/buildFcmMessage.js. FCM data values are always strings. */
interface RawChatNotificationData {
  chatRoomJid?: unknown;
  title?: unknown;
  isGroup?: unknown;
}

export interface ChatNotificationData {
  chatRoomJid: string;
  title: string;
  isGroup: boolean;
}

export function parseChatNotificationData(data: unknown): ChatNotificationData | null {
  if (typeof data !== 'object' || data === null) return null;
  const raw = data as RawChatNotificationData;
  if (typeof raw.chatRoomJid !== 'string' || !raw.chatRoomJid) return null;
  return {
    chatRoomJid: raw.chatRoomJid,
    title: typeof raw.title === 'string' ? raw.title : '',
    isGroup: raw.isGroup === true || raw.isGroup === 'true',
  };
}

Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const data = parseChatNotificationData(notification.request.content.data);
    // Suppress a push for the conversation the user is looking at right now.
    const isActiveThread =
      data !== null && store.getState().chat.activeConversationJid === data.chatRoomJid;
    return {
      shouldShowBanner: !isActiveThread,
      shouldShowList: !isActiveThread,
      shouldPlaySound: !isActiveThread,
      shouldSetBadge: false,
    };
  },
});

async function waitForNavigation(timeoutMs = 3_000): Promise<boolean> {
  const started = Date.now();
  while (!navigationRef.isReady()) {
    if (Date.now() - started > timeoutMs) return false;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return true;
}

async function routeToConversation(data: ChatNotificationData): Promise<void> {
  if (!(await waitForNavigation())) return;
  const title =
    (await chatService.getConversationTitle(data.chatRoomJid).catch(() => null)) ||
    data.title ||
    (data.isGroup ? 'Group' : 'Chat');
  // ChatDetail is a root-stack screen (sibling of App), not nested under
  // ChatsTab. See RootStackParamList's doc comment in navigation/types.ts.
  navigationRef.navigate('ChatDetail', {
    chatRoomJid: data.chatRoomJid,
    title,
    isGroup: data.isGroup,
  });
}

/**
 * Call once at the app root (App.tsx) to wire notification taps to the
 * conversation. Covers taps while running, and the tap that cold-started the
 * app (getLastNotificationResponseAsync). Only routes once signed in: a tap
 * on a cold start waits for the auth state to settle and the SignedIn
 * navigator to mount.
 */
export function useNotificationDeepLinking(isSignedIn: boolean): void {
  useEffect(() => {
    if (!isSignedIn) return;

    const respondedSubscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = parseChatNotificationData(response.notification.request.content.data);
      if (data) void routeToConversation(data);
    });

    void Notifications.getLastNotificationResponseAsync().then((response) => {
      const data = parseChatNotificationData(response?.notification.request.content.data);
      if (data) {
        void routeToConversation(data);
        // Otherwise a later sign-in in the same process would replay this tap.
        Notifications.clearLastNotificationResponse();
      }
    });

    return () => respondedSubscription.remove();
  }, [isSignedIn]);
}
