import { gameserverClient } from './client';

interface RedeemTaskResponse {
  error: boolean;
}

/** Wraps POST /redeemTask. Returns whether the redeem succeeded. */
export async function redeemTask(taskId: number, id: number): Promise<boolean> {
  const { data } = await gameserverClient.post<RedeemTaskResponse>('/redeemTask', {
    task_id: taskId,
    id,
  });
  return !data.error;
}
