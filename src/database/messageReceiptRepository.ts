import { getDatabase } from './index';
import type { MessageReceipt } from '../types/chat';

/**
 * CRUD for MessageReceipt — per-member delivered/read acks on a group
 * message. 1-1 never uses this table; it keeps using ChatMessage's own
 * IS_DELIVERED/IS_READ flags directly.
 */

/**
 * Upserts one member's ack on one message. A 'read' ack also sets
 * IS_DELIVERED (read implies delivered, in case a <received/> was somehow
 * missed) but never the reverse — a 'delivered' ack leaves IS_READ alone.
 */
export async function upsertReceipt(
  chatRoomJid: string,
  senderMsgId: string,
  memberJid: string,
  kind: 'delivered' | 'read',
  timestamp: number,
): Promise<void> {
  const db = await getDatabase();
  if (kind === 'read') {
    await db.runAsync(
      `INSERT INTO MessageReceipt (CHAT_ROOM_JID, SENDER_MSG_ID, MEMBER_JID, IS_DELIVERED, TIME_DELIVERED, IS_READ, TIME_READ)
       VALUES (?, ?, ?, 1, ?, 1, ?)
       ON CONFLICT (CHAT_ROOM_JID, SENDER_MSG_ID, MEMBER_JID) DO UPDATE SET
         IS_DELIVERED = 1,
         TIME_DELIVERED = COALESCE(MessageReceipt.TIME_DELIVERED, excluded.TIME_DELIVERED),
         IS_READ = 1,
         TIME_READ = excluded.TIME_READ;`,
      [chatRoomJid, senderMsgId, memberJid, timestamp, timestamp],
    );
  } else {
    await db.runAsync(
      `INSERT INTO MessageReceipt (CHAT_ROOM_JID, SENDER_MSG_ID, MEMBER_JID, IS_DELIVERED, TIME_DELIVERED)
       VALUES (?, ?, ?, 1, ?)
       ON CONFLICT (CHAT_ROOM_JID, SENDER_MSG_ID, MEMBER_JID) DO UPDATE SET
         IS_DELIVERED = 1,
         TIME_DELIVERED = COALESCE(MessageReceipt.TIME_DELIVERED, excluded.TIME_DELIVERED);`,
      [chatRoomJid, senderMsgId, memberJid, timestamp],
    );
  }
}

export async function getReceipts(chatRoomJid: string, senderMsgId: string): Promise<MessageReceipt[]> {
  const db = await getDatabase();
  return db.getAllAsync<MessageReceipt>(
    `SELECT * FROM MessageReceipt WHERE CHAT_ROOM_JID = ? AND SENDER_MSG_ID = ?;`,
    [chatRoomJid, senderMsgId],
  );
}
