import { $msg, type StropheBuilder } from 'react-native-strophe';

/** XEP-0184 Message Delivery Receipts — parsing incoming `<received/>` only.
 * This server/its clients send receipts unconditionally, so outgoing
 * messages never carry a `<request/>` element (confirmed, not strict
 * XEP-0184). */
export const RECEIPTS_NS = 'urn:xmpp:receipts';
/** XEP-0333 Chat Markers — `<displayed/>` only (read receipts). */
export const CHAT_MARKERS_NS = 'urn:xmpp:chat-markers:0';
/** XEP-0085 Chat State Notifications — shared with chatService.ts/stropheEvents.ts's own copies. */
export const CHAT_STATES_NS = 'http://jabber.org/protocol/chatstates';

export function buildReceivedStanza(to: string, id: string): StropheBuilder {
  return $msg({ to }).c('received', { xmlns: RECEIPTS_NS, id });
}

export function buildDisplayedStanza(to: string, id: string): StropheBuilder {
  return $msg({ to }).c('displayed', { xmlns: CHAT_MARKERS_NS, id });
}

/**
 * Appends the bare (non-namespaced) `<media/>` sibling element — confirmed
 * wire format from a real prior-working implementation, not a registered
 * XEP. `number` is this app's own MSG_TYPE value, not any other numbering
 * scheme. `thumbnail` is only included when present (e.g. never for
 * stickers/GIFs today, only reserved for a future video kind).
 */
export function withMediaElement(
  builder: StropheBuilder,
  args: { msgType: number; link: string; thumbnail?: string | null },
): StropheBuilder {
  const attrs: Record<string, string | number> = { number: args.msgType, link: args.link };
  if (args.thumbnail) attrs.thumbnail = args.thumbnail;
  return builder.up().c('media', attrs);
}

/** Appends the trailing chat-state every outgoing message sends, signaling "no longer composing". */
export function withActiveChatState(builder: StropheBuilder): StropheBuilder {
  return builder.up().c('active', { xmlns: CHAT_STATES_NS });
}
