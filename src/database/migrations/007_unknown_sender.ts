import type { SQLiteDatabase } from 'expo-sqlite';

/**
 * v7: remembers that the user tapped "Continue" (or "Add to contacts") on the
 * unknown-sender prompt for a 1:1 chat with someone not in their phonebook —
 * see components/shared/UnknownSenderPrompt.tsx and services/unknownSenderService.ts.
 * Default 0, no backfill: every existing unknown-sender chat shows the prompt
 * once more after this ships, which is the intended behavior.
 */
export async function up(db: SQLiteDatabase): Promise<void> {
  await db.execAsync(`ALTER TABLE Contact ADD COLUMN IS_UNKNOWN_ACCEPTED INTEGER DEFAULT 0;`);
}

export const version = 7;
