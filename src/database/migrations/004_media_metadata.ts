import type { SQLiteDatabase } from 'expo-sqlite';

/**
 * v4: photo/video attachment metadata on ChatMessage. All nullable, no
 * backfill — only IMAGE/VIDEO rows populate them (see MSG_TYPE.IMAGE/VIDEO).
 */
export async function up(db: SQLiteDatabase): Promise<void> {
  await db.execAsync(`ALTER TABLE ChatMessage ADD COLUMN MEDIA_WIDTH INTEGER DEFAULT NULL;`);
  await db.execAsync(`ALTER TABLE ChatMessage ADD COLUMN MEDIA_HEIGHT INTEGER DEFAULT NULL;`);
  await db.execAsync(`ALTER TABLE ChatMessage ADD COLUMN MEDIA_DURATION_MS INTEGER DEFAULT NULL;`);
  await db.execAsync(`ALTER TABLE ChatMessage ADD COLUMN MEDIA_SIZE_BYTES INTEGER DEFAULT NULL;`);
  await db.execAsync(`ALTER TABLE ChatMessage ADD COLUMN MEDIA_MIME TEXT DEFAULT NULL;`);
}

export const version = 4;
