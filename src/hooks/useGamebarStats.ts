import { useAppSelector } from '@store/hooks';

/** Shape of the shared Header's `gamebar` prop. */
export interface GamebarStats {
  level: number;
  xpCurrent: number;
  xpMax: number;
}

/** Placeholder shown before game.scores has ever been fetched/rehydrated. */
const FALLBACK: GamebarStats = { level: 1, xpCurrent: 0, xpMax: 300 };

/**
 * Derives the header gamebar's level/xpCurrent/xpMax from the live
 * game.scores slice (points -> xpCurrent, max_level_points -> xpMax —
 * see types/game.ts's GameScores), falling back to a placeholder until the
 * first fetch (login/foreground, authService.refreshGameState) or
 * redux-persist rehydration resolves.
 */
export function useGamebarStats(): GamebarStats {
  const scores = useAppSelector((state) => state.game.scores);
  if (!scores) return FALLBACK;
  return {
    level: scores.level,
    xpCurrent: scores.points,
    xpMax: scores.max_level_points,
  };
}
