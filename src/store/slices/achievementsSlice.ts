import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { Achievement } from '@app-types/game';

/**
 * The /getAchievements catalog (definitions + diamond rewards) is static
 * reference data, not per-user state — persisted (see store/index.ts's
 * whitelist) so authService.refreshAchievements only ever fetches it once
 * (skipped whenever `achievements` is already non-null), same treatment as
 * factorySlice.ts.
 */
interface AchievementsSliceState {
  achievements: Achievement[] | null;
}

const initialState: AchievementsSliceState = { achievements: null };

const achievementsSlice = createSlice({
  name: 'achievements',
  initialState,
  reducers: {
    achievementsReceived(state, action: PayloadAction<Achievement[]>) {
      state.achievements = action.payload;
    },
  },
});

export const { achievementsReceived } = achievementsSlice.actions;
export default achievementsSlice.reducer;
