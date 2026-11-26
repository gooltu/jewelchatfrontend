# E2E tests (Layer 1: one device + bot peers)

One Android emulator runs the real app under [Maestro](https://maestro.mobile.dev).
Everyone else in the conversation is a **bot peer**: a Node process
(`bot/server.mjs`) that logs test accounts into the real game and chat servers
and plays the other side over XMPP. Maestro flows control the bots and check
what reached them through a small localhost HTTP API (`maestro/scripts/bot.js`).

```
 Maestro ──drives UI──▶ emulator (app) ◀──XMPP──▶ chat server ◀──XMPP──▶ bot "alice"
    └──────── runScript ─ HTTP 127.0.0.1:7777 ─────────────────────────────┘
```

## One-time setup

1. Install Maestro (`brew tap mobile-dev-inc/tap && brew install maestro`), plus a JDK 17+ if you don't already have one.
2. `cp e2e/.env.example e2e/.env.local`, then fill in the test numbers. All of
   them must be numbers that nobody really owns, because the server accepts OTP
   `888888` for every number.
3. Boot **one** emulator, headless if you can:
   `emulator -avd <name> -no-window -no-boot-anim`. Once a windowed emulator
   sits in the background, macOS slows it down a lot, and flows get slow
   and flaky.
4. Run `npm run android` to install the dev build and start Metro. If the
   build is already installed, `npx expo start` plus
   `adb reverse tcp:8081 tcp:8081` is enough, because testIDs and flows are JS-only.
   After changing app code with `git checkout`, `cp` or similar, restart Metro
   with `--clear`. Its file watcher missed those changes more than once, and
   the app then kept running the old code from its cached bundle.

## Running

```bash
npm run e2e                      # all flows, in config.yaml order
npm run e2e -- 05-reply          # one flow (runs 01-login first, which starts
                                 # from a fresh install; open-chat creates the
                                 # bot's chat if it doesn't exist yet)
```

The bot log and Maestro screenshots/logs are written to `e2e/.out/` (gitignored).

## Flows

| Flow | Checks |
|---|---|
| 01-login | Real phone → OTP → (referral skip) → chat list |
| 02-receive-message | Bot message appears; device sends `<received/>`, then `<displayed/>` once the chat is open |
| 03-send-message | Device message reaches the bot with `msgtype=0` (TEXT); bubble is addressable by the same id |
| 04-typing-indicator | Bot `composing`/`paused` → header subtitle "typing…" appears and disappears |
| 05-reply | Bot's reply shows a quote; device's long-press reply carries `<reply id=…>` |
| 06-reaction | Bot reaction (XEP-0444) renders a pill under the device's message (receiving only; the app can't send reactions yet) |
| 07-offline-queue | Sent in airplane mode → not delivered → delivered after reconnect (Android only) |
| 08-presence | Bot online/offline → header "Online". Needs `seed-contacts.sh` (the runner calls it) |
| 09-reconnect | After an airplane-mode drop **and** after a background→foreground cycle, an incoming message is still stored, shown and receipted (regression test for the handler-wipe bug) |

07 and 09 force reconnects and run right after 03, so every flow after them
runs on a reconnected session.

## Writing a flow

- Find elements by `testID` (see CLAUDE.md "E2E testIDs"), never by visible text alone.
- `runScript: { file: ../scripts/bot.js, env: { ACTION: reset } }` first. This
  clears bot inboxes and sets `output.bots.<name>.userId`, `output.device` and
  `output.runId`. Use `output.runId` in message text so each run's messages are unique.
- `ACTION` can be any bot route: `send`, `typing`, `react`, `presence`,
  `subscribe`, `ack`, `auto-receipts`, `wait-message`, `wait-ack`,
  `wait-chatstate`, `wait-reaction`, `inbox`, `drop` (cuts the bot's own
  socket, for testing the bot itself). It can also be one of the script-only
  actions `reset`, `expect-no-message` and `probe-ack` (a `wait-ack` that sets
  `output.probeOk` instead of failing, for use in `repeat` loops). The bot
  reconnects itself before any call if the server dropped its idle session. Parameters are upper-case
  env names: `BOT`, `TO`, `TEXT`, `MSG_ID`, `STATE`, `EMOJIS`, `KIND`,
  `CONTAINS`, `AVAILABLE`, `REPLY_TO_ID`, `TIMEOUT_MS`, `EXPECT_REPLY_TO`.
  The result is stored in `output.bot`.
- Keep the app process alive. Flows foreground it with
  `launchApp: { stopApp: false }` and move between screens with
  `subflows/to-chat-list.yaml`, which taps the header's back button rather
  than Android `back`, because an extra `back` exits the app. Going to the
  background is fine, but a force-stop loses missed messages (see "App findings").
- Each `runScript` replaces `output.bot`, so copy any id you still need with
  `evalScript: ${output.myId = output.bot.id}` before the next call.
