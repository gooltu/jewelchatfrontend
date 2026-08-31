import { getDatabase } from './index';
import type { Contact } from '../types/chat';

/** CRUD for the Contact table — also the source of the conversation list. */

export async function getAllContacts(): Promise<Contact[]> {
  const db = await getDatabase();
  return db.getAllAsync<Contact>(
    `SELECT * FROM Contact ORDER BY LAST_MSG_CREATED_TIME DESC NULLS LAST;`,
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
