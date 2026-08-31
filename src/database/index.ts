import * as SQLite from 'expo-sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import { migrations } from './migrations';

const DB_NAME = 'jewelchat.db';

let dbPromise: Promise<SQLiteDatabase> | null = null;

/**
 * Opens (once) and migrates the SQLite database. SQLite is the source of
 * truth for chat data — call this before any repository is used (e.g. at
 * App.tsx startup) and await it before rendering chat screens.
 */
export function getDatabase(): Promise<SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = openAndMigrate();
  }
  return dbPromise;
}

async function openAndMigrate(): Promise<SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync(DB_NAME);
  await db.execAsync('PRAGMA journal_mode = WAL;');
  await db.execAsync('PRAGMA foreign_keys = ON;');
  await runMigrations(db);
  return db;
}

async function runMigrations(db: SQLiteDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version;');
  let currentVersion = row?.user_version ?? 0;

  const pending = migrations
    .filter((migration) => migration.version > currentVersion)
    .sort((a, b) => a.version - b.version);

  for (const migration of pending) {
    await db.withTransactionAsync(async () => {
      await migration.up(db);
    });
    currentVersion = migration.version;
    await db.execAsync(`PRAGMA user_version = ${currentVersion};`);
  }
}

/** Test/dev-only escape hatch to force a fresh getDatabase() on next call. */
export function resetDatabaseConnection(): void {
  dbPromise = null;
}
