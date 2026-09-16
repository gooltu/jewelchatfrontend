import { gameserverClient } from './client';

interface ExplodeBombResponse {
  error: boolean;
}

/** Wraps POST /explodeBomb. Returns whether the explosion was recorded server-side. */
export async function explodeBomb(taskId: number, id: number): Promise<boolean> {
  const { data } = await gameserverClient.post<ExplodeBombResponse>('/explodeBomb', {
    task_id: taskId,
    id,
  });
  return !data.error;
}
