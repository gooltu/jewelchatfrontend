import type { ExpoConfig, ConfigContext } from 'expo/config';

type AppEnv = 'development' | 'staging' | 'production';

const APP_ENV = (process.env.APP_ENV as AppEnv) || 'development';

const GAMESERVER_URLS: Record<AppEnv, string> = {
  development: 'https://dev.gameserver.jewelchat.example.com/api',
  staging: 'https://staging.gameserver.jewelchat.example.com/api',
  production: 'https://gameserver.jewelchat.example.com/api',
};

const CHATSERVER_URLS: Record<AppEnv, string> = {
  development: 'wss://dev.chat.jewelchat.example.com/ws',
  staging: 'wss://staging.chat.jewelchat.example.com/ws',
  production: 'wss://chat.jewelchat.example.com/ws',
};

const CHATSERVER_DOMAINS: Record<AppEnv, string> = {
  development: 'dev.chat.jewelchat.example.com',
  staging: 'staging.chat.jewelchat.example.com',
  production: 'chat.jewelchat.example.com',
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
  },
});
