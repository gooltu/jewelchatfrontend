import { useCallback, useEffect, useState } from 'react';
import { getStarredMessages } from '@database/messageRepository';
import { subscribeToAllRooms } from '@services/chatService';
import type { ChatMessage } from '@app-types/chat';

interface UseStarredMessagesResult {
  messages: ChatMessage[];
  loading: boolean;
}

/** Every starred message across every conversation, newest first — backs StarredMessagesScreen. */
export function useStarredMessages(): UseStarredMessagesResult {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const rows = await getStarredMessages();
    setMessages(rows);
    setLoading(false);
  }, []);

  useEffect(() => {
    // Initial SQLite read on mount — an external-system fetch, not
    // derivable from props/state during render, so setState here is
    // intentional despite the lint rule's general guidance.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  useEffect(() => subscribeToAllRooms(() => void refresh()), [refresh]);

  return { messages, loading };
}
