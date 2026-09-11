import { gameserverClient } from './client';
import type { GameTask } from '../types/game';

interface GetTasksResponse {
  error: boolean;
  tasks: GameTask[];
}

/** Wraps POST /getTasks. Returns null on an error response. */
export async function getTasks(): Promise<GameTask[] | null> {
  const { data } = await gameserverClient.post<GetTasksResponse>('/getTasks');
  if (data.error) return null;
  return data.tasks;
}
