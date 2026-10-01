import { gameserverClient } from './client';
import type { UserAchievement } from '../types/game';

interface GetUsersAchievementResponse {
  error: boolean;
  userachievements: UserAchievement[];
}

/** Wraps POST /getUsersAchievement — the signed-in user's per-achievement progress (level). Returns null on an error response. */
export async function getUsersAchievement(): Promise<UserAchievement[] | null> {
  const { data } = await gameserverClient.post<GetUsersAchievementResponse>('/getUsersAchievement', {});
  if (data.error) return null;
  return data.userachievements;
}
