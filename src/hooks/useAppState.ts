import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { persistor, store } from '@store/index';
import { chatSessionReset } from '@store/slices/chatSlice';
import * as timeSyncService from '@services/timeSyncService';
import * as authService from '@services/authService';

/**
 * Flushes redux-persist to AsyncStorage on backgrounding (the OS can
 * suspend/kill the process without warning) and fires onForeground when
 * the app returns — e.g. to nudge chatService's XMPP connection. Also
 * resets chatSlice's connection/typing/active-conversation state on
 * backgrounding (see chatSessionReset's doc comment) so a stale cached
 * 'connected' status never survives into the next foreground resume.
 */
export function useAppState(options: { onForeground?: () => void; onBackground?: () => void } = {}): void {
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const { onForeground, onBackground } = options;

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (__DEV__) {
        console.log(`[appState] ${appStateRef.current} -> ${nextState}`);
      }

      const cameFromBackground = /inactive|background/.test(appStateRef.current);

      if (cameFromBackground && nextState === 'active') {
        void authService.reconnectChat();
        onForeground?.();
      }

      if (/inactive|background/.test(nextState)) {
        void persistor.flush();
        void timeSyncService.recordBackgroundChatTime();
        store.dispatch(chatSessionReset());
        onBackground?.();
      }

      appStateRef.current = nextState;
    });

    return () => subscription.remove();
  }, [onForeground, onBackground]);
}
