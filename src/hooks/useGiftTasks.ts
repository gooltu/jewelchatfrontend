import { useAppSelector } from '@store/hooks';
import type { GiftTask } from '@app-types/game';

interface GiftTasksView {
  giftTasks: GiftTask[];
  hasMore: boolean;
  loading: boolean;
}

/** The Game tab's gift-task catalog (state.giftTasks), fetched via gameService.refreshGiftTasks/loadMoreGiftTasks. */
export function useGiftTasks(): GiftTasksView {
  const giftTasks = useAppSelector((state) => state.giftTasks.giftTasks);
  const hasMore = useAppSelector((state) => state.giftTasks.hasMore);
  const loading = useAppSelector((state) => state.giftTasks.loadingPage);
  return { giftTasks: giftTasks ?? EMPTY, hasMore, loading };
}

const EMPTY: GiftTask[] = [];
