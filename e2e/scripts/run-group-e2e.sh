#!/usr/bin/env bash
# Group-chat E2E across three real app instances (no bots): an Android
# emulator, an iOS simulator and a physical Android phone, all logged in as
# test numbers. One orchestrator runs small Maestro step flows
# (e2e/maestro/group/) on each device in turn, so cross-device order is
# explicit. See e2e/README.md "Group suite".
#
#   e2e/scripts/run-group-e2e.sh            # all scenarios
#   SKIP_LOGIN=1 e2e/scripts/run-group-e2e.sh   # devices already logged in + contacts resolved
#
# Env (e2e/.env.local):
#   E2E_GROUP_PHONES=emu:<phone>,ios:<phone>,pixel:<phone>   (10 digits, no country code)
#   E2E_GROUP_DEVICES=emu:<adb serial>,ios:<sim udid>,pixel:<adb serial>
#     (defaults: the one emulator-* serial, the booted simulator, the one non-emulator serial)
set -euo pipefail
cd "$(dirname "$0")/../.."

if [[ -f e2e/.env.local ]]; then set -a; source e2e/.env.local; set +a; fi
: "${E2E_GROUP_PHONES:?set E2E_GROUP_PHONES in e2e/.env.local}"
CC="${E2E_COUNTRY_CODE:-91}"
export MAESTRO_CLI_NO_ANALYTICS=1 MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED=true
OUT="e2e/.out/group"; mkdir -p "$OUT"
FLOWS="e2e/maestro/group"

command -v maestro >/dev/null || { echo "maestro not found — see e2e/README.md"; exit 1; }

lookup() { # lookup <name> <name:value,...>
  [[ -n "$2" ]] || return 0
  local pair; IFS=',' read -ra PAIRS <<< "$2"
  for pair in "${PAIRS[@]}"; do [[ "${pair%%:*}" == "$1" ]] && { echo "${pair#*:}"; return; }; done
}

PHONE_EMU=$(lookup emu "$E2E_GROUP_PHONES"); PHONE_IOS=$(lookup ios "$E2E_GROUP_PHONES"); PHONE_PIXEL=$(lookup pixel "$E2E_GROUP_PHONES")
[[ -n "$PHONE_EMU" && -n "$PHONE_IOS" && -n "$PHONE_PIXEL" ]] || { echo "E2E_GROUP_PHONES needs emu, ios and pixel"; exit 1; }

DEV_EMU=$(lookup emu "${E2E_GROUP_DEVICES:-}"); DEV_IOS=$(lookup ios "${E2E_GROUP_DEVICES:-}"); DEV_PIXEL=$(lookup pixel "${E2E_GROUP_DEVICES:-}")
: "${DEV_EMU:=$(adb devices | awk '/^emulator-[0-9]+\tdevice/{print $1; exit}')}"
: "${DEV_PIXEL:=$(adb devices | awk 'NR>1 && $2=="device" && $1 !~ /^emulator-/{print $1; exit}')}"
: "${DEV_IOS:=$(xcrun simctl list devices booted | sed -nE 's/.*\(([0-9A-F-]{36})\) \(Booted\).*/\1/p' | head -1)}"
for v in DEV_EMU DEV_IOS DEV_PIXEL; do [[ -n "${!v}" ]] || { echo "no device for $v (boot it / plug it in, or set E2E_GROUP_DEVICES)"; exit 1; }; done
echo "▸ devices: emu=$DEV_EMU ios=$DEV_IOS pixel=$DEV_PIXEL"

# Metro must be reachable from both Android devices (the simulator uses localhost).
curl -sf http://127.0.0.1:8081/status >/dev/null || { echo "Metro isn't running on :8081 (npx expo start)"; exit 1; }
for s in "$DEV_EMU" "$DEV_PIXEL"; do adb -s "$s" reverse tcp:8081 tcp:8081 >/dev/null; done


