import { $msg, $pres, Strophe } from 'react-native-strophe';
import type { StropheConnection } from 'react-native-strophe';
import {
  connect as stropheConnect,
  disconnect as stropheDisconnect,
  getConnection,
  isConnected,
  onConnectionStatusChange,
  type ConnectionStatus,
} from '../chatserver/stropheClient';
import type { PickerMediaItem } from '@components/design-system';
import { registerStanzaHandlers } from '../chatserver/stropheEvents';
import { buildDisplayedStanza, buildReceivedStanza } from '../chatserver/receiptStanzas';
import {
  fetchArchivedMessages,
  fetchArchivedRoomMessages,
  type ArchivedMessage,
} from '../chatserver/messageArchive';
import {
  createGroupRoom,
  renameGroupRoom,
  setGroupAffiliation,
  fetchGroupAffiliations,
  fetchGroupConfig,
  destroyGroupRoom,
  fetchGroupRooms,
} from '../chatserver/muclight';
import {
  insertOutgoingMessage,
  insertIncomingMessage,
  markAllReadInRoom,
  markSubmitted,
  markJewelPicked,
  getMessageBySenderMsgId,
  getUnreadMessages,
} from '../database/messageRepository';
import {
  resetUnreadCount,
  updateLastMessagePreview,
  upsertContact,
  incrementUnreadCount,
  getContactByJid,
  getGroupContacts,
  updateGroupName,
  updateGroupAdminFlag,
  deleteContact,
} from '../database/contactRepository';
import { replaceGroupMembers } from '../database/groupMemberRepository';
import { enqueueOutgoingMessage, flushPendingMessages } from './syncService';
import * as timeSyncService from './timeSyncService';
import { store } from '../store';
import {
  activeConversationSet,
  connectionStatusChanged,
  typingReceived,
  type XmppConnectionStatus,
} from '../store/slices/chatSlice';
import { jewelPicked } from '../store/slices/gameSlice';
import { MSG_TYPE, randomJewelType, type ChatMessage } from '../types/chat';
import { MAX_JEWEL_CAPACITY, sumPickableJewels } from '../types/game';

/**
 * Orchestration layer between screens and gameserver/chatserver/db/redux.
 * Screens never import chatserver, database/*Repository, or gameserver
 * directly — they call this service, which decides what SQLite write,
 * what stanza, and what Redux dispatch a given user action implies.
 */

const CHAT_STATES_NS = 'http://jabber.org/protocol/chatstates';

type RoomListener = () => void;
const roomListeners = new Map<string, Set<RoomListener>>();
const allRoomsListeners = new Set<RoomListener>();

/** Lets useMessages re-query SQLite when a specific room's rows change. */
export function subscribeToRoom(jid: string, listener: RoomListener): () => void {
  if (!roomListeners.has(jid)) roomListeners.set(jid, new Set());
  roomListeners.get(jid)?.add(listener);
  return () => {
    roomListeners.get(jid)?.delete(listener);
  };
}

/** Lets useConversations re-query the Contact table when any room changes. */
export function subscribeToAllRooms(listener: RoomListener): () => void {
  allRoomsListeners.add(listener);
  return () => {
    allRoomsListeners.delete(listener);
  };
}

function notifyRoom(jid: string): void {
  roomListeners.get(jid)?.forEach((listener) => listener());
  allRoomsListeners.forEach((listener) => listener());
}

// Maps stropheClient's transport-level status to the coarser status the UI
// cares about. connfail/authfail/conntimeout/error/disconnected all collapse
// to 'reconnecting' because stropheClient auto-retries all of them unless
// disconnect() was called explicitly (handled separately, below).
const STATUS_MAP: Record<ConnectionStatus, XmppConnectionStatus> = {
  connecting: 'connecting',
  authenticating: 'connecting',
  attached: 'connecting',
  connected: 'connected',
  disconnecting: 'disconnected',
  disconnected: 'reconnecting',
  connfail: 'reconnecting',
  authfail: 'reconnecting',
  conntimeout: 'reconnecting',
  error: 'reconnecting',
  redirect: 'connecting',
};

