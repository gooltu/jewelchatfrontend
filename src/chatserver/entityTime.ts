import { $iq } from 'react-native-strophe';
import { getConnection, isConnected } from './stropheClient';

/** XEP-0202 Entity Time. */
const ENTITY_TIME_NS = 'urn:xmpp:time';
const QUERY_TIMEOUT_MS = 10_000;

/** Queries the connected chat server's current time via XEP-0202. Returns epoch milliseconds. */
export function getChatServerTime(): Promise<number> {
  return new Promise((resolve, reject) => {
    const connection = getConnection();
    if (!connection || !isConnected()) {
      reject(new Error('getChatServerTime: not connected'));
      return;
    }

    if (!connection.domain) {
      reject(new Error('getChatServerTime: connection has no domain yet'));
      return;
    }

    // `to` must be the bare server domain (e.g. "jewelchat.net") — this
    // server does not answer an undirected entity-time query. `Strophe`
    // sets `connection.domain` from the connected JID right after auth
    // (see react-native-strophe/src/core.js), so it always matches.
    const iq = $iq({ type: 'get', to: connection.domain }).c('time', { xmlns: ENTITY_TIME_NS });
    connection.sendIQ(
      iq,
      (stanza) => {
        const utc = stanza.getElementsByTagName('utc')[0]?.textContent;
        if (!utc) {
          reject(new Error('getChatServerTime: missing <utc> in response'));
          return;
        }
        resolve(new Date(utc).getTime());
      },
      () => reject(new Error('getChatServerTime: query failed or timed out')),
      QUERY_TIMEOUT_MS,
    );
  });
}
