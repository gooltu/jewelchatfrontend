#!/usr/bin/env bash
# Runs the bot-driven suites on ONE virtual device: the Android emulator (emu)
# or the iOS simulator (ios). Cases come from e2e/report/catalog.json, in
# order, filtered to this platform; each one is a single Maestro flow and is
# reported to the live HTML report as it runs.
#
#   e2e/scripts/run-platform.sh emu                        # auth,direct,unknown,group
#   E2E_SUITES=group e2e/scripts/run-platform.sh ios
#   E2E_ONLY=D10,G01 e2e/scripts/run-platform.sh emu       # just these (+ B01 login)
#
# Normally started by run-emu-suite.sh (which resets the test accounts and
# opens the report first). Standalone it reports into the current report run,
# or starts one.
set -uo pipefail
cd "$(dirname "$0")/../.."
source e2e/scripts/lib-multi.sh

PLATFORM="${1:?usage: run-platform.sh emu|ios}"
[[ "$PLATFORM" == emu || "$PLATFORM" == ios ]] || { echo "platform must be emu or ios"; exit 2; }
SUITES="${E2E_SUITES:-auth,direct,unknown,group}"
OUT="${E2E_OUT:-e2e/.out}/$PLATFORM"; mkdir -p "$OUT"
DEV=$(dev_of "$PLATFORM"); PHONE=$(phone_of "$PLATFORM")
[[ -n "$DEV" ]] || { echo "no $PLATFORM device found (boot it, or set E2E_GROUP_DEVICES)"; exit 1; }

upper() { printf '%s' "$1" | tr '[:lower:]' '[:upper:]'; }
P=$(upper "$PLATFORM")
BOTS_VAR="E2E_${P}_BOTS"; STRANGERS_VAR="E2E_${P}_STRANGERS"
BOTS="${!BOTS_VAR:?set $BOTS_VAR in e2e/.env.local}"
STRANGERS="${!STRANGERS_VAR:?set $STRANGERS_VAR in e2e/.env.local}"
SIGNUP=$(lookup "$PLATFORM" "${E2E_SIGNUP_PHONES:-}"); SIGNUP2=$(lookup "$PLATFORM" "${E2E_SIGNUP2_PHONES:-}")
PORT=$([[ "$PLATFORM" == emu ]] && echo "${E2E_EMU_BOT_PORT:-7777}" || echo "${E2E_IOS_BOT_PORT:-7778}")
OTHER=$([[ "$PLATFORM" == emu ]] && echo ios || echo emu)

