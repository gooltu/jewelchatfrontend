import { useCallback, useEffect, useRef, useState } from 'react';
import { getChildren } from '@gameserver/childrenApi';
import { useAppDispatch, useAppSelector } from '@store/hooks';
import { childrenPageReceived } from '@store/slices/childrenSlice';
import type { Child } from '@app-types/game';

const PAGE_SIZE = 100;

interface UseReferralsResult {
  referrals: Child[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  loadMore: () => Promise<void>;
}

/**
 * Paginated (100/page) fetch of the signed-in user's referrals —
 * POST /getChildren, page 0 first, next page only once the prior one came
 * back full (100 rows) and the user scrolls to the end. Accumulates into
 * the shared `children` Redux slice (also read by
 * useAchievementChecklist.ts for achievements 18-32's current_value), so
 * pages loaded here benefit that computation too. Resets to page 0 on
 * every mount.
 */
export function useReferrals(): UseReferralsResult {
  const dispatch = useAppDispatch();
  const referrals = useAppSelector((state) => state.children.children);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const pageRef = useRef(0);

  const loadPage = useCallback(
    async (page: number) => {
      const rows = await getChildren(page);
      if (rows) {
        dispatch(childrenPageReceived({ page, rows }));
        pageRef.current = page;
        setHasMore(rows.length === PAGE_SIZE);
      } else {
        setHasMore(false);
      }
    },
    [dispatch],
  );

  useEffect(() => {
    // Initial page load — an external-system fetch, not derivable from
    // props/state during render (matches useMessages.ts's loadFirstPage).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadPage(0).finally(() => setLoading(false));
  }, [loadPage]);

  const loadMore = useCallback(async () => {
    if (loading || loadingMore || !hasMore) return;
    setLoadingMore(true);
    await loadPage(pageRef.current + 1);
    setLoadingMore(false);
  }, [loadPage, loading, loadingMore, hasMore]);

  return { referrals, loading, loadingMore, hasMore, loadMore };
}
