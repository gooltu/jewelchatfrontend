#!/usr/bin/env bash
# Layer-1 E2E run: one Android emulator under Maestro + bot peers over XMPP.
#
#   e2e/scripts/run-e2e.sh                 # all flows
#   e2e/scripts/run-e2e.sh 03-send-message # one flow (by file name)
#
# With several devices attached, pick one with E2E_DEVICE (an adb serial or
# an iOS simulator UDID). On iOS, android-only flows are skipped and the bot
# numbers are added to the simulator's contacts with a vCard. Set
# E2E_SKIP_SEED=1 on a real phone, where seeding would write into the owner's
# own address book; needs-contacts flows are then skipped too.
#
# Prereqs (see e2e/README.md): Maestro installed, one emulator booted with a
# dev build of the app installed and Metro running (`npm run android`), and
# e2e/.env.local filled in.
set -euo pipefail
cd "$(dirname "$0")/../.."

# Values already in the environment win over e2e/.env.local, so one run can
# override e.g. E2E_DEVICE_PHONE without editing the file.
if [[ -f e2e/.env.local ]]; then
  _E2E_ENV_BEFORE="$(export -p)"
  set -a; source e2e/.env.local; set +a
  eval "$_E2E_ENV_BEFORE"
fi
: "${E2E_DEVICE_PHONE:?set E2E_DEVICE_PHONE in e2e/.env.local}"
: "${E2E_BOT_PHONES:?set E2E_BOT_PHONES in e2e/.env.local}"
PORT="${E2E_BOT_PORT:-7777}"
# Maestro sends anonymous usage analytics and prints an AI-feature banner by default.
export MAESTRO_CLI_NO_ANALYTICS=1 MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED=true
LOG_DIR="${E2E_OUT:-e2e/.out}"; mkdir -p "$LOG_DIR"

command -v maestro >/dev/null || { echo "maestro not found — see e2e/README.md"; exit 1; }
DEVICE="${E2E_DEVICE:-}"
IS_IOS=""
if [[ -n "$DEVICE" ]] && xcrun simctl list devices 2>/dev/null | grep -q "($DEVICE)"; then IS_IOS=1; fi
if [[ -z "$IS_IOS" ]]; then
  [[ -n "$DEVICE" ]] && export ANDROID_SERIAL="$DEVICE"
  adb get-state >/dev/null 2>&1 || { echo "no Android device/emulator connected (or several: set E2E_DEVICE)"; exit 1; }
fi
# A physical phone whose screen timed out can't be driven: wake it first.
[[ -z "$IS_IOS" ]] && adb shell input keyevent KEYCODE_WAKEUP >/dev/null 2>&1 || true
MAESTRO=(maestro); [[ -n "$DEVICE" ]] && MAESTRO+=(--device "$DEVICE")
EXCLUDE=()
[[ -n "$IS_IOS" ]] && EXCLUDE+=(android-only)
[[ -n "${E2E_SKIP_SEED:-}" ]] && EXCLUDE+=(needs-contacts)
EXCLUDE_ARGS=(); [[ ${#EXCLUDE[@]} -gt 0 ]] && EXCLUDE_ARGS=(--exclude-tags "$(IFS=,; echo "${EXCLUDE[*]}")")

echo "▸ starting bot server (log: $LOG_DIR/bot.log)"
node e2e/bot/server.mjs >"$LOG_DIR/bot.log" 2>&1 &
BOT_PID=$!
trap 'kill $BOT_PID 2>/dev/null || true' EXIT

for _ in $(seq 1 60); do
  curl -sf "http://127.0.0.1:${PORT}/health" >/dev/null && break
  kill -0 $BOT_PID 2>/dev/null || { echo "bot server died:"; cat "$LOG_DIR/bot.log"; exit 1; }
  sleep 1
done
curl -sf "http://127.0.0.1:${PORT}/health" >/dev/null || { echo "bot server not healthy"; cat "$LOG_DIR/bot.log"; exit 1; }

if [[ -n "${E2E_SKIP_SEED:-}" ]]; then
  echo "▸ not seeding contacts (E2E_SKIP_SEED)"
elif [[ -n "$IS_IOS" ]]; then
  echo "▸ seeding simulator contacts"
  VCF="$LOG_DIR/bot-contacts.vcf"; : >"$VCF"
  IFS=',' read -ra PAIRS <<< "$E2E_BOT_PHONES"
  for pair in "${PAIRS[@]}"; do
    name="${pair%%:*}"; display="E2E $(printf '%s' "${name:0:1}" | tr '[:lower:]' '[:upper:]')${name:1}"
    printf 'BEGIN:VCARD\nVERSION:3.0\nFN:%s\nTEL;TYPE=CELL:+%s%s\nEND:VCARD\n' "$display" "${E2E_COUNTRY_CODE:-91}" "${pair##*:}" >>"$VCF"
  done
  xcrun simctl addmedia "$DEVICE" "$VCF"
else
  echo "▸ seeding device contacts"
  e2e/scripts/seed-contacts.sh
fi

TARGET="e2e/maestro"
[[ $# -gt 0 ]] && TARGET="e2e/maestro/flows/$1.yaml"
# A single flow still needs to be logged in: run login first unless it IS login.
if [[ $# -gt 0 && "$1" != "01-login" ]]; then
  "${MAESTRO[@]}" test -e DEVICE_PHONE="$E2E_DEVICE_PHONE" -e BOT_URL="http://127.0.0.1:${PORT}" \
    e2e/maestro/flows/01-login.yaml
fi

echo "▸ running maestro on $TARGET"
"${MAESTRO[@]}" test ${EXCLUDE_ARGS[@]+"${EXCLUDE_ARGS[@]}"} \
  -e DEVICE_PHONE="$E2E_DEVICE_PHONE" \
  -e BOT_URL="http://127.0.0.1:${PORT}" \
  --test-output-dir "$LOG_DIR/maestro" \
  "$TARGET"
