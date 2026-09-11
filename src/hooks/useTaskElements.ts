import { useEffect } from 'react';
import { isAxiosError } from 'axios';
import { getTaskElements } from '@gameserver/taskElementsApi';
import { useAppDispatch, useAppSelector } from '@store/hooks';
import { taskElementsReceived } from '@store/slices/taskElementsSlice';
import type { TaskElement } from '@app-types/game';

/**
 * Fetches a task's jewel requirements once per task_id and caches them in
 * Redux (taskElementsSlice) — re-entering the same task within this session
 * reads the cache instead of re-fetching. Returns null while unresolved.
 */
export function useTaskElements(taskId: number | null): TaskElement[] | null {
  const dispatch = useAppDispatch();
  const cached = useAppSelector((state) =>
    taskId !== null ? state.taskElements.byTaskId[taskId] : undefined,
  );

  useEffect(() => {
    if (taskId === null || cached) return;
    let cancelled = false;
    getTaskElements(taskId)
      .then((elements) => {
        if (!cancelled && elements) dispatch(taskElementsReceived({ taskId, elements }));
      })
      .catch((err) => {
        // Best-effort, matching authService's refreshGameState/refreshTasks —
        // a failed fetch just leaves this task_id uncached, retried next visit.
        if (__DEV__) {
          console.log(
            `[useTaskElements] getTaskElements(${taskId}) failed`,
            isAxiosError(err) ? (err.response?.data ?? err.message) : err,
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [taskId, cached, dispatch]);

  return cached ?? null;
}
