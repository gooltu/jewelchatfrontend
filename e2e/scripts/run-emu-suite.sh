#!/usr/bin/env bash
# Every-run E2E tier: the Android emulator and the iOS simulator, each with
# its own bot peers, then the two apps together. No physical phones.
#
#   npm run e2e:emu                                   # everything, both platforms
#   E2E_PLATFORMS=emu npm run e2e:emu                 # Android emulator only
#   E2E_SUITES=group,cross-app npm run e2e:emu        # some suites
#   E2E_ONLY=A01,D10,G01 E2E_PLATFORMS=emu npm run e2e:emu
#   E2E_NO_RESET=1 npm run e2e:emu                    # skip the account reset (iterating locally)
#
# 1. Resets every test account through the JewelChat admin API (fresh sign-up
#    state, no leftover chats, rosters or groups).
# 2. Opens the live report: e2e/.out/report/index.html (refreshes itself).
# 3. Runs run-platform.sh for emu and ios in parallel (auth, 1:1, unknown
#    senders, groups — all against bots).
# 4. Runs run-cross-app.sh (emulator <-> simulator) when both platforms ran.
set -uo pipefail
cd "$(dirname "$0")/../.."
source e2e/scripts/lib-multi.sh

SUITES="${E2E_SUITES:-auth,direct,unknown,group,cross-app}"
PLATFORMS="${E2E_PLATFORMS:-emu,ios}"
export E2E_OUT="${E2E_OUT:-e2e/.out/emu-suite}"; mkdir -p "$E2E_OUT"

curl -sf http://127.0.0.1:8081/status >/dev/null || { echo "Metro isn't running on :8081 (npx expo start)"; exit 1; }
for p in ${PLATFORMS//,/ }; do
  [[ -n "$(dev_of "$p")" ]] || { echo "no $p device: boot the emulator/simulator (or set E2E_GROUP_DEVICES)"; exit 1; }
done

if [[ -z "${E2E_NO_RESET:-}" ]]; then
  echo "▸ resetting test accounts (JewelChat admin)"
  node e2e/scripts/reset-accounts.mjs || { echo "✗ account reset failed — fix it, or rerun with E2E_NO_RESET=1"; exit 1; }
fi

export E2E_RUN_ID
E2E_RUN_ID="$(node e2e/report/report.mjs start --title "Emulator tier ($PLATFORMS)" --suites "$SUITES")"
REPORT_HTML="$PWD/e2e/.out/report/index.html"
echo "▸ live report: file://$REPORT_HTML"
[[ -n "${E2E_OPEN_REPORT:-}" ]] && open "$REPORT_HTML"

PLATFORM_SUITES=$(echo "$SUITES" | tr ',' '\n' | grep -v '^cross-app$' | paste -sd, -)
PIDS=(); FAILED=0
if [[ -n "$PLATFORM_SUITES" ]]; then
  for p in ${PLATFORMS//,/ }; do
    ( E2E_SUITES="$PLATFORM_SUITES" e2e/scripts/run-platform.sh "$p" 2>&1 | while IFS= read -r line; do echo "[$p] $line"; done ) &
    PIDS+=($!)
  done
  for pid in "${PIDS[@]}"; do wait "$pid" || FAILED=1; done
fi

if [[ ",$SUITES," == *",cross-app,"* ]]; then
  if [[ ",$PLATFORMS," == *",emu,"* && ",$PLATFORMS," == *",ios,"* ]]; then
    echo "▸ cross-app (emulator <-> simulator)"
    e2e/scripts/run-cross-app.sh || FAILED=1
  else
    echo "▸ cross-app skipped (needs both emu and ios)"
    for id in X01 X02 X03 X04 X05 X06 X07; do
      node e2e/report/report.mjs case "$id" --platform cross --status skipped --note "needs both platforms" >/dev/null
    done
  fi
fi

node e2e/report/report.mjs end >/dev/null
SUMMARY=$(node e2e/report/report.mjs status); STATUS_RC=$?
echo "▸ $SUMMARY"
echo "▸ report: file://$REPORT_HTML"
[[ $FAILED -eq 0 && $STATUS_RC -eq 0 ]]
