import type { SQLiteDatabase } from 'expo-sqlite';
import { CREATE_MESSAGE_RECEIPT_TABLE, CREATE_MESSAGE_RECEIPT_INDEX } from '../schema';

/** v2: MessageReceipt (per-member group delivered/read tracking) + its index. */
export async function up(db: SQLiteDatabase): Promise<void> {
  await db.execAsync(CREATE_MESSAGE_RECEIPT_TABLE);
  await db.execAsync(CREATE_MESSAGE_RECEIPT_INDEX);
}

export const version = 2;
