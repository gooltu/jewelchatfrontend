import { gameserverClient } from './client';
import { parseFlexibleServerTimestamp } from '../services/timeSyncService';
import type { UserFactory } from '../types/game';

/** Raw wire row — start_time comes back as a UTC string (observed in a couple of different shapes — see parseFlexibleServerTimestamp), unlike UserFactory's normalized epoch-ms. */
interface UserFactoryWire {
  id: number;
  factory_id: number;
  user_id: number;
  is_on: number;
  start_time: string;
}

interface GetUserFactoryResponse {
  error: boolean;
  factoryuser: UserFactoryWire[];
}

/** Wraps POST /getUserFactory — the signed-in user's per-factory run state (is_on/start_time). Returns null on an error response. */
export async function getUserFactory(): Promise<UserFactory[] | null> {
  const { data } = await gameserverClient.post<GetUserFactoryResponse>('/getUserFactory');
  if (data.error) return null;
  // A factory that's never been started (is_on: 0) may have no meaningful
  // start_time at all (null/empty on the wire) — guard here rather than
  // passing that through to parseFlexibleServerTimestamp, which expects a
  // string.
  return data.factoryuser.map((row) => ({
    ...row,
    start_time: row.start_time ? parseFlexibleServerTimestamp(row.start_time) : 0,
  }));
}
