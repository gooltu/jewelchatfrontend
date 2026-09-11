import { useCallback, useEffect, useState } from 'react';
import { getGroupMembers } from '@database/groupMemberRepository';
import { subscribeToRoom, refreshGroupMembers } from '@services/chatService';
import type { GroupMember } from '@app-types/chat';

interface UseGroupMembersResult {
  members: GroupMember[];
  loading: boolean;
}

/**
 * SQLite-backed group roster for one room, kept live via the same
 * subscribeToRoom mechanism useMessages uses (fed here by
 * stropheEvents.ts's onGroupRosterChanged callback). Kicks off a
 * best-effort server refresh on mount so the screen reflects live state,
 * not just whatever was last cached locally.
 */
export function useGroupMembers(groupJid: string | null): UseGroupMembersResult {
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!groupJid) {
      setMembers([]);
      setLoading(false);
      return;
    }
    const rows = await getGroupMembers(groupJid);
    setMembers(rows);
    setLoading(false);
  }, [groupJid]);

  useEffect(() => {
    // Initial SQLite read — an external-system fetch, not derivable from
    // props/state during render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  useEffect(() => {
    if (!groupJid) return undefined;
    return subscribeToRoom(groupJid, () => {
      void load();
    });
  }, [groupJid, load]);

  useEffect(() => {
    if (!groupJid) return;
    refreshGroupMembers(groupJid).catch((error: unknown) => {
      if (__DEV__) console.log('[useGroupMembers] refreshGroupMembers failed:', error);
    });
  }, [groupJid]);

  return { members, loading };
}
