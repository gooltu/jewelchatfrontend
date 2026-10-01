import { gameserverClient } from './client';
import type { Child } from '../types/game';

interface GetChildrenResponse {
  error: boolean;
  children: Child[];
}

/** Wraps POST /getChildren — one 100-row page of the signed-in user's referrals. Returns null on an error response. */
export async function getChildren(page: number): Promise<Child[] | null> {
  const { data } = await gameserverClient.post<GetChildrenResponse>('/getChildren', { page });
  if (data.error) return null;
  return data.children;
}
