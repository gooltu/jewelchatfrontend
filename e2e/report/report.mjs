#!/usr/bin/env node
// Live HTML report for the E2E suites. Runners call it after every test case;
// it regenerates a self-contained page (works from file://) that reloads
// itself every few seconds while the run is open.
//
//   node e2e/report/report.mjs start [--run <id>] [--title "..."] [--suites auth,direct]
//   node e2e/report/report.mjs case <caseId> --platform emu --status running|passed|failed|skipped|xfail
//                              [--log path] [--shot path] [--note text] [--duration ms]
//   node e2e/report/report.mjs end            # closes the run (page stops reloading)
//   node e2e/report/report.mjs status         # prints counts; exit 1 if anything failed
//
// Every call writes its own small JSON file, so runners on several platforms can
// report at the same time without clobbering each other. The run id comes from
// --run, then $E2E_RUN_ID, then the last `start`.
//
// Page: e2e/.out/report/index.html (override the folder with $E2E_REPORT_DIR).

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
export const STATUSES = ['pending', 'running', 'passed', 'failed', 'xfail', 'skipped'];
const HISTORY = 10;

export function reportDir(env = process.env) {
  return path.resolve(ROOT, env.E2E_REPORT_DIR || 'e2e/.out/report');
}

export function loadCatalog(file = path.join(HERE, 'catalog.json')) {
  return JSON.parse(fs.readFileSync(file, 'utf8')).cases;
}

function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  fs.writeFileSync(tmp, typeof data === 'string' ? data : JSON.stringify(data, null, 1));
  fs.renameSync(tmp, file);
}

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function currentRunId(dir, explicit) {
  if (explicit) return explicit;
  if (process.env.E2E_RUN_ID) return process.env.E2E_RUN_ID;
  try {
    return fs.readFileSync(path.join(dir, 'current'), 'utf8').trim();
  } catch {
    throw new Error('no run started (call `report.mjs start` first or set E2E_RUN_ID)');
  }
}

// ---------------------------------------------------------------------------
// Writing

export function startRun(dir, { runId, title, suites }) {
  const id = runId || new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');
  writeJsonAtomic(path.join(dir, 'runs', id, 'meta.json'), {
    runId: id,
    title: title || 'E2E run',
    suites: suites ? suites.split(',').map((s) => s.trim()).filter(Boolean) : null,
    startedAt: Date.now(),
    endedAt: null,
  });
  writeJsonAtomic(path.join(dir, 'current'), id);
  return id;
}

export function recordCase(dir, runId, ev) {
  if (!STATUSES.includes(ev.status)) throw new Error(`bad status "${ev.status}" (want ${STATUSES.join('|')})`);
  const at = ev.at ?? Date.now();
  const file = path.join(dir, 'runs', runId, 'events', `${String(at).padStart(14, '0')}-${randomUUID().slice(0, 8)}.json`);
  writeJsonAtomic(file, { ...ev, at });
}

export function endRun(dir, runId) {
  const file = path.join(dir, 'runs', runId, 'meta.json');
  const meta = readJson(file);
  if (!meta) throw new Error(`unknown run ${runId}`);
  meta.endedAt = Date.now();
  writeJsonAtomic(file, meta);
}

// ---------------------------------------------------------------------------
// Reading

/** Latest event per case+platform, plus the running case's start time. */
export function loadRun(dir, runId) {
  const meta = readJson(path.join(dir, 'runs', runId, 'meta.json'));
  if (!meta) return null;
  const evDir = path.join(dir, 'runs', runId, 'events');
  const files = fs.existsSync(evDir) ? fs.readdirSync(evDir).filter((f) => f.endsWith('.json')).sort() : [];
  const results = {}; // `${caseId}|${platform}` -> event
  for (const f of files) {
    const ev = readJson(path.join(evDir, f));
    if (!ev) continue;
    const key = `${ev.caseId}|${ev.platform}`;
    const prev = results[key];
    if (!prev || ev.at >= prev.at) {
      results[key] = { ...ev, startedAt: ev.status === 'running' ? ev.at : prev?.startedAt ?? prev?.at };
    }
  }
  return { meta, results };
}

function listRuns(dir) {
  const runsDir = path.join(dir, 'runs');
  if (!fs.existsSync(runsDir)) return [];
  return fs
    .readdirSync(runsDir)
    .map((id) => readJson(path.join(runsDir, id, 'meta.json')))
    .filter(Boolean)
    .sort((a, b) => b.startedAt - a.startedAt);
}

