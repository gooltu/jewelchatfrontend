import { useEffect, useState } from 'react';
import type { ImageSourcePropType } from 'react-native';
import * as profilePicService from '@services/profilePicService';

interface Resolution {
  jid: string | null;
  refreshKey: number | undefined;
  source: ImageSourcePropType | undefined;
}

/**
 * Resolves a user's profile picture by jid, re-resolving whenever `jid`
 * changes. `undefined` means "no confirmed photo" (never uploaded, or load
 * failed) — every consumer already has a graceful initials/placeholder
 * fallback for that case, so there's no separate loading/error state here.
 *
 * `refreshKey` (optional) forces a re-resolve without the jid itself
 * changing — e.g. EditProfilePictureScreen bumping it after a successful
 * upload, so the just-uploaded photo appears without needing a jid change
 * to re-trigger the effect.
 *
 * Keyed by (jid, refreshKey) rather than resetting state synchronously in
 * the effect body (same pattern as useResolvedMediaUri.ts) — a stale
 * resolution from a since-changed jid/refreshKey is simply never returned,
 * with no cascading-render setState call.
 */
export function useAvatarSource(jid: string | null, refreshKey?: number): ImageSourcePropType | undefined {
  const [resolution, setResolution] = useState<Resolution>({
    jid: null,
    refreshKey: undefined,
    source: undefined,
  });

  useEffect(() => {
    if (!jid) return;
    let cancelled = false;
    void profilePicService.getProfilePicSource(jid).then((source) => {
      if (!cancelled) setResolution({ jid, refreshKey, source });
    });
    return () => {
      cancelled = true;
    };
  }, [jid, refreshKey]);

  if (!jid || resolution.jid !== jid || resolution.refreshKey !== refreshKey) return undefined;
  return resolution.source;
}
