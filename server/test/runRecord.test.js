// Rule 27: the lab's run record and its decision lines. Each test that is about the record uses a silent writer; the stdout tests capture the lines.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, startHttpServer } from '../src/app.js';
import { createHealth } from '../src/health.js';
import { createWorkspaces } from '../src/workspaces.js';
import { assertRunObservability, classify } from '../src/runObservability.js';
import { RUN_ID_RE, clean, decisionLine, evaluateEvents, newRunId, oboEvents } from '../src/runRecord.js';
import { post } from './helpers.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

test('the README says why only the Mock runs are recorded, and that Real privilege-check has no run record yet', () => {
  const readme = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../README.md'), 'utf8');
  assert.match(readme, /Live runs are not stored/);
  assert.match(readme, /Real privilege-check .{0,80}not recorded/);
});

const MATCHER_WORDS = /\b(refused|denied|rejected|forbidden|failed|invalid|expired|mismatch|token|audience|scope|served)\b/i;
const PRODUCTS = ['pingfederate', 'pinggateway', 'privilege-gateway', 'privilege-siem', 'promptguard', 'mcp-server'];
const configFile = '/nonexistent/customer.config.json';

async function serve(fn, { runLog = () => {}, workspaces } = {}) {
  const health = createHealth({ intervalMs: 3_600_000 });
  await health.ready;
  const app = createApp({ health, configFile, runLog, ...(workspaces ? { workspaces } : {}) });
  const { server, url } = await startHttpServer({ port: 0, host: '127.0.0.1', app });
  try { await fn(url.replace(/\/$/, '')); } finally { health.stop(); await new Promise((r) => server.close(r)); }
}

const get = (url, path, headers = {}) => fetch(`${url}${path}`, { headers: { origin: url, ...headers } });
const json = async (r) => ({ status: r.status, body: await r.json().catch(() => null) });

test('a Mock evaluate: every row is simulated, the record passes the shared assertion, and the resource layer is not-logged with its reason', async () => {
  await serve(async (url) => {
    const run = await json(await post(url, '/api/evaluate', { mode: 'mock', scenario: 'legit-lookup' }));
    assert.equal(run.status, 200);
    assert.match(run.body.runId, RUN_ID_RE);
    const rec = await json(await get(url, `/api/run-record?runId=${run.body.runId}&mode=mock`));
    assert.equal(rec.status, 200);
    assert.equal(rec.body.source, 'mock');
    assert.deepEqual(assertRunObservability(rec.body), []);
    assert.ok(rec.body.rows.length > 0);
    assert.ok(rec.body.rows.every((r) => r.origin === 'simulated' || r.origin === 'not-logged'), 'no row is read from a log or taken from a response');
    assert.ok(rec.body.rows.some((r) => r.origin === 'simulated'));
    assert.equal(rec.body.coverage.resource, 'not-logged');
    assert.match(rec.body.reasons.resource, /does not call the MCP server/);
    assert.equal(rec.body.coverage.gateway, 'simulated');
  });
});

test('a Live evaluate is not stored: no run id, no record in either mode, and its stdout lines carry run=none', async () => {
  const lines = [];
  await serve(async (url) => {
    const run = await json(await post(url, '/api/evaluate', { mode: 'live', scenario: 'legit-lookup' }));
    assert.equal(run.status, 200);
    assert.equal(run.body.runId, null);
    assert.ok(lines.length > 0, 'the decision line is still written');
    assert.ok(lines.every((l) => / run=none$/.test(l)), lines.join('\n'));
    for (const mode of ['live', 'mock']) {
      const rec = await json(await get(url, `/api/run-record?runId=r1-00000000&mode=${mode}`));
      assert.equal(rec.status, 404);
      assert.equal(rec.body.error, 'run_not_found');
    }
  }, { runLog: (l) => lines.push(l) });
});

test('an OBO run: issuing and checks are info, and only the MCP server decides; a refused run is counted as refused', async () => {
  await serve(async (url) => {
    const ok = await json(await post(url, '/api/obo', { mode: 'mock', scenario: 'ok' }));
    const okRec = await json(await get(url, `/api/run-record?runId=${ok.body.runId}&mode=mock`));
    assert.deepEqual(okRec.body.summary, { allowed: 1, refused: 0, blocked: 0, info: 3, unverified: 0 });
    const expired = await json(await post(url, '/api/obo', { mode: 'mock', scenario: 'expired' }));
    const expRec = await json(await get(url, `/api/run-record?runId=${expired.body.runId}&mode=mock`));
    assert.equal(expRec.body.summary.refused, 1);
    assert.equal(expRec.body.summary.allowed, 0);
    assert.deepEqual(assertRunObservability(expRec.body), []);
  });
});

test('the stdout line: one per policy decision, and every line is quiet under the shared classifier for every product', async () => {
  const lines = [];
  await serve(async (url) => {
    await post(url, '/api/evaluate', { mode: 'mock', scenario: 'legit-lookup' });
    await post(url, '/api/obo', { mode: 'mock', scenario: 'ok' });
  }, { runLog: (l) => lines.push(l) });
  assert.equal(lines.length, 2, 'one evaluate decision and one OBO decision');
  for (const line of lines) {
    assert.match(line, /^\d{4}-\d{2}-\d{2}T[\d:.]+Z intent-purpose-behaviour-lab decision step=\S+ actor=\S+ result=(passed|stopped|unclear) run=r\S+$/);
    assert.ok(!MATCHER_WORDS.test(line), `a matcher word in: ${line}`);
    for (const product of PRODUCTS) {
      const at = line.slice(0, line.indexOf(' '));
      assert.equal(classify({ product, at, atExact: at, message: line }), null, `${product} reads ${line}`);
    }
  }
});

