import { $iq, Strophe, type StropheConnection } from 'react-native-strophe';
import { getConnection, isConnected } from './stropheClient';
import { firstChildByTagName, firstChildByTagNameNs } from './xmlHelpers';

/**
 * mod_muc_light (XEP-adjacent `urn:xmpp:muclight:0`) protocol layer — same
 * shape/conventions as entityTime.ts / messageArchive.ts (own
 * getConnection()/isConnected() check, `$iq` + `connection.sendIQ` with a
 * timeout). Confirmed live against the real server via
 * ChatServerConf/CLAUDE.md + ChatServerConf/xmpp/app.js.
 */

export const MUCLIGHT_NS = 'urn:xmpp:muclight:0';
const CREATE_NS = `${MUCLIGHT_NS}#create`;
const CONFIGURATION_NS = `${MUCLIGHT_NS}#configuration`;
const AFFILIATIONS_NS = `${MUCLIGHT_NS}#affiliations`;
const DESTROY_NS = `${MUCLIGHT_NS}#destroy`;
const DISCO_ITEMS_NS = 'http://jabber.org/protocol/disco#items';
const QUERY_TIMEOUT_MS = 15_000;

export type GroupAffiliation = 'member' | 'owner' | 'none';

export interface GroupAffiliationEntry {
  jid: string;
  affiliation: GroupAffiliation;
}

function requireConnection(): StropheConnection {
  const connection = getConnection();
  if (!connection || !isConnected()) {
    throw new Error('muclight: not connected');
  }
  return connection;
}

/** `muclight.<domain>` — the MUC Light service subdomain every room lives under. */
export function getMucDomain(connection: StropheConnection): string {
  return `muclight.${connection.domain}`;
}

/**
 * Shared parser for both the live `#affiliations` notification message and
 * the `#affiliations` get-IQ result — same `<user affiliation=X>jid</user>`
 * shape either way.
 */
export function parseAffiliationUsers(xEl: Element): GroupAffiliationEntry[] {
  const nodes = xEl.getElementsByTagName('user');
  const entries: GroupAffiliationEntry[] = [];
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];
    const jid = node?.textContent?.trim();
    const affiliation = node?.getAttribute('affiliation');
    if (jid && (affiliation === 'member' || affiliation === 'owner' || affiliation === 'none')) {
      entries.push({ jid, affiliation });
    }
  }
  return entries;
}

/**
 * Creates a room (server auto-generates the JID) and resolves once the
 * `#affiliations` notification every occupant — including the creator —
 * receives afterward arrives, since the create IQ's own result is empty
 * (confirmed against the real server: the notification, not the IQ result,
 * is the only way to learn the generated room JID). Registers a one-shot
 * handler for that notification alongside the IQ itself — mirrors
 * messageArchive.ts's addHandler + connection.deleteHandler pattern.
 */
export function createGroupRoom(params: {
  roomName: string;
  memberJids: string[];
}): Promise<{ roomJid: string; members: GroupAffiliationEntry[] }> {
  const connection = requireConnection();
  const mucDomain = getMucDomain(connection);

  return new Promise((resolve, reject) => {
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      connection.deleteHandler(handlerRef);
      reject(new Error('createGroupRoom: timed out waiting for the room-created notification'));
    }, QUERY_TIMEOUT_MS);

    const handlerRef = connection.addHandler(
      (stanza) => {
        if (settled) return true;
        const xEl = firstChildByTagNameNs(stanza, 'x', AFFILIATIONS_NS);
        if (!xEl) return true;
        const from = stanza.getAttribute('from');
        const roomJid = from ? Strophe.getBareJidFromJid(from) : null;
        if (!roomJid) return true;

        settled = true;
        clearTimeout(timer);
        connection.deleteHandler(handlerRef);
        resolve({ roomJid, members: parseAffiliationUsers(xEl) });
        return true;
      },
      null,
      'message',
      'groupchat',
      null,
      null,
    );

    // `.c(name, attrs, text)` doesn't move the builder cursor (see
    // syncService.ts's attemptSend for the confirmed semantics) — so each
    // `<user>`/`<roomname>` leaf below can be appended without an extra
    // `.up()` afterward; only the two structural `.c(name, attrs)` calls
    // (no text) move the cursor and need a matching `.up()`.
    let createIq = $iq({ type: 'set', to: mucDomain }).c('query', { xmlns: CREATE_NS });
    createIq = createIq.c('configuration').c('roomname', {}, params.roomName).up();
    createIq = createIq.c('occupants');
    for (const jid of params.memberJids) {
      createIq = createIq.c('user', { affiliation: 'member' }, jid);
    }

    connection.sendIQ(
      createIq,
      () => {
        // Ack only confirms the server accepted the request — the real
        // confirmation (and the room JID) is the notification handled above.
      },
      () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        connection.deleteHandler(handlerRef);
        reject(new Error('createGroupRoom: create IQ failed or timed out'));
      },
      QUERY_TIMEOUT_MS,
    );
  });
}

