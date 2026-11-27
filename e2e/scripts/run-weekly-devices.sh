#!/usr/bin/env bash
# Weekly tier (or less often): what only real phones can show. Uses the Pixel
# and the Samsung plus the emulator and the simulator as their peers. Cases
# P01–P05 in e2e/report/catalog.json; everything else runs on the emulator
# tier (`npm run e2e:emu`).
#
#   npm run e2e:weekly
#   SKIP_LOGIN=1 npm run e2e:weekly     # devices already signed in, contacts resolved
#
# The physical phones never get test contacts (their default contacts account
# is the owner's own), so they only ever answer chats the others start.
set -euo pipefail
cd "$(dirname "$0")/../.."
OUT="${E2E_OUT:-e2e/.out}/weekly"; mkdir -p "$OUT"
REPORT_PLATFORM=devices
source e2e/scripts/lib-multi.sh

require_devices emu ios pixel samsung
trap 'airplane pixel disable 2>/dev/null || true; airplane samsung disable 2>/dev/null || true; stop_keep_awake' EXIT
start_keep_awake pixel samsung

if [[ -z "${E2E_NO_RESET:-}" ]]; then
  echo "▸ resetting test accounts (JewelChat admin)"
  node e2e/scripts/reset-accounts.mjs "$PHONE_EMU" "$PHONE_IOS" "$PHONE_PIXEL" "$PHONE_SAMSUNG"
fi
export E2E_RUN_ID
E2E_RUN_ID="$(node e2e/report/report.mjs start --title 'Weekly physical devices' --suites weekly)"
echo "▸ live report: file://$PWD/e2e/.out/report/index.html"
plan_cases P01 P02 P03 P04 P05

if [[ -z "${SKIP_LOGIN:-}" ]]; then
  echo "▸ seeding phonebooks (emulator + simulator only) and signing in"
  seed_phonebooks
  for who in emu ios pixel samsung; do step "$who" login DEVICE_PHONE="$(phone_of "$who")"; done
  for who in ios pixel samsung; do step emu resolve-contact PHONE="$CC$(phone_of "$who")"; done
fi
RUN="$(date +%H%M%S)"
# How a phone's chat list shows a peer that isn't in its phonebook: "+91 90000 00001".
spaced() { echo "${1:0:5} ${1:5}"; }

case_begin P01
step pixel background
step emu open-contact-chat PHONE="$CC$PHONE_PIXEL"
step emu send TEXT="$RUN push to pixel"
step pixel open-notification TEXT="$RUN push to pixel"
step pixel accept-if-unknown
case_end

case_begin P02
step emu open-contact-chat PHONE="$CC$PHONE_SAMSUNG"
step emu send TEXT="$RUN hello samsung"
step samsung open-group GROUP="$(spaced "$PHONE_EMU")"
step samsung accept-if-unknown
step samsung expect-text TEXT="$RUN hello samsung"
airplane samsung enable
sleep 3
step emu send TEXT="$RUN while samsung offline"
step samsung send TEXT="$RUN queued on samsung"
airplane samsung disable
step samsung expect-text TEXT="$RUN while samsung offline"
step emu expect-text TEXT="$RUN queued on samsung"
case_end

case_begin P03
step samsung keyboard-visible
case_end

case_begin P04
GROUP="W-$RUN"
step emu create-group GROUP="$GROUP" M1="$CC$PHONE_IOS" M2="$CC$PHONE_PIXEL"
step emu add-member PHONE="$CC$PHONE_SAMSUNG"
step emu send TEXT="$RUN group hello"
for who in ios pixel samsung; do
  step "$who" open-group GROUP="$GROUP"
  step "$who" expect-message TEXT="$RUN group hello" SENDER="$PHONE_EMU"
done
step pixel send TEXT="$RUN pixel hello"
step samsung reply QUOTE="$RUN pixel hello" TEXT="$RUN samsung reply"
step emu expect-reply TEXT="$RUN samsung reply" QUOTE="$RUN pixel hello"
step ios expect-reply TEXT="$RUN samsung reply" QUOTE="$RUN pixel hello"
airplane pixel enable
sleep 3
step ios send TEXT="$RUN while pixel offline"
airplane pixel disable
step pixel expect-message TEXT="$RUN while pixel offline" SENDER="$PHONE_IOS"
case_end

case_begin P05
step ios open-contact-chat PHONE="$CC$PHONE_PIXEL"
step ios send TEXT="$RUN ios to pixel"
step pixel open-group GROUP="$(spaced "$PHONE_IOS")"
step pixel accept-if-unknown
step pixel expect-text TEXT="$RUN ios to pixel"
step pixel send TEXT="$RUN pixel to ios"
step ios expect-text TEXT="$RUN pixel to ios"
airplane pixel enable
sleep 3
step ios send TEXT="$RUN while pixel away"
airplane pixel disable
step pixel expect-text TEXT="$RUN while pixel away"
case_end

node e2e/report/report.mjs end >/dev/null
echo "✓ weekly device cases passed ($STEP steps) — report: file://$PWD/e2e/.out/report/index.html"
