// Maestro `runScript` bridge to the bot server (e2e/bot/server.mjs).
//
// Runs on the HOST inside Maestro's JS engine (not on the device), so
// 127.0.0.1 reaches the bot server even from an emulator. Call it as:
//
//   - runScript:
//       file: ../scripts/bot.js
//       env:
//         ACTION: send          # any bot-server route, or one of the extras below
//         BOT: alice
//         TEXT: "hello"
//
// Results land on `output.bot` (the last response), plus a few shortcuts:
//   output.bot.id        – id of the message sent / waited for
//   output.runId         – unique per `reset`, for making message text unique
//   output.bots.<name>   – { userId, jid, phone } for each bot (after `reset`)
//   output.device        – { userId, jid, phone } of the device under test
//   output.rooms.<key>   – { jid, node } of rooms created with KEY (group-create)
//
// Group actions take ROOM as a room JID or "@<key>". MEMBERS / MEMBER / SENDER
// take "device", a bot name, or a raw JID.
//
// Extra script-only actions:
//   reset                – clears bot inboxes, refreshes output.bots/device/runId
//   expect-no-message    – fails if the bot DOES receive a device message within TIMEOUT_MS
//   probe-ack            – wait-ack that sets output.probeOk instead of throwing
//
// `wait-*` actions poll in short slices until TIMEOUT_MS (default 20s), so a
// slow reconnect never trips Maestro's own HTTP client timeout.

var BASE = typeof BOT_URL !== 'undefined' ? BOT_URL : 'http://127.0.0.1:7777';

function opt(name) {
  // Maestro exposes `env:` entries as globals; anything not passed is undefined.
  try {
    var v = eval(name);
    return v === undefined || v === null || v === '' ? undefined : v;
  } catch (e) {
    return undefined;
  }
}

function call(method, route, body) {
  var url = BASE + '/' + route;
  var res =
    method === 'GET'
      ? http.get(url)
      : http.post(url, { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  var parsed = {};
  try {
    parsed = json(res.body);
  } catch (e) {
    parsed = { raw: res.body };
  }
  return { status: res.status, body: parsed };
}

function must(result, what) {
  if (result.status !== 200) {
    throw new Error('bot ' + what + ' failed (HTTP ' + result.status + '): ' + JSON.stringify(result.body));
  }
  return result.body;
}

function pollWait(route, body) {
  var total = Number(opt('TIMEOUT_MS') || 20000);
  var deadline = Date.now() + total;
  var last;
  while (Date.now() < deadline) {
    var slice = Math.min(8000, Math.max(1000, deadline - Date.now()));
    body.timeoutMs = slice;
    last = call('POST', route, body);
    if (last.status === 200) return last.body;
    if (last.status !== 408) must(last, route);
  }
  throw new Error('bot ' + route + ' timed out after ' + total + 'ms: ' + JSON.stringify(body));
}

var action = opt('ACTION');
if (!action) throw new Error('bot.js: ACTION env is required');

var body = {
  bot: opt('BOT'),
  to: opt('TO'),
  text: opt('TEXT'),
  state: opt('STATE'),
  msgId: opt('MSG_ID'),
  emojis: opt('EMOJIS'),
  kind: opt('KIND'),
  contains: opt('CONTAINS'),
  available: opt('AVAILABLE'),
  received: opt('RECEIVED'),
  displayed: opt('DISPLAYED'),
  replyToId: opt('REPLY_TO_ID'),
  replyToCreator: opt('REPLY_TO_CREATOR'),
  since: opt('SINCE'),
  id: opt('ID'),
  count: opt('COUNT'),
  forwarded: opt('FORWARDED'),
  // Groups
  room: opt('ROOM'),
  name: opt('NAME'),
  members: opt('MEMBERS'),
  member: opt('MEMBER'),
  affiliation: opt('AFFILIATION'),
  sender: opt('SENDER'),
  key: opt('KEY'),
};

var result;
if (action === 'reset') {
  must(call('POST', 'reset'), 'reset');
  var info = must(call('GET', 'bots'), 'bots');
  output.device = info.device;
  output.bots = {};
  for (var i = 0; i < info.bots.length; i++) output.bots[info.bots[i].name] = info.bots[i];
  output.rooms = info.rooms || {};
  output.runId = String(Date.now());
  result = info;
} else if (action === 'expect-no-message') {
  body.timeoutMs = Number(opt('TIMEOUT_MS') || 4000);
  var r = call('POST', 'wait-message', body);
  if (r.status === 200) throw new Error('expected NO message to reach the bot, but got: ' + JSON.stringify(r.body));
  if (r.status !== 408) must(r, 'wait-message');
  result = { ok: true };
} else if (action === 'probe-ack') {
  // Like wait-ack (KIND defaults to `received`), but never throws: sets
  // output.probeOk so a flow can retry inside a `repeat`.
  body.kind = body.kind || 'received';
  body.timeoutMs = Number(opt('TIMEOUT_MS') || 8000);
  var p = call('POST', 'wait-ack', body);
  if (p.status !== 200 && p.status !== 408) must(p, 'wait-ack');
  output.probeOk = p.status === 200;
  result = p.body;
} else if (action === 'expect-no-group-message') {
  body.timeoutMs = Number(opt('TIMEOUT_MS') || 4000);
  var g = call('POST', 'wait-group-message', body);
  if (g.status === 200) throw new Error('expected NO group message to reach the bot, but got: ' + JSON.stringify(g.body));
  if (g.status !== 408) must(g, 'wait-group-message');
  result = { ok: true };
} else if (action.indexOf('wait-') === 0) {
  result = pollWait(action, body);
} else {
  result = must(call('POST', action, body), action);
}

// Optional assertions on a waited-for device message.
var expectReplyTo = opt('EXPECT_REPLY_TO');
if (expectReplyTo !== undefined) {
  if (!result.reply || String(result.reply.id) !== String(expectReplyTo)) {
    throw new Error('expected a reply to ' + expectReplyTo + ', got: ' + JSON.stringify(result.reply));
  }
}
var expectForwarded = opt('EXPECT_FORWARDED');
if (expectForwarded !== undefined && String(!!result.forwarded) !== String(expectForwarded)) {
  throw new Error('expected forwarded=' + expectForwarded + ', got ' + JSON.stringify(result));
}

output.bot = result;