- Message ids: a bot's message id is the `id` it sent (`e2e-<uuid>`). A device
  message's id is the device's local `_ID`, which is what goes on the wire and
  what the bot reports back from `wait-message`. Both appear in the bubble's
  testID, `chat-detail.message.<id>`.

## App findings from these tests

Fixed:

- **After any reconnect, the app ignored every incoming stanza** (messages,
  receipts, typing, presence) until the process restarted. Strophe's
  `_doDisconnect` clears `connection.handlers`, `stropheClient.connect()` reuses
  the same `Connection`, and handler registration was guarded once per object.
  The fix is `chatService.registerStanzaHandlersForSession`, which re-registers
  on every `connected` and deletes the previous refs first so nothing is
  registered twice. `09-reconnect` covers it, and it was confirmed to fail on
  the old code.

- **SCRAM login took longer than the server allows on a slow device.**
  Strophe computed SCRAM-SHA-1 (PBKDF2 with 10,000 iterations) in pure JS on
  the JS thread. On a throttled emulator that took 8–27s, and the server
  closed the stream after the late `<response>` every time, so the app
  couldn't connect at all. The app now offers only SASL `PLAIN` when the
  transport is encrypted (`wss:`/`https:`), which is one round trip with no
  hashing (`stropheClient.resolveSaslMechanisms`). A plain `ws://` dev server
  still gets Strophe's defaults (SCRAM first), so the token is never sent in
  clear text.

- **A message that arrived during a quick reconnect could be lost.** The
  server has no offline queue, so a message that lands in the ~100 ms
  between the old session closing and the new one sending presence only
  exists in the MAM archive. The app's catch-up query ran right after login,
  before the archive had the message, and found nothing. Once PLAIN made
  login fast, `02-receive-message` hit this. The app now runs a second, small
  catch-up 3 s after reconnecting that covers only the last 10 s before the
  reconnect, so it stays cheap however long the app was away
  (`chatService.scheduleSettledHistoryRecheck`). Repeats are deduped by
  `SENDER_MSG_ID`.

- **A message delivered to the closing session was skipped by the catch-up.**
  If the server hands a message to the old session in its last few
  milliseconds, the app never processes it, and its archive time is slightly
  earlier than the recorded background time, so a catch-up starting exactly
  there misses it (`09-reconnect` hit this). The catch-up now starts 5 s
  before the background time (`HISTORY_START_OVERLAP_MS`).
- **Reaction pills were always drawn at the left edge,** even under your own
  right-aligned messages. They now line up with their bubble.

- **A message sent while offline was delivered twice.** The reconnect flush
  sent it, then a retry timer set while offline fired ~10 s later with a
  stale copy and sent it again (the receiver deduped it, but it was a wasted
  send plus a second receipt). `syncService.attemptSend` now re-reads the row
  and skips it if it's already sent, cancels the leftover timer on success,
  and ignores an overlapping attempt for the same message. Covered by
  `src/services/syncService.test.ts`.

Not fixed:

- **Messages missed while the app was killed (not backgrounded) are never
  fetched.** `downloadHistorySinceBackground` only queries MAM from the last
  *background* time. After a fresh login, a crash or a force-stop there is none,
  so nothing is fetched.
- **The reply quote shows the XMPP resource as the sender name.** For an
  incoming 1:1 message, `SENDER_NAME` is the sender's resource (here
  `e2e-alice-…`; on a real phone a random string), and the device's
  reply-to-it quote displays that string.

## Known gaps

- Read receipts can't be checked visually yet. The design system's
  `DeliveryStatus` puts its testID on a react-native-svg icon, which never
  reaches the native view tree, so `<bubble>.status` doesn't exist on the
  device. Every state would also share that one ID. It needs a wrapping `View`
  with the testID and an `accessibilityLabel` for each state.
- The device never sends typing indicators (`ChatInputBar` has no keystroke
  callback), so there's no device→bot typing flow.
- Groups (MUC-Light) aren't covered by the bot suite (the bot has no room
  support). The separate three-device group suite below covers them.
- Group reactions: the app can't send reactions and the bots can't join rooms,
  so nothing exercises reactions in a group yet.
- Dev builds show React Native's LogBox (the warning toast and the full-screen
  error log), which can cover the UI. `subflows/dismiss-logbox.yaml` clears it,
  but a release build would avoid it entirely.
- Tests hit the real servers (`game.jewelchat.net` / `chat.jewelchat.net`)
  unless `E2E_GAMESERVER`/`E2E_CHATSERVER` are set.

## Group suite (3 devices)

