import { $iq, Strophe } from 'react-native-strophe';
import { getConnection, isConnected } from './stropheClient';

/**
 * XEP-0357 (Push Notifications) protocol layer, same conventions as
 * muclight.ts / roster.ts. The stanza shape is the exact contract documented
 * in ChatServerConf/conf/mongooseim.toml's mod_event_pusher.push section:
 *
 * - `jid` must be `pubsub.<domain>`, MongooseIM's `virtual_pubsub_hosts`.
 *   That routes the push straight to mod_push_service_mongoosepush, which
 *   POSTs to the game server. ServerProjextX's pushnotificationv3 then sends
 *   it through FCM.
 * - The publish-options form must carry both `device_id` (the FCM token) and
 *   `service` (`fcm`). If either is missing, the push silently does nothing
 *   or crashes the request handler.
 * - `node` is XEP-0357's opaque per-registration key: a stable per-install
 *   id (see pushService.ts), so re-enabling on every connect replaces the
 *   previous registration instead of piling up duplicates.
 */

export const PUSH_NS = 'urn:xmpp:push:0';
const DATA_FORMS_NS = 'jabber:x:data';
const PUBLISH_OPTIONS_FORM_TYPE = 'http://jabber.org/protocol/pubsub#publish-options';
const IQ_TIMEOUT_MS = 10_000;

export function pushServiceJid(myJid: string): string {
  const domain = Strophe.getDomainFromJid(myJid);
  if (!domain) throw new Error(`pushServiceJid: no domain in ${myJid}`);
  return `pubsub.${domain}`;
}

export function buildPushEnableIq(myJid: string, nodeId: string, fcmToken: string) {
  return $iq({ type: 'set' })
    .c('enable', { xmlns: PUSH_NS, jid: pushServiceJid(myJid), node: nodeId })
    .c('x', { xmlns: DATA_FORMS_NS, type: 'submit' })
    .c('field', { var: 'FORM_TYPE' }).c('value').t(PUBLISH_OPTIONS_FORM_TYPE).up().up()
    .c('field', { var: 'device_id' }).c('value').t(fcmToken).up().up()
    .c('field', { var: 'service' }).c('value').t('fcm');
}

export function buildPushDisableIq(myJid: string, nodeId: string) {
  return $iq({ type: 'set' }).c('disable', { xmlns: PUSH_NS, jid: pushServiceJid(myJid), node: nodeId });
}

function sendIqAndWait(iq: ReturnType<typeof $iq>, label: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const connection = getConnection();
    if (!connection || !isConnected()) {
      reject(new Error(`${label}: not connected`));
      return;
    }
    connection.sendIQ(
      iq,
      () => resolve(),
      () => reject(new Error(`${label}: failed or timed out`)),
      IQ_TIMEOUT_MS,
    );
  });
}

export function enablePush(myJid: string, nodeId: string, fcmToken: string): Promise<void> {
  return sendIqAndWait(buildPushEnableIq(myJid, nodeId, fcmToken), 'enablePush');
}

export function disablePush(myJid: string, nodeId: string): Promise<void> {
  return sendIqAndWait(buildPushDisableIq(myJid, nodeId), 'disablePush');
}
