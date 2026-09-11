import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { GameScores, GameState, JewelEntry, PickedJewel } from '@app-types/game';

interface GameSliceState {
  scores: GameScores | null;
  jewels: JewelEntry[] | null;
  pickedJewels: PickedJewel[];
  lastFetchedAt: number | null;
}

const initialState: GameSliceState = {
  scores: null,
  jewels: null,
  pickedJewels: [],
  lastFetchedAt: null,
};

const gameSlice = createSlice({
  name: 'game',
  initialState,
  reducers: {
    gameStateReceived(state, action: PayloadAction<GameState>) {
      state.scores = action.payload.scores;
      state.jewels = action.payload.jewels;
      state.lastFetchedAt = Date.now();
    },
    jewelPicked(state, action: PayloadAction<PickedJewel>) {
      // Self-heal: a store persisted before pickedJewels existed rehydrates
      // without this key (redux-persist's whitelist merges at the root
      // reducer level, not inside each slice's own persisted blob).
      if (!state.pickedJewels) state.pickedJewels = [];
      state.pickedJewels.push(action.payload);
    },
    pickedJewelsCleared(state) {
      state.pickedJewels = [];
    },
  },
});

export const { gameStateReceived, jewelPicked, pickedJewelsCleared } = gameSlice.actions;
export default gameSlice.reducer;
