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
  getMessageById,
  getMessageBySenderMsgId,
  insertIncomingMessage,
  insertSystemMessage,
  markSubmitted,
  markDelivered,
  markRead,
} from '../database/messageRepository';
import { upsertReceipt, getReceipts } from '../database/messageReceiptRepository';
import { replaceReactorReactions } from '../database/reactionRepository';
import {
  incrementUnreadCount,
  updateLastMessagePreview,
  getContactByJid,
  upsertContact,
  updateGroupName,
  updateGroupAdminFlag,
  deleteContact,
} from '../database/contactRepository';
import {
  upsertGroupMember,
  removeGroupMember,
  getGroupMember,
  getGroupMembers,
} from '../database/groupMemberRepository';
import { RECEIPTS_NS, CHAT_MARKERS_NS, buildReceivedStanza } from './receiptStanzas';
import { parseAffiliationUsers } from './muclight';
import { firstChildByTagName, firstChildByTagNameNs } from './xmlHelpers';
import { resolveGroupMemberDisplayName } from '../services/identityService';
import { MSG_TYPE, randomJewelType } from '../types/chat';
import type { ChatMessage } from '../types/chat';

/** XEP-0444 Message Reactions. */
const REACTIONS_NS = 'urn:xmpp:reactions:0';
/** XEP-0085 Chat State Notifications. */
const CHAT_STATES_NS = 'http://jabber.org/protocol/chatstates';
const CHAT_STATE_TAGS = ['composing', 'paused', 'active', 'inactive', 'gone'];
/** mod_muc_light room-roster/rename notifications — see ChatServerConf/CLAUDE.md. */
const MUCLIGHT_AFFILIATIONS_NS = 'urn:xmpp:muclight:0#affiliations';
const MUCLIGHT_CONFIGURATION_NS = 'urn:xmpp:muclight:0#configuration';

export interface StropheEventCallbacks {
  onMessageStored?: (message: ChatMessage) => void | Promise<void>;
  onReactionsChanged?: (chatRoomJid: string, senderMsgId: string) => void;
  onTypingChanged?: (chatRoomJid: string, isTyping: boolean) => void;
  onGroupRosterChanged?: (groupJid: string) => void;
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
      handleMessageStanza(stanza, connection, myJid, callbacks).catch((err) => {
        if (__DEV__) console.log('[handleMessageStanza] threw', err);
      });
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