let handlersRegisteredFor: StropheConnection | null = null;
let statusUnsubscribe: (() => void) | null = null;

function ensureStanzaHandlersRegistered(myJid: string): void {
  const connection = getConnection();
  if (!connection || connection === handlersRegisteredFor) return;

  registerStanzaHandlers(connection, myJid, {
    onMessageStored: (message) => handleIncomingMessageStored(message),
    onReactionsChanged: (chatRoomJid) => notifyRoom(chatRoomJid),
    onTypingChanged: (chatRoomJid, isTyping) => {
      store.dispatch(typingReceived({ jid: chatRoomJid, isTyping }));
    },
    onGroupRosterChanged: (groupJid) => {
      void resolveMissingGroupName(groupJid);
      notifyRoom(groupJid);
    },
  });
  handlersRegisteredFor = connection;
}

/**
 * A group `Contact` row created from a live `#affiliations` notification
 * (stropheEvents.ts) doesn't know the room's name yet — filled in here via a
 * best-effort `#configuration` get-IQ. No-ops if the name is already set
 * (e.g. `createGroup` below already wrote the correct one, or a previous
 * call to this same function already resolved it).
 */
async function resolveMissingGroupName(groupJid: string): Promise<void> {
  const contact = await getContactByJid(groupJid);
  if (!contact || contact.CONTACT_NAME) return;
  try {
    const { roomname } = await fetchGroupConfig(groupJid);
    if (roomname) {
      await updateGroupName(groupJid, roomname);
      notifyRoom(groupJid);
    }
  } catch (error) {
    if (__DEV__) console.log('[chatService] resolveMissingGroupName failed:', error);
  }
}

async function handleIncomingMessageStored(message: ChatMessage): Promise<void> {
  if (!message.CHAT_ROOM_JID) return;
  notifyRoom(message.CHAT_ROOM_JID);

  // Auto-mark-read + send a <displayed/> receipt if the conversation is
  // currently open on screen — without this, a message arriving while the
  // room is already open only gets receipted the next time the screen is
  // re-entered (setActiveConversation's own markConversationRead call).
  if (store.getState().chat.activeConversationJid === message.CHAT_ROOM_JID) {
    await markConversationRead(message.CHAT_ROOM_JID);
  }
}

/**
 * Connects to the chat server. `password` is the game server refresh token
 * — the chat server authenticates SASL against the refresh token, not the
 * short-lived access token (see authService's completeAuth/restoreSession).
 */
export function connect(jid: string, password: string): void {
  if (!statusUnsubscribe) {
    statusUnsubscribe = onConnectionStatusChange((status) => {
      store.dispatch(connectionStatusChanged(STATUS_MAP[status]));
      if (status === 'connected') {
        ensureStanzaHandlersRegistered(jid);
        broadcastPresence();
        void timeSyncService.syncServerTimeDelta();
        void syncGroupRooms();
      }
    });
  }
  stropheConnect(jid, password);
}

/** Broadcasts available presence — called once per successful (re)connect. */
function broadcastPresence(): void {
  const connection = getConnection();
  if (!connection || !isConnected()) return;
  connection.send($pres().tree());
}

/**
 * Foreground resync: reconnects only if the connection isn't already
 * 'connected' — useAppState.ts's chatSessionReset resets connectionStatus
 * to 'disconnected' on every backgrounding, so this always reconnects after
 * a real background/foreground cycle, not just after a full disconnect.
 * broadcastPresence() double-checks the real Strophe connection object
 * itself (see isConnected()) before sending, since Redux's connectionStatus
 * is a cache that can still lag the actual socket state. Best-effort:
 * errors are logged (dev only) and swallowed so a failed resync never
 * blocks the UI.
 */
