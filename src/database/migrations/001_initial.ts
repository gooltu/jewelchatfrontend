import type { SQLiteDatabase } from 'expo-sqlite';
import {
  CREATE_CONTACT_TABLE,
  CREATE_CHAT_MESSAGE_TABLE,
  CREATE_GROUP_MEMBERS_TABLE,
  CREATE_MESSAGE_REACTION_TABLE,
  CREATE_MESSAGE_REACTION_INDEX,
} from '../schema';

/** v1: Contact, ChatMessage, GroupMembers, MessageReaction + its index. */
export async function up(db: SQLiteDatabase): Promise<void> {
  await db.execAsync(CREATE_CONTACT_TABLE);
  await db.execAsync(CREATE_CHAT_MESSAGE_TABLE);
  await db.execAsync(CREATE_GROUP_MEMBERS_TABLE);
  await db.execAsync(CREATE_MESSAGE_REACTION_TABLE);
  await db.execAsync(CREATE_MESSAGE_REACTION_INDEX);
}

export const version = 1;
