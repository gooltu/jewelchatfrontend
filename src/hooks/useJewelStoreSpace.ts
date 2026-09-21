import { useAppSelector } from '@store/hooks';
import { MAX_JEWEL_CAPACITY, sumPickableJewels } from '@app-types/game';

/** Whether the jewel store has room for `count` more pickable jewels (owned + queued-to-sync) — same accounting as useCanPickJewel, generalized to more than one at a time (e.g. a factory's output). */
export function useJewelStoreSpaceFor(count: number): boolean {
  return useAppSelector((state) => {
    const totalOwned = sumPickableJewels(state.game.jewels);
    return totalOwned + (state.game.pickedJewels ?? []).length + count <= MAX_JEWEL_CAPACITY;
  });
}