export async function resyncAfterForeground(jid: string, password: string): Promise<void> {
  try {
    if (store.getState().chat.connectionStatus !== 'connected') {
      await connectAndWait(jid, password);
    } else {
      broadcastPresence();
    }
    await timeSyncService.syncServerTimeDelta();
    // Explicit, direct resend of anything still IS_SUBMITTED=0 — the only
    // recovery path for a message whose self-echo was missed (no timeout
    // fallback, see syncService.ts's attemptSend). Not relied upon solely
    // via the indirect onConnectionStatusChange→flushPendingMessages chain,
    // since that only fires on an actual status transition to 'connected'.
    await flushPendingMessages();
    await downloadHistorySinceBackground();
    await syncGroupRooms();
  } catch (error) {
    if (__DEV__) {
      console.log('[chatService] resyncAfterForeground failed:', error);
    }
  }
}

/**
 * Reconciles local group `Contact` rows against the server's `disco#items`
 * room list — the source of truth for "which rooms is this account actually
 * still in." Catches renames/removals/destructions that happened while this
 * device was offline (no live notification to replay), mirroring
 * ChatServerConf/xmpp/app.js's own `refreshMucRooms`. Best-effort, matching
 * every other step in resyncAfterForeground/connect's status-change handler.
 */
async function syncGroupRooms(): Promise<void> {
  try {
    const serverRooms = await fetchGroupRooms();
    const serverJids = new Set(serverRooms.map((room) => room.jid));

    const localGroups = await getGroupContacts();
    const localJids = new Set(localGroups.map((contact) => contact.JID));

    for (const room of serverRooms) {
      if (!localJids.has(room.jid)) {
        await upsertContact({
          JEWELCHAT_ID: null,
          JID: room.jid,
          CONTACT_NUMBER: null,
          CONTACT_NAME: room.name,
          PHONEBOOK_CONTACT_NAME: null,
          IS_GROUP: 1,
          STATUS_MSG: null,
          IS_REGIS: 1,
          IS_GROUP_ADMIN: null,
          IS_INVITED: 0,
          IS_BLOCKED: 0,
          IS_PHONEBOOK_CONTACT: 0,
          LAST_MSG_CREATED_TIME: null,
          MSG_TYPE: null,
          MSG_TEXT: null,
          SMALL_IMAGE: null,
          IMAGE_PATH: null,
        });
      } else {
        const existing = localGroups.find((contact) => contact.JID === room.jid);
        if (room.name && existing && existing.CONTACT_NAME !== room.name) {
          await updateGroupName(room.jid, room.name);
        }
      }
      notifyRoom(room.jid);
    }

    for (const contact of localGroups) {
      if (contact.JID && !serverJids.has(contact.JID)) {
        await deleteContact(contact.JID);
        notifyRoom(contact.JID);
      }
    }
  } catch (error) {
    if (__DEV__) console.log('[chatService] syncGroupRooms failed:', error);
  }
}

/**
 * Downloads whatever arrived in the account's MAM archive since the last
 * backgrounding (timeSyncService.recordBackgroundChatTime's whole reason for
 * existing) and merges it into local SQLite. No-op if the app has never
 * backgrounded/connected before (startMs null) or there's no session JID.
 * Queries the account's own (1-1) archive plus every known group room's own
 * archive individually — MAM has no single "all my rooms" query, so each
 * local group Contact gets its own `to`-addressed request. One room's query
 * failing (e.g. it was destroyed, or the server rejects a non-occupant) is
 * best-effort and must not block backfill for every other conversation.
 */
