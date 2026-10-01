import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { Child } from '@app-types/game';

/**
 * The signed-in user's referred-users list, paginated 100/page via
 * POST /getChildren (see useReferrals.ts / ReferralsScreen.tsx) — the same
 * flat array achievements 18-32's current_value counts against (see
 * useAchievementChecklist.ts), so pages loaded from the Referrals screen
 * benefit that computation too.
 */
interface ChildrenSliceState {
  children: Child[];
}

const initialState: ChildrenSliceState = { children: [] };

const childrenSlice = createSlice({
  name: 'children',
  initialState,
  reducers: {
    /** page 0 replaces the whole list (a fresh ReferralsScreen mount); any later page appends, deduped by id in case of an overlapping re-fetch. */
    childrenPageReceived(state, action: PayloadAction<{ page: number; rows: Child[] }>) {
      if (action.payload.page === 0) {
        state.children = action.payload.rows;
        return;
      }
      const existingIds = new Set(state.children.map((child) => child.id));
      state.children.push(...action.payload.rows.filter((row) => !existingIds.has(row.id)));
    },
  },
});

export const { childrenPageReceived } = childrenSlice.actions;
export default childrenSlice.reducer;