IFS=',' read -ra BOT_PAIRS <<< "$BOTS"
IFS=',' read -ra STRANGER_NUMS <<< "$STRANGERS"
[[ ${#BOT_PAIRS[@]} -ge 3 && ${#STRANGER_NUMS[@]} -ge 3 ]] || { echo "$BOTS_VAR needs 3 bots and $STRANGERS_VAR 3 numbers"; exit 1; }
name_of() { printf '%s' "${1%%:*}"; }
display_of() { local n; n=$(name_of "$1"); printf 'E2E %s%s' "$(upper "${n:0:1}")" "${n:1}"; }

REPORT=(node e2e/report/report.mjs)
[[ -n "${E2E_RUN_ID:-}" ]] || export E2E_RUN_ID="$("${REPORT[@]}" start --title "$PLATFORM only" --suites "$SUITES")"
record() { "${REPORT[@]}" case "$@" --platform "$PLATFORM" >/dev/null 2>&1 || true; }

# ---- bot server: three phonebook bots + three strangers ---------------------
STRANGER_SPEC="s1:${STRANGER_NUMS[0]},s2:${STRANGER_NUMS[1]},s3:${STRANGER_NUMS[2]}"
echo "▸ [$PLATFORM] bot server on :$PORT ($BOTS + strangers)"
E2E_DEVICE_PHONE="$PHONE" E2E_BOT_PORT="$PORT" E2E_BOT_PHONES="$BOTS,$STRANGER_SPEC" \
  node e2e/bot/server.mjs >"$OUT/bot.log" 2>&1 &
BOT_PID=$!
trap 'kill $BOT_PID 2>/dev/null || true; [[ "$PLATFORM" == emu ]] && adb -s "$DEV" shell cmd connectivity airplane-mode disable >/dev/null 2>&1 || true' EXIT
for _ in $(seq 1 90); do
  curl -sf "http://127.0.0.1:$PORT/health" >/dev/null && break
  kill -0 $BOT_PID 2>/dev/null || { echo "bot server died:"; tail -20 "$OUT/bot.log"; exit 1; }
  sleep 1
done
curl -sf "http://127.0.0.1:$PORT/health" >/dev/null || { echo "bot server not healthy"; tail -20 "$OUT/bot.log"; exit 1; }

# ---- phonebook: the three bots + the other virtual device (never strangers) --
echo "▸ [$PLATFORM] seeding phonebook"
SEED="$BOTS,$OTHER:$(phone_of "$OTHER")"
if [[ "$PLATFORM" == emu ]]; then
  adb -s "$DEV" reverse tcp:8081 tcp:8081 >/dev/null
  ANDROID_SERIAL="$DEV" E2E_BOT_PHONES="$SEED" e2e/scripts/seed-contacts.sh >"$OUT/seed.log" 2>&1 || { cat "$OUT/seed.log"; exit 1; }
else
  VCF="$OUT/contacts.vcf"; : >"$VCF"
  IFS=',' read -ra SEED_PAIRS <<< "$SEED"
  for pair in "${SEED_PAIRS[@]}"; do
    printf 'BEGIN:VCARD\nVERSION:3.0\nFN:%s\nTEL;TYPE=CELL:+%s%s\nEND:VCARD\n' "$(display_of "$pair")" "$CC" "${pair##*:}" >>"$VCF"
  done
  xcrun simctl addmedia "$DEV" "$VCF"
fi

ENVS=(
  -e DEVICE_PHONE="$PHONE" -e BOT_URL="http://127.0.0.1:$PORT" -e CC="$CC" -e PLATFORM="$PLATFORM"
  -e SIGNUP_PHONE="$SIGNUP" -e SIGNUP2_PHONE="$SIGNUP2" -e UNKNOWN_REF="${E2E_UNKNOWN_REFERRER:-9000000089}"
  -e S1=s1 -e S2=s2 -e S3=s3
)
for i in 0 1 2; do
  n=$((i + 1)); pair="${BOT_PAIRS[$i]}"
  ENVS+=(-e "BOT$n=$(name_of "$pair")" -e "BOT${n}_NAME=$(display_of "$pair")" -e "BOT${n}_PHONE=${pair##*:}")
done

# iOS keeps the Keychain across clearState, so a previous account would be
# restored on launch. Reset it before the flows that must start signed out.
wipe_session() { [[ "$PLATFORM" == ios ]] && xcrun simctl keychain "$DEV" reset >/dev/null 2>&1 || true; }

# ---- cases ---------------------------------------------------------------
# id \t flow \t needs \t knownIssue(0/1) \t tags
CASES=$(node -e '
  const [plat, suites, only] = process.argv.slice(1);
  const want = new Set(suites.split(","));
  const pick = only ? new Set(only.split(",").concat("B01")) : null;
  for (const c of require("./e2e/report/catalog.json").cases) {
    if (!c.flow || !want.has(c.suite) || !c.platforms.includes(plat)) continue;
    if (pick && !pick.has(c.id)) continue;
    console.log([c.id, c.flow, c.needs || "", c.knownIssue ? 1 : 0].join("\t"));
  }' "$PLATFORM" "$SUITES" "${E2E_ONLY:-}")

# bash 3.2 (macOS) has no associative arrays: results live in a small file.
RESULTS="$OUT/.results"; : >"$RESULTS"
result_of() { awk -v id="$1" '$1==id {s=$2} END {print s}' "$RESULTS"; }
PASS=0; FAIL=0; XFAIL=0; SKIP=0
while IFS=$'\t' read -r ID FLOW NEEDS KNOWN; do
  [[ -n "$ID" ]] || continue
  NEED_STATUS=$([[ -n "$NEEDS" ]] && result_of "$NEEDS")
  if [[ -n "$NEED_STATUS" && "$NEED_STATUS" != passed ]]; then
    echo "$ID skipped" >>"$RESULTS"; SKIP=$((SKIP + 1))
    record "$ID" --status skipped --note "needs $NEEDS, which didn't pass"
    echo "  - [$PLATFORM] $ID skipped (needs $NEEDS)"; continue
  fi
  # Anything after login needs B01's session; the sign-up cases need a signed-out start.
  [[ "$ID" == A10 || "$ID" == B01 ]] && wipe_session
  LOG="$OUT/$ID.log"; DIR="$OUT/$ID"
  rm -rf "$DIR"; record "$ID" --status running
  START=$(date +%s)
  [[ "$PLATFORM" == emu ]] && adb -s "$DEV" shell input keyevent KEYCODE_WAKEUP >/dev/null 2>&1
  if maestro --device "$DEV" test "${ENVS[@]}" --test-output-dir "$DIR" "$FLOW" >"$LOG" 2>&1 </dev/null; then
    STATUS=passed; NOTE=""
    [[ "$KNOWN" == 1 ]] && NOTE="known issue looks fixed — update the catalog"
  else
    if [[ "$KNOWN" == 1 ]]; then STATUS=xfail; NOTE="known issue"; else STATUS=failed; NOTE=$(grep -m1 -E "FAILED|Assertion|Error" "$LOG" | cut -c1-160); fi
  fi
  DUR=$(( ($(date +%s) - START) * 1000 ))
  SHOT=$(find "$DIR" -name '*.png' 2>/dev/null | sort | tail -1)
  record "$ID" --status "$STATUS" --duration "$DUR" --log "$LOG" ${SHOT:+--shot "$SHOT"} ${NOTE:+--note "$NOTE"}
  echo "$ID $STATUS" >>"$RESULTS"
  case $STATUS in passed) PASS=$((PASS + 1)); m="✓";; xfail) XFAIL=$((XFAIL + 1)); m="~";; *) FAIL=$((FAIL + 1)); m="✗";; esac
  echo "  $m [$PLATFORM] $ID $STATUS ($((DUR / 1000))s)"
  # Leave the network on whatever happened inside the flow.
  [[ "$PLATFORM" == emu ]] && adb -s "$DEV" shell cmd connectivity airplane-mode disable >/dev/null 2>&1
done <<< "$CASES"

echo "▸ [$PLATFORM] $PASS passed, $FAIL failed, $XFAIL expected fail, $SKIP skipped"
[[ $FAIL -eq 0 ]]
