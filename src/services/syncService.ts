import { $msg } from 'react-native-strophe';
import { getConnection, isConnected, onConnectionStatusChange } from '../chatserver/stropheClient';
import { withMediaElement, withActiveChatState } from '../chatserver/receiptStanzas';
import {
  getPendingOutgoingMessages,
  markError,
} from '../database/messageRepository';
import { MSG_TYPE, type ChatMessage } from '../types/chat';

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
  if (!connection || !isConnected() || !message.CHAT_ROOM_JID || !message.SENDER_MSG_ID) {
    scheduleRetry(message);
    return;
  }

  try {
    let stanza = $msg({
      to: message.CHAT_ROOM_JID,
      type: message.IS_GROUP_MSG ? 'groupchat' : 'chat',
      id: message.SENDER_MSG_ID,
    }).c('body', {}, message.MSG_TEXT ?? '');

    if (message.MSG_TYPE === MSG_TYPE.STICKER || message.MSG_TYPE === MSG_TYPE.GIF) {
      stanza = withMediaElement(stanza, {
        msgType: message.MSG_TYPE,
        link: message.MEDIA_CLOUD ?? '',
        thumbnail: message.MEDIA_CLOUD_THUMBNAIL,
      });
    }

    stanza = withActiveChatState(stanza);

    connection.send(stanza.tree());

    // No markSubmitted here — submission is only ever confirmed by the
    // server's self-echo (handled in stropheEvents.ts), not by send() alone
    // not throwing. There's deliberately no timeout fallback either: a
    // message without an echo just stays IS_SUBMITTED=0 until the next
    // foreground-resume/reconnect calls flushPendingMessages() and this
    // same attemptSend runs again — harmless, it's a .send() of the same
    // stanza id, not a new message.
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
