import { useEffect, useState } from 'react';
import { resolveGroupMemberDisplayName } from '@services/identityService';

/**
 * Resolves a group member's JID into a display name for rendering — never a
 * raw JID (see services/identityService.ts). Returns null while unresolved
 * or if `jid` is null; callers should fall back to something else (e.g. the
 * message's already-stored SENDER_NAME) for that brief gap.
 */
export function useDisplayName(jid: string | null): string | null {
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    if (!jid) {
      // Resets to null on a jid -> null transition — external-fetch-driven
      // state, not something derivable during render (mirrors useMessages.ts's
      // own justification for this lint rule).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setName(null);
      return;
    }
    let cancelled = false;
    void resolveGroupMemberDisplayName(jid).then((resolved) => {
      if (!cancelled) setName(resolved);
    });
    return () => {
      cancelled = true;
    };
  }, [jid]);

  return name;
}
