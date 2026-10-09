import type { ExpoConfig, ConfigContext } from 'expo/config';

type AppEnv = 'development' | 'staging' | 'production';

const APP_ENV = (process.env.APP_ENV as AppEnv) || 'development';

const GAMESERVER_URLS: Record<AppEnv, string> = {
  development: 'https://game.jewelchat.net', //'http://10.0.2.2:3000/',
  staging: 'https://staging.gameserver.jewelchat.example.com/api',
  production: 'https://game.jewelchat.net',
};

const CHATSERVER_URLS: Record<AppEnv, string> = {
  development: 'wss://chat.jewelchat.net/ws-xmpp', //'ws://10.0.2.2:5280/ws-xmpp',
  staging: 'wss://staging.chat.jewelchat.example.com/ws',
  production: 'wss://chat.jewelchat.net/ws-xmpp',
};

const CHATSERVER_DOMAINS: Record<AppEnv, string> = {
  development: 'chat.jewelchat.net', //'dev.chat.jewelchat.example.com',
  staging: 'staging.chat.jewelchat.example.com',
  production: 'chat.jewelchat.net',
};

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'jewelchatfrontend',
  slug: 'jewelchatfrontend',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'light',
  ios: {
    supportsTablet: true,
  },
  android: {
    package: 'net.jewelchat.app',
    adaptiveIcon: {
      backgroundColor: '#E6F4FE',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
  },
  web: {
    favicon: './assets/favicon.png',
  },
  plugins: [
    'expo-font',
    'expo-asset',
    'expo-sqlite',
    'expo-secure-store',
    'expo-image',
    [
      'expo-contacts',
      {
        contactsPermission: 'Allow $(PRODUCT_NAME) to access your contacts to find people on Jewel Chat.',
      },
    ],
    // Gallery-only v1 (no camera capture yet) — cameraPermission explicitly
    // false so the native build doesn't request it. microphonePermission is
    // deliberately left unset (not false): setting it to false here emits a
    // manifest tools:node="remove" directive for RECORD_AUDIO, which strips
    // that permission from the final merged manifest regardless of plugin
    // order — which would silently break expo-audio's voice-note recording
    // below even though that plugin adds the permission back.
    [
      'expo-image-picker',
      {
        photosPermission: 'Allow $(PRODUCT_NAME) to access your photos to send them in chat.',
        cameraPermission: false,
      },
    ],
    'expo-video',
    [
      'expo-audio',
      {
        microphonePermission: 'Allow $(PRODUCT_NAME) to access your microphone to send voice messages.',
      },
    ],
    // expo-notifications disabled for early development: remote push isn't
    // testable in Expo Go (SDK 53+ removed it) and a dev client isn't set
    // up yet. Re-enable when that's in place.
    // [
    //   'expo-notifications',
    //   {
    //     icon: './assets/icon.png',
    //   },
    // ],
  ],
  extra: {
    appEnv: APP_ENV,
    gameserverUrl: GAMESERVER_URLS[APP_ENV],
    chatserverUrl: CHATSERVER_URLS[APP_ENV],
    chatserverDomain: CHATSERVER_DOMAINS[APP_ENV],
    klipyApiKey: process.env.EXPO_PUBLIC_KLIPY_API_KEY ?? '',
  },
});
