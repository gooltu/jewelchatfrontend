import Constants from 'expo-constants';

type AppEnv = 'development' | 'staging' | 'production';

interface AppExtra {
  appEnv: AppEnv;
  gameserverUrl: string;
  chatserverUrl: string;
  chatserverDomain: string;
}

/**
 * Reads the per-environment values injected by app.config.ts (via `extra`),
 * surfaced at runtime through expo-constants. Keep all app.config.ts
 * `extra.*` reads centralized here rather than scattering
 * `Constants.expoConfig?.extra` calls across the codebase.
 */
const extra = Constants.expoConfig?.extra as AppExtra | undefined;

if (!extra) {
  throw new Error(
    'Missing app.config.ts "extra" values — Constants.expoConfig is undefined. ' +
      'This usually means the app was started with a stale bundle; restart the dev server.',
  );
}

export const env = {
  appEnv: extra.appEnv,
  gameserverUrl: extra.gameserverUrl,
  chatserverUrl: extra.chatserverUrl,
  chatserverDomain: extra.chatserverDomain,
  isDevelopment: extra.appEnv === 'development',
  isProduction: extra.appEnv === 'production',
};
