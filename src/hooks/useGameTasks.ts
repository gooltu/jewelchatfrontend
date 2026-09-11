import { useAppSelector } from '@store/hooks';
import type { GameTask } from '@app-types/game';

/** The Game tab's real task list (state.tasks.tasks), fetched via authService.refreshTasks. */
export function useGameTasks(): GameTask[] {
  return useAppSelector((state) => state.tasks.tasks) ?? [];
}
