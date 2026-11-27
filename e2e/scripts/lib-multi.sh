# Shared by the multi-device suites (run-group-e2e.sh, run-direct-e2e.sh).
# Source it after `cd` to the repo root. Devices are named emu, ios, pixel
# and samsung; each has a test phone (E2E_GROUP_PHONES) and a device id
# (E2E_GROUP_DEVICES, or auto-detected).

# Values already in the environment win over e2e/.env.local, so one run can
# override e.g. E2E_DEVICE_PHONE without editing the file.
if [[ -f e2e/.env.local ]]; then
  _E2E_ENV_BEFORE="$(export -p)"
  set -a; source e2e/.env.local; set +a
  eval "$_E2E_ENV_BEFORE"
fi
: "${E2E_GROUP_PHONES:?set E2E_GROUP_PHONES in e2e/.env.local}"
CC="${E2E_COUNTRY_CODE:-91}"
export MAESTRO_CLI_NO_ANALYTICS=1 MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED=true
FLOWS="e2e/maestro/group"

command -v maestro >/dev/null || { echo "maestro not found — see e2e/README.md"; exit 1; }

lookup() { # lookup <name> <name:value,...>
  [[ -n "$2" ]] || return 0
  local pair; IFS=',' read -ra PAIRS <<< "$2"
  for pair in "${PAIRS[@]}"; do [[ "${pair%%:*}" == "$1" ]] && { echo "${pair#*:}"; return; }; done
}

# Physical Android phones, told apart by model (the rest of the adb list is
# emulators). Override with E2E_GROUP_DEVICES when the model names differ.
adb_serial_for_model() { # adb_serial_for_model <model regex>
  adb devices -l | awk -v re="$1" 'NR>1 && $2=="device" && $1 !~ /^emulator-/ && $0 ~ re {print $1; exit}'
}

PHONE_EMU=$(lookup emu "$E2E_GROUP_PHONES"); PHONE_IOS=$(lookup ios "$E2E_GROUP_PHONES")
PHONE_PIXEL=$(lookup pixel "$E2E_GROUP_PHONES"); PHONE_SAMSUNG=$(lookup samsung "$E2E_GROUP_PHONES")

DEV_EMU=$(lookup emu "${E2E_GROUP_DEVICES:-}"); DEV_IOS=$(lookup ios "${E2E_GROUP_DEVICES:-}")
DEV_PIXEL=$(lookup pixel "${E2E_GROUP_DEVICES:-}"); DEV_SAMSUNG=$(lookup samsung "${E2E_GROUP_DEVICES:-}")
: "${DEV_EMU:=$(adb devices | awk '/^emulator-[0-9]+\tdevice/{print $1; exit}')}"
: "${DEV_PIXEL:=$(adb_serial_for_model 'model:Pixel')}"
: "${DEV_SAMSUNG:=$(adb_serial_for_model 'model:SM_')}"
: "${DEV_IOS:=$(xcrun simctl list devices booted | sed -nE 's/.*\(([0-9A-F-]{36})\) \(Booted\).*/\1/p' | head -1)}"

require_devices() { # require_devices emu ios pixel samsung
  local who dev phone
  for who in "$@"; do
    dev=$(dev_of "$who"); phone=$(phone_of "$who")
    [[ -n "$dev" ]] || { echo "no device for $who (attach it, or set E2E_GROUP_DEVICES)"; exit 1; }
    [[ -n "$phone" ]] || { echo "E2E_GROUP_PHONES has no number for $who"; exit 1; }
    echo "▸ $who: $dev (+$CC$phone)"
  done
  # Metro must be reachable from the Android devices (the simulator uses localhost).
  curl -sf http://127.0.0.1:8081/status >/dev/null || { echo "Metro isn't running on :8081 (npx expo start)"; exit 1; }
  for who in "$@"; do
    [[ "$who" == ios ]] || adb -s "$(dev_of "$who")" reverse tcp:8081 tcp:8081 >/dev/null
  done
}

dev_of() { case "$1" in emu) echo "$DEV_EMU";; ios) echo "$DEV_IOS";; pixel) echo "$DEV_PIXEL";; samsung) echo "$DEV_SAMSUNG";; esac; }
phone_of() { case "$1" in emu) echo "$PHONE_EMU";; ios) echo "$PHONE_IOS";; pixel) echo "$PHONE_PIXEL";; samsung) echo "$PHONE_SAMSUNG";; esac; }

STEP=0
step() { # step <device> <flow> [KEY=VALUE ...]
  local who="$1" flow="$2"; shift 2
  local dev; dev=$(dev_of "$who")
  local args=(); for kv in "$@"; do args+=(-e "$kv"); done
  # A phone whose screen timed out between steps can't be driven: wake it.
  [[ "$who" == ios ]] || adb -s "$dev" shell input keyevent KEYCODE_WAKEUP >/dev/null 2>&1 || true
  STEP=$((STEP + 1))
  local label; label=$(printf '%02d-%s-%s' "$STEP" "$who" "$flow")
  echo "▸ [$who] $flow $*"
  if ! maestro --device "$dev" test ${args[@]+"${args[@]}"} --test-output-dir "$OUT/$label" "$FLOWS/$flow.yaml" >"$OUT/$label.log" 2>&1 </dev/null; then
    echo "✗ step $label failed — see $OUT/$label.log and $OUT/$label/"; tail -20 "$OUT/$label.log"
    case_fail "$label" "$OUT/$label.log" "$OUT/$label"
    exit 1
  fi
}

