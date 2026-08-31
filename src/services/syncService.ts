import { $msg } from 'react-native-strophe';
import { getConnection, onConnectionStatusChange } from '../chatserver/stropheClient';
import {
  getPendingOutgoingMessages,
  markSubmitted,
  markError,
} from '../database/messageRepository';
import type { ChatMessage } from '../types/chat';

/**
 * Offline send queue: syncService is the only place that turns a
 * SQLite-pending (IS_SUBMITTED = 0) ChatMessage row into an actual XMPP
 * stanza, with retry-on-reconnect and terminal-failure handling
 * (IS_ERROR = 1 after retries are exhausted).
 */

const MAX_ATTEMPTS = 5;
const BASE_RETRY_DELAY_MS = 2_000;
const MAX_RETRY_DELAY_MS = 20_000;

interface RetryState {
  attempts: number;
  timer: ReturnType<typeof setTimeout> | null;
}

const retryStateById = new Map<number, RetryState>();
let flushListenerRegistered = false;

function ensureFlushOnReconnect(): void {
  if (flushListenerRegistered) return;
  flushListenerRegistered = true;
  onConnectionStatusChange((status) => {
    if (status === 'connected') {
      void flushPendingMessages();
    }
  });
}

/** Called by chatService right after an outgoing message is written to SQLite. */
export function enqueueOutgoingMessage(message: ChatMessage): void {
  ensureFlushOnReconnect();
  void attemptSend(message);
}

/** Called on reconnect to resume anything still sitting at IS_SUBMITTED = 0. */
export async function flushPendingMessages(): Promise<void> {
  const pending = await getPendingOutgoingMessages();
  for (const message of pending) {
    void attemptSend(message);
  }
}

async function attemptSend(message: ChatMessage): Promise<void> {
  const connection = getConnection();
  if (!connection || !message.CHAT_ROOM_JID || !message.SENDER_MSG_ID) {
    scheduleRetry(message);
    return;
  }

  try {
    const stanza = $msg({
      to: message.CHAT_ROOM_JID,
      type: message.IS_GROUP_MSG ? 'groupchat' : 'chat',
      id: message.SENDER_MSG_ID,
    }).c('body', {}, message.MSG_TEXT ?? '');

    connection.send(stanza.tree());

    // Fire-and-forget at the XMPP layer: `send()` doesn't ack. Marking
    // IS_SUBMITTED here means "handed to the connection", not "delivered" —
    // that distinction is IS_DELIVERED, set later by a receipt stanza
    // handled in stropheEvents/chatService.
    await markSubmitted(message._ID, Date.now());
    retryStateById.delete(message._ID);
  } catch {
    scheduleRetry(message);
  }
}

function scheduleRetry(message: ChatMessage): void {
  const state = retryStateById.get(message._ID) ?? { attempts: 0, timer: null };
  if (state.timer) return; // a retry is already pending for this message

  if (state.attempts >= MAX_ATTEMPTS) {
    retryStateById.delete(message._ID);
    void markError(message._ID, true);
    return;
  }

  const delay = Math.min(BASE_RETRY_DELAY_MS * 2 ** state.attempts, MAX_RETRY_DELAY_MS);
  state.attempts += 1;
  state.timer = setTimeout(() => {
    state.timer = null;
    void attemptSend(message);
  }, delay);
  retryStateById.set(message._ID, state);
}
