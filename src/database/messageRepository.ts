import { getDatabase } from './index';
import { MSG_TYPE } from '../types/chat';
import type { ChatMessage, MessageStatus } from '../types/chat';

/**
 * CRUD + paginated reads on ChatMessage. Update methods are split one flag
 * at a time (IS_SUBMITTED / IS_DELIVERED / IS_READ / IS_ERROR) because a
 * single XMPP stanza ack typically only confirms one of them.
 */

export interface MessagePage {
  messages: ChatMessage[];
  /** Pass as `beforeSequence` to fetch the next (older) page; null when exhausted. */
  nextCursor: number | null;
}

/**
 * Cursor-paginated read, newest-first, keyed on (CHAT_ROOM_JID, SEQUENCE) —
 * SEQUENCE is monotonic per room and immune to clock skew, unlike
 * CREATED_TIME. Falls back to CREATED_TIME only for the tie-break.
 */
export async function getMessagesPage(
  chatRoomJid: string,
  options: { beforeSequence?: number; limit?: number } = {},
): Promise<MessagePage> {
  const db = await getDatabase();
  const limit = options.limit ?? 30;

  const rows = options.beforeSequence
    ? await db.getAllAsync<ChatMessage>(
        `SELECT * FROM ChatMessage
         WHERE CHAT_ROOM_JID = ? AND SEQUENCE < ?
         ORDER BY SEQUENCE DESC, CREATED_TIME DESC
         LIMIT ?;`,
        [chatRoomJid, options.beforeSequence, limit],
      )
    : await db.getAllAsync<ChatMessage>(
        `SELECT * FROM ChatMessage
         WHERE CHAT_ROOM_JID = ?
         ORDER BY SEQUENCE DESC, CREATED_TIME DESC
         LIMIT ?;`,
        [chatRoomJid, limit],
      );

  const last = rows[rows.length - 1];
  return {
    messages: rows,
    nextCursor: rows.length === limit && last ? last.SEQUENCE : null,
  };
}

/**
 * Direct PK lookup — used for resolving a receipt's `id`, which for
 * anything this app itself sent is the row's own `_ID` (see
 * insertOutgoingMessage's doc comment), so it's globally unique on its own
 * and doesn't need CHAT_ROOM_JID/CREATOR_JID to disambiguate the way
 * getMessageBySenderMsgId does for incoming messages.
 */
export async function getMessageById(id: number): Promise<ChatMessage | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<ChatMessage>(`SELECT * FROM ChatMessage WHERE _ID = ?;`, [id]);
  return row ?? null;
}

export async function getMessageBySenderMsgId(
  chatRoomJid: string,
  creatorJid: string,
  senderMsgId: string,
): Promise<ChatMessage | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<ChatMessage>(
    `SELECT * FROM ChatMessage
     WHERE CHAT_ROOM_JID = ? AND CREATOR_JID = ? AND SENDER_MSG_ID = ?;`,
    [chatRoomJid, creatorJid, senderMsgId],
  );
  return row ?? null;
}

async function getNextSequence(chatRoomJid: string): Promise<number> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ maxSeq: number | null }>(
    `SELECT MAX(SEQUENCE) as maxSeq FROM ChatMessage WHERE CHAT_ROOM_JID = ?;`,
    [chatRoomJid],
  );
  return (row?.maxSeq ?? 0) + 1;
}

/**
 * Offline-first outgoing insert: written to SQLite immediately with
 * IS_SUBMITTED = 0, before any network attempt. syncService is responsible
 * for sending it and calling markSubmitted/markError afterward.
 *
 * SENDER_MSG_ID is deliberately not caller-supplied: it's set to this row's
 * own _ID once the insert returns it, so the wire-level XMPP message id
 * (syncService sends `id: message.SENDER_MSG_ID`) is this device's local
 * primary key. The receiver echoes that same id back in <received>/
 * <displayed> receipts, and handleSelfEcho/receipt handling in
 * stropheEvents.ts look the row back up by it.
 */
