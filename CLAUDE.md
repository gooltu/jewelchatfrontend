@AGENTS.md

# CLAUDE.md — jewelchatfrontend

Expo (SDK 57) / TypeScript chat messenger. SQLite is the source of truth for all chat data;
Redux holds only ephemeral/UI state; a service layer (`src/services/`) mediates every screen's
access to the database, the chat server, and the game server — screens never import
`database/*Repository`, `chatserver/*`, or `gameserver/*` directly.

## Ownership table

| Owns | Lives in |
|---|---|
| Persisted messages, status flags, read receipts | `ChatMessage` table (`src/database/schema.ts`) |
| Conversation list / contact metadata | `Contact` table |
| Group rosters | `GroupMembers` table |
| Per-user emoji reactions (1-1 + group) | `MessageReaction` table, via `reactionRepository.ts` |
| Active thread id, typing-per-JID, XMPP connection status, unsent drafts | `store/slices/chatSlice.ts` (entity-adapter collections for typing/drafts) |
| Session UI state (never tokens) | `store/slices/authSlice.ts` |
| Selected theme mode only | `store/slices/themeSlice.ts` (actual tokens/colors: `@nocturnalflow/design-system`) |
| Send/receive orchestration (SQLite + chatserver + Redux) | `services/chatService.ts` |
| Offline send queue + retry-on-reconnect | `services/syncService.ts` |
| Login/logout, secure-store tokens | `services/authService.ts` |
| Auth tokens | `expo-secure-store` (never AsyncStorage, never Redux) |
| Local pool of server-issued, unattached jewels + batch verification code + fetch cooldown | `store/slices/jewelPoolSlice.ts`, drawn from only via `services/jewelPoolService.ts` |
| Firebase App Check attestation setup + token fetching (enabled client-side; server enforcement is a flag, see below) | `services/appCheckService.ts` |
| Photo/video/voice-note upload, download+disk-cache, cap-checking | `media/mediaUploadService.ts` + `media/s3Upload.ts`, orchestrated only via `services/chatService.ts` |
| Own profile-pic upload + any user's resolved/cached avatar source | `services/profilePicService.ts`, consumed via `hooks/useAvatarSource.ts` |
| 1:1 peer online/offline state (ephemeral) | `store/slices/chatSlice.ts`'s `presence` entity-adapter collection |
| XMPP roster + presence-subscription protocol (add/subscribe/accept/reject) | `chatserver/roster.ts`, orchestrated only via `services/chatService.ts` |
| One-time roster/presence backfill "already ran" flag (persisted) | `store/slices/rosterSlice.ts` |
| Gift-task catalog (paginated `/getGiftTasks`) + per-gift jewel-requirement cache (not persisted); per-cycle target level + redeem | `store/slices/giftTasksSlice.ts`, fetched/redeemed only via `services/gameService.ts`; level record is per-mount local state in `hooks/useGiftTaskLevel.ts` |
| Reply/forward/star/delete-for-me, archive/pin/delete-conversation | `services/chatService.ts` (`forwardMessage`, `toggleMessageStar`, `deleteMessageForMe`, `setConversationArchived`, `setConversationPinned`, `deleteConversation`) |
| Remote push registration (XEP-0357 enable/disable with the FCM token), notification channel, per-thread dismiss | `services/pushService.ts` (stanzas: `chatserver/push.ts`), called only from `chatService` (on every `connected`, on logout, and in `setActiveConversation`) |
| Notification presentation and tap-to-open routing | `notifications/pushNotifications.ts` (`useNotificationDeepLinking`, mounted in `App.tsx`) |
| Accepted in-app disclosures (contacts prominent disclosure), persisted | `store/slices/consentSlice.ts`, written by `contactSyncService.ensureContactsDisclosureAccepted` |
| Unknown-sender prompt answers (continue / block / add to contacts), device-side blocking | `services/unknownSenderService.ts` (+ `Contact.IS_UNKNOWN_ACCEPTED`/`IS_BLOCKED`); UI `components/shared/UnknownSenderPrompt.tsx` |
| Privacy policy / terms / account-deletion URLs | `app.config.ts` `extra` → `config/env.ts` → `utils/legalLinks.ts` (pages served by ServerProjextX) |

## Media attachments (photo / video / voice note)

