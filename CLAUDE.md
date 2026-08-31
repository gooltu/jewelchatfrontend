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

One real dev-client caveat exists, but it's about **push notifications, not XMPP**: Expo Go
dropped remote push support in SDK 53+, so `expo-notifications` remote push needs
`expo-dev-client`/EAS build. Local notifications still work in Expo Go. See
`src/notifications/pushNotifications.ts`.

## Design system

All UI primitives/theme come from `@nocturnalflow/design-system` — never build a new `Button`,
`Input`, `Avatar`, etc. locally. `src/components/design-system/index.ts` is a thin re-export
barrel; import from `@components/design-system` in app code, not the package directly, so screens
don't couple to the package name. Full component/prop/token reference:
`../NocturnalFlowRN/packages/design-system/CLAUDE.md`.

## Schema

`src/database/schema.ts` is the authoritative column reference for `Contact`, `ChatMessage`,
`GroupMembers`, `MessageReaction`. **Never rename/add/drop a column without a new versioned
migration** in `src/database/migrations/`. UI-facing `MessageStatus`
(`pending|sent|delivered|read|failed`) is derived from `ChatMessage`'s four independent flags
(`IS_SUBMITTED`/`IS_DELIVERED`/`IS_READ`/`IS_ERROR`) by `messageRepository.deriveMessageStatus` —
it is never stored as its own column.

## Conventions

- Path aliases (tsconfig + jest, Metro resolves tsconfig paths natively on SDK 57): `@assets`,
  `@database`, `@navigation`, `@gameserver`, `@chatserver`, `@services`, `@hooks`,
  `@notifications`, `@store`, `@components`, `@app-types` (not `@types` — that prefix is reserved by
  TypeScript's own `@types/*` package resolution and collides with it), `@config`.
- redux-persist whitelist is `['theme']` only — see the comment in `src/store/index.ts` for why
  `auth`/`chat` are excluded (tokens live in secure-store; chat state is all ephemeral).
- `react-native-worklets` plugin is handled automatically by `babel-preset-expo` on Expo SDK 57 (design-system depends on
  Reanimated 4 / worklets).

## Commands

- `npm start` / `npm run ios` / `npm run android` / `npm run web`
- `npm run lint` — `expo lint` (flat `eslint.config.js`, ESLint 9 — not `.eslintrc.js`)
- `npm run format` — prettier --write
- `npm test` — jest (`jest-expo` preset)
- `npm run typecheck` — `tsc --noEmit`