`npm run e2e:group` (`scripts/run-group-e2e.sh`) runs the real app on three
devices at once, with no bots: an Android emulator (`emu`, the group owner),
an iOS simulator (`ios`) and a physical Android phone (`pixel`). The script
runs small step flows from `maestro/group/` on one device at a time, in a fixed
order, so the cross-device order is explicit. Messages and the group name carry
a per-run id; on the other devices, bubbles and chat-list rows are found by that
text, because their testIDs hold ids those devices can't know in advance
(the server's room id, the sender's `SENDER_MSG_ID`).

Setup:

1. `E2E_GROUP_PHONES=emu:…,ios:…,pixel:…` in `e2e/.env.local` (three test
   numbers). Devices are auto-detected: the `emulator-*` serial, the other adb
   serial, and the booted simulator. Override with `E2E_GROUP_DEVICES`.
2. Android: install a debug build on both devices (`cd android && ./gradlew
   assembleDebug`, then `adb -s <serial> install -r app/build/outputs/apk/debug/app-debug.apk`).
3. iOS: there is no `GoogleService-Info.plist` yet, so build without Firebase:
   `JC_NO_FIREBASE=1 npx expo prebuild -p ios --clean`, then
   `JC_NO_FIREBASE=1 npx expo run:ios --device "<simulator>" --no-bundler`. Run
   both with `LANG=en_US.UTF-8`, because CocoaPods crashes on a non-UTF-8 locale.
4. One Metro on :8081 (`npx expo start`) serves all three. The script runs
   `adb reverse` for both Android devices.

Steps: login on all three → the owner resolves the two members in Select
Contact (the member picker only lists contacts that have already been tapped,
see `useSelectableContacts.isActive`) → create group → each device sends, and the
other two see it with a sender label → iOS replies to the phone's message, and
the quote shows on the other two → the phone goes into airplane mode while two
messages arrive, then catches up → the owner renames the group, and the others
see the new name → the phone leaves, and the owner sees 2 members.

The script seeds the emulator's phonebook (`seed-contacts.sh`) and the
simulator's (`simctl addmedia` with a vCard). It doesn't seed the physical phone:
its default contacts account is the owner's Google account, so test contacts
would sync into their real address book. The phone only joins groups, so it
doesn't need contacts, and its sender labels come from the game server instead
(`E2E_GROUP_PIXEL_SENDER`, default "any non-empty").

Logs and Maestro output for each step: `e2e/.out/group/<nn>-<device>-<step>.log`
and the matching directory. `SKIP_LOGIN=1` reuses logged-in devices.

### App findings from the group suite

Fixed:

- **Creating a group failed** with "Couldn't create group", even though the
  server had created the room. The room-created stanza is also stored by
  `stropheEvents` (`upsertGroupMember`), and expo-sqlite's
  `withTransactionAsync` isn't exclusive, so that write could land between
  `replaceGroupMembers`' DELETE and its INSERT, which then failed the
  `(GROUP_JID, MEMBER_JID)` unique constraint. The INSERT is now an upsert.
- **Group messages from other members were silently dropped** when their id
  matched one of this device's own message ids in the same room. The group
  echo check matched on the id alone, and message ids are per-device SQLite
  `_ID`s, so collisions are common. It now also requires the occupant to be us.
- **Group sender labels showed a raw JID** (`<room>@muclight…/5@…`).
  `identityService` read the room id as the user id. It now uses the member
  JID in the resource.
- **Reply quotes were lost in groups** on the device that wrote the quoted
  message, and on everyone else's device when someone quoted themselves.
  Senders and receivers store group messages under different creator forms
  (bare JID vs. occupant JID). The receiver now normalises the creator to its
  own form.
- **Room discovery read only the first page** of `disco#items` (the server
  pages at 10). A member who missed a live invite never found the group, and
  the reconcile step *deleted* every local group past the first page on each
  reconnect. `fetchGroupRooms` now follows RSM paging.
- **Messages sent during a foreground network drop were never fetched**
  (catch-up only ran from the last *background* time). A reconnect after an
  unexpected drop now runs the MAM catch-up from the drop.
- **After a background/foreground cycle, rooms joined while away got no
  history**: the catch-up ran before room discovery. Discovery now runs first.

Not fixed:

- **A newly invited group is hidden until someone writes in it.** The chat
  list only shows conversations with a last message
  (`LAST_MSG_CREATED_TIME IS NOT NULL`), so there's no "you were added" entry.
  The suite has the owner post first.
- **Opening Group Info runs a phonebook sync**, so it shows the contacts
  disclosure (`useSelectableContacts` is used for member names).
- **Intermittent uncaught expo-sqlite error** in dev builds: `prepareAsync`
  "Cannot use shared object that was already released" (seen on both Android
  devices, as a LogBox). Probably concurrent statements on the shared
  connection. The step flows dismiss LogBox.
- **iOS 27 needs the UIScene lifecycle.** Expo 57's template doesn't adopt
  it, so `plugins/withIosSceneLifecycle.js` adds it.
