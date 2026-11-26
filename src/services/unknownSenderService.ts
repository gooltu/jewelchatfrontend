import * as contactRepository from '@database/contactRepository';
import * as chatService from './chatService';
import * as contactSyncService from './contactSyncService';

/**
 * What to do about a 1:1 chat from someone not in the phonebook: continue
 * the conversation, block them, or add them to the device's contacts. The
 * prompt itself is components/shared/UnknownSenderPrompt.tsx, shown by
 * ChatDetailScreen. Profile lookup (phone number) is
 * chatService.resolveUnknownSender; the avatar comes from useAvatarSource.
 *
 * Blocking is device-side only. MongooseIM here runs no mod_blocking or
 * mod_privacy, so the server still delivers a blocked peer's stanzas and the
 * peer is never told. stropheEvents.handleMessageStanza (live) and
 * chatService.persistArchivedMessage (MAM catch-up) drop them before they are
 * stored or receipted.
 */

/** "Continue": keep chatting without saving them; the prompt stops showing. */
export async function acceptUnknownSender(jid: string): Promise<void> {
  await contactRepository.setUnknownAccepted(jid);
  chatService.notifyRoom(jid);
}

export async function blockContact(jid: string): Promise<void> {
  await contactRepository.setBlocked(jid, true);
  chatService.notifyRoom(jid);
}

/** Unblocking is itself a choice to hear from them again, so it also counts
 * as "Continue": the chat goes straight back to the composer instead of
 * asking again. */
export async function unblockContact(jid: string): Promise<void> {
  await contactRepository.setBlocked(jid, false);
  await contactRepository.setUnknownAccepted(jid);
  chatService.notifyRoom(jid);
}

export type AddToContactsResult = 'added' | 'cancelled' | 'no-number';

/**
 * "Add to contacts": opens the OS create-contact form with the sender's
 * number pre-filled, then re-reads the phonebook. syncPhonebook upserts ON
 * CONFLICT(CONTACT_NUMBER), and the JID row already holds the number (see
 * resolveUnknownSender), so the saved name lands on this chat's own row. Once
 * it has a phonebook name, roster-add and subscribe like any phonebook
 * contact. Counts as added if either the OS says a contact was saved or the
 * name shows up, since Android's form result isn't always reliable.
 */
export async function addUnknownSenderToContacts(jid: string): Promise<AddToContactsResult> {
  const contact = await contactRepository.getContactByJid(jid);
  if (contact?.CONTACT_NUMBER == null) return 'no-number';

  const saved = await contactSyncService.presentCreateContactForm(contact.CONTACT_NUMBER);
  await contactSyncService.syncPhonebook();

  const updated = await contactRepository.getContactByJid(jid);
  const name = updated?.PHONEBOOK_CONTACT_NAME;
  if (!saved && !name) return 'cancelled';

  if (name) chatService.addToRosterAndSubscribe(jid, name);
  await contactRepository.setUnknownAccepted(jid);
  chatService.notifyRoom(jid);
  return 'added';
}
