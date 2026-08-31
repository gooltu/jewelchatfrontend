import { getDatabase } from './index';
import type { GroupMember } from '../types/chat';

/** CRUD for GroupMembers. */

export async function getGroupMembers(groupJid: string): Promise<GroupMember[]> {
  const db = await getDatabase();
  return db.getAllAsync<GroupMember>(`SELECT * FROM GroupMembers WHERE GROUP_JID = ?;`, [
    groupJid,
  ]);
}

export async function getGroupMember(
  groupJid: string,
  memberJid: string,
): Promise<GroupMember | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<GroupMember>(
    `SELECT * FROM GroupMembers WHERE GROUP_JID = ? AND MEMBER_JID = ?;`,
    [groupJid, memberJid],
  );
  return row ?? null;
}

export async function upsertGroupMember(
  groupJid: string,
  memberJid: string,
  affiliation: string | null,
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO GroupMembers (GROUP_JID, MEMBER_JID, AFFILIATION) VALUES (?, ?, ?)
     ON CONFLICT (GROUP_JID, MEMBER_JID) DO UPDATE SET AFFILIATION = excluded.AFFILIATION;`,
    [groupJid, memberJid, affiliation],
  );
}

export async function removeGroupMember(groupJid: string, memberJid: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(`DELETE FROM GroupMembers WHERE GROUP_JID = ? AND MEMBER_JID = ?;`, [
    groupJid,
    memberJid,
  ]);
}

/** Replaces a group's full roster (e.g. after fetching XMPP MUC affiliations). */
export async function replaceGroupMembers(
  groupJid: string,
  members: { memberJid: string; affiliation: string | null }[],
): Promise<void> {
  const db = await getDatabase();
  await db.withTransactionAsync(async () => {
    await db.runAsync(`DELETE FROM GroupMembers WHERE GROUP_JID = ?;`, [groupJid]);
    for (const member of members) {
      await db.runAsync(
        `INSERT INTO GroupMembers (GROUP_JID, MEMBER_JID, AFFILIATION) VALUES (?, ?, ?);`,
        [groupJid, member.memberJid, member.affiliation],
      );
    }
  });
}
