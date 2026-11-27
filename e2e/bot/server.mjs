#!/usr/bin/env node
/**
 * E2E "bot peer" server — Layer 1 of the multi-device test strategy.
 *
 * Logs one or more test accounts into the real game server + chat server
 * (phone -> OTP -> refresh token -> XMPP, exactly like the app does), then
 * exposes a tiny localhost HTTP API so Maestro flows (via `runScript`, see
 * ../maestro/scripts/bot.js) can make "the other person" send messages, type,
 * react, go on/offline, and can assert on what the app sent them.
 *
 * Uses @xmpp/client, NOT the app's own react-native-strophe code, on purpose:
 * an independent XMPP implementation catches wire-format bugs that sharing the
 * app's stanza builders would hide.
 *
 * Usage:  node e2e/bot/server.mjs            (config from env, see below)
 *
 *   E2E_DEVICE_PHONE   10-digit number the device under test logs in with
 *   E2E_BOT_PHONES     comma list of `name:10digits`, e.g. alice:9000000001
 *   E2E_OTP            defaults to 888888 (server-side hardcoded test OTP)
 *   E2E_GAMESERVER     defaults to https://game.jewelchat.net
 *   E2E_CHATSERVER     defaults to wss://chat.jewelchat.net/ws-xmpp
 *   E2E_BOT_PORT       defaults to 7777
 *   E2E_COUNTRY_CODE   defaults to 91 (matches authService's COUNTRY_CODE)
 */
import http from 'node:http';
import { randomUUID } from 'node:crypto';
// SASL-PLAIN-only build of @xmpp/client — see plainClient.cjs for why.
import plainClientPkg from './plainClient.cjs';

const { plainClient: xmppClient, xml } = plainClientPkg;

const cfg = {
  devicePhone: requiredEnv('E2E_DEVICE_PHONE'),
  bots: parseBots(requiredEnv('E2E_BOT_PHONES')),
  otp: process.env.E2E_OTP ?? '888888',
  gameserver: (process.env.E2E_GAMESERVER ?? 'https://game.jewelchat.net').replace(/\/$/, ''),
  chatserver: process.env.E2E_CHATSERVER ?? 'wss://chat.jewelchat.net/ws-xmpp',
  port: Number(process.env.E2E_BOT_PORT ?? 7777),
  countryCode: process.env.E2E_COUNTRY_CODE ?? '91',
};

// Namespaces — must match src/chatserver/receiptStanzas.ts / stropheEvents.ts.
const NS = {
  receipts: 'urn:xmpp:receipts',
  markers: 'urn:xmpp:chat-markers:0',
  chatStates: 'http://jabber.org/protocol/chatstates',
  reactions: 'urn:xmpp:reactions:0',
  roster: 'jabber:iq:roster',
  // MUC Light — must match src/chatserver/muclight.ts.
  muclight: 'urn:xmpp:muclight:0',
  mlCreate: 'urn:xmpp:muclight:0#create',
  mlAffiliations: 'urn:xmpp:muclight:0#affiliations',
  mlConfiguration: 'urn:xmpp:muclight:0#configuration',
  discoItems: 'http://jabber.org/protocol/disco#items',
};

/** @type {Map<string, Bot>} */
const bots = new Map();
/** Rooms created with a `key`, so a later flow can find a room an earlier one made. */
const roomsByKey = new Map();
/** The device's own identity, resolved once at startup. */
let device = /** @type {{ userId: number, jid: string, phone: string } | null} */ (null);

// ---------------------------------------------------------------------------
// Game-server auth (same contract as src/gameserver/phoneAuthApi.ts)
// ---------------------------------------------------------------------------

