import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

/**
 * The signed-in user's invited-friends list — achievement_id 1's
 * current_value (see useAchievementChecklist.ts) is a count of these. No
 * backend flow wired up yet (row shape isn't specified either), so this
 * starts as an empty array and just holds `unknown` rows until that lands.
 */
interface InviteesSliceState {
  invitees: unknown[];
}

const initialState: InviteesSliceState = { invitees: [] };

const inviteesSlice = createSlice({
  name: 'invitees',
  initialState,
  reducers: {
    inviteesReceived(state, action: PayloadAction<unknown[]>) {
      state.invitees = action.payload;
    },
  },
});

export const { inviteesReceived } = inviteesSlice.actions;
export default inviteesSlice.reducer;
