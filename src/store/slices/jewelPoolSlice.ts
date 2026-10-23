import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

/**
 * Local pool of server-issued jewels (from GET /getJewels) waiting to be attached to
 * an incoming message — see jewelPoolService.takeJewel(). `code` is shared by every
 * jeweltype_id in `pool`, since a /getJewels batch carries one verification code for
 * the whole batch (sent back per-jewel on collection, see PickedJewel). Persisted
 * (see store/index.ts's persistConfig comment) so unredeemed inventory isn't wasted
 * on relaunch and — more importantly — so `lastFetchedAt`'s 15-minute minimum gap
 * between /getJewels calls (see jewelPoolService.ts) is honored even across a kill.
 */
interface JewelPoolState {
  pool: number[];
  code: string | null;
  /** Epoch ms of the last GET /getJewels call attempt (success or failure). */
  lastFetchedAt: number | null;
}

const initialState: JewelPoolState = {
  pool: [],
  code: null,
  lastFetchedAt: null,
};

const jewelPoolSlice = createSlice({
  name: 'jewelPool',
  initialState,
  reducers: {
    jewelBatchReceived(state, action: PayloadAction<{ jewels: number[]; code: string }>) {
      state.pool = action.payload.jewels;
      state.code = action.payload.code;
    },
    jewelTaken(state) {
      state.pool.shift();
    },
    /**
     * Records the moment a /getJewels call was made — dispatched synchronously
     * before the request resolves, so it doubles as both the concurrent-call dedup
     * guard and the persisted 15-minute rate-limit gate (see jewelPoolService.ts).
     */
    jewelFetchAttempted(state) {
      state.lastFetchedAt = Date.now();
    },
  },
});

export const { jewelBatchReceived, jewelTaken, jewelFetchAttempted } = jewelPoolSlice.actions;
export default jewelPoolSlice.reducer;
