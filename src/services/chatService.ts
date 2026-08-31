import { $msg } from 'react-native-strophe';
import type { StropheConnection } from 'react-native-strophe';
import {
  connect as stropheConnect,
  disconnect as stropheDisconnect,
  getConnection,
  onConnectionStatusChange,
  type ConnectionStatus,
} from '../chatserver/stropheClient';
import { registerStanzaHandlers } from '../chatserver/stropheEvents';
import { insertOutgoingMessage, markAllReadInRoom } from '../database/messageRepository';
import { resetUnreadCount, updateLastMessagePreview } from '../database/contactRepository';
import { enqueueOutgoingMessage } from './syncService';
import { store } from '../store';
import {
  activeConversationSet,
  connectionStatusChanged,
  typingReceived,
  type XmppConnectionStatus,
} from '../store/slices/chatSlice';
import type { ChatMessage } from '../types/chat';

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

function ensureStanzaHandlersRegistered(): void {
  const connection = getConnection();
  if (!connection || connection === handlersRegisteredFor) return;

  registerStanzaHandlers(connection, {
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

/** Connects to the chat server. `password` is the game server access token (see authService). */
export function connect(jid: string, password: string): void {
  if (!statusUnsubscribe) {
    statusUnsubscribe = onConnectionStatusChange((status) => {
      store.dispatch(connectionStatusChanged(STATUS_MAP[status]));
      if (status === 'connected') {
        ensureStanzaHandlersRegistered();
      }
    });
  }
  stropheConnect(jid, password);
}

export function disconnect(): void {
  stropheDisconnect();
  store.dispatch(connectionStatusChanged('disconnected'));
}

export function setActiveConversation(jid: string | null): void {
  store.dispatch(activeConversationSet(jid));
  if (jid) {
    void markConversationRead(jid);
  }
}

export async function markConversationRead(chatRoomJid: string): Promise<void> {
  await markAllReadInRoom(chatRoomJid, Date.now());
  await resetUnreadCount(chatRoomJid);
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

export function sendTypingIndicator(chatRoomJid: string, isGroupMsg: boolean, isTyping: boolean): void {
  const connection = getConnection();
  if (!connection) return;

  const stanza = $msg({ to: chatRoomJid, type: isGroupMsg ? 'groupchat' : 'chat' }).c(
    isTyping ? 'composing' : 'paused',
    { xmlns: CHAT_STATES_NS },
  );
  connection.send(stanza.tree());
}

function generateSenderMsgId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
