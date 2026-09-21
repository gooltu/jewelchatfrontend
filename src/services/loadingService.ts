import { store } from '../store';
import { loadingStarted, loadingFinished } from '../store/slices/loadingSlice';

/**
 * Imperative API for the global FloatingLoadingPanel — callable from plain
 * service functions (authService.ts) as well as components, unlike a hook.
 * Opt-in per call site: most backend flows in this app don't need it (they
 * already gate a button with local `busy` state, or are silent
 * fire-and-forget refreshes) — reserve this for flows where the user is
 * explicitly waiting on a result, e.g. FactoryScreen's start/stop/transfer.
 */
export function showLoading(message?: string): void {
  store.dispatch(loadingStarted(message));
}

export function hideLoading(): void {
  store.dispatch(loadingFinished());
}

/** Wraps an async flow with showLoading/hideLoading so callers can't forget the matching hide. */
export async function withLoading<T>(fn: () => Promise<T>, message?: string): Promise<T> {
  showLoading(message);
  try {
    return await fn();
  } finally {
    hideLoading();
  }
}
