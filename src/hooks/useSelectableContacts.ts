import { useCallback, useEffect, useState } from 'react';
import { getAllContactsForPicker } from '@database/contactRepository';
import { syncPhonebook } from '@services/contactSyncService';
import { subscribeToAllRooms } from '@services/chatService';
import type { Contact } from '@app-types/chat';

interface UseSelectableContactsResult {
  contacts: Contact[];
  loading: boolean;
  refresh: () => Promise<void>;
}

function contactSortKey(contact: Contact): string {
  return (contact.CONTACT_NAME ?? contact.PHONEBOOK_CONTACT_NAME ?? '').toLowerCase();
}

/** "Active" = resolved, registered JewelChat user — see plan Assumption 1 (no real presence signal exists). */
export function isActive(contact: Contact): boolean {
  return contact.IS_REGIS === 1 && contact.JEWELCHAT_ID != null;
}

function byActiveThenName(a: Contact, b: Contact): number {
  const aActive = isActive(a);
  const bActive = isActive(b);
  if (aActive !== bActive) return aActive ? -1 : 1;
  return contactSortKey(a).localeCompare(contactSortKey(b));
}

/** Backs the Select Contact screen: resyncs the phonebook, then returns one list, active contacts on top and alphabetical otherwise. */
export function useSelectableContacts(): UseSelectableContactsResult {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    await syncPhonebook();
    const rows = await getAllContactsForPicker();
    setContacts([...rows].sort(byActiveThenName));
    setLoading(false);
  }, []);

  useEffect(() => {
    // Initial phonebook resync + SQLite read — an external-system fetch,
    // not derivable from props/state during render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  useEffect(() => subscribeToAllRooms(() => void refresh()), [refresh]);

  return { contacts, loading, refresh };
}