async function downloadHistorySinceBackground(): Promise<void> {
  const startMs = await timeSyncService.getBackgroundChatTime();
  const myJid = store.getState().auth.jid;
  if (startMs === null || !myJid) return;

  const archived: ArchivedMessage[] = [];
  await fetchArchivedMessages(startMs, myJid, (message) => archived.push(message));

  const groups = await getGroupContacts();
  for (const group of groups) {
    if (!group.JID) continue;
    try {
      await fetchArchivedRoomMessages(startMs, group.JID, myJid, (message) => archived.push(message));
    } catch (error) {
      if (__DEV__) console.log(`[history] room MAM query failed for ${group.JID}:`, error);
    }
  }

  const touchedRooms = new Set<string>();
  for (const message of archived) {
    if (await persistArchivedMessage(message, myJid)) touchedRooms.add(message.chatRoomJid);
  }
  touchedRooms.forEach((roomJid) => notifyRoom(roomJid));

  if (__DEV__) {
    console.log(`[history] since ${startMs}: ${archived.length} archived message(s) found`);
  }
}

/**
 * Returns true if this call changed local state (newly inserted, or an
 * existing own row got reconciled — see the group self-reflection check
 * below) — false if it was a pure no-op dedup hit.
 */
async function persistArchivedMessage(message: ArchivedMessage, myJid: string): Promise<boolean> {
  // Our own group messages are stored locally under CREATOR_JID = myJid
  // (bare — see sendTextMessage), never under the full room/nickname JID
  // MAM returns them as. Mirrors stropheEvents.ts's live self-reflection
  // check: reconcile against that row instead of falling through to the
  // generic dedup lookup below, which would miss it (different CREATOR_JID)
  // and insert a duplicate copy of a message we already have.
  const isOwnGroupMessage =
    message.isGroupMsg && Strophe.getResourceFromJid(message.creatorJid) === myJid;
  if (isOwnGroupMessage) {
    const ownRow = await getMessageBySenderMsgId(message.chatRoomJid, myJid, message.senderMsgId);
    if (ownRow) {
      if (!ownRow.IS_SUBMITTED) await markSubmitted(ownRow._ID, message.timestampMs);
      return true;
    }
  }

  const existing = await getMessageBySenderMsgId(
    message.chatRoomJid,
    message.creatorJid,
    message.senderMsgId,
  );
  if (existing) return false;

  const isOwnSentMessage = isOwnGroupMessage || message.creatorJid === myJid;
  await insertIncomingMessage({
    IS_GROUP_MSG: message.isGroupMsg ? 1 : 0,
    MSG_TYPE: message.msgType,
    CREATED_DATE: new Date(message.timestampMs).toISOString().slice(0, 10),
    CREATED_TIME: message.timestampMs,
    CHAT_ROOM_JID: message.chatRoomJid,
    CREATOR_JID: message.creatorJid,
    SENDER_NAME: message.senderName,
    SENDER_MSG_ID: message.senderMsgId,
    IS_READ: isOwnSentMessage ? 1 : 0, // your own already-sent message isn't "unread" to you
    TIME_READ: null,
    IS_DELIVERED: 1,
    TIME_DELIVERED: message.timestampMs,
    TIME_CREATED: message.timestampMs,
    IS_ERROR: 0,
    JEWEL_TYPE: isOwnSentMessage ? null : randomJewelType(),
    IS_JEWEL_PICKED: 0,
    MSG_TEXT: message.msgText,
    MEDIA_UPLOADED: 0,
    MEDIA_CLOUD: message.mediaLink,
    MEDIA_CLOUD_THUMBNAIL: message.mediaThumbnail,
    IS_REPLY: 0,
    REPLY_PARENT: null,
    IS_FORWARD: 0,
  });

  if (!isOwnSentMessage) await incrementUnreadCount(message.chatRoomJid);

  // Matches stropheEvents.ts's live receipt behavior — a backfilled peer
  // message hasn't been receipted yet (the live receive path that normally
  // sends this never ran while we were backgrounded), so without this the
  // sender's own device stays stuck showing "sent" forever even though
  // we've now actually pulled the message down. Group messages are receipted
  // directly to the real sender (the resource embedded in creatorJid — see
  // the load-bearing protocol fact in the group-receipts plan), not the room.
  if (!isOwnSentMessage && isConnected()) {
    const receiptTo = message.isGroupMsg
      ? Strophe.getResourceFromJid(message.creatorJid)
      : message.chatRoomJid;
    if (receiptTo) {
      getConnection()?.send(buildReceivedStanza(receiptTo, message.senderMsgId).tree());
    }
  }

  await updateLastMessagePreview(message.chatRoomJid, {
    msgText: message.msgText,
    msgType: message.msgType,
    createdTime: message.timestampMs,
  });
  return true;
}

