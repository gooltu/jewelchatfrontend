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
    dbPromise = createConnection(false);
  }
  return dbPromise;
}

/**
 * `useNewConnection: false` (the default open path) is deliberate: expo-sqlite
 * caches native connections by database path specifically to support Fast
 * Refresh (see its NativeDatabase constructor — "Try to find opened database
 * for fast refresh"), handing back the same underlying connection instead of
 * opening a second one. Only the release-recovery path below forces a
 * genuinely independent connection, since reopening the same cached (and
 * already-broken) entry would just hand back the same dead object.
 */
function createConnection(useNewConnection: boolean): Promise<SQLiteDatabase> {
  const promise: Promise<SQLiteDatabase> = openAndMigrate(useNewConnection).then((db) =>
    withReleaseRecovery(db, promise),
  );
  return promise;
}

async function openAndMigrate(useNewConnection: boolean): Promise<SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync(
    DB_NAME,
    useNewConnection ? { useNewConnection: true } : undefined,
  );
  await db.execAsync('PRAGMA journal_mode = WAL;');
  await db.execAsync('PRAGMA foreign_keys = ON;');
  await runMigrations(db);
  return db;
}

const RECOVERABLE_METHODS = [
  'runAsync',
  'getFirstAsync',
  'getAllAsync',
  'execAsync',
  'withTransactionAsync',
] as const;

/**
 * expo-sqlite's native database handle has been observed getting released
 * out from under a still-cached JS reference mid-session (surfaces as
 * "Cannot use shared object that was already released" from
 * NativeDatabase.prepareAsync), with no explicit close call anywhere in this
 * app. Without this, every DB call for the rest of the session fails the
 * same way — often silently, since several callers are fire-and-forget —
 * which is what made an incoming message stop showing up.
 *
 * The `dbPromise === ownPromise` check matters: several in-flight calls can
 * hit this same error for the same stale connection at once, but only the
 * first one to run should trigger a reopen — once it reassigns dbPromise,
 * every later catch for that same stale connection sees the mismatch and
 * skips, so recovery never races into two concurrent reopens.
 */
function withReleaseRecovery(db: SQLiteDatabase, ownPromise: Promise<SQLiteDatabase>): SQLiteDatabase {
  for (const method of RECOVERABLE_METHODS) {
    const original = db[method].bind(db) as (...args: unknown[]) => Promise<unknown>;
    (db[method] as unknown) = (...args: unknown[]) =>
      original(...args).catch((err: unknown) => {
        if (dbPromise === ownPromise && isReleasedHandleError(err)) {
          dbPromise = createConnection(true);
        }
        throw err;
      });
  }
  return db;
}

/**
 * The released-handle failure has several wordings depending on which native
 * argument hits the dead object first. Seen on Android devices in the e2e
 * suites, each from NativeDatabase.prepareAsync:
 *  - "Cannot use shared object that was already released"
 *  - "Cannot convert provided JavaScriptObject to the SharedObject, because
 *    it doesn't contain valid id" (with "The 1st argument cannot be cast to
 *    type class expo.modules.sqlite.NativeDatabase" or "The 2nd argument …
 *    NativeStatement")
 * Matching only the first left the others unrecovered: every later query
 * failed for the rest of the session.
 */
function isReleasedHandleError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const message = err.message;
  return (
    message.includes('shared object that was already released') ||
    message.includes("doesn't contain valid id") ||
    /cannot be cast to type class expo\.modules\.sqlite\.Native(Database|Statement)/.test(message)
  );
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
