import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { GameTask } from '@app-types/game';

interface TasksSliceState {
  tasks: GameTask[] | null;
  lastFetchedAt: number | null;
}

const initialState: TasksSliceState = { tasks: null, lastFetchedAt: null };

const tasksSlice = createSlice({
  name: 'tasks',
  initialState,
  reducers: {
    tasksReceived(state, action: PayloadAction<GameTask[]>) {
      state.tasks = action.payload;
      state.lastFetchedAt = Date.now();
    },
  },
});

export const { tasksReceived } = tasksSlice.actions;
export default tasksSlice.reducer;