/** Like connect(), but resolves once status hits 'connected' (or rejects after timeoutMs). */
function connectAndWait(jid: string, password: string, timeoutMs = 15_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error('connectAndWait: timed out waiting for connected status'));
    }, timeoutMs);
    const unsubscribe = onConnectionStatusChange((status) => {
      if (status === 'connected') {
        clearTimeout(timer);
        unsubscribe();
        resolve();
      }
    });
    connect(jid, password);
  });
}

export function disconnect(): void {
  stropheDisconnect();
  store.dispatch(connectionStatusChanged('disconnected'));
}

const WELCOME_CONTACT_JID = '1@jewelchat.net';
const WELCOME_CONTACT_NUMBER = 910000000000;
const WELCOME_CONTACT_NAME = 'Team Jewel Chat';
const WELCOME_MESSAGES = [
  'Welcome to Jewel Chat!',
  'This is your Team Jewel Chat inbox — we\'ll use it to share updates and tips.',
  'You can message your contacts, react to messages, and see when they\'re typing.',
  'Your chats are stored securely on this device.',
  'If you ever need help, just reach out here.',
];

/**
 * Seeds the first-run "Team Jewel Chat" welcome conversation. Idempotent —
 * upsertContact (UNIQUE JID) and insertIncomingMessage (INSERT OR IGNORE on
 * the same SENDER_MSG_IDs every call) make a repeat call from completeAuth a
 * safe no-op, so no separate "already seeded" guard is needed.
 */
export async function seedWelcomeContact(): Promise<void> {
  await upsertContact({
    JEWELCHAT_ID: 1,
    JID: WELCOME_CONTACT_JID,
    CONTACT_NUMBER: WELCOME_CONTACT_NUMBER,
    CONTACT_NAME: WELCOME_CONTACT_NAME,
    PHONEBOOK_CONTACT_NAME: WELCOME_CONTACT_NAME,
    IS_GROUP: 0,
    STATUS_MSG: null,
    IS_REGIS: 1,
    IS_GROUP_ADMIN: null,
    IS_INVITED: 0,
    IS_BLOCKED: 0,
    IS_PHONEBOOK_CONTACT: 0,
    LAST_MSG_CREATED_TIME: null,
    MSG_TYPE: null,
    MSG_TEXT: null,
    SMALL_IMAGE: null,
    IMAGE_PATH: null,
  });

  let lastCreatedTime = Date.now();
  for (let i = 0; i < WELCOME_MESSAGES.length; i += 1) {
    const createdTime = Date.now() + i;
    const text = WELCOME_MESSAGES[i] ?? '';
    // Sequential awaits (not Promise.all): insertIncomingMessage computes
    // SEQUENCE from MAX(SEQUENCE) per call, so this keeps the 5 seed
    // messages in ascending order.
    await insertIncomingMessage({
      IS_GROUP_MSG: 0,
      MSG_TYPE: 0,
      CREATED_DATE: new Date(createdTime).toISOString().slice(0, 10),
      CREATED_TIME: createdTime,
      CHAT_ROOM_JID: WELCOME_CONTACT_JID,
      CREATOR_JID: WELCOME_CONTACT_JID,
      SENDER_NAME: WELCOME_CONTACT_NAME,
      SENDER_MSG_ID: `welcome-seed-${i + 1}`,
      IS_READ: 0,
      TIME_READ: null,
      IS_DELIVERED: 1,
      TIME_DELIVERED: createdTime,
      TIME_CREATED: createdTime,
      IS_ERROR: 0,
      JEWEL_TYPE: 3,
      IS_JEWEL_PICKED: 0,
      MSG_TEXT: text,
      MEDIA_UPLOADED: 0,
      MEDIA_CLOUD: null,
      MEDIA_CLOUD_THUMBNAIL: null,
      IS_REPLY: 0,
      REPLY_PARENT: null,
      IS_FORWARD: 0,
    });
    await incrementUnreadCount(WELCOME_CONTACT_JID);
    lastCreatedTime = createdTime;
  }

  await updateLastMessagePreview(WELCOME_CONTACT_JID, {
    msgText: WELCOME_MESSAGES[WELCOME_MESSAGES.length - 1] ?? null,
    msgType: 0,
    createdTime: lastCreatedTime,
  });
  notifyRoom(WELCOME_CONTACT_JID);
}

