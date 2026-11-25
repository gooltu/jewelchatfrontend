import { useEffect } from 'react';
import { isAxiosError } from 'axios';
import * as gameService from '@services/gameService';
import { useAppSelector } from '@store/hooks';
import type { GiftTaskElement } from '@app-types/game';

/**
 * Fetches a gift task's jewel requirements once per gifttask id and caches
 * them in Redux (giftTasksSlice) — mirrors useTaskElements.ts. Returns null
 * while unresolved.
 */
export function useGiftTaskElements(giftTaskId: number | null): GiftTaskElement[] | null {
  const cached = useAppSelector((state) =>
    giftTaskId !== null ? state.giftTasks.elementsByGiftTaskId[giftTaskId] : undefined,
  );

  useEffect(() => {
    if (giftTaskId === null || cached) return;
    gameService.fetchGiftTaskElements(giftTaskId).catch((err) => {
      // Best-effort — a failed fetch just leaves this id uncached, retried next visit.
      if (__DEV__) {
        console.log(
          `[useGiftTaskElements] fetchGiftTaskElements(${giftTaskId}) failed`,
          isAxiosError(err) ? (err.response?.data ?? err.message) : err,
        );
      }
    });
  }, [giftTaskId, cached]);

  return cached ?? null;
}