export async function insertOutgoingMessage(
  message: Omit<
    ChatMessage,
    | '_ID'
    | 'SEQUENCE'
    | 'SENDER_MSG_ID'
    | 'IS_SUBMITTED'
    | 'TIME_SUBMITTED'
    | 'IS_DELIVERED'
    | 'TIME_DELIVERED'
    | 'IS_READ'
    | 'TIME_READ'
    | 'IS_ERROR'
  >,
): Promise<ChatMessage> {
  const db = await getDatabase();
  const sequence = await getNextSequence(message.CHAT_ROOM_JID ?? '');

  const result = await db.runAsync(
    `INSERT INTO ChatMessage (
      IS_GROUP_MSG, MSG_TYPE, CREATED_DATE, CREATED_TIME, CHAT_ROOM_JID, CREATOR_JID,
      SENDER_NAME, IS_READ, IS_DELIVERED, IS_SUBMITTED, TIME_CREATED,
      IS_ERROR, JEWEL_TYPE, IS_JEWEL_PICKED, MSG_TEXT, MEDIA_UPLOADED, MEDIA_CLOUD,
      MEDIA_CLOUD_THUMBNAIL, SEQUENCE, IS_REPLY, REPLY_PARENT, IS_FORWARD
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    [
      message.IS_GROUP_MSG,
      message.MSG_TYPE,
      message.CREATED_DATE,
      message.CREATED_TIME,
      message.CHAT_ROOM_JID,
      message.CREATOR_JID,
      message.SENDER_NAME,
      message.TIME_CREATED,
      message.JEWEL_TYPE,
      message.IS_JEWEL_PICKED,
      message.MSG_TEXT,
      message.MEDIA_UPLOADED,
      message.MEDIA_CLOUD,
      message.MEDIA_CLOUD_THUMBNAIL,
      sequence,
      message.IS_REPLY,
      message.REPLY_PARENT,
      message.IS_FORWARD,
    ],
  );

  await db.runAsync(`UPDATE ChatMessage SET SENDER_MSG_ID = ? WHERE _ID = ?;`, [
    String(result.lastInsertRowId),
    result.lastInsertRowId,
  ]);

  const inserted = await db.getFirstAsync<ChatMessage>(
    `SELECT * FROM ChatMessage WHERE _ID = ?;`,
    [result.lastInsertRowId],
  );
  if (!inserted) {
    throw new Error('insertOutgoingMessage: failed to read back inserted row');
  }
  return inserted;
}

/**
 * Inserts an incoming message from the XMPP layer. Relies on ChatMessage's
 * own UNIQUE (SENDER_MSG_ID, CHAT_ROOM_JID, CREATOR_JID) constraint for
 * dedup — a redelivered stanza is a silent no-op via `OR IGNORE`.
 */
export async function insertIncomingMessage(
  message: Omit<ChatMessage, '_ID' | 'SEQUENCE' | 'IS_SUBMITTED' | 'TIME_SUBMITTED'>,
): Promise<void> {
  const db = await getDatabase();
  const sequence = await getNextSequence(message.CHAT_ROOM_JID ?? '');

  await db.runAsync(
    `INSERT OR IGNORE INTO ChatMessage (
      IS_GROUP_MSG, MSG_TYPE, CREATED_DATE, CREATED_TIME, CHAT_ROOM_JID, CREATOR_JID,
      SENDER_NAME, SENDER_MSG_ID, IS_READ, TIME_READ, IS_DELIVERED, TIME_DELIVERED,
      IS_SUBMITTED, TIME_CREATED, IS_ERROR, JEWEL_TYPE, IS_JEWEL_PICKED, MSG_TEXT,
      MEDIA_UPLOADED, MEDIA_CLOUD, MEDIA_CLOUD_THUMBNAIL, SEQUENCE, IS_REPLY,
      REPLY_PARENT, IS_FORWARD
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    [
      message.IS_GROUP_MSG,
      message.MSG_TYPE,
      message.CREATED_DATE,
      message.CREATED_TIME,
      message.CHAT_ROOM_JID,
      message.CREATOR_JID,
      message.SENDER_NAME,
      message.SENDER_MSG_ID,
      message.IS_READ,
      message.TIME_READ,
      message.IS_DELIVERED,
      message.TIME_DELIVERED,
      message.TIME_CREATED,
      message.IS_ERROR,
      message.JEWEL_TYPE,
      message.IS_JEWEL_PICKED,
      message.MSG_TEXT,
      message.MEDIA_UPLOADED,
      message.MEDIA_CLOUD,
      message.MEDIA_CLOUD_THUMBNAIL,
      sequence,
      message.IS_REPLY,
      message.REPLY_PARENT,
      message.IS_FORWARD,
    ],
  );
}

/**
 * Persists a synthetic system-event row (group created/renamed/roster
 * change) into the same table as real messages, so it interleaves
 * chronologically via the normal SEQUENCE ordering — but with no
 * CREATOR_JID/delivery semantics; the UI renders MSG_TEXT via SystemLabel
 * instead of a MessageBubble for MSG_TYPE.SYSTEM rows. Deliberately does not
 * touch Contact.LAST_MSG_CREATED_TIME/unread count — a group only earns its
 * spot in the chat list once an actual message is sent in it.
 */
export async function insertSystemMessage(params: {
  chatRoomJid: string;
  senderMsgId: string;
  text: string;
  createdTime: number;
}): Promise<void> {
  await insertIncomingMessage({
    IS_GROUP_MSG: 1,
    MSG_TYPE: MSG_TYPE.SYSTEM,
    CREATED_DATE: new Date(params.createdTime).toISOString().slice(0, 10),
    CREATED_TIME: params.createdTime,
    CHAT_ROOM_JID: params.chatRoomJid,
    CREATOR_JID: null,
    SENDER_NAME: null,
    SENDER_MSG_ID: params.senderMsgId,
    IS_READ: 1,
    TIME_READ: null,
    IS_DELIVERED: 1,
    TIME_DELIVERED: params.createdTime,
    TIME_CREATED: params.createdTime,
    IS_ERROR: 0,
    JEWEL_TYPE: null,
    IS_JEWEL_PICKED: 0,
    MSG_TEXT: params.text,
    MEDIA_UPLOADED: 0,
    MEDIA_CLOUD: null,
    MEDIA_CLOUD_THUMBNAIL: null,
    IS_REPLY: 0,
    REPLY_PARENT: null,
    IS_FORWARD: 0,
  });
}

export async function markSubmitted(id: number, timeSubmitted: number): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE ChatMessage SET IS_SUBMITTED = 1, TIME_SUBMITTED = ? WHERE _ID = ?;`,
    [timeSubmitted, id],
  );
}

export async function markDelivered(id: number, timeDelivered: number): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE ChatMessage SET IS_DELIVERED = 1, TIME_DELIVERED = ? WHERE _ID = ?;`,
    [timeDelivered, id],
  );
}

