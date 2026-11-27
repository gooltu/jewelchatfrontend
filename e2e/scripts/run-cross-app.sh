#!/usr/bin/env bash
# Cross-app cases X01–X07: the real app on the Android emulator AND the iOS
# simulator talking to each other, with bot peers filling out the group.
# Step flows from e2e/maestro/group/ run on one device at a time.
#
#   e2e/scripts/run-cross-app.sh      # normally run by run-emu-suite.sh after the per-platform suites
#
# Expects both devices already signed in (run-platform.sh's B01 does that) and
# each other in their phonebooks (run-platform.sh seeds the other device too).
set -euo pipefail
cd "$(dirname "$0")/../.."
OUT="${E2E_OUT:-e2e/.out}/cross"; mkdir -p "$OUT"
REPORT_PLATFORM=cross
source e2e/scripts/lib-multi.sh
[[ -n "${E2E_RUN_ID:-}" ]] || export E2E_RUN_ID="$(node e2e/report/report.mjs start --title 'cross-app only' --suites cross-app)"

require_devices emu ios
plan_cases X01 X02 X03 X04 X05 X06 X07

# Bots: two of the emulator's (in the emulator's phonebook only) and one of the
# simulator's (in the simulator's phonebook only), so each app sees one
# member by name and the other by number.
pair_at() { IFS=',' read -ra _P <<< "$1"; echo "${_P[$2]}"; }
B1=$(pair_at "$E2E_EMU_BOTS" 0); B2=$(pair_at "$E2E_EMU_BOTS" 1); B3=$(pair_at "$E2E_IOS_BOTS" 0)
PORT="${E2E_CROSS_BOT_PORT:-7779}"
E2E_DEVICE_PHONE="$PHONE_EMU" E2E_BOT_PORT="$PORT" E2E_BOT_PHONES="$B1,$B2,$B3" \
  node e2e/bot/server.mjs >"$OUT/bot.log" 2>&1 &
BOT_PID=$!
trap 'kill $BOT_PID 2>/dev/null || true; airplane emu disable 2>/dev/null || true' EXIT
for _ in $(seq 1 90); do curl -sf "http://127.0.0.1:$PORT/health" >/dev/null && break; sleep 1; done
curl -sf "http://127.0.0.1:$PORT/health" >/dev/null || { echo "bot server not healthy"; tail -20 "$OUT/bot.log"; exit 1; }
bot() { # bot <route> <json> -> prints response; fails the current case on error
  local res; res=$(curl -sf -X POST "http://127.0.0.1:$PORT/$1" -H 'content-type: application/json' -d "$2") \
    || { echo "✗ bot $1 failed"; case_fail "bot-$1" "$OUT/bot.log" ""; exit 1; }
  echo "$res"
}
json() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s)[process.argv[1]]))' "$1"; }

N1=${B1%%:*}; N2=${B2%%:*}; N3=${B3%%:*}
IOS_JID=$(bot lookup "{\"phone\":\"$PHONE_IOS\"}" | json jid)
EMU_JID=$(bot lookup "{\"phone\":\"$PHONE_EMU\"}" | json jid)
RUN="$(date +%H%M%S)"
GROUP="X-$RUN"

case_begin X01
step emu resolve-contact PHONE="$CC$PHONE_IOS"
step emu open-contact-chat PHONE="$CC$PHONE_IOS"
step emu send TEXT="$RUN hi ios"
step ios open-group GROUP="E2E Emu"
step ios expect-text TEXT="$RUN hi ios"
step ios expect-online
case_end

case_begin X02
step ios send TEXT="$RUN hi emu"
step emu expect-text TEXT="$RUN hi emu"
case_end

case_begin X03
step emu reply QUOTE="$RUN hi emu" TEXT="$RUN emu reply"
step ios expect-reply TEXT="$RUN emu reply" QUOTE="$RUN hi emu"
case_end

case_begin X04
ROOM=$(bot group-create "{\"bot\":\"$N1\",\"name\":\"$GROUP\",\"members\":\"device,$IOS_JID,$N2,$N3\"}" | json room)
bot group-send "{\"bot\":\"$N1\",\"room\":\"$ROOM\",\"text\":\"$RUN group hello\"}" >/dev/null
step emu open-group GROUP="$GROUP"
step emu expect-message TEXT="$RUN group hello" SENDER="E2E $(tr '[:lower:]' '[:upper:]' <<< "${N1:0:1}")${N1:1}"
step ios open-group GROUP="$GROUP"
step ios expect-message TEXT="$RUN group hello" SENDER="${B1##*:}"
step emu send TEXT="$RUN from emu"
step ios expect-message TEXT="$RUN from emu" SENDER="E2E Emu"
step ios send TEXT="$RUN from ios"
step emu expect-message TEXT="$RUN from ios" SENDER="E2E Ios"
bot wait-group-message "{\"bot\":\"$N2\",\"room\":\"$ROOM\",\"sender\":\"$IOS_JID\",\"contains\":\"$RUN from ios\",\"timeoutMs\":30000}" >/dev/null
bot group-send "{\"bot\":\"$N3\",\"room\":\"$ROOM\",\"text\":\"$RUN from bot three\"}" >/dev/null
step ios expect-message TEXT="$RUN from bot three" SENDER="E2E $(tr '[:lower:]' '[:upper:]' <<< "${N3:0:1}")${N3:1}"
step emu expect-message TEXT="$RUN from bot three" SENDER="${B3##*:}"
case_end

case_begin X05
airplane emu enable
sleep 3
step ios send TEXT="$RUN while emu offline"
airplane emu disable
step emu expect-text TEXT="$RUN while emu offline"
case_end

case_begin X06
step ios background
sleep 2
step emu send TEXT="$RUN while ios away"
step ios expect-text TEXT="$RUN while ios away"
case_end

case_begin X07
step ios forward TEXT="$RUN group hello" TARGET="E2E Emu"
step emu open-group GROUP="E2E Ios"
step emu expect-forwarded TEXT="$RUN group hello"
step ios open-group GROUP="$GROUP"
step ios forward TEXT="$RUN group hello" TARGET="E2E $(tr '[:lower:]' '[:upper:]' <<< "${N3:0:1}")${N3:1}"
bot wait-message "{\"bot\":\"$N3\",\"sender\":\"$IOS_JID\",\"contains\":\"$RUN group hello\",\"timeoutMs\":30000}" | grep -q '"forwarded":true' \
  || { echo "✗ bot $N3 didn't get a forwarded copy"; case_fail X07-bot "$OUT/bot.log" ""; exit 1; }
case_end
echo "✓ cross-app cases passed ($STEP steps)"