async function gamePost(path, body, accessToken) {
  const res = await fetch(`${cfg.gameserver}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`${path} -> HTTP ${res.status}, non-JSON body: ${text.slice(0, 200)}`);
  }
  if (!res.ok || data.error) {
    throw new Error(`${path} -> HTTP ${res.status}: ${data.message ?? text.slice(0, 200)}`);
  }
  return data;
}

/** registerPhoneNumber only — enough to learn a number's userId + domain. */
async function lookupIdentity(phone10) {
  const reg = await gamePost('/registerPhoneNumber', { phone: `${cfg.countryCode}${phone10}` });
  return { userId: reg.userId, domain: reg.domain, active: reg.active };
}

/** Full sign-in: register -> verify (fixed OTP) -> access token. New accounts
 * skip /initialDetails, exactly like ReferralCodeScreen's "Skip" (which never
 * calls it — the server rejects an empty referrer). Bots don't set a name. */
async function signIn(phone10) {
  const { userId, domain } = await lookupIdentity(phone10);
  const { refreshToken } = await gamePost('/verifyCode', { userId, verificationCode: cfg.otp });
  const { accessToken } = await gamePost('/getAccessToken', { refreshToken });
  return { userId, domain, refreshToken, accessToken, jid: `${userId}@${domain}` };
}

// ---------------------------------------------------------------------------
// Bot
// ---------------------------------------------------------------------------

class Bot {
  constructor(name, phone) {
    this.name = name;
    this.phone = phone;
    this.jid = '';
    this.userId = 0;
    this.xmpp = null;
    this.online = false;
    /** Auto-send <received/>/<displayed/> for messages the device sends us. */
    this.autoReceipts = { received: true, displayed: true };
    /** Everything chat-relevant the bot has received, newest last. */
    this.inbox = /** @type {InboxEntry[]} */ ([]);
    this.waiters = new Set();
    /** Group rooms (bare JIDs) this bot is currently a member/owner of. */
    this.rooms = new Set();
  }

  async start() {
    const session = await signIn(this.phone);
    Object.assign(this, { jid: session.jid, userId: session.userId });
    const [, domain] = session.jid.split('@');
    this.xmpp = xmppClient({
      service: cfg.chatserver,
      domain,
      username: String(session.userId),
      // Same as the app: chatService.connect(jid, refreshToken) — the chat
      // server accepts the refresh token as the SASL password.
      password: session.refreshToken,
      resource: `e2e-${this.name}-${randomUUID().slice(0, 6)}`,
    });
    this.xmpp.on('error', (err) => log(this.name, 'xmpp error', err.message));
    for (const ev of ['offline', 'disconnect']) {
      this.xmpp.on(ev, () => {
        this.online = false;
      });
    }
    this.xmpp.on('stanza', (stanza) => this.onStanza(stanza));
    await this.xmpp.start();
    this.online = true;
    // Initial bare <presence/> — required for this server's mod_presence to
    // start routing roster presence at all (see CLAUDE.md "Roster & presence").
    await this.xmpp.send(xml('presence'));
    log(this.name, `online as ${this.jid} (phone ${this.phone})`);
  }

  /** The server drops idle sessions and the PLAIN client has no auto-reconnect,
   * so every HTTP call re-establishes the session first if it's gone. */
  async ensureOnline() {
    if (this.xmpp && this.xmpp.status === 'online') return;
    log(this.name, `session is ${this.xmpp ? this.xmpp.status : 'absent'}, reconnecting`);
    if (this.xmpp) {
      this.xmpp.removeAllListeners();
      await this.xmpp.stop().catch(() => {});
    }
    await this.start();
  }

  onStanza(stanza) {
    if (stanza.is('presence')) return this.onPresence(stanza);
    if (!stanza.is('message')) return;
    if (stanza.attrs.type === 'groupchat') return this.onGroupStanza(stanza);
    const from = bare(stanza.attrs.from);
    const id = stanza.attrs.id ?? null;
    const now = Date.now();

    const received = stanza.getChild('received', NS.receipts);
    const displayed = stanza.getChild('displayed', NS.markers);
    const reactions = stanza.getChild('reactions', NS.reactions);
    const chatState = ['composing', 'paused', 'active', 'inactive', 'gone'].find((s) =>
      stanza.getChild(s, NS.chatStates),
    );
    const body = stanza.getChildText('body');

    if (received || displayed) {
      const el = received ?? displayed;
      return this.push({ kind: received ? 'received' : 'displayed', from, refId: el.attrs.id, at: now });
    }
    if (reactions) {
      const emojis = reactions.getChildren('reaction').map((r) => r.text());
      return this.push({ kind: 'reaction', from, refId: reactions.attrs.id, emojis, at: now });
    }
    if (body) {
      const reply = stanza.getChild('reply');
      const media = stanza.getChild('media');
      this.push({
        kind: 'message',
        from,
        id,
        type: stanza.attrs.type,
        msgtype: stanza.attrs.msgtype ?? null,
        forwarded: stanza.attrs.forwarded === '1',
        body,
        reply: reply ? { id: reply.attrs.id, creator: reply.attrs.creator } : null,
        media: media ? { ...media.attrs } : null,
        at: now,
      });
      // The app sends receipts unconditionally (no <request/>), and expects
      // the same back — see stropheEvents.ts. `id` is the sender's local _ID.
      if (id && stanza.attrs.type === 'chat') {
        if (this.autoReceipts.received) void this.sendReceipt(stanza.attrs.from, id, 'received');
        if (this.autoReceipts.displayed) void this.sendReceipt(stanza.attrs.from, id, 'displayed');
      }
      return;
    }
    if (chatState) this.push({ kind: 'chatstate', from, state: chatState, at: now });
  }

  onPresence(stanza) {
    const from = bare(stanza.attrs.from);
    const type = stanza.attrs.type ?? 'available';
    if (from === this.jid) return;
    if (type === 'subscribe') {
      // Tests want a working relationship, so always accept + reciprocate.
      void this.xmpp.send(xml('presence', { to: from, type: 'subscribed' }));
      void this.xmpp.send(xml('presence', { to: from, type: 'subscribe' }));
    }
    this.push({ kind: 'presence', from, type, at: Date.now() });
  }

  push(entry) {
    this.inbox.push(entry);
    if (this.inbox.length > 500) this.inbox.shift();
    log(this.name, '<-', JSON.stringify(entry));
    for (const w of this.waiters) w();
  }

  /** Resolves with the first inbox entry (at/after `since`) matching `pred`. */
  waitFor(pred, { since = 0, timeoutMs = 20000 } = {}) {
    return new Promise((resolve, reject) => {
      const check = () => {
        const hit = this.inbox.find((e) => e.at >= since && pred(e));
        if (hit) {
          cleanup();
          resolve(hit);
        }
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new HttpError(408, `${this.name}: timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      const cleanup = () => {
        clearTimeout(timer);
        this.waiters.delete(check);
      };
      this.waiters.add(check);
      check();
    });
  }

  async sendMessage(to, { text, id = `e2e-${randomUUID()}`, replyTo = null, forwarded = false }) {
    const children = [xml('body', {}, text)];
    if (replyTo) children.push(xml('reply', { id: replyTo.id, creator: replyTo.creator }));
    children.push(xml('active', { xmlns: NS.chatStates }));
    await this.xmpp.send(
      xml('message', { to, type: 'chat', id, msgtype: '0' /* MSG_TYPE.TEXT (src/types/chat.ts) */, ...(forwarded ? { forwarded: '1' } : {}) }, ...children),
    );
    return id;
  }

  sendReceipt(to, id, kind) {
    const el = kind === 'received' ? xml('received', { xmlns: NS.receipts, id }) : xml('displayed', { xmlns: NS.markers, id });
    return this.xmpp.send(xml('message', { to }, el));
  }

  sendChatState(to, state) {
    return this.xmpp.send(xml('message', { to, type: 'chat' }, xml(state, { xmlns: NS.chatStates })));
  }

  sendReactions(to, msgId, emojis) {
    return this.xmpp.send(
      xml(
        'message',
        { to, type: 'chat', id: `e2e-react-${randomUUID()}` },
        xml('reactions', { xmlns: NS.reactions, id: msgId }, ...emojis.map((e) => xml('reaction', {}, e))),
      ),
    );
  }

  /** MUC Light room traffic: `from` is `room@muclight.<domain>/<member bare JID>`
   * for messages, and the bare room JID for affiliation/config notifications. */
  onGroupStanza(stanza) {
    const fromAttr = stanza.attrs.from ?? '';
    const room = bare(fromAttr);
    const slash = fromAttr.indexOf('/');
    const sender = slash >= 0 ? fromAttr.slice(slash + 1) : '';
    const now = Date.now();

    const aff = stanza.getChild('x', NS.mlAffiliations);
    if (aff) {
      const users = aff.getChildren('user').map((u) => ({ jid: u.text().trim(), affiliation: u.attrs.affiliation }));
      const me = users.find((u) => u.jid === this.jid);
      if (me && me.affiliation === 'none') this.rooms.delete(room);
      else if (me) this.rooms.add(room);
      return this.push({ kind: 'affiliations', room, users, at: now });
    }
    const conf = stanza.getChild('x', NS.mlConfiguration);
    if (conf) return this.push({ kind: 'groupconfig', room, roomname: conf.getChildText('roomname'), at: now });

    const reactions = stanza.getChild('reactions', NS.reactions);
    if (reactions) {
      const emojis = reactions.getChildren('reaction').map((r) => r.text());
      return this.push({ kind: 'groupreaction', room, sender, refId: reactions.attrs.id, emojis, at: now });
    }
    const body = stanza.getChildText('body');
    if (!body) return;
    const reply = stanza.getChild('reply');
    this.push({
      kind: 'groupmessage',
      room,
      sender,
      id: stanza.attrs.id ?? null,
      msgtype: stanza.attrs.msgtype ?? null,
      forwarded: stanza.attrs.forwarded === '1',
      body,
      reply: reply ? { id: reply.attrs.id, creator: reply.attrs.creator } : null,
      at: now,
    });
  }

  mucDomain() {
    return `muclight.${this.jid.split('@')[1]}`;
  }

  /** Creates a room with `memberJids` as members (this bot is owner). The
   * create IQ's result is empty, so — like the app (muclight.createGroupRoom)
   * — the room JID comes from the #affiliations notification that follows. */
  async createGroup(name, memberJids) {
    const since = Date.now();
    const known = new Set(this.rooms);
    await this.xmpp.iqCaller.request(
      xml(
        'iq',
        { type: 'set', to: this.mucDomain(), id: `e2e-create-${randomUUID()}` },
        xml(
          'query',
          { xmlns: NS.mlCreate },
          xml('configuration', {}, xml('roomname', {}, name)),
          xml('occupants', {}, ...memberJids.map((jid) => xml('user', { affiliation: 'member' }, jid))),
        ),
      ),
      15000,
    );
    const note = await this.waitFor((e) => e.kind === 'affiliations' && !known.has(e.room), { since, timeoutMs: 15000 });
    this.rooms.add(note.room);
    return note.room;
  }

  async setAffiliation(room, jid, affiliation) {
    await this.xmpp.iqCaller.request(
      xml(
        'iq',
        { type: 'set', to: room, id: `e2e-aff-${randomUUID()}` },
        xml('query', { xmlns: NS.mlAffiliations }, xml('user', { affiliation }, jid)),
      ),
      15000,
    );
  }

  async renameGroup(room, name) {
    await this.xmpp.iqCaller.request(
      xml(
        'iq',
        { type: 'set', to: room, id: `e2e-conf-${randomUUID()}` },
        xml('query', { xmlns: NS.mlConfiguration }, xml('roomname', {}, name)),
      ),
      15000,
    );
  }

  /** Same shape the app sends (syncService.attemptSend), with type=groupchat. */
  async sendGroupMessage(room, { text, id = `e2e-${randomUUID()}`, replyTo = null }) {
    const children = [xml('body', {}, text)];
    if (replyTo) children.push(xml('reply', { id: replyTo.id, creator: replyTo.creator }));
    await this.xmpp.send(xml('message', { to: room, type: 'groupchat', id, msgtype: '0' }, ...children));
    return id;
  }

  sendGroupReactions(room, msgId, emojis) {
    return this.xmpp.send(
      xml(
        'message',
        { to: room, type: 'groupchat', id: `e2e-react-${randomUUID()}` },
        xml('reactions', { xmlns: NS.reactions, id: msgId }, ...emojis.map((e) => xml('reaction', {}, e))),
      ),
    );
  }

  async setAvailable(available) {
    await this.xmpp.send(available ? xml('presence') : xml('presence', { type: 'unavailable' }));
  }

  async subscribeTo(jid) {
    await this.xmpp.send(
      xml('iq', { type: 'set', id: `e2e-roster-${randomUUID()}` }, xml('query', { xmlns: NS.roster }, xml('item', { jid }))),
    );
    await this.xmpp.send(xml('presence', { to: jid, type: 'subscribe' }));
  }

  async stop() {
    if (this.xmpp) await this.xmpp.stop().catch(() => {});
  }

  describe() {
    return { name: this.name, phone: this.phone, userId: this.userId, jid: this.jid, online: this.online };
  }
}

