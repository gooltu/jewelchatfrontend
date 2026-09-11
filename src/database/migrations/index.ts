import type { SQLiteDatabase } from 'expo-sqlite';
import * as m001 from './001_initial';
import * as m002 from './002_message_receipt';
import * as m003 from './003_resolved_identity';

/**
 * Ordered list of migrations, applied sequentially against
 * `PRAGMA user_version`. Add new files here (002_*, 003_*, ...) —
 * never edit 001_initial once it has shipped.
 */
export const migrations: { version: number; up: (db: SQLiteDatabase) => Promise<void> }[] = [
  { version: m001.version, up: m001.up },
  { version: m002.version, up: m002.up },
  { version: m003.version, up: m003.up },
];
