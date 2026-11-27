// node --test e2e/report/   (plain Node test runner; no app code involved)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startRun, recordCase, endRun, loadRun, renderHtml, summarize, overall } from './report.mjs';

const catalog = [
  { id: 'A01', suite: 'auth', tier: 'emulator', platforms: ['emu', 'ios'], title: 'Name <required>', description: 'd', edge: false },
  { id: 'D23', suite: 'direct', tier: 'emulator', platforms: ['emu'], title: 'Killed', description: 'd', edge: true, knownIssue: 'k' },
];

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-report-'));
}

test('two platforms reporting at once both land, latest status wins', () => {
  const dir = tmp();
  const run = startRun(dir, { runId: 'r1', suites: 'auth,direct' });
  recordCase(dir, run, { caseId: 'A01', platform: 'emu', status: 'running', at: 1000 });
  recordCase(dir, run, { caseId: 'A01', platform: 'ios', status: 'running', at: 1000 });
  recordCase(dir, run, { caseId: 'A01', platform: 'ios', status: 'failed', at: 3000 });
  recordCase(dir, run, { caseId: 'A01', platform: 'emu', status: 'passed', at: 2500 });
  const r = loadRun(dir, run);
  assert.equal(r.results['A01|emu'].status, 'passed');
  assert.equal(r.results['A01|ios'].status, 'failed');
  assert.equal(r.results['A01|emu'].startedAt, 1000);
  const counts = summarize(catalog, r);
  assert.deepEqual([counts.passed, counts.failed, counts.pending], [1, 1, 1]);
});

test('page reloads while live, stops after end, escapes text', () => {
  const dir = tmp();
  const run = startRun(dir, { runId: 'r2' });
  recordCase(dir, run, { caseId: 'D23', platform: 'emu', status: 'xfail' });
  let html = renderHtml(dir, { catalog });
  assert.match(html, /location\.reload/);
  assert.match(html, /Name &lt;required&gt;/);
  assert.match(html, /Expected fail/);
  endRun(dir, run);
  html = renderHtml(dir, { catalog });
  assert.doesNotMatch(html, /location\.reload/);
});

test('overall status prefers failures', () => {
  assert.equal(overall(['passed', 'failed']), 'failed');
  assert.equal(overall(['passed', 'skipped']), 'passed');
  assert.equal(overall(['xfail']), 'xfail');
});
