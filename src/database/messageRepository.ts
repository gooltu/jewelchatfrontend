import { getDatabase } from './index';
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
 */
export async function insertOutgoingMessage(
  message: Omit<
    ChatMessage,
    | '_ID'
    | 'SEQUENCE'
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
      SENDER_NAME, SENDER_MSG_ID, IS_READ, IS_DELIVERED, IS_SUBMITTED, TIME_CREATED,
      IS_ERROR, JEWEL_TYPE, IS_JEWEL_PICKED, MSG_TEXT, MEDIA_UPLOADED, MEDIA_CLOUD,
      MEDIA_CLOUD_THUMBNAIL, SEQUENCE, IS_REPLY, REPLY_PARENT, IS_FORWARD
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    [
      message.IS_GROUP_MSG,
      message.MSG_TYPE,
      message.CREATED_DATE,
      message.CREATED_TIME,
      message.CHAT_ROOM_JID,
      message.CREATOR_JID,
      message.SENDER_NAME,
      message.SENDER_MSG_ID,
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

export async function markAllReadInRoom(chatRoomJid: string, timeRead: number): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE ChatMessage SET IS_READ = 1, TIME_READ = ?
     WHERE CHAT_ROOM_JID = ? AND IS_READ = 0;`,
    [timeRead, chatRoomJid],
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