export async function markRead(id: number, timeRead: number): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(`UPDATE ChatMessage SET IS_READ = 1, TIME_READ = ? WHERE _ID = ?;`, [
    timeRead,
    id,
  ]);
}

/**
 * Marks the peer's messages in a room as read by us — deliberately excludes
 * CREATOR_JID = myJid, since our own outgoing rows also start at IS_READ = 0
 * and this must never flip to "seen" locally before the peer actually sends
 * a <displayed/> marker for them.
 */
/**
 * Peer-authored messages in a room not yet marked read — used to compose
 * <displayed/> markers before markAllReadInRoom flips them, since a group
 * room can have several distinct senders needing their own unicast marker
 * (unlike 1-1, where there's only ever one).
 */
export async function getUnreadMessages(chatRoomJid: string, myJid: string): Promise<ChatMessage[]> {
  const db = await getDatabase();
  return db.getAllAsync<ChatMessage>(
    `SELECT * FROM ChatMessage WHERE CHAT_ROOM_JID = ? AND IS_READ = 0 AND CREATOR_JID != ?;`,
    [chatRoomJid, myJid],
  );
}

export async function markAllReadInRoom(
  chatRoomJid: string,
  myJid: string,
  timeRead: number,
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE ChatMessage SET IS_READ = 1, TIME_READ = ?
     WHERE CHAT_ROOM_JID = ? AND IS_READ = 0 AND CREATOR_JID != ?;`,
    [timeRead, chatRoomJid, myJid],
  );
}

/** Sets IS_ERROR on terminal send failure, after syncService exhausts retries. */
export async function markError(id: number, isError: boolean): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(`UPDATE ChatMessage SET IS_ERROR = ? WHERE _ID = ?;`, [
    isError ? 1 : 0,
    id,
  ]);
}

/** Set once a message's jewel has been tapped/picked (see chatService.pickJewel) — never reverts. */
export async function markJewelPicked(id: number, picked: boolean): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(`UPDATE ChatMessage SET IS_JEWEL_PICKED = ? WHERE _ID = ?;`, [
    picked ? 1 : 0,
    id,
  ]);
}

export async function getPendingOutgoingMessages(): Promise<ChatMessage[]> {
  const db = await getDatabase();
  return db.getAllAsync<ChatMessage>(
    `SELECT * FROM ChatMessage WHERE IS_SUBMITTED = 0 AND IS_ERROR = 0 ORDER BY SEQUENCE ASC;`,
  );
}

/** Derives the single UI-facing status from the discrete DB flags. */
export function deriveMessageStatus(
  message: Pick<ChatMessage, 'IS_SUBMITTED' | 'IS_DELIVERED' | 'IS_READ' | 'IS_ERROR'>,
): MessageStatus {
  if (message.IS_ERROR) return 'failed';
  if (message.IS_READ) return 'read';
  if (message.IS_DELIVERED) return 'delivered';
  if (message.IS_SUBMITTED) return 'sent';
  return 'pending';
}
