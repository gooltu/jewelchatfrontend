import { gameserverClient } from './client';
import type { FactoryDefinition, FactoryMaterial } from '../types/game';

interface GetFactoriesResponse {
  error: boolean;
  factory: FactoryDefinition[];
  materials: FactoryMaterial[];
}

/** Wraps GET /getFactories — the static factory catalog (definitions + material costs), not per-user state. Returns null on an error response. */
export async function getFactories(): Promise<{ factories: FactoryDefinition[]; materials: FactoryMaterial[] } | null> {
  const { data } = await gameserverClient.get<GetFactoriesResponse>('/getFactories');
  if (data.error) return null;
  return { factories: data.factory, materials: data.materials };
}
