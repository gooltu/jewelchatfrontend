import { gameserverClient } from './client';
import type { GiftTaskUser } from '../types/game';

interface CheckGiftTaskCompletionResponse {
  error: boolean;
  gifttaskusers: GiftTaskUser | null;
}

/** Wraps POST /checkGiftTaskCompletion. Returns null on an error response or if the record doesn't exist. */
export async function checkGiftTaskCompletion(
  id: number,
  giftTaskId: number,
): Promise<GiftTaskUser | null> {
  const { data } = await gameserverClient.post<CheckGiftTaskCompletionResponse>(
    '/checkGiftTaskCompletion',
    {
      id,
      gifttask_id: giftTaskId,
    },
  );
  if (data.error) return null;
  return data.gifttaskusers;
}
