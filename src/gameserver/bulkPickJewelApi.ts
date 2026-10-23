import { gameserverClient } from './client';
import type { PickedJewel } from '../types/game';

interface BulkPickJewelResponse {
  error: boolean;
  message?: string;
}

/** Wraps POST /bulkPickJewelVerified. Returns whether the sync succeeded. */
export async function bulkPickJewel(jewelarray: PickedJewel[]): Promise<boolean> {
  const { data } = await gameserverClient.post<BulkPickJewelResponse>('/bulkPickJewelVerified', {
    jewelarray,
  });
  return !data.error;
}
