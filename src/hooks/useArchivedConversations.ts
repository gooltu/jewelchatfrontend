import { useCallback, useEffect, useState } from 'react';
import { getArchivedContacts } from '@database/contactRepository';
import { subscribeToAllRooms } from '@services/chatService';
import type { Conversation } from '@app-types/chat';

interface UseArchivedConversationsResult {
  conversations: Conversation[];
  loading: boolean;
}

/** Archived conversations, most recent first — backs ArchivedChatsScreen and ChatListScreen's "Archived (N)" row. */
export function useArchivedConversations(): UseArchivedConversationsResult {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const rows = await getArchivedContacts();
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

  return { conversations, loading };
}