  if (isGroupMsg) {
    const stanzaId = stanza.getAttribute('id');
    const affiliationsX = firstChildByTagNameNs(stanza, 'x', MUCLIGHT_AFFILIATIONS_NS);
    if (affiliationsX) {
      await handleGroupAffiliationsNotification(chatRoomJid, affiliationsX, myJid, stanzaId, callbacks);
      return;
    }
    const configurationX = firstChildByTagNameNs(stanza, 'x', MUCLIGHT_CONFIGURATION_NS);
    if (configurationX) {
      await handleGroupConfigurationNotification(chatRoomJid, configurationX, stanzaId, callbacks);
      return;
    }
  }

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
    if (id) await handleReceiptAck(id, from, myJid, 'delivered', callbacks);
    return;
  }

  const displayedElem = firstChildByTagNameNs(stanza, 'displayed', CHAT_MARKERS_NS);
  if (displayedElem) {
    const id = displayedElem.getAttribute('id');
    if (id) await handleReceiptAck(id, from, myJid, 'read', callbacks);
    return;
  }

  const bodyElem = firstChildByTagName(stanza, 'body');
  const msgText = bodyElem?.textContent ?? null;
  if (!msgText) return; // no body, no reaction/receipt/marker: e.g. a bare chat-state notification — nothing to persist

  const senderMsgId = stanza.getAttribute('id') ?? `${chatRoomJid}-${Date.now()}`;

  // A group room reflects every message to *all* occupants, including the
  // sender (unlike 1-1, where the sender never gets their own message back).
  // The reflection's `creatorJid` (the full room/<sender> JID) never matches
  // our own outgoing row's CREATOR_JID (our bare JID) — so without this
  // check, it would fail the dedup lookup below and insert as a duplicate
  // incoming copy of our own message. Mirrors handleSelfEcho's 1-1 concept.
  if (isGroupMsg) {
    const ownRow = await getMessageBySenderMsgId(chatRoomJid, myJid, senderMsgId);
    if (ownRow) {
      await markSubmitted(ownRow._ID, Date.now());
      const updated = await getMessageBySenderMsgId(chatRoomJid, myJid, senderMsgId);
      if (updated) await callbacks.onMessageStored?.(updated);
      return;
    }
  }

  // Dedup on (SENDER_MSG_ID, CHAT_ROOM_JID, CREATOR_JID) — the same triple as
  // ChatMessage's UNIQUE constraint. Checked explicitly here so a redelivered
  // stanza short-circuits before even attempting the insert; the table's own
  // constraint (insertIncomingMessage uses INSERT OR IGNORE) is the backstop
  // in case two stanzas race this check concurrently.
  const existing = await getMessageBySenderMsgId(chatRoomJid, creatorJid, senderMsgId);
  if (existing) return;

  // `msgtype` — a top-level attribute this app sends explicitly on every
  // message (see syncService.ts), not inferred from whether a <media/>
  // element happens to be present. Falls back to TEXT only defensively
  // (a stanza from something other than this app's own send path).
  const msgTypeAttr = stanza.getAttribute('msgtype');
  const msgType = msgTypeAttr !== null ? Number(msgTypeAttr) : MSG_TYPE.TEXT;

  // Bare (non-namespaced) <media/> — confirmed wire format from a real
  // prior-working implementation, not a registered XEP. Absent on plain
  // text messages.
  const mediaElem = firstChildByTagName(stanza, 'media');
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
    JEWEL_TYPE: creatorJid === myJid ? null : randomJewelType(),
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

  // Send a delivery receipt back unconditionally, matching this server's
  // own unconditional-receipt behavior (no <request/> needed on either
  // side). Sent before onMessageStored (which may itself send a
  // <displayed/> marker if the room is active) so <received/> always goes
  // out ahead of <displayed/>. Group messages are receipted directly to the
  // real sender (the resource embedded in `from` — MUC-Light has no
  // anonymity, see the group-receipts plan), not broadcast to the room.
  const receiptTo = isGroupMsg ? Strophe.getResourceFromJid(from) : from;
  if (receiptTo && connection.connected) {
    connection.send(buildReceivedStanza(receiptTo, senderMsgId).tree());
  }

  const stored = await getMessageBySenderMsgId(chatRoomJid, creatorJid, senderMsgId);
  if (stored) await callbacks.onMessageStored?.(stored);
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
 * Handles an inbound <received/>/<displayed/> ack for something *we* sent.
 * `id` is always the referenced row's own `_ID` (see insertOutgoingMessage's
 * doc comment), so it's globally unique on its own — a direct PK lookup,
 * not `chatRoomJid`, is what disambiguates it. That matters specifically for
 * a *group* ack: it arrives as a direct unicast (`from` = the acking
 * member's own bare JID, `type='chat'`, not routed through the room), so the
 * `chatRoomJid` computed earlier in handleMessageStanza (from `from`) would
 * be the acker's JID, not the group — meaningless here.
 */
async function handleReceiptAck(
  id: string,
  from: string,
  myJid: string,
  kind: 'delivered' | 'read',
  callbacks: StropheEventCallbacks,
): Promise<void> {
  const numericId = Number(id);
  if (!Number.isFinite(numericId)) return;

  const row = await getMessageById(numericId);
  if (!row || row.CREATOR_JID !== myJid) return; // not found / not ours — ignore defensively

  if (!row.IS_GROUP_MSG) {
    if (kind === 'delivered') await markDelivered(row._ID, Date.now());
    else await markRead(row._ID, Date.now());
  } else if (row.CHAT_ROOM_JID && row.SENDER_MSG_ID) {
    const ackerJid = Strophe.getBareJidFromJid(from);
    if (ackerJid) {
      await upsertReceipt(row.CHAT_ROOM_JID, row.SENDER_MSG_ID, ackerJid, kind, Date.now());
      await reconcileGroupReceiptAggregate(row, kind);
    }
  }

  const updated = await getMessageById(numericId);
  if (updated) await callbacks.onMessageStored?.(updated);
}

/**
 * A group message's single ChatMessage.IS_DELIVERED/IS_READ flag only
 * flips once every *other current* member has acked (per-member acks live
 * in MessageReceipt) — someone who's since left the group is correctly
 * excluded rather than blocking the aggregate forever, since getGroupMembers
 * reflects the live roster, not a historical snapshot.
 */
async function reconcileGroupReceiptAggregate(
  message: ChatMessage,
  kind: 'delivered' | 'read',
): Promise<void> {
  if (!message.CHAT_ROOM_JID || !message.SENDER_MSG_ID) return;
  const members = await getGroupMembers(message.CHAT_ROOM_JID);
  const otherMemberJids = members
    .map((m) => m.MEMBER_JID)
    .filter((jid): jid is string => !!jid && jid !== message.CREATOR_JID);
  if (otherMemberJids.length === 0) return;

  const receipts = await getReceipts(message.CHAT_ROOM_JID, message.SENDER_MSG_ID);
  const ackedBy = new Set(
    receipts.filter((r) => (kind === 'delivered' ? r.IS_DELIVERED : r.IS_READ)).map((r) => r.MEMBER_JID),
  );
  const allAcked = otherMemberJids.every((jid) => ackedBy.has(jid));
  if (!allAcked) return;

  if (kind === 'delivered' && !message.IS_DELIVERED) await markDelivered(message._ID, Date.now());
  if (kind === 'read' && !message.IS_READ) await markRead(message._ID, Date.now());
}

/**
 * mod_muc_light sends this same notification shape for create, invite,
 * kick, promote, and destroy — it's the one mechanism covering all of them
 * (see ChatServerConf/CLAUDE.md). Lists every affected
 * `<user affiliation='member'|'owner'|'none'>jid</user>`; `'none'` for our
 * own JID means we were removed/left/the room was destroyed.
 */
async function handleGroupAffiliationsNotification(
  groupJid: string,
  xEl: Element,
  myJid: string,
  stanzaId: string | null,
  callbacks: StropheEventCallbacks,
): Promise<void> {
  const users = parseAffiliationUsers(xEl);
  const myEntry = users.find((user) => user.jid.toLowerCase() === myJid.toLowerCase());

  // Snapshot affiliations as they stood *before* this notification, so the
  // system-message loop below can diff old -> new (added/removed/promoted/
  // demoted) once the roster mutation below has overwritten them.
  const oldAffiliations = new Map<string, string | null>();
  for (const user of users) {
    const existing = await getGroupMember(groupJid, user.jid);
    oldAffiliations.set(user.jid, existing?.AFFILIATION ?? null);
  }

  for (const user of users) {
    if (user.affiliation === 'none') {
      await removeGroupMember(groupJid, user.jid);
    } else {
      await upsertGroupMember(groupJid, user.jid, user.affiliation);
    }
  }

  if (myEntry?.affiliation === 'none') {
    await deleteContact(groupJid);
    callbacks.onGroupRosterChanged?.(groupJid);
    return;
  }

  const existingContact = await getContactByJid(groupJid);
  const isFirstSeenRoom = !existingContact;
  if (isFirstSeenRoom) {
    // Freshly created (our own reflected create notification) or newly
    // invited into an existing room — either way this device has never seen
    // this room before. CONTACT_NAME is left null here; chatService's
    // onGroupRosterChanged wiring fills it in via a #configuration get-IQ
    // (or the creator's own explicit upsertContact in chatService.createGroup
    // wins the race and this is a harmless no-op — last write, same value).
    await upsertContact({
      JEWELCHAT_ID: null,
      JID: groupJid,
      CONTACT_NUMBER: null,
      CONTACT_NAME: null,
      PHONEBOOK_CONTACT_NAME: null,
      IS_GROUP: 1,
      STATUS_MSG: null,
      IS_REGIS: 1,
      IS_GROUP_ADMIN: myEntry?.affiliation === 'owner' ? 1 : 0,
      IS_INVITED: 0,
      IS_BLOCKED: 0,
      IS_PHONEBOOK_CONTACT: 0,
      LAST_MSG_CREATED_TIME: null,
      MSG_TYPE: null,
      MSG_TEXT: null,
      SMALL_IMAGE: null,
      IMAGE_PATH: null,
    });
  } else if (myEntry) {
    // Contact already existed: this notification is a live promote/demote of
    // us within a room we're already in, not a first-seen upsert — keep the
    // mirrored flag in sync with the same affiliation check.
    await updateGroupAdminFlag(groupJid, myEntry.affiliation === 'owner');
  }

  await recordAffiliationSystemMessages(groupJid, users, oldAffiliations, isFirstSeenRoom, stanzaId);

  callbacks.onGroupRosterChanged?.(groupJid);
}

/**
 * Composes and persists the human-readable system-event row(s) for one
 * affiliations notification. No actor identity is ever available from this
 * stanza (only the affected user + their new affiliation), so every line is
 * necessarily passive ("X was added", never "Alice added X"). The whole
 * initial member list arrives in a single notification when a room is
 * created, so that case collapses to one "Group created" line instead of one
 * line per invitee.
 */
async function recordAffiliationSystemMessages(
  groupJid: string,
  users: { jid: string; affiliation: string }[],
  oldAffiliations: Map<string, string | null>,
  isFirstSeenRoom: boolean,
  stanzaId: string | null,
): Promise<void> {
  const now = Date.now();

  if (isFirstSeenRoom) {
    await insertSystemMessage({
      chatRoomJid: groupJid,
      senderMsgId: `sys-created-${stanzaId ?? now}`,
      text: 'Group created',
      createdTime: now,
    });
    return;
  }

  for (const user of users) {
    const oldAffiliation = oldAffiliations.get(user.jid) ?? null;
    const newAffiliation = user.affiliation;
    if (oldAffiliation === newAffiliation) continue; // redundant re-notification of unchanged state

    let text: string | null = null;
    if (oldAffiliation === null && newAffiliation !== 'none') {
      text = `${await resolveDisplayName(user.jid)} was added to the group`;
    } else if (oldAffiliation !== null && newAffiliation === 'none') {
      text = `${await resolveDisplayName(user.jid)} was removed from the group`;
    } else if (oldAffiliation === 'member' && newAffiliation === 'owner') {
      text = `${await resolveDisplayName(user.jid)} was promoted to owner`;
    } else if (oldAffiliation === 'owner' && newAffiliation === 'member') {
      text = `${await resolveDisplayName(user.jid)} was demoted to member`;
    }
    if (!text) continue;

    await insertSystemMessage({
      chatRoomJid: groupJid,
      senderMsgId: `sys-${stanzaId ?? now}-${user.jid}`,
      text,
      createdTime: now,
    });
  }
}

/**
 * jid -> display name for system-message text, preferring a local Contact
 * match (fast, no network) and otherwise falling through to the
 * game-server-backed resolver — never the raw JID. `chatserver/*` calling
 * into `services/identityService.ts` is a deliberate, pragmatic exception to
 * the screens-only layering rule in CLAUDE.md: this file already reaches
 * directly into `database/*Repository` throughout, so it isn't a "pure
 * protocol" file, and deferring resolution through the existing
 * StropheEventCallbacks indirection would meaningfully complicate system-
 * message composition for no real benefit. No import cycle —
 * identityService.ts doesn't import back into chatserver/* or chatService.ts.
 */
async function resolveDisplayName(jid: string): Promise<string> {
  const contact = await getContactByJid(jid);
  if (contact?.CONTACT_NAME) return contact.CONTACT_NAME;
  if (contact?.PHONEBOOK_CONTACT_NAME) return contact.PHONEBOOK_CONTACT_NAME;
  return resolveGroupMemberDisplayName(jid);
}

/** Rename notification — fired alongside a `set` `#configuration` IQ succeeding. */
async function handleGroupConfigurationNotification(
  groupJid: string,
  xEl: Element,
  stanzaId: string | null,
  callbacks: StropheEventCallbacks,
): Promise<void> {
  const roomname = firstChildByTagName(xEl, 'roomname')?.textContent;
  if (!roomname) return;

  await updateGroupName(groupJid, roomname);
  const now = Date.now();
  await insertSystemMessage({
    chatRoomJid: groupJid,
    senderMsgId: `sys-rename-${stanzaId ?? now}`,
    text: `Group renamed to "${roomname}"`,
    createdTime: now,
  });
  callbacks.onGroupRosterChanged?.(groupJid);
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

export { firstChildByTagName, firstChildByTagNameNs } from './xmlHelpers';