export function setActiveConversation(jid: string | null): void {
  store.dispatch(activeConversationSet(jid));
  if (jid) {
    void markConversationRead(jid);
  }
}

/**
 * Marks a room read locally, then sends one <displayed/> marker per
 * distinct sender among what was just marked read — per XEP-0333, one
 * marker implies "displayed, and everything before it too" for that
 * sender's thread, so only the latest per sender needs one. For 1-1 this is
 * always exactly one sender (the peer), matching the prior behavior; a group
 * room can have several, each unicast directly to that member (not the
 * room) — same routing as the delivered receipt.
 */
export async function markConversationRead(chatRoomJid: string): Promise<void> {
  const myJid = store.getState().auth.jid;
  if (!myJid) return;

  const connection = getConnection();
  if (connection && isConnected()) {
    const unread = await getUnreadMessages(chatRoomJid, myJid);
    const latestBySender = new Map<string, ChatMessage>();
    for (const msg of unread) {
      if (!msg.CREATOR_JID || !msg.SENDER_MSG_ID) continue;
      const current = latestBySender.get(msg.CREATOR_JID);
      if (!current || msg.SEQUENCE > current.SEQUENCE) latestBySender.set(msg.CREATOR_JID, msg);
    }
    for (const msg of latestBySender.values()) {
      const to = msg.IS_GROUP_MSG ? Strophe.getResourceFromJid(msg.CREATOR_JID as string) : chatRoomJid;
      if (to && msg.SENDER_MSG_ID) connection.send(buildDisplayedStanza(to, msg.SENDER_MSG_ID).tree());
    }
  }

  await markAllReadInRoom(chatRoomJid, myJid, Date.now());
  await resetUnreadCount(chatRoomJid);
  notifyRoom(chatRoomJid);
}

/**
 * Picks a message's jewel: queues it in Redux's game.pickedJewels (flushed
 * later via authService.flushPickedJewels -> POST /bulkPickJewel) and
 * persists IS_JEWEL_PICKED so it never resurfaces, even across reloads.
 * Re-checks the MAX_JEWEL_CAPACITY cap defensively — the UI (useCanPickJewel)
 * already gates the press, this is just a race-safety backstop.
 */
export async function pickJewel(message: ChatMessage): Promise<void> {
  if (!message.JEWEL_TYPE || !message.CHAT_ROOM_JID) return;
  const game = store.getState().game;
  const totalOwned = sumPickableJewels(game.jewels);
  if (totalOwned + (game.pickedJewels ?? []).length >= MAX_JEWEL_CAPACITY) return;

  store.dispatch(jewelPicked({ type: message.JEWEL_TYPE }));
  await markJewelPicked(message._ID, true);
  notifyRoom(message.CHAT_ROOM_JID);
}

export interface SendTextMessageParams {
  chatRoomJid: string;
  isGroupMsg: boolean;
  text: string;
  senderJid: string;
  senderName: string | null;
  replyParent?: number | null;
}

