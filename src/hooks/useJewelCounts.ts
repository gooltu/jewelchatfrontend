import { useAppSelector } from '@store/hooks';
import type { SVGIconName } from '@components/design-system';
import { PICKABLE_JEWEL_TYPES } from '@app-types/game';

export interface JewelCount {
  type: number;
  icon: SVGIconName;
  count: number;
}

/** The 15 game jewel types (game.jewels' jeweltype_id 3..17) as a fixed-order list for the Jewel Store grid. */
export function useJewelCounts(): JewelCount[] {
  const jewels = useAppSelector((state) => state.game.jewels);
  const countByType = new Map(jewels?.map((jewel) => [jewel.jeweltype_id, jewel.count]));
  return PICKABLE_JEWEL_TYPES.map((type) => ({
    type,
    icon: `j${type}` as SVGIconName,
    count: countByType.get(type) ?? 0,
  }));
}
