#!/usr/bin/env bash
# Layer-1 E2E run: one Android emulator under Maestro + bot peers over XMPP.
#
#   e2e/scripts/run-e2e.sh                 # all flows
#   e2e/scripts/run-e2e.sh 03-send-message # one flow (by file name)
#
# Prereqs (see e2e/README.md): Maestro installed, one emulator booted with a
# dev build of the app installed and Metro running (`npm run android`), and
# e2e/.env.local filled in.
set -euo pipefail
cd "$(dirname "$0")/../.."

if [[ -f e2e/.env.local ]]; then set -a; source e2e/.env.local; set +a; fi
: "${E2E_DEVICE_PHONE:?set E2E_DEVICE_PHONE in e2e/.env.local}"
: "${E2E_BOT_PHONES:?set E2E_BOT_PHONES in e2e/.env.local}"
PORT="${E2E_BOT_PORT:-7777}"
# Maestro sends anonymous usage analytics and prints an AI-feature banner by default.
export MAESTRO_CLI_NO_ANALYTICS=1 MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED=true
LOG_DIR="e2e/.out"; mkdir -p "$LOG_DIR"

command -v maestro >/dev/null || { echo "maestro not found — see e2e/README.md"; exit 1; }
adb get-state >/dev/null 2>&1 || { echo "no Android device/emulator connected"; exit 1; }

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

echo "▸ seeding device contacts"
e2e/scripts/seed-contacts.sh

TARGET="e2e/maestro"
[[ $# -gt 0 ]] && TARGET="e2e/maestro/flows/$1.yaml"
# A single flow still needs to be logged in: run login first unless it IS login.
if [[ $# -gt 0 && "$1" != "01-login" ]]; then
  maestro test -e DEVICE_PHONE="$E2E_DEVICE_PHONE" -e BOT_URL="http://127.0.0.1:${PORT}" \
    e2e/maestro/flows/01-login.yaml
fi

echo "▸ running maestro on $TARGET"
maestro test \
  -e DEVICE_PHONE="$E2E_DEVICE_PHONE" \
  -e BOT_URL="http://127.0.0.1:${PORT}" \
  --test-output-dir "$LOG_DIR/maestro" \
  "$TARGET"
