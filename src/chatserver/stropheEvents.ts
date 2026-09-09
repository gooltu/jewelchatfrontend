/**
 * Stanza handlers: maps incoming XMPP stanzas onto local SQLite rows via
 * the database/ repositories. Registered against a connected
 * StropheConnection by chatService (never called directly from screens —
 * see src/services/chatService.ts).
 *
 * Strophe.Connection#addHandler expects a *synchronous* handler returning
 * boolean (true = keep listening for future stanzas). Our persistence work
 * is async (SQLite), so each handler kicks off its async body with `void`
 * and returns `true` immediately — the stanza itself is not awaited by
 * Strophe either way.
 */
import { Strophe, type StropheConnection } from 'react-native-strophe';
import {
  getMessageBySenderMsgId,
  insertIncomingMessage,
  markSubmitted,
  markDelivered,
  markRead,
} from '../database/messageRepository';
import { replaceReactorReactions } from '../database/reactionRepository';
import { incrementUnreadCount, updateLastMessagePreview } from '../database/contactRepository';
import { RECEIPTS_NS, CHAT_MARKERS_NS, buildReceivedStanza } from './receiptStanzas';
import { MSG_TYPE } from '../types/chat';
import type { ChatMessage } from '../types/chat';

/** XEP-0444 Message Reactions. */
const REACTIONS_NS = 'urn:xmpp:reactions:0';
/** XEP-0085 Chat State Notifications. */
const CHAT_STATES_NS = 'http://jabber.org/protocol/chatstates';
const CHAT_STATE_TAGS = ['composing', 'paused', 'active', 'inactive', 'gone'];

export interface StropheEventCallbacks {
  onMessageStored?: (message: ChatMessage) => void;
  onReactionsChanged?: (chatRoomJid: string, senderMsgId: string) => void;
  onTypingChanged?: (chatRoomJid: string, isTyping: boolean) => void;
}

/**
 * `myJid` is required to detect the server's self-echo (submit confirmation
 * — see handleSelfEcho) and to correlate an inbound `<received>`/`<displayed>`
 * back to the sender's own outgoing row.
 */
export function registerStanzaHandlers(
  connection: StropheConnection,
  myJid: string,
  callbacks: StropheEventCallbacks = {},
): void {
  connection.addHandler(
    (stanza) => {
      void handleMessageStanza(stanza, connection, myJid, callbacks);
      return true;
    },
    null,
    'message',
    null,
    null,
    null,
  );
}

async function handleMessageStanza(
  stanza: Element,
  connection: StropheConnection,
  myJid: string,
  callbacks: StropheEventCallbacks,
): Promise<void> {
  const from = stanza.getAttribute('from');
  if (!from) return;

  // Server self-echo: confirms the server accepted a message *we* sent —
  // structurally different from a genuine incoming message, so this check
  // must run before any of the dispatch below (which all assume `from` is
  // someone else's JID).
  const fromBare = Strophe.getBareJidFromJid(from);
  if (fromBare === myJid) {
    await handleSelfEcho(stanza, myJid, callbacks);
    return;
  }

  const type = stanza.getAttribute('type'); // 'chat' | 'groupchat' | 'error' | ...
  const isGroupMsg = type === 'groupchat';

  // 1-1: the "room" is just the peer's bare JID. Group: the MUC room's bare JID.
  const chatRoomJid = Strophe.getBareJidFromJid(from);
  if (!chatRoomJid) return;

  // 1-1: the author is the peer's bare JID (same as chatRoomJid). Group: the
  // full room@conference.domain/nickname JID identifies the author uniquely.
  const creatorJid = isGroupMsg ? from : chatRoomJid;
  const senderName = Strophe.getResourceFromJid(from);

  const reactionsElem = firstChildByTagNameNs(stanza, 'reactions', REACTIONS_NS);
  if (reactionsElem) {
    await handleReactionStanza(chatRoomJid, isGroupMsg, creatorJid, senderName, reactionsElem, callbacks);
    return;
  }

  const chatState = firstChatStateTagName(stanza);
  if (chatState) {
    callbacks.onTypingChanged?.(chatRoomJid, chatState === 'composing');
  }

  const receivedElem = firstChildByTagNameNs(stanza, 'received', RECEIPTS_NS);
  if (receivedElem) {
    const id = receivedElem.getAttribute('id');
    if (id) {
      const row = await getMessageBySenderMsgId(chatRoomJid, myJid, id);
      if (row) {
        await markDelivered(row._ID, Date.now());
        const updated = await getMessageBySenderMsgId(chatRoomJid, myJid, id);
        if (updated) callbacks.onMessageStored?.(updated);
      }
    }
    return;
  }

  const displayedElem = firstChildByTagNameNs(stanza, 'displayed', CHAT_MARKERS_NS);
  if (displayedElem) {
    const id = displayedElem.getAttribute('id');
    if (id) {
      const row = await getMessageBySenderMsgId(chatRoomJid, myJid, id);
      if (row) {
        await markRead(row._ID, Date.now());
        const updated = await getMessageBySenderMsgId(chatRoomJid, myJid, id);
        if (updated) callbacks.onMessageStored?.(updated);
      }
    }
    return;
  }

  const bodyElem = firstChildByTagName(stanza, 'body');
  const msgText = bodyElem?.textContent ?? null;
  if (!msgText) return; // no body, no reaction/receipt/marker: e.g. a bare chat-state notification — nothing to persist

  const senderMsgId = stanza.getAttribute('id') ?? `${chatRoomJid}-${Date.now()}`;

  // Dedup on (SENDER_MSG_ID, CHAT_ROOM_JID, CREATOR_JID) — the same triple as
  // ChatMessage's UNIQUE constraint. Checked explicitly here so a redelivered
  // stanza short-circuits before even attempting the insert; the table's own
  // constraint (insertIncomingMessage uses INSERT OR IGNORE) is the backstop
  // in case two stanzas race this check concurrently.
  const existing = await getMessageBySenderMsgId(chatRoomJid, creatorJid, senderMsgId);
  if (existing) return;

  // Bare (non-namespaced) <media/> — confirmed wire format from a real
  // prior-working implementation, not a registered XEP. Absent on plain
  // text messages.
  const mediaElem = firstChildByTagName(stanza, 'media');
  const msgType = mediaElem ? Number(mediaElem.getAttribute('number')) : MSG_TYPE.TEXT;
  const mediaLink = mediaElem?.getAttribute('link') ?? null;
  const mediaThumbnail = mediaElem?.getAttribute('thumbnail') ?? null;

  const now = Date.now();
  await insertIncomingMessage({
    IS_GROUP_MSG: isGroupMsg ? 1 : 0,
    MSG_TYPE: msgType,
    CREATED_DATE: new Date(now).toISOString().slice(0, 10),
    CREATED_TIME: now,
    CHAT_ROOM_JID: chatRoomJid,
    CREATOR_JID: creatorJid,
    SENDER_NAME: senderName,
    SENDER_MSG_ID: senderMsgId,
    IS_READ: 0,
    TIME_READ: null,
    IS_DELIVERED: 1,
    TIME_DELIVERED: now,
    TIME_CREATED: now,
    IS_ERROR: 0,
    JEWEL_TYPE: null,
    IS_JEWEL_PICKED: 0,
    MSG_TEXT: msgText,
    MEDIA_UPLOADED: 0,
    MEDIA_CLOUD: mediaLink,
    MEDIA_CLOUD_THUMBNAIL: mediaThumbnail,
    IS_REPLY: 0,
    REPLY_PARENT: null,
    IS_FORWARD: 0,
  });

  await incrementUnreadCount(chatRoomJid);
  await updateLastMessagePreview(chatRoomJid, { msgText, msgType, createdTime: now });

  const stored = await getMessageBySenderMsgId(chatRoomJid, creatorJid, senderMsgId);
  if (stored) callbacks.onMessageStored?.(stored);

  // 1-1 only (Assumption 7 in the plan) — send a delivery receipt back
  // unconditionally, matching this server's own unconditional-receipt
  // behavior (no <request/> needed on either side).
  if (!isGroupMsg && connection.connected) {
    connection.send(buildReceivedStanza(from, senderMsgId).tree());
  }
}

