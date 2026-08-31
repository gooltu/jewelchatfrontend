import { getDatabase } from './index';
import type { MessageReaction, ReactionGroup } from '../types/chat';

/**
 * CRUD for MessageReaction. A reactor's emoji set on a message is always
 * replaced wholesale (delete-then-insert), matching how XEP-0444-style
 * reaction stanzas send a full replacement set per update, not a diff.
 */

/**
 * Replaces `reactorJid`'s prior reactions on (chatRoomJid, senderMsgId)
 * with `emojis`. Pass an empty array to clear all of a reactor's reactions
 * on a message (equivalent to "retract all").
 */
export async function replaceReactorReactions(args: {
  chatRoomJid: string;
  senderMsgId: string;
  isGroupMsg: boolean;
  reactorJid: string;
  reactorName: string | null;
  emojis: string[];
  reactedTime: number;
}): Promise<void> {
  const db = await getDatabase();

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `DELETE FROM MessageReaction
       WHERE CHAT_ROOM_JID = ? AND SENDER_MSG_ID = ? AND REACTOR_JID = ?;`,
      [args.chatRoomJid, args.senderMsgId, args.reactorJid],
    );

    for (const emoji of args.emojis) {
      await db.runAsync(
        `INSERT OR IGNORE INTO MessageReaction (
          CHAT_ROOM_JID, SENDER_MSG_ID, IS_GROUP_MSG, REACTOR_JID, REACTOR_NAME,
          EMOJI, REACTED_TIME
        ) VALUES (?, ?, ?, ?, ?, ?, ?);`,
        [
          args.chatRoomJid,
          args.senderMsgId,
          args.isGroupMsg ? 1 : 0,
          args.reactorJid,
          args.reactorName,
          emoji,
          args.reactedTime,
        ],
      );
    }
  });
}

/** Removes a single (message, reactor, emoji) reaction — a targeted retraction. */
export async function removeReaction(args: {
  chatRoomJid: string;
  senderMsgId: string;
  reactorJid: string;
  emoji: string;
}): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `DELETE FROM MessageReaction
     WHERE CHAT_ROOM_JID = ? AND SENDER_MSG_ID = ? AND REACTOR_JID = ? AND EMOJI = ?;`,
    [args.chatRoomJid, args.senderMsgId, args.reactorJid, args.emoji],
  );
}

export async function getReactionsForMessage(
  chatRoomJid: string,
  senderMsgId: string,
): Promise<MessageReaction[]> {
  const db = await getDatabase();
  return db.getAllAsync<MessageReaction>(
    `SELECT * FROM MessageReaction
     WHERE CHAT_ROOM_JID = ? AND SENDER_MSG_ID = ?
     ORDER BY REACTED_TIME ASC;`,
    [chatRoomJid, senderMsgId],
  );
}

/** Same query as getReactionsForMessage, grouped by emoji for rendering reaction pills. */
export async function getGroupedReactionsForMessage(
  chatRoomJid: string,
  senderMsgId: string,
): Promise<ReactionGroup[]> {
  const reactions = await getReactionsForMessage(chatRoomJid, senderMsgId);

  const groups = new Map<string, ReactionGroup>();
  for (const reaction of reactions) {
    if (!reaction.EMOJI) continue;
    const group = groups.get(reaction.EMOJI) ?? {
      emoji: reaction.EMOJI,
      count: 0,
      reactorJids: [],
      reactorNames: [],
    };
    group.count += 1;
    if (reaction.REACTOR_JID) group.reactorJids.push(reaction.REACTOR_JID);
    if (reaction.REACTOR_NAME) group.reactorNames.push(reaction.REACTOR_NAME);
    groups.set(reaction.EMOJI, group);
  }

  return Array.from(groups.values());
}
