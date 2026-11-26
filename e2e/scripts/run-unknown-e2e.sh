#!/usr/bin/env bash
# Unknown-sender prompt (ChatDetailScreen's UnknownSenderPrompt): a 1:1 chat
# from someone not in the phonebook asks to Continue, Block or Add to contacts.
# Three stranger bots (test accounts nobody's phonebook has) message:
#   - the Samsung  -> Continue, then reply;
#   - the Pixel    -> Block (later messages never show, no receipt goes back),
#                     then Unblock (new messages show again);
#   - the emulator -> Add to contacts via the Contacts app's create form
#                     (emulator only: on a real phone this would write into
#                     the owner's address book), then the roster subscribe.
# Logs in first (clearState), since a decision is stored per device and would
# otherwise hide the prompt on a rerun.
#
#   e2e/scripts/run-unknown-e2e.sh
#   E2E_UNKNOWN_CONTINUE_ON=pixel e2e/scripts/run-unknown-e2e.sh   # no Samsung: the Pixel does Continue too
set -euo pipefail
cd "$(dirname "$0")/../.."
OUT="e2e/.out/unknown"; mkdir -p "$OUT"
source e2e/scripts/lib-multi.sh

S1="${E2E_STRANGER_PHONES:-9000000008,9000000009,9000000010}"
IFS=',' read -r STRANGER_SAM STRANGER_PIXEL STRANGER_EMU <<< "$S1"
PORT="${E2E_UNKNOWN_BOT_PORT:-7781}"

CONT="${E2E_UNKNOWN_CONTINUE_ON:-samsung}"   # device that answers Continue
DEVICES=(emu pixel); [[ "$CONT" != pixel && "$CONT" != emu ]] && DEVICES+=("$CONT")
require_devices "${DEVICES[@]}"

echo "▸ starting stranger bots"
E2E_DEVICE_PHONE="$PHONE_EMU" E2E_BOT_PORT="$PORT" \
  E2E_BOT_PHONES="s1:$STRANGER_SAM,s2:$STRANGER_PIXEL,s3:$STRANGER_EMU" \
  node e2e/bot/server.mjs >"$OUT/bot.log" 2>&1 &
BOT_PID=$!
trap 'kill $BOT_PID 2>/dev/null || true; stop_keep_awake' EXIT
PHONES=(); for who in "${DEVICES[@]}"; do [[ "$who" == emu ]] || PHONES+=("$who"); done
start_keep_awake "${PHONES[@]}"
for _ in $(seq 1 60); do curl -sf "http://127.0.0.1:$PORT/health" >/dev/null && break; sleep 1; done
curl -sf "http://127.0.0.1:$PORT/health" >/dev/null || { echo "bot server not healthy"; cat "$OUT/bot.log"; exit 1; }

bot() { # bot <route> <json body>
  curl -sf -X POST "http://127.0.0.1:$PORT/$1" -H 'Content-Type: application/json' -d "$2"
}
jid_of_phone() { bot lookup "{\"phone\":\"$1\"}" | python3 -c 'import json,sys; print(json.load(sys.stdin)["jid"])'; }
inbox_kinds() { # inbox_kinds <bot> -> one "kind type refId body" line per entry
  bot inbox "{\"bot\":\"$1\"}" | python3 -c '
import json,sys
for e in json.load(sys.stdin)["inbox"]:
    print(e.get("kind"), e.get("type") or "-", e.get("refId") or "-", e.get("body") or "")'
}
label_of() { local d="$1"; echo "${d:0:5} ${d:5}"; } # 9000000008 -> "90000 00008", as the prompt formats it

# The emulator must not already know the third stranger (an earlier run's
# "Add to contacts" saved it): remove that phonebook entry first.
for raw in $(adb -s "$DEV_EMU" shell "content query --uri content://com.android.contacts/data --projection raw_contact_id --where \"mimetype='vnd.android.cursor.item/phone_v2' AND data1='+$CC$STRANGER_EMU'\"" | tr -d '\r' | sed -nE 's/.*raw_contact_id=([0-9]+).*/\1/p'); do
  adb -s "$DEV_EMU" shell "content delete --uri content://com.android.contacts/raw_contacts --where \"_id=$raw\"" >/dev/null
  echo "▸ removed emulator contact for $STRANGER_EMU (raw_contact $raw)"
done

echo "▸ login (clears each device's stored decisions)"
for who in "${DEVICES[@]}"; do step "$who" login DEVICE_PHONE="$(phone_of "$who")"; done

R="$(date +%H%M%S)"
CONT_JID=$(jid_of_phone "$(phone_of "$CONT")"); PIXEL_JID=$(jid_of_phone "$PHONE_PIXEL")

echo "▸ 1. $CONT: Continue"
bot send "{\"bot\":\"s1\",\"to\":\"$CONT_JID\",\"text\":\"$R stranger one\"}" >/dev/null
step "$CONT" open-group GROUP="$R stranger one"
step "$CONT" unknown-prompt PHONE_LABEL="$(label_of "$STRANGER_SAM")"
step "$CONT" unknown-continue
step "$CONT" send TEXT="$R sam answers"
sleep 3
inbox_kinds s1 | grep -qi "message .*$R sam answers" || { echo "✗ stranger one never got the $CONT's reply"; inbox_kinds s1; exit 1; }
echo "  ✓ stranger one received the reply"

echo "▸ 2. Pixel: Block, then Unblock"
bot send "{\"bot\":\"s2\",\"to\":\"$PIXEL_JID\",\"text\":\"$R stranger two\"}" >/dev/null
step pixel open-group GROUP="$R stranger two"
step pixel unknown-prompt PHONE_LABEL="$(label_of "$STRANGER_PIXEL")"
step pixel unknown-block
BLOCKED_ID=$(bot send "{\"bot\":\"s2\",\"to\":\"$PIXEL_JID\",\"text\":\"$R while blocked\"}" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')
step pixel expect-no-text TEXT="$R while blocked"
if inbox_kinds s2 | grep -q "^received - $BLOCKED_ID"; then
  echo "✗ the Pixel sent a delivery receipt for a blocked contact's message"; exit 1
fi
echo "  ✓ blocked message not shown and not receipted"
step pixel unblock
bot send "{\"bot\":\"s2\",\"to\":\"$PIXEL_JID\",\"text\":\"$R after unblock\"}" >/dev/null
step pixel expect-text TEXT="$R after unblock"

echo "▸ 3. emulator: Add to contacts"
bot send "{\"bot\":\"s3\",\"text\":\"$R stranger three\"}" >/dev/null
step emu open-group GROUP="$R stranger three"
step emu unknown-prompt PHONE_LABEL="$(label_of "$STRANGER_EMU")"
step emu unknown-add NAME="E2E Stranger $R"
sleep 3
# A first run delivers the subscribe itself; on a rerun the subscription
# already exists, so the server doesn't forward it again, but the stranger
# then receives the device's presence instead. Either proves the relationship.
inbox_kinds s3 | grep -qE "^presence (subscribe|available)" || { echo "✗ no roster subscribe/presence after Add to contacts"; inbox_kinds s3; exit 1; }
echo "  ✓ stranger three is subscribed to (presence subscribe or presence received)"

echo "✓ unknown-sender suite passed ($R, $STEP steps)"
