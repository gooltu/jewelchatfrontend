import { gameserverClient } from './client';
import type { Achievement } from '../types/game';

interface GetAchievementsResponse {
  error: boolean;
  achievements: Achievement[];
}

/** Wraps POST /getAchievements — the static achievement catalog (definitions + diamond rewards), not per-user progress. Returns null on an error response. */
export async function getAchievements(): Promise<Achievement[] | null> {
  const { data } = await gameserverClient.post<GetAchievementsResponse>('/getAchievements', {});
  if (data.error) return null;
  return data.achievements;
}
