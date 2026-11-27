'use strict';
/**
 * A WebSocket-only @xmpp/client that offers ONLY SASL PLAIN.
 *
 * Why: with stock @xmpp/client (which always picks SCRAM-SHA-1 first) the
 * chat server (MongooseIM, HTTP auth backend — see ChatServerConf/CLAUDE.md,
 * "HTTP auth backend") answered <not-authorized/>; SASL PLAIN with the same
 * refresh token works. The app itself also uses only PLAIN over wss (see
 * stropheClient.resolveSaslMechanisms), so the bot now matches it.
 * @xmpp/client has no option to drop a mechanism, so this is its own
 * `client()` factory (v0.13) with the same pieces, minus SCRAM/ANONYMOUS and
 * the TCP/TLS transports we never use.
 *
 * Sub-packages are resolved relative to @xmpp/client itself, so this works
 * however npm hoists them.
 */
const path = require('node:path');
const { createRequire } = require('node:module');

const clientDir = path.dirname(require.resolve('@xmpp/client/package.json'));
const req = createRequire(path.join(clientDir, 'index.js'));

const { xml, Client } = req('@xmpp/client-core');
const _websocket = req('@xmpp/websocket');
const _middleware = req('@xmpp/middleware');
const _streamFeatures = req('@xmpp/stream-features');
const _iqCaller = req('@xmpp/iq/caller');
const _iqCallee = req('@xmpp/iq/callee');
const _sasl = req('@xmpp/sasl');
const _resourceBinding = req('@xmpp/resource-binding');
const _sessionEstablishment = req('@xmpp/session-establishment');
const plain = req('@xmpp/sasl-plain');

function plainClient({ resource, username, password, ...params }) {
  const entity = new Client(params);
  _websocket({ entity });
  const middleware = _middleware({ entity });
  const streamFeatures = _streamFeatures({ middleware });
  const iqCaller = _iqCaller({ middleware, entity });
  _iqCallee({ middleware, entity });
  const sasl = _sasl({ streamFeatures }, { username, password });
  _resourceBinding({ iqCaller, streamFeatures }, resource);
  _sessionEstablishment({ iqCaller, streamFeatures });
  plain(sasl);
  // Exposed so the bot can send IQs and await their results (MUC Light).
  entity.iqCaller = iqCaller;
  return entity;
}

module.exports = { plainClient, xml };