// ---------------------------------------------------------------------------
// HTTP API (localhost only). Every route is POST with a JSON body except
// GET /health and GET /bots. All responses are JSON.
// ---------------------------------------------------------------------------

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function getBot(name) {
  const bot = bots.get(name ?? '');
  if (!bot) throw new HttpError(404, `unknown bot "${name}" (have: ${[...bots.keys()].join(', ')})`);
  return bot;
}

/** `to` defaults to the device; also accepts another bot's name or a raw JID. */
function resolveTo(to) {
  if (!to || to === 'device') return device.jid;
  if (bots.has(to)) return bots.get(to).jid;
  return to;
}

const routes = {
  'GET /health': () => ({ ok: true, device, bots: [...bots.values()].map((b) => b.describe()) }),
  'GET /bots': () => ({ device, bots: [...bots.values()].map((b) => b.describe()), rooms: roomsInfo() }),

  /** Clear inboxes between flows; optionally reset auto-receipt behaviour. */
  'POST /reset': () => {
    for (const b of bots.values()) {
      b.inbox = [];
      b.autoReceipts = { received: true, displayed: true };
    }
    return { ok: true, at: Date.now() };
  },

  /** { bot, to?, text, replyToId?, replyToCreator? } -> { id } */
  'POST /send': async (b) => {
    const bot = getBot(b.bot);
    const replyTo = b.replyToId ? { id: String(b.replyToId), creator: b.replyToCreator ?? device.jid } : null;
    const id = await bot.sendMessage(resolveTo(b.to), {
      text: b.text ?? '',
      replyTo,
      forwarded: !!b.forwarded && b.forwarded !== 'false',
      ...(b.id ? { id: String(b.id) } : {}),
    });
    return { id };
  },

  /** { bot, to?, count, text? } -> { ids } — `count` messages back to back,
   * texts "<text> 1".."<text> N", for ordering / dedup checks. */
  'POST /burst': async (b) => {
    const bot = getBot(b.bot);
    const n = Math.min(Number(b.count ?? 10), 100);
    const ids = [];
    for (let i = 1; i <= n; i += 1) ids.push(await bot.sendMessage(resolveTo(b.to), { text: `${b.text ?? 'burst'} ${i}` }));
    return { ids, id: ids[ids.length - 1] };
  },

  // ---- Groups (MUC Light) -------------------------------------------------
  // `room` is a bare room JID (from group-create). Member names accept
  // "device", a bot name, or a raw JID (see resolveTo).

  /** { bot, name, members: "device,bob" | string[] } -> { room } */
  'POST /group-create': async (b) => {
    const members = listOf(b.members).map(resolveTo);
    const room = await getBot(b.bot).createGroup(String(b.name ?? 'E2E group'), members);
    if (b.key) roomsByKey.set(String(b.key), room);
    return { room, id: room, node: room.split('@')[0] };
  },

  /** { bot, count, name, members } -> { rooms } — e.g. 12 rooms for the paging test. */
  'POST /group-create-many': async (b) => {
    const bot = getBot(b.bot);
    const members = listOf(b.members).map(resolveTo);
    const rooms = [];
    for (let i = 1; i <= Math.min(Number(b.count ?? 1), 30); i += 1) {
      const room = await bot.createGroup(`${b.name ?? 'E2E group'} ${i}`, members);
      rooms.push(room);
      // The chat list hides a group until it has a message, so post one.
      if (b.text) await bot.sendGroupMessage(room, { text: `${b.text} ${i}` });
    }
    return { rooms };
  },

  /** { bot, room, member, affiliation?: member|owner|none } */
  'POST /group-add': async (b) => {
    await getBot(b.bot).setAffiliation(roomOf(b.room), resolveTo(b.member), b.affiliation ?? 'member');
    return { ok: true };
  },
  'POST /group-remove': async (b) => {
    await getBot(b.bot).setAffiliation(roomOf(b.room), resolveTo(b.member), 'none');
    return { ok: true };
  },
  /** { bot, room } — the bot leaves (sets its own affiliation to none). */
  'POST /group-leave': async (b) => {
    const bot = getBot(b.bot);
    await bot.setAffiliation(roomOf(b.room), bot.jid, 'none');
    bot.rooms.delete(roomOf(b.room));
    return { ok: true };
  },
  /** { bot, room, name } */
  'POST /group-rename': async (b) => {
    await getBot(b.bot).renameGroup(roomOf(b.room), String(b.name));
    return { ok: true };
  },
  /** { bot, room, text, id?, replyToId?, replyToCreator? } -> { id }.
   * replyToCreator defaults to the device's occupant JID (room/<device JID>). */
  'POST /group-send': async (b) => {
    const room = roomOf(b.room);
    const replyTo = b.replyToId
      ? { id: String(b.replyToId), creator: b.replyToCreator ? resolveTo(b.replyToCreator) : `${room}/${device.jid}` }
      : null;
    const id = await getBot(b.bot).sendGroupMessage(room, {
      text: b.text ?? '',
      replyTo,
      ...(b.id ? { id: String(b.id) } : {}),
    });
    return { id };
  },
  /** { bot, room, count, text? } -> { ids } */
  'POST /group-burst': async (b) => {
    const bot = getBot(b.bot);
    const ids = [];
    for (let i = 1; i <= Math.min(Number(b.count ?? 5), 100); i += 1) {
      ids.push(await bot.sendGroupMessage(roomOf(b.room), { text: `${b.text ?? 'burst'} ${i}` }));
    }
    return { ids, id: ids[ids.length - 1] };
  },
  /** { bot, room, msgId, emojis } */
  'POST /group-react': async (b) => {
    const emojis = Array.isArray(b.emojis) ? b.emojis : String(b.emojis ?? '').split(',').filter(Boolean);
    await getBot(b.bot).sendGroupReactions(roomOf(b.room), String(b.msgId), emojis);
    return { ok: true };
  },
  /** { bot, room?, contains?, sender?: "device"|bot|jid } -> the group message
   * entry (incl. `id`, the sender's SENDER_MSG_ID). Defaults to the device's. */
  'POST /wait-group-message': async (b) => {
    const sender = resolveTo(b.sender ?? 'device');
    const needle = b.contains ? String(b.contains).toLowerCase() : null;
    return getBot(b.bot).waitFor(
      (e) =>
        e.kind === 'groupmessage' &&
        (!b.room || e.room === roomOf(b.room)) &&
        e.sender === sender &&
        (!needle || e.body.toLowerCase().includes(needle)),
      opts(b),
    );
  },
  /** { bot, room, member, affiliation } — wait until the room reports it. */
  'POST /wait-affiliation': async (b) => {
    const jid = resolveTo(b.member);
    const want = b.affiliation ?? 'member';
    return getBot(b.bot).waitFor(
      (e) => e.kind === 'affiliations' && e.room === roomOf(b.room) && e.users.some((u) => u.jid === jid && u.affiliation === want),
      opts(b),
    );
  },
  /** { bot, room, name } — wait for a rename notification. */
  'POST /wait-groupconfig': async (b) =>
    getBot(b.bot).waitFor((e) => e.kind === 'groupconfig' && e.room === roomOf(b.room) && (!b.name || e.roomname === b.name), opts(b)),

  /** { bot, to?, state: composing|paused|active } */
  'POST /typing': async (b) => {
    await getBot(b.bot).sendChatState(resolveTo(b.to), b.state ?? 'composing');
    return { ok: true };
  },

  /** { bot, to?, msgId, emojis: string | string[] } — full replace-set, per XEP-0444. */
  'POST /react': async (b) => {
    const emojis = Array.isArray(b.emojis) ? b.emojis : String(b.emojis ?? '').split(',').filter(Boolean);
    await getBot(b.bot).sendReactions(resolveTo(b.to), String(b.msgId), emojis);
    return { ok: true };
  },

  /** { bot, available: boolean } */
  'POST /presence': async (b) => {
    await getBot(b.bot).setAvailable(b.available !== false && b.available !== 'false');
    return { ok: true };
  },

  /** { bot, to? } — roster-add + presence subscribe (device auto-accepts only if bot is in its phonebook). */
  'POST /subscribe': async (b) => {
    await getBot(b.bot).subscribeTo(resolveTo(b.to));
    return { ok: true };
  },

  /** { bot, received?: bool, displayed?: bool } — turn auto-receipts on/off. */
  'POST /auto-receipts': (b) => {
    const bot = getBot(b.bot);
    if (b.received !== undefined) bot.autoReceipts.received = b.received === true || b.received === 'true';
    if (b.displayed !== undefined) bot.autoReceipts.displayed = b.displayed === true || b.displayed === 'true';
    return { autoReceipts: bot.autoReceipts };
  },

  /** { bot, msgId, kind: received|displayed, to? } — send a receipt by hand. */
  'POST /ack': async (b) => {
    await getBot(b.bot).sendReceipt(resolveTo(b.to), String(b.msgId), b.kind ?? 'displayed');
    return { ok: true };
  },

  /** { bot, contains?, sender?, since?, timeoutMs? } -> the device's message entry (incl. its `id`).
   * `sender` (default "device") may be another app's raw JID in cross-app runs.
   * `contains` ignores case: a phone keyboard may auto-capitalise what Maestro types. */
  'POST /wait-message': async (b) => {
    const sender = resolveTo(b.sender ?? 'device');
    return getBot(b.bot).waitFor(
      (e) => e.kind === 'message' && e.from === sender && (!b.contains || e.body.toLowerCase().includes(String(b.contains).toLowerCase())),
      opts(b),
    );
  },

  /** { bot, msgId, kind: received|displayed } — wait for the DEVICE to ack a message the bot sent. */
  'POST /wait-ack': async (b) =>
    getBot(b.bot).waitFor((e) => e.kind === (b.kind ?? 'displayed') && e.refId === String(b.msgId), opts(b)),

  /** { bot, state: composing|paused } */
  'POST /wait-chatstate': async (b) =>
    getBot(b.bot).waitFor((e) => e.kind === 'chatstate' && e.from === device.jid && e.state === (b.state ?? 'composing'), opts(b)),

  /** { bot, msgId? } */
  'POST /wait-reaction': async (b) =>
    getBot(b.bot).waitFor((e) => e.kind === 'reaction' && (!b.msgId || e.refId === String(b.msgId)), opts(b)),

  /** { bot } — cut the bot's socket (simulates the server dropping an idle
   * session); the next call reconnects via ensureOnline. Self-test only. */
  'POST /drop': async (b) => {
    const bot = getBot(b.bot);
    bot.xmpp.socket?.end?.();
    await new Promise((r) => setTimeout(r, 500));
    return { status: bot.xmpp.status };
  },

  /** { phone } (10 digits) -> { userId, jid } of any test account, e.g. a
   * physical phone a bot should message directly (`send` with `to: <jid>`). */
  'POST /lookup': async (b) => {
    const { userId, domain } = await lookupIdentity(String(b.phone));
    return { userId, jid: `${userId}@${domain}` };
  },

  /** { bot } -> full inbox, for debugging a failing flow. */
  'POST /inbox': (b) => ({ inbox: getBot(b.bot).inbox }),
};

