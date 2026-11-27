# E2E tests

Two tiers, so the slow physical-phone runs are rare:

| Tier | Command | Devices | When |
|---|---|---|---|
| **Emulator** | `npm run e2e:emu` | Android emulator + iOS simulator, each with its own bot peers, then the two apps together | Every run |
| **Weekly** | `npm run e2e:weekly` | Pixel + Samsung, with the emulator and simulator as their peers | Once a week or less |

Bot peers are Node processes (`bot/server.mjs`, `@xmpp/client` — deliberately
not the app's own strophe code) that sign test accounts into the real game and
chat servers and play the other side over XMPP: 1:1 chats, receipts, typing,
reactions, presence and **groups** (MUC Light: create, add/remove, rename,
leave, send, react). Maestro flows drive the app and control the bots through
a localhost HTTP API (`maestro/scripts/bot.js`).

```
 Maestro ──drives UI──▶ emulator / simulator (app) ◀──XMPP──▶ chat server ◀──XMPP──▶ bots
    └──────── runScript ─ HTTP 127.0.0.1:7777 (emu) / :7778 (ios) ───────────────────┘
```

Every test case has an id, a title and a short description in
`report/catalog.json`. That file is also the run order and the dependency list
(`needs`: a case is skipped when the case it builds on didn't pass), and marks
known issues (`knownIssue`: a failure is reported as "expected fail"; a pass is
flagged so the catalog gets updated).

## Live report

Each runner writes `e2e/.out/report/index.html` after every case. Open it in a
browser while tests run; it reloads itself every 3 s until the run ends
(`E2E_OPEN_REPORT=1` opens it for you). It shows, per case: description,
edge-case / known-issue badges, a status per platform (running, passed,
failed, expected fail, skipped), duration, links to the Maestro log and the
last screenshot, and the last 10 runs as coloured dots. `npm run e2e:report`
re-renders and opens it.

## One-time setup

1. Install Maestro (`brew tap mobile-dev-inc/tap && brew install maestro`) and a JDK 17+.
2. `cp e2e/.env.example e2e/.env.local` and fill in the **admin login**
   (`E2E_ADMIN_EMAIL` / `E2E_ADMIN_PASSWORD`, a JewelChat Admin account). The
   account pool is already filled in (below).
3. Boot one Android emulator (headless if you can:
   `emulator -avd <name> -no-window -no-boot-anim`) and one iOS simulator.
4. Install the dev build on both: `npm run android`; for iOS there's no
   `GoogleService-Info.plist` yet, so `JC_NO_FIREBASE=1 npx expo prebuild -p ios --clean`
   then `JC_NO_FIREBASE=1 npx expo run:ios --device "<simulator>" --no-bundler`
   (both with `LANG=en_US.UTF-8`; CocoaPods crashes otherwise).
5. One Metro on :8081 (`npx expo start`) serves both. After switching code with
   `git checkout` or `cp`, restart it with `--clear`: its watcher has missed
   such changes before and kept serving the old bundle.

### Account pool

All numbers are reserved test numbers (`90000000NN`); the server accepts OTP
`888888` for every number, so never put a real number here.
`reset-accounts.mjs` refuses anything outside that pattern.

| Role | Numbers |
|---|---|
| Devices: emu / ios / pixel / samsung | 01 / 02 / 03 / 04 |
| Emulator bots alice, bob, cara (in the emulator's phonebook) | 05–07 |
| Simulator bots dan, eve, finn (in the simulator's phonebook) | 11–13 |
| Strangers (never in a phonebook): emu / ios | 08–10 / 14–16 |
| Sign-up accounts (go through Name + Referral every run): emu / ios | 98, 96 / 99, 97 |
| Unknown referrer (must stay unregistered) | 89 |

### Account reset

Before a run, `npm run e2e:emu` resets every pool account through the same
admin API the JewelChat Admin app's **Reset account** screen uses
(`POST /admin/users/:id/reset` on ServerProjextX). A reset puts the account
back to a new sign-up's state (name back to the placeholder, referral and
progress cleared) and clears its chat-server archive, roster, group
memberships and push subscriptions. The id, phone and JID stay the same.
Numbers that were never registered are skipped (already fresh).

```bash
npm run e2e:reset -- --dry-run      # list phone -> user id, reset nothing
npm run e2e:reset                   # reset the whole pool
npm run e2e:reset -- 9000000098     # just these numbers
```

`E2E_NO_RESET=1` skips it when you're iterating on one flow.

## Running

```bash
npm run e2e:emu                                    # everything on emulator + simulator
E2E_PLATFORMS=emu npm run e2e:emu                  # Android emulator only
E2E_SUITES=group,cross-app npm run e2e:emu         # some suites (auth, direct, unknown, group, cross-app)
E2E_ONLY=D10,G01 E2E_PLATFORMS=emu npm run e2e:emu # some cases (B01 sign-in always runs first)
npm run e2e -- 05-reply                            # one 1:1 case on the emulator, no reset
npm run e2e:weekly                                 # physical phones
npm run e2e:test-tools                             # unit tests for the report generator
```

What `e2e:emu` does: resets the accounts, starts the report, runs
`scripts/run-platform.sh emu` and `… ios` **in parallel** (each with its own
bot server and its own bots and strangers), then `scripts/run-cross-app.sh`
(the two apps together, plus bots). Each case is one Maestro flow; logs,
screenshots and the hierarchy dumps go to `e2e/.out/emu-suite/<platform>/<case>/`.

Platform notes:
- iOS simulator: airplane mode and the system Contacts form don't exist, so
  `android-only` cases (B07, D18, U04 and G12's offline half) are not run there.
  `clearState` keeps the iOS Keychain, so the runner resets the simulator's
  keychain (`simctl keychain reset`) before the sign-up and sign-in cases.
- Physical phones never get test contacts (their default contacts account is
  the owner's own address book), so in the weekly tier they only answer chats
  the emulator or simulator start, and answer the unknown-sender prompt.

## Test cases

The full list with descriptions is `report/catalog.json` (and the report page).
Flows: `maestro/cases/<id>-*.yaml` and the original `maestro/flows/0N-*.yaml`
(B01–B09); multi-device steps are in `maestro/group/`.

| Suite | Cases | Covers |
|---|---|---|
| Sign-up & login (A) | A01–A10 | Name required (empty/spaces), 50-char cap, back to edit the name, partial / own / unknown / valid referrer, skip then sign in again, wrong OTP, short phone number |
| 1:1 chat (B, D) | B01–B09, D10–D23 | Receive, send, typing, reply, reaction, offline queue, presence, reconnect; burst of 20 in order, duplicate id, long/multi-line/emoji/RTL text, whitespace-only, reaction replace/clear, reply to unknown parent, forwarded label, typing clears on message, 3 queued offline in order, read marker timing, star/delete/pin/archive/delete chat, forward to two, background catch-up, killed app (known issue) |
| Unknown senders (U) | U01–U06 | Prompt, Continue (survives restart), Block (no receipt, survives restart) / Unblock, Add to contacts, phonebook sender, group from a stranger |
| Groups (G) | G01–G16 | Bot-created group, device-created group, sender labels (name vs number), added mid-conversation, removed by owner, rename (emoji/long), member leaves, device leaves, replies (bot/self), reactions, id-collision regression, offline/background catch-up, 12-room paging regression, interleaved burst, forward in/out, empty invite (known issue) |
| Cross-app (X) | X01–X07 | Emulator ↔ simulator: first contact + presence, text both ways, reply, mixed group with bots, offline and background catch-up, forward to the other app and to a bot |
| Weekly (P) | P01–P05 | Real push notification opens the chat, Samsung network drop, real keyboard, four-device group smoke, Pixel ↔ simulator 1:1 with offline |

## Writing a flow

- Find elements by `testID` (see CLAUDE.md "E2E testIDs"), never by visible text alone.
- Add the case to `report/catalog.json` (id, suite, platforms, title, a one-
  or two-sentence description, `edge`, `needs`, `knownIssue`) — the runner only
  runs what's listed there, in that order.
- Bot names are parameters, never literals: `${BOT1}`..`${BOT3}` (their
  phonebook names `${BOT1_NAME}`.., numbers `${BOT1_PHONE}`..) and strangers
  `${S1}`..`${S3}`. The emulator and the simulator use different bots.
- `runScript: { file: ../scripts/bot.js, env: { ACTION: reset } }` first. This
  clears bot inboxes and sets `output.bots.<name>.userId`, `output.device`,
  `output.rooms.<key>` and `output.runId`. Use `output.runId` in message text so
  each run's messages are unique.
- `ACTION` can be any bot route: `send`, `typing`, `react`, `presence`,
  `subscribe`, `ack`, `auto-receipts`, `wait-message`, `wait-ack`,
  `wait-chatstate`, `wait-reaction`, `inbox`, `burst` (N messages back to
  back), `drop` (cuts the bot's own socket, for testing the bot itself), and
  the group routes `group-create` (with `KEY` to name the room for later
  flows), `group-create-many`, `group-add`, `group-remove`, `group-leave`,
  `group-rename`, `group-send`, `group-burst`, `group-react`,
  `wait-group-message`, `wait-affiliation`, `wait-groupconfig`. It can also be
  one of the script-only actions `reset`, `expect-no-message`,
  `expect-no-group-message` and `probe-ack` (a `wait-ack` that sets
  `output.probeOk` instead of failing). The bot reconnects itself before any
  call if the server dropped its idle session. Parameters are upper-case env
  names: `BOT`, `TO`, `TEXT`, `ID` (explicit message id), `COUNT`, `FORWARDED`,
  `MSG_ID`, `STATE`, `EMOJIS` (`,` alone clears), `KIND`, `CONTAINS`,
  `AVAILABLE`, `REPLY_TO_ID`, `REPLY_TO_CREATOR`, `TIMEOUT_MS`,
  `EXPECT_REPLY_TO`, `EXPECT_FORWARDED`, and for groups `ROOM` (a room JID or
  `@<key>`), `NAME`, `MEMBERS`, `MEMBER`, `AFFILIATION`, `SENDER`, `KEY`.
  `MEMBERS`/`MEMBER`/`SENDER`/`TO` take `device`, a bot name or a raw JID.
  The result is stored in `output.bot`.
- A group's chat-list row is `chat-list.row.<room node>` (`output.rooms.<key>.node`).
- Compare a field's text by its id (Maestro matches the whole text): a
  screen-wide text check also sees the keyboard's suggestion strip.
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
- The app can't send reactions, so reactions are only tested in the
  bot → device direction (1:1 and group).
- The group server strips custom attributes when it reflects a message: a
  bot's `msgtype="0"` came back without it (seen while building the bot's
  group support). `forwarded="1"` is very likely dropped the same way, so
  G15 checks that a message forwarded *into* a group arrives, not its flag.
- Media (photo/video/voice) isn't covered: the bots can't upload to S3.
- Dev builds show React Native's LogBox (the warning toast and the full-screen
  error log), which can cover the UI. `subflows/dismiss-logbox.yaml` clears it,
  but a release build would avoid it entirely.
- Tests hit the real servers (`game.jewelchat.net` / `chat.jewelchat.net`)
  unless `E2E_GAMESERVER`/`E2E_CHATSERVER` are set.

## Multi-device suites (no bots)

These older suites still work, but everything they cover except physical-phone
behaviour now runs on the emulator tier; use `npm run e2e:weekly` for the
phones. Two suites run the real app on four devices at once: an Android emulator
(`emu`), an iOS simulator (`ios`), a Pixel (`pixel`) and a Samsung
(`samsung`). Each runs small step flows from `maestro/group/` on one device at
a time, in a fixed order, so the cross-device order is explicit. Messages
carry a per-run id. On the other devices, bubbles and chat-list rows are found
by that text, because their testIDs hold ids those devices can't know in
advance (the server's room id, the sender's `SENDER_MSG_ID` and userId). Text
checks ignore case, because a phone keyboard may auto-capitalise what Maestro
types.

| Suite | Command | Covers |
|---|---|---|
| Direct (1:1) | `npm run e2e:direct` | first contact + quoted reply (emu↔Samsung, iOS↔Pixel); offline both ways (Samsung in airplane mode: its queued send and an incoming message); background catch-up (Pixel on the home screen); forward to one person and to two at once; star, delete-for-me (the peer keeps it), pin, archive/unarchive |
| Unknown sender | `npm run e2e:unknown` | stranger bots (numbers nobody's phonebook has) message the devices: the prompt shows the formatted number; Continue on the Samsung (its reply reaches the stranger); Block on the Pixel (later messages neither show nor get a delivery receipt), then Unblock (the composer returns and new messages show); Add to contacts on the emulator only (fills the Contacts app's create form; the chat then shows the name and the stranger gets a presence subscribe). Logs in first, since decisions are stored per device |
| Group | `npm run e2e:group` | create; everyone sends and sees sender labels; add a member later (Samsung); replies (incl. quoting yourself); Pixel offline + Samsung backgrounded, both catch up; rename; leave (owner sees the count drop, others keep chatting) |

Setup:

1. `E2E_GROUP_PHONES=emu:…,ios:…,pixel:…,samsung:…` in `e2e/.env.local`.
   Devices are auto-detected: the `emulator-*` serial, the adb device whose
   model matches `Pixel` / `SM_`, and the booted simulator. Override with
   `E2E_GROUP_DEVICES=emu:<serial>,ios:<udid>,pixel:<serial>,samsung:<serial>`.
2. Android: install a debug build on each device (`cd android && ./gradlew
   assembleDebug`, then `adb -s <serial> install -r app/build/outputs/apk/debug/app-debug.apk`).
3. iOS: there is no `GoogleService-Info.plist` yet, so build without Firebase:
   `JC_NO_FIREBASE=1 npx expo prebuild -p ios --clean`, then
   `JC_NO_FIREBASE=1 npx expo run:ios --device "<simulator>" --no-bundler`. Run
   both with `LANG=en_US.UTF-8`, because CocoaPods crashes on a non-UTF-8 locale.
4. One Metro on :8081 (`npx expo start`) serves all four. The scripts run
   `adb reverse` for each Android device and wake its screen before every step.

Only the emulator and the simulator get phonebook entries (`seed-contacts.sh`,
which also renames a stale entry for the same number, and a `simctl` vCard).
The physical phones don't: their default contacts account is the owner's own,
so test contacts would sync into their real address book. They only ever
answer first, and their sender labels come from the game server. On iOS,
`clearState` keeps the Keychain, so `login` accepts a restored session.

Logs and Maestro output per step: `e2e/.out/{direct,group}/<nn>-<device>-<step>.log`
and the matching directory. `SKIP_LOGIN=1` reuses logged-in devices.

### App findings from the multi-device suites

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
- **A drop followed by a background lost messages.** Going to the
  background while still offline cleared the pending drop, so the foreground
  catch-up started at the background time and skipped the gap. The drop is now
  kept until a reconnect has caught up from it.
- **History catch-up threw "Cannot read property 'send' of null"** when the
  delayed re-check fired after a disconnect (the Connection outlives its
  socket). The MAM query and the subscribe handler now require a live
  connection.
- **expo-sqlite's released-handle error wasn't recovered** when it came in
  its other wordings ("…doesn't contain valid id", "…cannot be cast to type
  class expo.modules.sqlite.NativeDatabase"). The app then failed every query
  for the rest of the session. `database/index.ts` now recognises all three
  and reopens.

Not fixed:

- **A newly invited group is hidden until someone writes in it.** The chat
  list only shows conversations with a last message
  (`LAST_MSG_CREATED_TIME IS NOT NULL`), so there's no "you were added" entry.
  The suite has the owner post first.
- **Opening Group Info runs a phonebook sync**, so it shows the contacts
  disclosure (`useSelectableContacts` is used for member names).
- **expo-sqlite's native handle still gets released mid-session** on Android
  devices (cause unknown; nothing in the app closes it). The connection now
  recovers, but the failing call still surfaces as an unhandled rejection
  (a LogBox in dev builds), which the step flows dismiss.
- More issues and product requests from device testing (Samsung keyboard gap,
  iOS session surviving reinstall, slow reconnect after the network returns,
  unknown-sender chats): `docs/device-testing-notes.md`.
- **iOS 27 needs the UIScene lifecycle.** Expo 57's template doesn't adopt
  it, so `plugins/withIosSceneLifecycle.js` adds it.
