import type { SQLiteDatabase } from 'expo-sqlite';

/**
 * v5: star (ChatMessage) + archive/pin (Contact) flags backing the new
 * message-actions / conversation-management UI. All nullable/zero-default,
 * no backfill needed.
 */
export async function up(db: SQLiteDatabase): Promise<void> {
  await db.execAsync(`ALTER TABLE ChatMessage ADD COLUMN IS_STARRED INTEGER DEFAULT 0;`);
  await db.execAsync(`ALTER TABLE Contact ADD COLUMN IS_ARCHIVED INTEGER DEFAULT 0;`);
  await db.execAsync(`ALTER TABLE Contact ADD COLUMN IS_PINNED INTEGER DEFAULT 0;`);
  await db.execAsync(`ALTER TABLE Contact ADD COLUMN PINNED_TIME INTEGER DEFAULT NULL;`);
}

export const version = 5;
