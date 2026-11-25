import { checkGiftTaskCompletion as checkGiftTaskCompletionApi } from '../gameserver/checkGiftTaskCompletionApi';
import { getGiftTaskElements } from '../gameserver/giftTaskElementsApi';
import { getGiftTaskLevel as getGiftTaskLevelApi } from '../gameserver/giftTaskLevelApi';
import { getGiftTasks } from '../gameserver/giftTasksApi';
import { redeemGiftTask as redeemGiftTaskApi, type RedeemGiftTaskResult } from '../gameserver/redeemGiftTaskApi';
import { store } from '../store';
import {
  giftTaskElementsReceived,
  giftTasksPageFailed,
  giftTasksPageLoading,
  giftTasksPageReceived,
} from '../store/slices/giftTasksSlice';
import type { GiftTaskUser, ProfileSummary } from '@app-types/game';

/**
 * Mediates the Game/Profile tabs' access to game data that isn't owned by
 * authService. Gift tasks are real (`gameserver/giftTasksApi.ts` and
 * siblings, cached in `store/slices/giftTasksSlice.ts`); the profile
 * summary is still static mock data. Task data, wallet counts
 * (jewels/diamonds/coins), and the achievement checklist are all real too
 * (see `gameserver/tasksApi.ts`/`taskElementsApi.ts`, `useGameTasks.ts`/
 * `useTaskElements.ts`, `useWalletCounts.ts`, `useAchievementChecklist.ts`).
 */

async function fetchGiftTasksPage(page: number): Promise<void> {
  store.dispatch(giftTasksPageLoading());
  try {
    const tasks = await getGiftTasks(page);
    if (tasks) {
      store.dispatch(giftTasksPageReceived({ page, tasks }));
    } else {
      if (__DEV__) console.log(`[gameService] getGiftTasks(${page}) returned error:true`);
      store.dispatch(giftTasksPageFailed());
    }
  } catch (err) {
    if (__DEV__) console.log(`[gameService] getGiftTasks(${page}) failed`, err);
    store.dispatch(giftTasksPageFailed());
  }
}

/**
 * Best-effort: re-fetches the first page of gift tasks, replacing whatever
 * is loaded. No-ops if not signed in; swallows failures — same
 * fire-and-forget treatment as authService.refreshTasks.
 */
export async function refreshGiftTasks(): Promise<void> {
  if (store.getState().auth.status !== 'signedIn') return;
  await fetchGiftTasksPage(0);
}

/** Best-effort: appends the next page of gift tasks. Skipped if the last page was short or a page is already in flight. */
export async function loadMoreGiftTasks(): Promise<void> {
  const { auth, giftTasks } = store.getState();
  if (auth.status !== 'signedIn' || !giftTasks.hasMore || giftTasks.loadingPage) return;
  await fetchGiftTasksPage(giftTasks.nextPage);
}

/** Fetches a gift task's jewel requirements into the giftTasks cache. Throws on network failure (see useGiftTaskElements.ts). */
export async function fetchGiftTaskElements(giftTaskId: number): Promise<void> {
  const elements = await getGiftTaskElements(giftTaskId);
  if (elements) store.dispatch(giftTaskElementsReceived({ giftTaskId, elements }));
}

/** The user's target-level record for this gift task in the current weekly cycle (created server-side on first call). */
export function getGiftTaskLevel(giftTaskId: number): Promise<GiftTaskUser | null> {
  return getGiftTaskLevelApi(giftTaskId);
}

/** `id` is the GiftTaskUser record's id, `giftTaskId` the GiftTask's. */
export function redeemGiftTask(id: number, giftTaskId: number): Promise<RedeemGiftTaskResult> {
  return redeemGiftTaskApi(id, giftTaskId);
}

export function checkGiftTaskCompletion(id: number, giftTaskId: number): Promise<GiftTaskUser | null> {
  return checkGiftTaskCompletionApi(id, giftTaskId);
}

export function getProfileSummary(): ProfileSummary {
  return { username: 'disha' };
}
