import { combineReducers, configureStore } from '@reduxjs/toolkit';
import {
  persistReducer,
  persistStore,
  FLUSH,
  REHYDRATE,
  PAUSE,
  PERSIST,
  PURGE,
  REGISTER,
} from 'redux-persist';
import AsyncStorage from '@react-native-async-storage/async-storage';
import devToolsEnhancer from 'redux-devtools-expo-dev-plugin';

import authReducer from './slices/authSlice';
import chatReducer from './slices/chatSlice';
import factoryReducer from './slices/factorySlice';
import gameReducer from './slices/gameSlice';
import loadingReducer from './slices/loadingSlice';
import taskElementsReducer from './slices/taskElementsSlice';
import tasksReducer from './slices/tasksSlice';
import themeReducer from './slices/themeSlice';
import userFactoryReducer from './slices/userFactorySlice';

const rootReducer = combineReducers({
  auth: authReducer,
  chat: chatReducer,
  factory: factoryReducer,
  game: gameReducer,
  loading: loadingReducer,
  taskElements: taskElementsReducer,
  tasks: tasksReducer,
  theme: themeReducer,
  userFactory: userFactoryReducer,
});

const persistConfig = {
  key: 'root',
  storage: AsyncStorage,
  // Only non-sensitive UI state is persisted. Deliberately excluded:
  //  - `chat`: activeConversationJid/typing/connectionStatus/drafts are all
  //    ephemeral session state (see chatSlice's own doc comment) — reviving
  //    a stale XMPP connection status or a days-old typing indicator on
  //    launch would be actively wrong, not just unnecessary.
  //  - `auth`: this slice never holds tokens (those live in
  //    expo-secure-store via authService), but session status itself is
  //    re-derived from a secure-store token check at startup, not
  //    rehydrated from AsyncStorage.
  //  - Message history and conversation lists are never in Redux at all —
  //    SQLite (src/database/) is their source of truth.
  //  - `game` (score/jewels) IS persisted, unlike chat/auth above — the last
  //    known value should render immediately on relaunch, ahead of the
  //    fresh fetch that runs on every login/foreground (authService.ts).
  //  - `tasks` is refetched on every login/foreground the same way `game`
  //    is, but isn't persisted — no relaunch-freshness requirement given
  //    for it (unlike `game`), so it defaults to the same ephemeral
  //    treatment as `chat`.
  //  - `taskElements` is a per-task_id in-session cache (see
  //    useTaskElements.ts) — "don't refetch on re-entering the same task"
  //    only needs to survive navigation within a session, which plain
  //    (non-persisted) Redux state already does.
  //  - `factory` (the /getFactories catalog: definitions + material costs)
  //    IS persisted, like `game` — it's static reference data, not per-user
  //    state, so authService.refreshFactories fetches it once ever (skipped
  //    whenever it's already populated) rather than refetching on every
  //    login/foreground.
  //  - `userFactory` (the /getUserFactory per-user is_on/start_time rows)
  //    is the per-user counterpart to `factory` and gets the same ephemeral
  //    treatment as `tasks` — refetched every login/foreground, not
  //    persisted.
  //  - `loading` (FloatingLoadingPanel's activeCount/message — see
  //    loadingService.ts) is transient by definition: persisting a stuck
  //    "loading" state across an app relaunch would show a permanent
  //    spinner for a request that already finished or was killed with the
  //    app.
  whitelist: ['theme', 'game', 'factory'],
};

const persistedReducer = persistReducer(persistConfig, rootReducer);

export const store = configureStore({
  reducer: persistedReducer,
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        // redux-persist dispatches non-serializable actions during
        // rehydration/persistence; this is the standard exemption from
        // the redux-persist + RTK integration docs.
        ignoredActions: [FLUSH, REHYDRATE, PAUSE, PERSIST, PURGE, REGISTER],
      },
      // Dev-only mutation-detection middleware (deep-clones + diffs the
      // whole state tree around every dispatch) — disabled entirely in
      // production, so this only affects local dev console noise. Default
      // warnAfter (32ms) is tuned for small web app states; this app's
      // combined state (chat/game/tasks/factory/userFactory/etc.) routinely
      // exceeds that on-device, per RTK's own docs' recommended remedy for
      // this exact warning: raise the threshold rather than disable the
      // check and lose real accidental-mutation detection.
      immutableCheck: { warnAfter: 128 },
    }),
  // Expo's own DevTools plugin (works in Expo Go, no dev-client needed) —
  // opened via `Shift+M` in the `npx expo start` terminal. Dev-only: the
  // built-in browser-extension devTools stay off entirely in production.
  devTools: false,
  enhancers: __DEV__
    ? (getDefaultEnhancers) => getDefaultEnhancers().concat(devToolsEnhancer())
    : undefined,
});

export const persistor = persistStore(store);

export type RootState = ReturnType<typeof rootReducer>;
export type AppDispatch = typeof store.dispatch;
