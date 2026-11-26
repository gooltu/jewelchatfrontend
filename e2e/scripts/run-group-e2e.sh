#!/usr/bin/env bash
# Group-chat E2E across four real app instances (no bots): an Android
# emulator (the owner), an iOS simulator, a Pixel and a Samsung, all logged in
# as test numbers. Step flows from e2e/maestro/group/ run on one device at a
# time, so cross-device order is explicit. See e2e/README.md "Group suite".
#
#   e2e/scripts/run-group-e2e.sh               # all scenarios
#   SKIP_LOGIN=1 e2e/scripts/run-group-e2e.sh  # devices already logged in + contacts resolved
set -euo pipefail
cd "$(dirname "$0")/../.."
OUT="e2e/.out/group"; mkdir -p "$OUT"
source e2e/scripts/lib-multi.sh

require_devices emu ios pixel samsung
trap 'airplane pixel disable 2>/dev/null || true; stop_keep_awake' EXIT
start_keep_awake pixel samsung

if [[ -z "${SKIP_LOGIN:-}" ]]; then
  echo "▸ seeding phonebooks"
  seed_phonebooks
  echo "▸ 1. login"
  for who in emu ios pixel samsung; do step "$who" login DEVICE_PHONE="$(phone_of "$who")"; done
  # The owner's member picker lists only contacts it has resolved (tapped).
  for who in ios pixel samsung; do step emu resolve-contact PHONE="$CC$(phone_of "$who")"; done
fi

RUN_ID="$(date +%H%M%S)"
GROUP="G-$RUN_ID"

# A group sender's label is `PhonebookName(phone)` or just the phone
# (identityService.resolveGroupMemberDisplayName), so the sender's number is
# what every device is checked for. Texts start with the run id: Android's
# keyboard capitalises the first letter of what Maestro types.
echo "▸ 2. create + everyone receives ($GROUP)"
step emu create-group GROUP="$GROUP" M1="$CC$PHONE_IOS" M2="$CC$PHONE_PIXEL"
# The owner posts first: the chat list hides conversations with no messages
# (contactRepository's LAST_MSG_CREATED_TIME IS NOT NULL), so an invited
# member's new, empty group doesn't show up until somebody writes in it.
step emu send TEXT="$RUN_ID emu hello"
step ios open-group GROUP="$GROUP"
step pixel open-group GROUP="$GROUP"
step ios expect-message TEXT="$RUN_ID emu hello" SENDER="$PHONE_EMU"
step pixel expect-message TEXT="$RUN_ID emu hello" SENDER="$PHONE_EMU"
step ios send TEXT="$RUN_ID ios hello"
step emu expect-message TEXT="$RUN_ID ios hello" SENDER="$PHONE_IOS"
step pixel expect-message TEXT="$RUN_ID ios hello" SENDER="$PHONE_IOS"
step pixel send TEXT="$RUN_ID pixel hello"
step emu expect-message TEXT="$RUN_ID pixel hello" SENDER="$PHONE_PIXEL"
step ios expect-message TEXT="$RUN_ID pixel hello" SENDER="$PHONE_PIXEL"

echo "▸ 3. add a member later (Samsung)"
step emu add-member PHONE="$CC$PHONE_SAMSUNG"
step emu expect-members COUNT=4
step emu send TEXT="$RUN_ID welcome sam"
step samsung open-group GROUP="$GROUP"
step samsung expect-message TEXT="$RUN_ID welcome sam" SENDER="$PHONE_EMU"
step samsung send TEXT="$RUN_ID sam hello"
step emu expect-message TEXT="$RUN_ID sam hello" SENDER="$PHONE_SAMSUNG"
step ios expect-message TEXT="$RUN_ID sam hello" SENDER="$PHONE_SAMSUNG"
step pixel expect-message TEXT="$RUN_ID sam hello" SENDER="$PHONE_SAMSUNG"

echo "▸ 4. reply"
step ios reply QUOTE="$RUN_ID pixel hello" TEXT="$RUN_ID ios reply"
step emu expect-reply TEXT="$RUN_ID ios reply" QUOTE="$RUN_ID pixel hello"
step pixel expect-reply TEXT="$RUN_ID ios reply" QUOTE="$RUN_ID pixel hello"
step samsung reply QUOTE="$RUN_ID sam hello" TEXT="$RUN_ID sam self reply"
step ios expect-reply TEXT="$RUN_ID sam self reply" QUOTE="$RUN_ID sam hello"

echo "▸ 5. offline + background catch-up (Pixel in airplane mode, Samsung backgrounded)"
airplane pixel enable
background samsung
sleep 3
step emu send TEXT="$RUN_ID while away 1"
step ios send TEXT="$RUN_ID while away 2"
airplane pixel disable
step pixel expect-message TEXT="$RUN_ID while away 1" SENDER="$PHONE_EMU"
step pixel expect-message TEXT="$RUN_ID while away 2" SENDER="$PHONE_IOS"
step samsung expect-message TEXT="$RUN_ID while away 1" SENDER="$PHONE_EMU"
step samsung expect-message TEXT="$RUN_ID while away 2" SENDER="$PHONE_IOS"

echo "▸ 6. rename + leave"
step emu rename NAME="$GROUP-renamed"
step ios expect-group GROUP="$GROUP-renamed"
step pixel expect-group GROUP="$GROUP-renamed"
step samsung expect-group GROUP="$GROUP-renamed"
step pixel open-group GROUP="$GROUP-renamed"
step pixel leave GROUP="$GROUP-renamed"
step emu open-group GROUP="$GROUP-renamed"
step emu expect-members COUNT=3
step emu send TEXT="$RUN_ID after leave"
step samsung open-group GROUP="$GROUP-renamed"
step samsung expect-message TEXT="$RUN_ID after leave" SENDER="$PHONE_EMU"
echo "✓ group suite passed ($GROUP, $STEP steps)"