test('a request that fails validation begins no run: no run id, no record and no stdout line', async () => {
  const lines = [];
  await serve(async (url) => {
    const bad = await json(await post(url, '/api/evaluate', { mode: 'mock', scenario: 'no-such-scenario' }));
    assert.equal(bad.status, 400);
    assert.equal(bad.body.runId, undefined);
    const live = await json(await post(url, '/api/evaluate', { mode: 'mock', call: { tool: 'x.y' } }));
    assert.equal(live.status, 400);
    assert.equal(lines.length, 0);
  }, { runLog: (l) => lines.push(l) });
});

test('route answers: a missing mode, a malformed run id and a method other than GET are refused in JSON', async () => {
  await serve(async (url) => {
    const noMode = await json(await get(url, '/api/run-record?runId=r1-00000000'));
    assert.equal(noMode.status, 400);
    assert.equal(noMode.body.error, 'bad_mode');
    const badId = await json(await get(url, '/api/run-record?runId=../../x&mode=mock'));
    assert.equal(badId.status, 400);
    assert.equal(badId.body.error, 'bad_run_id');
    const wrong = await fetch(`${url}/api/run-record?runId=r1-00000000&mode=mock`, { method: 'POST', headers: { origin: url, 'content-type': 'application/json' }, body: '{}' });
    assert.equal(wrong.status, 405);
    assert.equal(wrong.headers.get('allow'), 'GET, HEAD', 'Allow comes from the route table: GET and the HEAD it implies');
  });
});

test('a throwing writer drops the lines and nothing else: the answer and the record match a healthy run', async () => {
  const seen = [];
  const throwing = () => { throw Object.assign(new Error('disk full: secret-value-here'), { code: 'ENOSPC' }); };
  const stderr = process.stderr.write.bind(process.stderr);
  const quiet = [];
  process.stderr.write = (c) => { quiet.push(String(c)); return true; };
  try {
    await serve(async (url) => {
      const run = await json(await post(url, '/api/evaluate', { mode: 'mock', scenario: 'legit-lookup' }));
      seen.push(run.body.decision, run.body.reasonCode);
      const rec = await json(await get(url, `/api/run-record?runId=${run.body.runId}&mode=mock`));
      assert.equal(rec.status, 200);
      assert.deepEqual(assertRunObservability(rec.body), []);
    }, { runLog: throwing });
  } finally { process.stderr.write = stderr; }
  assert.ok(seen[0], 'the answer still carries its decision');
  assert.ok(quiet.join('').includes('ENOSPC'), 'the code is printed');
  assert.ok(!quiet.join('').includes('secret-value-here'), 'the message is never printed');
});

test('the stdout values are sanitised: a hostile value cannot add a key or a second line', () => {
  const out = clean('x\ny=z refused');
  assert.ok(!/[\s=]/.test(out), `${out}`);
  const line = decisionLine({ event: { at: '2026-11-24T00:00:00.000Z', outcome: 'refused', decision: true, step: 'gateway' }, actor: 'a\nb', runId: 'r1-00000000' });
  assert.equal(line.split('\n').length, 1);
  assert.equal(clean(undefined), 'none');
});

test('run ids do not repeat within a process', () => {
  const ids = new Set(Array.from({ length: 200 }, () => newRunId()));
  assert.equal(ids.size, 200);
  assert.ok([...ids].every((id) => RUN_ID_RE.test(id)));
});

test('a workspace keeps its runs per mode: a Live run never evicts a Mock one', () => {
  const ws = createWorkspaces();
  const run = (mode, n) => ({ runId: `r${n}-00000000`, mode, source: mode === 'mock' ? 'mock' : 'real', events: [], startedAt: '2026-11-24T00:00:00.000Z', endedAt: '2026-11-24T00:00:00.000Z' });
  ws.addRun('w1', run('mock', 0));
  for (let i = 1; i <= 25; i += 1) ws.addRun('w1', run('live', i));
  assert.ok(ws.run('w1', 'r0-00000000', 'mock'), 'the Mock run is still there');
  assert.equal(ws.run('w1', 'r1-00000000', 'live'), null, 'the oldest Live run is evicted at the cap');
  assert.ok(ws.run('w1', 'r25-00000000', 'live'));
});

test('the pure builders stamp each event once and keep the decision flag on the policy point only', () => {
  let t = 0;
  const stamp = () => new Date(Date.UTC(2026, 10, 24, 0, 0, t += 1)).toISOString();
  const evs = oboEvents({
    gatewayChecks: { ok: true, checks: [{ id: 'iss', ok: true }] }, backend: { ok: true, checks: [{ id: 'aud', ok: true }] },
    exchanged: { claims: { aud: 'https://mcp.example/x' } }, attribution: { actor: 'agent-1' }, accepted: true,
  }, stamp);
  assert.deepEqual(evs.map((e) => e.decision === true), [false, false, false, true]);
  assert.equal(evs[3].outcome, 'allowed');
  const ev = evaluateEvents({ agent: 'agent-1', title: 't', decision: 'ask', reasonCode: 'R' }, stamp);
  assert.equal(ev.find((e) => e.decision).outcome, 'info');
});
