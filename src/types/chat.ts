/**
 * App-facing models. Field names intentionally mirror the SQLite column
 * names 1:1 (see src/database/schema.ts) — no renamed/translated model
 * layer, so a DB row can be cast directly to these types.
 */

export interface Contact {
  _ID: number;
  JEWELCHAT_ID: number | null;
  JID: string | null;
  CONTACT_NUMBER: number | null;
  CONTACT_NAME: string | null;
  PHONEBOOK_CONTACT_NAME: string | null;
  IS_GROUP: number;
  STATUS_MSG: string | null;
  IS_REGIS: number;
  IS_GROUP_ADMIN: number | null;
  IS_INVITED: number;
  IS_BLOCKED: number;
  IS_PHONEBOOK_CONTACT: number | null;
  UNREAD_COUNT: number;
  LAST_MSG_CREATED_TIME: number | null;
  MSG_TYPE: number | null;
  MSG_TEXT: string | null;
  SMALL_IMAGE: string | null;
  IMAGE_PATH: string | null;
}

/** A `Contact` row rendered as a chat-list entry — same shape, different lens. */
export type Conversation = Contact;

export interface ChatMessage {
  _ID: number;
  IS_GROUP_MSG: number;
  MSG_TYPE: number | null;
  CREATED_DATE: string | null;
  CREATED_TIME: number | null;
  CHAT_ROOM_JID: string | null;
  CREATOR_JID: string | null;
  SENDER_NAME: string | null;
  SENDER_MSG_ID: string | null;
  IS_READ: number;
  TIME_READ: number | null;
  IS_DELIVERED: number;
  TIME_DELIVERED: number | null;
  IS_SUBMITTED: number;
  TIME_SUBMITTED: number | null;
  TIME_CREATED: number | null;
  IS_ERROR: number;
  JEWEL_TYPE: number | null;
  IS_JEWEL_PICKED: number;
  MSG_TEXT: string | null;
  MEDIA_UPLOADED: number;
  MEDIA_CLOUD: string | null;
  MEDIA_CLOUD_THUMBNAIL: string | null;
  SEQUENCE: number;
  IS_REPLY: number;
  REPLY_PARENT: number | null;
  IS_FORWARD: number;
}

export interface GroupMember {
  _ID: number;
  GROUP_JID: string | null;
  MEMBER_JID: string | null;
  AFFILIATION: string | null;
}

export interface MessageReaction {
  _ID: number;
  CHAT_ROOM_JID: string | null;
  SENDER_MSG_ID: string | null;
  IS_GROUP_MSG: number;
  REACTOR_JID: string | null;
  REACTOR_NAME: string | null;
  EMOJI: string | null;
  REACTED_TIME: number | null;
}

/** One emoji's aggregated reactions on a single message, for rendering a reaction pill. */
export interface ReactionGroup {
  emoji: string;
  count: number;
  reactorJids: string[];
  reactorNames: string[];
}

/**
 * UI-facing message status, derived from ChatMessage's discrete status
 * flags (IS_SUBMITTED/IS_DELIVERED/IS_READ/IS_ERROR) rather than stored
 * redundantly. See messageRepository.deriveMessageStatus.
 */
export type MessageStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed';
