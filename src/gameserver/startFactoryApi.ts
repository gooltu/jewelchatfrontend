import { gameserverClient } from './client';
import { parseFlexibleServerTimestamp } from '../services/timeSyncService';

interface StartFactoryResponse {
  error: boolean;
  /** See parseFlexibleServerTimestamp's doc comment for the shapes this has been observed in on the wire. */
  start_time: number | string;
}

/** Wraps POST /startFactory. Returns the factory's start time as epoch milliseconds on success, null on error or an unparseable start_time. */
export async function startFactory(factoryId: number): Promise<number | null> {
  const { data } = await gameserverClient.post<StartFactoryResponse>('/startFactory', {
    factory_id: factoryId,
  });
  if (data.error) return null;
  const startTimeMs =
    typeof data.start_time === 'number' ? data.start_time * 1000 : parseFlexibleServerTimestamp(data.start_time);
  if (!Number.isFinite(startTimeMs)) {
    if (__DEV__) console.log('[startFactory] unparseable start_time in response', data.start_time);
    return null;
  }
  return startTimeMs;
}
