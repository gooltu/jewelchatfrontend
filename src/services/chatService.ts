import { $msg, $pres } from 'react-native-strophe';
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
import { buildDisplayedStanza } from '../chatserver/receiptStanzas';
import { fetchArchivedMessages, type ArchivedMessage } from '../chatserver/messageArchive';
import {
  insertOutgoingMessage,
  insertIncomingMessage,
  markAllReadInRoom,
  getMessagesPage,
  getMessageBySenderMsgId,
} from '../database/messageRepository';
import {
  resetUnreadCount,
  updateLastMessagePreview,
  upsertContact,
  incrementUnreadCount,
} from '../database/contactRepository';
import { enqueueOutgoingMessage, flushPendingMessages } from './syncService';
import * as timeSyncService from './timeSyncService';
import { store } from '../store';
import {
  activeConversationSet,
  connectionStatusChanged,
  typingReceived,
  type XmppConnectionStatus,
} from '../store/slices/chatSlice';
import { MSG_TYPE, type ChatMessage } from '../types/chat';

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
  });
  handlersRegisteredFor = connection;
}

async function handleIncomingMessageStored(message: ChatMessage): Promise<void> {
  if (!message.CHAT_ROOM_JID) return;
  notifyRoom(message.CHAT_ROOM_JID);

  // Auto-mark-read if the conversation is currently open on screen.
  if (store.getState().chat.activeConversationJid === message.CHAT_ROOM_JID) {
    await markAllReadInRoom(message.CHAT_ROOM_JID, Date.now());
    await resetUnreadCount(message.CHAT_ROOM_JID);
    notifyRoom(message.CHAT_ROOM_JID);
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
  } catch (error) {
    if (__DEV__) {
      console.log('[chatService] resyncAfterForeground failed:', error);
    }
  }
}

/**
 * Downloads whatever arrived in the account's MAM archive since the last
 * backgrounding (timeSyncService.recordBackgroundChatTime's whole reason for
 * existing) and merges it into local SQLite. No-op if the app has never
 * backgrounded/connected before (startMs null) or there's no session JID.
 */
async function downloadHistorySinceBackground(): Promise<void> {
  const startMs = await timeSyncService.getBackgroundChatTime();
  const myJid = store.getState().auth.jid;
  if (startMs === null || !myJid) return;

  const archived: ArchivedMessage[] = [];
  await fetchArchivedMessages(startMs, myJid, (message) => archived.push(message));

  const touchedRooms = new Set<string>();
  for (const message of archived) {
    if (await persistArchivedMessage(message, myJid)) touchedRooms.add(message.chatRoomJid);
  }
  touchedRooms.forEach((roomJid) => notifyRoom(roomJid));

  if (__DEV__) {
    console.log(`[history] since ${startMs}: ${archived.length} archived message(s) found`);
  }
}

/** Returns true if newly stored (false if already present — dedup via SENDER_MSG_ID/CHAT_ROOM_JID/CREATOR_JID). */
async function persistArchivedMessage(message: ArchivedMessage, myJid: string): Promise<boolean> {
  const existing = await getMessageBySenderMsgId(
    message.chatRoomJid,
    message.creatorJid,
    message.senderMsgId,
  );
  if (existing) return false;

  const isOwnSentMessage = message.creatorJid === myJid;
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
    JEWEL_TYPE: null,
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
 * Marks a room read locally, then sends a single <displayed/> marker for
 * the most recent peer-authored message — per XEP-0333, one marker implies
 * "displayed, and everything before it too," so there's no need to send one
 * per row even though several rows may have just transitioned IS_READ 0→1.
 */
export async function markConversationRead(chatRoomJid: string): Promise<void> {
  await markAllReadInRoom(chatRoomJid, Date.now());
  await resetUnreadCount(chatRoomJid);

  const myJid = store.getState().auth.jid;
  const connection = getConnection();
  if (myJid && connection && isConnected()) {
    const { messages } = await getMessagesPage(chatRoomJid, { limit: 1 });
    const latest = messages[0];
    if (latest && latest.CREATOR_JID && latest.CREATOR_JID !== myJid && latest.SENDER_MSG_ID) {
      connection.send(buildDisplayedStanza(chatRoomJid, latest.SENDER_MSG_ID).tree());
    }
  }

  notifyRoom(chatRoomJid);
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
  const senderMsgId = generateSenderMsgId();

  const message = await insertOutgoingMessage({
    IS_GROUP_MSG: params.isGroupMsg ? 1 : 0,
    MSG_TYPE: 0,
    CREATED_DATE: new Date(now).toISOString().slice(0, 10),
    CREATED_TIME: now,
    CHAT_ROOM_JID: params.chatRoomJid,
    CREATOR_JID: params.senderJid,
    SENDER_NAME: params.senderName,
    SENDER_MSG_ID: senderMsgId,
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
  const senderMsgId = generateSenderMsgId();

  const message = await insertOutgoingMessage({
    IS_GROUP_MSG: params.isGroupMsg ? 1 : 0,
    MSG_TYPE: msgType,
    CREATED_DATE: new Date(now).toISOString().slice(0, 10),
    CREATED_TIME: now,
    CHAT_ROOM_JID: params.chatRoomJid,
    CREATOR_JID: params.senderJid,
    SENDER_NAME: params.senderName,
    SENDER_MSG_ID: senderMsgId,
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

function generateSenderMsgId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