Gallery-only picking (no camera) for photo/video; in-app recording for voice notes. All three ride
the same pipeline: `mediaUploadService.ts` caps-checks and prepares the local file (downscale for
images via `expo-image-manipulator`; thumbnail extraction for video; nothing to prepare for voice
beyond the recording itself), `s3Upload.ts` does the generic "fetch a fresh presigned PUT URL,
stream the file to it" step shared by all three kinds and by `profilePicService.ts`, and
`chatService.sendImageMessage`/`sendVideoMessage`/`sendVoiceMessage` insert an offline-first SQLite
row (local `file://` URI as a placeholder in `MEDIA_CLOUD`, `MEDIA_UPLOADED = 0`) **before**
`chatService.uploadAndSendMedia` runs the actual upload — `enqueueOutgoingMessage` (the normal
stanza-send path) is only called once the real S3 key is known, since the stanza must carry the
key, not bytes. `chatService.resumePendingMediaUploads` retries anything still stuck at
`MEDIA_UPLOADED = 0` on reconnect/foreground.

Receiving device resolves a message's `MEDIA_CLOUD`/`MEDIA_CLOUD_THUMBNAIL` S3 key to a usable,
locally-disk-cached file via `hooks/useResolvedMediaUri.ts` — never hands the raw presigned
download URL straight to an `<Image>`, since that URL is freshly re-signed (and different) every
time it's fetched. Full-screen viewing: `MediaViewerScreen.tsx` (photo pinch-zoom / video
playback); voice-note playback is inline in the bubble via `hooks/useVoicePlayback.ts`, which
enforces single-active-playback across every voice bubble on screen (starting one pauses whichever
other one was playing), backed by `expo-audio`.

`MSG_TYPE.IMAGE`/`VIDEO`/`VOICE` (`types/chat.ts`) all reuse the migration-004 metadata columns
(`MEDIA_WIDTH`/`HEIGHT`/`DURATION_MS`/`SIZE_BYTES`/`MIME`) — VOICE only ever populates
`DURATION_MS`/`SIZE_BYTES`/`MIME` (no thumbnail/width/height).

## Profile pictures

`services/profilePicService.ts` owns both your own upload (`uploadMyProfilePic`, via the same
`s3Upload.ts` primitive above) and resolving *any* user's avatar (`getProfilePicSource`) — the
latter derives the target's numeric id from their JID locally (`Strophe.getNodeFromJid`, no network
round trip needed, since JIDs are minted as `${userId}@${domain}`), fetches a fresh signed download
URL, and validates it actually loads via `Image.prefetch` before ever handing a source to the UI, so
a user who's never uploaded a photo just falls back to initials, never a broken-image flash.

Caching problem/solution worth knowing: `getProfilePicDownloadUrl` returns a **new signed URL every
call** even though the underlying photo is unchanged, so `expo-image`'s default URL-keyed cache
would never hit. Fixed via `expo-image`'s `source.cacheKey` override — other users' photos key off
an hourly time bucket (`profile:<userId>:<hour>`), so an updated photo elsewhere shows up within the
hour; your *own* just-uploaded photo instead keys off an in-memory-only override bumped at upload
time, so you see your own update instantly without waiting for the bucket to roll over (resets to
the normal hourly behavior on app relaunch — an accepted, self-correcting rough edge).

`hooks/useAvatarSource.ts` wraps `getProfilePicSource` for any screen that needs a bare
`ImageSourcePropType` (`ChatListScreen` rows, `ChatDetailScreen`'s 1:1 header, `ProfileDetailScreen`,
`EditProfilePictureScreen`); `components/shared/ContactAvatar.tsx` wraps the same hook for screens
that just want a drop-in circular avatar widget (`GroupInfoScreen`, `SelectContactScreen`,
`SelectGroupMembersScreen`). `Contact.SMALL_IMAGE`/`IMAGE_PATH` are pre-existing, unrelated, still-
unused legacy columns — this feature needs no SQLite persistence at all, `expo-image`'s own disk
cache (keyed by `cacheKey`) is the only caching layer involved.

## Roster & presence

