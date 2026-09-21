import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

/**
 * Drives the global FloatingLoadingPanel (src/components/shared/) — opt-in
 * per backend flow via loadingService.showLoading/hideLoading, NOT a global
 * request interceptor. Most flows in this app are already fire-and-forget
 * or gate their own button with local `busy` state; this is only for flows
 * that additionally want a visible, app-wide "something is happening"
 * indicator (e.g. FactoryScreen's start/stop/transfer).
 *
 * `activeCount` (not a boolean) so two overlapping flows don't fight over
 * hiding the panel — it only disappears once every caller that showed it
 * has also hidden it.
 */
interface LoadingSliceState {
  activeCount: number;
  message: string | null;
}

const initialState: LoadingSliceState = { activeCount: 0, message: null };

const loadingSlice = createSlice({
  name: 'loading',
  initialState,
  reducers: {
    loadingStarted(state, action: PayloadAction<string | undefined>) {
      state.activeCount += 1;
      if (action.payload) state.message = action.payload;
    },
    loadingFinished(state) {
      state.activeCount = Math.max(0, state.activeCount - 1);
      if (state.activeCount === 0) state.message = null;
    },
  },
});

export const { loadingStarted, loadingFinished } = loadingSlice.actions;
export default loadingSlice.reducer;
