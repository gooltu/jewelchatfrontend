import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { GiftTask, GiftTaskElement } from '@app-types/game';

/** The server's fixed /getGiftTasks page size — a shorter page means there are no more. */
const PAGE_SIZE = 10;

/**
 * The Game tab's gift-task catalog (paginated /getGiftTasks) plus a cache of
 * each gift task's jewel requirements (/getGiftTasksElements), keyed by
 * gifttask id — see gameService.refreshGiftTasks/loadMoreGiftTasks and
 * useGiftTaskElements.ts.
 */
interface GiftTasksSliceState {
  giftTasks: GiftTask[] | null;
  /** The next page loadMoreGiftTasks will request. */
  nextPage: number;
  hasMore: boolean;
  loadingPage: boolean;
  elementsByGiftTaskId: Record<number, GiftTaskElement[]>;
}

const initialState: GiftTasksSliceState = {
  giftTasks: null,
  nextPage: 0,
  hasMore: true,
  loadingPage: false,
  elementsByGiftTaskId: {},
};

const giftTasksSlice = createSlice({
  name: 'giftTasks',
  initialState,
  reducers: {
    giftTasksPageLoading(state) {
      state.loadingPage = true;
    },
    giftTasksPageFailed(state) {
      state.loadingPage = false;
    },
    /** Page 0 replaces the list (a refresh); any later page appends. */
    giftTasksPageReceived(state, action: PayloadAction<{ page: number; tasks: GiftTask[] }>) {
      const { page, tasks } = action.payload;
      state.giftTasks = page === 0 ? tasks : [...(state.giftTasks ?? []), ...tasks];
      state.nextPage = page + 1;
      state.hasMore = tasks.length === PAGE_SIZE;
      state.loadingPage = false;
    },
    giftTaskElementsReceived(
      state,
      action: PayloadAction<{ giftTaskId: number; elements: GiftTaskElement[] }>,
    ) {
      state.elementsByGiftTaskId[action.payload.giftTaskId] = action.payload.elements;
    },
  },
});

export const {
  giftTasksPageLoading,
  giftTasksPageFailed,
  giftTasksPageReceived,
  giftTaskElementsReceived,
} = giftTasksSlice.actions;
export default giftTasksSlice.reducer;
