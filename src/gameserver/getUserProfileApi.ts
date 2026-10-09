import { gameserverClient } from './client';

export interface UserProfileInfo {
  phone: number;
  name: string;
  level: number;
  status: string;
}

export interface UserProfileJewel {
  jeweltype_id: number;
  count: number;
}

interface GetUserProfileResponse {
  error: boolean;
  // Confirmed via live response: the gameserver wraps this in a
  // single-element array, not a bare object.
  user: UserProfileInfo[];
  jewels: UserProfileJewel[];
}

/** Real gameserver endpoint: POST /getUserProfile { user_id }. Returns null on an error response. */
export async function getUserProfile(
  userId: number,
): Promise<{ user: UserProfileInfo; jewels: UserProfileJewel[] } | null> {
  const { data } = await gameserverClient.post<GetUserProfileResponse>('/getUserProfile', {
    user_id: userId,
  });
  const user = data.user?.[0];
  if (data.error || !user) return null;
  return { user, jewels: data.jewels };
}
