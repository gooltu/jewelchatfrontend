import { createSlice } from '@reduxjs/toolkit';

/**
 * One tiny persisted flag: whether the one-time roster/presence-subscription
 * backfill (chatService.backfillRosterSubscriptions) has already run. Same
 * "fetch/run once ever, persisted so it's never repeated" treatment as
 * factorySlice/achievementsSlice — just a boolean instead of a catalog.
 */
interface RosterSliceState {
  backfillComplete: boolean;
}

const initialState: RosterSliceState = { backfillComplete: false };

const rosterSlice = createSlice({
  name: 'roster',
  initialState,
  reducers: {
    backfillMarkedComplete(state) {
      state.backfillComplete = true;
    },
  },
});

export const { backfillMarkedComplete } = rosterSlice.actions;
export default rosterSlice.reducer;
