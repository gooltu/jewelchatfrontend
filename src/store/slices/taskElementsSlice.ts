import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { TaskElement } from '@app-types/game';

/** Cache of /getTaskElements results keyed by task_id — see useTaskElements.ts. */
interface TaskElementsSliceState {
  byTaskId: Record<number, TaskElement[]>;
}

const initialState: TaskElementsSliceState = { byTaskId: {} };

const taskElementsSlice = createSlice({
  name: 'taskElements',
  initialState,
  reducers: {
    taskElementsReceived(state, action: PayloadAction<{ taskId: number; elements: TaskElement[] }>) {
      state.byTaskId[action.payload.taskId] = action.payload.elements;
    },
  },
});

export const { taskElementsReceived } = taskElementsSlice.actions;
export default taskElementsSlice.reducer;
