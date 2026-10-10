import { useCallback, useEffect, useState } from 'react';
import { getContactByJid } from '@database/contactRepository';
import { subscribeToRoom } from '@services/chatService';
import type { Contact } from '@app-types/chat';

/** A single Contact row, live-updated on any mutation to its room — e.g. for ChatDetailScreen's Pin/Archive/Delete sheet, which needs IS_PINNED/IS_ARCHIVED. */
export function useContact(jid: string | null): Contact | null {
  const [contact, setContact] = useState<Contact | null>(null);

  const refresh = useCallback(async () => {
    if (!jid) {
      setContact(null);
      return;
    }
    setContact(await getContactByJid(jid));
  }, [jid]);

  useEffect(() => {
    // Initial SQLite read on mount/jid-change — an external-system fetch,
    // not derivable from props/state during render, so setState here is
    // intentional despite the lint rule's general guidance.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!jid) return undefined;
    return subscribeToRoom(jid, () => void refresh());
  }, [jid, refresh]);

  return contact;
}
