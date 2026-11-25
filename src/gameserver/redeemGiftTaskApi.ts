import { isAxiosError } from 'axios';
import { gameserverClient } from './client';

interface RedeemGiftTaskResponse {
  error: boolean;
  message?: string;
}

export type RedeemGiftTaskResult = { ok: true } | { ok: false; message: string | null };

/**
 * Wraps POST /redeemGiftTask. The server reports validation failures
 * ("Invalid Task", "Task Not Completed", "Gift not available.") as an HTTP
 * 500 with `{error: true, message}`, so that case is caught here and turned
 * into `{ ok: false, message }` rather than thrown. Network errors still throw.
 */
export async function redeemGiftTask(
  id: number,
  giftTaskId: number,
): Promise<RedeemGiftTaskResult> {
  try {
    const { data } = await gameserverClient.post<RedeemGiftTaskResponse>('/redeemGiftTask', {
      id,
      gifttask_id: giftTaskId,
    });
    return data.error ? { ok: false, message: data.message ?? null } : { ok: true };
  } catch (err) {
    const body = isAxiosError(err)
      ? (err.response?.data as RedeemGiftTaskResponse | undefined)
      : undefined;
    if (body?.error) return { ok: false, message: body.message ?? null };
    throw err;
  }
}
