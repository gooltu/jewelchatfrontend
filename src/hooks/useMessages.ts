import { useCallback, useEffect, useRef, useState } from 'react';
import { getMessagesPage } from '@database/messageRepository';
import { subscribeToRoom } from '@services/chatService';
import type { ChatMessage } from '@app-types/chat';

interface UseMessagesResult {
  messages: ChatMessage[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  loadMore: () => Promise<void>;
}

/**
 * SQLite-backed, cursor-paginated message list for one conversation.
 * Redux never holds this data (see chatSlice's doc comment) — this hook is
 * the only bridge between ChatDetailScreen and the ChatMessage table.
 */
export function useMessages(chatRoomJid: string | null, pageSize = 30): UseMessagesResult {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const cursorRef = useRef<number | null>(null);
  const hasMoreRef = useRef(true);

  const loadFirstPage = useCallback(async () => {
    if (!chatRoomJid) {
      setMessages([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const page = await getMessagesPage(chatRoomJid, { limit: pageSize });
    setMessages(page.messages);
    cursorRef.current = page.nextCursor;
    hasMoreRef.current = page.nextCursor !== null;
    setHasMore(hasMoreRef.current);
    setLoading(false);
  }, [chatRoomJid, pageSize]);

  const loadMore = useCallback(async () => {
    if (!chatRoomJid || !hasMoreRef.current || loadingMore) return;
    setLoadingMore(true);
    const page = await getMessagesPage(chatRoomJid, {
      beforeSequence: cursorRef.current ?? undefined,
      limit: pageSize,
    });
    setMessages((prev) => [...prev, ...page.messages]);
    cursorRef.current = page.nextCursor;
    hasMoreRef.current = page.nextCursor !== null;
    setHasMore(hasMoreRef.current);
    setLoadingMore(false);
  }, [chatRoomJid, pageSize, loadingMore]);

  // On a room mutation (new/updated message, reaction, status flag), merge
  // just the newest page into what's already loaded rather than reloading
  // from scratch — that would otherwise collapse any older pages the user
  // scrolled up to load via loadMore().
  const mergeNewest = useCallback(async () => {
    if (!chatRoomJid) return;
    const page = await getMessagesPage(chatRoomJid, { limit: pageSize });
    setMessages((prev) => {
      const byId = new Map(prev.map((m) => [m._ID, m]));
      for (const message of page.messages) byId.set(message._ID, message);
      return Array.from(byId.values()).sort(
        (a, b) => b.SEQUENCE - a.SEQUENCE || (b.CREATED_TIME ?? 0) - (a.CREATED_TIME ?? 0),
      );
    });
  }, [chatRoomJid, pageSize]);

  useEffect(() => {
    // Initial/room-change SQLite read — an external-system fetch, not
    // derivable from props/state during render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadFirstPage();
  }, [loadFirstPage]);

  useEffect(() => {
    if (!chatRoomJid) return undefined;
    return subscribeToRoom(chatRoomJid, () => {
      void mergeNewest();
    });
  }, [chatRoomJid, mergeNewest]);

  return { messages, loading, loadingMore, hasMore, loadMore };
}
