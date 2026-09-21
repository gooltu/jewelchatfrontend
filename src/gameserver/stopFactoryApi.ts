import { gameserverClient } from './client';

interface StopFactoryResponse {
  error: boolean;
}

/** Wraps POST /stopFactory. Returns whether it stopped. */
export async function stopFactory(factoryId: number): Promise<boolean> {
  const { data } = await gameserverClient.post<StopFactoryResponse>('/stopFactory', {
    factory_id: factoryId,
  });
  return !data.error;
}
