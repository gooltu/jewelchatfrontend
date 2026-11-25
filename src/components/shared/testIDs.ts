import type { ChatMessage, Contact, Conversation } from '@app-types/chat';

/**
 * E2E (Maestro/Detox) testID builders for list rows, so every screen names the
 * same record the same way. Convention: `<screen>.<element>[.<record>]`, dot-
 * separated, kebab-case segments — the same scheme as the design system's
 * `subTestID` (which derives child ids like `.text`/`.status` from these).
 *
 * Record segments use ids that are the SAME ON EVERY DEVICE (SENDER_MSG_ID,
 * the JID's userId, the phone number), never the per-device SQLite `_ID`, so a
 * multi-device test or a bot peer can address the exact row it created.
 */

/** `<screen>.message.<SENDER_MSG_ID>` (default screen `chat-detail`);
 * `local-<_ID>` if it has none. */
export function messageTestID(
  message: Pick<ChatMessage, 'SENDER_MSG_ID' | '_ID'>,
  screen = 'chat-detail',
): string {
  return `${screen}.message.${message.SENDER_MSG_ID ?? `local-${message._ID}`}`;
}

/** `<screen>.row.<jid-node>` — the JID's local part (the numeric userId for
 * 1:1, the room name for groups), since a full JID's `@`/`.` would clash with
 * the dot separator. */
export function conversationRowTestID(
  screen: string,
  conversation: Pick<Conversation, 'JID' | '_ID'>,
): string {
  return `${screen}.row.${jidNode(conversation.JID) ?? `local-${conversation._ID}`}`;
}

/** `<screen>.row.<digits>` — phonebook contacts may not have a JID yet (not
 * resolved as JewelChat users), so contact pickers key off the phone number,
 * which a test seeds into the device's address book itself. */
export function contactRowTestID(
  screen: string,
  contact: Pick<Contact, 'CONTACT_NUMBER' | '_ID'>,
): string {
  const digits =
    contact.CONTACT_NUMBER == null ? '' : String(contact.CONTACT_NUMBER).replace(/\D/g, '');
  return `${screen}.row.${digits || `local-${contact._ID}`}`;
}

function jidNode(jid: string | null | undefined): string | null {
  return jid ? jid.split('@')[0] : null;
}
