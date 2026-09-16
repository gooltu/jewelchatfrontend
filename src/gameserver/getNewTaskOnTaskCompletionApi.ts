import { gameserverClient } from './client';

interface GetNewTaskOnTaskCompletionResponse {
  error: boolean;
}

/**
 * Wraps GET /getNewTaskOnTaskCompletion — a side-effect-only call (no
 * payload beyond `error`) telling the backend to generate the next task
 * after a redeem. The actual new task list comes from a separate
 * authService.refreshTasks() call once the celebration is dismissed.
 */
export async function getNewTaskOnTaskCompletion(): Promise<boolean> {
  const { data } = await gameserverClient.get<GetNewTaskOnTaskCompletionResponse>(
    '/getNewTaskOnTaskCompletion',
  );
  return !data.error;
}
