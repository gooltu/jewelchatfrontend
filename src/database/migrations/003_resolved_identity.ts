import type { SQLiteDatabase } from 'expo-sqlite';
import { CREATE_RESOLVED_IDENTITY_TABLE } from '../schema';

/** v3: ResolvedIdentity (cached JID -> game-server phone/name lookups). */
export async function up(db: SQLiteDatabase): Promise<void> {
  await db.execAsync(CREATE_RESOLVED_IDENTITY_TABLE);
}

export const version = 3;