Tapping a phonebook contact who turns out to be a JewelChat user (`contactSyncService.
resolveContactOnTap`, lazy/per-contact lookup — deliberately never bulk, see that file's own doc
comment) now also roster-adds them and sends a presence-subscribe request
(`chatService.addToRosterAndSubscribe`, wrapping `chatserver/roster.ts`'s stanza builders). Stanza
shapes (`jabber:iq:roster` add, RFC 6121 `subscribe`/`subscribed`/`unsubscribed` presence types) are
confirmed against this exact server via the reference `ChatServerConf/xmpp/strophe.roster.js`
implementation — `roster.ts`'s header comment cites it directly. Deliberately narrow: no roster
versioning (XEP-237), no full roster fetch, no remove/unsubscribe — the local `Contact` table is
already this app's source of truth for "who do we know."

Incoming subscribe requests are only auto-accepted if the sender's phone number (resolved from
their JID's userid via `downloadContactById`) is in our own phonebook (`contactRepository.
getContactByNumber`) — otherwise explicitly rejected (`unsubscribed`, not silence). Accepting also
reciprocates (`addToRosterAndSubscribe` back), so the relationship reaches `subscription='both'` as
soon as *either* side's discovery fires first, rather than depending on both people's independent
lazy-tap discovery happening to occur. `chatService.backfillRosterSubscriptions` runs once ever
(flag in `store/slices/rosterSlice.ts`) to cover contacts whose JewelChat identity was already
resolved before this feature shipped.

**Load-bearing server fact, confirmed via direct ejabberd container investigation** (see
`ChatServerConf/CLAUDE.md`'s "Presence requires an initial `<presence/>` first" section):
`mod_presence` only initializes its per-session subscription state once a session sends its *own*
initial bare `<presence/>` — without it, roster-triggered presence delivery silently does nothing
even with correct `subscription='both'` DB state. `chatService.connect()`'s existing
`broadcastPresence()` call on every (re)connect already satisfies this; nothing extra was needed
there.

Presence is ephemeral Redux state only (`chatSlice`'s `presence` entity adapter, mirroring the
pre-existing `typing` one exactly) — never persisted, never written to SQLite. `ChatDetailScreen`'s
header subtitle shows it for 1:1 threads only (group presence isn't a single-person concept),
with the typing indicator taking priority when both are true:
`isPeerTyping ? 'typing…' : presence?.isOnline ? 'Online' : lastSeen-formatted string`.

## Unknown senders & blocking

A 1:1 chat from someone not in the phonebook (no `CONTACT_NAME`/`PHONEBOOK_CONTACT_NAME`; never a
group or the Team Jewel Chat welcome contact) is resolved by `chatService.resolveUnknownSender`
from both `ChatListScreen` and `ChatDetailScreen`, since push deep links skip the list. It looks the
JID's userId up via `/downloadContact`. A stranger's number goes onto the JID row with
`contactRepository.setContactNumberIfUnset`, which is UNIQUE-safe. The re-upsert keeps the row's
existing `IS_BLOCKED` and names. Until the user answers, `ChatDetailScreen` shows
`UnknownSenderPrompt` in place of the composer: avatar, formatted number ("+91 90000 00004"), and
Add to contacts / Block / Continue. Titles fall back name → phonebook name → number → "Unknown
User" (`utils/contactDisplay.ts`).

- **Continue** sets `IS_UNKNOWN_ACCEPTED` (migration 007).
- **Add to contacts** opens the OS create-contact form with the number pre-filled
  (`expo-contacts` `Contact.presentCreateForm`, so no `WRITE_CONTACTS`). It then re-runs
  `syncPhonebook` and roster-subscribes once the row has a phonebook name.
- **Block** is device-side only, because the server has no `mod_blocking`/`mod_privacy`. The
  server still delivers stanzas and the peer is never told. `stropheEvents.handleMessageStanza`
  drops all of a blocked JID's 1:1 stanzas (messages, reactions, receipts, chat states) before
  storing or receipting. `chatService.persistArchivedMessage` skips its MAM-backfilled messages.
  A blocked chat shows `BlockedBanner` (Unblock) instead of the composer. Messages stored before
  the block stay.

## Message actions & conversation management

Reply wires through `ChatMessage.IS_REPLY`/`REPLY_PARENT` (pre-existing columns) plus the
design-system's already-built `ChatInputBar` reply bar / `MessageBubble` swipe-to-reply / in-bubble
quote — this app only had to supply the data, not the UI. **Correctness point worth knowing**:
`REPLY_PARENT` is a per-device SQLite `_ID`, never meaningful across devices — the wire stanza
carries the quoted message's `SENDER_MSG_ID`+`CREATOR_JID` instead (`receiptStanzas.ts`'s reply
element), and each receiving device resolves that back to *its own* local `_ID` via the same
dedup-lookup `getMessageBySenderMsgId` already uses, before storing it in its own `REPLY_PARENT`.

Forward (`chatService.forwardMessage`, multi-target) copies a message's content into a new outgoing
row per target room with `IS_FORWARD = 1`, `IS_REPLY = 0` (forwarding drops any reply context).
Star (`IS_STARRED`, migration 005) and delete (`deleteMessageForMe` — hard `DELETE`, local-only, no
wire/retraction protocol) are both per-message, both scoped to "this device's copy only" by design;
there is no edit and no delete-for-everyone (neither was built — explicit scope decisions, not
gaps). `StarredMessagesScreen`/`ForwardMessageScreen` are the two new reachable screens;
`MessageActionSheet`/`ConversationActionSheet` (`components/shared/`) are the long-press menus —
both app-local `Modal`-based components, since the design system has no generic action-sheet
primitive (per [[feedback_design_system_edits]], this app doesn't add one there itself).

Archive/pin (`Contact.IS_ARCHIVED`/`IS_PINNED`/`PINNED_TIME`, migration 005) and delete-conversation
(`deleteConversation` — clears local `ChatMessage` rows + the `Contact` row's preview fields; does
**not** touch group membership, deliberately distinct from `GroupInfoScreen`'s existing "Leave
group," which is server-side) are surfaced via `ConversationActionSheet` on a long-press in
`ChatListScreen`, which now also renders a "Pinned" section divider and an "Archived (N)" row
linking to `ArchivedChatsScreen`. No swipe-to-reveal gestures — long-press only, in both cases.

## Jewels

`ChatMessage.JEWEL_TYPE`/`JEWEL_CODE` (migration `006_jewel_code.ts`) are populated from a local
pool of server-issued jewels, **not** randomly generated client-side. `GET /getJewels` returns
`{ error, jewels: jeweltype_id[], code }` — `code` is one value shared by the whole batch, sent
back for every jewel collected from it.

- `jewelPoolService.takeJewel()` is the only way to attach a jewel to a message — purely
  synchronous (a Redux read + optional dispatch), so message insert/render never waits on a
  network round trip. Returns `null` if the pool is empty, and the message is persisted with no
  jewel at all; a background refill (fire-and-forget) runs for *future* messages only. Called from
  `chatService.persistArchivedMessage` and `stropheEvents.handleMessageStanza` (incoming messages
  only — own messages never get one), and from `chatService.seedWelcomeContact`.
- Pool refill (`GET /getJewels`) is purely reactive (only triggered when the pool is found empty)
  and rate-limited to once per `MIN_FETCH_INTERVAL_MS` (15 min) — enforced via `jewelPool.lastFetchedAt`,
  which is **persisted** (see `store/index.ts`'s whitelist) so the gap holds across an app restart,
  not just within a session.
- `jewelPoolService.ensureJewelPoolReady()` is the one *awaited* exception: `seedWelcomeContact`
  (the first-run "Team Jewel Chat" welcome messages) calls it before inserting, so those messages
  carry real jewels on the very first run instead of racing a background fetch. Everywhere else,
  fire-and-forget only.
- Collecting a jewel queues `{ type, code }` into `game.pickedJewels` (`chatService.pickJewel` →
  `gameSlice.jewelPicked`), flushed via `authService.flushPickedJewels` to
  `POST /bulkPickJewelVerified` (renamed from `/bulkPickJewel` — the backend now verifies `code`
  before crediting a pick).

## Firebase App Check

App Check gates `POST /registerPhoneNumber`, `/verifyCode` and `/getAccessToken` on the server, but only once ServerProjextX sets `APP_CHECK_ENABLED=true`. It is **enabled in the app**:
- Both `@react-native-firebase/*` plugins are active in `app.config.ts`.
- `configureAppCheck()` runs from `App.tsx`.
- `react-native.config.js` (which used to exclude app-check from autolinking) is deleted.

Firebase project: `jewel-chat-1984`. `google-services.json` is at the repo root and gitignored; `app.config.ts` only references it when the file exists.

There is no iOS app or `GoogleService-Info.plist` yet. `app.config.ts` adds the iOS `googleServicesFile` and the App Attest entitlement only when that file exists, so a normal iOS prebuild is expected to fail until it's added.

For an iOS simulator build without it, set `JC_NO_FIREBASE=1` (development only) on both `expo prebuild` and `expo run:ios`. It drops the two Firebase plugins, and `react-native.config.js` keeps both packages out of autolinking. App Check then never attaches a header, and push won't work. The E2E group suite uses this (`e2e/README.md`).

iOS 27 won't launch an app that hasn't adopted the UIScene lifecycle, and Expo 57's template hasn't. `plugins/withIosSceneLifecycle.js` adds a scene manifest and a `SceneDelegate` that owns the window.

Providers:
- **Debug builds:** the debug provider. Register its logged token in Firebase console › App Check › Manage debug tokens.
- **Release builds:** Play Integrity. Sideloaded release builds fail app recognition, so verify through a Play testing track before turning on server enforcement. `docs/play-store-release.md` §4 has the rollout order.

**Load-bearing, still true:** with app-check autolinked, its native Android module calls `FirebaseAppCheck.getInstance()` in its own constructor at module-registration time, before any JS runs. If `google-services.json` is missing from a build, that crashes at startup, and no JS try/catch can stop it. That's why the file exclusion existed. If you ever need a build without Firebase config, put the `react-native.config.js` exclusion back; dropping the JS call isn't enough.

Also load-bearing: **`expo run:android` / `expo run:ios` do NOT re-sync `android/` / `ios/` from `app.config.ts` if those directories already exist.** They only prebuild automatically when the folders are missing. Both are gitignored (CNG). After *any* `app.config.ts` or config-plugin change, run `npx expo prebuild --clean` before `expo run:*`.

`gameserver/client.ts` attaches a fresh `X-Firebase-AppCheck` header (via `appCheckService.getAppCheckToken()`, registered through `setAppCheckTokenProvider`) only on the three protected paths. It converts a 403 from any of them into a thrown `AttestationError`, separate from the 2xx `{error:true, message}` validation errors those endpoints return, so callers can tell "this device failed attestation" apart from a normal validation failure.

## Push notifications

Push runs entirely over XMPP:
1. On every `connected`, `pushService.ensurePushRegistered` asks for `POST_NOTIFICATIONS`, gets the **native FCM token** (`getDevicePushTokenAsync`, not an Expo push token) and sends an XEP-0357 `<enable>` to `pubsub.jewelchat.net`. The node is a stable per-install id in secure-store.
2. MongooseIM (`mod_event_pusher.push` + `mod_push_service_mongoosepush`) stores the subscription. When a message arrives for the user with no live session, it POSTs to ServerProjextX `/mongooseim/pushnotification/<PUSH_PATH_SECRET>/v3/notification/<fcm-token>`.
3. ServerProjextX sends an FCM notification+data message through firebase-admin on channel `messages`, with data `{chatRoomJid, title, isGroup}` (see `utils/buildFcmMessage.js`).
4. Tapping it routes to `ChatDetail` (`useNotificationDeepLinking`).

**Load-bearing:** `useAppState` now **disconnects XMPP on every real `background`**. While a session (or a stream-management resumable one) is alive, MongooseIM keeps routing messages to it, so no push is ever sent. Foreground reconnects and backfills through MAM as before. The transient-background exception (image picker) still skips the disconnect.

Other rules:
- Logout sends `<disable>` (`chatService.teardownForLogout`) before disconnecting, capped at 3s.
- A notification for the currently open thread is suppressed (`setNotificationHandler`).
- Opening a thread dismisses its tray notifications.
- Android only. iOS would need APNs through FCM and a `GoogleService-Info.plist`.
- Remote push doesn't work in Expo Go (SDK 53+). Use `expo run:android` or a release build.
- The real MongooseIM v3 payload shape (`alert.title` = bare sender JID, or the room JID for MUC Light) is mapped defensively in `buildFcmMessage`. Confirm it against a live payload when first testing on a device.

## Play Store compliance

Release checklist, Data safety answers, reviewer login and the deletion-request runbook: `docs/play-store-release.md`.
- **Legal pages:** `https://game.jewelchat.net/privacy`, `/terms`, `/account/delete`, served by ServerProjextX `controllers/legal.js` + `public/`. They are linked from Settings ("Privacy & account") and the phone-entry screen (`LegalConsentText`).
- **Account deletion is request-based** on purpose. The Settings row opens the web form, and an admin processes the request (ServerProjextX `scripts/process-deletion.js`), because OTP is currently fixed at 888888. There is no in-app self-serve delete API.
- **Contacts:** `contactSyncService.syncPhonebook` shows a prominent disclosure Alert (accepted once, persisted in `consentSlice`) before `Contacts.requestPermissionsAsync`. `WRITE_CONTACTS` is stripped through `android.blockedPermissions`.
- **Release signing:** `plugins/withReleaseSigning.js` reads `JEWELCHAT_UPLOAD_*` from `~/.gradle/gradle.properties`, falling back to the debug key when unset. Build with `npm run build:android:release`. Bump `ANDROID_VERSION_CODE` in `app.config.ts` for every upload.

## XMPP notes

`react-native-strophe` (`file:../react-native-strophe`, sibling repo) is a pure-JS fork of
strophe.js patched for RN (no `ios/`/`android/` dirs, no native module) — it runs fine under
plain Expo Go, **no custom dev client needed for XMPP itself**. It polyfills
`DOMParser`/`atob`/`btoa` on import and exposes the classic strophe.js API: `new
Strophe.Connection(service)` (auto-selects WS vs BOSH from the URL scheme), `.connect(jid, pass,
statusCallback)`, `.addHandler(...)`, `.send()`/`.sendIQ()`. Confirmed by reading
`../react-native-strophe/src/core.js` directly — see the header comment in
`src/chatserver/stropheClient.ts` for the full confirmed API surface. Connection lifecycle +
reconnect backoff: `stropheClient.ts`. Stanza → SQLite mapping (dedup, reactions, chat-states):
`stropheEvents.ts`. Type shim (the package ships no `.d.ts`): `src/types/react-native-strophe.d.ts`.

**Load-bearing: stanza handlers are re-registered on every `connected`.** Strophe's
`_doDisconnect` empties `connection.handlers` on every disconnect, and `stropheClient.connect()`
reuses the same `Connection` object across reconnects — so
`chatService.registerStanzaHandlersForSession` must run on each transition to `connected`
(deleting the previous `addHandler` refs first, so it never double-registers). Don't
reintroduce a once-per-Connection guard: that shipped once and made every reconnected session
silently drop all incoming messages/receipts/typing/presence (caught by `e2e/` flow
`09-reconnect`).

**SASL is PLAIN-only over `wss:`/`https:`** (`stropheClient.resolveSaslMechanisms`). Strophe's
default SCRAM-SHA-1 runs 10,000 PBKDF2 rounds in pure JS; on a slow device that took 8–27s and the
server closed the stream mid-auth. TLS already protects the credential (the refresh token). An
unencrypted `ws://` URL falls back to Strophe's defaults so the token is never sent in clear text.

Remote push needs a dev or release build (Expo Go dropped remote push in SDK 53+). That's a push limitation, not an XMPP one. See "Push notifications" above.

## Design system

All UI primitives/theme come from `@nocturnalflow/design-system` — never build a new `Button`,
`Input`, `Avatar`, etc. locally. `src/components/design-system/index.ts` is a thin re-export
barrel; import from `@components/design-system` in app code, not the package directly, so screens
don't couple to the package name. Full component/prop/token reference:
`../NocturnalFlowRN/packages/design-system/CLAUDE.md`.

## E2E testIDs (Maestro / Detox / RNTL)

Design-system components only emit ids when given a root `testID`; they then derive child ids
themselves (`.input`, `.send`, `.status`, …, see the design-system CLAUDE.md's testID table).
App-side convention is `<screen>.<element>[.<record>]`, dot-separated kebab-case:

- Headers are automatic: `HeaderAdapter` sets `<route-kebab>.header` (e.g.
  `chat-detail.header.subtitle`, `chat-list.header.action.more`). Tab bar: `tabbar.tab.<TabName>`.
- Chat detail: `chat-detail.composer` (ChatInputBar), `chat-detail.messages`, `chat-detail.typing`,
  `chat-detail.message.<SENDER_MSG_ID>` (+ `.row`, `.jewel`, `.forwarded`, `.reactions`,
  `.reaction.<i>`, `.failed`, `.media-spinner`), action sheets `message-actions.*` /
  `conversation-actions.*` (toggle rows are named by what they'll do: `.star`/`.unstar`,
  `.pin`/`.unpin`, `.archive`/`.unarchive`), the unknown-sender prompt `unknown-sender` (`.phone`,
  `.add`, `.block`, `.continue`) and `blocked-banner.unblock`.
- Lists: `chat-list.row.<jid-node>`, `archived-chats.row.…`, `forward-message.row.…`,
  `select-contact.row.<phone-digits>`, `select-members.row.<phone-digits>`, `starred.message.…`.
- Settings: `settings.privacy-policy`, `settings.terms`, `settings.delete-account`. Phone entry legal line: `phone-entry.legal`.
- Auth: `phone-entry.phone`/`.next`, `otp.digit.<0-n>`/`.verify`/`.resend`, `profile-name.*`, `referral.*`,
  `onboarding.get-started`.

Record segments must be ids that are identical on every device (`SENDER_MSG_ID`, the JID's
userId, the phone number) — never the per-device SQLite `_ID` — so a multi-device test or bot peer
can address the row it created. Build them via `components/shared/testIDs.ts`, not by hand.

## Schema

`src/database/schema.ts` is the authoritative column reference for `Contact`, `ChatMessage`,
`GroupMembers`, `MessageReaction`. **Never rename/add/drop a column without a new versioned
migration** in `src/database/migrations/`. UI-facing `MessageStatus`
(`pending|sent|delivered|read|failed`) is derived from `ChatMessage`'s four independent flags
(`IS_SUBMITTED`/`IS_DELIVERED`/`IS_READ`/`IS_ERROR`) by `messageRepository.deriveMessageStatus` —
it is never stored as its own column. `schema.ts`'s `CREATE_CHAT_MESSAGE_TABLE` is only the
original v1 DDL text — several real columns (e.g. `MEDIA_WIDTH`, `IS_STARRED`, `JEWEL_CODE`) exist
solely via later migrations and are never backfilled into that base DDL string; the true current
schema is base DDL + every migration applied in order, not `schema.ts` alone. Latest migration:
`007_unknown_sender.ts` (adds `Contact.IS_UNKNOWN_ACCEPTED`, see "Unknown senders & blocking").

## Conventions

- Path aliases (tsconfig + jest, Metro resolves tsconfig paths natively on SDK 57): `@assets`,
  `@database`, `@navigation`, `@gameserver`, `@chatserver`, `@services`, `@hooks`,
  `@notifications`, `@store`, `@components`, `@app-types` (not `@types` — that prefix is reserved by
  TypeScript's own `@types/*` package resolution and collides with it), `@config`.
- redux-persist whitelist (`src/store/index.ts`) currently covers `theme`, `game`, `factory`,
  `achievements`, `invitees`, `children`, `roster`, `jewelPool`, `consent` — each entry has an inline comment
  there explaining why it is (or, for slices like `chat`/`auth`, is not) persisted. Don't assume
  the list is just `['theme']`; check `store/index.ts` directly, it changes as features land.
- `react-native-worklets` plugin is handled automatically by `babel-preset-expo` on Expo SDK 57 (design-system depends on
  Reanimated 4 / worklets).

## Commands

- `npm start` / `npm run ios` / `npm run android` / `npm run web`
- `npm run build:android:release`: production prebuild plus a signed `bundleRelease` AAB (see `docs/play-store-release.md`)
- `npm run lint` — `expo lint` (flat `eslint.config.js`, ESLint 9 — not `.eslintrc.js`)
- `npm run format` — prettier --write
- `npm test` — jest (`jest-expo` preset). `jest.config.js` maps `immer` to its CJS build
  (`^immer$`) — `jest-expo`'s `react-native` export condition otherwise resolves it to an
  unparsable ESM build, which breaks *any* test importing a `@reduxjs/toolkit` slice. Don't remove
  that mapping.
- `npm run typecheck` — `tsc --noEmit`
- `npm run e2e [-- <flow>]` — Maestro flows on one Android emulator against XMPP bot peers
  (`e2e/bot/server.mjs`, `@xmpp/client` — deliberately not the app's own strophe code). Setup,
  flow list and the bot HTTP API: `e2e/README.md`. Hits the real servers by default; test
  accounts sign in with the server's temporary fixed OTP.
- `npm run e2e:direct` / `e2e:group` / `e2e:unknown` — multi-device suites (emulator, iOS simulator, Pixel, Samsung; no bots for direct/group, stranger bots for unknown-sender). Setup and coverage: `e2e/README.md` "Multi-device suites".
