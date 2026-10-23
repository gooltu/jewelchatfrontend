import { gameserverClient } from './client';

interface GetJewelsResponse {
  error: boolean;
  jewels: number[];
  code: string;
}

/** Wraps GET /getJewels — a batch of server-issued jeweltype_ids plus the shared code that must accompany each of them when later collected via /bulkPickJewelVerified. Returns null on an error response. */
export async function getJewels(): Promise<{ jewels: number[]; code: string } | null> {
  const { data } = await gameserverClient.get<GetJewelsResponse>('/getJewels');
  if (data.error) return null;
  return { jewels: data.jewels, code: data.code };
}
