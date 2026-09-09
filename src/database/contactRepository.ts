import { getDatabase } from './index';
import type { Contact } from '../types/chat';

/** CRUD for the Contact table — also the source of the conversation list. */

/** Chat list — only contacts with an actual conversation, most recent first. */
export async function getAllContacts(): Promise<Contact[]> {
  const db = await getDatabase();
  return db.getAllAsync<Contact>(
    `SELECT * FROM Contact WHERE LAST_MSG_CREATED_TIME IS NOT NULL ORDER BY LAST_MSG_CREATED_TIME DESC;`,
  );
}

/** Contacts eligible for the Select Contact picker — no groups, no blocked contacts. */
export async function getAllContactsForPicker(): Promise<Contact[]> {
  const db = await getDatabase();
  return db.getAllAsync<Contact>(
    `SELECT * FROM Contact WHERE IS_GROUP = 0 AND IS_BLOCKED = 0;`,
  );
}

export async function getContactByJid(jid: string): Promise<Contact | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<Contact>(`SELECT * FROM Contact WHERE JID = ?;`, [jid]);
  return row ?? null;
}

export async function getContactById(id: number): Promise<Contact | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<Contact>(`SELECT * FROM Contact WHERE _ID = ?;`, [id]);
  return row ?? null;
}

/** Insert a new contact, or update the mutable fields if the JID already exists. */
export async function upsertContact(
  contact: Omit<Contact, '_ID' | 'UNREAD_COUNT'>,
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO Contact (
      JEWELCHAT_ID, JID, CONTACT_NUMBER, CONTACT_NAME, PHONEBOOK_CONTACT_NAME,
      IS_GROUP, STATUS_MSG, IS_REGIS, IS_GROUP_ADMIN, IS_INVITED, IS_BLOCKED,
      IS_PHONEBOOK_CONTACT, LAST_MSG_CREATED_TIME, MSG_TYPE, MSG_TEXT,
      SMALL_IMAGE, IMAGE_PATH
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (JID) DO UPDATE SET
      CONTACT_NAME = excluded.CONTACT_NAME,
      PHONEBOOK_CONTACT_NAME = excluded.PHONEBOOK_CONTACT_NAME,
      STATUS_MSG = excluded.STATUS_MSG,
      IS_REGIS = excluded.IS_REGIS,
      IS_GROUP_ADMIN = excluded.IS_GROUP_ADMIN,
      IS_INVITED = excluded.IS_INVITED,
      IS_BLOCKED = excluded.IS_BLOCKED,
      IS_PHONEBOOK_CONTACT = excluded.IS_PHONEBOOK_CONTACT,
      SMALL_IMAGE = excluded.SMALL_IMAGE,
      IMAGE_PATH = excluded.IMAGE_PATH;`,
    [
      contact.JEWELCHAT_ID,
      contact.JID,
      contact.CONTACT_NUMBER,
      contact.CONTACT_NAME,
      contact.PHONEBOOK_CONTACT_NAME,
      contact.IS_GROUP,
      contact.STATUS_MSG,
      contact.IS_REGIS,
      contact.IS_GROUP_ADMIN,
      contact.IS_INVITED,
      contact.IS_BLOCKED,
      contact.IS_PHONEBOOK_CONTACT,
      contact.LAST_MSG_CREATED_TIME,
      contact.MSG_TYPE,
      contact.MSG_TEXT,
      contact.SMALL_IMAGE,
      contact.IMAGE_PATH,
    ],
  );
}

/**
 * Writes/refreshes a single device-phonebook entry. Deliberately narrow:
 * only touches PHONEBOOK_CONTACT_NAME/IS_PHONEBOOK_CONTACT, so a repeat
 * phonebook sync never clobbers JEWELCHAT_ID/JID/IS_REGIS resolved by a
 * prior contactSyncService.resolveContactOnTap call.
 */
export async function upsertPhonebookContact(entry: {
  contactNumber: number;
  phonebookName: string;
}): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO Contact (CONTACT_NUMBER, PHONEBOOK_CONTACT_NAME, IS_PHONEBOOK_CONTACT)
    VALUES (?, ?, 1)
    ON CONFLICT (CONTACT_NUMBER) DO UPDATE SET
      PHONEBOOK_CONTACT_NAME = excluded.PHONEBOOK_CONTACT_NAME,
      IS_PHONEBOOK_CONTACT = 1;`,
    [entry.contactNumber, entry.phonebookName],
  );
}

/**
 * Merges a resolved JewelChat identity into the contact row for this phone
 * number. Keyed on CONTACT_NUMBER (not JID, unlike upsertContact) because at
 * this point the row is a phonebook-only contact that has no JID yet —
 * upsertContact's `ON CONFLICT (JID)` would insert a brand-new row instead
 * of updating this one, colliding with it on the CONTACT_NUMBER unique
 * constraint.
 */
export async function attachJewelchatIdentity(entry: {
  contactNumber: number;
  jewelchatId: number;
  jid: string;
  statusMsg: string | null;
}): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO Contact (CONTACT_NUMBER, JEWELCHAT_ID, JID, STATUS_MSG, IS_REGIS)
    VALUES (?, ?, ?, ?, 1)
    ON CONFLICT (CONTACT_NUMBER) DO UPDATE SET
      JEWELCHAT_ID = excluded.JEWELCHAT_ID,
      JID = excluded.JID,
      STATUS_MSG = excluded.STATUS_MSG,
      IS_REGIS = 1;`,
    [entry.contactNumber, entry.jewelchatId, entry.jid, entry.statusMsg],
  );
}

/** Updates the chat-list preview fields after a new message is sent/received. */
export async function updateLastMessagePreview(
  jid: string,
  args: { msgText: string | null; msgType: number | null; createdTime: number },
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE Contact SET MSG_TEXT = ?, MSG_TYPE = ?, LAST_MSG_CREATED_TIME = ? WHERE JID = ?;`,
    [args.msgText, args.msgType, args.createdTime, jid],
  );
}

export async function incrementUnreadCount(jid: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(`UPDATE Contact SET UNREAD_COUNT = UNREAD_COUNT + 1 WHERE JID = ?;`, [jid]);
}

export async function resetUnreadCount(jid: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(`UPDATE Contact SET UNREAD_COUNT = 0 WHERE JID = ?;`, [jid]);
}

export async function setBlocked(jid: string, isBlocked: boolean): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(`UPDATE Contact SET IS_BLOCKED = ? WHERE JID = ?;`, [isBlocked ? 1 : 0, jid]);
}

export async function deleteContact(jid: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(`DELETE FROM Contact WHERE JID = ?;`, [jid]);
}
