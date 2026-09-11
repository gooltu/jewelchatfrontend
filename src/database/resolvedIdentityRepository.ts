import { getDatabase } from './index';
import type { ResolvedIdentity } from '../types/chat';

/** CRUD for ResolvedIdentity — cached JID -> game-server phone/name lookups. See services/identityService.ts. */

export async function getResolvedIdentity(jid: string): Promise<ResolvedIdentity | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<ResolvedIdentity>(
    `SELECT * FROM ResolvedIdentity WHERE JID = ?;`,
    [jid],
  );
  return row ?? null;
}

export async function upsertResolvedIdentity(entry: {
  jid: string;
  jewelchatId: number;
  phone: string | null;
  name: string | null;
  resolvedTime: number;
}): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO ResolvedIdentity (JID, JEWELCHAT_ID, PHONE, NAME, RESOLVED_TIME)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (JID) DO UPDATE SET
       JEWELCHAT_ID = excluded.JEWELCHAT_ID,
       PHONE = excluded.PHONE,
       NAME = excluded.NAME,
       RESOLVED_TIME = excluded.RESOLVED_TIME;`,
    [entry.jid, entry.jewelchatId, entry.phone, entry.name, entry.resolvedTime],
  );
}
