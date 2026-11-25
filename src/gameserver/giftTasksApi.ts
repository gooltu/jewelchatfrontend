import { gameserverClient } from './client';
import type { GiftTask } from '../types/game';

interface GetGiftTasksResponse {
  error: boolean;
  gifttasks: GiftTask[];
}

/** Wraps POST /getGiftTasks (enabled gift tasks, priority order, 0-indexed pages). Returns null on an error response. */
export async function getGiftTasks(page: number): Promise<GiftTask[] | null> {
  const { data } = await gameserverClient.post<GetGiftTasksResponse>('/getGiftTasks', { page });
  if (data.error) return null;
  return data.gifttasks;
}
