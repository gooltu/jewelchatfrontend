import type { Contact } from '@app-types/chat';

/** Shown for a 1:1 chat whose sender we know nothing about yet (not even a number). */
export const UNKNOWN_SENDER_LABEL = 'Unknown User';

/**
 * Formats a stored phone number (country code + number, no plus, see
 * contactSyncService.normalizePhoneNumber) for display: Indian numbers as
 * "+91 90000 00004", anything else as "+<digits>".
 */
export function formatPhoneNumber(phone: number | null | undefined): string | null {
  if (phone == null) return null;
  const digits = String(phone);
  if (digits.length === 12 && digits.startsWith('91')) {
    return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`;
  }
  return `+${digits}`;
}

/** A conversation's title: its own name, the phonebook name, the sender's number, then "Unknown User". */
export function conversationDisplayName(
  contact:
    Pick<Contact, 'CONTACT_NAME' | 'PHONEBOOK_CONTACT_NAME' | 'CONTACT_NUMBER'> | null | undefined,
): string {
  return (
    contact?.CONTACT_NAME ??
    contact?.PHONEBOOK_CONTACT_NAME ??
    formatPhoneNumber(contact?.CONTACT_NUMBER) ??
    UNKNOWN_SENDER_LABEL
  );
}

/**
 * A 1:1 chat with someone who isn't in the phonebook and has no name of
 * their own. Groups and the Team Jewel Chat welcome contact (which has
 * CONTACT_NAME) never count.
 */
export function isUnknownSender(
  contact: Pick<Contact, 'IS_GROUP' | 'CONTACT_NAME' | 'PHONEBOOK_CONTACT_NAME'>,
): boolean {
  return contact.IS_GROUP !== 1 && !contact.CONTACT_NAME && !contact.PHONEBOOK_CONTACT_NAME;
}

/** An unknown sender the user hasn't answered the prompt for yet (not continued, not blocked). */
export function needsUnknownSenderPrompt(
  contact: Pick<
    Contact,
    'IS_GROUP' | 'CONTACT_NAME' | 'PHONEBOOK_CONTACT_NAME' | 'IS_BLOCKED' | 'IS_UNKNOWN_ACCEPTED'
  >,
): boolean {
  return isUnknownSender(contact) && contact.IS_BLOCKED !== 1 && contact.IS_UNKNOWN_ACCEPTED !== 1;
}
