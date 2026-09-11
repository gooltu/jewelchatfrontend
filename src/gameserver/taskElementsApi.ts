import { gameserverClient } from './client';
import type { TaskElement } from '../types/game';

interface GetTaskElementsResponse {
  error: boolean;
  taskdetails: TaskElement[];
}

/** Wraps POST /getTaskElements. Returns null on an error response. */
export async function getTaskElements(taskId: number): Promise<TaskElement[] | null> {
  const { data } = await gameserverClient.post<GetTaskElementsResponse>('/getTaskElements', {
    task_id: taskId,
  });
  if (data.error) return null;
  return data.taskdetails;
}