/** A room JID, or "@key" for a room created with that key. */
function roomOf(r) {
  const v = String(r ?? '');
  if (!v.startsWith('@')) return v;
  const room = roomsByKey.get(v.slice(1));
  if (!room) throw new HttpError(404, `no room with key "${v.slice(1)}" (have: ${[...roomsByKey.keys()].join(', ')})`);
  return room;
}

function roomsInfo() {
  const out = {};
  for (const [key, jid] of roomsByKey) out[key] = { jid, node: jid.split('@')[0] };
  return out;
}

/** "a,b" or ["a","b"] -> ["a","b"] */
function listOf(v) {
  if (Array.isArray(v)) return v.map(String);
  return String(v ?? '').split(',').map((x) => x.trim()).filter(Boolean);
}

function opts(b) {
  return { since: Number(b.since ?? 0), timeoutMs: Number(b.timeoutMs ?? 20000) };
}

function startHttp() {
  const server = http.createServer(async (req, res) => {
    const key = `${req.method} ${req.url.split('?')[0]}`;
    const handler = routes[key];
    const reply = (status, payload) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    };
    if (!handler) return reply(404, { error: `no route ${key}` });
    try {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const body = raw ? JSON.parse(raw) : {};
      if (key !== 'POST /drop' && body.bot && bots.has(body.bot)) await bots.get(body.bot).ensureOnline();
      reply(200, (await handler(body)) ?? { ok: true });
    } catch (err) {
      log('http', key, 'failed:', err.message);
      reply(err.status ?? 500, { error: err.message });
    }
  });
  server.listen(cfg.port, '127.0.0.1', () => log('http', `listening on http://127.0.0.1:${cfg.port}`));
  return server;
}