export function renameGroupRoom(roomJid: string, name: string): Promise<void> {
  const connection = requireConnection();
  return new Promise((resolve, reject) => {
    const iq = $iq({ type: 'set', to: roomJid })
      .c('query', { xmlns: CONFIGURATION_NS })
      .c('roomname', {}, name);
    connection.sendIQ(
      iq,
      () => resolve(),
      () => reject(new Error('renameGroupRoom: failed or timed out')),
      QUERY_TIMEOUT_MS,
    );
  });
}

/** One call covers invite (`member`), promote (`owner`), demote (`member`), kick/leave (`none`). */
export function setGroupAffiliation(
  roomJid: string,
  memberJid: string,
  affiliation: GroupAffiliation,
): Promise<void> {
  const connection = requireConnection();
  return new Promise((resolve, reject) => {
    const iq = $iq({ type: 'set', to: roomJid })
      .c('query', { xmlns: AFFILIATIONS_NS })
      .c('user', { affiliation }, memberJid);
    connection.sendIQ(
      iq,
      () => resolve(),
      () => reject(new Error('setGroupAffiliation: failed or timed out')),
      QUERY_TIMEOUT_MS,
    );
  });
}

/** Best-effort: resolves `{ roomname: null }` on failure/timeout rather than rejecting — used as optional enrichment. */
export function fetchGroupConfig(roomJid: string): Promise<{ roomname: string | null }> {
  const connection = requireConnection();
  return new Promise((resolve) => {
    const iq = $iq({ type: 'get', to: roomJid }).c('query', { xmlns: CONFIGURATION_NS });
    connection.sendIQ(
      iq,
      (stanza) => {
        const queryEl = firstChildByTagNameNs(stanza, 'query', CONFIGURATION_NS);
        const roomname = queryEl ? (firstChildByTagName(queryEl, 'roomname')?.textContent ?? null) : null;
        resolve({ roomname });
      },
      () => resolve({ roomname: null }),
      QUERY_TIMEOUT_MS,
    );
  });
}

export function fetchGroupAffiliations(roomJid: string): Promise<GroupAffiliationEntry[]> {
  const connection = requireConnection();
  return new Promise((resolve, reject) => {
    const iq = $iq({ type: 'get', to: roomJid }).c('query', { xmlns: AFFILIATIONS_NS });
    connection.sendIQ(
      iq,
      (stanza) => {
        const queryEl = firstChildByTagNameNs(stanza, 'query', AFFILIATIONS_NS);
        resolve(queryEl ? parseAffiliationUsers(queryEl) : []);
      },
      () => reject(new Error('fetchGroupAffiliations: failed or timed out')),
      QUERY_TIMEOUT_MS,
    );
  });
}

export function destroyGroupRoom(roomJid: string): Promise<void> {
  const connection = requireConnection();
  return new Promise((resolve, reject) => {
    const iq = $iq({ type: 'set', to: roomJid }).c('query', { xmlns: DESTROY_NS });
    connection.sendIQ(
      iq,
      () => resolve(),
      () => reject(new Error('destroyGroupRoom: failed or timed out')),
      QUERY_TIMEOUT_MS,
    );
  });
}

/** `disco#items` to the MUC domain — every room this account currently occupies. */
export function fetchGroupRooms(): Promise<{ jid: string; name: string | null }[]> {
  const connection = requireConnection();
  const mucDomain = getMucDomain(connection);
  return new Promise((resolve, reject) => {
    const iq = $iq({ type: 'get', to: mucDomain }).c('query', { xmlns: DISCO_ITEMS_NS });
    connection.sendIQ(
      iq,
      (stanza) => {
        const items: { jid: string; name: string | null }[] = [];
        const nodes = stanza.getElementsByTagName('item');
        for (let i = 0; i < nodes.length; i += 1) {
          const jid = nodes[i]?.getAttribute('jid');
          if (jid) items.push({ jid, name: nodes[i]?.getAttribute('name') ?? null });
        }
        resolve(items);
      },
      () => reject(new Error('fetchGroupRooms: disco#items failed or timed out')),
      QUERY_TIMEOUT_MS,
    );
  });
}
