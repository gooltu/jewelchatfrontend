import { useAppSelector } from '@store/hooks';
import { MAX_JEWEL_CAPACITY, sumPickableJewels } from '@app-types/game';

/** Whether the user's total jewel count (owned + queued-to-sync) has room for one more pick. */
export function useCanPickJewel(): boolean {
  return useAppSelector((state) => {
    const totalOwned = sumPickableJewels(state.game.jewels);
    return totalOwned + (state.game.pickedJewels ?? []).length < MAX_JEWEL_CAPACITY;
  });
}
