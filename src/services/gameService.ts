import { Headphones, Watch } from 'lucide-react-native';
import type { GiftTask, ProfileSummary } from '@app-types/game';

/**
 * Mediates the Game/Profile tabs' access to game data. The real gameserver
 * (`src/gameserver/`) has no gift-catalog/profile endpoints yet, so this
 * returns static mock data shaped like the eventual API responses —
 * callers don't need to change when real endpoints land, only these
 * function bodies do. Task data, wallet counts (jewels/diamonds/coins),
 * and the achievement checklist are all real now (see
 * `gameserver/tasksApi.ts`/`taskElementsApi.ts`, `useGameTasks.ts`/
 * `useTaskElements.ts`, `useWalletCounts.ts`, `useAchievementChecklist.ts`)
 * — not mocked here anymore.
 */

export function getGiftTasks(): GiftTask[] {
  return [
    { id: 'gt-1', kind: 'product', title: 'Sony Wireless Headphones', icon: Headphones, qtyWon: 2, qtyTotal: 2 },
    { id: 'gt-2', kind: 'product', title: 'Mi Smart Band 5', icon: Watch, qtyWon: 2, qtyTotal: 2 },
    { id: 'gt-3', kind: 'cash', amountRupees: 29, qtyWon: 8, qtyTotal: 10 },
    { id: 'gt-4', kind: 'cash', amountRupees: 31, qtyWon: 10, qtyTotal: 10 },
  ];
}

export function getProfileSummary(): ProfileSummary {
  return { username: 'disha' };
}
