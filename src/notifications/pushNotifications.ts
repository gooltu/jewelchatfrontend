import { useEffect } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { navigationRef } from '@navigation/AppNavigator';

/**
 * expo-notifications setup + deep-link routing into the relevant
 * conversation screen.
 *
 * IMPORTANT: as of Expo SDK 53+, Expo Go no longer supports *remote* push
 * notifications on Android/iOS — only a custom dev client (expo-dev-client
 * + `expo prebuild`/EAS build) can receive/register for real push. Local
 * notifications (Notifications.scheduleNotificationAsync) still work fine
 * in Expo Go. This is a real deviation from "plain Expo Go" for this app,
 * separate from — and unrelated to — react-native-strophe (which has no
 * such restriction; see chatserver/stropheClient.ts's header comment).
 */

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export interface ChatNotificationData {
  chatRoomJid: string;
  title: string;
  isGroup: boolean;
}

function isChatNotificationData(data: unknown): data is ChatNotificationData {
  return (
    typeof data === 'object' &&
    data !== null &&
    typeof (data as ChatNotificationData).chatRoomJid === 'string'
  );
}

function routeToConversation(data: ChatNotificationData): void {
  if (!navigationRef.isReady()) return;
  navigationRef.navigate('App', {
    screen: 'ChatsTab',
    params: {
      screen: 'ChatDetail',
      params: { chatRoomJid: data.chatRoomJid, title: data.title, isGroup: data.isGroup },
    },
  });
}

export async function registerForPushNotificationsAsync(): Promise<string | null> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.MAX,
    });
  }

  if (!Device.isDevice) {
    return null; // Simulators/emulators can't register for push.
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') {
    return null;
  }

  const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
  if (!projectId) {
    // No EAS project linked yet — local notifications still work without this.
    return null;
  }

  const { data: expoPushToken } = await Notifications.getExpoPushTokenAsync({ projectId });
  return expoPushToken;
}

/** Call once near the app root (see App.tsx) to wire notification-tap deep links. */
export function useNotificationDeepLinking(): void {
  useEffect(() => {
    const respondedSubscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data;
      if (isChatNotificationData(data)) routeToConversation(data);
    });

    void Notifications.getLastNotificationResponseAsync().then((response) => {
      const data = response?.notification.request.content.data;
      if (isChatNotificationData(data)) routeToConversation(data);
    });

    return () => respondedSubscription.remove();
  }, []);
}
