import { useAppSelector } from '@store/hooks';
import type { SVGIconName } from '@components/design-system';
import { resolveJewelIcon, type Child, type DiamondChecklistItem, type JewelEntry } from '@app-types/game';

/** Matches the `<img src='tN' />` token some achievement texts embed to reference a jewel type inline (e.g. "Collect <x> <img src='t3' />"). */
const JEWEL_IMG_TAG_PATTERN = /<img\s+src=['"]t(\d+)['"]\s*\/>/i;

/** Strips a `<img src='tN' />` token out of achievement text (the UI renders the jewel as a real icon via DiamondChecklistItem.jewelIcon instead, same slot ChecklistRow already had for this). */
function extractJewelIcon(text: string): { text: string; jewelIcon: SVGIconName | null } {
  const match = text.match(JEWEL_IMG_TAG_PATTERN);
  if (!match) return { text, jewelIcon: null };
  return {
    text: text.replace(JEWEL_IMG_TAG_PATTERN, '').replace(/\s+/g, ' ').trim(),
    jewelIcon: resolveJewelIcon(Number(match[1])),
  };
}

/** achievement_id -> the child level a referral must reach to count toward that achievement's current_value. Corrected: this range is 18-32, not 3-17. */
const CHILD_LEVEL_THRESHOLD_BY_ACHIEVEMENT_ID: Record<number, number> = {
  18: 5,
  19: 10,
  20: 15,
  21: 20,
  22: 25,
  23: 30,
  24: 40,
  25: 50,
  26: 60,
  27: 70,
  28: 80,
  29: 90,
  30: 100,
  31: 110,
  32: 120,
};

/**
 * Derives each achievement row's `current`/`max` progress values.
 * `level` (from UserAchievement, 0 if the user hasn't started it) is NOT a
 * 0-1 fraction — how it becomes the denominator, and where the numerator
 * comes from, differs by achievement_id per the product spec:
 *
 *  - id 1, 2, 18-32: `level` itself IS the target/max.
 *      - id 2's current_value is game.jewels[jeweltype_id===2].count
 *        (available now).
 *      - id 1's current_value is invitees.length (state.invitees —
 *        currently always empty until a real invite flow populates it).
 *      - id 18-32's current_value is a count of `children` (referrals)
 *        whose own level has reached CHILD_LEVEL_THRESHOLD_BY_ACHIEVEMENT_ID
 *        for that id — computable now via childrenSlice.ts, though it'll
 *        read as 0 until that array is actually populated by a real flow.
 *  - id 3-17: max = level * 10; current_value is
 *    game.jewels[jeweltype_id===id].total_count * 10 — id lines up
 *    1:1 with jeweltype_id (both range 3-17, see PICKABLE_JEWEL_TYPES).
 *
 * Anything not yet wired up renders as not-started (progress 0) rather
 * than guessing — fill in the real current_value source here once
 * specified/available.
 */
function computeCurrentAndMax(
  achievementId: number,
  level: number,
  jewels: JewelEntry[] | null | undefined,
  children: Child[],
  invitees: unknown[],
): { current: number; max: number } {
  if (level <= 0) return { current: 0, max: 0 };

  if (achievementId === 2) {
    return { current: jewels?.find((j) => j.jeweltype_id === 2)?.count ?? 0, max: level };
  }
  if (achievementId === 1) {
    return { current: invitees.length, max: level };
  }
  if (achievementId >= 18 && achievementId <= 32) {
    const threshold = CHILD_LEVEL_THRESHOLD_BY_ACHIEVEMENT_ID[achievementId];
    const current = children.filter((child) => child.level >= threshold).length;
    return { current, max: level };
  }
  if (achievementId >= 3 && achievementId <= 17) {
    const totalCount = jewels?.find((j) => j.jeweltype_id === achievementId)?.total_count ?? 0;
    return { current: totalCount * 10, max: level * 10 };
  }
  return { current: 0, max: 0 };
}

/**
 * Maps the real /getAchievements + /getUsersAchievement data into the
 * Profile tab's existing checklist row shape (DiamondChecklistItem) — see
 * computeCurrentAndMax for the progress derivation.
 *
 * userAchievements is the primary/driving list, not achievements: an
 * achievement_id the user hasn't started (no row in /getUsersAchievement)
 * has no row here either, so it isn't rendered at all — only achievements
 * the user actually has progress on show up.
 */
export function useAchievementChecklist(): DiamondChecklistItem[] {
  const achievements = useAppSelector((state) => state.achievements.achievements);
  const userAchievements = useAppSelector((state) => state.userAchievements.userAchievements);
  const jewels = useAppSelector((state) => state.game.jewels);
  const children = useAppSelector((state) => state.children.children);
  const invitees = useAppSelector((state) => state.invitees.invitees);

  const items: DiamondChecklistItem[] = [];
  for (const userAchievement of userAchievements ?? []) {
    const achievement = achievements?.find((a) => a.achievement_id === userAchievement.achievement_id);
    if (!achievement) {
      // No catalog entry (text/diamond reward) for this achievement_id —
      // can't render a row without it.
      if (__DEV__) {
        console.log(
          '[useAchievementChecklist] no achievements catalog entry for achievement_id',
          userAchievement.achievement_id,
        );
      }
      continue;
    }
    const { current, max } = computeCurrentAndMax(
      userAchievement.achievement_id,
      userAchievement.level,
      jewels,
      children,
      invitees,
    );
    const progress = max > 0 ? Math.min(1, current / max) : 0;
    // Every achievement_id's `text` may contain a literal `<x>` token to
    // substitute with its target — `max` (== level for ids 1/2/18-32,
    // level*10 for ids 3-17 — see computeCurrentAndMax) — and/or a
    // `<img src='tN' />` token referencing a jewel type (see extractJewelIcon).
    const substituted = achievement.text.replace(/<x>/g, String(max));
    const { text, jewelIcon } = extractJewelIcon(substituted);
    items.push({
      id: String(achievement.achievement_id),
      jewelIcon: jewelIcon ?? undefined,
      text,
      progress,
      reward: { kind: 'diamonds', amount: achievement.diamond },
    });
  }
  return items;
}
