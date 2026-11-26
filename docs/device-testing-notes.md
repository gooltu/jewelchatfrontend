# Notes from multi-device testing

Issues and product requests that came up while running the E2E suites on the
Android emulator, the iOS simulator, a Pixel 7 and a Samsung Galaxy S23 Ultra
(SM-S918U1). App bugs fixed along the way are listed in `e2e/README.md`.

## Open issues

### Samsung: large gap between the chat input bar and the keyboard

Reported on the Samsung S23 Ultra; not seen on the Pixel 7. With the keyboard
open in a chat, there is a large empty space between the composer and the
top of the keyboard.

Likely cause (not yet confirmed on the device): the design system's
`ChatInputBar` (`@nocturnalflow/design-system`, `organisms/ChatInputBar`)
moves itself up by the keyboard's full height (`translateY =
-e.endCoordinates.height` from `keyboardDidShow`) and also keeps
`paddingBottom: insets.bottom`. When the keyboard is open, the bottom
safe-area inset is under the keyboard, so that padding becomes an extra gap.
It grows with the nav bar's height: a Samsung on 3-button navigation has a
much taller bottom inset than a Pixel on gesture navigation. A second
suspect is the activity's `windowSoftInputMode="adjustResize"` also resizing
the window on One UI, which would double the offset.

To confirm: compare `insets.bottom` and `endCoordinates.height` on both
phones, and check the Samsung's navigation mode. The fix belongs in the design
system's `ChatInputBar` (for example, drop the bottom inset padding while the
keyboard is open), which is maintained separately from this app.

### iOS: a reinstalled app signs straight back in, with empty chats

On iOS, `expo-secure-store` keeps the auth tokens in the Keychain, which
survives clearing app data and deleting the app. A fresh install (or Maestro's
`clearState`) therefore restores the old session straight onto the chat list,
but the SQLite data is gone: the list says "No conversations yet", groups
without new messages stay hidden, and 1:1 history isn't fetched (history
catch-up only runs from the last background time). Android clears both
together. Common fix: on first launch after install (a flag in AsyncStorage,
which is wiped with the app), clear the secure-store tokens or run a full
history/room resync.

### Reconnecting can lag the network by up to 30 seconds

`stropheClient.ts` retries with exponential backoff capped at
`MAX_RECONNECT_DELAY_MS` (30 s) and doesn't listen for network changes. After
a phone comes back online (airplane mode off, Wi-Fi back), it can stay
disconnected for up to 30 s, with no live messages and the composer queueing.
Seen on the Samsung in the direct suite's offline step. Fix: reconnect
immediately on a network-available event (e.g.
`@react-native-community/netinfo`) and reset the backoff.

## Product requests

### Message from an unknown user: show their profile, then continue, block or add

**Done** (merged from `claude/unknown-sender-prompt-6d4725`). Opening a 1:1 chat
from someone not in the phonebook looks up their number and profile picture
and replaces the composer with a prompt: Continue / Block / Add to contacts
(`components/shared/UnknownSenderPrompt.tsx`, `services/unknownSenderService.ts`,
migration `007_unknown_sender`). Blocking is device-side only (the server has
no `mod_blocking`): the blocked person's messages are dropped and get no
receipts, and they aren't told. Unblocking also counts as Continue. "Add"
opens the system create-contact form (no `WRITE_CONTACTS` needed). Covered on
devices by `npm run e2e:unknown`.

Found while testing it: the Contacts app's form sent JewelChat to the
background, which drops the XMPP session, so the roster subscribe after saving
was silently skipped. The Add action now uses `setTransientBackgroundExpected`
like the image picker.
