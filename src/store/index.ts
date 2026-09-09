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
import themeReducer from './slices/themeSlice';

const rootReducer = combineReducers({
  auth: authReducer,
  chat: chatReducer,
  theme: themeReducer,
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
  whitelist: ['theme'],
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
