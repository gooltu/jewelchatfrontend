import { gameserverClient } from './client';
import type { GiftTaskElement } from '../types/game';

interface GetGiftTaskElementsResponse {
  error: boolean;
  gifttaskdetails: GiftTaskElement[];
}

/** Wraps POST /getGiftTasksElements. Returns null on an error response. */
export async function getGiftTaskElements(giftTaskId: number): Promise<GiftTaskElement[] | null> {
  const { data } = await gameserverClient.post<GetGiftTaskElementsResponse>(
    '/getGiftTasksElements',
    {
      gifttask_id: giftTaskId,
    },
  );
  if (data.error) return null;
  return data.gifttaskdetails;
}
