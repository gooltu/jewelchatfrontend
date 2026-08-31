/**
 * XMPP connection manager built on `react-native-strophe` — a local
 * workspace package (`file:../react-native-strophe`), not upstream
 * browser `strophe.js`. Its README/source were read directly (there is no
 * npm registry copy to trust blindly) before writing this file. Summary of
 * what was confirmed in ../react-native-strophe/src:
 *
 * - Pure JS. `index.js` polyfills `global.DOMParser`/`document`/`atob`/
 *   `btoa` (via `xmldom` + `base-64`) and attaches `Strophe`/`$build`/
 *   `$iq`/`$msg`/`$pres` onto `global`, matching upstream Strophe's usual
 *   global API, while also exporting them as named exports.
 * - No `ios/`/`android/` native code and no entries in `package.json` for
 *   an Expo config plugin or native module — confirmed by inspecting the
 *   package directory. It is a plain JS dependency, so it runs fine under
 *   plain Expo Go / the managed workflow. **No custom dev client is
 *   required for react-native-strophe itself** — see notifications/
 *   pushNotifications.ts for the one dev-client caveat that *does* apply
 *   to this app (remote push, unrelated to XMPP).
 * - Transport: `new Strophe.Connection(service, options)` auto-selects
 *   WebSocket vs BOSH from the `service` URL scheme — `ws:`/`wss:` (or
 *   `options.protocol` starting with `ws`) selects `Strophe.Websocket`;
 *   anything else (an `http(s)://.../http-bind` URL) selects
 *   `Strophe.Bosh`. This app defaults to WS and only falls back to BOSH
 *   if a `chatserverUrl` with an http(s) scheme is configured — see
 *   `resolveTransportUrl` below. Server-side requirement: the chat server
 *   must expose either an XMPP-over-WebSocket endpoint (RFC 7395, the
 *   `xmpp` subprotocol) or a BOSH endpoint (XEP-0124/0206).
 * - `connection.connect(jid, pass, callback, wait?, hold?, route?, authcid?)`
 *   — `callback: (status: number, condition?: string) => void` fires on
 *   every state transition; `status` is one of `Strophe.Status.*`
 *   (ERROR, CONNECTING, CONNFAIL, AUTHENTICATING, AUTHFAIL, CONNECTED,
 *   DISCONNECTED, DISCONNECTING, ATTACHED, REDIRECT, CONNTIMEOUT).
 * - `connection.addHandler(handler, ns, name, type, id, from, options)`
 *   registers a stanza handler; `handler: (stanza: Element) => boolean`,
 *   returning `true` keeps it registered for future stanzas, `false`
 *   removes it after this call. Used by stropheEvents.ts, not here.
 * - `connection.send(stanzaOrBuilder)` / `connection.sendIQ(elem, cb, errback, timeout)`.
 * - `connection.disconnect(reason?)` — triggers a DISCONNECTING then
 *   DISCONNECTED status callback once the stream closes cleanly.
 */
import { Strophe, type StropheConnection } from 'react-native-strophe';
import { env } from '../config/env';

export type ConnectionStatus =
  | 'error'
  | 'connecting'
  | 'connfail'
  | 'authenticating'
  | 'authfail'
  | 'connected'
  | 'disconnected'
  | 'disconnecting'
  | 'attached'
  | 'redirect'
  | 'conntimeout';

const STATUS_BY_VALUE: Record<number, ConnectionStatus> = {
  [Strophe.Status.ERROR]: 'error',
  [Strophe.Status.CONNECTING]: 'connecting',
  [Strophe.Status.CONNFAIL]: 'connfail',
  [Strophe.Status.AUTHENTICATING]: 'authenticating',
  [Strophe.Status.AUTHFAIL]: 'authfail',
  [Strophe.Status.CONNECTED]: 'connected',
  [Strophe.Status.DISCONNECTED]: 'disconnected',
  [Strophe.Status.DISCONNECTING]: 'disconnecting',
  [Strophe.Status.ATTACHED]: 'attached',
  [Strophe.Status.REDIRECT]: 'redirect',
  [Strophe.Status.CONNTIMEOUT]: 'conntimeout',
};

const FAILURE_STATUSES: ConnectionStatus[] = ['connfail', 'authfail', 'conntimeout', 'error'];
const MAX_RECONNECT_DELAY_MS = 30_000;
const BASE_RECONNECT_DELAY_MS = 1_000;

type StatusListener = (status: ConnectionStatus, condition?: string) => void;

let connection: StropheConnection | null = null;
let statusListeners: StatusListener[] = [];
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
let manuallyDisconnected = false;
let lastCredentials: { jid: string; password: string } | null = null;

/** Prefers WS; falls back to BOSH only if chatserverUrl is configured with an http(s) scheme. */
function resolveTransportUrl(): string {
  return env.chatserverUrl;
}

export function getConnection(): StropheConnection | null {
  return connection;
}

export function onConnectionStatusChange(listener: StatusListener): () => void {
  statusListeners.push(listener);
  return () => {
    statusListeners = statusListeners.filter((l) => l !== listener);
  };
}

function emitStatus(status: ConnectionStatus, condition?: string): void {
  for (const listener of statusListeners) listener(status, condition);
}

export function connect(jid: string, password: string): void {
  manuallyDisconnected = false;
  lastCredentials = { jid, password };
  clearReconnectTimer();

  if (!connection) {
    connection = new Strophe.Connection(resolveTransportUrl());
  }

  emitStatus('connecting');
  connection.connect(jid, password, (statusValue: number, condition?: string) => {
    const status = STATUS_BY_VALUE[statusValue] ?? 'error';
    emitStatus(status, condition);

    if (status === 'connected') {
      reconnectAttempts = 0;
    } else if (!manuallyDisconnected && FAILURE_STATUSES.includes(status)) {
      scheduleReconnect();
    } else if (!manuallyDisconnected && status === 'disconnected') {
      scheduleReconnect();
    }
  });
}

function scheduleReconnect(): void {
  if (!lastCredentials || reconnectTimer) return;
  const delay = Math.min(
    BASE_RECONNECT_DELAY_MS * 2 ** reconnectAttempts,
    MAX_RECONNECT_DELAY_MS,
  );
  reconnectAttempts += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (lastCredentials && !manuallyDisconnected) {
      connect(lastCredentials.jid, lastCredentials.password);
    }
  }, delay);
}

function clearReconnectTimer(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

export function disconnect(reason?: string): void {
  manuallyDisconnected = true;
  clearReconnectTimer();
  connection?.disconnect(reason);
}

/** Test/dev-only escape hatch, mirrors database/index.ts's resetDatabaseConnection. */
export function resetConnectionForTests(): void {
  clearReconnectTimer();
  connection = null;
  statusListeners = [];
  reconnectAttempts = 0;
  manuallyDisconnected = false;
  lastCredentials = null;
}
