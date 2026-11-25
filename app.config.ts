import { existsSync } from 'fs';
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

// Public legal pages served by ServerProjextX (public/*.html, controllers/legal.js).
// Linked from Settings + onboarding, and from the Play Console listing.
const LEGAL_BASE_URL = 'https://game.jewelchat.net';

// Firebase native config files (both gitignored; download from the Firebase
// console, project jewel-chat-1984). Referenced only if present, so a fresh
// checkout without them still prebuilds — App Check / FCM just won't work.
const ANDROID_GOOGLE_SERVICES = './google-services.json';
const IOS_GOOGLE_SERVICES = './GoogleService-Info.plist';
const hasAndroidGoogleServices = existsSync(ANDROID_GOOGLE_SERVICES);
const hasIosGoogleServices = existsSync(IOS_GOOGLE_SERVICES);

// Bump for every Play upload (Play rejects a reused versionCode).
const ANDROID_VERSION_CODE = 1;

// Point a development build at a local stack (ServerProjextX + ChatServerConf
// docker), e.g. for push testing. From an Android emulator the host is
// 10.0.2.2:
//   JC_GAMESERVER_URL=http://10.0.2.2:3000 JC_CHATSERVER_URL=ws://10.0.2.2:5280/ws-xmpp npx expo start
// Ignored outside APP_ENV=development.
const LOCAL_OVERRIDES = APP_ENV === 'development';
const gameserverUrl = (LOCAL_OVERRIDES && process.env.JC_GAMESERVER_URL) || GAMESERVER_URLS[APP_ENV];
const chatserverUrl = (LOCAL_OVERRIDES && process.env.JC_CHATSERVER_URL) || CHATSERVER_URLS[APP_ENV];

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Jewel Chat',
  slug: 'jewelchatfrontend',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'light',
  ios: {
    supportsTablet: true,
    // Matches android.package below by convention — wasn't set at all before
    // (iOS builds/EAS/Firebase app registration all require one). Change this
    // if you've already reserved a different bundle id in App Store Connect.
    bundleIdentifier: 'net.jewelchat.app',
    // No GoogleService-Info.plist yet (iOS app not registered in Firebase).
    // iOS prebuild needs it once the Firebase plugins below are active.
    // The App Attest entitlement goes with it, since it needs the App Attest
    // capability on the Apple developer account.
    ...(hasIosGoogleServices
      ? {
          googleServicesFile: IOS_GOOGLE_SERVICES,
          entitlements: {
            'com.apple.developer.devicecheck.appattest-environment':
              APP_ENV === 'production' ? 'production' : 'development',
          },
        }
      : {}),
  },
  android: {
    package: 'net.jewelchat.app',
    versionCode: ANDROID_VERSION_CODE,
    // Firebase project jewel-chat-1984: App Check (Play Integrity) and FCM push.
    ...(hasAndroidGoogleServices ? { googleServicesFile: ANDROID_GOOGLE_SERVICES } : {}),
    // expo-contacts adds WRITE_CONTACTS, but the app only ever reads contacts.
    // Play reviews every declared sensitive permission, so drop the unused one.
    blockedPermissions: ['android.permission.WRITE_CONTACTS'],
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
    // Firebase App Check (gates /registerPhoneNumber, /verifyCode, /getAccessToken
    // once the server sets APP_CHECK_ENABLED, see appCheckService.ts and
    // gameserver/client.ts). After changing anything here, run
    // `expo prebuild --clean`.
    '@react-native-firebase/app',
    '@react-native-firebase/app-check',
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
    // Remote push (FCM via MongooseIM XEP-0357, see services/pushService.ts).
    // Not available in Expo Go: needs a dev or release build. The icon must be
    // a white-on-transparent silhouette (Android tints it).
    [
      'expo-notifications',
      {
        icon: './assets/android-icon-monochrome.png',
        color: '#6D28D9',
        defaultChannel: 'messages',
      },
    ],
    // Real release signing config for local `./gradlew bundleRelease`. See
    // the plugin's header comment and docs/play-store-release.md.
    './plugins/withReleaseSigning',
  ],
  extra: {
    appEnv: APP_ENV,
    gameserverUrl,
    chatserverUrl,
    chatserverDomain: CHATSERVER_DOMAINS[APP_ENV],
    klipyApiKey: process.env.EXPO_PUBLIC_KLIPY_API_KEY ?? '',
    privacyPolicyUrl: `${LEGAL_BASE_URL}/privacy`,
    termsUrl: `${LEGAL_BASE_URL}/terms`,
    accountDeletionUrl: `${LEGAL_BASE_URL}/account/delete`,
  },
});
