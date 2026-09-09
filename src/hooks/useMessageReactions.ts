import { useCallback, useEffect, useState } from 'react';
import { getGroupedReactionsForMessage } from '@database/reactionRepository';
import { subscribeToRoom } from '@services/chatService';
import type { ReactionGroup } from '@app-types/chat';

/** Grouped-emoji reactions for one message, refreshed on any room mutation (mirrors useMessages). */
export function useMessageReactions(chatRoomJid: string, senderMsgId: string | null): ReactionGroup[] {
  const [reactions, setReactions] = useState<ReactionGroup[]>([]);

  const refresh = useCallback(async () => {
    if (!senderMsgId) return;
    setReactions(await getGroupedReactionsForMessage(chatRoomJid, senderMsgId));
  }, [chatRoomJid, senderMsgId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  useEffect(() => subscribeToRoom(chatRoomJid, () => void refresh()), [chatRoomJid, refresh]);

  return reactions;
}
