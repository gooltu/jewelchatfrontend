import { $msg } from 'react-native-strophe';
import { getConnection, isConnected, onConnectionStatusChange } from '../chatserver/stropheClient';
import { withMediaElement, withReplyElement, withActiveChatState } from '../chatserver/receiptStanzas';
import {
  getPendingOutgoingMessages,
  getMessageById,
  markError,
  markSubmitted,
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

/**
 * Set once by chatService.ts (same `set*Provider` callback-registration
 * pattern as gameserver/client.ts's setAuthTokenProvider — avoids a
 * circular import, since chatService.ts already imports from this module).
 * Lets attemptSend tell the UI layer to re-read a room's messages right
 * after markSubmitted below, the same way chatService's own notifyRoom
 * calls do after every other DB write.
 */
let submittedListener: ((chatRoomJid: string) => void) | null = null;

export function setSubmittedListener(listener: (chatRoomJid: string) => void): void {
  submittedListener = listener;
}

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
    // `msgtype`/`forwarded` are top-level attributes (not the XMPP `type`
    // attribute, which is already 'chat'/'groupchat' routing) carrying this
    // app's own MSG_TYPE/IS_FORWARD explicitly, for both 1-1 and group — not
    // a registered XEP, same informal-extension convention as the bare
    // <media/> element below. Without `forwarded` making the trip, only the
    // sender's own local copy would ever render the "Forwarded" label — the
    // recipient's insertIncomingMessage has no other way to know.
    let stanza = $msg({
      to: message.CHAT_ROOM_JID,
      type: message.IS_GROUP_MSG ? 'groupchat' : 'chat',
      id: message.SENDER_MSG_ID,
      msgtype: String(message.MSG_TYPE ?? MSG_TYPE.TEXT),
      ...(message.IS_FORWARD ? { forwarded: '1' } : {}),
    }).c('body', {}).t(message.MSG_TEXT ?? '');

    if (
      message.MSG_TYPE === MSG_TYPE.STICKER ||
      message.MSG_TYPE === MSG_TYPE.GIF ||
      message.MSG_TYPE === MSG_TYPE.IMAGE ||
      message.MSG_TYPE === MSG_TYPE.VIDEO ||
      message.MSG_TYPE === MSG_TYPE.VOICE
    ) {
      stanza = withMediaElement(stanza, {
        msgType: message.MSG_TYPE,
        link: message.MEDIA_CLOUD ?? '',
        thumbnail: message.MEDIA_CLOUD_THUMBNAIL,
        duration: message.MSG_TYPE === MSG_TYPE.VOICE ? message.MEDIA_DURATION_MS : null,
      });
    }

    if (message.IS_REPLY && message.REPLY_PARENT) {
      // REPLY_PARENT is this device's own local _ID — meaningless to the
      // recipient. Resolve to the parent's wire-stable identity (its own
      // SENDER_MSG_ID + CREATOR_JID, the same tuple getMessageBySenderMsgId
      // dedups on) before putting anything on the wire. If the parent was
      // since deleted-for-me, just send the reply with no quote attached
      // rather than failing the send.
      const parent = await getMessageById(message.REPLY_PARENT);
      if (parent?.SENDER_MSG_ID && parent.CREATOR_JID) {
        stanza = withReplyElement(stanza, { id: parent.SENDER_MSG_ID, creator: parent.CREATOR_JID });
      }
    }

    stanza = withActiveChatState(stanza);

    connection.send(stanza.tree());

    // A successful handoff to a connected transport is the "sent" signal
    // for a 1-1 chat — confirmed (see stropheEvents.ts's group-reflection
    // comment) that this server never echoes a 1-1 `type="chat"` message
    // back to its own sender, so waiting on a self-echo there meant
    // IS_SUBMITTED could never flip and the bubble stayed on the pending
    // clock forever. Group messages get this immediately too rather than
    // waiting on MUC-Light's room reflection (stropheEvents.ts's `ownRow`
    // branch) — harmless if that reflection arrives afterward, since
    // markSubmitted is idempotent.
    await markSubmitted(message._ID, Date.now());
    if (message.CHAT_ROOM_JID) submittedListener?.(message.CHAT_ROOM_JID);
  } catch (err) {
    if (__DEV__) console.log('[attemptSend] threw', err);
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
