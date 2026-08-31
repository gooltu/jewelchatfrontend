import type { SQLiteDatabase } from 'expo-sqlite';
import * as m001 from './001_initial';

/**
 * Ordered list of migrations, applied sequentially against
 * `PRAGMA user_version`. Add new files here (002_*, 003_*, ...) —
 * never edit 001_initial once it has shipped.
 */
export const migrations: { version: number; up: (db: SQLiteDatabase) => Promise<void> }[] = [
  { version: m001.version, up: m001.up },
];
