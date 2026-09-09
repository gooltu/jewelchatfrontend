// expo-contacts' top-level getContactsAsync/requestPermissionsAsync were
// deprecated in SDK 57 in favor of a new class-based API; the legacy
// sub-import keeps the same function-based surface we use here.
import * as Contacts from 'expo-contacts/legacy';
import * as contactRepository from '@database/contactRepository';
import * as contactLookupApi from '@gameserver/contactLookupApi';
import { COUNTRY_CODE, getStoredDomain } from './authService';
import type { Contact } from '@app-types/chat';

/**
 * Orchestrates the device phonebook and the lazy JewelChat identity lookup —
 * screens call this, never expo-contacts/contactRepository/contactLookupApi
 * directly.
 */

/** Strips formatting and applies this app's single-country-code convention (see authService.COUNTRY_CODE). */
function normalizePhoneNumber(raw: string): number | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return Number(`${COUNTRY_CODE}${digits}`);
  if (digits.length > 10 && digits.startsWith(COUNTRY_CODE)) return Number(digits);
  return null;
}

/**
 * Reads the device phonebook and reconciles it into the Contact table.
 * Local-only — never resolves JewelChat identity (that's lazy, see
 * resolveContactOnTap). Call this every time the Select Contact screen
 * mounts.
 */
export async function syncPhonebook(): Promise<void> {
  try {
    const { status } = await Contacts.requestPermissionsAsync();
    if (status !== 'granted') return;

    const { data } = await Contacts.getContactsAsync({
      fields: [Contacts.Fields.PhoneNumbers, Contacts.Fields.Name],
    });

    for (const person of data) {
      const name = person.name?.trim();
      if (!name || !person.phoneNumbers?.length) continue;
      const contactNumber = normalizePhoneNumber(person.phoneNumbers[0].number ?? '');
      if (contactNumber === null) continue;
      await contactRepository.upsertPhonebookContact({ contactNumber, phonebookName: name });
    }
  } catch (error) {
    if (__DEV__) console.log('[contactSyncService] syncPhonebook failed:', error);
  }
}

export type ResolveContactResult =
  | { outcome: 'chat'; jid: string }
  | { outcome: 'bareProfile'; contact: Contact };

/**
 * Tap-to-resolve: uses an already-known JID immediately, otherwise makes a
 * single lazy lookup call (see plan Assumption 3 — lookup is deliberately
 * per-contact, never bulk during sync).
 */
export async function resolveContactOnTap(contact: Contact): Promise<ResolveContactResult> {
  if (contact.JEWELCHAT_ID != null && contact.JID) {
    return { outcome: 'chat', jid: contact.JID };
  }

  if (contact.CONTACT_NUMBER == null) {
    return { outcome: 'bareProfile', contact };
  }

  const result = await contactLookupApi.downloadContactByPhone(String(contact.CONTACT_NUMBER));
  if (!result) {
    return { outcome: 'bareProfile', contact };
  }

  const domain = await getStoredDomain();
  if (!domain) {
    if (__DEV__) console.log('[contactSyncService] resolveContactOnTap: no stored domain, cannot build JID');
    return { outcome: 'bareProfile', contact };
  }

  const jid = `${result.jewelchatId}@${domain}`;
  await contactRepository.attachJewelchatIdentity({
    contactNumber: contact.CONTACT_NUMBER,
    jewelchatId: result.jewelchatId,
    jid,
    statusMsg: result.status,
  });

  return { outcome: 'chat', jid };
}
