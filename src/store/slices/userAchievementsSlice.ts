import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { UserAchievement } from '@app-types/game';

/**
 * The signed-in user's per-achievement progress (level) — unlike
 * userFactorySlice.ts (which always refetches on login/foreground since a
 * factory's is_on/start_time changes from other flows in this same app),
 * this is only fetched if not already present in Redux, per an explicit
 * choice for this feature: checked at both app-load and app-foreground
 * (see authService.refreshUserAchievements), not persisted — so a fresh
 * cold launch always refetches once, but re-foregrounding within the same
 * session doesn't redundantly refetch.
 */
interface UserAchievementsSliceState {
  userAchievements: UserAchievement[] | null;
}

const initialState: UserAchievementsSliceState = { userAchievements: null };

const userAchievementsSlice = createSlice({
  name: 'userAchievements',
  initialState,
  reducers: {
    userAchievementsReceived(state, action: PayloadAction<UserAchievement[]>) {
      state.userAchievements = action.payload;
    },
  },
});

export const { userAchievementsReceived } = userAchievementsSlice.actions;
export default userAchievementsSlice.reducer;