/**
 * Server self-echo: confirms the server accepted a message *we* sent —
 * `from`/`to` are swapped relative to a normal incoming message (`from` is
 * our own bare JID, `to` is the peer we originally sent to), and the `id`
 * matches the original SENDER_MSG_ID. This is what actually drives the
 * single-tick (IS_SUBMITTED) transition — not `connection.send()` succeeding
 * without throwing (see syncService.ts).
 */
async function handleSelfEcho(
  stanza: Element,
  myJid: string,
  callbacks: StropheEventCallbacks,
): Promise<void> {
  const to = stanza.getAttribute('to');
  const senderMsgId = stanza.getAttribute('id');
  if (!to || !senderMsgId) return;

  const peerChatRoomJid = Strophe.getBareJidFromJid(to) ?? to;
  const row = await getMessageBySenderMsgId(peerChatRoomJid, myJid, senderMsgId);
  if (!row) return;

  await markSubmitted(row._ID, Date.now());
  const updated = await getMessageBySenderMsgId(peerChatRoomJid, myJid, senderMsgId);
  if (updated) callbacks.onMessageStored?.(updated);
}

/**
 * XEP-0444 reaction stanzas carry the *full* current set of the reactor's
 * emoji on the target message — not a diff — so this maps 1:1 onto
 * reactionRepository's replace-set-on-update semantics.
 */
async function handleReactionStanza(
  chatRoomJid: string,
  isGroupMsg: boolean,
  authorJid: string,
  reactorName: string | null,
  reactionsElem: Element,
  callbacks: StropheEventCallbacks,
): Promise<void> {
  const targetSenderMsgId = reactionsElem.getAttribute('id');
  if (!targetSenderMsgId) return;

  const emojis: string[] = [];
  const reactionNodes = reactionsElem.getElementsByTagName('reaction');
  for (let i = 0; i < reactionNodes.length; i += 1) {
    const text = reactionNodes[i]?.textContent;
    if (text) emojis.push(text);
  }

  // For 1-1 chats the reactor is the message author (authorJid === chatRoomJid);
  // for group chats the reactor is whoever sent this particular reaction stanza,
  // which may differ from the target message's author.
  const reactorJid = isGroupMsg ? authorJid : chatRoomJid;

  await replaceReactorReactions({
    chatRoomJid,
    senderMsgId: targetSenderMsgId,
    isGroupMsg,
    reactorJid,
    reactorName,
    emojis,
    reactedTime: Date.now(),
  });

  callbacks.onReactionsChanged?.(chatRoomJid, targetSenderMsgId);
}

function firstChatStateTagName(stanza: Element): string | null {
  for (const tag of CHAT_STATE_TAGS) {
    const node = firstChildByTagNameNs(stanza, tag, CHAT_STATES_NS);
    if (node) return tag;
  }
  return null;
}

export function firstChildByTagName(elem: Element, tagName: string): Element | null {
  const nodes = elem.getElementsByTagName(tagName);
  return nodes.length > 0 ? nodes[0] : null;
}

export function firstChildByTagNameNs(elem: Element, tagName: string, ns: string): Element | null {
  const nodes = elem.getElementsByTagName(tagName);
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];
    if (node && node.getAttribute('xmlns') === ns) return node;
  }
  return null;
}