/**
 * Offline-first send: the message is written to SQLite with
 * IS_SUBMITTED = 0 *before* any network attempt, then handed to
 * syncService, which owns the actual stanza send + retry-on-reconnect.
 */
export async function sendTextMessage(params: SendTextMessageParams): Promise<ChatMessage> {
  const now = Date.now();

  const message = await insertOutgoingMessage({
    IS_GROUP_MSG: params.isGroupMsg ? 1 : 0,
    MSG_TYPE: 0,
    CREATED_DATE: new Date(now).toISOString().slice(0, 10),
    CREATED_TIME: now,
    CHAT_ROOM_JID: params.chatRoomJid,
    CREATOR_JID: params.senderJid,
    SENDER_NAME: params.senderName,
    TIME_CREATED: now,
    JEWEL_TYPE: null,
    IS_JEWEL_PICKED: 0,
    MSG_TEXT: params.text,
    MEDIA_UPLOADED: 0,
    MEDIA_CLOUD: null,
    MEDIA_CLOUD_THUMBNAIL: null,
    IS_REPLY: params.replyParent ? 1 : 0,
    REPLY_PARENT: params.replyParent ?? null,
    IS_FORWARD: 0,
  });

  await updateLastMessagePreview(params.chatRoomJid, {
    msgText: params.text,
    msgType: 0,
    createdTime: now,
  });
  notifyRoom(params.chatRoomJid);

  enqueueOutgoingMessage(message);
  return message;
}

export interface SendMediaMessageParams {
  chatRoomJid: string;
  isGroupMsg: boolean;
  senderJid: string;
  senderName: string | null;
  item: PickerMediaItem;
}

export function sendStickerMessage(params: SendMediaMessageParams): Promise<ChatMessage> {
  return sendMediaMessage(params, MSG_TYPE.STICKER, 'Sticker');
}

export function sendGifMessage(params: SendMediaMessageParams): Promise<ChatMessage> {
  return sendMediaMessage(params, MSG_TYPE.GIF, 'GIF');
}

/**
 * Same offline-first shape as sendTextMessage. MSG_TEXT is a plain
 * placeholder word ('Sticker'/'GIF'), not the media URL — confirmed wire
 * format from a real prior-working implementation; the real URL lives in
 * MEDIA_CLOUD/MEDIA_CLOUD_THUMBNAIL, carried over the wire as a <media/>
 * element by syncService.ts.
 */
async function sendMediaMessage(
  params: SendMediaMessageParams,
  msgType: number,
  placeholderText: string,
): Promise<ChatMessage> {
  const now = Date.now();

  const message = await insertOutgoingMessage({
    IS_GROUP_MSG: params.isGroupMsg ? 1 : 0,
    MSG_TYPE: msgType,
    CREATED_DATE: new Date(now).toISOString().slice(0, 10),
    CREATED_TIME: now,
    CHAT_ROOM_JID: params.chatRoomJid,
    CREATOR_JID: params.senderJid,
    SENDER_NAME: params.senderName,
    TIME_CREATED: now,
    JEWEL_TYPE: null,
    IS_JEWEL_PICKED: 0,
    MSG_TEXT: placeholderText,
    MEDIA_UPLOADED: 0,
    MEDIA_CLOUD: params.item.fullUri,
    MEDIA_CLOUD_THUMBNAIL: params.item.previewUri,
    IS_REPLY: 0,
    REPLY_PARENT: null,
    IS_FORWARD: 0,
  });

  await updateLastMessagePreview(params.chatRoomJid, {
    msgText: placeholderText,
    msgType,
    createdTime: now,
  });
  notifyRoom(params.chatRoomJid);

  enqueueOutgoingMessage(message);
  return message;
}

export function sendTypingIndicator(chatRoomJid: string, isGroupMsg: boolean, isTyping: boolean): void {
  const connection = getConnection();
  if (!connection || !isConnected()) return;

  const stanza = $msg({ to: chatRoomJid, type: isGroupMsg ? 'groupchat' : 'chat' }).c(
    isTyping ? 'composing' : 'paused',
    { xmlns: CHAT_STATES_NS },
  );
  connection.send(stanza.tree());
}

