import type { LucideIcon } from 'lucide-react-native';
import type { SVGIconName } from '@components/design-system';

/** Level/XP/currency summary shown in the shared Header's `gamebar` + action
 * icons on the Game and Profile tabs. */
export interface GameStats {
  level: number;
  xpCurrent: number;
  xpMax: number;
  coins: number;
  diamonds: number;
}

/** One "WIN CASH AND GIFTS" card on the Game tab — a product prize (no real
 * product photography yet, so a placeholder glyph stands in for the image)
 * or a cash prize (rupee amount instead). */
export type GiftTask =
  | { id: string; kind: 'product'; title: string; icon: LucideIcon; qtyWon: number; qtyTotal: number }
  | { id: string; kind: 'cash'; amountRupees: number; qtyWon: number; qtyTotal: number };

/** One row of the Profile tab's "WIN GAME DIAMONDS" checklist. `jewelIcon` is
 * omitted for the referral rows, which have no collectible-jewel art.
 * `reward` is either a diamond payout (claimable once `progress` reaches 1)
 * or, for rows gated behind a higher level than the user has reached yet, the
 * level required to unlock the row at all. */
export interface DiamondChecklistItem {
  id: string;
  jewelIcon?: SVGIconName;
  text: string;
  /** 0–1 fraction toward completing the row. */
  progress: number;
  reward: { kind: 'diamonds'; amount: number } | { kind: 'level'; required: number };
}

export interface ProfileSummary {
  username: string;
  avatarUri?: string;
}

/**
 * Real gameserver /getGameState response shape. `scores` has four
 * confirmed fields (level/points/max_level_points used to drive the header
 * gamebar — see useGamebarStats.ts; storesize is the jewelbox capacity
 * shown in the Jewel Store's progress bar — see JewelStoreSheet.tsx) plus
 * an index signature for whatever else the backend sends that isn't
 * modeled yet. `jewels` is a flat array with one row per jewel type
 * (`jeweltype_id` 0..17 — the design-system's j3..j17 icon set only covers
 * 3..17, see useJewelCounts.ts). Distinct from the mock UI types above
 * (Game tab placeholder data).
 */
export interface GameScores {
  level: number;
  points: number;
  max_level_points: number;
  storesize: number;
  [key: string]: unknown;
}

export interface JewelEntry {
  id: number;
  user_id: number;
  jeweltype_id: number;
  count: number;
  total_count: number;
  updated_at: string;
}

/**
 * The 15 "collectible jewel" types shown in the Jewel Store grid (j3..j17
 * icons) and picked from chat bubbles. game.jewels also carries entries for
 * jeweltype_id 0/1/2 (diamonds/coins/etc — the Profile tab's wallet, see
 * useWalletCounts.ts) which are a different currency and must never be
 * folded into a jewel-box capacity count.
 */
export const PICKABLE_JEWEL_TYPES = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17] as const;

/** Sum of only the pickable jewel types' counts — see PICKABLE_JEWEL_TYPES. */
export function sumPickableJewels(jewels: JewelEntry[] | null | undefined): number {
  const pickableTypes: readonly number[] = PICKABLE_JEWEL_TYPES;
  return (jewels ?? [])
    .filter((jewel) => pickableTypes.includes(jewel.jeweltype_id))
    .reduce((sum, jewel) => sum + jewel.count, 0);
}

export interface GameState {
  scores: GameScores;
  jewels: JewelEntry[];
}

/** Real gameserver /getTasks response row — backs the Game tab's horizontal task cards. */
export interface GameTask {
  id: number;
  task_id: number;
  is_bomb: number;
  coins: number;
  points: number;
  done: number;
  created_at: string;
  completed_at: string | null;
}

/** Real gameserver /getTaskElements response row — one jewel requirement for a task (keyed by GameTask.task_id, not GameTask.id). */
export interface TaskElement {
  id: number;
  task_id: number;
  jeweltype_id: number;
  count: number;
}

/** One entry in game.pickedJewels — queued locally until POST /bulkPickJewel flushes it. */
export interface PickedJewel {
  type: number;
}

/** A user's total jewel count (sum of game.jewels + queued game.pickedJewels) may never reach this. */
export const MAX_JEWEL_CAPACITY = 25;

/** Real gameserver /getFactories response row — a factory's static definition (catalog data, not per-user state). */
export interface FactoryDefinition {
  factory_id: number;
  jeweltype_id: number;
  count: number;
  level: number;
  /** Diamonds required to stop a running factory early (FactoryScreen's Stop button label). */
  diamond: number;
  /** Seconds. */
  duration: number;
}

/** Real gameserver /getFactories response row — one jewel material a factory consumes, keyed by factory_id. */
export interface FactoryMaterial {
  id: number;
  factory_id: number;
  jeweltype_id: number;
  count: number;
}

/**
 * A user's per-factory run state, keyed by factory_id — normalized for
 * Redux, NOT the raw /getUserFactory wire shape (see getUserFactoryApi.ts,
 * which parses each row's UTC "YYYY-MM-DD HH:mm:ss" start_time string into
 * this epoch-ms number so FactoryScreen's countdown can treat every
 * source of start_time — the initial fetch and a fresh POST /startFactory
 * response — identically).
 */
export interface UserFactory {
  id: number;
  factory_id: number;
  user_id: number;
  is_on: number;
  /** Epoch milliseconds. */
  start_time: number;
}
