#!/usr/bin/env node
// Resets every E2E test account to a fresh-signup state before a suite runs,
// through the same admin API the JewelChat Admin app's "Reset account" screen
// uses (ServerProjextX: POST /admin/login, GET /admin/users/search,
// POST /admin/users/:id/reset). A reset clears the profile (name back to the
// placeholder, referral cleared), game progress, and on the chat server the
// archive, roster, group memberships and push subscriptions. The account id,
// phone and JID stay the same.
//
//   node e2e/scripts/reset-accounts.mjs              # reset the whole pool
//   node e2e/scripts/reset-accounts.mjs --dry-run    # only list phone -> user id
//   node e2e/scripts/reset-accounts.mjs 9000000098   # just these numbers
//
// Needs E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD (e2e/.env.local). Numbers that
// don't exist on the server yet are skipped: they are already fresh.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Only reserved test numbers may ever be reset. */
export const TEST_NUMBER = /^90000000\d\d$/;
/** Team JewelChat (the admin console's own chat account). */
const PROTECTED_USER_IDS = new Set([1]);

/** e2e/.env.local, without overriding values already in the environment. */
export function loadEnv(file = path.join(ROOT, 'e2e/.env.local')) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

/** Every 10-digit number named by the pool variables (name:phone lists or bare lists). */
export function poolNumbers(env = process.env) {
  const keys = Object.keys(env).filter(
    (k) => k.startsWith('E2E_') && /PHONE|BOTS|STRANGERS/.test(k) && !/DEVICES/.test(k),
  );
  const out = new Set();
  for (const k of keys) {
    for (const m of String(env[k]).matchAll(/(?<!\d)\d{10}(?!\d)/g)) out.add(m[0]);
  }
  return [...out].sort();
}

/** Throws unless every number is a reserved test number. */
export function assertTestNumbers(numbers) {
  const bad = numbers.filter((n) => !TEST_NUMBER.test(n));
  if (bad.length) throw new Error(`refusing to reset non-test numbers: ${bad.join(', ')}`);
}

async function api(base, method, route, { token, body } = {}) {
  const res = await fetch(`${base}${route}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try {
    data = await res.json();
  } catch {
    /* non-JSON error page */
  }
  if (!res.ok || data.error) {
    const err = new Error(`${method} ${route} -> ${res.status} ${data.message ?? ''}`.trim());
    err.status = res.status;
    throw err;
  }
  return data;
}

async function main() {
  loadEnv();
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const explicit = args.filter((a) => /^\d{10}$/.test(a));
  const numbers = explicit.length ? explicit : poolNumbers();
  assertTestNumbers(numbers);
  if (!numbers.length) throw new Error('no test numbers found (see e2e/.env.example)');

  const base = process.env.E2E_GAMESERVER || 'https://game.jewelchat.net';
  const cc = process.env.E2E_COUNTRY_CODE || '91';
  const email = process.env.E2E_ADMIN_EMAIL;
  const password = process.env.E2E_ADMIN_PASSWORD;
  if (!email || !password) throw new Error('set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD in e2e/.env.local');

  const { token } = await api(base, 'POST', '/admin/login', { body: { email, password } });

  const rows = [];
  let failed = 0;
  for (const phone of numbers) {
    const { users } = await api(base, 'GET', `/admin/users/search?q=${cc}${phone}`, { token });
    const user = users.find((u) => String(u.phone) === `${cc}${phone}`);
    if (!user) {
      rows.push([phone, '-', 'not registered (already fresh)']);
      continue;
    }
    if (PROTECTED_USER_IDS.has(user.id)) throw new Error(`${phone} maps to protected user ${user.id}`);
    if (dryRun) {
      rows.push([phone, user.id, `would reset (name "${user.name}")`]);
      continue;
    }
    try {
      await api(base, 'POST', `/admin/users/${user.id}/reset`, {
        token,
        body: { confirm: user.id, signOut: true },
      });
      rows.push([phone, user.id, 'reset']);
    } catch (err) {
      failed += 1;
      rows.push([phone, user.id, `FAILED: ${err.message}`]);
      if (err.status === 404 && /\/reset/.test(err.message)) {
        rows.push(['', '', 'the reset endpoint is not deployed on this server']);
        break;
      }
    }
  }
  for (const [phone, id, note] of rows) console.log(`  ${String(phone).padEnd(11)} ${String(id).padEnd(7)} ${note}`);
  if (failed) {
    console.error(`✗ ${failed} account(s) could not be reset`);
    process.exit(1);
  }
  console.log(dryRun ? '✓ dry run, nothing reset' : `✓ ${rows.filter((r) => r[2] === 'reset').length} account(s) reset`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => {
    console.error(`✗ reset-accounts: ${err.message}`);
    process.exit(1);
  });
}