/**
 * Group management: thin wrappers over muclight.ts's protocol calls, each
 * requiring a live connection (like sendTypingIndicator above) — unlike
 * messages, group management has no offline queue; a screen calling one of
 * these while disconnected sees the rejection directly.
 */

export interface CreateGroupParams {
  name: string;
  memberJids: string[];
  myJid: string;
}

/**
 * Creates the room, then persists the authoritative member list from the
 * room-created notification (not a guess) and the room's `Contact` row.
 * stropheEvents.ts's own `onGroupRosterChanged` handling will also see this
 * same notification and upsert a (name-less) `Contact` row independently —
 * harmless overlap, `upsertContact`'s `ON CONFLICT (JID)` just applies the
 * correct name last.
 */
export async function createGroup(params: CreateGroupParams): Promise<{ roomJid: string }> {
  const { roomJid, members } = await createGroupRoom({
    roomName: params.name,
    memberJids: params.memberJids,
  });

  await replaceGroupMembers(
    roomJid,
    members.map((member) => ({ memberJid: member.jid, affiliation: member.affiliation })),
  );
  await upsertContact({
    JEWELCHAT_ID: null,
    JID: roomJid,
    CONTACT_NUMBER: null,
    CONTACT_NAME: params.name,
    PHONEBOOK_CONTACT_NAME: null,
    IS_GROUP: 1,
    STATUS_MSG: null,
    IS_REGIS: 1,
    IS_GROUP_ADMIN: 1,
    IS_INVITED: 0,
    IS_BLOCKED: 0,
    IS_PHONEBOOK_CONTACT: 0,
    LAST_MSG_CREATED_TIME: null,
    MSG_TYPE: null,
    MSG_TEXT: null,
    SMALL_IMAGE: null,
    IMAGE_PATH: null,
  });
  notifyRoom(roomJid);

  return { roomJid };
}

export async function renameGroup(groupJid: string, name: string): Promise<void> {
  await renameGroupRoom(groupJid, name);
  await updateGroupName(groupJid, name);
  notifyRoom(groupJid);
}

export async function inviteMember(groupJid: string, memberJid: string): Promise<void> {
  await setGroupAffiliation(groupJid, memberJid, 'member');
}

export async function promoteMember(groupJid: string, memberJid: string): Promise<void> {
  await setGroupAffiliation(groupJid, memberJid, 'owner');
}

export async function demoteMember(groupJid: string, memberJid: string): Promise<void> {
  await setGroupAffiliation(groupJid, memberJid, 'member');
}

export async function removeMember(groupJid: string, memberJid: string): Promise<void> {
  await setGroupAffiliation(groupJid, memberJid, 'none');
}

/** Self-kick — the mod_muc_light way to leave a room you're a member of. */
export async function leaveGroup(groupJid: string, myJid: string): Promise<void> {
  await setGroupAffiliation(groupJid, myJid, 'none');
}

export async function destroyGroup(groupJid: string): Promise<void> {
  await destroyGroupRoom(groupJid);
}

/** Re-fetches the live roster from the server and replaces the local `GroupMembers` cache — used by GroupInfoScreen on mount. */
export async function refreshGroupMembers(groupJid: string): Promise<void> {
  const members = await fetchGroupAffiliations(groupJid);
  await replaceGroupMembers(
    groupJid,
    members.map((member) => ({ memberJid: member.jid, affiliation: member.affiliation })),
  );
  const myJid = store.getState().auth.jid;
  const myEntry = members.find((member) => member.jid.toLowerCase() === myJid?.toLowerCase());
  if (myEntry) await updateGroupAdminFlag(groupJid, myEntry.affiliation === 'owner');
  notifyRoom(groupJid);
}
