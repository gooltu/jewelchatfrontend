#!/usr/bin/env bash
# Quick local run: the 1:1 bot suite on the Android emulator only, without
# resetting accounts. For the full every-run tier use `npm run e2e:emu`.
#
#   npm run e2e                     # 1:1 suite (B01–B09, D10–D23) on the emulator
#   npm run e2e -- 05-reply         # one case, by flow file name …
#   npm run e2e -- D14              # … or by case id (B01 login always runs first)
#   E2E_PLATFORMS=ios npm run e2e   # on the iOS simulator instead
set -euo pipefail
cd "$(dirname "$0")/../.."

ONLY=""
if [[ $# -gt 0 ]]; then
  ONLY=$(node -e '
    const arg = process.argv[1];
    const c = require("./e2e/report/catalog.json").cases.find((c) => c.id === arg || (c.flow || "").includes(`/${arg}.yaml`) || (c.flow || "").includes(`/${arg}-`));
    if (!c) { console.error(`no case or flow named ${arg}`); process.exit(1); }
    console.log(c.id);' "$1")
fi

E2E_NO_RESET="${E2E_NO_RESET:-1}" E2E_PLATFORMS="${E2E_PLATFORMS:-emu}" E2E_SUITES="${E2E_SUITES:-direct}" E2E_ONLY="$ONLY" \
  exec e2e/scripts/run-emu-suite.sh
