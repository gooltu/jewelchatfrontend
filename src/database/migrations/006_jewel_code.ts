import type { SQLiteDatabase } from 'expo-sqlite';

/**
 * v6: the verification code (from a GET /getJewels batch) that must accompany a
 * message's JEWEL_TYPE when it's later collected via POST /bulkPickJewelVerified — see
 * jewelPoolService.ts. Nullable, no backfill: only messages that received a jewel
 * after this migration ships will ever have one.
 */
export async function up(db: SQLiteDatabase): Promise<void> {
  await db.execAsync(`ALTER TABLE ChatMessage ADD COLUMN JEWEL_CODE TEXT DEFAULT NULL;`);
}

export const version = 6;
