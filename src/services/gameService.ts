import { Headphones, Watch } from 'lucide-react-native';
import type {
  DiamondChecklistItem,
  GameStats,
  GiftTask,
  ProfileSummary,
} from '@app-types/game';

/**
 * Mediates the Game/Profile tabs' access to game data. The real gameserver
 * (`src/gameserver/`) has no reward/wallet endpoints yet, so this returns
 * static mock data shaped like the eventual API responses — callers
 * (`GameScreen`, `SettingsScreen`) don't need to change when real endpoints
 * land, only these function bodies do. Task data itself is real now (see
 * `gameserver/tasksApi.ts`/`taskElementsApi.ts`, `useGameTasks.ts`/
 * `useTaskElements.ts`) — not mocked here anymore.
 */

export function getGameStats(): GameStats {
  return { level: 2, xpCurrent: 34, xpMax: 289, coins: 120, diamonds: 3 };
}

export function getGiftTasks(): GiftTask[] {
  return [
    { id: 'gt-1', kind: 'product', title: 'Sony Wireless Headphones', icon: Headphones, qtyWon: 2, qtyTotal: 2 },
    { id: 'gt-2', kind: 'product', title: 'Mi Smart Band 5', icon: Watch, qtyWon: 2, qtyTotal: 2 },
    { id: 'gt-3', kind: 'cash', amountRupees: 29, qtyWon: 8, qtyTotal: 10 },
    { id: 'gt-4', kind: 'cash', amountRupees: 31, qtyWon: 10, qtyTotal: 10 },
  ];
}

export function getDiamondChecklist(): DiamondChecklistItem[] {
  return [
    { id: 'dc-1', text: 'Invite 5 users', progress: 0.2, reward: { kind: 'level', required: 7 } },
    { id: 'dc-2', text: 'Refer 2 users successfully', progress: 0, reward: { kind: 'diamonds', amount: 1 } },
    { id: 'dc-3', jewelIcon: 'j3', text: 'Collect 6', progress: 0.5, reward: { kind: 'diamonds', amount: 1 } },
    { id: 'dc-4', jewelIcon: 'j4', text: 'Collect 20', progress: 0.1, reward: { kind: 'diamonds', amount: 1 } },
  ];
}

export function getProfileSummary(): ProfileSummary {
  return { username: 'disha' };
}
