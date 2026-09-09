import { gameserverClient } from './client';

export interface GameServerTimeResponse {
  time: string; // UTC string via the backend's Date#toUTCString(), e.g. "Fri, 04 Sep 2026 12:34:56 GMT"
}

/** Returns the game server's current time as epoch milliseconds. */
export async function getGameServerTime(): Promise<number> {
  const { data } = await gameserverClient.get<GameServerTimeResponse>('/getGameServerTime');
  return new Date(data.time).getTime();
}