// ---------------------------------------------------------------------------

function requiredEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing ${name}. See e2e/README.md.`);
    process.exit(2);
  }
  return v;
}

function parseBots(spec) {
  return spec.split(',').map((pair) => {
    const [name, phone] = pair.split(':').map((s) => s.trim());
    if (!name || !/^\d{10}$/.test(phone ?? '')) throw new Error(`bad E2E_BOT_PHONES entry "${pair}" (want name:10digits)`);
    return { name, phone };
  });
}

function bare(jid) {
  return (jid ?? '').split('/')[0];
}

function log(who, ...args) {
  console.log(`[${new Date().toISOString().slice(11, 23)}] [${who}]`, ...args);
}

async function main() {
  const ident = await lookupIdentity(cfg.devicePhone);
  device = { userId: ident.userId, jid: `${ident.userId}@${ident.domain}`, phone: cfg.devicePhone };
  log('setup', `device under test: ${device.jid} (phone ${device.phone})`);

  for (const { name, phone } of cfg.bots) {
    const bot = new Bot(name, phone);
    bots.set(name, bot);
    await bot.start();
  }
  const server = startHttp();

  const shutdown = async () => {
    server.close();
    await Promise.all([...bots.values()].map((b) => b.stop()));
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[bot] fatal:', err);
  process.exit(1);
});
