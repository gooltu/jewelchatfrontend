import * as Device from 'expo-device';

/**
 * Wraps expo-device's isRootedExperimentalAsync (root on Android, jailbreak
 * on iOS). It's marked experimental upstream and throws UnavailabilityError
 * on platforms/runtimes (e.g. web) where the native check isn't wired up,
 * so this resolves to null rather than throwing in that case.
 */
export async function checkRootStatus(): Promise<boolean | null> {
  try {
    return await Device.isRootedExperimentalAsync();
  } catch {
    return null;
  }
}
