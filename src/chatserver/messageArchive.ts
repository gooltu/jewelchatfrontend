import { $iq, Strophe, type StropheConnection } from 'react-native-strophe';
import { getConnection } from './stropheClient';
import { firstChildByTagName, firstChildByTagNameNs } from './stropheEvents';
import { MSG_TYPE } from '../types/chat';

/** XEP-0313 Message Archive Management. */
const MAM_NS = 'urn:xmpp:mam:2';
/** XEP-0059 Result Set Management (pagination). */
const RSM_NS = 'http://jabber.org/protocol/rsm';
/** XEP-0297 Stanza Forwarding (wraps each archived message). */
const FORWARD_NS = 'urn:xmpp:forward:0';
/** XEP-0203 Delayed Delivery (the archived message's original timestamp). */
const DELAY_NS = 'urn:xmpp:delay';
/** Matches the confirmed-working reference function exactly. */
const PAGE_SIZE = 10;
const QUERY_TIMEOUT_MS = 20_000;

export interface ArchivedMessage {
  chatRoomJid: string;
  creatorJid: string;
  senderName: string | null;
  senderMsgId: string;
  msgText: string;
  msgType: number;
  mediaLink: string | null;
  mediaThumbnail: string | null;
  timestampMs: number;
  isGroupMsg: boolean;
}

/**
 * XEP-0313 MAM query against the account's own archive (no `to` attribute —
 * covers every 1-1 conversation in one query), from `startMs` to the live
 * edge of the archive, paged 10-at-a-time via RSM. Calls `onMessage`
 * synchronously per result; resolves once a page comes back with no RSM
 * `<last>` element — matches the reference function's exact completion
 * signal, not `<fin complete="true">`.
 */
export async function fetchArchivedMessages(
  startMs: number,
  myJid: string,
  onMessage: (message: ArchivedMessage) => void,
): Promise<void> {
  return fetchArchive(startMs, myJid, null, onMessage);
}

/**
 * Same MAM query, addressed (`to`) to a MUC-Light room's own archive instead
 * of the account's — mod_mam's `[modules.mod_mam.muc].host` is deliberately
 * pointed at `muclight.<domain>` server-side for exactly this (see
 * ChatServerConf/CLAUDE.md), so per-room queries resolve to that room's
 * history rather than nowhere. Archived group messages already carry the
 * same `from = room@muclight.domain/nickname` shape live group messages do
 * (see stropheEvents.ts), so `handleResultStanza` needs no group-specific
 * parsing beyond what it already does for `type='groupchat'`.
 */
export async function fetchArchivedRoomMessages(
  startMs: number,
  roomJid: string,
  myJid: string,
  onMessage: (message: ArchivedMessage) => void,
): Promise<void> {
  return fetchArchive(startMs, myJid, roomJid, onMessage);
}

async function fetchArchive(
  startMs: number,
  myJid: string,
  roomJid: string | null,
  onMessage: (message: ArchivedMessage) => void,
): Promise<void> {
  const connection = getConnection();
  if (!connection) throw new Error('fetchArchivedMessages: not connected');

  const startIso = new Date(startMs).toISOString();
  let after: string | null = null;
  let hasMore = true;

  while (hasMore) {
    const queryId = `mam-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const handlerRef = connection.addHandler(
      (stanza) => {
        handleResultStanza(stanza, queryId, myJid, onMessage);
        return true;
      },
      MAM_NS,
      'message',
      null,
      null,
      null,
    );

    try {
      after = await sendQueryPage(connection, queryId, startIso, after, roomJid);
      hasMore = after !== null;
    } finally {
      connection.deleteHandler(handlerRef);
    }
  }
}

/** Resolves with the RSM <last> id if present (more pages follow), or null if this was the final page. */
function sendQueryPage(
  connection: StropheConnection,
  queryId: string,
  startIso: string,
  after: string | null,
  roomJid: string | null,
): Promise<string | null> {
  return new Promise((resolve, reject) => {
    let query = $iq(roomJid ? { type: 'set', to: roomJid } : { type: 'set' })
      .c('query', { xmlns: MAM_NS, queryid: queryId })
      .c('x', { xmlns: 'jabber:x:data', type: 'submit' })
      .c('field', { var: 'FORM_TYPE', type: 'hidden' })
      .c('value')
      .t(MAM_NS)
      .up()
      .up()
      .c('field', { var: 'start' })
      .c('value')
      .t(startIso)
      .up() // value -> field(start)
      .up() // field(start) -> x
      .up() // x -> query
      .c('set', { xmlns: RSM_NS })
      .c('max')
      .t(String(PAGE_SIZE));

    if (after) {
      query = query.up().c('after').t(after);
    }

    connection.sendIQ(
      query.tree(),
      (stanza) => {
        const setElem = firstChildByTagNameNs(stanza, 'set', RSM_NS);
        const lastElem = setElem && firstChildByTagName(setElem, 'last');
        resolve(lastElem?.textContent ?? null);
      },
      () => reject(new Error('fetchArchivedMessages: MAM query failed or timed out')),
      QUERY_TIMEOUT_MS,
    );
  });
}

function handleResultStanza(
  stanza: Element,
  queryId: string,
  myJid: string,
  onMessage: (message: ArchivedMessage) => void,
): void {
  const result = firstChildByTagNameNs(stanza, 'result', MAM_NS);
  if (!result || result.getAttribute('queryid') !== queryId) return;

  const forwarded = firstChildByTagNameNs(result, 'forwarded', FORWARD_NS);
  const original = forwarded && firstChildByTagName(forwarded, 'message');
  if (!original) return;

  const body = firstChildByTagName(original, 'body')?.textContent;
  const from = original.getAttribute('from');
  const to = original.getAttribute('to');
  if (!body || !from) return; // no body: nothing this app persists (chat-state/receipt-only archived stanza)

  const senderMsgId = original.getAttribute('id');
  if (!senderMsgId) return; // no stable id: can't dedup safely, skip

  const isGroupMsg = original.getAttribute('type') === 'groupchat';
  const fromBare = Strophe.getBareJidFromJid(from);
  if (!fromBare) return;

  // MAM archives both directions (things you sent and things you received),
  // unlike live receive which only ever sees the peer's messages. Disambiguate
  // by comparing `from` against our own JID.
  const isOwnSentMessage = !isGroupMsg && fromBare === myJid;
  const chatRoomJid = isOwnSentMessage
    ? to
      ? Strophe.getBareJidFromJid(to) ?? to
      : null
    : fromBare;
  const creatorJid = isOwnSentMessage ? myJid : isGroupMsg ? from : fromBare;
  if (!chatRoomJid) return;

  // `msgtype` is a top-level attribute the server preserves on the archived
  // copy of the original stanza — see syncService.ts/stropheEvents.ts.
  const msgTypeAttr = original.getAttribute('msgtype');
  const msgType = msgTypeAttr !== null ? Number(msgTypeAttr) : MSG_TYPE.TEXT;
  const mediaElem = firstChildByTagName(original, 'media');

  const delay = forwarded && firstChildByTagNameNs(forwarded, 'delay', DELAY_NS);
  const stamp = delay?.getAttribute('stamp');

  onMessage({
    chatRoomJid,
    creatorJid,
    senderName: isOwnSentMessage ? null : Strophe.getResourceFromJid(from),
    senderMsgId,
    msgText: body,
    msgType,
    mediaLink: mediaElem?.getAttribute('link') ?? null,
    mediaThumbnail: mediaElem?.getAttribute('thumbnail') ?? null,
    timestampMs: stamp ? new Date(stamp).getTime() : Date.now(),
    isGroupMsg,
  });
}
