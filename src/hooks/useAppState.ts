import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { persistor } from '@store/index';

/**
 * Flushes redux-persist to AsyncStorage on backgrounding (the OS can
 * suspend/kill the process without warning) and fires onForeground when
 * the app returns — e.g. to nudge chatService's XMPP connection.
 */
export function useAppState(options: { onForeground?: () => void; onBackground?: () => void } = {}): void {
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const { onForeground, onBackground } = options;

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      const cameFromBackground = /inactive|background/.test(appStateRef.current);

      if (cameFromBackground && nextState === 'active') {
        onForeground?.();
      }

      if (/inactive|background/.test(nextState)) {
        void persistor.flush();
        onBackground?.();
      }

      appStateRef.current = nextState;
    });

    return () => subscription.remove();
  }, [onForeground, onBackground]);
}
