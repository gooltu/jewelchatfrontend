import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { FactoryDefinition, FactoryMaterial } from '@app-types/game';

/**
 * The /getFactories catalog (factory definitions + material costs) is
 * static reference data, not per-user state — persisted (see
 * store/index.ts's whitelist) so authService.refreshFactories only ever
 * fetches it once (skipped whenever `factories` is already non-null),
 * unlike the always-refetched `userFactory` slice.
 */
interface FactorySliceState {
  factories: FactoryDefinition[] | null;
  materials: FactoryMaterial[] | null;
}

const initialState: FactorySliceState = { factories: null, materials: null };

const factorySlice = createSlice({
  name: 'factory',
  initialState,
  reducers: {
    factoriesReceived(
      state,
      action: PayloadAction<{ factories: FactoryDefinition[]; materials: FactoryMaterial[] }>,
    ) {
      state.factories = action.payload.factories;
      state.materials = action.payload.materials;
    },
  },
});

export const { factoriesReceived } = factorySlice.actions;
export default factorySlice.reducer;
