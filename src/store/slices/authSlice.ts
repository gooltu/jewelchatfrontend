import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

/**
 * Session UI state only — the actual access/refresh tokens live in
 * expo-secure-store, owned by authService, and are never dispatched into
 * Redux (and never persisted via redux-persist's AsyncStorage-backed
 * storage engine).
 */
export type AuthStatus = 'initializing' | 'signedOut' | 'authenticating' | 'signedIn';

interface AuthState {
  status: AuthStatus;
  userId: string | null;
  jid: string | null;
  displayName: string | null;
  error: string | null;
}

const initialState: AuthState = {
  status: 'initializing',
  userId: null,
  jid: null,
  displayName: null,
  error: null,
};

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    authenticationStarted(state) {
      state.status = 'authenticating';
      state.error = null;
    },
    signedIn(
      state,
      action: PayloadAction<{ userId: string; jid: string; displayName: string }>,
    ) {
      state.status = 'signedIn';
      state.userId = action.payload.userId;
      state.jid = action.payload.jid;
      state.displayName = action.payload.displayName;
      state.error = null;
    },
    authenticationFailed(state, action: PayloadAction<string>) {
      state.status = 'signedOut';
      state.error = action.payload;
    },
    signedOut(state) {
      state.status = 'signedOut';
      state.userId = null;
      state.jid = null;
      state.displayName = null;
      state.error = null;
    },
  },
});

export const { authenticationStarted, signedIn, authenticationFailed, signedOut } =
  authSlice.actions;
export default authSlice.reducer;
