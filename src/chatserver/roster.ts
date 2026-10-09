import { $iq, $pres, Strophe, type StropheConnection } from 'react-native-strophe';

/**
 * XMPP roster + presence-subscription protocol layer — same shape/
 * conventions as muclight.ts/receiptStanzas.ts. Stanza shapes confirmed
 * against this exact server via the reference
 * ChatServerConf/xmpp/strophe.roster.js implementation (`jabber:iq:roster`
 * IQs + RFC 6121 presence `subscribe`/`subscribed`/`unsubscribed` types).
 * Deliberately narrow: no roster versioning (XEP-237), full roster fetch, or
 * remove/unsubscribe — the local `Contact` table is already this app's
 * source of truth for "who do we know" (see roster-presence-subscriptions
 * plan).
 */

export function sendRosterAdd(connection: StropheConnection, jid: string, name?: string): void {
  const itemAttrs: Record<string, string> = { jid };
  if (name) itemAttrs.name = name;
  const iq = $iq({ type: 'set' }).c('query', { xmlns: Strophe.NS.ROSTER }).c('item', itemAttrs);
  connection.send(iq.tree());
}

export function sendPresenceSubscribe(connection: StropheConnection, jid: string): void {
  connection.send($pres({ to: jid, type: 'subscribe' }).tree());
}

/** Accept an incoming subscription request. */
export function sendPresenceSubscribed(connection: StropheConnection, jid: string): void {
  connection.send($pres({ to: jid, type: 'subscribed' }).tree());
}

/** Reject an incoming subscription request — explicit, not silence. */
export function sendPresenceUnsubscribed(connection: StropheConnection, jid: string): void {
  connection.send($pres({ to: jid, type: 'unsubscribed' }).tree());
}
