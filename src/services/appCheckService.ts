import { getApp } from '@react-native-firebase/app';
import {
  initializeAppCheck,
  getToken,
  ReactNativeFirebaseAppCheckProvider,
  type AppCheck,
} from '@react-native-firebase/app-check';
import { setAppCheckTokenProvider } from '../gameserver/client';

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

  try {
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
  if (!appCheckInstance) return null;
  try {
    const { token } = await getToken(appCheckInstance);
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