# ---- report cases (e2e/report/report.mjs) ---------------------------------
# A script lists its cases up front with plan_cases, wraps each scenario in
# case_begin/case_end, and a failing step marks the current case failed and
# every case not reached yet as skipped (later scenarios build on earlier ones).
REPORT_PLATFORM="${REPORT_PLATFORM:-cross}"
PLANNED=(); CASE_ID=""; CASE_START=0; DONE_CASES=" "
_record() { node e2e/report/report.mjs case "$@" --platform "$REPORT_PLATFORM" >/dev/null 2>&1 || true; }
plan_cases() { PLANNED=("$@"); }
case_begin() { CASE_ID="$1"; CASE_START=$(date +%s); echo "━━ $CASE_ID"; _record "$CASE_ID" --status running; }
case_end() {
  _record "$CASE_ID" --status passed --duration $(( ($(date +%s) - CASE_START) * 1000 ))
  DONE_CASES="$DONE_CASES$CASE_ID "; echo "  ✓ $CASE_ID"; CASE_ID=""
}
case_fail() { # case_fail <step label> <log> <maestro output dir>
  [[ -n "$CASE_ID" ]] || return 0
  local shot; shot=$(find "$3" -name '*.png' 2>/dev/null | sort | tail -1)
  _record "$CASE_ID" --status failed --duration $(( ($(date +%s) - CASE_START) * 1000 )) \
    --log "$2" ${shot:+--shot "$shot"} --note "step $1 failed"
  DONE_CASES="$DONE_CASES$CASE_ID "
  local id; for id in ${PLANNED[@]+"${PLANNED[@]}"}; do
    [[ "$DONE_CASES" == *" $id "* ]] || _record "$id" --status skipped --note "an earlier case ($CASE_ID) failed"
  done
}

airplane() { # airplane <device name> enable|disable  (Android only)
  adb -s "$(dev_of "$1")" shell cmd connectivity airplane-mode "$2"
}

background() { # background <device name>  (Android only): Home key, app goes to background
  adb -s "$(dev_of "$1")" shell input keyevent KEYCODE_HOME
}

# Display name the emulator's phonebook has for a number (seed-contacts.sh
# keeps an existing name, e.g. "E2E Alice" from the bot suite).
emu_contact_name() {
  adb -s "$DEV_EMU" shell "content query --uri content://com.android.contacts/phone_lookup/+${CC}$1 --projection display_name" \
    | tr -d '\r' | sed -nE 's/.*display_name=([^,]*).*$/\1/p' | head -1
}

# Phonebook entries: the emulator and the simulator get the other devices.
# Never the physical phones: their default contacts account is the owner's
# own (Google/Samsung) account, so test contacts would sync into their real
# address book. They only receive first, so they don't need contacts; sender
# labels there come from the game server (identityService).
seed_phonebooks() {
  local others=() who
  for who in ios pixel samsung; do others+=("$who:$(phone_of "$who")"); done
  ANDROID_SERIAL="$DEV_EMU" E2E_BOT_PHONES="$(IFS=,; echo "${others[*]}")" e2e/scripts/seed-contacts.sh
  local vcf="$OUT/ios-contacts.vcf"; : >"$vcf"
  for who in emu pixel samsung; do
    local name; name="E2E $(printf '%s' "${who:0:1}" | tr '[:lower:]' '[:upper:]')${who:1}"
    printf 'BEGIN:VCARD\nVERSION:3.0\nFN:%s\nTEL;TYPE=CELL:+%s%s\nEND:VCARD\n' "$name" "$CC" "$(phone_of "$who")" >>"$vcf"
  done
  xcrun simctl addmedia "$DEV_IOS" "$vcf"
}

# Keeps physical phones' screens on during a run without changing any setting:
# every 15 s, a no-op key event (KEYCODE_UNKNOWN) counts as user activity and
# resets the screen timeout, so a phone that waits through other devices'
# steps doesn't lock. Call once; stopped by stop_keep_awake (or on exit).
KEEP_AWAKE_PID=""
start_keep_awake() { # start_keep_awake <device name>...
  local serials=() who
  for who in "$@"; do serials+=("$(dev_of "$who")"); done
  ( while true; do
      for s in "${serials[@]}"; do adb -s "$s" shell input keyevent KEYCODE_UNKNOWN >/dev/null 2>&1 || true; done
      sleep 15
    done ) &
  KEEP_AWAKE_PID=$!
}
stop_keep_awake() { [[ -n "$KEEP_AWAKE_PID" ]] && kill "$KEEP_AWAKE_PID" 2>/dev/null || true; }
