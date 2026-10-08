import { useEffect, useState } from 'react';
import { resolveMediaUri } from '@media/mediaUploadService';

/**
 * Resolves a ChatMessage's MEDIA_CLOUD/MEDIA_CLOUD_THUMBNAIL value (a local
 * file:// placeholder while still uploading, or this app's own S3 key once
 * uploaded) to a locally-usable URI — IMAGE/VIDEO only, see
 * mediaUploadService.resolveMediaUri. Returns null while unresolved/absent;
 * `image`/`video` content kinds carry no loading-scrim prop (confirmed
 * design-system shape), so callers fall back to a lightweight local
 * placeholder image, not a spinner overlay.
 */
export function useResolvedMediaUri(cloudValue: string | null): string | null {
  // Keyed by the cloudValue it was resolved for, so a stale resolution from
  // a since-changed cloudValue (e.g. local file:// -> real S3 key once
  // upload completes) is never returned — no synchronous setState-on-change
  // needed in the effect body itself, only from the async callback.
  const [resolved, setResolved] = useState<{ cloudValue: string | null; uri: string | null }>({
    cloudValue: null,
    uri: null,
  });

  useEffect(() => {
    if (!cloudValue) return;
    let cancelled = false;
    resolveMediaUri(cloudValue)
      .then((uri) => {
        if (!cancelled) setResolved({ cloudValue, uri });
      })
      .catch((error: unknown) => {
        // getDownloadUrl/download failure — accepted gap (plan's error-handling
        // table): stays null forever here, same as a permanently-missing file,
        // rather than surfacing a distinct "couldn't load" state in v1.
        if (__DEV__) console.log('[useResolvedMediaUri] resolveMediaUri failed:', error);
      });
    return () => {
      cancelled = true;
    };
  }, [cloudValue]);

  if (!cloudValue || resolved.cloudValue !== cloudValue) return null;
  return resolved.uri;
}
