import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { persistor, store } from '@store/index';
import { chatSessionReset } from '@store/slices/chatSlice';
import * as timeSyncService from '@services/timeSyncService';
import * as authService from '@services/authService';

/**
 * Set around any call that launches a separate native Activity/view we
 * expect to immediately return from — e.g. expo-image-picker's photo/video
 * picker. On Android in particular this genuinely pauses/stops our own
 * Activity (AppState reports a real 'background', not just 'inactive'),
 * even though the user never left the app and the XMPP connection is still
 * expected to be alive moments later. Module-level (not component state)
 * since callers like ChatDetailScreen's handleAttach aren't the component
 * that owns useAppState — only App.tsx calls the hook itself.
 */
let transientBackgroundExpected = false;

export function setTransientBackgroundExpected(expected: boolean): void {
  transientBackgroundExpected = expected;
}

/**
 * Flushes redux-persist to AsyncStorage on backgrounding (the OS can
 * suspend/kill the process without warning) and fires onForeground when
 * the app returns — e.g. to nudge chatService's XMPP connection. Also
 * resets chatSlice's connection/typing/active-conversation state on
 * backgrounding (see chatSessionReset's doc comment) so a stale cached
 * 'connected' status never survives into the next foreground resume.
 *
 * Only reacts to a genuine 'background' transition, not 'inactive' —
 * 'inactive' alone (most native modals/system sheets on iOS) still has the
 * app fully running with its XMPP connection intact. A real 'background'
 * transition that happened while setTransientBackgroundExpected(true) was
 * in effect (see above) is skipped too, for the same reason: the app
 * didn't actually leave, Android's picker Activity just paused ours for a
 * moment. Whether a given background entry was expected is captured at the
 * moment it happens (backgroundWasExpectedRef), not re-checked against the
 * flag's current value on return — the caller typically clears the flag as
 * soon as the picker call resolves, which can be before or after the
 * matching 'active' event arrives.
 */
export function useAppState(options: { onForeground?: () => void; onBackground?: () => void } = {}): void {
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const backgroundWasExpectedRef = useRef(false);
  const { onForeground, onBackground } = options;

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (__DEV__) {
        console.log(`[appState] ${appStateRef.current} -> ${nextState}`);
      }

      const cameFromBackground = appStateRef.current === 'background';

      if (nextState === 'background') {
        backgroundWasExpectedRef.current = transientBackgroundExpected;
      }

      if (cameFromBackground && nextState === 'active') {
        if (!backgroundWasExpectedRef.current) {
          void authService.reconnectChat();
          void authService.refreshGameState();
          // Chained (not fire-and-forget alongside refreshTasks) so the
          // overdue-bomb scan reads the just-refreshed task list, not
          // whatever was already in Redux from before backgrounding.
          void authService.refreshTasks().then(() => authService.checkForExplodedBombs());
          void authService.flushPickedJewels();
          // Both already skip the fetch entirely if already populated (see
          // their doc comments in authService.ts) — cheap to call on every
          // foreground, not just cold launch, per this feature's explicit
          // "loads or becomes active" requirement.
          void authService.refreshAchievements();
          void authService.refreshUserAchievements();
          onForeground?.();
        }
        backgroundWasExpectedRef.current = false;
      }

      if (nextState === 'background' && !transientBackgroundExpected) {
        void persistor.flush();
        void timeSyncService.recordBackgroundChatTime();
        void authService.flushPickedJewels();
        store.dispatch(chatSessionReset());
        onBackground?.();
      }

      appStateRef.current = nextState;
    });

    return () => subscription.remove();
  }, [onForeground, onBackground]);
}
