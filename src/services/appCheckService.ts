import { TurboModuleRegistry } from 'react-native';
import type { AppCheck } from '@react-native-firebase/app-check';
import { setAppCheckTokenProvider } from '../gameserver/client';

// Required lazily, inside configureAppCheck's try: in a build without the
// Firebase native modules (JC_NO_FIREBASE=1, see app.config.ts), merely
// importing these packages throws "Native module NativeRNFBTurboApp is not
// registered" at module load, which would take the whole app down with it.
type FirebaseAppModule = typeof import('@react-native-firebase/app');
type FirebaseAppCheckModule = typeof import('@react-native-firebase/app-check');
let appCheckModule: FirebaseAppCheckModule | null = null;

/**
 * Firebase App Check for the three endpoints gated behind it server-side
 * (/registerPhoneNumber, /verifyCode, /getAccessToken — see
 * gameserver/client.ts's APP_CHECK_PROTECTED_PATHS). Real Play Integrity (Android)
 * / App Attest (iOS) don't work in emulators/simulators, so __DEV__ builds use the
 * debug provider instead — its token (logged below) must be registered in the
 * Firebase console under App Check > this app > Manage debug tokens, or every
 * debug-build request to those three endpoints will 403.
 */

let appCheckInstance: AppCheck | null = null;

/**
 * Call once at startup (see App.tsx), before any of the three gated endpoints can
 * fire. Best-effort, like the rest of this file: getApp()/initializeAppCheck()
 * throw synchronously if the native Firebase config (google-services.json /
 * GoogleService-Info.plist + a prebuild that picked them up) isn't in place yet —
 * swallowed here so that's a missing-attestation-header problem for the three gated
 * endpoints (they'll 403, see AttestationError in client.ts) rather than an
 * app-wide startup crash. Safe to leave unconfigured during development; this
 * starts working the moment the real Firebase setup lands, no code change needed.
 */
export function configureAppCheck(): void {
  if (appCheckInstance) return;
  // Checked first, not just caught: in dev, Metro reports a module that throws
  // while loading to LogBox as an uncaught error even when the require is
  // inside a try, and that full-screen error covers the app.
  if (!TurboModuleRegistry.get('NativeRNFBTurboApp')) {
    if (__DEV__) console.log('[appCheck] Firebase native module not in this build; App Check off');
    return;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getApp } = require('@react-native-firebase/app') as FirebaseAppModule;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const appCheck = require('@react-native-firebase/app-check') as FirebaseAppCheckModule;
    const { initializeAppCheck, ReactNativeFirebaseAppCheckProvider } = appCheck;
    appCheckModule = appCheck;
    const provider = new ReactNativeFirebaseAppCheckProvider();
    provider.configure({
      android: { provider: __DEV__ ? 'debug' : 'playIntegrity' },
      apple: { provider: __DEV__ ? 'debug' : 'appAttestWithDeviceCheckFallback' },
    });

    appCheckInstance = initializeAppCheck(getApp(), {
      provider,
      isTokenAutoRefreshEnabled: true,
    });

    setAppCheckTokenProvider(getAppCheckToken);
  } catch (err) {
    if (__DEV__) console.log('[appCheck] configureAppCheck failed — Firebase not set up yet?', err);
  }
}

/**
 * Best-effort — resolves to null (never throws) on any failure, so a device that
 * can't attest still gets its request sent without the header; the backend's own
 * 403 (surfaced as AttestationError, see client.ts) is the real signal of failure,
 * not this function.
 */
async function getAppCheckToken(): Promise<string | null> {
  if (!appCheckInstance || !appCheckModule) return null;
  try {
    const { token } = await appCheckModule.getToken(appCheckInstance);
    // The raw debug token to register in the Firebase console (App Check > this app
    // > Manage debug tokens) is printed by the native SDK itself to the
    // Xcode/Logcat console on first run with provider 'debug' — not this JWT, which
    // is the already-exchanged App Check token attached to the request.
    if (__DEV__) console.log('[appCheck] token fetched');
    return token;
  } catch (err) {
    if (__DEV__) console.log('[appCheck] getToken failed', err);
    return null;
  }
}
