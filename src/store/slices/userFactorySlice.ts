import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { UserFactory } from '@app-types/game';

/** The signed-in user's per-factory run state (is_on/start_time) — refetched on every login/foreground like `tasks`, not persisted. */
interface UserFactorySliceState {
  userFactories: UserFactory[] | null;
  lastFetchedAt: number | null;
}

const initialState: UserFactorySliceState = { userFactories: null, lastFetchedAt: null };

const userFactorySlice = createSlice({
  name: 'userFactory',
  initialState,
  reducers: {
    userFactoriesReceived(state, action: PayloadAction<UserFactory[]>) {
      state.userFactories = action.payload;
      state.lastFetchedAt = Date.now();
    },
    /** POST /startFactory succeeded — flip (or create) this factory_id's run-state row so FactoryScreen's card switches to its running layout immediately, without waiting for the next /getUserFactory refresh. */
    factoryStarted(
      state,
      action: PayloadAction<{ factoryId: number; startTime: number; userId: number }>,
    ) {
      if (!state.userFactories) state.userFactories = [];
      const existing = state.userFactories.find((uf) => uf.factory_id === action.payload.factoryId);
      if (existing) {
        existing.is_on = 1;
        existing.start_time = action.payload.startTime;
      } else {
        state.userFactories.push({
          id: -action.payload.factoryId,
          factory_id: action.payload.factoryId,
          user_id: action.payload.userId,
          is_on: 1,
          start_time: action.payload.startTime,
        });
      }
    },
    /** POST /stopFactory or /transferJewelsFromFactory succeeded — both end the running state, so both route here for the same immediate, optimistic is_on: 0 flip (a follow-up refreshUserFactory call reconciles the canonical row). */
    factoryStopped(state, action: PayloadAction<{ factoryId: number }>) {
      const existing = state.userFactories?.find((uf) => uf.factory_id === action.payload.factoryId);
      if (existing) existing.is_on = 0;
    },
  },
});

export const { userFactoriesReceived, factoryStarted, factoryStopped } = userFactorySlice.actions;
export default userFactorySlice.reducer;
