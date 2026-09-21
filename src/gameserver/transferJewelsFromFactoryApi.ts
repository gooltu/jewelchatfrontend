import { gameserverClient } from './client';

interface TransferJewelsFromFactoryResponse {
  error: boolean;
}

/** Wraps POST /transferJewelsFromFactory. Returns whether the transfer succeeded. */
export async function transferJewelsFromFactory(factoryId: number): Promise<boolean> {
  const { data } = await gameserverClient.post<TransferJewelsFromFactoryResponse>(
    '/transferJewelsFromFactory',
    { factory_id: factoryId },
  );
  return !data.error;
}