/** One status for a case across its platforms (for history dots and counts). */
export function overall(statuses) {
  for (const s of ['failed', 'running', 'pending', 'passed', 'xfail', 'skipped']) {
    if (statuses.includes(s)) return s;
  }
  return 'pending';
}

export function summarize(cases, run) {
  const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const c of cases) {
    for (const p of c.platforms) counts[run.results[`${c.id}|${p}`]?.status ?? 'pending'] += 1;
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Rendering

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

const LABEL = {
  pending: 'Pending',
  running: 'Running',
  passed: 'Passed',
  failed: 'Failed',
  xfail: 'Expected fail',
  skipped: 'Skipped',
};
const PLATFORM = { emu: 'Android emu', ios: 'iOS sim', cross: 'Emu + iOS', devices: 'Phones' };
const SUITE = {
  auth: 'Sign-up & login',
  direct: '1:1 chat (bots)',
  unknown: 'Unknown senders',
  group: 'Groups (bots)',
  'cross-app': 'Cross-app (emulator ↔ simulator)',
  weekly: 'Physical devices',
};
const TIER = { emulator: 'Every run — emulator, simulator and bots', weekly: 'Weekly — physical devices' };

function fmtDuration(ms) {
  if (ms == null || !Number.isFinite(ms)) return '';
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

function relLink(dir, p) {
  if (!p) return null;
  const abs = path.isAbsolute(p) ? p : path.resolve(ROOT, p);
  return path.relative(dir, abs).split(path.sep).join('/');
}

export function renderHtml(dir, { catalog = loadCatalog(), now = Date.now() } = {}) {
  const runs = listRuns(dir);
  const latest = runs[0];
  if (!latest) return '<!doctype html><meta charset="utf-8"><title>E2E report</title><p>No runs yet.</p>';
  const run = loadRun(dir, latest.runId);
  const live = !run.meta.endedAt;
  const inRun = (c) => !run.meta.suites || run.meta.suites.includes(c.suite);
  const cases = catalog.filter(inRun);
  const counts = summarize(cases, run);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const done = total - counts.pending - counts.running;
  const history = runs.slice(0, HISTORY).reverse().map((m) => loadRun(dir, m.runId));
  const elapsed = (run.meta.endedAt ?? now) - run.meta.startedAt;

  const chip = (c, p) => {
    const r = run.results[`${c.id}|${p}`];
    const s = r?.status ?? 'pending';
    const dur =
      s === 'running' ? fmtDuration(now - (r.startedAt ?? r.at)) : fmtDuration(r?.duration ?? (r?.startedAt ? r.at - r.startedAt : null));
    const links = [
      r?.log ? `<a href="${esc(relLink(dir, r.log))}">log</a>` : '',
      r?.shot ? `<a href="${esc(relLink(dir, r.shot))}">screenshot</a>` : '',
    ]
      .filter(Boolean)
      .join(' · ');
    return `<div class="chip s-${s}" title="${esc(LABEL[s])}${r?.note ? ` — ${esc(r.note)}` : ''}">
      <span class="dot" aria-hidden="true"></span><span class="pl">${esc(PLATFORM[p] ?? p)}</span>
      <span class="st">${esc(LABEL[s])}</span>${dur ? `<span class="dur">${dur}</span>` : ''}
      ${links ? `<span class="links">${links}</span>` : ''}
      ${r?.note ? `<span class="note">${esc(r.note)}</span>` : ''}</div>`;
  };

  const dots = (c) =>
    history
      .map((h) => {
        if (!h || (h.meta.suites && !h.meta.suites.includes(c.suite))) return '<i class="h h-none" title="not run"></i>';
        const s = overall(c.platforms.map((p) => h.results[`${c.id}|${p}`]?.status ?? 'pending'));
        return `<i class="h s-${s}" title="${esc(h.meta.runId)}: ${esc(LABEL[s])}"></i>`;
      })
      .join('');

  const rows = (list) =>
    list
      .map(
        (c) => `<tr>
      <td class="id">${esc(c.id)}</td>
      <td class="what"><div class="title">${esc(c.title)}${c.edge ? ' <span class="badge edge">edge case</span>' : ''}${c.knownIssue ? ' <span class="badge known">known issue</span>' : ''}</div>
        <div class="desc">${esc(c.description)}</div>${c.knownIssue ? `<div class="desc known-text">${esc(c.knownIssue)}</div>` : ''}</td>
      <td class="res">${c.platforms.map((p) => chip(c, p)).join('')}</td>
      <td class="hist"><div class="dots">${dots(c)}</div></td></tr>`,
      )
      .join('');

  const tiers = [...new Set(cases.map((c) => c.tier))];
  const body = tiers
    .map((t) => {
      const suites = [...new Set(cases.filter((c) => c.tier === t).map((c) => c.suite))];
      return `<h2>${esc(TIER[t] ?? t)}</h2>${suites
        .map((s) => {
          const list = cases.filter((c) => c.tier === t && c.suite === s);
          const sc = summarize(list, run);
          return `<section><h3>${esc(SUITE[s] ?? s)} <span class="mini">${sc.passed} passed · ${sc.failed} failed · ${
            list.reduce((a, c) => a + c.platforms.length, 0)
          } total</span></h3>
          <table><thead><tr><th>ID</th><th>Test case</th><th>Result</th><th>Last ${HISTORY} runs</th></tr></thead><tbody>${rows(list)}</tbody></table></section>`;
        })
        .join('')}`;
    })
    .join('');

  const pct = (n) => (total ? (100 * n) / total : 0);
  const bar = ['passed', 'xfail', 'skipped', 'failed', 'running']
    .map((s) => `<span class="seg s-${s}" style="width:${pct(counts[s]).toFixed(2)}%"></span>`)
    .join('');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${live ? '● ' : ''}E2E ${esc(run.meta.runId)} — ${counts.failed ? `${counts.failed} failed` : `${counts.passed} passed`}</title>
<style>
:root{--bg:#f7f7f5;--card:#fff;--fg:#1d1d1b;--muted:#66665f;--line:#e4e3de;--pass:#1f7a3d;--fail:#b3261e;--run:#1f5fbf;--xf:#9a6200;--skip:#8a8a83;--pend:#c9c8c1}
@media (prefers-color-scheme:dark){:root{--bg:#161615;--card:#1f1f1d;--fg:#ecebe6;--muted:#a3a29b;--line:#33322f;--pass:#5cc183;--fail:#ff8a80;--run:#7fb0ff;--xf:#f0b54a;--skip:#8f8e87;--pend:#55544f}}
*{box-sizing:border-box}body{margin:0;font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:var(--bg);color:var(--fg)}
header{position:sticky;top:0;z-index:2;background:var(--card);border-bottom:1px solid var(--line);padding:14px 24px}
.top{display:flex;flex-wrap:wrap;align-items:baseline;gap:8px 20px}
h1{font-size:18px;margin:0}.meta{color:var(--muted)}
.live{color:var(--run);font-weight:600}.live::before{content:"";display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--run);margin-right:6px;animation:pulse 1.2s infinite}
.counts{display:flex;flex-wrap:wrap;gap:6px 16px;margin-top:8px}.counts b{font-variant-numeric:tabular-nums}
.bar{display:flex;height:8px;border-radius:4px;overflow:hidden;background:var(--line);margin-top:10px}.seg{height:100%}
.seg.s-passed{background:var(--pass)}.seg.s-failed{background:var(--fail)}.seg.s-xfail{background:var(--xf)}.seg.s-skipped{background:var(--skip)}.seg.s-running{background:var(--run)}
main{padding:8px 24px 48px;max-width:1400px}
h2{font-size:15px;margin:28px 0 4px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
h3{font-size:16px;margin:18px 0 8px}.mini{font-weight:400;color:var(--muted);font-size:13px;margin-left:8px}
table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);border-radius:8px;overflow:hidden}
th{text-align:left;font-weight:600;font-size:12px;color:var(--muted);padding:8px 12px;border-bottom:1px solid var(--line)}
td{padding:10px 12px;border-bottom:1px solid var(--line);vertical-align:top}tr:last-child td{border-bottom:0}
td.id{font:600 13px ui-monospace,SFMono-Regular,Menlo,monospace;white-space:nowrap;width:56px}
.title{font-weight:600}.desc{color:var(--muted);margin-top:2px;max-width:70ch}.known-text{color:var(--xf)}
.badge{display:inline-block;font-size:11px;font-weight:600;padding:1px 7px;border-radius:10px;margin-left:6px;vertical-align:1px;border:1px solid currentColor}
.badge.edge{color:var(--run)}.badge.known{color:var(--xf)}
td.res{width:340px}.chip{display:flex;flex-wrap:wrap;align-items:center;gap:2px 8px;padding:4px 0}
.chip .dot{width:10px;height:10px;border-radius:50%;flex:none;border:2px solid var(--c);background:var(--c)}
.chip .pl{color:var(--muted);min-width:78px}.chip .st{font-weight:600;color:var(--c)}.chip .dur{color:var(--muted);font-variant-numeric:tabular-nums}
.chip .links{flex-basis:100%;padding-left:18px}.chip .links a{color:var(--run)}.chip .note{flex-basis:100%;padding-left:18px;color:var(--muted);font-size:12px}
.s-passed{--c:var(--pass)}.s-failed{--c:var(--fail)}.s-running{--c:var(--run)}.s-xfail{--c:var(--xf)}.s-skipped{--c:var(--skip)}.s-pending{--c:var(--pend)}
.chip.s-pending .dot{background:transparent}.chip.s-running .dot{animation:pulse 1.2s infinite}
td.hist{width:150px}.dots{display:flex;gap:4px}.h{width:10px;height:10px;border-radius:2px;background:var(--c,var(--line))}.h-none{background:transparent;border:1px dashed var(--line)}
@keyframes pulse{50%{opacity:.35}}
@media (max-width:800px){td.res{width:auto}td.hist,th:last-child{display:none}}
</style></head><body>
<header><div class="top"><h1>E2E report</h1><span class="meta">${esc(run.meta.title)} · run ${esc(run.meta.runId)} · started ${esc(
    new Date(run.meta.startedAt).toLocaleString(),
  )} · ${fmtDuration(elapsed)}</span>${live ? '<span class="live">Running</span>' : '<span class="meta">Finished</span>'}</div>
<div class="counts"><span><b>${done}</b> / ${total} done</span><span style="color:var(--pass)"><b>${counts.passed}</b> passed</span><span style="color:var(--fail)"><b>${
    counts.failed
  }</b> failed</span><span style="color:var(--xf)"><b>${counts.xfail}</b> expected fail</span><span style="color:var(--skip)"><b>${counts.skipped}</b> skipped</span><span><b>${
    counts.pending
  }</b> pending</span></div>
<div class="bar" role="img" aria-label="${done} of ${total} done">${bar}</div></header>
<main>${body}</main>
${
  live
    ? `<script>try{var y=sessionStorage.getItem('e2e-y');if(y)scrollTo(0,+y)}catch(e){}
setTimeout(function(){try{sessionStorage.setItem('e2e-y',String(scrollY))}catch(e){}location.reload()},3000)</script>`
    : ''
}
</body></html>`;
}

export function render(dir) {
  writeJsonAtomic(path.join(dir, 'index.html'), renderHtml(dir));
}

// ---------------------------------------------------------------------------
// CLI

function parseArgs(argv) {
  const pos = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) flags[argv[i].slice(2)] = argv[i + 1]?.startsWith('--') ? 'true' : argv[(i += 1)];
    else pos.push(argv[i]);
  }
  return { pos, flags };
}

function main() {
  const { pos, flags } = parseArgs(process.argv.slice(2));
  const dir = reportDir();
  const cmd = pos[0];
  if (cmd === 'start') {
    const id = startRun(dir, { runId: flags.run, title: flags.title, suites: flags.suites });
    render(dir);
    console.log(id);
  } else if (cmd === 'case') {
    const runId = currentRunId(dir, flags.run);
    recordCase(dir, runId, {
      caseId: pos[1],
      platform: flags.platform || 'emu',
      status: flags.status,
      log: flags.log,
      shot: flags.shot,
      note: flags.note,
      duration: flags.duration != null ? Number(flags.duration) : undefined,
    });
    render(dir);
  } else if (cmd === 'end') {
    endRun(dir, currentRunId(dir, flags.run));
    render(dir);
    console.log(path.join(dir, 'index.html'));
  } else if (cmd === 'render') {
    render(dir);
  } else if (cmd === 'status') {
    const runId = currentRunId(dir, flags.run);
    const run = loadRun(dir, runId);
    const cases = loadCatalog().filter((c) => !run.meta.suites || run.meta.suites.includes(c.suite));
    const counts = summarize(cases, run);
    console.log(Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(' '));
    process.exit(counts.failed ? 1 : 0);
  } else {
    console.error('usage: report.mjs start|case|end|render|status (see the header comment)');
    process.exit(2);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
