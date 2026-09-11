/**
 * Authoritative SQLite schema (v1). Column names, types, defaults, and
 * uniqueness constraints are fixed by the existing/migrating data model —
 * do not add, rename, or drop columns here without a new versioned
 * migration (see src/database/migrations/).
 */

export const CREATE_CONTACT_TABLE = `
CREATE TABLE if not exists Contact (
  _ID INTEGER PRIMARY KEY AUTOINCREMENT,
  JEWELCHAT_ID INTEGER,
  JID TEXT,
  CONTACT_NUMBER INTEGER,
  CONTACT_NAME TEXT,
  PHONEBOOK_CONTACT_NAME TEXT,
  IS_GROUP INTEGER DEFAULT 0,
  STATUS_MSG TEXT,
  IS_REGIS INTEGER DEFAULT 0,
  IS_GROUP_ADMIN INTEGER,
  IS_INVITED INTEGER DEFAULT 0,
  IS_BLOCKED INTEGER DEFAULT 0,
  IS_PHONEBOOK_CONTACT INTEGER,
  UNREAD_COUNT INTEGER DEFAULT 0,
  LAST_MSG_CREATED_TIME INTEGER,
  MSG_TYPE INTEGER,
  MSG_TEXT TEXT,
  SMALL_IMAGE TEXT,
  IMAGE_PATH TEXT,
  UNIQUE (JID),
  UNIQUE (CONTACT_NUMBER)
);
`;

export const CREATE_CHAT_MESSAGE_TABLE = `
CREATE TABLE if not exists ChatMessage (
  _ID INTEGER PRIMARY KEY AUTOINCREMENT,
  IS_GROUP_MSG INTEGER DEFAULT 0,
  MSG_TYPE INTEGER,
  CREATED_DATE TEXT,
  CREATED_TIME INTEGER,
  CHAT_ROOM_JID TEXT,
  CREATOR_JID TEXT,
  SENDER_NAME TEXT,
  SENDER_MSG_ID TEXT DEFAULT NULL,
  IS_READ INTEGER DEFAULT 0,
  TIME_READ INTEGER,
  IS_DELIVERED INTEGER DEFAULT 0,
  TIME_DELIVERED INTEGER,
  IS_SUBMITTED INTEGER DEFAULT 0,
  TIME_SUBMITTED INTEGER,
  TIME_CREATED INTEGER,
  IS_ERROR INTEGER DEFAULT 0,
  JEWEL_TYPE INTEGER,
  IS_JEWEL_PICKED INTEGER DEFAULT 0,
  MSG_TEXT TEXT,
  MEDIA_UPLOADED INTEGER DEFAULT 0,
  MEDIA_CLOUD TEXT DEFAULT NULL,
  MEDIA_CLOUD_THUMBNAIL TEXT DEFAULT NULL,
  SEQUENCE INTEGER DEFAULT 0,
  IS_REPLY INTEGER DEFAULT 0,
  REPLY_PARENT INTEGER DEFAULT NULL,
  IS_FORWARD INTEGER DEFAULT 0,
  UNIQUE (SENDER_MSG_ID, CHAT_ROOM_JID, CREATOR_JID)
);
`;

export const CREATE_GROUP_MEMBERS_TABLE = `
CREATE TABLE if not exists GroupMembers (
  _ID INTEGER PRIMARY KEY AUTOINCREMENT,
  GROUP_JID TEXT,
  MEMBER_JID TEXT,
  AFFILIATION TEXT,
  UNIQUE (GROUP_JID, MEMBER_JID)
);
`;

export const CREATE_MESSAGE_REACTION_TABLE = `
CREATE TABLE if not exists MessageReaction (
  _ID INTEGER PRIMARY KEY AUTOINCREMENT,
  CHAT_ROOM_JID TEXT,
  SENDER_MSG_ID TEXT,
  IS_GROUP_MSG INTEGER DEFAULT 0,
  REACTOR_JID TEXT,
  REACTOR_NAME TEXT,
  EMOJI TEXT,
  REACTED_TIME INTEGER,
  UNIQUE (CHAT_ROOM_JID, SENDER_MSG_ID, REACTOR_JID, EMOJI)
);
`;

export const CREATE_MESSAGE_REACTION_INDEX = `
CREATE INDEX if not exists idx_reaction_message
  ON MessageReaction (CHAT_ROOM_JID, SENDER_MSG_ID);
`;

/**
 * Per-member delivered/read tracking for group messages — 1-1 keeps using
 * ChatMessage's own IS_DELIVERED/IS_READ flags directly; a group message's
 * flags only flip once every current member has a row here (see
 * chatService.reconcileGroupReceiptAggregate).
 */
export const CREATE_MESSAGE_RECEIPT_TABLE = `
CREATE TABLE if not exists MessageReceipt (
  _ID INTEGER PRIMARY KEY AUTOINCREMENT,
  CHAT_ROOM_JID TEXT,
  SENDER_MSG_ID TEXT,
  MEMBER_JID TEXT,
  IS_DELIVERED INTEGER DEFAULT 0,
  TIME_DELIVERED INTEGER,
  IS_READ INTEGER DEFAULT 0,
  TIME_READ INTEGER,
  UNIQUE (CHAT_ROOM_JID, SENDER_MSG_ID, MEMBER_JID)
);
`;

export const CREATE_MESSAGE_RECEIPT_INDEX = `
CREATE INDEX if not exists idx_message_receipt_lookup
  ON MessageReceipt (CHAT_ROOM_JID, SENDER_MSG_ID);
`;

/**
 * Caches a JID's resolved game-server identity (phone/name), independent of
 * any group membership — survives GroupMembers roster refreshes/departures,
 * unlike storing it on GroupMembers itself. See services/identityService.ts.
 */
export const CREATE_RESOLVED_IDENTITY_TABLE = `
CREATE TABLE if not exists ResolvedIdentity (
  JEWELCHAT_ID INTEGER,
  JID TEXT UNIQUE,
  PHONE TEXT,
  NAME TEXT,
  RESOLVED_TIME INTEGER
);
`;

/** Table names, for repositories/tests that need to reference them by string. */
export const TABLES = {
  Contact: 'Contact',
  ChatMessage: 'ChatMessage',
  GroupMembers: 'GroupMembers',
  MessageReaction: 'MessageReaction',
  MessageReceipt: 'MessageReceipt',
  ResolvedIdentity: 'ResolvedIdentity',
} as const;
