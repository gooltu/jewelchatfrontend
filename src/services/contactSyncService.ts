// expo-contacts' top-level getContactsAsync/requestPermissionsAsync were
// deprecated in SDK 57 in favor of a new class-based API; the legacy
// sub-import keeps the same function-based surface we use here.
import { Alert } from 'react-native';
import * as Contacts from 'expo-contacts/legacy';
import { Contact as DeviceContact } from 'expo-contacts';
import * as contactRepository from '@database/contactRepository';
import * as contactLookupApi from '@gameserver/contactLookupApi';
import * as chatService from './chatService';
import { COUNTRY_CODE, getStoredDomain } from './authService';
import type { Contact } from '@app-types/chat';
import { store } from '@store/index';
import { contactsDisclosureAccepted } from '@store/slices/consentSlice';

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
let disclosurePrompt: Promise<boolean> | null = null;

/**
 * Google Play prominent disclosure for contacts. It must appear in the app,
 * before the OS permission prompt, say what is collected and why, and need an
 * affirmative tap. Shown until accepted once (persisted in consentSlice).
 * Single-flight, so screens that mount at the same time share one dialog.
 */
export function ensureContactsDisclosureAccepted(): Promise<boolean> {
  if (store.getState().consent.contactsDisclosureAccepted) return Promise.resolve(true);
  if (!disclosurePrompt) {
    disclosurePrompt = new Promise<boolean>((resolve) => {
      Alert.alert(
        'Find friends on Jewel Chat',
        'Jewel Chat reads the names and phone numbers in your contacts to show which of your contacts use ' +
          'Jewel Chat. Your contact list stays on this device. When you tap a contact, that contact\'s phone ' +
          'number is sent to Jewel Chat\'s server to check whether they have an account.',
        [
          { text: 'Not now', style: 'cancel', onPress: () => resolve(false) },
          {
            text: 'Continue',
            onPress: () => {
              store.dispatch(contactsDisclosureAccepted());
              resolve(true);
            },
          },
        ],
        { cancelable: true, onDismiss: () => resolve(false) },
      );
    }).finally(() => {
      disclosurePrompt = null;
    });
  }
  return disclosurePrompt;
}

export async function syncPhonebook(): Promise<void> {
  try {
    if (!(await ensureContactsDisclosureAccepted())) return;
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

/**
 * Opens the OS "new contact" form with this number pre-filled, so the user
 * saves it themselves. Uses the SDK 57 class API, since the legacy
 * presentFormAsync is gone. On Android it's an ACTION_INSERT intent, so no
 * WRITE_CONTACTS permission (deliberately stripped in app.config.ts).
 * Resolves true if the OS reports a contact was saved. Android's reply is not
 * always reliable, so callers should re-sync the phonebook either way.
 */
export async function presentCreateContactForm(phone: number): Promise<boolean> {
  try {
    return await DeviceContact.presentCreateForm({
      phones: [{ label: 'mobile', number: `+${phone}` }],
    });
  } catch (error) {
    if (__DEV__) console.log('[contactSyncService] presentCreateContactForm failed:', error);
    return false;
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

  // This device's first-ever discovery that this phonebook contact is a
  // JewelChat user — the one moment to tell the XMPP server about the new
  // relationship. Fire-and-forget, best-effort, matching every other XMPP
  // housekeeping call in this codebase (see roster-presence-subscriptions
  // plan). Naturally fires only once per contact: the early-return above
  // short-circuits every subsequent tap once JEWELCHAT_ID/JID are set.
  chatService.addToRosterAndSubscribe(jid, contact.CONTACT_NAME ?? contact.PHONEBOOK_CONTACT_NAME ?? undefined);

  return { outcome: 'chat', jid };
}
