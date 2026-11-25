# Google Play release checklist

This covers everything outside the code needed to ship Jewel Chat (`net.jewelchat.app`) on Google Play. The code side is already done: push, App Check, legal pages, deletion requests, the contacts disclosure and release signing.

## 1. One-time: upload keystore

Create the upload key and keep it **outside this repo**. Back the file and passwords up in a password manager. Losing it means a key reset through Play support.

```bash
keytool -genkeypair -v -storetype PKCS12 -keystore ~/keys/jewelchat-upload.keystore \
  -alias jewelchat-upload -keyalg RSA -keysize 2048 -validity 10000
```

Add this to `~/.gradle/gradle.properties` (your user-level file, never committed):

```properties
JEWELCHAT_UPLOAD_STORE_FILE=/Users/<you>/keys/jewelchat-upload.keystore
JEWELCHAT_UPLOAD_STORE_PASSWORD=...
JEWELCHAT_UPLOAD_KEY_ALIAS=jewelchat-upload
JEWELCHAT_UPLOAD_KEY_PASSWORD=...
```

`plugins/withReleaseSigning.js` writes a release `signingConfig` that reads these. Without them the release build falls back to the debug key, and Play rejects that AAB.

In the Play Console, enrol in **Play App Signing**. Google keeps the app-signing key, and your keystore is only the upload key.

## 2. Build the AAB

1. Bump `ANDROID_VERSION_CODE` (and `version` if user-facing) in `app.config.ts`. Every upload needs a new versionCode.
2. Run:

```bash
npm run build:android:release
```

That runs `APP_ENV=production expo prebuild --clean -p android` followed by `./gradlew bundleRelease`. The output is `android/app/build/outputs/bundle/release/app-release.aab`.

`google-services.json` must be at the repo root. It's gitignored; download it from Firebase console › project `jewel-chat-1984` › Android app `net.jewelchat.app`.

## 3. Firebase console (project `jewel-chat-1984`)

- **Project settings › Your apps › Android:** add the SHA-256 fingerprints of the upload key and of the **Play app-signing key** (Play Console › Test and release › App integrity).
  ```bash
  keytool -list -v -keystore ~/keys/jewelchat-upload.keystore -alias jewelchat-upload
  ```
- **App Check › Apps › Android › Play Integrity:** register it, using the same SHA-256s.
- **App Check › Manage debug tokens:** debug builds use the debug provider. Add the token they log at startup (`[appCheck]` in Metro or logcat).
- **Cloud Messaging:** FCM HTTP v1 is on by default. The server sends with the service account below.
- **Service account** (Project settings › Service accounts › Generate key): put `project_id`, `private_key` and `client_email` into the `serverprojectx/app-secrets` secret. See `ChatServerConf/infra/BOOTSTRAP.md` §7.

## 4. Server rollout

Order matters:

1. Create `mongooseim/app-secrets` and extend `serverprojectx/app-secrets` (BOOTSTRAP.md §7). Apply `infra/iam` for the new secret ARN.
2. Deploy ServerProjextX. Its Dockerfile runs migrations at start, adding `deletion_requests` and the `adminlogs` FK change.
3. Restart the MongooseIM ASG instances so the user-data renders the new `path_prefix` and the GraphQL admin handler.
4. Check that `https://game.jewelchat.net/privacy`, `/terms` and `/account/delete` all load.
5. **App Check enforcement last.** Install the app from the Play internal testing track, confirm sign-in works with App Check tokens attached, and only then set `APP_CHECK_ENABLED=true` in `serverprojectx/app-secrets` and redeploy.
   - A sideloaded release build fails Play Integrity's app-recognition check, so it can only be tested through a Play track.

## 5. Play Console entries

| Field | Value |
|---|---|
| Privacy policy URL | `https://game.jewelchat.net/privacy` |
| Account deletion URL (Data safety › Data deletion) | `https://game.jewelchat.net/account/delete` |
| App access (reviewer login) | Phone: any Indian mobile number, e.g. one of the e2e test numbers. OTP: `888888`. Note for the reviewer: "Enter any 10-digit number on the phone screen; the verification code is 888888." |
| Ads | No ads |
| Target audience | 13+ (the policy says not directed at children under 13) |
| Content rating | Fill in the IARC questionnaire: user-to-user communication = yes; users can share content = yes; digital purchases = no |
| App category | Communication |

The fixed OTP is a temporary server behavior that every number accepts. Replace it with real SMS OTP before a wide production launch. The web deletion form is request-based (an admin processes it) for exactly this reason.

## 6. Data safety form

Use the answers below. "Processed ephemerally" = no for all of them; all data is encrypted in transit.

| Data type | Collected | Shared | Optional? | Purpose |
|---|---|---|---|---|
| Phone number | Yes | No | Required | Account management, App functionality |
| Name (display name) | Yes | No | Required | App functionality |
| Address, date of birth, gender (wallet/gift delivery) | Yes | No | Optional | App functionality (rewards delivery) |
| Other financial info (UPI ID) | Yes | No | Optional | App functionality (rewards payout) |
| Messages: other in-app messages | Yes | No | Required | App functionality |
| Photos | Yes | No | Optional | App functionality |
| Videos | Yes | No | Optional | App functionality |
| Audio: voice or sound recordings | Yes | No | Optional | App functionality |
| Contacts | Yes (numbers of tapped contacts are sent to the server) | No | Optional | App functionality |
| App interactions (game progress, jewels) | Yes | No | Required | App functionality |
| Device or other IDs (FCM token, Play Integrity attestation) | Yes | No | Required | App functionality, Fraud prevention / security |

- Data is **not** sold and **not** used for ads.
- Users **can request deletion**: in the app (Settings › Delete account) and at the web URL above.
- Service providers (AWS, Google Firebase) process data on our behalf. Under Play's definitions, that isn't "sharing".

Review this table against the published privacy policy (`ServerProjextX/public/privacy.html`). The two must match. The policy is a **draft**: fill in `[OPERATOR NAME]`, confirm `support@jewelchat.net` exists, and have it reviewed before publishing.

## 7. Sensitive permissions

| Permission | Why | Play declaration |
|---|---|---|
| `READ_CONTACTS` | Find friends. A prominent disclosure (`contactSyncService.ensureContactsDisclosureAccepted`) is shown before the OS prompt. | Covered by Data safety (Contacts) |
| `RECORD_AUDIO` | Voice notes, recorded only while the mic button is held | Data safety (Audio) |
| `POST_NOTIFICATIONS` | New-message notifications. Requested after sign-in. | none |
| `READ_MEDIA_*` / photo picker | Gallery attachments | Uses the system photo picker. Declare if Play flags it. |

`WRITE_CONTACTS` is stripped through `android.blockedPermissions`. There is no camera permission (gallery only).

## 8. Processing deletion requests

Requests submitted at `/account/delete` land in `deletion_requests` (status `pending`). Process each one within 7 days, the period the privacy policy promises:

```bash
# on a Node app instance, or locally with production env vars:
node scripts/process-deletion.js          # list pending
node scripts/process-deletion.js <id>     # delete that account
```

The admin API does the same: `GET /admin/deletionRequests` and `POST /admin/deletionRequests/:id/process` or `/reject`.

Processing first removes the user from MongooseIM through the GraphQL `account.removeUser` call (MAM, roster, groups, push subscriptions), then deletes every game-server row. If MongooseIM fails, nothing is deleted and it's safe to retry.
