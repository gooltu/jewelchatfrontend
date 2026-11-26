#!/usr/bin/env bash
# One-on-one chat between real app instances (no bots): Android emulator,
# iOS simulator, a Pixel and a Samsung. Step flows from e2e/maestro/group/
# run on one device at a time. See e2e/README.md "Direct suite".
#
#   e2e/scripts/run-direct-e2e.sh               # all scenarios
#   SKIP_LOGIN=1 e2e/scripts/run-direct-e2e.sh  # devices already logged in
set -euo pipefail
cd "$(dirname "$0")/../.."
OUT="e2e/.out/direct"; mkdir -p "$OUT"
source e2e/scripts/lib-multi.sh

require_devices emu ios pixel samsung
trap 'airplane samsung disable 2>/dev/null || true; airplane pixel disable 2>/dev/null || true; stop_keep_awake' EXIT
start_keep_awake pixel samsung

if [[ -z "${SKIP_LOGIN:-}" ]]; then
  echo "▸ seeding phonebooks"
  seed_phonebooks
  echo "▸ login"
  for who in emu ios pixel samsung; do step "$who" login DEVICE_PHONE="$(phone_of "$who")"; done
fi

# Texts start with the run id: Android's keyboard capitalises the first
# letter of what Maestro types. Receivers find a new chat by its last message
# (the chat-list row's accessibility text includes it), since the row's
# testID holds the sender's userId, which the test doesn't know.
R="$(date +%H%M%S)"

echo "▸ 1. emulator -> Samsung (first contact, reply with quote)"
step emu open-contact-chat PHONE="$CC$PHONE_SAMSUNG"
step emu send TEXT="$R emu to sam"
step samsung open-group GROUP="$R emu to sam"
step samsung expect-text TEXT="$R emu to sam"
step samsung reply QUOTE="$R emu to sam" TEXT="$R sam reply"
step emu expect-reply TEXT="$R sam reply" QUOTE="$R emu to sam"
step samsung send TEXT="$R sam plain"
step emu expect-text TEXT="$R sam plain"

echo "▸ 2. iOS -> Pixel"
step ios open-contact-chat PHONE="$CC$PHONE_PIXEL"
step ios send TEXT="$R ios to pixel"
step pixel open-group GROUP="$R ios to pixel"
step pixel expect-text TEXT="$R ios to pixel"
step pixel reply QUOTE="$R ios to pixel" TEXT="$R pixel reply"
step ios expect-reply TEXT="$R pixel reply" QUOTE="$R ios to pixel"

echo "▸ 3. offline both ways (Samsung in airplane mode)"
airplane samsung enable
sleep 3
step samsung send TEXT="$R sam queued"
step emu send TEXT="$R emu while sam away"
airplane samsung disable
step emu expect-text TEXT="$R sam queued"
step samsung expect-text TEXT="$R emu while sam away"

echo "▸ 4. background catch-up (Pixel sent to the home screen)"
background pixel
sleep 3
step ios send TEXT="$R bg one"
step ios send TEXT="$R bg two"
step pixel open-group GROUP="$R bg two"
step pixel expect-text TEXT="$R bg one"
step pixel expect-text TEXT="$R bg two"

echo "▸ 5. forward (emulator forwards Samsung's message to iOS)"
step emu open-contact-chat PHONE="$CC$PHONE_IOS"
step emu send TEXT="$R emu to ios"
step ios open-group GROUP="$R emu to ios"
step ios expect-text TEXT="$R emu to ios"
step emu open-contact-chat PHONE="$CC$PHONE_SAMSUNG"
IOS_NAME=$(emu_contact_name "$PHONE_IOS")
step emu forward TEXT="$R sam plain" TARGET="$IOS_NAME"
step ios open-group GROUP="$R sam plain"
step ios expect-forwarded TEXT="$R sam plain"

echo "▸ 5b. forward to several people at once (emulator -> iOS and Pixel)"
step emu open-contact-chat PHONE="$CC$PHONE_PIXEL"
step emu send TEXT="$R emu to pixel"
step pixel open-group GROUP="$R emu to pixel"
step pixel expect-text TEXT="$R emu to pixel"
PIXEL_NAME=$(emu_contact_name "$PHONE_PIXEL")
step emu open-contact-chat PHONE="$CC$PHONE_SAMSUNG"
step emu forward-multi TEXT="$R sam reply" TARGET1="$IOS_NAME" TARGET2="$PIXEL_NAME"
step ios open-group GROUP="$R sam reply"
step ios expect-forwarded TEXT="$R sam reply"
step pixel open-group GROUP="$R sam reply"
step pixel expect-forwarded TEXT="$R sam reply"

echo "▸ 6. local actions on the emulator (star, delete for me, pin, archive)"
step emu open-contact-chat PHONE="$CC$PHONE_SAMSUNG"
step emu star TEXT="$R sam reply"
step emu open-contact-chat PHONE="$CC$PHONE_SAMSUNG"
step emu delete-message TEXT="$R emu while sam away"
step emu pin-archive MATCH="$(emu_contact_name "$PHONE_SAMSUNG")"
# Delete-for-me is local: the Samsung still has the message.
step samsung expect-text TEXT="$R emu while sam away"

echo "✓ direct suite passed ($R, $STEP steps)"
