import { useCallback, useEffect, useState } from 'react';
import { isAxiosError } from 'axios';
import * as gameService from '@services/gameService';
import type { GiftTaskUser } from '@app-types/game';

/**
 * The user's per-cycle target-level record for one gift task. Deliberately
 * not cached in Redux: it's scoped to the current weekly cycle and its
 * `done` flag flips on redeem, so it's fetched fresh on every mount.
 * `record` is undefined while loading, null if the fetch failed.
 */
export function useGiftTaskLevel(giftTaskId: number | null): {
  record: GiftTaskUser | null | undefined;
  setRecord: (record: GiftTaskUser) => void;
} {
  const [record, setRecordState] = useState<GiftTaskUser | null | undefined>(undefined);

  useEffect(() => {
    if (giftTaskId === null) return;
    let cancelled = false;
    gameService
      .getGiftTaskLevel(giftTaskId)
      .then((result) => {
        if (!cancelled) setRecordState(result);
      })
      .catch((err) => {
        if (__DEV__) {
          console.log(
            `[useGiftTaskLevel] getGiftTaskLevel(${giftTaskId}) failed`,
            isAxiosError(err) ? (err.response?.data ?? err.message) : err,
          );
        }
        if (!cancelled) setRecordState(null);
      });
    return () => {
      cancelled = true;
    };
  }, [giftTaskId]);

  const setRecord = useCallback((next: GiftTaskUser) => setRecordState(next), []);
  return { record, setRecord };
}
