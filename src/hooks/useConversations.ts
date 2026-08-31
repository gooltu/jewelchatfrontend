import { useCallback, useEffect, useState } from 'react';
import { getAllContacts } from '@database/contactRepository';
import { subscribeToAllRooms } from '@services/chatService';
import type { Conversation } from '@app-types/chat';

interface UseConversationsResult {
  conversations: Conversation[];
  loading: boolean;
  refresh: () => Promise<void>;
}

/** SQLite-backed chat list (the Contact table), refreshed on any room mutation. */
export function useConversations(): UseConversationsResult {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const rows = await getAllContacts();
    setConversations(rows);
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

  return { conversations, loading, refresh };
}
