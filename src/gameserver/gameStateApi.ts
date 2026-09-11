import { gameserverClient } from './client';
import type { GameState } from '../types/game';

interface GetGameStateResponse extends GameState {
  error: boolean;
}

/** Wraps GET /getGameState. Returns null on an error response. */
export async function getGameState(): Promise<GameState | null> {
  const { data } = await gameserverClient.get<GetGameStateResponse>('/getGameState');
  if (data.error) return null;
  return { scores: data.scores, jewels: data.jewels };
}
