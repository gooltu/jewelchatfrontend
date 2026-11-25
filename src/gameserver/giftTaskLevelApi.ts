import { gameserverClient } from './client';
import type { GiftTaskUser } from '../types/game';

interface GetGiftTaskLevelResponse {
  error: boolean;
  gifttaskusers: GiftTaskUser[];
}

/**
 * Wraps POST /getGiftTaskLevel — get-or-create: the server inserts this
 * user's record for the current weekly cycle on first call. Returns null on
 * an error response.
 */
export async function getGiftTaskLevel(giftTaskId: number): Promise<GiftTaskUser | null> {
  const { data } = await gameserverClient.post<GetGiftTaskLevelResponse>('/getGiftTaskLevel', {
    gifttask_id: giftTaskId,
  });
  if (data.error) return null;
  return data.gifttaskusers[0] ?? null;
}
