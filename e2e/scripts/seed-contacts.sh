#!/usr/bin/env bash
# Adds each bot's number to the Android emulator's address book, so the app's
# roster logic treats the bots as known contacts (presence auto-accept only
# happens for numbers in the phonebook — see CLAUDE.md "Roster & presence").
# Idempotent: skips numbers that already resolve via phone_lookup.
#
# Usage: E2E_BOT_PHONES=alice:9000000001,bob:9000000002 e2e/scripts/seed-contacts.sh
set -euo pipefail

: "${E2E_BOT_PHONES:?set E2E_BOT_PHONES (see e2e/README.md)}"
CC="${E2E_COUNTRY_CODE:-91}"

# Every device-side command goes through as ONE string: `adb shell a b c`
# re-splits arguments on the device, which breaks quoted values like
# `--sort '_id DESC'` or a display name with a space.
dev() { adb ${ANDROID_SERIAL:+-s "$ANDROID_SERIAL"} shell "$1" | tr -d '\r'; }

IFS=',' read -ra PAIRS <<< "$E2E_BOT_PHONES"
for pair in "${PAIRS[@]}"; do
  name="${pair%%:*}"; phone="${pair##*:}"
  number="+${CC}${phone}"
  display="E2E $(printf '%s' "${name:0:1}" | tr '[:lower:]' '[:upper:]')${name:1}"

  existing=$(dev "content query --uri content://com.android.contacts/phone_lookup/${number} --projection display_name" \
    | sed -nE 's/.*display_name=([^,]*).*$/\1/p' | head -1)
  if [[ -n "$existing" ]]; then
    if [[ "$existing" == "$display" ]]; then
      echo "contact ${display} already present"
    else
      # Same number, other name (e.g. "E2E Alice" from an earlier bot run):
      # rename it, so suites that pick a conversation by name find this one.
      raw_id=$(dev "content query --uri content://com.android.contacts/data --projection raw_contact_id --where \"mimetype='vnd.android.cursor.item/phone_v2' AND data1='${number}'\"" \
        | head -1 | sed -E 's/.*raw_contact_id=([0-9]+).*/\1/')
      dev "content update --uri content://com.android.contacts/data --bind data1:s:'${display}' --where \"raw_contact_id=${raw_id} AND mimetype='vnd.android.cursor.item/name'\""
      echo "renamed contact ${existing} -> ${display} (raw_contact ${raw_id})"
    fi
    continue
  fi

  dev "content insert --uri content://com.android.contacts/raw_contacts --bind account_type:n: --bind account_name:n:"
  raw_id=$(dev "content query --uri content://com.android.contacts/raw_contacts --projection _id --sort '_id DESC'" \
    | head -1 | sed -E 's/.*_id=([0-9]+).*/\1/')
  [[ "$raw_id" =~ ^[0-9]+$ ]] || { echo "could not read new raw_contact id (got '$raw_id')"; exit 1; }

  dev "content insert --uri content://com.android.contacts/data --bind raw_contact_id:i:${raw_id} \
--bind mimetype:s:vnd.android.cursor.item/name --bind data1:s:'${display}'"
  dev "content insert --uri content://com.android.contacts/data --bind raw_contact_id:i:${raw_id} \
--bind mimetype:s:vnd.android.cursor.item/phone_v2 --bind data1:s:${number} --bind data2:i:2"
  echo "added contact ${display} as raw_contact ${raw_id}"
done