RUN_ID="$(date +%H%M%S)"
GROUP="G-$RUN_ID"
STEP=0
step() { # step <emu|ios|pixel> <flow> [KEY=VALUE ...]
  local who="$1" flow="$2"; shift 2
  local dev; case "$who" in emu) dev=$DEV_EMU;; ios) dev=$DEV_IOS;; pixel) dev=$DEV_PIXEL;; esac
  local args=(); for kv in "$@"; do args+=(-e "$kv"); done
  STEP=$((STEP + 1))
  local label; label=$(printf '%02d-%s-%s' "$STEP" "$who" "$flow")
  echo "▸ [$who] $flow $*"
  if ! maestro --device "$dev" test ${args[@]+"${args[@]}"} --test-output-dir "$OUT/$label" "$FLOWS/$flow.yaml" >"$OUT/$label.log" 2>&1; then
    echo "✗ step $label failed — see $OUT/$label.log and $OUT/$label/"; tail -20 "$OUT/$label.log"; exit 1
  fi
}

airplane() { # airplane <adb serial> enable|disable
  adb -s "$1" shell cmd connectivity airplane-mode "$2"
}
trap 'airplane "$DEV_PIXEL" disable 2>/dev/null || true' EXIT

seed_ios_contacts() { # vCards for the two Android accounts
  local vcf="$OUT/ios-contacts.vcf"
  {
    printf 'BEGIN:VCARD\nVERSION:3.0\nFN:E2E Emu\nN:Emu;E2E;;;\nTEL;TYPE=CELL:+%s%s\nEND:VCARD\n' "$CC" "$PHONE_EMU"
    printf 'BEGIN:VCARD\nVERSION:3.0\nFN:E2E Pixel\nN:Pixel;E2E;;;\nTEL;TYPE=CELL:+%s%s\nEND:VCARD\n' "$CC" "$PHONE_PIXEL"
  } >"$vcf"
  xcrun simctl addmedia "$DEV_IOS" "$vcf"
}

if [[ -z "${SKIP_LOGIN:-}" ]]; then
  echo "▸ seeding phonebooks (each device gets the other two)"
  ANDROID_SERIAL="$DEV_EMU" E2E_BOT_PHONES="ios:$PHONE_IOS,pixel:$PHONE_PIXEL" e2e/scripts/seed-contacts.sh
  # Not the physical phone: its default contacts account is the owner's Google
  # account, so seeding would sync test contacts into their real address book
  # (and `content insert` into a local account is refused). The phone only
  # joins groups, so it doesn't need them; its sender labels then come from the
  # game server (identityService), and the checks below only need the number.
  seed_ios_contacts

  echo "▸ 1. login"
  step emu login DEVICE_PHONE="$PHONE_EMU"
  step ios login DEVICE_PHONE="$PHONE_IOS"
  step pixel login DEVICE_PHONE="$PHONE_PIXEL"

  # The creator's member picker lists only contacts it has resolved (tapped).
  step emu resolve-contact PHONE="$CC$PHONE_IOS"
  step emu resolve-contact PHONE="$CC$PHONE_PIXEL"
fi

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

echo "▸ 3. reply"
step ios reply QUOTE="$RUN_ID pixel hello" TEXT="$RUN_ID ios reply"
step emu expect-reply TEXT="$RUN_ID ios reply" QUOTE="$RUN_ID pixel hello"
step pixel expect-reply TEXT="$RUN_ID ios reply" QUOTE="$RUN_ID pixel hello"

echo "▸ 4. offline catch-up (pixel in airplane mode)"
airplane "$DEV_PIXEL" enable
sleep 3
step emu send TEXT="$RUN_ID while away 1"
step ios send TEXT="$RUN_ID while away 2"
airplane "$DEV_PIXEL" disable
step pixel expect-message TEXT="$RUN_ID while away 1" SENDER="$PHONE_EMU"
step pixel expect-message TEXT="$RUN_ID while away 2" SENDER="$PHONE_IOS"

echo "▸ 5. rename + leave"
step emu rename NAME="$GROUP-renamed"
step ios expect-group GROUP="$GROUP-renamed"
step pixel expect-group GROUP="$GROUP-renamed"
step pixel open-group GROUP="$GROUP-renamed"
step pixel leave GROUP="$GROUP-renamed"
step emu open-group GROUP="$GROUP-renamed"
step emu expect-members COUNT=2
echo "✓ group suite passed ($GROUP, $STEP steps)"
